import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth/authenticate';
import { DYKIL_READ_SCOPE } from '@/lib/auth/scopes';
import { errorResponse } from '@/lib/http';
import { listOwnSurveys } from '@/lib/route-helpers';

/** GET /api/surveys/mine — list the authenticated caller's own surveys. */
export async function GET(request: NextRequest) {
  const authResult = await authenticate(request, { requireScopes: [DYKIL_READ_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status);
  }
  return listOwnSurveys(request);
}
