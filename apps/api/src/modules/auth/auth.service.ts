import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { User } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { JwtPayload } from "./types/jwt-payload.type";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Dev-login lookup: no password store (spec §17 forbids a custom weak
   * password store in production, so we don't build one at all — this is
   * a bootstrap path for local dev/testing only, replaced by a real
   * OIDC/IdP login in a later sprint).
   */
  async validateUserByEmail(email: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      // Same message for "not found" and "inactive" — don't leak which one.
      throw new UnauthorizedException("No active user found for this email");
    }
    return user;
  }

  issueToken(user: User): { accessToken: string; expiresIn: string } {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const expiresIn = "12h";
    return { accessToken: this.jwtService.sign(payload, { expiresIn }), expiresIn };
  }
}
