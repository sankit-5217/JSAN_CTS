import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { NotificationEvent, Party, RenderOptions } from "@cts-dc-opsdesk/email-adapter";
import { Queue } from "bullmq";
import IORedis from "ioredis";

/** Must match `SLA_TIMERS_QUEUE_NAME` in apps/worker. */
export const SLA_TIMERS_QUEUE_NAME = "sla-timers";

/**
 * Same shape as `NotificationJob` in apps/worker/apps/api's notifications
 * publisher — the worker's sla-timers processor does a straight passthrough
 * into the notifications queue, not its own rendering (Sprint 6 plan, Step 4).
 */
export interface SlaTimerJob {
  event: NotificationEvent;
  recipients: { to: Party[]; cc?: Party[] };
  options?: RenderOptions;
}

/**
 * Enqueues SLA warning/breach delivery for the worker to relay into the
 * notifications queue. **Best-effort**: the escalation scan has already
 * written the audit/timeline evidence by the time this is called (never the
 * other way around) — a missing/unreachable Redis is logged once and
 * swallowed, never thrown. Mirrors NotificationsPublisher
 * (apps/api/src/common/notifications/notifications.publisher.ts) exactly;
 * kept as its own class because it targets a different queue with a
 * different owner-intent (SLA escalation vs. general notifications), not
 * because the mechanics differ.
 */
@Injectable()
export class SlaTimersPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(SlaTimersPublisher.name);
  private readonly url = process.env.REDIS_URL;
  private queue: Queue<SlaTimerJob> | null = null;
  private connection: IORedis | null = null;
  private unavailable = false;

  private ensureQueue(): Queue<SlaTimerJob> | null {
    if (this.queue || this.unavailable) {
      return this.queue;
    }
    if (!this.url) {
      this.logger.warn("REDIS_URL unset — SLA timer jobs are dropped");
      this.unavailable = true;
      return null;
    }
    this.connection = new IORedis(this.url, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2_000)),
    });
    this.connection.on("error", (err) => {
      if (!this.unavailable) {
        this.unavailable = true;
        this.logger.warn(`SLA timers Redis unavailable (${err.message}) — jobs are dropped`);
      }
    });
    this.queue = new Queue<SlaTimerJob>(SLA_TIMERS_QUEUE_NAME, {
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

  /** `jobId` (e.g. `sla:<instanceId>:<milestone>`) de-dupes a re-enqueue. */
  async enqueue(job: SlaTimerJob, jobId?: string): Promise<void> {
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
