import type { RenderedEmail } from "@cts-dc-opsdesk/email-adapter";
import nodemailer from "nodemailer";

/**
 * How a rendered email actually leaves the building. The queues only know
 * this contract; `createMailTransportFromEnv` picks SMTP when configured.
 */
export interface MailTransport {
  send(email: RenderedEmail): Promise<void>;
}

/**
 * Dev fallback: logs the message instead of sending it. Keeps the worker
 * runnable (and the pipeline demoable) with no mail server.
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

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = implicit TLS (usually port 465); false = STARTTLS upgrade (587). */
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Real delivery over SMTP (Microsoft 365, Google Workspace, SES, Postfix...). */
export class SmtpMailTransport implements MailTransport {
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly config: SmtpConfig,
    transporter?: nodemailer.Transporter,
  ) {
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        // STARTTLS is mandatory when not using implicit TLS — never send
        // sign-in links over a plaintext connection.
        requireTLS: !config.secure,
        auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
      });
  }

  async send(email: RenderedEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: email.to,
      cc: email.cc,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: email.headers,
    });
  }
}

/** SMTP when SMTP_HOST is set, otherwise the console fallback (logged loudly). */
export function createMailTransportFromEnv(env: NodeJS.ProcessEnv = process.env): MailTransport {
  const from = env.MAIL_FROM ?? "opsdesk@localhost";
  if (!env.SMTP_HOST) {
    // eslint-disable-next-line no-console
    console.warn("[mail] SMTP_HOST unset — emails are printed to this log, not sent");
    return new ConsoleMailTransport(from);
  }
  const port = Number(env.SMTP_PORT ?? 587);
  return new SmtpMailTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    from,
  });
}
