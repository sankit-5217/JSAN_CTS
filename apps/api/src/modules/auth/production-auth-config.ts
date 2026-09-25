/**
 * Refuse-to-start checks for the auth configuration in production (spec
 * §17: no weak secrets, TLS for all central traffic). The code keeps
 * convenient dev defaults (JWT_SECRET falls back to "change-me-dev-only",
 * the dev realm's client secret is "change-me"); in production any of those
 * would let someone forge a session, so main.ts runs this before listening
 * and exits on errors.
 */

/** Values that ship in this repo or are common placeholders — never valid in production. */
const KNOWN_WEAK_SECRETS = new Set([
  "change-me-dev-only",
  "change-me",
  "changeme",
  "secret",
  "password",
  "jwt-secret",
]);
const MIN_JWT_SECRET_LENGTH = 32;

export interface AuthConfigProblems {
  /** Unsafe to run: the API must not start. */
  errors: string[];
  /** Runs, but probably not what you want. */
  warnings: string[];
}

type Env = Record<string, string | undefined>;

export function findProductionAuthConfigProblems(env: Env): AuthConfigProblems {
  const errors: string[] = [];
  const warnings: string[] = [];

  const jwtSecret = env.JWT_SECRET ?? "";
  if (!jwtSecret) {
    errors.push(
      "JWT_SECRET is not set — the API would sign sessions with the public dev default, so anyone could forge a login token",
    );
  } else if (KNOWN_WEAK_SECRETS.has(jwtSecret.toLowerCase())) {
    errors.push("JWT_SECRET is a known placeholder value — generate a random one");
  } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(
      `JWT_SECRET is ${jwtSecret.length} characters — use at least ${MIN_JWT_SECRET_LENGTH} random characters`,
    );
  }

  if (env.OIDC_ENABLED !== "true") {
    warnings.push(
      "OIDC_ENABLED is not true — dev-login is off in production, so no person can sign in (service tokens still work)",
    );
    return { errors, warnings };
  }

  const clientSecret = env.OIDC_CLIENT_SECRET ?? "";
  if (KNOWN_WEAK_SECRETS.has(clientSecret.toLowerCase())) {
    errors.push(
      "OIDC_CLIENT_SECRET is a known placeholder (the dev realm's value) — use the secret from your production IdP",
    );
  } else if (!clientSecret) {
    warnings.push(
      "OIDC_CLIENT_SECRET is empty — the API will act as a public OIDC client; a confidential client is recommended",
    );
  }

  for (const key of ["OIDC_ISSUER_URL", "OIDC_REDIRECT_URI", "WEB_APP_URL"] as const) {
    const value = env[key] ?? "";
    if (!value) {
      errors.push(`${key} is not set`);
    } else if (!value.startsWith("https://")) {
      errors.push(`${key} must use https:// in production (got ${value})`);
    } else if (/^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(value)) {
      errors.push(`${key} points at localhost (${value}) — use the real production address`);
    }
  }

  return { errors, warnings };
}
