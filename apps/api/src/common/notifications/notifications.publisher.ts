import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { NotificationEvent, Party, RenderOptions } from "@cts-dc-opsdesk/email-adapter";
import { Queue } from "bullmq";
import IORedis from "ioredis";

/** Must match `NOTIFICATIONS_QUEUE_NAME` in apps/worker. */
export const NOTIFICATIONS_QUEUE_NAME = "notifications";

/** The job the worker's notifications queue consumes (mirrors its `NotificationJob`). */
export interface NotificationJob {
  event: NotificationEvent;
  recipients: { to: Party[]; cc?: Party[] };
  options?: RenderOptions;
}

/**
 * Enqueues notification jobs for the worker to render + send. **Best-effort**:
 * the domain mutation that triggers a notification has already committed and
 * been audited, so a missing / unreachable Redis is logged (once) and swallowed,
 * never thrown or waited on. With `REDIS_URL` unset the publisher is a no-op.
 *
 * The Redis connection + Queue are created lazily on the first `enqueue`, so an
 * API instance that never sends a notification opens no connection.
 */
@Injectable()
export class NotificationsPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsPublisher.name);
  private readonly url = process.env.REDIS_URL;
  private queue: Queue<NotificationJob> | null = null;
  private connection: IORedis | null = null;
  private unavailable = false;

  private ensureQueue(): Queue<NotificationJob> | null {
    if (this.queue || this.unavailable) {
      return this.queue;
    }
    if (!this.url) {
      this.logger.warn("REDIS_URL unset — notification jobs are dropped");
      this.unavailable = true;
      return null;
    }
    this.connection = new IORedis(this.url, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
      // give up after a few tries so a down Redis doesn't spin forever
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2_000)),
    });
    this.connection.on("error", (err) => {
      if (!this.unavailable) {
        this.unavailable = true;
        this.logger.warn(`notifications Redis unavailable (${err.message}) — jobs are dropped`);
      }
    });
    this.queue = new Queue<NotificationJob>(NOTIFICATIONS_QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
    return this.queue;
  }

  /** `jobId` de-dupes an accidental re-enqueue. Resolves within ~2s even if Redis
   *  is unreachable — the caller never waits on the queue. */
  async enqueue(job: NotificationJob, jobId?: string): Promise<void> {
    const queue = this.ensureQueue();
    if (!queue) {
      return;
    }
    try {
      const add = queue.add(job.event.kind, job, jobId ? { jobId } : undefined);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("enqueue timed out")), 2_000).unref(),
      );
      await Promise.race([add, timeout]);
    } catch (err) {
      this.logger.warn(
        `failed to enqueue ${job.event.kind}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
    await this.connection?.quit().catch(() => undefined);
  }
}
