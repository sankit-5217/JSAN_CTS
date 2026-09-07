import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HealthSnapshotPayload, NormalizedAlertPayload } from "@cts-dc-opsdesk/shared-types";
import type { SnmpTrap } from "@cts-dc-opsdesk/snmp-adapter";
import type { BufferedItem } from "./delivery-buffer";
import { FileDeliveryBuffer } from "./file-delivery-buffer";
import { OpsDeskClient } from "./opsdesk-client";
import type { FetchLike } from "./opsdesk-client";

/**
 * Backup/restore drill (Sprint 12): prove the two halves of ADR-004's
 * "buffer locally on disconnect, upload idempotently on reconnect" compose —
 * FileDeliveryBuffer + OpsDeskClient + the channel switch from index.ts —
 * across a full outage → collector restart → recovery cycle. The piece specs
 * cover each half in isolation with a fake `send`; this covers them together
 * through the real client.
 */

/** Endpoint whose availability we flip mid-test; records the calls it accepts. */
function flappingEndpoint() {
  const state = { up: true };
  const calls: Array<{ path: string; body: unknown }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    if (!state.up) {
      return { ok: false, status: 503, text: async () => "service unavailable" };
    }
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => "{}" };
  };
  return { state, calls, fetchImpl };
}

/** The same dispatch index.ts uses to turn a buffered item back into a call. */
function makeSend(client: OpsDeskClient) {
  return async (item: BufferedItem): Promise<void> => {
    switch (item.channel) {
      case "snmp":
        await client.ingestSnmpTraps([item.payload as SnmpTrap]);
        return;
      case "alert":
        await client.ingestAlert(item.payload as NormalizedAlertPayload);
        return;
      case "health":
        await client.ingestHealthSnapshots([item.payload as HealthSnapshotPayload]);
        return;
      default:
        throw new Error(`unknown channel ${item.channel}`);
    }
  };
}

const SNMP = {
  key: "snmp:10.0.0.1:linkDown:42",
  channel: "snmp",
  payload: { agentAddress: "10.0.0.1" },
};
const ALERT = {
  key: "alert:redfish:CI-1:psu",
  channel: "alert",
  payload: { eventId: "e1", ciCode: "CI-1" },
};
const HEALTH = {
  key: "health:CI-1:2026-09-07T00:00:00Z",
  channel: "health",
  payload: { ciCode: "CI-1" },
};

describe("delivery drill: outage → restart → recovery", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "collector-drill-"));
    path = join(dir, "buffer.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("holds every channel through an outage, survives a restart, drains oldest-first on reconnect", async () => {
    const api = flappingEndpoint();
    const client = new OpsDeskClient({
      baseUrl: "https://ops.example/api/v1",
      token: "svc",
      fetchImpl: api.fetchImpl,
    });

    // --- outage: API unreachable ---
    api.state.up = false;
    const buffer = new FileDeliveryBuffer(path, 500);
    buffer.enqueue(SNMP);
    buffer.enqueue(ALERT);
    buffer.enqueue(HEALTH);

    const duringOutage = await buffer.flush(makeSend(client));
    expect(duringOutage).toEqual({ delivered: 0, remaining: 3 });
    expect(api.calls).toHaveLength(0);
    // persisted for the restart
    expect(JSON.parse(readFileSync(path, "utf8")).map((i: BufferedItem) => i.key)).toEqual([
      SNMP.key,
      ALERT.key,
      HEALTH.key,
    ]);

    // --- collector restarts: fresh buffer on the same file ---
    const afterRestart = new FileDeliveryBuffer(path, 500);
    expect(afterRestart.size).toBe(3);

    // --- reconnect ---
    api.state.up = true;
    const onReconnect = await afterRestart.flush(makeSend(client));
    expect(onReconnect).toEqual({ delivered: 3, remaining: 0 });
    expect(api.calls.map((c) => c.path)).toEqual([
      "/api/v1/alerts/sources/snmp",
      "/api/v1/alerts/ingest",
      "/api/v1/monitoring/health-snapshots",
    ]);
    // nothing left, on disk or in a reopened buffer
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([]);
    expect(new FileDeliveryBuffer(path, 500).size).toBe(0);
  });

  it("stops at the item that fails when the API drops again mid-flush, keeping order", async () => {
    const api = flappingEndpoint();
    const client = new OpsDeskClient({
      baseUrl: "https://ops.example",
      token: "svc",
      fetchImpl: api.fetchImpl,
    });
    const buffer = new FileDeliveryBuffer(path, 500);
    buffer.enqueue(SNMP);
    buffer.enqueue(ALERT);
    buffer.enqueue(HEALTH);

    // API up for the first item, then drops
    let served = 0;
    const original = api.fetchImpl;
    const client2 = new OpsDeskClient({
      baseUrl: "https://ops.example",
      token: "svc",
      fetchImpl: async (url, init) => {
        if (served >= 1) return { ok: false, status: 503, text: async () => "down again" };
        served += 1;
        return original(url, init);
      },
    });

    const first = await buffer.flush(makeSend(client2));
    expect(first).toEqual({ delivered: 1, remaining: 2 });
    expect(JSON.parse(readFileSync(path, "utf8")).map((i: BufferedItem) => i.key)).toEqual([
      ALERT.key,
      HEALTH.key,
    ]);

    // API fully back — the rest drain, still in order
    const rest = await buffer.flush(makeSend(client));
    expect(rest).toEqual({ delivered: 2, remaining: 0 });
    expect(api.calls.map((c) => c.path)).toEqual([
      "/alerts/sources/snmp",
      "/alerts/ingest",
      "/monitoring/health-snapshots",
    ]);
  });
});
