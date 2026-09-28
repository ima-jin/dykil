#!/usr/bin/env -S node --experimental-strip-types
/**
 * One-pass legacy import (deliverable #3, Ryan's ruling 2026-09-22).
 *
 * Reads the OLD apps/dykil Postgres tables (`dykil.surveys`,
 * `dykil.survey_responses`) read-only via LEGACY_DATABASE_URL, and emits:
 *
 *   - Definitions -> signed documents (media assets), one per legacy survey,
 *     owned by that survey's original `did`.
 *   - Responses -> NODE-WITNESSED LEGACY-IMPORT attestations, since none of
 *     the legacy rows were ever respondent-signed: "kernel witnesses legacy
 *     row `dykil.survey_responses/<id>` stated Y at T; imported at T2",
 *     marked as such, and never upgraded to respondent-signed later.
 *
 * Idempotent: re-running skips any legacy row whose deterministic import id
 * (see `legacyRowRef`) is already present among this app's own DID's
 * node-witnessed attestations. Dry-run by default — pass --commit to
 * actually write.
 *
 * This app's OWN signing key, fetched via `loadAppSigningKey()` (refs
 * imajin-ai#2411 — never a raw private key out of an env file), signs every
 * emitted attestation, never the kernel's key and never a respondent's —
 * see src/lib/response-attestation.ts's provenance doc.
 */
import { Client } from 'pg';
import { sign } from '@ima-jin/auth';
import { bootstrapSigningIdentity, getSigningIdentity } from '../src/lib/auth/signing-identity';
import { canonicalResponsePayload } from '../src/lib/response-attestation';
import { createAttestation, listAttestations } from '../src/lib/kernel/attestations';
import { computeDocHash, SURVEY_DOC_SCHEMA, surveyFilename, type SurveyDoc } from '../src/lib/survey';
import { mediaServiceUrl } from '../src/lib/env';

interface LegacySurveyRow {
  id: string;
  did: string;
  title: string;
  description: string | null;
  fields: unknown;
  settings: unknown;
  type: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface LegacyResponseRow {
  id: string;
  survey_id: string;
  respondent_did: string | null;
  ticket_id: string | null;
  answers: unknown;
  created_at: Date;
}

interface ImportSummary {
  surveysRead: number;
  documentsCreated: number;
  responsesRead: number;
  attestationsCreated: number;
  skippedAlreadyImported: number;
}

function parseArgs(argv: string[]): { commit: boolean } {
  return { commit: argv.includes('--commit') };
}

/** Deterministic reference for a legacy response row, used both for idempotency and the attestation payload. */
function legacyRowRef(surveyId: string, responseId: string): string {
  return `dykil.survey_responses/${surveyId}/${responseId}`;
}

async function fetchLegacyData(client: Client): Promise<{ surveys: LegacySurveyRow[]; responses: LegacyResponseRow[] }> {
  const surveys = await client.query<LegacySurveyRow>('SELECT * FROM dykil.surveys ORDER BY created_at ASC');
  const responses = await client.query<LegacyResponseRow>('SELECT * FROM dykil.survey_responses ORDER BY created_at ASC');
  return { surveys: surveys.rows, responses: responses.rows };
}

function toSurveyDoc(row: LegacySurveyRow): SurveyDoc {
  return {
    schema: SURVEY_DOC_SCHEMA,
    ownerDid: row.did,
    title: row.title,
    description: row.description,
    fields: (row.fields ?? { elements: [] }) as SurveyDoc['fields'],
    settings: (row.settings ?? {}) as SurveyDoc['settings'],
    type: row.type as SurveyDoc['type'],
    status: row.status as SurveyDoc['status'],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? row.created_at.toISOString(),
  };
}

/** Upload one legacy survey definition as a signed document. Returns the new asset id, or null in dry-run. */
async function importSurveyDoc(row: LegacySurveyRow, commit: boolean): Promise<string | null> {
  if (!commit) return null;

  const doc = toSurveyDoc(row);
  const form = new FormData();
  form.set('file', new Blob([JSON.stringify(doc)], { type: 'application/json' }), surveyFilename(row.id));
  form.set('context', JSON.stringify({ app: 'dykil', feature: 'survey', access: doc.status === 'published' ? 'public' : 'private' }));

  // The import script runs with this app's OWN service credentials, not a
  // per-user session — see FINDINGS.md gap #2393 for why this write path is
  // itself blocked against a real, host-scoped-cookie kernel deployment
  // until the media routes accept a scoped app-token or service credential.
  const response = await fetch(`${mediaServiceUrl()}/api/assets`, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`Failed to create signed doc for legacy survey ${row.id}: ${response.status}`);
  }
  const asset = (await response.json()) as { id: string };
  return asset.id;
}

/**
 * Existing `legacyRowRef`s already imported for a survey owner, so re-running
 * this script never double-imports the same legacy row.
 */
async function fetchAlreadyImportedRefs(ownerDid: string): Promise<Set<string>> {
  const existing = await listAttestations({ subjectDid: ownerDid, type: 'dykil/survey-response-legacy-import' });
  const refs = new Set<string>();
  for (const attestation of existing) {
    const ref = attestation.payload?.legacyRowRef;
    if (typeof ref === 'string') refs.add(ref);
  }
  return refs;
}

