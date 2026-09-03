import type { HealthSnapshotPayload, NormalizedAlertPayload } from "@cts-dc-opsdesk/shared-types";
import type { SnmpTrap } from "@cts-dc-opsdesk/snmp-adapter";

/** Just the bits of `fetch` this client uses — lets tests inject a fake.
 *  `dispatcher` is undici's client-cert hook, ignored by fakes. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    dispatcher?: unknown;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class OpsDeskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "OpsDeskApiError";
  }
}

export interface OpsDeskClientOptions {
  baseUrl: string;
  token: string;
  /** Defaults to the global `fetch` (Node 18+). */
  fetchImpl?: FetchLike;
  /** undici Agent presenting the client cert (mTLS, ADR-004). */
  dispatcher?: unknown;
}

/**
 * The collector's only door to the central platform: outbound HTTPS, bearer
 * token, idempotent posts (payloads carry stable ids). No inbound anything
 * (ADR-004). One instance per collector.
 */
export class OpsDeskClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly dispatcher: unknown;

  constructor(opts: OpsDeskClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.dispatcher = opts.dispatcher;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    if (!this.fetchImpl) {
      throw new Error("no fetch implementation available (Node >= 18 or pass fetchImpl)");
    }
  }

  /** Batch of parsed SNMP traps -> POST /alerts/sources/snmp. */
  ingestSnmpTraps(traps: SnmpTrap[]): Promise<unknown> {
    return this.post("/alerts/sources/snmp", { traps });
  }

  /** One already-normalized alert -> POST /alerts/ingest. */
  ingestAlert(alert: NormalizedAlertPayload): Promise<unknown> {
    return this.post("/alerts/ingest", alert);
  }

  /** Batch of normalized hardware health snapshots -> POST /monitoring/health-snapshots. */
  ingestHealthSnapshots(snapshots: HealthSnapshotPayload[]): Promise<unknown> {
    return this.post("/monitoring/health-snapshots", { snapshots });
  }

  /** Liveness ping (spec §26) — sent directly, not buffered, since a stale
   *  heartbeat replayed after a long outage carries no signal. */
  heartbeat(siteCode: string): Promise<unknown> {
    return this.post("/monitoring/collector-heartbeat", { siteCode });
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
      ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new OpsDeskApiError(`POST ${path} -> ${res.status}`, res.status, text);
    }
    return text ? JSON.parse(text) : undefined;
  }
}
