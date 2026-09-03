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
   * items are removed; the rest stay for the next flush.
   */
  async flush(send: Sender): Promise<FlushResult> {
    let delivered = 0;
    while (this.items.length > 0) {
      const next = this.items[0];
      try {
        await send(next);
      } catch {
        break;
      }
      this.items.shift();
      delivered += 1;
    }
    if (delivered > 0) {
      this.onChange();
    }
    return { delivered, remaining: this.items.length };
  }

  /** Hook: called after every mutation so a subclass can persist. */
  protected onChange(): void {}
}
