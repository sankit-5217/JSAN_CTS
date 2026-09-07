import type { Credential } from "./credentials";

/** Minimal `fetch` surface for management-endpoint GETs — lets tests inject a fake. */
export type MgmtFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; dispatcher?: unknown },
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
export interface MgmtHttpOptions {
  fetchImpl?: MgmtFetch;
  /** undici Agent — set for self-signed BMC certs (`rejectUnauthorized: false`). */
  dispatcher?: unknown;
}

export class MgmtHttp {
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly authHeader: string;
  private readonly fetchImpl: MgmtFetch;
  private readonly dispatcher: unknown;

  constructor(baseUrl: string, credential: Credential, opts: MgmtHttpOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.origin = new URL(this.baseUrl).origin;
    this.authHeader = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`;
    this.dispatcher = opts.dispatcher;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as MgmtFetch);
    if (!this.fetchImpl) {
      throw new Error("no fetch implementation available (Node >= 18 or pass fetchImpl)");
    }
  }

  /**
   * Resolve a request path against `baseUrl` and refuse anything that leaves
   * the endpoint's origin. Redfish/OME responses are HATEOAS — the fetchers
   * follow `@odata.id` links straight from the device's JSON — so a spoofed or
   * compromised BMC could return an absolute URL and harvest the Basic-auth
   * credential (or use the collector as an SSRF pivot on the management LAN).
   */
  private resolve(path: string): string {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    if (new URL(url).origin !== this.origin) {
      throw new Error(
        `MgmtHttp refuses cross-origin URL "${url}" (endpoint origin ${this.origin})`,
      );
    }
    return url;
  }

  /** GET `path`, parse JSON. Throws {@link MgmtHttpError} on a non-2xx response. */
  async get<T = unknown>(path: string): Promise<T> {
    const url = this.resolve(path);
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", authorization: this.authHeader },
      ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
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
