import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { NotificationEvent, Party, RenderOptions } from "@cts-dc-opsdesk/email-adapter";
import { ResilientQueue } from "../../common/queue/resilient-queue";

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
  private readonly queue = new ResilientQueue<SlaTimerJob>({
    queueName: SLA_TIMERS_QUEUE_NAME,
    redisUrl: process.env.REDIS_URL,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
    logger: new Logger(SlaTimersPublisher.name),
    // An SLA warning/breach must not vanish because Redis restarted.
    holdMax: 5_000,
  });

  /** `jobId` (e.g. `sla:<instanceId>:<milestone>`) de-dupes a re-enqueue. */
  async enqueue(job: SlaTimerJob, jobId?: string): Promise<void> {
    await this.queue.add(job.event.kind, job, jobId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
