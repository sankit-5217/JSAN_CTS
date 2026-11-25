import { PrismaService } from "../../common/prisma/prisma.service";
import { IncidentSiteChecksListener } from "./incident-site-checks.listener";

function make(count: number) {
  const prisma = {
    incident: {
      count: jest.fn().mockResolvedValue(count),
      findMany: jest
        .fn()
        .mockResolvedValue(
          [{ incidentNo: "INC-000101" }, { incidentNo: "INC-000102" }].slice(0, count),
        ),
    },
  };
  return { listener: new IncidentSiteChecksListener(prisma as unknown as PrismaService), prisma };
}

describe("IncidentSiteChecksListener (rubric T10)", () => {
  it("blocks deleting a site that still has open tickets, naming them", async () => {
    const { listener, prisma } = make(2);
    const blocker = await listener.onArchiveCheck({ siteId: "site-1" });
    expect(blocker).toEqual({
      source: "incidents",
      message: "it has 2 open tickets — resolve, close or cancel them first",
      examples: ["INC-000101", "INC-000102"],
    });
    expect(prisma.incident.count).toHaveBeenCalledWith({
      where: { siteId: "site-1", status: { in: expect.arrayContaining(["NEW", "IN_PROGRESS"]) } },
    });
  });

  it("allows it when every ticket is finished", async () => {
    const { listener } = make(0);
    await expect(listener.onArchiveCheck({ siteId: "site-1" })).resolves.toBeNull();
  });
});
