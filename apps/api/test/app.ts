import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerStorage } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import type { Server } from "node:http";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { correlationIdMiddleware } from "../src/common/middleware/correlation-id.middleware";

type Agent = ReturnType<typeof request>;

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  http: () => Agent;
  /** dev-login as a seeded e2e user, return the bearer token. */
  tokenFor: (email: string) => Promise<string>;
  close: () => Promise<void>;
}

/**
 * Boot the real AppModule the way `main.ts` does (global prefix, the same
 * ValidationPipe, correlation middleware) — minus Swagger, and with the
 * app-wide rate limiter disabled so a test file can make more than 100
 * requests / 5 dev-logins a minute.
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // App-wide rate limiter off for e2e: a spec makes far more than 100 req /
    // 5 dev-logins a minute. Stub the guard, and the storage it leans on, so
    // the APP_GUARD registration in AppModule can't re-throttle.
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .overrideProvider(ThrottlerStorage)
    .useValue({
      increment: async () => ({
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(correlationIdMiddleware);
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const http = (): Agent => request(app.getHttpServer() as Server);

  const tokenFor = async (email: string): Promise<string> => {
    const res = await http().post("/api/v1/auth/dev-login").send({ email }).expect(201);
    return res.body.accessToken as string;
  };

  return {
    app,
    prisma,
    http,
    tokenFor,
    close: () => app.close(),
  };
}
