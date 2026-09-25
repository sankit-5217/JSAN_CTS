/**
 * Refuse-to-start checks for the auth configuration in production (spec
 * §17: no weak secrets, TLS for all central traffic). The code keeps
 * convenient dev defaults (JWT_SECRET falls back to "change-me-dev-only",
 * URLs default to localhost); in production those would let someone forge a
 * session or send sign-in links over plain http, so main.ts runs this
 * before listening and exits on errors.
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

const PROVIDER_SECRETS = [
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_SECRET",
  "GITHUB_CLIENT_SECRET",
];

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

  // WEB_APP_URL goes into every invite/reset email; API_PUBLIC_URL is where
  // Google/Microsoft/GitHub send people back to. Both must be real https.
  for (const key of ["WEB_APP_URL", "API_PUBLIC_URL"] as const) {
    const value = env[key] ?? "";
    if (!value) {
      errors.push(`${key} is not set`);
    } else if (!value.startsWith("https://")) {
      errors.push(`${key} must use https:// in production (got ${value})`);
    } else if (/^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(value)) {
      errors.push(`${key} points at localhost (${value}) — use the real production address`);
    }
  }

  for (const key of PROVIDER_SECRETS) {
    const value = env[key];
    if (value && KNOWN_WEAK_SECRETS.has(value.toLowerCase())) {
      errors.push(`${key} is a placeholder — use the secret from the provider's developer console`);
    }
  }

  if (!env.REDIS_URL) {
    warnings.push(
      "REDIS_URL is not set — invite and password-reset emails can't be queued; admins must copy links by hand",
    );
  }

  return { errors, warnings };
}
