/**
 * Local buffer for events the collector could not deliver (ADR-004: "buffers
 * locally on disconnect and uploads idempotently on reconnect"). Every buffered
 * payload carries a stable id, so replaying a payload the API already accepted
 * is a no-op on the server (idempotent ingest).
 *
 * `DeliveryBuffer` keeps the queue in memory; `FileDeliveryBuffer` (same shape)
 * persists it so buffered events survive a collector restart.
 */

export interface BufferedItem<T = unknown> {
  /** Stable key for dedupe + ordering, e.g. `snmp:<eventId>` or `health:<ci>:<iso>`. */
  key: string;
  /** What kind of send this is — picks the OpsDeskClient method on flush. */
  channel: string;
  payload: T;
  /** ms epoch the item was first queued. */
  queuedAt: number;
}

export type Sender = (item: BufferedItem) => Promise<void>;

export interface FlushResult {
  delivered: number;
  remaining: number;
  /** Items the API refused for good (removed so they don't block the rest). */
  rejected: { item: BufferedItem; error: unknown }[];
}

/**
 * True when the API has refused an item for good: it is malformed or
 * describes something the API doesn't know (400, 404, 409, 413, 422).
 * Retrying would never succeed and would hold every newer event behind it.
 * Auth failures (401/403) are NOT permanent: they mean the collector's token
 * needs fixing, after which everything buffered is delivered, so those are
 * kept. Rate limits, timeouts, 5xx and network errors are retried.
 */
export function isPermanentRejection(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && [400, 404, 409, 413, 422].includes(status);
}

export class DeliveryBuffer {
  protected items: BufferedItem[] = [];

  constructor(protected readonly maxItems: number) {}

  get size(): number {
    return this.items.length;
  }

  /** Queue an item. Duplicate keys are ignored; the oldest item is dropped when full. */
  enqueue(item: Omit<BufferedItem, "queuedAt">): void {
    if (this.items.some((i) => i.key === item.key)) {
      return;
    }
    this.items.push({ ...item, queuedAt: Date.now() });
    if (this.items.length > this.maxItems) {
      this.items.splice(0, this.items.length - this.maxItems);
    }
    this.onChange();
  }

  /**
   * Try to deliver everything, oldest first, stopping at the first failure so
   * ordering is preserved and the API isn't hammered while it's down. Delivered
   * items are removed; the rest stay for the next flush. An item the API
   * refuses for good (see isPermanentRejection) is removed and reported
   * instead of blocking every newer event behind it.
   */
  async flush(send: Sender): Promise<FlushResult> {
    let delivered = 0;
    const rejected: FlushResult["rejected"] = [];
    while (this.items.length > 0) {
      const next = this.items[0];
      try {
        await send(next);
      } catch (error) {
        if (!isPermanentRejection(error)) {
          break;
        }
        this.items.shift();
        rejected.push({ item: next, error });
        continue;
      }
      this.items.shift();
      delivered += 1;
    }
    if (delivered > 0 || rejected.length > 0) {
      this.onChange();
    }
    return { delivered, remaining: this.items.length, rejected };
  }

  /** Hook: called after every mutation so a subclass can persist. */
  protected onChange(): void {}
}
