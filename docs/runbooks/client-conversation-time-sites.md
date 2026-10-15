# Client reports, conversation, time zones and site delete

Behaviour agreed on 2026-10-15 and the rubric that guards it. Each ID is
referenced by the tests listed in the last column; `pnpm test` and
`pnpm --filter @cts-dc-opsdesk/api test:e2e` must stay green.

## What users see

- **My tickets → a ticket** (client): the report is shown and editable as
  before, but without the **Template** dropdown (Report an issue keeps it).
- **Assignee Group** defaults to **JSAN ServiceDesk** for new reports.
- Every saved edit of the report appears in the ticket's **Conversation** —
  on the client page and on the staff incident page — as a "Report updated"
  card: who made it, when, and each field `old → new` (group and engineer
  names, never ids).
- **Times** everywhere in the portal are shown in the viewer's own clock with
  the zone written ("15 Oct 2026, 5:20 pm IST" in India, "12:50 pm BST" for
  the same moment in London). The API stores and sends UTC instants; emails
  say "UTC" explicitly and how long a link is valid.
- **Sites → Delete** (Super Admin) archives the site: hidden from lists,
  pickers and the client portal, no new tickets or agent enrollments, history
  kept, **Restore** under "Show deleted sites". Refused while the site has
  open tickets (they are named). Alerts from an archived site are still
  recorded — switch its monitoring off in Zabbix.

## Rubric

| ID | Requirement | Tests |
| --- | --- | --- |
| T1 | **No Template button on the client's ticket page** once the report exists; every other field stays; Report an issue still offers templates | `apps/web/src/pages/client/IssueTemplateForm.test.tsx` |
| T2 | **JSAN ServiceDesk is the default Assignee Group** (catalog default, new reports land there); production fixed by migration `20261015130000_default_assignee_service_desk` (idempotent, audited) | `conversation-sites.e2e-spec.ts` "T2" |
| T3 | **Report edits in the conversation, old → new**, with names, who (name + role) and when; visible to the client **and** the service desk | `report-changes.spec.ts`, `incidents.service.spec.ts` (REPORT_EDITED payload), `incident-customer.service.spec.ts`, `clientTicket.test.ts`, e2e "T3/T4" |
| T4 | **Atomic and quiet** — the edit entry is written in the same transaction as the change; saving without a real change adds nothing | `report-changes.spec.ts`, e2e "saving without a real change" |
| T5 | **Older edits still show** (saved before values were recorded: field names only) | `incident-customer.service.spec.ts` |
| T6 | **Viewer's own time zone, zone written**, every date-time on screen; never "Invalid Date" | `apps/web/src/time/clock.test.ts` (India, London, New York, Tokyo/LA midnight crossing) |
| T7 | **Conversation order is by real instant** (messages, status changes and edits; mixed offsets sort correctly) | `clientTicket.test.ts` "sorts by actual time" |
| T8 | **Emails state the zone** ("15 Oct 2026, 11:46 UTC") and link validity ("valid for 3 days") | `integrations/email/src/time.spec.ts`, `account.spec.ts`, `render.spec.ts` |
| T9 | **Delete = archive**, Super Admin only, audited (`SITE_ARCHIVED` / `SITE_RESTORED`), restorable | `site-archive.spec.ts`, e2e "T9–T12" |
| T10 | **Refused while open tickets exist**, naming them (incidents module answers via `site.archive.check`, sites never reads ticket tables) | `incident-site-checks.listener.spec.ts`, `site-archive.spec.ts`, e2e |
| T11 | **Hidden everywhere**: `/sites` lists, pickers, client portal; only a Super Admin can list archived sites | `site-archive.spec.ts`, e2e |
| T12 | **No new work** on an archived site: client reports, staff tickets, agent enrollments (alerts still recorded) | `site-archive.spec.ts` (assertSiteAcceptsNewWork), e2e |

## Rollback

- Code: redeploy the previous api/web build.
- Default group: Support Groups → "Make default" on the previous group (its id
  is in the migration's audit event, `before.previousDefaultGroupId`).
- Archived sites: Sites → Show deleted sites → Restore.
