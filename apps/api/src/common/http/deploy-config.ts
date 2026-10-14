/**
 * How the API binds and who may call it, read from the environment so the
 * same build runs locally and on Railway.
 */
type Env = Record<string, string | undefined>;

/** Railway (and most PaaS) assign PORT; API_PORT stays for local setups. */
export function listenPort(env: Env): number {
  const raw = env.PORT ?? env.API_PORT;
  const port = raw ? Number(raw) : 3000;
  return Number.isInteger(port) && port > 0 ? port : 3000;
}

/**
 * Browser origins allowed by CORS. API_CORS_ORIGIN is a comma-separated
 * list; without it, production allows only WEB_APP_URL. Null means "any
 * origin" — local development only.
 */
export function allowedCorsOrigins(env: Env): string[] | null {
  const listed = (env.API_CORS_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (listed.length > 0) return listed;
  if (env.NODE_ENV === "production") {
    const web = env.WEB_APP_URL?.trim().replace(/\/+$/, "");
    return web ? [web] : [];
  }
  return null;
}

/** /api/docs: always on locally, off in production unless API_DOCS_ENABLED=true. */
export function apiDocsEnabled(env: Env): boolean {
  if (env.API_DOCS_ENABLED !== undefined) return env.API_DOCS_ENABLED === "true";
  return env.NODE_ENV !== "production";
}
