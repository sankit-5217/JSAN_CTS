# Email intake / notification adapter

Owner: Dev B (Integrations, Hardware & Governance). Package: `@cts-dc-opsdesk/email-adapter`.

Two **pure**, transport-agnostic halves (spec §10.3, §28):

- **Outbound** — `renderNotification(event, recipients, options?)` turns a
  `NotificationEvent` into a `RenderedEmail` (`subject` / `text` / `html` /
  `headers`). The worker hands the result to its SMTP transport.
- **Inbound** — `parseInboundEmail(email)` normalizes a received message (already
  decoded from MIME by the caller) into a `ParsedInboundEmail` the `incidents`
  module turns into a ticket or a worklog comment.

This package opens no SMTP/IMAP connection and has **no dependency on other
modules** — the worker fills the module-agnostic `EntityRef` from whichever
module raised the event.

## Outbound

- Deterministic. `NotificationEvent` is a union over `INCIDENT_ASSIGNED`,
  `INCIDENT_STATUS_CHANGED`, `SLA_WARNING`, `SLA_BREACHED`, `CHANGE_APPROVED`,
  `ALERT_RAISED`, `VENDOR_CASE_UPDATE`.
- Subject: `[<site>] <KEY> — <phrase>`, prefixed `‼ ` when urgent (SLA breach,
  SLA warning ≤ 15 min, CRITICAL alert), which also sets `X-Priority: 1`.
- **Threading**: every notification about an entity sets `In-Reply-To` +
  `References` to a stable anchor (`entityMessageId(key)` =
  `<opsdesk.<key>@opsdesk.local>`), so a mail client groups them and a reply
  comes back correlated.
- **Filter headers**: `X-OpsDesk-Event`, `X-OpsDesk-Entity`, `X-OpsDesk-Site`.
- Throws `EmailRenderError` (`.field`) with no recipients or no entity key.

## Inbound

- `parseInboundEmail` returns `{ fromEmail, fromName?, subject, body, entityKey?,
isReply, threadRef?, receivedAt }`.
- `entityKey` from the `X-OpsDesk-Entity` header (our own reply) or an
  `[INC-1042]` / bare `INC-1042` subject reference; `threadRef` from
  `In-Reply-To` / `References` / the synthetic entity anchor.
- `body` has quoted history (`>` runs, `On … wrote:`, Outlook `From:` blocks,
  `-----Original Message-----`) and a trailing `-- ` signature removed
  (best effort — `stripQuotedReply` is exported for reuse/testing).
- Throws `EmailParseError` (`.field`) when `from` has no address or `receivedAt`
  is unparseable.

## Not in this package

The worker's SMTP client and retry/queue; the IMAP/lambda that receives mail and
walks the MIME tree; the actual ticket creation (that is `incidents`'). Tests use
sanitized fixture messages (spec §21).
