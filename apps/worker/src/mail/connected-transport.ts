import type { RenderedEmail } from "@cts-dc-opsdesk/email-adapter";
import type { MailTransport } from "./transport";

/** Shared delivery keeps provider credentials in the API and resolves Reply-To from the actor. */
export class ConnectedMailTransport implements MailTransport {
  constructor(
    private readonly system: MailTransport,
    private readonly baseUrl = process.env.OPSDESK_API_URL,
    private readonly key = process.env.MAIL_WORKER_KEY,
    private readonly sharedSender = process.env.MAIL_SHARED_SENDER_EMAIL,
  ) {}

  async send(email: RenderedEmail, senderUserId?: string): Promise<void> {
    if (!senderUserId && !this.sharedSender) {
      await this.system.send(email);
      return;
    }
    if (!this.baseUrl || !this.key)
      throw new Error("Shared mail delivery requires OPSDESK_API_URL and MAIL_WORKER_KEY");
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/sending-mail/deliver`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mail-worker-key": this.key },
      body: JSON.stringify({ userId: senderUserId, email }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(
        `Shared email delivery failed (${response.status}); check the shared mailbox connection. No fallback email was sent.`,
      );
  }
}
