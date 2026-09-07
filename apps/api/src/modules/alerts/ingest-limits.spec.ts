import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { AlertmanagerWebhookDto } from "./dto/alertmanager-webhook.dto";
import { SnmpTrapBatchDto, SnmpTrapDto } from "./dto/snmp-trap.dto";
import { ZabbixWebhookBatchDto } from "./dto/zabbix-webhook.dto";

/**
 * Size limits on the machine-to-machine ingest payloads (spec §14.2). These
 * routes are reachable by any holder of an ingest-role token (adapters, the
 * site collector); an uncapped batch or an uncapped nested array is a cheap
 * amplification / DoS vector, so the caps are a security control, not a nicety.
 */

function errorProps(errors: ReturnType<typeof validateSync>): string[] {
  const walk = (es: typeof errors): string[] =>
    es.flatMap((e) => [e.property, ...(e.children ? walk(e.children) : [])]);
  return walk(errors);
}

const alertmanager = (count: number) =>
  plainToInstance(AlertmanagerWebhookDto, {
    version: "4",
    status: "firing",
    alerts: Array.from({ length: count }, () => ({
      status: "firing",
      labels: {},
      annotations: {},
      startsAt: "2026-09-07T00:00:00.000Z",
      endsAt: "0001-01-01T00:00:00Z",
      fingerprint: "abc",
    })),
  });

const snmpBatch = (count: number) =>
  plainToInstance(SnmpTrapBatchDto, {
    traps: Array.from({ length: count }, () => ({
      ciCode: "SITE01-R1-SW-1",
      agentAddress: "10.0.0.1",
    })),
  });

const zabbixBatch = (count: number) =>
  plainToInstance(ZabbixWebhookBatchDto, {
    events: Array.from({ length: count }, () => ({
      eventId: "1",
      eventValue: "1",
      name: "x",
      timestamp: "1756808100",
      host: "SITE01-R1-SW-1",
    })),
  });

describe("ingest payload size limits", () => {
  it("Alertmanager: accepts a full 500-alert delivery, rejects 501 and an empty batch", () => {
    expect(validateSync(alertmanager(500))).toHaveLength(0);
    expect(errorProps(validateSync(alertmanager(501)))).toContain("alerts");
    expect(errorProps(validateSync(alertmanager(0)))).toContain("alerts");
  });

  it("SNMP batch: rejects more than 500 traps", () => {
    expect(validateSync(snmpBatch(500))).toHaveLength(0);
    expect(errorProps(validateSync(snmpBatch(501)))).toContain("traps");
  });

  it("SNMP trap: rejects a varbind array above 256", () => {
    const ok = plainToInstance(SnmpTrapDto, {
      ciCode: "SITE01-R1-SW-1",
      agentAddress: "10.0.0.1",
      varbinds: Array.from({ length: 256 }, () => ({ oid: "1.3.6.1" })),
    });
    const tooMany = plainToInstance(SnmpTrapDto, {
      ciCode: "SITE01-R1-SW-1",
      agentAddress: "10.0.0.1",
      varbinds: Array.from({ length: 257 }, () => ({ oid: "1.3.6.1" })),
    });
    expect(validateSync(ok)).toHaveLength(0);
    expect(errorProps(validateSync(tooMany))).toContain("varbinds");
  });

  it("SNMP v1: rejects a generic-trap code outside 0..6", () => {
    const bad = plainToInstance(SnmpTrapDto, {
      ciCode: "SITE01-R1-SW-1",
      agentAddress: "10.0.0.1",
      v1: { genericTrap: 7 },
    });
    expect(errorProps(validateSync(bad))).toContain("genericTrap");
  });

  it("Zabbix batch: rejects more than 500 events", () => {
    expect(validateSync(zabbixBatch(500))).toHaveLength(0);
    expect(errorProps(validateSync(zabbixBatch(501)))).toContain("events");
  });
});
