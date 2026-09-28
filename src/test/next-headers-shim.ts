/**
 * Test-only stand-in for `next/headers`'s `cookies()`.
 *
 * `@ima-jin/auth-client` has a single package entrypoint (no subpath export
 * for `loadAppSigningKey()` alone — see `packages/auth-client/package.json`
 * upstream), so importing anything from it pulls in `get-session.ts`, which
 * statically imports `cookies` from `next/headers` for its own (unrelated)
 * session-cookie reading. Next's real `next/headers` is request-scoped and
 * only resolvable inside a Next.js server request, which vitest never runs
 * inside — mirrors the existing `next/server` shim's rationale
 * (`src/test/next-server-shim.ts`). Nothing this app's tests exercise calls
 * `cookies()` itself, so a throwing stub is enough to satisfy the static
 * import; aliased in for tests only (`vitest.config.ts`).
 */
export function cookies(): never {
  throw new Error('next/headers cookies() is not available under the vitest next-headers-shim.');
}
