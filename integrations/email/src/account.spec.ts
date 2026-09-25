import { EmailRenderError } from "./render";
import { renderAccountEmail } from "./account";

const LINK = "https://opsdesk.example/auth/set-password#token=abc123";

describe("renderAccountEmail", () => {
  it("renders an invite with the link, expiry and inviter, and no reply-to-thread headers", () => {
    const email = renderAccountEmail({
      kind: "ACCOUNT_INVITE",
      to: { name: "Priya", email: "priya@example.com" },
      link: LINK,
      expiresAt: "2026-09-28 10:00",
      invitedBy: { name: "Admin", email: "admin@example.com" },
    });
    expect(email.to).toEqual(["Priya <priya@example.com>"]);
    expect(email.subject).toBe("You're invited to JSAN OpsDesk");
    expect(email.text).toContain(LINK);
    expect(email.text).toContain("Admin <admin@example.com> has given you access");
    expect(email.text).toContain("2026-09-28 10:00");
    expect(email.html).toContain(`href="${LINK}"`);
    expect(email.headers).not.toHaveProperty("References");
    expect(email.text).not.toMatch(/worklog/i);
  });

  it("renders a reset email that tells the recipient they can ignore it", () => {
    const email = renderAccountEmail({
      kind: "PASSWORD_RESET",
      to: { email: "sam@example.com" },
      link: LINK,
      expiresAt: "2026-09-25 11:00",
    });
    expect(email.subject).toBe("Reset your JSAN OpsDesk password");
    expect(email.text).toContain("Hello sam@example.com,");
    expect(email.text).toContain("ignore this email");
  });

  it("escapes HTML in names", () => {
    const email = renderAccountEmail({
      kind: "PASSWORD_RESET",
      to: { name: "<b>x</b>", email: "x@example.com" },
      link: LINK,
      expiresAt: "t",
    });
    expect(email.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("refuses to render without a recipient or link", () => {
    expect(() =>
      renderAccountEmail({ kind: "PASSWORD_RESET", to: { email: "" }, link: LINK, expiresAt: "t" }),
    ).toThrow(EmailRenderError);
    expect(() =>
      renderAccountEmail({
        kind: "PASSWORD_RESET",
        to: { email: "a@b.c" },
        link: "",
        expiresAt: "t",
      }),
    ).toThrow(EmailRenderError);
  });
});
