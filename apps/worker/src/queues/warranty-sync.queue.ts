import { Queue, Worker } from "bullmq";
import { WorkerApiClient } from "../api-client";
import { createRedisConnection } from "../redis";

export const WARRANTY_SYNC_QUEUE_NAME = "warranty-sync";

/** Nightly at 03:00 in the worker's local timezone. Override with WARRANTY_SYNC_CRON. */
export const DEFAULT_WARRANTY_SYNC_CRON = "0 3 * * *";

/** Shape the API returns from POST /vendors/warranty-sync (WarrantyResyncSummary). */
export interface WarrantyResyncSummary {
  checked: number;
  updated: number;
  unchanged: number;
  skipped: unknown[];
  failed: unknown[];
}

/**
 * The unit of work: ask the API's `vendors` module to resync warranty coverage.
 * Every bit of domain logic — provider lookups, the append-only `Warranty`
 * writes, the audit events — lives behind that one endpoint (module boundary);
 * the worker only owns *when* it runs. Exported bare so it can be tested
 * without Redis. A non-2xx propagates so BullMQ marks the job failed and retries.
 */
export async function processWarrantySyncJob(client: WorkerApiClient): Promise<WarrantyResyncSummary> {
  const summary = await client.post<WarrantyResyncSummary>("/vendors/warranty-sync");
  // eslint-disable-next-line no-console
  console.log(
    `[warranty-sync] checked ${summary.checked}, updated ${summary.updated}, ` +
      `unchanged ${summary.unchanged}, skipped ${summary.skipped.length}, failed ${summary.failed.length}`,
  );
  return summary;
}

export function createWarrantySyncQueue(): Queue {
  return new Queue(WARRANTY_SYNC_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
}

/**
 * Register the nightly repeatable job, replacing any earlier schedule first so
 * this is idempotent across restarts *and* when the cron pattern changes
 * (BullMQ would otherwise leave the old repeatable orphaned and fire twice).
 */
export async function scheduleWarrantySync(
  queue: Queue,
  pattern: string = process.env.WARRANTY_SYNC_CRON ?? DEFAULT_WARRANTY_SYNC_CRON,
): Promise<void> {
  const existing = await queue.getRepeatableJobs();
  await Promise.all(existing.map((r) => queue.removeRepeatableByKey(r.key)));
  await queue.add("warranty-sync", {}, { repeat: { pattern } });
}

export function createWarrantySyncWorker(client: WorkerApiClient): Worker {
  return new Worker(
    WARRANTY_SYNC_QUEUE_NAME,
    async () => {
      await processWarrantySyncJob(client);
    },
    { connection: createRedisConnection() },
  );
}
