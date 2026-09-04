import type {
  WarrantyLookupResult,
  WarrantyProvider,
} from "@cts-dc-opsdesk/warranty-adapter";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { WarrantyResyncService } from "./warranty-resync.service";

type PrismaMock = {
  configurationItem: { findMany: jest.Mock };
  warranty: { findFirst: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    configurationItem: { findMany: jest.fn() },
    warranty: { findFirst: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  // The callback gets the mock itself standing in as the transaction client.
  mock.$transaction.mockImplementation((fn: (tx: PrismaMock) => unknown) => fn(mock));
  return mock;
}

const ACTOR = { actorId: "user-1", correlationId: "corr-1" };
const DELL_EXPIRY = "2027-05-01T00:00:00.000Z";

function ci(overrides: Record<string, unknown> = {}) {
  return {
    id: "ci-1",
    ciCode: "CI-0001",
    manufacturer: "Dell",
    serialOrServiceTag: "ABC1234",
    ...overrides,
  };
}

describe("WarrantyResyncService", () => {
  let prisma: PrismaMock;
  let audit: { record: jest.Mock };
  let dellLookup: jest.Mock;
  let providers: WarrantyProvider[];
  let service: WarrantyResyncService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn() };
    dellLookup = jest.fn().mockResolvedValue({
      status: "ACTIVE",
      provider: "dell-techdirect",
      expiresAt: DELL_EXPIRY,
    } satisfies WarrantyLookupResult);
    const dell: WarrantyProvider = {
      name: "dell-techdirect",
      supports: (vendor: string) => vendor.trim().toUpperCase() === "DELL",
      lookup: (query) => dellLookup(query),
    };
    providers = [dell];
    service = new WarrantyResyncService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      providers,
    );
  });

  it("sweeps every tagged CI when no ids are given", async () => {
    prisma.configurationItem.findMany.mockResolvedValue([]);

    await service.run(ACTOR);

    expect(prisma.configurationItem.findMany).toHaveBeenCalledWith({
      where: { serialOrServiceTag: { not: null } },
      select: { id: true, ciCode: true, manufacturer: true, serialOrServiceTag: true },
    });
  });

  it("restricts the sweep to the given ci ids", async () => {
    prisma.configurationItem.findMany.mockResolvedValue([]);

    await service.run(ACTOR, { ciIds: ["ci-7", "ci-8"] });

    expect(prisma.configurationItem.findMany).toHaveBeenCalledWith({
      where: { serialOrServiceTag: { not: null }, id: { in: ["ci-7", "ci-8"] } },
      select: { id: true, ciCode: true, manufacturer: true, serialOrServiceTag: true },
    });
  });

  it("appends a warranty row + WARRANTY_REFRESHED audit event when coverage is new", async () => {
    prisma.configurationItem.findMany.mockResolvedValue([ci()]);
    prisma.warranty.findFirst.mockResolvedValue(null);
    prisma.warranty.create.mockResolvedValue({ id: "w-1", status: "ACTIVE" });

    const summary = await service.run(ACTOR);

    expect(dellLookup).toHaveBeenCalledWith({ vendor: "Dell", serialOrServiceTag: "ABC1234" });
    expect(prisma.warranty.create).toHaveBeenCalledWith({
      data: {
        ciId: "ci-1",
        status: "ACTIVE",
        provider: "dell-techdirect",
        expiresAt: new Date(DELL_EXPIRY),
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        correlationId: "corr-1",
        entityType: "warranty",
        entityId: "ci-1",
        action: "WARRANTY_REFRESHED",
      }),
      prisma,
    );
    expect(summary).toEqual({ checked: 1, updated: 1, unchanged: 0, skipped: [], failed: [] });
  });

  it("writes nothing when the latest warranty already matches", async () => {
    prisma.configurationItem.findMany.mockResolvedValue([ci()]);
    prisma.warranty.findFirst.mockResolvedValue({
      id: "w-0",
      status: "ACTIVE",
      provider: "dell-techdirect",
      expiresAt: new Date(DELL_EXPIRY),
    });

    const summary = await service.run(ACTOR);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.warranty.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(summary.unchanged).toBe(1);
    expect(summary.updated).toBe(0);
  });

  it("appends a new row when only the expiry date moved", async () => {
    prisma.configurationItem.findMany.mockResolvedValue([ci()]);
    prisma.warranty.findFirst.mockResolvedValue({
      id: "w-0",
      status: "ACTIVE",
      provider: "dell-techdirect",
      expiresAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    prisma.warranty.create.mockResolvedValue({ id: "w-1" });

    const summary = await service.run(ACTOR);

    expect(prisma.warranty.create).toHaveBeenCalled();
    expect(audit.record.mock.calls[0][0].before).toEqual(expect.objectContaining({ id: "w-0" }));
    expect(summary.updated).toBe(1);
  });

  it("skips a CI with no manufacturer", async () => {
    prisma.configurationItem.findMany.mockResolvedValue([ci({ manufacturer: null })]);

    const summary = await service.run(ACTOR);

    expect(dellLookup).not.toHaveBeenCalled();
    expect(summary.skipped).toEqual([
      { ciCode: "CI-0001", reason: "CI has no manufacturer or service tag" },
    ]);
  });

  it("skips a CI whose manufacturer has no configured provider", async () => {
    prisma.configurationItem.findMany.mockResolvedValue([ci({ manufacturer: "Supermicro" })]);

    const summary = await service.run(ACTOR);

    expect(summary.checked).toBe(1);
    expect(summary.skipped).toEqual([
      { ciCode: "CI-0001", reason: 'no warranty provider for "Supermicro"' },
    ]);
  });

  it("records a provider failure and keeps processing the rest of the batch", async () => {
    dellLookup.mockRejectedValueOnce(new Error("Dell API 503"));
    prisma.configurationItem.findMany.mockResolvedValue([
      ci({ id: "ci-1", ciCode: "CI-0001" }),
      ci({ id: "ci-2", ciCode: "CI-0002" }),
    ]);
    prisma.warranty.findFirst.mockResolvedValue(null);
    prisma.warranty.create.mockResolvedValue({ id: "w-2" });

    const summary = await service.run(ACTOR);

    expect(summary.failed).toEqual([{ ciCode: "CI-0001", reason: "Dell API 503" }]);
    expect(summary.updated).toBe(1);
    expect(summary.checked).toBe(2);
  });
});
