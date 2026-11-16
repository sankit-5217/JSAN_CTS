# Connected sending accounts

Users open Account > Sending email account in either portal. Personal ticket emails use `From: JSAN OpsDesk <connected user email>`. The connected mailbox must match the user's OpsDesk login email. Ticket notifications carry the initiating user's ID, not a user-supplied From header. The worker delegates delivery to the API, which owns encrypted credentials. Automated notifications and account/invite/reset emails continue using MAIL_FROM.

## Enable

1. Deploy the API migration with `pnpm --filter @cts-dc-opsdesk/api prisma:deploy`. It adds two tables without changing existing data. Generate Prisma types before building.
2. Keep `INTEGRATION_SECRETS_KEY` configured on the API (32 bytes, base64). Do not rotate it without reauthorizing stored credentials.
3. Set `MAIL_WORKER_KEY` to the same random secret of at least 32 characters on API and worker. Set worker `OPSDESK_API_URL` to the API base URL including `/api/v1`. Use HTTPS across public networks. The key authorizes sending from connected mailboxes; never expose it to the frontend.
4. Set API `API_PUBLIC_URL` to its public origin (without `/api/v1`) and `WEB_APP_URL` to the frontend origin.
5. Register OAuth apps as below and configure credentials on the API only. Users must connect individually before their personal notifications can be delivered.

### Google

Create a Web application OAuth client, enable Gmail API, configure the consent screen, and register `<API_PUBLIC_URL>/api/v1/sending-mail/callback/google` as an authorized redirect URI. Set `MAIL_GOOGLE_CLIENT_ID` and `MAIL_GOOGLE_CLIENT_SECRET`. Scopes: `openid`, `email`, `https://www.googleapis.com/auth/gmail.send`. Request offline access. External production use may require Google's app verification; testing mode limits eligible users and token lifetime. Do not treat a test-mode app as production ready.

### Microsoft

Register a Web application accepting organizational directories AND personal Microsoft accounts. Register `<API_PUBLIC_URL>/api/v1/sending-mail/callback/microsoft`. Add delegated `User.Read`, `Mail.Send`, and `offline_access`. Set `MAIL_MICROSOFT_CLIENT_ID` and `MAIL_MICROSOFT_CLIENT_SECRET`. Some organizations require administrator consent.

### SMTP

Yahoo, iCloud, and Zoho (.com endpoint) use provider app passwords and TLS. Arbitrary SMTP hosts are intentionally unsupported to prevent the connection form from reaching private infrastructure. Other providers/Zoho regions require an explicitly reviewed endpoint addition in `sending-mail/providers.ts`.

## Behavior and operations

OAuth state is hashed, expires after ten minutes, uses PKCE, and is consumed once. Refresh tokens/app passwords use AES-256-GCM at rest. Credential responses are never returned to users or stored in Redis jobs. Connection/disconnection changes are audited without secrets. Disconnect removes saved credentials and pending states; provider-side revocation is also available in provider account settings.

Personal mail never falls back to MAIL_FROM. The ticket/comment still saves when the sender has no connection; BullMQ retries email delivery five times, then retains the failed job. After fixing a connection, an operator must retry exhausted jobs. API/worker rollout should be coordinated: migrate and deploy API, then worker, then web. Older queued jobs lacking an actor ID retain the legacy system-sender behavior. A provider may have accepted an email before a network timeout; automatic retries can cause duplicates (existing notification delivery is at least once).

Verify locally with mocked tests first. Test end-to-end using an explicitly authorized test mailbox after provider registration; no real test emails are sent by the unit tests. Check ticket creation, public comments, internal comments (unchanged recipient restrictions), disconnected and expired credentials, and automatic notifications.

Rollback: restore the prior app versions; leave additive tables in place. To remove the feature permanently, disconnect accounts and remove OAuth grants, then drop `mail_authorizations` and `sending_accounts` after backing up required audit data. No user/ticket data is altered by this migration.

References: https://developers.google.com/identity/protocols/oauth2/web-server and https://learn.microsoft.com/en-us/graph/auth-v2-user.
