import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { NotificationEvent, Party, RenderOptions } from "@cts-dc-opsdesk/email-adapter";
import { ResilientQueue } from "../queue/resilient-queue";

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
  private readonly queue = new ResilientQueue<NotificationJob>({
    queueName: NOTIFICATIONS_QUEUE_NAME,
    redisUrl: process.env.REDIS_URL,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
    logger: new Logger(NotificationsPublisher.name),
    // Held while Redis is down (e.g. restarting) and sent when it's back.
    holdMax: 5_000,
  });

  /** `jobId` de-dupes an accidental re-enqueue. Resolves within ~2s even if Redis
   *  is unreachable — the caller never waits on the queue. */
  async enqueue(job: NotificationJob, jobId?: string): Promise<void> {
    await this.queue.add(job.event.kind, job, jobId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
