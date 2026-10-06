/**
 * Single source of truth for every environment variable this app (or a
 * dependency it loads, or one of its scripts) reads — refs
 * ima-jin/imajin-ai#2520. Consumed by:
 *   - scripts/check-env.mjs            (deploy preflight; never prints values)
 *   - scripts/deploy.sh                (scrubs inherited shell variables)
 *   - scripts/__tests__/env-docs.test.ts (fails CI if .env.example or
 *     docs/ENVIRONMENTS.md omit a variable, or if code starts reading one
 *     that is not listed here)
 *
 * Examples here are shape-only placeholders — never real secrets.
 */
import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';

export const TARGETS = {
  prod: { name: 'prod-dykil', port: 7101 },
  dev: { name: 'dev-dykil', port: 3101 },
};

export const BASE_PATH = '/dykil';

/**
 * status:
 *   required         must be set in the env file for a deployed instance
 *   first-boot       only for the advanced/CI claim path, then removed
 *   optional         read, has a safe default (or a documented degraded mode) when unset
 *   forbidden        must NOT be set (the app refuses to boot if it is)
 *   runtime-set      injected by Next.js / pm2 / next.config.js — not set in the env file
 *   dependency       read by an @ima-jin/* dependency on a code path dykil
 *                    does not exercise; leave unset
 *   template-unused  present in the app template's .env.example but not read
 *                    by any code in this repo; safe to omit
 * phase: 'build' = baked into the build (set before `next build`),
 *        'runtime' = read at process start / request time,
 *        'script' = read only by an operator/CI script.
 */
