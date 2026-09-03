import { Job, Queue, Worker } from "bullmq";
import { renderNotification } from "@cts-dc-opsdesk/email-adapter";
import type { NotificationEvent, Party, RenderOptions } from "@cts-dc-opsdesk/email-adapter";
import { ConsoleMailTransport, MailTransport } from "../mail/transport";
import { createRedisConnection } from "../redis";

export const NOTIFICATIONS_QUEUE_NAME = "notifications";

/**
 * What the API (or another worker) enqueues when a domain event fires:
 * incident assigned, SLA warning/breach, change approved, alert raised, vendor
 * case update. The worker renders it via `@cts-dc-opsdesk/email-adapter` and
 * hands the result to the mail transport.
 */
export interface NotificationJob {
  event: NotificationEvent;
  recipients: { to: Party[]; cc?: Party[] };
  options?: RenderOptions;
}

/**
 * Enqueue side. Callers should pass a stable `jobId` (e.g.
 * `<event.kind>:<entity.key>:<discriminator>`) so an accidental re-enqueue of
 * the same event is de-duplicated by BullMQ rather than mailed twice.
 */
export function createNotificationsQueue(): Queue<NotificationJob> {
  return new Queue<NotificationJob>(NOTIFICATIONS_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
}

/**
 * The unit of work: render the job and send it. Pure apart from the transport —
 * exported directly so it can be tested without Redis. A render error (bad
 * event, no recipients) propagates so BullMQ marks the job failed and retries.
 */
export async function processNotificationJob(
  data: NotificationJob,
  transport: MailTransport,
): Promise<void> {
  const email = renderNotification(data.event, data.recipients, data.options ?? {});
  await transport.send(email);
}

export function createNotificationsWorker(
  transport: MailTransport = new ConsoleMailTransport(),
): Worker<NotificationJob> {
  return new Worker<NotificationJob>(
    NOTIFICATIONS_QUEUE_NAME,
    async (job: Job<NotificationJob>) => {
      await processNotificationJob(job.data, transport);
    },
    { connection: createRedisConnection() },
  );
}
