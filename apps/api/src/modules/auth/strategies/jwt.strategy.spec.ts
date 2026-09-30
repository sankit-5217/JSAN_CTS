import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
  const activeUser = {
    id: "user-1",
    email: "admin@example.com",
    role: UserRole.SUPER_ADMIN,
    isActive: true,
    sessionVersion: 2,
  };

  function makeStrategy(findUniqueResult: unknown) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(findUniqueResult) },
    } as unknown as PrismaService;
    const config = { get: jest.fn().mockReturnValue("test-secret") } as unknown as ConfigService;
    return { strategy: new JwtStrategy(prisma, config), prisma };
  }

  it("returns the authenticated user shape for an active user", async () => {
    const { strategy } = makeStrategy(activeUser);
    const result = await strategy.validate({
      sub: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
      sv: 2,
    });
    expect(result).toEqual({
      id: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
      isActive: true,
    });
  });

  it("rejects when the user no longer exists", async () => {
    const { strategy } = makeStrategy(null);
    await expect(
      strategy.validate({
        sub: "gone",
        email: "gone@example.com",
        role: UserRole.SITE_ENGINEER,
        sv: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a deactivated user even with a still-valid token", async () => {
    const { strategy } = makeStrategy({ ...activeUser, isActive: false });
    await expect(
      strategy.validate({
        sub: activeUser.id,
        email: activeUser.email,
        role: activeUser.role,
        sv: 2,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a same-secret token that carries no user subject (e.g. the social sign-in cookie)", async () => {
    const { strategy, prisma } = makeStrategy(activeUser);
    await expect(
      strategy.validate({ state: "s", nonce: "n" } as unknown as Parameters<
        JwtStrategy["validate"]
      >[0]),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a session issued before the user's last password change", async () => {
    const { strategy } = makeStrategy(activeUser);
    await expect(
      strategy.validate({
        sub: activeUser.id,
        email: activeUser.email,
        role: activeUser.role,
        sv: 1,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a token with no session version (e.g. an old dev-login token)", async () => {
    const { strategy } = makeStrategy(activeUser);
    await expect(
      strategy.validate({
        sub: activeUser.id,
        email: activeUser.email,
        role: activeUser.role,
      } as unknown as Parameters<JwtStrategy["validate"]>[0]),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
