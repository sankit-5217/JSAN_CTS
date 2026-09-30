import { PrismaService } from "../../common/prisma/prisma.service";
import { IncidentUserChecksListener } from "./incident-user-checks.listener";
import { OPEN_STATUSES } from "./incident-transitions";

function make(count: number, numbers: string[] = []) {
  const prisma = {
    incident: {
      count: jest.fn().mockResolvedValue(count),
      findMany: jest.fn().mockResolvedValue(numbers.map((incidentNo) => ({ incidentNo }))),
    },
  } as unknown as PrismaService;
  return { listener: new IncidentUserChecksListener(prisma), prisma };
}

describe("IncidentUserChecksListener", () => {
  it("allows deactivation when the user owns no open incidents", async () => {
    const { listener, prisma } = make(0);
    await expect(listener.onDeactivationCheck({ userId: "u-1" })).resolves.toBeNull();
    expect(prisma.incident.count).toHaveBeenCalledWith({
      where: { ownerUserId: "u-1", status: { in: OPEN_STATUSES } },
    });
  });

  it("blocks with the count and up to 5 incident numbers", async () => {
    const { listener, prisma } = make(7, ["INC-1", "INC-2", "INC-3", "INC-4", "INC-5"]);
    await expect(listener.onDeactivationCheck({ userId: "u-1" })).resolves.toEqual({
      source: "incidents",
      message: "owns 7 open incidents — reassign them first",
      examples: ["INC-1", "INC-2", "INC-3", "INC-4", "INC-5"],
    });
    expect(prisma.incident.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
  });
});
