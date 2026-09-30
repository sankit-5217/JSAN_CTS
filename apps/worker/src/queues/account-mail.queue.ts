import { Job, Worker } from "bullmq";
import { renderAccountEmail } from "@cts-dc-opsdesk/email-adapter";
import type { AccountEmail } from "@cts-dc-opsdesk/email-adapter";
import { MailTransport } from "../mail/transport";
import { createRedisConnection } from "../redis";

/** Must match ACCOUNT_MAIL_QUEUE_NAME in apps/api (AccountMailPublisher). */
export const ACCOUNT_MAIL_QUEUE_NAME = "account-mail";

/** Render + send one account email (invite / password reset). Exported for tests. */
export async function processAccountMailJob(
  data: AccountEmail,
  transport: MailTransport,
): Promise<void> {
  await transport.send(renderAccountEmail(data));
}

/**
 * Sign-in links are secrets until used, so the API enqueues these jobs with
 * removeOnComplete — the job (and its link) is gone from Redis once sent.
 */
export function createAccountMailWorker(transport: MailTransport): Worker<AccountEmail> {
  return new Worker<AccountEmail>(
    ACCOUNT_MAIL_QUEUE_NAME,
    async (job: Job<AccountEmail>) => {
      await processAccountMailJob(job.data, transport);
    },
    { connection: createRedisConnection() },
  );
}
