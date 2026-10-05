import { UserRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { ownIncidentsFilter, seesOwnIncidentsOnly } from "./incident-visibility";

function userWith(role: UserRole): AuthenticatedUser {
  return { id: "user-1", email: "user@example.com", role, isActive: true };
}

describe("incident visibility", () => {
  it("limits a Site Engineer to incidents they own or are currently offered", () => {
    expect(ownIncidentsFilter(userWith(UserRole.SITE_ENGINEER))).toEqual({
      OR: [
        { ownerUserId: "user-1" },
        { routingOffers: { some: { userId: "user-1", status: "PENDING" } } },
      ],
    });
  });

  it("leaves every other role with the site-wide view", () => {
    const others = Object.values(UserRole).filter((role) => role !== UserRole.SITE_ENGINEER);
    for (const role of others) {
      expect(seesOwnIncidentsOnly(userWith(role))).toBe(false);
      expect(ownIncidentsFilter(userWith(role))).toBeNull();
    }
  });
});
