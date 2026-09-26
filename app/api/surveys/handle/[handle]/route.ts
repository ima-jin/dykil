import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/http';

interface RouteParams {
  params: Promise<{ handle: string }>;
}

/**
 * GET /api/surveys/handle/:handle — get published surveys by user handle.
 *
 * This was already an unimplemented stub in the original apps/dykil ("we'll
 * need to query surveys and get unique DIDs... For now, we'll return an
 * empty array" — the original comment on this exact route) — it isn't a
 * regression introduced by this rebuild. It stays unimplemented here for the
 * same reason: there is no public handle→DID resolution endpoint in the
 * kernel's api-spec (checked auth.yaml, registry.yaml, profile.yaml) to
 * build it on. See FINDINGS.md gap #2397 (filed).
 */
export async function GET(_request: NextRequest, props: RouteParams) {
  const { handle } = await props.params;
  return jsonResponse({ surveys: [], handle });
}
