import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** Longest a locked job may run before its transaction (and lock) is released. */
const MAX_JOB_MS = 10 * 60_000;

/**
 * Runs a scheduled job on one API instance at a time. Every instance's
 * @Cron fires — with two replicas, and briefly during every Railway deploy
 * while old and new overlap — so without this the SLA scanner, routing
 * offer expiry and inbox purge would each run twice and, for example,
 * record an SLA breach twice. A Postgres advisory lock (no new
 * infrastructure) decides who runs; the others skip that tick quietly.
 *
 * The lock is transaction-scoped, so it is released however the job ends,
 * including a crash.
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** True when this instance ran the job, false when another instance holds it. */
  async runExclusive(name: string, job: () => Promise<unknown>): Promise<boolean> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${`opsdesk-job:${name}`})) AS locked`;
          if (!row?.locked) {
            return false;
          }
          await job();
          return true;
        },
        { timeout: MAX_JOB_MS, maxWait: 5_000 },
      );
    } catch (err) {
      this.logger.error(
        `scheduled job ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
