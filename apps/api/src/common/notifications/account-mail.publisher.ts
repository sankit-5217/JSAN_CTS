import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { AccountEmail } from "@cts-dc-opsdesk/email-adapter";
import { Queue } from "bullmq";
import IORedis from "ioredis";

/** Must match `ACCOUNT_MAIL_QUEUE_NAME` in apps/worker. */
export const ACCOUNT_MAIL_QUEUE_NAME = "account-mail";

/**
 * Enqueues invite / password-reset emails for the worker. Unlike
 * NotificationsPublisher this reports whether the job was queued, so the
 * admin UI can say "email sent" vs "copy the link instead". Jobs are removed
 * from Redis as soon as they're sent — the link inside is a live secret.
 */
@Injectable()
export class AccountMailPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(AccountMailPublisher.name);
  private readonly url = process.env.REDIS_URL;
  private queue: Queue<AccountEmail> | null = null;
  private connection: IORedis | null = null;

  private ensureQueue(): Queue<AccountEmail> | null {
    if (this.queue) return this.queue;
    if (!this.url) return null;
    this.connection = new IORedis(this.url, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2_000)),
    });
    this.connection.on("error", (err) =>
      this.logger.warn(`account-mail Redis error: ${err.message}`),
    );
    this.queue = new Queue<AccountEmail>(ACCOUNT_MAIL_QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      },
    });
    return this.queue;
  }

  /** True when the email was handed to the queue; never throws. */
  async send(mail: AccountEmail): Promise<boolean> {
    const queue = this.ensureQueue();
    if (!queue) {
      this.logger.warn(`REDIS_URL unset — ${mail.kind} email to ${mail.to.email} not sent`);
      return false;
    }
    try {
      const add = queue.add(mail.kind, mail);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("enqueue timed out")), 2_000).unref(),
      );
      await Promise.race([add, timeout]);
      return true;
    } catch (err) {
      this.logger.warn(
        `failed to enqueue ${mail.kind} for ${mail.to.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
    await this.connection?.quit().catch(() => undefined);
  }
}
