import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { KernelMediaError, listPublicSurveyAssets, readPublicSurveyAsset } from '@/lib/kernel/media';
import { KernelProfileError, resolveHandleToDid } from '@/lib/kernel/profile';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';
import { isSurveyDoc } from '@/lib/survey';

const log = createLogger('dykil');

interface RouteParams {
  params: Promise<{ handle: string }>;
}

export function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * GET /api/surveys/handle/:handle — a handle's published surveys.
 *
 * The original app's version of this route was a stub that always returned an
 * empty list (no handle→DID resolver). The kernel's public profile API resolves
 * it now (`GET /profile/api/profile/{handle}`, imajin-ai#2397), and the media
 * list takes `did=` for another identity's assets, restricted by the kernel to
 * `public` ones — so a draft is never returned. Each listed document is read
 * through the public asset endpoint and kept only if it is a `published`
 * survey actually owned by that DID. The media list needs a signed-in caller;
 * an anonymous one gets the kernel's 401.
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const { handle } = await props.params;
  const cors = corsHeaders(request);

  try {
    const did = await resolveHandleToDid(handle);
    if (!did) return errorResponse('Profile not found', 404, cors);

    const assets = await listPublicSurveyAssets(did, request);
    const docs = await Promise.all(
      assets.map(async (asset) => ({ id: asset.id, content: await readPublicSurveyAsset(asset.id) })),
    );
    const surveys = docs.flatMap(({ id, content }) =>
      isSurveyDoc(content) && content.ownerDid === did && content.status === 'published'
        ? [{ id, title: content.title, description: content.description, createdAt: content.createdAt }]
        : [],
    );
    return jsonResponse({ surveys, handle }, 200, cors);
  } catch (error) {
    if (error instanceof KernelMediaError || error instanceof KernelProfileError) {
      return errorResponse(error.message, error.status, cors);
    }
    log.error({ err: String(error) }, 'Failed to list surveys for handle');
    return errorResponse('Failed to fetch surveys', 500, cors);
  }
}
