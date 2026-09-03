import type { RenderedEmail } from "@cts-dc-opsdesk/email-adapter";

/**
 * How a rendered notification actually leaves the building. The production SMTP
 * transport (nodemailer, config from env) drops in here behind the same
 * interface — the notifications worker only knows about this contract.
 */
export interface MailTransport {
  send(email: RenderedEmail): Promise<void>;
}

/**
 * Default / dev transport: logs the message instead of sending it. Keeps the
 * worker runnable (and the pipeline demoable) with no mail server, and no
 * nodemailer dependency until the real transport lands.
 */
export class ConsoleMailTransport implements MailTransport {
  constructor(private readonly from: string = process.env.MAIL_FROM ?? "opsdesk@localhost") {}

  async send(email: RenderedEmail): Promise<void> {
    const preview = email.text
      .split("\n")
      .map((line) => `  | ${line}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.log(
      `[mail] from=${this.from} to=${email.to.join(", ")}` +
        (email.cc?.length ? ` cc=${email.cc.join(", ")}` : "") +
        ` subject=${JSON.stringify(email.subject)}\n${preview}`,
    );
  }
}
