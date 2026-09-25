import type { Party, RenderedEmail } from "./types";
import { EmailRenderError } from "./render";

/**
 * Account emails (sign-in invite, password reset). Deliberately separate from
 * renderNotification: no entity, no thread anchor, no "reply to add a
 * worklog" footer — replying to these must not create a ticket comment.
 */
export type AccountEmail =
  | {
      kind: "ACCOUNT_INVITE";
      to: Party;
      /** Single-use link to set a password; carries the token in its fragment. */
      link: string;
      expiresAt: string;
      invitedBy?: Party;
    }
  | { kind: "PASSWORD_RESET"; to: Party; link: string; expiresAt: string };

export type AccountEmailKind = AccountEmail["kind"];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addr(p: Party): string {
  return p.name ? `${p.name} <${p.email}>` : p.email;
}

/** Pure: render an account email. Throws {@link EmailRenderError} on missing recipient/link. */
export function renderAccountEmail(mail: AccountEmail): RenderedEmail {
  if (!mail.to?.email) throw new EmailRenderError(`${mail.kind} has no recipient`, "to");
  if (!mail.link) throw new EmailRenderError(`${mail.kind} has no link`, "link");

  const greeting = `Hello ${mail.to.name ?? mail.to.email},`;
  const expiry = `This link works once and expires at ${mail.expiresAt} (UTC).`;
  const lines =
    mail.kind === "ACCOUNT_INVITE"
      ? {
          subject: "You're invited to JSAN OpsDesk",
          intro: [
            greeting,
            `${mail.invitedBy ? addr(mail.invitedBy) : "An administrator"} has given you access to JSAN Data Center OpsDesk.`,
            "Choose your password to finish setting up your account:",
          ],
          outro: [
            expiry,
            "You can also sign in with Google, Microsoft or GitHub if your account uses this email address.",
          ],
        }
      : {
          subject: "Reset your JSAN OpsDesk password",
          intro: [
            greeting,
            "Someone asked to reset the password for your OpsDesk account.",
            "Choose a new password here:",
          ],
          outro: [
            expiry,
            "If you didn't ask for this, ignore this email — your password stays the same.",
          ],
        };

  const text = [
    ...lines.intro,
    "",
    mail.link,
    "",
    ...lines.outro,
    "—",
    "JSAN Data Center OpsDesk",
  ].join("\n");
  const html =
    `<!doctype html><html><body style="font-family:system-ui,sans-serif">\n` +
    lines.intro.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n") +
    `\n<p><a href="${escapeHtml(mail.link)}">${escapeHtml(mail.link)}</a></p>\n` +
    lines.outro.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n") +
    `\n<p>— JSAN Data Center OpsDesk</p>\n</body></html>`;

  return {
    to: [addr(mail.to)],
    subject: lines.subject,
    text,
    html,
    headers: { "X-OpsDesk-Event": mail.kind, "Auto-Submitted": "auto-generated" },
  };
}
