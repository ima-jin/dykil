import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth/authenticate';
import { deleteSurveyAsset, KernelMediaError, readOwnerSurveyAsset, readPublicSurveyAsset, updateSurveyAsset } from '@/lib/kernel/media';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';
import { isSurveyDoc, normalizeSurveyFields, type SurveyDoc } from '@/lib/survey';
import { handleSurveyRouteError, requireOwnedSurvey } from '@/lib/route-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * GET /api/surveys/:id — get survey with fields.
 *
 * Published surveys are readable by anyone via the public asset-serving
 * endpoint. A draft is only shown to its owner, resolved via a session/token
 * read of the same document — see docs/ARCHITECTURE.md for the caveat that
 * a draft's raw asset is technically fetchable by anyone holding its id,
 * since the kernel has no per-asset access-level update endpoint today.
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  try {
    const authResult = await authenticate(request);
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
        // The kernel's authenticated content-read route doesn't understand a
        // scoped app-token (FINDINGS.md gap #2393) — treat that as "no owner
        // access proven" rather than a hard failure, and fall through to 404.
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

  const authResult = await authenticate(request);
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status, cors);
  }
  const did = authResult.auth.did;

  try {
    const owned = await requireOwnedSurvey(id, did, request, cors, 'Not authorized to update this survey');
    if ('response' in owned) return owned.response;

    const body = await request.json();
    const { title, description, fields, settings, type, status } = body as Partial<SurveyDoc>;

    const updated: SurveyDoc = { ...owned.survey };
    if (title !== undefined) updated.title = title;
    if (description !== undefined) updated.description = description;
    if (fields !== undefined) {
      const normalized = normalizeSurveyFields(fields);
      if ('error' in normalized) return errorResponse(normalized.error, 400, cors);
      updated.fields = normalized.fields;
    }
    if (settings !== undefined) updated.settings = settings;
    if (type !== undefined) updated.type = type;
    if (status !== undefined) updated.status = status;
    updated.updatedAt = new Date().toISOString();

    await updateSurveyAsset(id, JSON.stringify(updated), request);
    return jsonResponse({ id, ...updated }, 200, cors);
  } catch (error) {
    return handleSurveyRouteError(error, cors, 'Failed to update survey');
  }
}

/** DELETE /api/surveys/:id — delete survey (owner only). */
export async function DELETE(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  const authResult = await authenticate(request);
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
