import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SitesService } from "./sites.service";

describe("SitesService.create", () => {
  it("creates the site and audits it inside the same transaction", async () => {
    const createdSite = {
      id: "site-1",
      code: "SITE01",
      name: "Demo",
      timezone: "UTC",
      is247: false,
    };
    const tx = { site: { create: jest.fn().mockResolvedValue(createdSite) } };
    const prisma = {
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    const auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    const service = new SitesService(prisma, auditService);
    const result = await service.create(
      { code: "SITE01", name: "Demo", timezone: "UTC", is247: false },
      { actorId: "user-1", correlationId: "corr-1" },
    );

    expect(result).toBe(createdSite);
    expect(tx.site.create).toHaveBeenCalledWith({
      data: { code: "SITE01", name: "Demo", timezone: "UTC", is247: false },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        entityType: "Site",
        entityId: "site-1",
        action: "CREATE",
        after: createdSite,
        correlationId: "corr-1",
      }),
      tx,
    );
  });
});
