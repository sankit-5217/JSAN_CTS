import { createNotificationsWorker } from "./queues/notifications.queue";
import { createSlaTimersWorker } from "./queues/sla-timers.queue";

/**
 * OpsDesk worker entrypoint — background jobs run as a separate process
 * from the API, same codebase (spec §5.1). Add alert-correlation and
 * collector-polling workers alongside these as those modules land.
 */
function main() {
  const slaWorker = createSlaTimersWorker();
  const notificationsWorker = createNotificationsWorker();

  // eslint-disable-next-line no-console
  console.log("OpsDesk worker started (sla-timers, notifications queues active)");

  const shutdown = async () => {
    await Promise.allSettled([slaWorker.close(), notificationsWorker.close()]);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