/** Emit one NODE-WITNESSED LEGACY-IMPORT attestation for a legacy response row. Returns false when skipped (already imported). */
async function importResponseAttestation(params: {
  row: LegacyResponseRow;
  surveyOwnerDid: string;
  surveyAssetId: string;
  doc: SurveyDoc;
  witnessDid: string;
  witnessPrivateKey: string;
  commit: boolean;
  alreadyImported: Set<string>;
}): Promise<boolean> {
  const ref = legacyRowRef(params.row.survey_id, params.row.id);
  if (params.alreadyImported.has(ref)) {
    return false;
  }

  const importedAt = new Date();
  const payload = {
    provenance: 'node-witnessed-legacy-import' as const,
    docHash: computeDocHash(params.doc),
    answers: (params.row.answers ?? {}) as Record<string, unknown>,
    ticketId: params.row.ticket_id,
    legacyRowRef: ref,
    witnessedAt: params.row.created_at.toISOString(),
    importedAt: importedAt.toISOString(),
  };
  const issuedAt = importedAt.getTime();

  const canonical = canonicalResponsePayload({
    surveyOwnerDid: params.surveyOwnerDid,
    surveyAssetId: params.surveyAssetId,
    payload,
    issuedAt,
  });

  if (!params.commit) return true;

  const signed = await sign(canonical, params.witnessPrivateKey, { id: params.witnessDid, type: 'agent' });

  await createAttestation({
    issuerDid: params.witnessDid,
    subjectDid: params.surveyOwnerDid,
    type: 'dykil/survey-response-legacy-import',
    contextId: params.surveyAssetId,
    contextType: 'dykil.survey',
    payload,
    signature: signed.signature,
    issuedAt,
  });

  return true;
}

export async function runImport(argv: string[] = process.argv.slice(2)): Promise<ImportSummary> {
  const { commit } = parseArgs(argv);
  const connectionString = process.env.LEGACY_DATABASE_URL;
  if (!connectionString) {
    throw new Error('LEGACY_DATABASE_URL is not set — see .env.example.');
  }

  let witnessDid = '';
  let witnessPrivateKey = '';
  if (commit) {
    // Fetches this app's own vault signing key (never the kernel's, never a
    // respondent's) via loadAppSigningKey() — throws its own clear error on
    // any failure (missing config, spent/expired claim code, revoked grant).
    await bootstrapSigningIdentity();
    const signingKey = getSigningIdentity();
    witnessDid = signingKey.appDid;
    witnessPrivateKey = signingKey.privateKey;
  }

  const client = new Client({ connectionString });
  await client.connect();

  const summary: ImportSummary = {
    surveysRead: 0,
    documentsCreated: 0,
    responsesRead: 0,
    attestationsCreated: 0,
    skippedAlreadyImported: 0,
  };

  try {
    const { surveys, responses } = await fetchLegacyData(client);
    summary.surveysRead = surveys.length;
    summary.responsesRead = responses.length;

    const assetIdBySurveyId = new Map<string, string>();
    const docBySurveyId = new Map<string, SurveyDoc>();

    for (const row of surveys) {
      // eslint-disable-next-line no-await-in-loop -- sequential by design: idempotency and rate limits both favor one-at-a-time.
      const assetId = await importSurveyDoc(row, commit);
      if (assetId) {
        assetIdBySurveyId.set(row.id, assetId);
        summary.documentsCreated += 1;
      }
      docBySurveyId.set(row.id, toSurveyDoc(row));
    }

    const alreadyImportedByOwner = new Map<string, Set<string>>();

    for (const row of responses) {
      const doc = docBySurveyId.get(row.survey_id);
      const surveyAssetId = assetIdBySurveyId.get(row.survey_id) ?? row.survey_id;
      if (!doc) {
        summary.skippedAlreadyImported += 1;
        continue;
      }

      if (commit && !alreadyImportedByOwner.has(doc.ownerDid)) {
        // eslint-disable-next-line no-await-in-loop -- one lookup per distinct owner, not per row.
        alreadyImportedByOwner.set(doc.ownerDid, await fetchAlreadyImportedRefs(doc.ownerDid));
      }
      const alreadyImported = alreadyImportedByOwner.get(doc.ownerDid) ?? new Set<string>();

      // eslint-disable-next-line no-await-in-loop -- sequential by design: idempotency and rate limits both favor one-at-a-time.
      const created = await importResponseAttestation({
        row,
        surveyOwnerDid: doc.ownerDid,
        surveyAssetId,
        doc,
        witnessDid,
        witnessPrivateKey,
        commit,
        alreadyImported,
      });
      if (!created) {
        summary.skippedAlreadyImported += 1;
      } else if (commit) {
        summary.attestationsCreated += 1;
      }
    }
  } finally {
    await client.end();
  }

  return summary;
}

/* c8 ignore start -- CLI entrypoint, exercised via runImport() in tests instead. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { commit } = parseArgs(process.argv.slice(2));
  runImport()
    .then((summary) => {
      console.log(commit ? 'Import complete:' : 'Dry run (pass --commit to write):', summary);
    })
    .catch((error) => {
      console.error('Import failed:', error);
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
