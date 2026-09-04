import { Worker, Job, Queue } from "bullmq";
import { createRedisConnection } from "../redis";
import { createNotificationsQueue, NotificationJob } from "./notifications.queue";

export const SLA_TIMERS_QUEUE_NAME = "sla-timers";

/**
 * The unit of work: forward an already-complete NotificationJob (same shape
 * the notifications queue itself consumes) onto it. Owner: Dev A (sla
 * module) decides *when* and *what* to send — the API's SlaEscalationScanner
 * (Sprint 6 step 4) is the source of truth for threshold detection and
 * writes the audit/timeline evidence itself, since this worker has no DB
 * access — so there's nothing to render or decide here, only relay. Exported
 * directly so it's testable without a live queue, same as
 * `processNotificationJob`.
 */
export async function relaySlaTimerJob(
  job: Job<NotificationJob>,
  notificationsQueue: Pick<Queue<NotificationJob>, "add">,
): Promise<void> {
  await notificationsQueue.add(job.data.event.kind, job.data, { jobId: job.id });
}

/**
 * Never compute SLA timing on the browser clock (spec §18) — the API is the
 * source of truth, UTC + policy timezone.
 */
export function createSlaTimersWorker() {
  const notificationsQueue = createNotificationsQueue();
  return new Worker<NotificationJob>(
    SLA_TIMERS_QUEUE_NAME,
    (job: Job<NotificationJob>) => relaySlaTimerJob(job, notificationsQueue),
    { connection: createRedisConnection() },
  );
}
