import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";

export const SMTP_PROVIDERS: Record<string, { host: string; port: number }> = {
  yahoo: { host: "smtp.mail.yahoo.com", port: 465 },
  icloud: { host: "smtp.mail.me.com", port: 587 },
  zoho: { host: "smtp.zoho.com", port: 465 },
};

export function oauthProvider(provider: string) {
  if (provider !== "google" && provider !== "microsoft")
    throw new BadRequestException("Unknown mail provider");
  const prefix = provider === "google" ? "MAIL_GOOGLE" : "MAIL_MICROSOFT";
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const base = process.env.API_PUBLIC_URL;
  if (!clientId || !clientSecret || !base)
    throw new ServiceUnavailableException(
      "This mail provider has not been configured by the administrator",
    );
  return {
    clientId,
    clientSecret,
    redirectUri: `${base.replace(/\/$/, "")}/api/v1/sending-mail/callback/${provider}`,
    authorize:
      provider === "google"
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token:
      provider === "google"
        ? "https://oauth2.googleapis.com/token"
        : "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope:
      provider === "google"
        ? "openid email https://www.googleapis.com/auth/gmail.send"
        : "offline_access User.Read Mail.Send",
  };
}
