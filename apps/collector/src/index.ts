import { readFileSync } from "node:fs";
import { loadConfig } from "./config";
import type { CollectorConfig } from "./config";
import { DeliveryBuffer } from "./delivery-buffer";
import type { BufferedItem } from "./delivery-buffer";
import { OpsDeskClient } from "./opsdesk-client";

/**
 * Site-collector entrypoint (ADR-004, spec §11). One process per site: polls
 * approved local management endpoints, normalizes via the adapters, and pushes
 * events outbound to the OpsDesk API — buffering locally while the API is
 * unreachable. No inbound ports.
 *
 * This slice wires config + the outbound client + the delivery buffer + the
 * loop scaffolding. The Redfish/OME/iLO HTTP fetchers and the SNMP trap
 * listener land next, each feeding `buffer.enqueue(...)`.
 */

function readConfig(): CollectorConfig {
  const inline = process.env.COLLECTOR_CONFIG;
  const path = process.env.COLLECTOR_CONFIG_FILE;
  const rawJson = inline ?? (path ? readFileSync(path, "utf8") : undefined);
  if (!rawJson) {
    throw new Error("set COLLECTOR_CONFIG (JSON) or COLLECTOR_CONFIG_FILE (path)");
  }
  return loadConfig(JSON.parse(rawJson));
}

function main(): void {
  const config = readConfig();
  const client = new OpsDeskClient({ baseUrl: config.apiBaseUrl, token: config.apiToken });
  const buffer = new DeliveryBuffer(config.bufferMaxItems);

  const send = async (item: BufferedItem): Promise<void> => {
    switch (item.channel) {
      case "snmp":
        await client.ingestSnmpTraps(item.payload as never);
        break;
      case "alert":
        await client.ingestAlert(item.payload as never);
        break;
      default:
        throw new Error(`unknown delivery channel "${item.channel}"`);
    }
  };

  const poll = setInterval(() => {
    // TODO: for each config.endpoints — fetch via the matching adapter's HTTP
    // client, normalize, buffer.enqueue({ channel: "alert", ... }).
    void config.endpoints;
  }, config.pollIntervalSeconds * 1000);

  const flush = setInterval(() => {
    void buffer.flush(send).then((r) => {
      if (r.remaining > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[collector] ${r.delivered} delivered, ${r.remaining} still buffered`);
      }
    });
  }, config.heartbeatIntervalSeconds * 1000);

  // eslint-disable-next-line no-console
  console.log(
    `OpsDesk collector started for site ${config.siteCode} — ${config.endpoints.length} endpoint(s), ` +
      `poll ${config.pollIntervalSeconds}s`,
  );

  const shutdown = (): void => {
    clearInterval(poll);
    clearInterval(flush);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
