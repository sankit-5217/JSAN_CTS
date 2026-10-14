import { ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { AlertsService } from "../../alerts/alerts.service";
import { toProblemEvent, toRecoveryEvent, ZabbixResyncService } from "./zabbix-resync.service";
import { RawHost, RawProblem, ZabbixService } from "./zabbix.service";

const NOW = new Date("2026-10-13T12:00:00Z");
const host: RawHost = {
  hostid: "10500",
  host: "SITE02-UPS-001",
  name: "UPS",
  status: "0",
  maintenance_status: "0",
};
const problem = (eventid: string, overrides: Partial<RawProblem> = {}): RawProblem => ({
  eventid,
  objectid: "t-1",
  clock: "1792000000",
  name: "UPS on battery",
  severity: "4",
  acknowledged: "0",
  suppressed: "0",
  opdata: "",
  tags: [
    { tag: "site", value: "SITE02" },
    { tag: "ci", value: "SITE02-UPS-001" },
  ],
  ...overrides,
});
const openAlert = (externalEventId: string) => ({
  externalEventId,
  state: "OPEN",
  summary: "UPS on battery",
  details: {
    zabbixEventId: externalEventId.replace("zbx-", ""),
    host: "SITE02-UPS-001",
    tags: { site: "SITE02", ci: "SITE02-UPS-001" },
  },
});

function make(opts: {
  open?: { problem: RawProblem; host: RawHost }[] | Error;
  states?: Record<string, string>;
  stale?: ReturnType<typeof openAlert>[];
  actorId?: string | null;
}) {
  const zabbix = {
    openProblemsForResync: jest.fn(() =>
      opts.open instanceof Error ? Promise.reject(opts.open) : Promise.resolve(opts.open ?? []),
    ),
  } as unknown as ZabbixService;
  const alerts = {
    statesByExternalId: jest.fn().mockResolvedValue(new Map(Object.entries(opts.states ?? {}))),
    openFromSource: jest.fn().mockResolvedValue(opts.stale ?? []),
    ingestFromZabbix: jest.fn((events: unknown[]) =>
      Promise.resolve({ accepted: events.map(() => ({})), rejected: [] }),
    ),
  };
  const prisma = {
    auditEvent: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.actorId === null ? null : { actorId: opts.actorId ?? "admin-1" }),
    },
  } as unknown as PrismaService;
  const service = new ZabbixResyncService(zabbix, alerts as unknown as AlertsService, prisma);
  return { service, alerts };
}

describe("ZabbixResyncService", () => {
  it("creates an alert for a Zabbix problem OpsDesk never received", async () => {
    const { service, alerts } = make({ open: [{ problem: problem("901"), host }] });
    const result = await service.resync(NOW);
    expect(result.created).toBe(1);
    expect(alerts.ingestFromZabbix).toHaveBeenCalledWith(
      [expect.objectContaining({ eventId: "901", eventValue: "1", host: "SITE02-UPS-001" })],
      { actorId: "admin-1", correlationId: "zabbix-resync" },
    );
  });

  it("leaves alerts it already has alone, but brings in a Zabbix acknowledgement", async () => {
    const { service, alerts } = make({
      open: [
        { problem: problem("901"), host },
        { problem: problem("902", { acknowledged: "1" }), host },
      ],
      states: { "zbx-901": "OPEN", "zbx-902": "OPEN" },
    });
    const result = await service.resync(NOW);
    expect(result).toMatchObject({ created: 0, acknowledged: 1 });
    expect(alerts.ingestFromZabbix).toHaveBeenCalledTimes(1);
    expect(alerts.ingestFromZabbix.mock.calls[0][0]).toEqual([
      expect.objectContaining({ eventId: "902", eventAckStatus: "Yes" }),
    ]);
  });

  it("recovers an OpsDesk alert whose problem Zabbix has resolved", async () => {
    const { service, alerts } = make({ open: [], stale: [openAlert("zbx-777")] });
    const result = await service.resync(NOW);
    expect(result.recovered).toBe(1);
    expect(alerts.ingestFromZabbix).toHaveBeenCalledWith(
      [expect.objectContaining({ eventId: "777", eventValue: "0", host: "SITE02-UPS-001" })],
      expect.anything(),
    );
    // only alerts older than the grace period are considered
    expect(alerts.openFromSource).toHaveBeenCalledWith(
      "ZABBIX",
      new Date(NOW.getTime() - 2 * 60_000),
    );
  });

  it("refuses to clear a large share of the queue at once (safety cap)", async () => {
    const stale = Array.from({ length: 30 }, (_, i) => openAlert(`zbx-${1000 + i}`));
    const { service, alerts } = make({ open: [], stale });
    const result = await service.resync(NOW);
    expect(result).toMatchObject({ recovered: 0, held: 30 });
    expect(alerts.ingestFromZabbix).not.toHaveBeenCalled();
  });

  it("does nothing while Zabbix isn't configured", async () => {
    const { service, alerts } = make({
      open: new ServiceUnavailableException({ code: "ZABBIX_NOT_CONFIGURED", message: "x" }),
    });
    const result = await service.resync(NOW);
    expect(result.skipped).toBe("ZABBIX_NOT_CONFIGURED");
    expect(alerts.ingestFromZabbix).not.toHaveBeenCalled();
  });

  it("does nothing until an admin has configured the integration", async () => {
    const { service, alerts } = make({ open: [{ problem: problem("901"), host }], actorId: null });
    expect((await service.resync(NOW)).skipped).toBe("NO_ACTOR");
    expect(alerts.ingestFromZabbix).not.toHaveBeenCalled();
  });
});

describe("Zabbix event rebuilding", () => {
  it("turns a problem into the webhook's shape, tags flattened", () => {
    expect(toProblemEvent(problem("5", { opdata: "Battery 12%" }), host)).toMatchObject({
      eventId: "5",
      eventValue: "1",
      eventAckStatus: "No",
      nseverity: "4",
      opdata: "Battery 12%",
      tags: { site: "SITE02", ci: "SITE02-UPS-001" },
    });
  });

  it("can't replay a recovery without the stored Zabbix metadata", () => {
    expect(
      toRecoveryEvent({ externalEventId: "zbx-1", summary: "x", details: { truncated: true } }, NOW),
    ).toBeNull();
    expect(toRecoveryEvent({ externalEventId: "zbx-1", summary: "x", details: null }, NOW)).toBeNull();
  });
});
