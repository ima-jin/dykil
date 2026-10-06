/**
 * Forward the inbound caller's own credentials to a kernel service.
 *
 * Both the media service and the attestations API resolve "who is calling"
 * from the shared session cookie or an `Authorization: Bearer` credential, and
 * the attestation reads are additionally `disclosure_scope`-gated (default
 * `parties`) — an anonymous read of a response type returns nothing. So every
 * kernel call this app makes on a caller's behalf carries the caller's own
 * credentials; this app never substitutes its own identity for theirs.
 */
export function forwardedIdentityHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookie = request.headers.get('cookie');
  const authorization = request.headers.get('authorization');
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  return headers;
}
