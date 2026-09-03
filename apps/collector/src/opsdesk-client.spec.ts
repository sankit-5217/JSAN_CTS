import type { NormalizedAlertPayload } from "@cts-dc-opsdesk/shared-types";
import { OpsDeskApiError, OpsDeskClient } from "./opsdesk-client";
import type { FetchLike } from "./opsdesk-client";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(responder: (call: Call) => { ok: boolean; status: number; text: string }): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init.method,
      headers: init.headers,
      body: JSON.parse(init.body),
    };
    calls.push(call);
    const r = responder(call);
    return { ok: r.ok, status: r.status, text: async () => r.text };
  };
  return { fetchImpl, calls };
}

const ALERT: NormalizedAlertPayload = {
  eventId: "e1",
  source: "REDFISH",
  siteCode: "SITE01",
  ciCode: "SITE01-R01-SRV-040",
  alertType: "disk.predictive_failure",
  severity: "HIGH",
  occurredAt: "2026-09-03T10:00:00.000Z",
  state: "OPEN",
  summary: "predicted failure",
};

describe("OpsDeskClient", () => {
  it("POSTs SNMP traps to /alerts/sources/snmp with a bearer token", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      ok: true,
      status: 200,
      text: '{"accepted":[]}',
    }));
    const client = new OpsDeskClient({
      baseUrl: "https://opsdesk.example/api/v1/",
      token: "svc-1",
      fetchImpl,
    });

    const res = await client.ingestSnmpTraps([
      { ciCode: "SITE01-R03-SW-002", agentAddress: "10.20.3.2", trapOid: "1.3.6.1.6.3.1.1.5.3" },
    ]);

    expect(res).toEqual({ accepted: [] });
    expect(calls[0].url).toBe("https://opsdesk.example/api/v1/alerts/sources/snmp");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.authorization).toBe("Bearer svc-1");
    expect(calls[0].body).toEqual({
      traps: [
        { ciCode: "SITE01-R03-SW-002", agentAddress: "10.20.3.2", trapOid: "1.3.6.1.6.3.1.1.5.3" },
      ],
    });
  });

  it("POSTs a normalized alert to /alerts/ingest", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ ok: true, status: 200, text: "" }));
    const client = new OpsDeskClient({ baseUrl: "https://x/api/v1", token: "t", fetchImpl });

    await client.ingestAlert(ALERT);

    expect(calls[0].url).toBe("https://x/api/v1/alerts/ingest");
    expect(calls[0].body).toMatchObject({ eventId: "e1", source: "REDFISH" });
  });

  it("throws OpsDeskApiError on a non-2xx response", async () => {
    const { fetchImpl } = fakeFetch(() => ({ ok: false, status: 403, text: "Forbidden" }));
    const client = new OpsDeskClient({ baseUrl: "https://x/api/v1", token: "t", fetchImpl });

    try {
      await client.ingestAlert(ALERT);
      throw new Error("expected ingestAlert to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OpsDeskApiError);
      expect((err as OpsDeskApiError).status).toBe(403);
      expect((err as OpsDeskApiError).body).toBe("Forbidden");
    }
  });
});