export const ENV_VARS = [
  {
    name: 'AUTH_SERVICE_URL',
    status: 'required',
    phase: 'runtime',
    summary:
      'Kernel auth service base URL, including the /auth prefix. Read by @ima-jin/auth for session and app-token verification and by the attestation client.',
    dev: 'https://dev-jin.imajin.ai/auth',
    prod: 'https://jin.imajin.ai/auth',
  },
  {
    name: 'MEDIA_SERVICE_URL',
    status: 'required',
    phase: 'runtime',
    summary: "Kernel media service base URL, including the /media prefix. Survey definitions are signed documents (media assets) stored here.",
    dev: 'https://dev-jin.imajin.ai/media',
    prod: 'https://jin.imajin.ai/media',
  },
  {
    name: 'IMAJIN_KERNEL_URL',
    status: 'required',
    phase: 'runtime',
    summary: "Kernel base URL (no path). Used by loadAppSigningKey() to redeem the claim code and to fetch this app's signing key at boot.",
    dev: 'https://dev-jin.imajin.ai',
    prod: 'https://jin.imajin.ai',
  },
  {
    name: 'NEXT_PUBLIC_IMAJIN_AUTH_URL',
    status: 'required',
    phase: 'build',
    summary:
      'Kernel origin (no path) the "Sign in with Imajin" link points at (`<value>/auth`). Baked into the client bundle at BUILD time; rebuild after changing.',
    dev: 'https://dev-jin.imajin.ai',
    prod: 'https://jin.imajin.ai',
  },
  {
    name: 'NEXT_PUBLIC_APP_URL',
    status: 'required',
    phase: 'runtime',
    summary:
      "This app's public URL. Its HOST is the `aud` used to verify scoped app tokens — it must match a host in this app's registered tokenAudiences (operator-confirmed at registration, docs/REGISTRATION.md).",
    dev: 'https://dev-jin.imajin.ai/dykil',
    prod: 'https://jin.imajin.ai/dykil',
  },
  {
    name: 'IMAJIN_APP_DID',
    status: 'required',
    phase: 'runtime',
    summary:
      "This app's own did:imajin:… from registration (docs/REGISTRATION.md); dev and prod each have their own. Required on every boot once a keystore exists. Not a secret.",
    dev: 'did:imajin:<dev app DID>',
    prod: 'did:imajin:<prod app DID>',
  },
  {
    name: 'IMAJIN_ENV',
    status: 'optional',
    phase: 'runtime',
    summary:
      'Selects the kernel session cookie name in @ima-jin/config: `dev` → imajin_session_dev, anything else → imajin_session. MUST be `dev` on the dev instance (a production build is NODE_ENV=production, which does not imply dev); leave unset on prod.',
    dev: 'dev',
    prod: '(unset)',
  },
  {
    name: 'IMAJIN_APP_KEYSTORE',
    status: 'optional',
    phase: 'runtime',
    summary:
      "Path of this app's 0600 bootstrap keystore (never the vault key itself). Default ./.imajin/keystore.json relative to the process cwd. Set it to an absolute path outside the checkout so it persists across deploys, and keep it separate for dev and prod.",
    dev: '/home/jin/.imajin/dykil.dev.keystore.json',
    prod: '/home/jin/.imajin/dykil.prod.keystore.json',
  },
  {
    name: 'IMAJIN_APP_CLAIM_CODE',
    status: 'first-boot',
    phase: 'runtime',
    secret: true,
    summary:
      "Advanced/CI fallback. The normal operator path is pasting the one-time code from the kernel operator's /jin approval card on `<app>/claim` (imajin-ai#2427) — no env var needed. If set, it is spent on first boot (no keystore yet) or a lost-keystore rebind; delete it afterwards.",
    dev: '(only for the CI claim path)',
    prod: '(only for the CI claim path)',
  },
  {
    name: 'DYKIL_APP_PRIVATE_KEY',
    status: 'forbidden',
    phase: 'runtime',
    secret: true,
    summary: 'Removed. The app throws at boot if this is set — the signing key comes from loadAppSigningKey(), never from env.',
    dev: '(never set)',
    prod: '(never set)',
  },
  {
    name: 'DYKIL_RESPONSE_ATTESTATION_TYPE',
    status: 'optional',
    phase: 'runtime',
    summary: 'Attestation type a respondent-signed response is issued under (default `dykil/survey-response`). Must already be registered with the kernel (docs/REGISTRATION.md §5).',
    dev: 'dykil/survey-response',
    prod: 'dykil/survey-response',
  },
  {
    name: 'DYKIL_LEGACY_IMPORT_ATTESTATION_TYPE',
    status: 'optional',
    phase: 'runtime',
    summary: 'Attestation type for NODE-WITNESSED legacy-import rows (default `dykil/survey-response-legacy-import`). Used by scripts/import-legacy.ts and when reading imported responses.',
    dev: 'dykil/survey-response-legacy-import',
    prod: 'dykil/survey-response-legacy-import',
  },
  {
    name: 'EVENTS_SERVICE_URL',
    status: 'optional',
    phase: 'runtime',
    summary: 'Events service base URL (`<kernel>/events`). Only ticket-gated surveys need it; they answer 501 until it is set.',
    dev: 'https://dev-jin.imajin.ai/events',
    prod: 'https://jin.imajin.ai/events',
  },
  {
    name: 'DYKIL_EVENTS_AUTHORIZATION_ID',
    status: 'optional',
    phase: 'runtime',
    summary:
      'Id of the `app.authorized` attestation granting this app `events:read`; the ticket gate mints its token against it. Operator-created per environment; ticket-gated surveys answer 501 until set.',
    dev: '(operator-created attestation id)',
    prod: '(operator-created attestation id)',
  },
  {
    name: 'LEGACY_DATABASE_URL',
    status: 'optional',
    phase: 'script',
    secret: true,
    summary:
      'Connection string for the OLD dykil.* Postgres schema, via a READ-ONLY role. Read only by scripts/legacy-baseline.mjs (deploy step 6) and scripts/import-legacy.ts — never at request time. Unset it once the legacy data is retired.',
    dev: 'postgres://<read-only role>:<password>@localhost:5432/<dev_db>',
    prod: 'postgres://<read-only role>:<password>@localhost:5432/<prod_db>',
  },
  {
    name: 'PORT',
    status: 'runtime-set',
    phase: 'runtime',
    summary: 'Listen port. Set by the pm2 ecosystem entry (prod 7101, dev 3101); only used directly by `pnpm dev`.',
    dev: '3101',
    prod: '7101',
  },
  {
    name: 'NODE_ENV',
    status: 'runtime-set',
    phase: 'runtime',
    summary: 'Set to `production` by the pm2 entry and by `next build`/`next start`. Do not set it in the env file.',
    dev: 'production',
    prod: 'production',
  },
  {
    name: 'NEXT_RUNTIME',
    status: 'runtime-set',
    phase: 'runtime',
    summary: 'Injected by Next.js; instrumentation.ts only bootstraps the signing key when it is `nodejs`. Never set by hand.',
    dev: '(set by Next.js)',
    prod: '(set by Next.js)',
  },
  {
    name: 'NEXT_PUBLIC_BASE_PATH',
    status: 'runtime-set',
    phase: 'build',
    summary: 'Reverse-proxy path prefix (`/dykil`). Set by next.config.js at build time — not an env-file value. The Caddy route forwards the prefix intact.',
    dev: '/dykil',
    prod: '/dykil',
  },
  {
    name: 'NEXT_PUBLIC_SERVICE_PREFIX',
    status: 'optional',
    phase: 'build',
    summary: 'Read by @ima-jin/config to derive service URLs. dykil takes every service URL from its own env vars; leave unset.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'NEXT_PUBLIC_DOMAIN',
    status: 'optional',
    phase: 'build',
    summary: 'Companion to NEXT_PUBLIC_SERVICE_PREFIX (default imajin.ai). Leave unset.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'LOG_LEVEL',
    status: 'optional',
    phase: 'runtime',
    summary: 'pino log level for @ima-jin/logger (default info). Output is stdout only; pm2 captures it.',
    dev: 'debug',
    prod: 'info',
  },
  {
    name: 'ENABLE_REQUEST_LOG',
    status: 'optional',
    phase: 'runtime',
    summary: 'Logger request-log switch. Leave unset: this app wires no log sink (AGENTS.md — stdout only).',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'ENABLE_APP_LOG',
    status: 'optional',
    phase: 'runtime',
    summary: 'Logger persisted-log switch. Leave unset: this app never persists logs to a database.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'LOG_DB_TRANSPORT',
    status: 'optional',
    phase: 'runtime',
    summary: 'Logger DB-transport switch. Leave unset: logging must never touch a data store (AGENTS.md).',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'APP_LOG_LEVEL',
    status: 'optional',
    phase: 'runtime',
    summary: 'Minimum level the logger would persist (default warn). Inert while persistence is off.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'ATTESTATION_INTERNAL_API_KEY',
    status: 'dependency',
    phase: 'runtime',
    secret: true,
    summary: '@ima-jin/auth act-as / attestation calls. dykil exercises neither; leave unset. Never hand-mint it.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'AUTH_INTERNAL_API_KEY',
    status: 'dependency',
    phase: 'runtime',
    secret: true,
    summary: 'Deprecated @ima-jin/auth internal key (agent delegation). Not used by dykil; leave unset.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'PROFILE_SERVICE_URL',
    status: 'dependency',
    phase: 'runtime',
    summary: '@ima-jin/auth credential resolution. Not used by dykil; leave unset.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'PROFILE_INTERNAL_API_KEY',
    status: 'dependency',
    phase: 'runtime',
    secret: true,
    summary: '@ima-jin/auth credential resolution key. Not used by dykil; leave unset.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'NODE_DID',
    status: 'dependency',
    phase: 'runtime',
    summary: '@ima-jin/auth node-act-as check (kernel node DID). Not used by dykil; leave unset.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'APP_URL',
    status: 'dependency',
    phase: 'runtime',
    summary: '@ima-jin/auth fallback origin for redirects. dykil does not rely on it; leave unset.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'NEXT_PUBLIC_BASE_URL',
    status: 'dependency',
    phase: 'runtime',
    summary: '@ima-jin/auth fallback origin for redirects (after APP_URL). dykil does not rely on it; leave unset.',
    dev: '(unset)',
    prod: '(unset)',
  },
  {
    name: 'NEXT_PUBLIC_IMAJIN_APP_ID',
    status: 'template-unused',
    phase: 'build',
    summary: 'Listed in the app template (registry `app_…` id); no code in this repo reads it. Safe to omit.',
    dev: '(optional)',
    prod: '(optional)',
  },
  {
    name: 'SESSION_COOKIE_SCOPE',
    status: 'template-unused',
    phase: 'runtime',
    summary: 'Listed in the app template; no code in this repo reads it. Safe to omit.',
    dev: 'host',
    prod: 'host',
  },
];

