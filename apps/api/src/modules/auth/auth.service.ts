import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { User } from "@prisma/client";
import { JwtPayload } from "./types/jwt-payload.type";

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  /** The app session every sign-in path (password, social) ends in. */
  issueToken(user: User): { accessToken: string; expiresIn: string } {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sv: user.sessionVersion,
    };
    const expiresIn = "12h";
    return { accessToken: this.jwtService.sign(payload, { expiresIn }), expiresIn };
  }
}
