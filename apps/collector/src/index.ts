import { readFileSync } from "node:fs";
import type { HealthSnapshotPayload } from "@cts-dc-opsdesk/shared-types";
import type { SnmpTrap } from "@cts-dc-opsdesk/snmp-adapter";
import { loadConfig } from "./config";
import type { CollectorConfig } from "./config";
import { DeliveryBuffer } from "./delivery-buffer";
import type { BufferedItem } from "./delivery-buffer";
import { FileDeliveryBuffer } from "./file-delivery-buffer";
import { EnvCredentialResolver } from "./hw/credentials";
import type { Credential } from "./hw/credentials";
import { runHealthPoll } from "./hw/health-poll";
import { MgmtHttp } from "./hw/mgmt-http";
import { NetSnmpTrapListener } from "./snmp/net-snmp-listener";
import { makePduSink, NoopTrapListener } from "./snmp/trap-listener";
import type { TrapListener } from "./snmp/trap-listener";
import { OpsDeskClient } from "./opsdesk-client";

/**
 * Site-collector entrypoint (ADR-004, spec §11). One process per site: polls
 * approved local management endpoints, normalizes via the adapters, and pushes
 * events outbound to the OpsDesk API — buffering locally while the API is
 * unreachable. No inbound ports.
 *
 * Wires config + the outbound client + the delivery buffer + the loops:
 *  - health poll: for each endpoint, fetch via MgmtHttp -> redfish/hpe-ilo
 *    adapter -> buffer -> POST /monitoring/health-snapshots (OME fetcher pending);
 *  - SNMP trap path: decoded PDU -> SnmpTrap -> buffer -> POST /alerts/sources/snmp
 *    (a real net-snmp-backed listener replaces NoopTrapListener next).
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
  const buffer = config.bufferFile
    ? new FileDeliveryBuffer(config.bufferFile, config.bufferMaxItems)
    : new DeliveryBuffer(config.bufferMaxItems);

  const send = async (item: BufferedItem): Promise<void> => {
    switch (item.channel) {
      case "snmp":
        await client.ingestSnmpTraps([item.payload as SnmpTrap]);
        break;
      case "alert":
        await client.ingestAlert(item.payload as never);
        break;
      case "health":
        await client.ingestHealthSnapshots([item.payload as HealthSnapshotPayload]);
        break;
      default:
        throw new Error(`unknown delivery channel "${item.channel}"`);
    }
  };

  // SNMP trap path: decoded PDU -> SnmpTrap -> buffer -> POST /alerts/sources/snmp.
  const onTrap = (trap: SnmpTrap): void => {
    const occurrence = trap.sysUpTimeTicks ?? Date.parse(trap.receivedAt ?? "") ?? Date.now();
    buffer.enqueue({
      key: `snmp:${trap.agentAddress}:${trap.trapOid ?? trap.v1?.specificTrap ?? "?"}:${occurrence}`,
      channel: "snmp",
      payload: trap,
    });
  };
  const pduSink = makePduSink(config.snmpSources, onTrap);
  const trapListener: TrapListener =
    config.snmpSources.length > 0
      ? new NetSnmpTrapListener({
          port: config.snmpTrapPort,
          community: config.snmpCommunity,
          sink: pduSink,
        })
      : new NoopTrapListener();
  void trapListener.start();

  const resolver = new EnvCredentialResolver();
  const makeHttp = (baseUrl: string, credential: Credential): MgmtHttp =>
    new MgmtHttp(baseUrl, credential);

  const healthPoll = (): void => {
    void runHealthPoll({
      endpoints: config.endpoints,
      resolver,
      makeHttp,
      enqueue: (item) => buffer.enqueue(item),
    }).then((r) => {
      if (r.failed.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[collector] health poll: ${r.enqueued}/${r.polled} enqueued, ${r.failed.length} failed`,
        );
      }
    });
  };
  healthPoll();
  const poll = setInterval(healthPoll, config.pollIntervalSeconds * 1000);

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
    void trapListener.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
