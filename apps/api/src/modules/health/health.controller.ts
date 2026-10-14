import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../../common/prisma/prisma.service";

/** How long the database may take to answer before the instance counts as unhealthy. */
const DB_CHECK_TIMEOUT_MS = 3_000;

/**
 * Railway's health check (and any load balancer) hits GET /api/v1/health:
 * it answers 200 only when this instance can reach Postgres, so a deploy
 * that can't talk to the database is never switched in and a broken
 * instance stops getting traffic. /health/live only says the process is up.
 */
@ApiTags("health")
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "Ready: the API is up and can reach its database (503 otherwise)" })
  async check() {
    const started = Date.now();
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("database check timed out")), DB_CHECK_TIMEOUT_MS).unref(),
        ),
      ]);
    } catch (err) {
      throw new ServiceUnavailableException({
        status: "unavailable",
        service: "cts-dc-opsdesk-api",
        database: "unreachable",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    return {
      status: "ok",
      service: "cts-dc-opsdesk-api",
      database: "ok",
      databaseLatencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  @Get("live")
  @ApiOperation({ summary: "Live: the process is running (no dependency checks)" })
  live() {
    return { status: "ok", service: "cts-dc-opsdesk-api", timestamp: new Date().toISOString() };
  }
}
