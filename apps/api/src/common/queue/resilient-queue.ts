import { Logger } from "@nestjs/common";
import { JobsOptions, Queue } from "bullmq";
import IORedis from "ioredis";

export type EnqueueResult = "queued" | "held" | "dropped";

interface HeldJob<T> {
  name: string;
  data: T;
  jobId?: string;
}

export interface ResilientQueueOptions {
  queueName: string;
  redisUrl: string | undefined;
  defaultJobOptions: JobsOptions;
  logger: Logger;
  /**
   * Jobs kept in memory while Redis is unreachable and sent once it's back.
   * 0 disables holding (e.g. emails carrying a live sign-in link, where a
   * late send is worse than none). Lost only if this process stops first.
   */
  holdMax: number;
}

/** How often held jobs are retried even if no "ready" event arrives. */
const FLUSH_INTERVAL_MS = 15_000;
/** The caller never waits longer than this on Redis. */
const ADD_TIMEOUT_MS = 2_000;

/**
 * A BullMQ queue that survives Redis going away. The publishers it backs
 * are best-effort by design (the domain write and its audit already
 * committed), but a Redis restart — routine on Railway — used to switch
 * them off until the API restarted, silently dropping SLA escalations and
 * notifications. Here the connection keeps retrying forever (backing off
 * to 10 s), jobs that can't be added are held in a bounded in-memory
 * buffer, and the buffer is flushed when Redis is reachable again. Outages
 * and recoveries are each logged once.
 */
export class ResilientQueue<T> {
  private queue: Queue<T> | null = null;
  private connection: IORedis | null = null;
  private held: HeldJob<T>[] = [];
  private down = false;
  private flushing = false;
  private timer: NodeJS.Timeout | null = null;
  private warnedNoUrl = false;

  constructor(private readonly opts: ResilientQueueOptions) {}

  /** Never throws and never waits more than ~2 s. */
  async add(name: string, data: T, jobId?: string): Promise<EnqueueResult> {
    const queue = this.ensureQueue();
    if (!queue) {
      return "dropped";
    }
    try {
      await this.addNow(queue, name, data, jobId);
      return "queued";
    } catch (err) {
      return this.hold({ name, data, jobId }, err);
    }
  }

  /** How many jobs are waiting for Redis to come back (for health/metrics). */
  get heldCount(): number {
    return this.held.length;
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.held.length > 0) {
      this.opts.logger.warn(
        `${this.opts.queueName}: shutting down with ${this.held.length} job(s) still held — they are lost`,
      );
    }
    await this.queue?.close().catch(() => undefined);
    await this.connection?.quit().catch(() => undefined);
  }

  private ensureQueue(): Queue<T> | null {
    if (this.queue) return this.queue;
    if (!this.opts.redisUrl) {
      if (!this.warnedNoUrl) {
        this.warnedNoUrl = true;
        this.opts.logger.warn(`REDIS_URL unset — ${this.opts.queueName} jobs are dropped`);
      }
      return null;
    }
    this.connection = new IORedis(this.opts.redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
      // Never give up: back off to 10 s and keep trying.
      retryStrategy: (times) => Math.min(times * 500, 10_000),
    });
    this.connection.on("error", (err: Error) => {
      if (!this.down) {
        this.down = true;
        this.opts.logger.warn(
          `${this.opts.queueName}: Redis unreachable (${err.message}) — ` +
            (this.opts.holdMax > 0 ? "holding jobs until it is back" : "jobs are dropped"),
        );
      }
    });
    this.connection.on("ready", () => {
      if (this.down) {
        this.down = false;
        this.opts.logger.log(`${this.opts.queueName}: Redis reachable again`);
      }
      void this.flush();
    });
    this.queue = new Queue<T>(this.opts.queueName, {
      connection: this.connection,
      defaultJobOptions: this.opts.defaultJobOptions,
    });
    if (this.opts.holdMax > 0) {
      this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
      this.timer.unref();
    }
    return this.queue;
  }

  private async addNow(queue: Queue<T>, name: string, data: T, jobId?: string): Promise<void> {
    const add = queue.add(name as never, data as never, jobId ? { jobId } : undefined);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("enqueue timed out")), ADD_TIMEOUT_MS).unref(),
    );
    await Promise.race([add, timeout]);
  }

  private hold(job: HeldJob<T>, err: unknown): EnqueueResult {
    const reason = err instanceof Error ? err.message : String(err);
    if (this.opts.holdMax <= 0) {
      this.opts.logger.warn(`${this.opts.queueName}: failed to enqueue ${job.name}: ${reason}`);
      return "dropped";
    }
    if (job.jobId && this.held.some((h) => h.jobId === job.jobId)) {
      return "held";
    }
    if (this.held.length >= this.opts.holdMax) {
      const dropped = this.held.shift();
      this.opts.logger.error(
        `${this.opts.queueName}: hold buffer full (${this.opts.holdMax}) — dropped the oldest job ${dropped?.name}`,
      );
    }
    this.held.push(job);
    return "held";
  }

  /** Sends held jobs in order; stops at the first failure and retries later. */
  async flush(): Promise<void> {
    if (this.flushing || this.held.length === 0 || !this.queue) return;
    this.flushing = true;
    let sent = 0;
    try {
      while (this.held.length > 0) {
        const next = this.held[0];
        await this.addNow(this.queue, next.name, next.data, next.jobId);
        this.held.shift();
        sent += 1;
      }
    } catch {
      // Still down; the next "ready" event or timer tick tries again.
    } finally {
      this.flushing = false;
      if (sent > 0) {
        this.opts.logger.log(`${this.opts.queueName}: sent ${sent} held job(s)`);
      }
    }
  }
}
