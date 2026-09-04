import { WorkerApiClient } from "./api-client";
import { createNotificationsWorker } from "./queues/notifications.queue";
import { createSlaTimersWorker } from "./queues/sla-timers.queue";
import {
  createWarrantySyncQueue,
  createWarrantySyncWorker,
  scheduleWarrantySync,
} from "./queues/warranty-sync.queue";

/**
 * OpsDesk worker entrypoint — background jobs run as a separate process
 * from the API, same codebase (spec §5.1). Add alert-correlation and
 * collector-polling workers alongside these as those modules land.
 */
async function main() {
  const slaWorker = createSlaTimersWorker();
  const notificationsWorker = createNotificationsWorker();

  const closers: Array<() => Promise<unknown>> = [
    () => slaWorker.close(),
    () => notificationsWorker.close(),
  ];
  const active = ["sla-timers", "notifications"];

  // Warranty resync drives the API's vendors module over HTTP (it owns the
  // Warranty table + audit), so it only runs when the worker has API creds.
  const apiUrl = process.env.OPSDESK_API_URL;
  const apiToken = process.env.OPSDESK_SERVICE_TOKEN;
  if (apiUrl && apiToken) {
    const client = new WorkerApiClient({ baseUrl: apiUrl, token: apiToken });
    const warrantyQueue = createWarrantySyncQueue();
    const warrantyWorker = createWarrantySyncWorker(client);
    await scheduleWarrantySync(warrantyQueue);
    closers.push(() => warrantyWorker.close(), () => warrantyQueue.close());
    active.push("warranty-sync");
  } else {
    // eslint-disable-next-line no-console
    console.log(
      "warranty-sync disabled: set OPSDESK_API_URL and OPSDESK_SERVICE_TOKEN to enable",
    );
  }

  // eslint-disable-next-line no-console
  console.log(`OpsDesk worker started (${active.join(", ")} queues active)`);

  const shutdown = async () => {
    await Promise.allSettled(closers.map((close) => close()));
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("OpsDesk worker failed to start", err);
  process.exit(1);
});
