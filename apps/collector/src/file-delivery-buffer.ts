import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { DeliveryBuffer } from "./delivery-buffer";
import type { BufferedItem } from "./delivery-buffer";

/**
 * A {@link DeliveryBuffer} that persists the queue to a JSON file, so events the
 * collector couldn't deliver survive a process restart (ADR-004). The file is
 * rewritten atomically (temp file + rename) after every mutation; it is bounded
 * by `maxItems` so it stays small.
 */
export class FileDeliveryBuffer extends DeliveryBuffer {
  constructor(
    private readonly path: string,
    maxItems: number,
  ) {
    super(maxItems);
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as BufferedItem[];
      if (Array.isArray(parsed)) {
        // trust the file but re-apply the cap in case maxItems shrank
        this.items = parsed.slice(-this.maxItems);
      }
    } catch {
      // A corrupt buffer file is discarded rather than crashing the collector —
      // undelivered events are lost, which the API's idempotency already tolerates.
      // eslint-disable-next-line no-console
      console.warn(`[collector] discarding unreadable buffer file ${this.path}`);
    }
  }

  protected override onChange(): void {
    const tmp = `${this.path}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, JSON.stringify(this.items));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.path);
  }
}
