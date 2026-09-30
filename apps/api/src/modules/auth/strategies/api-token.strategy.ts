import { Injectable, OnModuleInit } from "@nestjs/common";
import { Request } from "express";
import passport from "passport";
import { Strategy } from "passport-strategy";
import { ApiTokensService } from "../api-tokens.service";
import { AuthenticatedUser } from "../types/jwt-payload.type";

const BEARER_API_TOKEN = /^Bearer\s+(odk_\S+)$/i;

/** Passport strategy "api-token": `Authorization: Bearer odk_...`. */
export class ApiTokenPassportStrategy extends Strategy {
  name = "api-token";

  constructor(private readonly verify: (token: string) => Promise<AuthenticatedUser | null>) {
    super();
  }

  authenticate(req: Request): void {
    const match = BEARER_API_TOKEN.exec(req.headers.authorization ?? "");
    // Not an API token: fail quietly so the next strategy (jwt) gets a turn.
    if (!match) return this.fail(401);
    this.verify(match[1]).then(
      (user) => (user ? this.success(user) : this.fail(401)),
      (err: unknown) => this.error(err instanceof Error ? err : new Error(String(err))),
    );
  }
}

/**
 * Registers the strategy with passport at startup. JwtAuthGuard tries it
 * before "jwt", so every existing @UseGuards(JwtAuthGuard) route accepts
 * machine API tokens with no per-module wiring (the guard itself stays
 * dependency-free).
 */
@Injectable()
export class ApiTokenStrategy implements OnModuleInit {
  constructor(private readonly tokens: ApiTokensService) {}

  onModuleInit(): void {
    passport.use(new ApiTokenPassportStrategy((token) => this.tokens.authenticate(token)));
  }
}
