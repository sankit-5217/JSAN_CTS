import { WorkerApiClient, WorkerApiError } from "./api-client";
import type { FetchLike } from "./api-client";

function fakeFetch(response: { ok: boolean; status: number; body: string }) {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: response.ok, status: response.status, text: async () => response.body };
  };
  return { calls, fetchImpl };
}

describe("WorkerApiClient", () => {
  describe("post", () => {
    it("sends the bearer token, a JSON content-type and a serialized body", async () => {
      const { calls, fetchImpl } = fakeFetch({ ok: true, status: 201, body: "{}" });
      const client = new WorkerApiClient({
        baseUrl: "https://api.example/api/v1",
        token: "svc-tok",
        fetchImpl,
      });

      await client.post("/vendors/warranty-sync", { ciIds: ["a", "b"] });

      expect(calls).toHaveLength(1);
      expect(calls[0].init.method).toBe("POST");
      expect(calls[0].init.headers.authorization).toBe("Bearer svc-tok");
      expect(calls[0].init.headers["content-type"]).toBe("application/json");
      expect(calls[0].init.body).toBe(JSON.stringify({ ciIds: ["a", "b"] }));
    });

    it("defaults an omitted body to an empty JSON object", async () => {
      const { calls, fetchImpl } = fakeFetch({ ok: true, status: 200, body: "{}" });
      const client = new WorkerApiClient({ baseUrl: "https://api.example", token: "t", fetchImpl });

      await client.post("/ping");

      expect(calls[0].init.body).toBe("{}");
    });

    it("strips trailing slashes from baseUrl so the path is not doubled", async () => {
      const { calls, fetchImpl } = fakeFetch({ ok: true, status: 200, body: "{}" });
      const client = new WorkerApiClient({
        baseUrl: "https://api.example/api/v1///",
        token: "t",
        fetchImpl,
      });

      await client.post("/alert-rules");

      expect(calls[0].url).toBe("https://api.example/api/v1/alert-rules");
    });

    it("parses and returns a JSON response body", async () => {
      const { fetchImpl } = fakeFetch({
        ok: true,
        status: 201,
        body: JSON.stringify({ checked: 3, updated: 1 }),
      });
      const client = new WorkerApiClient({ baseUrl: "https://api.example", token: "t", fetchImpl });

      const result = await client.post<{ checked: number; updated: number }>(
        "/vendors/warranty-sync",
      );

      expect(result).toEqual({ checked: 3, updated: 1 });
    });

    it("returns undefined for an empty (e.g. 204) response body", async () => {
      const { fetchImpl } = fakeFetch({ ok: true, status: 204, body: "" });
      const client = new WorkerApiClient({ baseUrl: "https://api.example", token: "t", fetchImpl });

      await expect(client.post("/things")).resolves.toBeUndefined();
    });

    it("throws WorkerApiError carrying the status and raw body on a non-2xx", async () => {
      const { fetchImpl } = fakeFetch({ ok: false, status: 503, body: "upstream down" });
      const client = new WorkerApiClient({ baseUrl: "https://api.example", token: "t", fetchImpl });

      let caught: unknown;
      try {
        await client.post("/vendors/warranty-sync");
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(WorkerApiError);
      const err = caught as WorkerApiError;
      expect(err.status).toBe(503);
      expect(err.body).toBe("upstream down");
      expect(err.message).toContain("/vendors/warranty-sync");
    });
  });

  describe("constructor", () => {
    it("throws when no fetch implementation is available and none was injected", () => {
      const original = (globalThis as { fetch?: unknown }).fetch;
      // simulate a runtime with no global fetch
      (globalThis as { fetch?: unknown }).fetch = undefined;
      try {
        expect(() => new WorkerApiClient({ baseUrl: "https://api.example", token: "t" })).toThrow(
          /no fetch implementation/,
        );
      } finally {
        (globalThis as { fetch?: unknown }).fetch = original;
      }
    });
  });
});
