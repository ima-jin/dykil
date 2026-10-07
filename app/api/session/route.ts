import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth/authenticate';
import { DYKIL_READ_SCOPE } from '@/lib/auth/scopes';
import { errorResponse, jsonResponse } from '@/lib/http';

/**
 * GET /api/session — who is calling this app? `{ did }`, or 401 when nobody is
 * signed in. The pages use it to choose between "sign in" and the app; it
 * reads nothing but the caller's own identity.
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticate(request, { requireScopes: [DYKIL_READ_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status);
  }
  return jsonResponse({ did: authResult.auth.did });
}
