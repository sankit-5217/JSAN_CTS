/**
 * Minimal JSON-RPC client for the Zabbix 7.x API. No I/O beyond the one HTTP
 * call per request and no state — the caller passes the endpoint, token and
 * timeout (they live in the ZabbixConnection row, not in code).
 */

export interface ZabbixEndpoint {
  url: string;
  /** API token; omitted for methods Zabbix requires to be called anonymously. */
  token?: string;
  timeoutMs: number;
}

export type ZabbixErrorKind = "NETWORK" | "TIMEOUT" | "HTTP" | "API" | "BAD_RESPONSE";

export class ZabbixApiError extends Error {
  constructor(
    readonly kind: ZabbixErrorKind,
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = "ZabbixApiError";
  }
}

// Zabbix rejects these when an Authorization header is present.
const ANONYMOUS_METHODS = new Set(["apiinfo.version", "user.login"]);

type FetchFn = typeof fetch;

export async function callZabbix<T>(
  endpoint: ZabbixEndpoint,
  method: string,
  params: unknown,
  fetchFn: FetchFn = fetch,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json-rpc" };
  if (endpoint.token && !ANONYMOUS_METHODS.has(method)) {
    headers.Authorization = `Bearer ${endpoint.token}`;
  }

  let res: Response;
  try {
    res = await fetchFn(endpoint.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: AbortSignal.timeout(endpoint.timeoutMs),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new ZabbixApiError(
        "TIMEOUT",
        `Zabbix did not answer within ${endpoint.timeoutMs} ms`,
        method,
      );
    }
    const cause = (e as Error & { cause?: { code?: string } }).cause?.code;
    throw new ZabbixApiError(
      "NETWORK",
      `Cannot reach Zabbix at ${endpoint.url}${cause ? ` (${cause})` : ""}`,
      method,
    );
  }

  if (!res.ok) {
    throw new ZabbixApiError("HTTP", `Zabbix answered HTTP ${res.status}`, method);
  }

  let body: { result?: T; error?: { code: number; message: string; data?: string } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new ZabbixApiError(
      "BAD_RESPONSE",
      "Zabbix answered with something that is not JSON — is the URL pointing at api_jsonrpc.php?",
      method,
    );
  }
  if (body.error) {
    const detail = [body.error.message, body.error.data].filter(Boolean).join(" ");
    throw new ZabbixApiError("API", detail || "Zabbix returned an error", method);
  }
  if (body.result === undefined) {
    throw new ZabbixApiError("BAD_RESPONSE", "Zabbix response has no result", method);
  }
  return body.result;
}

/** "http://host/zabbix/api_jsonrpc.php" → "http://host/zabbix/" (for "open in Zabbix" links). */
export function zabbixWebBaseUrl(apiUrl: string): string {
  return apiUrl.replace(/api_jsonrpc\.php\/?$/, "");
}
