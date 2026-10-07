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
import envVars from './env-vars.json' with { type: 'json' };

export const TARGETS = {
  prod: { name: 'prod-dykil', port: 7101 },
  dev: { name: 'dev-dykil', port: 3101 },
};

export const BASE_PATH = '/dykil';

/**
 * The variables themselves live in env-vars.json (data, not code). Fields:
 * status:
 *   required         must be set in the env file for a deployed instance
 *   first-boot       only for the advanced/CI claim path, then removed
 *   optional         read, has a safe default (or a documented degraded mode) when unset
 *   forbidden        must NOT be set (the app refuses to boot if it is)
 *   runtime-set      injected by Next.js / pm2 / next.config.mjs — not set in the env file
 *   dependency       read by an @ima-jin/* dependency on a code path dykil
 *                    does not exercise; leave unset
 *   template-unused  present in the app template's .env.example but not read
 *                    by any code in this repo; safe to omit
 * phase: 'build' = baked into the build (set before `next build`),
 *        'runtime' = read at process start / request time,
 *        'script' = read only by an operator/CI script.
 */
export const ENV_VARS = envVars;

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