export const ENV_VAR_NAMES = ENV_VARS.map((v) => v.name);

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.');
}

function checkKernelUrl(name, value, target, errors) {
  const url = parseUrl(value);
  if (url === null || !/^https?:$/.test(url.protocol)) {
    errors.push(`${name} is not a valid http(s) URL.`);
    return;
  }
  if (isLocalHost(url.hostname)) {
    errors.push(`${name} points at localhost — a deployed ${target} instance must use the real kernel host.`);
    return;
  }
  const isDevHost = url.hostname.startsWith('dev-');
  if (target === 'prod' && isDevHost) {
    errors.push(`${name} points at a dev host (${url.hostname}) in a prod env file.`);
  }
  if (target === 'dev' && !isDevHost) {
    errors.push(`${name} points at a non-dev host (${url.hostname}) in a dev env file — dev must never talk to the prod kernel.`);
  }
}

function checkPathSuffix(name, value, suffix, errors) {
  if (!value.endsWith(suffix) && !value.endsWith(`${suffix}/`)) {
    errors.push(`${name} must include the ${suffix} prefix.`);
  }
}

function checkRequiredAndForbidden(get, errors) {
  for (const variable of ENV_VARS) {
    if (variable.status === 'required' && get(variable.name) === '') {
      errors.push(`${variable.name} is required but not set.`);
    }
    if (variable.status === 'forbidden' && get(variable.name) !== '') {
      errors.push(`${variable.name} must not be set (${variable.summary})`);
    }
  }
}

