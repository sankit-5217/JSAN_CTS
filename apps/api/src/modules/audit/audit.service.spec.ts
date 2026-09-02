import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "./audit.service";

describe("AuditService", () => {
  function makePrismaLike() {
    return { auditEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) } };
  }

  it("writes via the injected PrismaService when no transaction client is given", async () => {
    const prisma = makePrismaLike() as unknown as PrismaService;
    const service = new AuditService(prisma);

    await service.record({
      actorId: "user-1",
      entityType: "Site",
      entityId: "site-1",
      action: "CREATE",
      after: { code: "SITE01" },
      correlationId: "corr-1",
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: "user-1",
        entityType: "Site",
        entityId: "site-1",
        action: "CREATE",
        before: undefined,
        after: { code: "SITE01" },
        correlationId: "corr-1",
      },
    });
  });

  it("writes via the given transaction client when one is passed", async () => {
    const prisma = makePrismaLike() as unknown as PrismaService;
    const tx = makePrismaLike() as unknown as Prisma.TransactionClient;
    const service = new AuditService(prisma);

    await service.record({ entityType: "Site", entityId: "site-1", action: "CREATE" }, tx);

    expect(tx.auditEvent.create).toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it("omits actorId/before/after/correlationId when not provided, rather than writing null", async () => {
    const prisma = makePrismaLike() as unknown as PrismaService;
    const service = new AuditService(prisma);

    await service.record({ entityType: "Site", entityId: "site-1", action: "CREATE" });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: undefined,
        entityType: "Site",
        entityId: "site-1",
        action: "CREATE",
        before: undefined,
        after: undefined,
        correlationId: undefined,
      },
    });
  });
});
