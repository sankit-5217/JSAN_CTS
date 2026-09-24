import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InAppNotificationKind, UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { DEFAULT_RETENTION_DAYS, InAppNotificationInput, InboxService } from "./inbox.service";

const USER = {
  id: "user-1",
  email: "user1@example.com",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
} as AuthenticatedUser;

function makeService(
  opts: {
    activeUsers?: { id: string }[];
    createMany?: jest.Mock;
    findFirst?: jest.Mock;
    retention?: string;
  } = {},
) {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue(opts.activeUsers ?? []),
    },
    inAppNotification: {
      createMany: opts.createMany ?? jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ id: "n-1" }]),
      count: jest.fn().mockResolvedValue(3),
      findFirst: opts.findFirst ?? jest.fn().mockResolvedValue(null),
      update: jest
        .fn()
        .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 4 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  } as unknown as PrismaService;
  const config = {
    get: jest.fn().mockReturnValue(opts.retention),
  } as unknown as ConfigService;
  return { service: new InboxService(prisma, config), prisma };
}

function input(overrides: Partial<InAppNotificationInput> = {}): InAppNotificationInput {
  return {
    userIds: ["user-1"],
    kind: InAppNotificationKind.INCIDENT_ASSIGNED,
    title: "INC-000001 assigned to you",
    body: "Server unresponsive",
    entityType: "INCIDENT",
    entityId: "incident-1",
    dedupeKey: "assigned:incident-1:user-1:1",
    ...overrides,
  };
}

describe("InboxService.notifyUsers", () => {
  it("writes one row per active recipient, skipping duplicates", async () => {
    const { service, prisma } = makeService({ activeUsers: [{ id: "user-1" }, { id: "user-2" }] });

    await service.notifyUsers(input({ userIds: ["user-1", "user-2"] }));

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["user-1", "user-2"] }, isActive: true },
      select: { id: true },
    });
    expect(prisma.inAppNotification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: "user-1", dedupeKey: "assigned:incident-1:user-1:1" }),
        expect.objectContaining({ userId: "user-2", dedupeKey: "assigned:incident-1:user-1:1" }),
      ],
      skipDuplicates: true,
    });
  });

  it("drops the actor, blanks and repeats before looking anyone up", async () => {
    const { service, prisma } = makeService({ activeUsers: [{ id: "user-2" }] });

    await service.notifyUsers(
      input({ userIds: ["actor-1", "user-2", null, undefined, "user-2"], actorUserId: "actor-1" }),
    );

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["user-2"] }, isActive: true } }),
    );
  });

  it("does nothing when the only recipient is the actor", async () => {
    const { service, prisma } = makeService();

    await service.notifyUsers(input({ userIds: ["user-1"], actorUserId: "user-1" }));

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.inAppNotification.createMany).not.toHaveBeenCalled();
  });

  it("does nothing when no recipient is active", async () => {
    const { service, prisma } = makeService({ activeUsers: [] });

    await service.notifyUsers(input());

    expect(prisma.inAppNotification.createMany).not.toHaveBeenCalled();
  });

  it("generates a key when the caller has none", async () => {
    const { service, prisma } = makeService({ activeUsers: [{ id: "user-1" }] });

    await service.notifyUsers(input({ dedupeKey: undefined }));

    const [{ data }] = (prisma.inAppNotification.createMany as jest.Mock).mock.calls[0];
    expect(data[0].dedupeKey).toEqual(expect.any(String));
    expect(data[0].dedupeKey.length).toBeGreaterThan(0);
  });

  it("swallows a database failure instead of throwing at the caller", async () => {
    const { service } = makeService({
      activeUsers: [{ id: "user-1" }],
      createMany: jest.fn().mockRejectedValue(new Error("db down")),
    });

    await expect(service.notifyUsers(input())).resolves.toBeUndefined();
  });
});

describe("InboxService reads and read state", () => {
  it("lists only the caller's rows, newest first, with their unread count", async () => {
    const { service, prisma } = makeService();

    const result = await service.listForUser(USER, 10);

    expect(prisma.inAppNotification.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    expect(prisma.inAppNotification.count).toHaveBeenCalledWith({
      where: { userId: "user-1", readAt: null },
    });
    expect(result).toEqual({ items: [{ id: "n-1" }], unreadCount: 3 });
  });

  it("defaults the page size to 20 and caps it at 50", async () => {
    const { service, prisma } = makeService();

    await service.listForUser(USER);
    await service.listForUser(USER, 500);

    const takes = (prisma.inAppNotification.findMany as jest.Mock).mock.calls.map(
      ([args]) => args.take,
    );
    expect(takes).toEqual([20, 50]);
  });

  it("marks the caller's own notification read", async () => {
    const { service, prisma } = makeService({
      findFirst: jest.fn().mockResolvedValue({ id: "n-1", userId: "user-1", readAt: null }),
    });

    const result = await service.markRead("n-1", USER);

    expect(prisma.inAppNotification.findFirst).toHaveBeenCalledWith({
      where: { id: "n-1", userId: "user-1" },
    });
    expect(result.readAt).toBeInstanceOf(Date);
  });

  it("leaves an already-read notification alone", async () => {
    const readAt = new Date("2026-09-20T00:00:00Z");
    const { service, prisma } = makeService({
      findFirst: jest.fn().mockResolvedValue({ id: "n-1", userId: "user-1", readAt }),
    });

    await expect(service.markRead("n-1", USER)).resolves.toMatchObject({ readAt });
    expect(prisma.inAppNotification.update).not.toHaveBeenCalled();
  });

  it("404s on someone else's notification", async () => {
    const { service } = makeService({ findFirst: jest.fn().mockResolvedValue(null) });

    await expect(service.markRead("n-other", USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("marks all of the caller's unread notifications read", async () => {
    const { service, prisma } = makeService();

    await expect(service.markAllRead(USER)).resolves.toEqual({ updated: 4 });
    expect(prisma.inAppNotification.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});

describe("InboxService retention", () => {
  const NOW = new Date("2026-09-24T03:00:00Z");

  it("purges rows older than the default 90 days", async () => {
    const { service, prisma } = makeService();

    await expect(service.purgeExpired(NOW)).resolves.toBe(2);
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
    expect(prisma.inAppNotification.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-06-26T03:00:00Z") } },
    });
  });

  it("uses NOTIFICATION_RETENTION_DAYS when set", async () => {
    const { service, prisma } = makeService({ retention: "7" });

    await service.purgeExpired(NOW);

    expect(prisma.inAppNotification.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-09-17T03:00:00Z") } },
    });
  });

  it("falls back to 90 days on a nonsense setting", async () => {
    for (const retention of ["0", "-5", "abc", "2.5"]) {
      expect(makeService({ retention }).service.retentionDays()).toBe(90);
    }
  });
});
