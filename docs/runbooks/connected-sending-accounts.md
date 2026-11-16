# Shared sending mailbox

All production mail uses From: JSAN OpsDesk <sankit@jsanconsulting.com>.
For ticket creation, comments and updates, Reply-To is the triggering user's
current email, looked up by their authenticated user ID. The template also shows
the person's name, email and role at the time of the event. Clients and staff do
not authorize mailboxes. Normal OpsDesk account and site permissions still apply.
System/account emails have no human actor and use the shared mailbox as Reply-To.

## One-time setup

1. Keep the existing sending_accounts and mail_authorizations migration applied.
   This change needs no new database migration.
2. Set MAIL_SHARED_SENDER_EMAIL=sankit@jsanconsulting.com on **API and worker**.
   The worker setting also moves automated notifications and invite/reset emails
   onto shared delivery. Without it, actorless jobs retain the legacy local/system
   transport; this is useful for local development only.
3. Keep INTEGRATION_SECRETS_KEY (32 bytes, base64) on API. Keep the same
   MAIL_WORKER_KEY (at least 32 characters) on API and worker. Set worker
   OPSDESK_API_URL=https://api-production-8f7e.up.railway.app/api/v1.
4. Keep API MAIL_MICROSOFT_CLIENT_ID, MAIL_MICROSOFT_CLIENT_SECRET,
   API_PUBLIC_URL and WEB_APP_URL configured. The Microsoft app needs delegated
   User.Read, Mail.Send, offline_access and this Web redirect URI:
   https://api-production-8f7e.up.railway.app/api/v1/sending-mail/callback/microsoft.
5. Sign in to OpsDesk as **SUPER_ADMIN**, open Account > Shared sending email
   (https://jsan-opsdesk.up.railway.app/account/email), and click
   **Connect Outlook / Microsoft 365**. In Microsoft, sign in as
   **sankit@jsanconsulting.com** and authorize sending. The OpsDesk super admin's
   login email can differ from the shared mailbox email. Microsoft organization
   policy may require tenant-admin consent. Creating the app credentials alone
   does not authorize sending.
6. Confirm the page shows the shared mailbox connected. Create a test ticket and
   public comment using permitted test recipients, and inspect the actual From,
   Reply-To and body in the received email. Test internal comments only with staff.

Only super admins can view, connect, replace or disconnect the shared mailbox.
Authorization is rechecked in the service and again when the callback saves.
Google OAuth and allowlisted SMTP app-password endpoints remain supported for a
different configured shared address, with the same admin restriction. The UI
offers OAuth providers; the production mailbox uses Microsoft.

## Delivery and recovery

The worker sends through the API; provider credentials never enter Redis jobs or
browser responses. OAuth state is hashed, expires after ten minutes, uses PKCE,
and is single-use. Credentials are AES-256-GCM encrypted. The API refreshes tokens
automatically and guards against concurrent disconnect/reconnect during refresh.
The owner of the stored authorization must remain an active super admin.

No actor needs a personal connection. Inactive actors are rejected. Workers cannot
override From or Reply-To through supplied headers. Existing ticket recipients,
CC rules and internal-comment restrictions are unchanged.

Until the shared mailbox is authorized, ticket/comment changes still save but
email delivery fails and retries; it does not fall back to the old Gmail sender.
Disconnecting affects all email, including account/invite/reset messages when
shared delivery is enabled. BullMQ retries five times and retains exhausted failed
jobs. After authorization or reconnection, operators must explicitly retry those
jobs; check for stale invites/resets before replaying. Do not replay historical
notifications without reviewing recipients and possible duplicates. Provider
acceptance followed by a timeout can result in duplicate delivery on retry.

Deploy API first, then worker and web from the same committed snapshot. Older jobs
with an actor ID get shared From and actor Reply-To; older templates without an
actor email keep their already-queued body. Jobs without an actor ID use shared
From and Reply-To. No credentials or existing user/ticket data need rewriting.

Rollback requires restoring application versions **and** removing the shared-sender
worker setting to restore legacy system delivery. The previous version requires
personal mailbox authorization for actor-driven emails. Do not rotate the
integration encryption key without reauthorizing all stored integrations.

## Acceptance rubric

| Requirement                                                         | Automated evidence                                                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Clients, desk staff and engineers send without personal connections | sending-mail.service.spec.ts: role matrix, shared From and actor Reply-To in actual generated MIME |
| Actor shown on ticket creation and comment templates                | ticket-mail.spec.ts, render.spec.ts: actor identity and HTML escaping                              |
| Account/system mail also uses shared sender                         | connected-transport.spec.ts, service actorless MIME test                                           |
| No setup request for ordinary users                                 | SendingEmailPage.test.tsx: clients/staff redirected; admin setup available                         |
| Only super admins manage credentials                                | Controller RolesGuard matrix and service authorization tests                                       |
| Cannot connect a different sender or override sender headers        | OAuth mailbox mismatch and delivery header tests                                                   |
| Token expiry/disconnect handled without exposing secrets            | Encrypted storage, refresh, cancellation and worker guard tests                                    |
| Ticket recipients and staff-only comments preserved                 | ticket-mail.spec.ts, incident service tests and worker queue tests                                 |

Unit tests use mocked providers and send no real email. A successful deployment
does not prove Microsoft consent or inbox delivery; the one-time authorization
and received-message check above are required for that.

Microsoft reference: https://learn.microsoft.com/en-us/graph/api/user-sendmail
