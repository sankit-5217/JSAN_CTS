import { WorkerApiClient, WorkerApiError } from "../api-client";
import type { FetchLike } from "../api-client";
import { processWarrantySyncJob, WARRANTY_SYNC_QUEUE_NAME } from "./warranty-sync.queue";

function fakeFetch(response: { ok: boolean; status: number; body: string }) {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: response.ok, status: response.status, text: async () => response.body };
  };
  return { calls, fetchImpl };
}

const OK_SUMMARY = JSON.stringify({
  checked: 3,
  updated: 1,
  unchanged: 2,
  skipped: [],
  failed: [{ ciCode: "CI-9", reason: 'no warranty provider for "Supermicro"' }],
});

describe("warranty-sync queue", () => {
  it("has a stable queue name", () => {
    expect(WARRANTY_SYNC_QUEUE_NAME).toBe("warranty-sync");
  });

  describe("processWarrantySyncJob", () => {
    it("POSTs to /vendors/warranty-sync with the bearer token and returns the summary", async () => {
      const { calls, fetchImpl } = fakeFetch({ ok: true, status: 201, body: OK_SUMMARY });
      const client = new WorkerApiClient({
        baseUrl: "https://api.example/api/v1/",
        token: "svc-tok",
        fetchImpl,
      });

      const summary = await processWarrantySyncJob(client);

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.example/api/v1/vendors/warranty-sync");
      expect(calls[0].init.method).toBe("POST");
      expect(calls[0].init.headers.authorization).toBe("Bearer svc-tok");
      expect(summary).toEqual(expect.objectContaining({ checked: 3, updated: 1, unchanged: 2 }));
    });

    it("throws WorkerApiError on a non-2xx so BullMQ retries the job", async () => {
      const { fetchImpl } = fakeFetch({ ok: false, status: 503, body: "upstream down" });
      const client = new WorkerApiClient({ baseUrl: "https://api.example", token: "t", fetchImpl });

      await expect(processWarrantySyncJob(client)).rejects.toBeInstanceOf(WorkerApiError);
    });
  });
});
