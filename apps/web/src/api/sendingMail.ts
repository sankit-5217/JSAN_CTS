/** The API remains authoritative; this check controls only the sign-in prompt. */
export function hasMatchingSendingEmail(status: {
  senderEmail: string;
  account: { email: string } | null;
}): boolean {
  return Boolean(
    status.account && status.account.email.toLowerCase() === status.senderEmail.toLowerCase(),
  );
}

export interface SendingMailStatus {
  senderEmail: string;
  account: { email: string; provider: string; updatedAt: string } | null;
  providers: { provider: string; configured: boolean }[];
  /** App-password providers (Yahoo, iCloud, Zoho) — no admin setup needed. */
  smtpProviders: { provider: string }[];
}

export const MAIL_PROVIDER_LABELS: Record<string, string> = {
  google: "Gmail / Google Workspace",
  microsoft: "Outlook / Microsoft 365",
  yahoo: "Yahoo",
  icloud: "iCloud",
  zoho: "Zoho",
};

/**
 * Where a user belongs after their mailbox is connected: clients land in the
 * client portal, everyone else in the ops console. Same rule for every role —
 * a client, an engineer, service desk or admin — so connecting a mailbox is
 * never an extra step away from the work they came to do.
 */
export function sendingMailReturnPath(role: string | null): string {
  return role === "CLIENT_MANAGER_VIEWER" ? "/client/home" : "/";
}
