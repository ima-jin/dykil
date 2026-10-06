import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { DYKIL_READ_SCOPE, DYKIL_WRITE_SCOPE } from '@/lib/auth/scopes';
import { createSurveyAsset, KernelMediaError } from '@/lib/kernel/media';
import { errorResponse, jsonResponse } from '@/lib/http';
import { listOwnSurveys } from '@/lib/route-helpers';
import {
  normalizeSurveyFields,
  normalizeSurveySettings,
  surveyFilename,
  SURVEY_DOC_SCHEMA,
  type SurveyDoc,
  type SurveyStatus,
  type SurveyType,
} from '@/lib/survey';

const log = createLogger('dykil');

/** GET /api/surveys — list the authenticated caller's own surveys (same as `/api/surveys/mine`). */
export async function GET(request: NextRequest) {
  const authResult = await authenticate(request, { requireScopes: [DYKIL_READ_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status);
  }
  return listOwnSurveys(request);
}

/**
 * POST /api/surveys — create a new survey.
 *
 * A survey definition is a signed document: this app never stores it in a
 * table of its own — it uploads the JSON as a media asset owned by the
 * caller's DID (see src/lib/kernel/media.ts) and the kernel signs the
 * asset's `.fair` manifest on the owner's behalf.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticate(request, { requireScopes: [DYKIL_WRITE_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status);
  }
  const ownerDid = authResult.auth.did;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const { title, description, fields, settings, status, type } = body as {
    title?: string;
    description?: string;
    fields?: unknown;
    settings?: unknown;
    status?: SurveyStatus;
    type?: SurveyType;
  };

  if (!title) {
    return errorResponse('title is required');
  }

  const normalized = normalizeSurveyFields(fields);
  if ('error' in normalized) {
    return errorResponse(normalized.error);
  }

  const normalizedSettings = normalizeSurveySettings(settings);
  if ('error' in normalizedSettings) {
    return errorResponse(normalizedSettings.error);
  }

  const now = new Date().toISOString();
  const doc: SurveyDoc = {
    schema: SURVEY_DOC_SCHEMA,
    ownerDid,
    title,
    description: description ?? null,
    fields: normalized.fields,
    settings: normalizedSettings.settings,
    type: type ?? 'survey',
    status: status ?? 'draft',
    createdAt: now,
    updatedAt: now,
  };

  // Published surveys must be readable by respondents who have no session of
  // their own yet; anything else is genuinely private. The access level moves
  // with the status afterwards via PATCH /media/api/assets/{id}/access (see
  // persistSurveyUpdate in src/lib/route-helpers.ts).
  const access = doc.status === 'published' ? 'public' : 'private';

  try {
    const asset = await createSurveyAsset({
      request,
      filename: surveyFilename(globalThis.crypto.randomUUID()),
      content: JSON.stringify(doc),
      access,
    });
    return jsonResponse({ id: asset.id, ...doc }, 201);
  } catch (error) {
    if (error instanceof KernelMediaError) {
      log.error({ err: error.message, status: error.status }, 'Failed to create survey document');
      return errorResponse(error.message, error.status);
    }
    log.error({ err: String(error) }, 'Failed to create survey document');
    return errorResponse('Failed to create survey', 500);
  }
}
