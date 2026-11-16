# Personal sending mailboxes

Emails triggered by a user's ticket or record update are sent from that
authenticated user's registered OpsDesk email. The user must authorize a mailbox
whose verified email exactly matches their OpsDesk account. Clients, engineers,
service desk staff and other active users manage only their own connection from
Account > Sending email. The API verifies the actor and mailbox; the worker
cannot override the sender through a queued email's headers.

There is no shared mailbox fallback for user-triggered emails. If a sender has
not connected their mailbox, delivery fails and is retried; the underlying
record update is not rolled back. System-generated mail without a human actor
(such as invites, password resets and automated alerts) continues to use the
worker's configured service sender (`MAIL_FROM` and SMTP settings).

## One-time setup

1. No database migration is needed. The existing per-user `sending_accounts`
   and `mail_authorizations` tables are used.
2. Set `INTEGRATION_SECRETS_KEY` (32 bytes, base64) on the API. OAuth
   credentials are encrypted there and never enter Redis jobs or browser
   responses.
3. Configure `MAIL_WORKER_KEY` (at least 32 characters) on the API and worker,
   and `OPSDESK_API_URL` on the worker, ending in `/api/v1`.
4. Configure API `MAIL_GOOGLE_CLIENT_ID` / `MAIL_GOOGLE_CLIENT_SECRET` and/or
   `MAIL_MICROSOFT_CLIENT_ID` / `MAIL_MICROSOFT_CLIENT_SECRET`, plus
   `API_PUBLIC_URL` and `WEB_APP_URL`. Register the matching callback URI:
   `https://<api-host>/api/v1/sending-mail/callback/google` or
   `https://<api-host>/api/v1/sending-mail/callback/microsoft`.
   Google needs `openid`, `email`, and `gmail.send`; Microsoft needs
   `User.Read`, `Mail.Send`, and `offline_access`.
5. Configure worker SMTP for actorless system mail: `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, and optionally `SMTP_SECURE`.
   `MAIL_FROM` should be a service address, not a person's mailbox.
6. Each user signs in, opens Account > Sending email, connects their Google or
   Microsoft mailbox, and grants send permission. The connected provider
   address must match the email registered in OpsDesk. A successful connection
   is shown on that page.
7. Test a ticket update using a permitted recipient and verify its actual
   `From` address is the triggering user's registered email. Also test a
   system-generated email and verify it uses `MAIL_FROM`.

Remove the old `MAIL_SHARED_SENDER_EMAIL` setting from the API and worker; it is
not used for user-triggered delivery. Existing shared mailbox credentials are
not automatically valid as a user's personal account. Users must connect an
account matching their registered email. Changing an OpsDesk email requires
reconnecting its mailbox.

## Delivery and recovery

The worker forwards only the authenticated actor's user ID and the rendered
message to the API. Provider credentials remain in the API. Sender identity is
looked up from the active actor's current registered email and their saved
mailbox; supplied `From` and `Reply-To` headers are stripped. Delivery fails
closed when the user is inactive, their mailbox is missing or mismatched, or
their provider authorization is unavailable.

OAuth state is hashed, expires after ten minutes, uses PKCE, and is single-use.
Provider accounts are checked against the registered OpsDesk address before
credentials are saved. Credentials are AES-256-GCM encrypted. Users may
disconnect only their own account; mailbox changes are audited.

BullMQ retries notification failures five times and retains exhausted failed
jobs. After reconnecting a mailbox, operators must explicitly retry those jobs;
review recipients and possible duplicates first. Provider acceptance followed
by a timeout can still result in duplicate delivery on retry. Account emails
and automated notifications have no human actor and stay on the worker's
configured service sender; they do not impersonate a user.

Rollback requires restoring the matching application versions and worker mail
configuration. No user or ticket data needs rewriting.

## Acceptance rubric

| Requirement                                                                      | Automated evidence                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Clients, engineers and service desk users send from their own registered address | `sending-mail.service.spec.ts`: role matrix, mailbox verification and generated MIME |
| A user without a connected/matching mailbox cannot send as another address       | `sending-mail.service.spec.ts`: missing mailbox and OAuth mismatch                   |
| Actor identity is carried to the worker for authored notifications               | `notifications.queue.spec.ts`, incident/change/vendor/risk service specs             |
| System/account mail retains the configured service sender                        | `connected-transport.spec.ts`, account-mail queue tests                              |
| Only the signed-in user can manage their own credentials                         | Controller bearer guard and user-scoped service operations                           |
| Sender headers cannot be overridden                                              | `sending-mail.service.spec.ts`: worker delivery header filtering                     |

Unit tests use mocked providers and send no real email. A successful deployment
does not prove provider consent or inbox delivery; each user should complete
the connection and received-message check above.
