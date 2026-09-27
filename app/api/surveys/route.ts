import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { createSurveyAsset, KernelMediaError } from '@/lib/kernel/media';
import { errorResponse, jsonResponse } from '@/lib/http';
import {
  normalizeSurveyFields,
  surveyFilename,
  SURVEY_DOC_SCHEMA,
  type SurveyDoc,
  type SurveySettings,
  type SurveyStatus,
  type SurveyType,
} from '@/lib/survey';

const log = createLogger('dykil');

/**
 * POST /api/surveys — create a new survey.
 *
 * A survey definition is a signed document: this app never stores it in a
 * table of its own — it uploads the JSON as a media asset owned by the
 * caller's DID (see src/lib/kernel/media.ts) and the kernel signs the
 * asset's `.fair` manifest on the owner's behalf.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticate(request);
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
    settings?: SurveySettings;
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

  const now = new Date().toISOString();
  const doc: SurveyDoc = {
    schema: SURVEY_DOC_SCHEMA,
    ownerDid,
    title,
    description: description ?? null,
    fields: normalized.fields,
    settings: settings ?? {},
    type: type ?? 'survey',
    status: status ?? 'draft',
    createdAt: now,
    updatedAt: now,
  };

  // Published surveys must be readable by anonymous respondents; drafts are
  // unlisted (see docs/ARCHITECTURE.md for the honest caveat this carries —
  // the kernel has no per-asset access-level update endpoint today, so a
  // draft's access level is fixed at creation).
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
