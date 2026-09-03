import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BufferedItem } from "./delivery-buffer";
import { FileDeliveryBuffer } from "./file-delivery-buffer";

function item(key: string): Omit<BufferedItem, "queuedAt"> {
  return { key, channel: "alert", payload: { key } };
}

describe("FileDeliveryBuffer", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "collector-buf-"));
    path = join(dir, "buffer.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists the queue to disk on enqueue", () => {
    const b = new FileDeliveryBuffer(path, 100);
    b.enqueue(item("a"));
    b.enqueue(item("b"));

    expect(existsSync(path)).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk.map((i: BufferedItem) => i.key)).toEqual(["a", "b"]);
  });

  it("reloads the queue when reconstructed on the same path", () => {
    new FileDeliveryBuffer(path, 100).enqueue(item("a"));
    const reopened = new FileDeliveryBuffer(path, 100);
    expect(reopened.size).toBe(1);
  });

  it("keeps only the undelivered items after a partial flush, across a restart", async () => {
    const b = new FileDeliveryBuffer(path, 100);
    ["a", "b", "c"].forEach((k) => b.enqueue(item(k)));

    await b.flush(async (i) => {
      if (i.key === "b") {
        throw new Error("API down");
      }
    });

    expect(JSON.parse(readFileSync(path, "utf8")).map((i: BufferedItem) => i.key)).toEqual([
      "b",
      "c",
    ]);
    expect(new FileDeliveryBuffer(path, 100).size).toBe(2);
  });

  it("dedupes a key that was already persisted before the restart", () => {
    new FileDeliveryBuffer(path, 100).enqueue(item("a"));
    const reopened = new FileDeliveryBuffer(path, 100);
    reopened.enqueue(item("a"));
    expect(reopened.size).toBe(1);
  });

  it("discards a corrupt buffer file instead of crashing", () => {
    writeFileSync(path, "{ not json");
    const b = new FileDeliveryBuffer(path, 100);
    expect(b.size).toBe(0);
    b.enqueue(item("a")); // still usable — overwrites the bad file
    expect(new FileDeliveryBuffer(path, 100).size).toBe(1);
  });
});
