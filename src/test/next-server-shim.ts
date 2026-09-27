/**
 * Test-only stand-in for `next/server`'s `NextRequest`/`NextResponse`.
 *
 * Neither this app's own routes nor the published `@ima-jin/{auth,config,logger}`
 * packages use anything from `next/server` beyond `NextResponse.json(...)` and
 * (in one route) `request.nextUrl.searchParams` — see the grep this comment
 * accompanies in the PR that added it. Next's real `next/server` entry pulls in
 * `next/dist/server/web/spec-extension/user-agent.js`, which requires the
 * CJS-only `ua-parser-js` bundle (`__dirname`-using); under vitest's SSR
 * dependency pre-bundling that file gets re-emitted as an ESM chunk, where
 * `__dirname` doesn't exist, and the whole import chain throws before any of
 * our code runs. This shim, built on the standard Fetch API's `Request`/
 * `Response` (native in Node 18+), sidesteps that entirely — it's aliased in
 * for tests only (`vitest.config.ts`); the real app always uses the genuine
 * `next/server` at runtime via Next.js itself.
 */
export class NextRequest extends Request {
  readonly nextUrl: URL;

  constructor(input: string | URL | Request, init?: RequestInit) {
    super(input as never, init);
    this.nextUrl = new URL(this.url);
  }
}

export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
}
