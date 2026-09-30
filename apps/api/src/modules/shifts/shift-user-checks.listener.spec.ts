import { UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ShiftUserChecksListener } from "./shift-user-checks.listener";

function make(labels: string[]) {
  const prisma = {
    engineerShift: { findMany: jest.fn().mockResolvedValue(labels.map((label) => ({ label }))) },
  } as unknown as PrismaService;
  return { listener: new ShiftUserChecksListener(prisma), prisma };
}

const check = (toRole: UserRole) => ({ userId: "u-1", fromRole: UserRole.SITE_ENGINEER, toRole });

describe("ShiftUserChecksListener", () => {
  it("ignores moves to another engineer role", async () => {
    const { listener, prisma } = make(["Day"]);
    await expect(
      listener.onRoleChangeCheck(check(UserRole.INFRASTRUCTURE_LEAD)),
    ).resolves.toBeNull();
    expect(prisma.engineerShift.findMany).not.toHaveBeenCalled();
  });

  it("blocks on active shifts only", async () => {
    const { listener, prisma } = make(["Day shift"]);
    await expect(
      listener.onRoleChangeCheck(check(UserRole.AUDITOR_READ_ONLY)),
    ).resolves.toMatchObject({
      source: "shifts",
      message: "has 1 active shift — disable it on Team & Shifts first",
    });
    expect(prisma.engineerShift.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u-1", isActive: true } }),
    );
  });
});
