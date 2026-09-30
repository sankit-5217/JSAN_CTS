import { InAppNotificationKind, NotificationUrgency } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  DEFAULT_SOUND_RULES,
  levelForAlertSeverity,
  levelForPriority,
  NotificationSoundRulesService,
} from "./notification-sound-rules.service";

const ACTOR = { actorId: "admin-1", correlationId: "corr-1" };

function makeService(rows: unknown[] = []) {
  const tx = {
    notificationSoundRule: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest
        .fn()
        .mockImplementation(({ create }) =>
          Promise.resolve({ id: "rule-1", ...create, updatedAt: new Date("2026-09-30T00:00:00Z") }),
        ),
    },
  };
  const prisma = {
    notificationSoundRule: { findMany: jest.fn().mockResolvedValue(rows) },
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new NotificationSoundRulesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, prisma, tx, audit };
}

describe("levels", () => {
  it("maps priorities and alert severities onto 1-4", () => {
    expect(["P1", "P2", "P3", "P4"].map((p) => levelForPriority(p as never))).toEqual([1, 2, 3, 4]);
    expect(
      ["CRITICAL", "HIGH", "WARNING", "INFO"].map((s) => levelForAlertSeverity(s as never)),
    ).toEqual([1, 2, 3, 4]);
  });
});

describe("NotificationSoundRulesService.resolve", () => {
  it("serves the code default when no row is saved", async () => {
    const { service } = makeService();

    await expect(service.resolve(InAppNotificationKind.INCIDENT_ASSIGNED, 1)).resolves.toBe(
      NotificationUrgency.CRITICAL,
    );
    await expect(service.resolve(InAppNotificationKind.INCIDENT_ASSIGNED, 3)).resolves.toBe(
      NotificationUrgency.NORMAL,
    );
    await expect(service.resolve(InAppNotificationKind.INCIDENT_COMMENT_ADDED, 1)).resolves.toBe(
      NotificationUrgency.SILENT,
    );
  });

  it("prefers a saved row and caches the table", async () => {
    const { service, prisma } = makeService([
      { kind: "INCIDENT_ASSIGNED", level: 3, urgency: NotificationUrgency.HIGH },
    ]);

    await expect(service.resolve(InAppNotificationKind.INCIDENT_ASSIGNED, 3)).resolves.toBe(
      NotificationUrgency.HIGH,
    );
    await service.resolve(InAppNotificationKind.SLA_BREACHED, 2);

    expect(prisma.notificationSoundRule.findMany).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default when the lookup fails", async () => {
    const { service, prisma } = makeService();
    prisma.notificationSoundRule.findMany.mockRejectedValue(new Error("db down"));

    await expect(service.resolve(InAppNotificationKind.SLA_BREACHED, 4)).resolves.toBe(
      NotificationUrgency.CRITICAL,
    );
  });

  it("has a default for every kind at every level", () => {
    for (const kind of Object.values(InAppNotificationKind)) {
      expect(DEFAULT_SOUND_RULES[kind]).toHaveLength(4);
    }
  });
});

describe("NotificationSoundRulesService.list", () => {
  it("returns every kind x level, marking which cells are defaults", async () => {
    const { service } = makeService([
      { kind: "SLA_WARNING", level: 2, urgency: NotificationUrgency.SILENT, updatedAt: new Date() },
    ]);

    const cells = await service.list();

    expect(cells).toHaveLength(Object.values(InAppNotificationKind).length * 4);
    expect(cells.find((c) => c.kind === "SLA_WARNING" && c.level === 2)).toMatchObject({
      urgency: NotificationUrgency.SILENT,
      isDefault: false,
    });
    expect(cells.find((c) => c.kind === "SLA_WARNING" && c.level === 1)).toMatchObject({
      urgency: NotificationUrgency.HIGH,
      isDefault: true,
    });
  });
});

describe("NotificationSoundRulesService.set", () => {
  it("upserts the cell and audits it in the same transaction", async () => {
    const { service, tx, audit } = makeService();

    const result = await service.set(
      InAppNotificationKind.INCIDENT_STATUS_CHANGED,
      1,
      NotificationUrgency.HIGH,
      ACTOR,
    );

    expect(tx.notificationSoundRule.upsert).toHaveBeenCalledWith({
      where: { kind_level: { kind: "INCIDENT_STATUS_CHANGED", level: 1 } },
      create: { kind: "INCIDENT_STATUS_CHANGED", level: 1, urgency: "HIGH" },
      update: { urgency: "HIGH" },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "admin-1",
        entityType: "NOTIFICATION_SOUND_RULE",
        action: "NOTIFICATION_SOUND_RULE_CREATED",
        before: { kind: "INCIDENT_STATUS_CHANGED", level: 1, urgency: "NORMAL" },
        correlationId: "corr-1",
      }),
      tx,
    );
    expect(result).toMatchObject({ urgency: "HIGH", isDefault: false });
  });

  it("drops the cache so the next resolve sees the change", async () => {
    const { service, prisma } = makeService();
    await service.resolve(InAppNotificationKind.SLA_WARNING, 1);

    await service.set(InAppNotificationKind.SLA_WARNING, 1, NotificationUrgency.SILENT, ACTOR);
    await service.resolve(InAppNotificationKind.SLA_WARNING, 1);

    expect(prisma.notificationSoundRule.findMany).toHaveBeenCalledTimes(2);
  });
});
