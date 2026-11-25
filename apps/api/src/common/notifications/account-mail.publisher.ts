import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { AccountEmail } from "@cts-dc-opsdesk/email-adapter";
import { ResilientQueue } from "../queue/resilient-queue";

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
  private readonly queue = new ResilientQueue<AccountEmail>({
    queueName: ACCOUNT_MAIL_QUEUE_NAME,
    redisUrl: process.env.REDIS_URL,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    },
    logger: this.logger,
    // Not held: the admin is told "copy the link instead" right away, so a
    // late send would duplicate a live secret.
    holdMax: 0,
  });

  /** True when the email was handed to the queue; never throws. */
  async send(mail: AccountEmail): Promise<boolean> {
    const result = await this.queue.add(mail.kind, mail);
    if (result !== "queued") {
      this.logger.warn(`${mail.kind} email to ${mail.to.email} not sent`);
    }
    return result === "queued";
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
