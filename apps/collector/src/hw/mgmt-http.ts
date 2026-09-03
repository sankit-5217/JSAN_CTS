import type { Credential } from "./credentials";

/** Minimal `fetch` surface for management-endpoint GETs — lets tests inject a fake. */
export type MgmtFetch = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class MgmtHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MgmtHttpError";
  }
}

/**
 * Read-only HTTP client for a single management endpoint (Redfish / OME / iLO).
 * GET only — the collector never PATCHes or invokes `Actions`
 * (CLAUDE.md "no destructive hardware actions in v1"). Basic auth; a session /
 * token flow (OME `X-Auth-Token`) layers on later behind the same `get()`.
 */
export class MgmtHttp {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: MgmtFetch;

  constructor(baseUrl: string, credential: Credential, fetchImpl?: MgmtFetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.authHeader = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`;
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as MgmtFetch);
    if (!this.fetchImpl) {
      throw new Error("no fetch implementation available (Node >= 18 or pass fetchImpl)");
    }
  }

  /** GET `path`, parse JSON. Throws {@link MgmtHttpError} on a non-2xx response. */
  async get<T = unknown>(path: string): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", authorization: this.authHeader },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new MgmtHttpError(`GET ${path} -> ${res.status}`, res.status);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Like {@link get} but returns `undefined` instead of throwing on 404. */
  async tryGet<T = unknown>(path: string): Promise<T | undefined> {
    try {
      return await this.get<T>(path);
    } catch (err) {
      if (err instanceof MgmtHttpError && err.status === 404) {
        return undefined;
      }
      throw err;
    }
  }
}
