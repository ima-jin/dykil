/**
 * The two scopes this app's routes ask of a scoped app-token. Read routes
 * (`GET`) require `dykil:read`; mutating routes (survey create/update/delete,
 * respond, withdraw a response) require `dykil:write`. As with every
 * `requireSessionOrAppToken` adopter, scopes are enforced only on the token
 * path — the shared session cookie predates scoped grants.
 */
export const DYKIL_READ_SCOPE = 'dykil:read';
export const DYKIL_WRITE_SCOPE = 'dykil:write';
