import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { listMySurveyAssets, readOwnerSurveyAsset, KernelMediaError } from '@/lib/kernel/media';
import { errorResponse, jsonResponse } from '@/lib/http';
import { isSurveyDoc } from '@/lib/survey';

const log = createLogger('dykil');

/** GET /api/surveys/mine — list the authenticated caller's own surveys. */
export async function GET(request: NextRequest) {
  const authResult = await authenticate(request);
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const assets = await listMySurveyAssets(request);
    const surveys = await Promise.all(
      assets.map(async (asset) => {
        const read = await readOwnerSurveyAsset(asset.id, request);
        if (!read || !isSurveyDoc(read.content)) return null;
        return { id: asset.id, ...read.content };
      }),
    );
    return jsonResponse({ surveys: surveys.filter((survey) => survey !== null) });
  } catch (error) {
    if (error instanceof KernelMediaError) {
      return errorResponse(error.message, error.status);
    }
    log.error({ err: String(error) }, 'Failed to list surveys');
    return errorResponse('Failed to fetch surveys', 500);
  }
}
