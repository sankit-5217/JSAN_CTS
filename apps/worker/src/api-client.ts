/** Just the bits of `fetch` this client uses — lets tests inject a fake. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class WorkerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "WorkerApiError";
  }
}

export interface WorkerApiClientOptions {
  baseUrl: string;
  token: string;
  /** Defaults to the global `fetch` (Node 18+). */
  fetchImpl?: FetchLike;
}

/**
 * The worker's outbound door to the API for scheduled jobs that must run
 * through a domain module's own service and authorization — the worker owns
 * the schedule, the module owns the work and its data (CLAUDE.md: modules talk
 * through service interfaces, backend owns authorization). The bearer token
 * resolves to an active user holding the role the endpoint requires, the same
 * contract the site collector uses.
 */
export class WorkerApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: WorkerApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    if (!this.fetchImpl) {
      throw new Error("no fetch implementation available (Node >= 18 or pass fetchImpl)");
    }
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new WorkerApiError(`POST ${path} -> ${res.status}`, res.status, text);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
