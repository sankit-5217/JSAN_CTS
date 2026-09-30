import { UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { SkillUserChecksListener } from "./skill-user-checks.listener";

function make(skillNames: string[]) {
  const prisma = {
    userSkill: {
      findMany: jest.fn().mockResolvedValue(skillNames.map((name) => ({ skill: { name } }))),
    },
  } as unknown as PrismaService;
  return { listener: new SkillUserChecksListener(prisma), prisma };
}

const check = (toRole: UserRole) => ({ userId: "u-1", fromRole: UserRole.SITE_ENGINEER, toRole });

describe("SkillUserChecksListener", () => {
  it("ignores moves to another engineer role without querying", async () => {
    const { listener, prisma } = make(["Dell"]);
    await expect(
      listener.onRoleChangeCheck(check(UserRole.INFRASTRUCTURE_LEAD)),
    ).resolves.toBeNull();
    expect(prisma.userSkill.findMany).not.toHaveBeenCalled();
  });

  it("blocks a move to a non-engineer role while skills remain", async () => {
    const { listener } = make(["Dell PowerEdge", "HPE iLO"]);
    await expect(
      listener.onRoleChangeCheck(check(UserRole.SERVICE_DESK_NOC)),
    ).resolves.toMatchObject({
      source: "skills",
      message: expect.stringContaining("holds 2 skills"),
      examples: ["Dell PowerEdge", "HPE iLO"],
    });
  });

  it("allows it once no skills remain", async () => {
    const { listener } = make([]);
    await expect(listener.onRoleChangeCheck(check(UserRole.SERVICE_DESK_NOC))).resolves.toBeNull();
  });
});
