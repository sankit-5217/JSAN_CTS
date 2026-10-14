import { DeliveryBuffer, isPermanentRejection } from "./delivery-buffer";
import { OpsDeskApiError } from "./opsdesk-client";
import type { BufferedItem } from "./delivery-buffer";

function item(key: string): Omit<BufferedItem, "queuedAt"> {
  return { key, channel: "alert", payload: { key } };
}

describe("DeliveryBuffer", () => {
  it("ignores a duplicate key", () => {
    const b = new DeliveryBuffer(100);
    b.enqueue(item("a"));
    b.enqueue(item("a"));
    expect(b.size).toBe(1);
  });

  it("drops the oldest item when full", () => {
    const b = new DeliveryBuffer(2);
    b.enqueue(item("a"));
    b.enqueue(item("b"));
    b.enqueue(item("c"));
    expect(b.size).toBe(2);
  });

  it("flushes oldest-first and removes delivered items", async () => {
    const b = new DeliveryBuffer(100);
    ["a", "b", "c"].forEach((k) => b.enqueue(item(k)));
    const seen: string[] = [];

    const result = await b.flush(async (i) => {
      seen.push(i.key);
    });

    expect(seen).toEqual(["a", "b", "c"]);
    expect(result).toEqual({ delivered: 3, remaining: 0, rejected: [] });
    expect(b.size).toBe(0);
  });

  it("stops at the first failure and keeps the rest in order", async () => {
    const b = new DeliveryBuffer(100);
    ["a", "b", "c"].forEach((k) => b.enqueue(item(k)));

    const result = await b.flush(async (i) => {
      if (i.key === "b") {
        throw new Error("API down");
      }
    });

    expect(result).toEqual({ delivered: 1, remaining: 2, rejected: [] });
    expect(b.size).toBe(2);

    // a later flush that succeeds drains the rest, still in order
    const seen: string[] = [];
    await b.flush(async (i) => {
      seen.push(i.key);
    });
    expect(seen).toEqual(["b", "c"]);
  });

  it("drops an item the API refuses for good instead of blocking the rest", async () => {
    const b = new DeliveryBuffer(100);
    b.enqueue(item("bad"));
    b.enqueue(item("good"));
    const seen: string[] = [];
    const result = await b.flush(async (i) => {
      if (i.key === "bad") throw new OpsDeskApiError("POST /alerts/ingest -> 400", 400, "{}");
      seen.push(i.key);
    });
    expect(seen).toEqual(["good"]);
    expect(result).toMatchObject({ delivered: 1, remaining: 0 });
    expect(result.rejected.map((r) => r.item.key)).toEqual(["bad"]);
  });

  it("keeps everything while the token is refused or the API is down", async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      const b = new DeliveryBuffer(100);
      b.enqueue(item("a"));
      const result = await b.flush(async () => {
        throw new OpsDeskApiError("nope", status, "");
      });
      expect(result).toMatchObject({ delivered: 0, remaining: 1, rejected: [] });
    }
    expect(isPermanentRejection(new Error("ECONNREFUSED"))).toBe(false);
  });
});
