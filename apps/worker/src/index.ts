import { createSlaTimersWorker } from "./queues/sla-timers.queue";

/**
 * OpsDesk worker entrypoint — background jobs run as a separate process
 * from the API, same codebase (spec §5.1). Add alert-correlation,
 * notification-dispatch and collector-polling workers alongside
 * sla-timers as those modules land.
 */
function main() {
  const slaWorker = createSlaTimersWorker();

  // eslint-disable-next-line no-console
  console.log("OpsDesk worker started (sla-timers queue active)");

  const shutdown = async () => {
    await slaWorker.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
