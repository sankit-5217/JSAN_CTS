import { Worker, Job } from "bullmq";
import { createRedisConnection } from "../redis";

export const SLA_TIMERS_QUEUE_NAME = "sla-timers";

/**
 * Owner: Dev A (sla module) triggers jobs; Dev B extends alert-driven
 * scheduling. Placeholder processor — real SLA breach/escalation logic
 * lands in Sprint 6 once sla_policies and sla_instances (Prisma schema)
 * are populated by the API. Never compute SLA timing on the browser clock
 * (spec §18) — this worker is the source of truth, UTC + policy timezone.
 */
export function createSlaTimersWorker() {
  return new Worker(
    SLA_TIMERS_QUEUE_NAME,
    async (job: Job) => {
      // eslint-disable-next-line no-console
      console.log(`[sla-timers] processing job ${job.id}`, job.data);
    },
    { connection: createRedisConnection() },
  );
}
