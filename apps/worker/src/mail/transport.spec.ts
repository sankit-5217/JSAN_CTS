import type { RenderedEmail } from "@cts-dc-opsdesk/email-adapter";
import type nodemailer from "nodemailer";
import { ConsoleMailTransport, createMailTransportFromEnv, SmtpMailTransport } from "./transport";

const EMAIL: RenderedEmail = {
  to: ["Sam <sam@example.com>"],
  subject: "Hello",
  text: "body",
  html: "<p>body</p>",
  headers: { "X-OpsDesk-Event": "PASSWORD_RESET" },
};

const fakeTransporter = (sendMail: jest.Mock) =>
  ({ sendMail }) as unknown as nodemailer.Transporter;

describe("mail transports", () => {
  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("falls back to the console transport without SMTP_HOST", () => {
    expect(createMailTransportFromEnv({})).toBeInstanceOf(ConsoleMailTransport);
  });

  it("builds an SMTP transport from env", () => {
    expect(
      createMailTransportFromEnv({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "587" }),
    ).toBeInstanceOf(SmtpMailTransport);
  });

  it("sends the rendered email with the configured From", async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const transport = new SmtpMailTransport(
      { host: "h", port: 587, secure: false, from: "OpsDesk <opsdesk@jsan.example>" },
      fakeTransporter(sendMail),
    );
    await transport.send(EMAIL);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "OpsDesk <opsdesk@jsan.example>",
        to: EMAIL.to,
        subject: "Hello",
        text: "body",
        html: "<p>body</p>",
        headers: EMAIL.headers,
      }),
    );
  });

  it("propagates SMTP failures so the queue retries", async () => {
    const transport = new SmtpMailTransport(
      { host: "h", port: 587, secure: false, from: "x@y.z" },
      fakeTransporter(jest.fn().mockRejectedValue(new Error("535 auth failed"))),
    );
    await expect(transport.send(EMAIL)).rejects.toThrow("535 auth failed");
  });
});