function checkKernelUrls(get, target, errors) {
  const authUrl = get('AUTH_SERVICE_URL');
  if (authUrl !== '') {
    checkKernelUrl('AUTH_SERVICE_URL', authUrl, target, errors);
    checkPathSuffix('AUTH_SERVICE_URL', authUrl, '/auth', errors);
  }
  const mediaUrl = get('MEDIA_SERVICE_URL');
  if (mediaUrl !== '') {
    checkKernelUrl('MEDIA_SERVICE_URL', mediaUrl, target, errors);
    checkPathSuffix('MEDIA_SERVICE_URL', mediaUrl, '/media', errors);
  }
  const eventsUrl = get('EVENTS_SERVICE_URL');
  if (eventsUrl !== '') {
    checkKernelUrl('EVENTS_SERVICE_URL', eventsUrl, target, errors);
    checkPathSuffix('EVENTS_SERVICE_URL', eventsUrl, '/events', errors);
  }
  for (const name of ['IMAJIN_KERNEL_URL', 'NEXT_PUBLIC_IMAJIN_AUTH_URL', 'NEXT_PUBLIC_APP_URL']) {
    if (get(name) !== '') checkKernelUrl(name, get(name), target, errors);
  }
  const kernelHost = parseUrl(get('IMAJIN_KERNEL_URL'))?.host;
  const publicHost = parseUrl(get('NEXT_PUBLIC_IMAJIN_AUTH_URL'))?.host;
  if (kernelHost !== undefined && publicHost !== undefined && kernelHost !== publicHost) {
    errors.push('IMAJIN_KERNEL_URL and NEXT_PUBLIC_IMAJIN_AUTH_URL must point at the same kernel host.');
  }
}

