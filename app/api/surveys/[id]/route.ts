import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth/authenticate';
import { DYKIL_READ_SCOPE, DYKIL_WRITE_SCOPE } from '@/lib/auth/scopes';
import { deleteSurveyAsset, KernelMediaError, readOwnerSurveyAsset, readPublicSurveyAsset } from '@/lib/kernel/media';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';
import { isSurveyDoc, normalizeSurveyFields, normalizeSurveySettings, type SurveyDoc } from '@/lib/survey';
import { handleSurveyRouteError, persistSurveyUpdate, requireOwnedSurvey } from '@/lib/route-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * GET /api/surveys/:id — get survey with fields.
 *
 * A published survey's asset is `public`, readable by anyone via the public
 * asset-serving endpoint. A draft or closed survey's asset is `private`
 * (access moves with status — see persistSurveyUpdate), so only its owner can
 * read it, via a session/token read of the same document. Authentication is
 * optional here: it only decides whether the owner gets the non-public view.
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  try {
    const authResult = await authenticate(request, { requireScopes: [DYKIL_READ_SCOPE] });
    const callerDid = 'auth' in authResult ? authResult.auth.did : null;

    const publicContent = await readPublicSurveyAsset(id);
    if (publicContent && isSurveyDoc(publicContent)) {
      const isOwner = callerDid === publicContent.ownerDid;
      if (isOwner || publicContent.status === 'published') {
        return jsonResponse({ id, ...publicContent }, 200, cors);
      }
    }

    if (callerDid) {
      try {
        const owned = await readOwnerSurveyAsset(id, request);
        if (owned && isSurveyDoc(owned.content) && owned.content.ownerDid === callerDid) {
          return jsonResponse({ id, ...owned.content }, 200, cors);
        }
      } catch (ownerReadError) {
        // A forwarded credential the media service rejects (e.g. a token whose
        // audience is this app rather than the media host) proves no owner
        // access — treat that as "not shown" rather than a hard failure, and
        // fall through to 404.
        if (!(ownerReadError instanceof KernelMediaError)) throw ownerReadError;
      }
    }

    return errorResponse('Survey not found', 404, cors);
  } catch (error) {
    return handleSurveyRouteError(error, cors, 'Failed to fetch survey');
  }
}

/** PUT /api/surveys/:id — update survey (owner only). */
export async function PUT(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  const authResult = await authenticate(request, { requireScopes: [DYKIL_WRITE_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status, cors);
  }
  const did = authResult.auth.did;

  try {
    const owned = await requireOwnedSurvey(id, did, request, cors, 'Not authorized to update this survey');
    if ('response' in owned) return owned.response;

    const body = await request.json();
    const { title, description, fields, settings, type, status } = body as Partial<Omit<SurveyDoc, 'settings'>> & { settings?: unknown };

    const updated: SurveyDoc = { ...owned.survey };
    if (title !== undefined) updated.title = title;
    if (description !== undefined) updated.description = description;
    if (fields !== undefined) {
      const normalized = normalizeSurveyFields(fields);
      if ('error' in normalized) return errorResponse(normalized.error, 400, cors);
      updated.fields = normalized.fields;
    }
    if (settings !== undefined) {
      const normalizedSettings = normalizeSurveySettings(settings);
      if ('error' in normalizedSettings) return errorResponse(normalizedSettings.error, 400, cors);
      updated.settings = normalizedSettings.settings;
    }
    if (type !== undefined) updated.type = type;
    if (status !== undefined) updated.status = status;
    updated.updatedAt = new Date().toISOString();

    await persistSurveyUpdate(id, owned.survey, updated, request);
    return jsonResponse({ id, ...updated }, 200, cors);
  } catch (error) {
    return handleSurveyRouteError(error, cors, 'Failed to update survey');
  }
}

/** DELETE /api/surveys/:id — delete survey (owner only). */
export async function DELETE(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  const authResult = await authenticate(request, { requireScopes: [DYKIL_WRITE_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status, cors);
  }
  const did = authResult.auth.did;

  try {
    const owned = await requireOwnedSurvey(id, did, request, cors, 'Not authorized to delete this survey');
    if ('response' in owned) return owned.response;

    await deleteSurveyAsset(id, request);
    return jsonResponse({ deleted: true }, 200, cors);
  } catch (error) {
    return handleSurveyRouteError(error, cors, 'Failed to delete survey');
  }
}
