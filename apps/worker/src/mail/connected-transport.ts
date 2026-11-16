import type { RenderedEmail } from "@cts-dc-opsdesk/email-adapter";
import type { MailTransport } from "./transport";

/** Personal delivery keeps provider credentials in the API, outside the queue payload. */
export class ConnectedMailTransport implements MailTransport {
  constructor(
    private readonly system: MailTransport,
    private readonly baseUrl = process.env.OPSDESK_API_URL,
    private readonly key = process.env.MAIL_WORKER_KEY,
  ) {}

  async send(email: RenderedEmail, senderUserId?: string): Promise<void> {
    if (!senderUserId) {
      await this.system.send(email);
      return;
    }
    if (!this.baseUrl || !this.key)
      throw new Error("Personal mail delivery requires OPSDESK_API_URL and MAIL_WORKER_KEY");
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/sending-mail/deliver`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mail-worker-key": this.key },
      body: JSON.stringify({ userId: senderUserId, email }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(
        `Personal email delivery failed (${response.status}); check the sender's mailbox connection. No fallback email was sent.`,
      );
  }
}