function checkIdentity(get, target, errors) {
  const did = get('IMAJIN_APP_DID');
  if (did !== '' && !did.startsWith('did:imajin:')) {
    errors.push('IMAJIN_APP_DID must start with did:imajin:.');
  }
  if (did.includes('REPLACE_ME')) {
    errors.push('IMAJIN_APP_DID is still the REPLACE_ME placeholder — mint the app identity first (docs/REGISTRATION.md).');
  }

  const imajinEnv = get('IMAJIN_ENV');
  if (target === 'dev' && imajinEnv !== 'dev') {
    errors.push('IMAJIN_ENV must be `dev` on the dev instance (selects the imajin_session_dev cookie).');
  }
  if (target === 'prod' && imajinEnv === 'dev') {
    errors.push('IMAJIN_ENV=dev must not be set on prod (it would read the dev session cookie).');
  }
}

function checkLegacyDatabase(get, errors) {
  const legacyUrl = get('LEGACY_DATABASE_URL');
  if (legacyUrl !== '' && !/^postgres(ql)?:$/.test(parseUrl(legacyUrl)?.protocol ?? '')) {
    errors.push('LEGACY_DATABASE_URL must be a postgres:// or postgresql:// URL.');
  }
}

function collectWarnings(get, target) {
  const warnings = [];
  const port = get('PORT');
  if (port !== '' && port !== String(TARGETS[target].port)) {
    warnings.push(`PORT is set in the env file but ${TARGETS[target].name} runs on ${TARGETS[target].port}; the pm2 entry's value wins.`);
  }
  if (get('IMAJIN_APP_CLAIM_CODE') !== '') {
    warnings.push('IMAJIN_APP_CLAIM_CODE is set — it is needed on the first boot only; remove it once the app has booted once.');
  }
  const keystore = get('IMAJIN_APP_KEYSTORE');
  if (keystore === '') {
    warnings.push('IMAJIN_APP_KEYSTORE is unset — the keystore will live inside the checkout; set an absolute per-environment path that survives deploys.');
  } else if (!keystore.startsWith('/')) {
    warnings.push('IMAJIN_APP_KEYSTORE is a relative path — it resolves against the process cwd; use an absolute path.');
  }
  if (get('LEGACY_DATABASE_URL') === '') {
    warnings.push('LEGACY_DATABASE_URL is unset — the legacy baseline (deploy step 6) will be skipped.');
  }
  for (const name of ['ENABLE_APP_LOG', 'LOG_DB_TRANSPORT', 'ENABLE_REQUEST_LOG']) {
    if (get(name) === 'true') {
      warnings.push(`${name}=true — this app is stdout-logging only (AGENTS.md); leave it unset.`);
    }
  }
  return warnings;
}

/**
 * Pure validation of a parsed env file for a deploy target. Returns
 * `{ errors, warnings }`; messages name variables, never values.
 * @param {Record<string, string | undefined>} env
 * @param {'prod' | 'dev'} target
 */
export function validateEnv(env, target) {
  if (!(target in TARGETS)) {
    throw new Error(`Unknown target ${JSON.stringify(target)} — expected prod or dev.`);
  }
  const errors = [];
  const get = (name) => (env[name] ?? '').trim();

  checkRequiredAndForbidden(get, errors);
  checkKernelUrls(get, target, errors);
  checkIdentity(get, target, errors);
  checkLegacyDatabase(get, errors);

  return { errors, warnings: collectWarnings(get, target) };
}

/**
 * Reads and parses an env file WITHOUT touching process.env.
 * @param {string} path
 */
export function readEnvFile(path) {
  return parseEnv(readFileSync(path, 'utf8'));
}
