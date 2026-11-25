import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { User } from "@prisma/client";
import { JwtPayload } from "./types/jwt-payload.type";

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  /** The app session every sign-in ends in. */
  issueToken(user: User): { accessToken: string; expiresIn: string; mustChangePassword: boolean } {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sv: user.sessionVersion,
      ...(user.mustChangePassword ? { pwc: true as const } : {}),
    };
    const expiresIn = "12h";
    return {
      accessToken: this.jwtService.sign(payload, { expiresIn }),
      expiresIn,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
