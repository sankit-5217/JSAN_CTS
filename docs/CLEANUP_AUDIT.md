# Removed-feature cleanup audit

Reviewed on 2026-11-19 against the current source, Git history, and local
Claude Code and Qoder project transcripts. Historical commands were read as
evidence, not executed.

## History checked

- Claude Code project `JSAN_OpsDesk/JSAN_OpsDesk`, sessions
  `46f3a0f3-5ab7-4cb2-9d8b-fac0d17424fa` and
  `d238eac3-bfa5-4808-8deb-51ddb388e074`.
- Claude Code prompt history under the former `JSAN_CTS/JSAN_CTS` project name,
  cross-checked against the committed removal of social sign-in.
- Qoder project `JSAN_OpsDesk/JSAN_OpsDesk`, sessions
  `b7511cf2-17ad-43a9-8a51-f8fe95b5eb0c` and
  `ccd0d475-2f92-4b68-9e87-ba67e9cc897f`.

## Findings and changes

| Removed feature                                         | Evidence                                                                              | Cleanup                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSO and social sign-in                                  | Claude history and password-only sign-in commit `4b55504`                             | Removed unused `openid-client` and its exclusive dependency tree. Rebuilt API output to remove compiled copies of deleted authentication classes.       |
| Suggested engineers card                                | Qoder history and commit `abb4abe`                                                    | Removed the unused routing-suggestions endpoint and scoped wrapper. Retained and directly tested ranking used by automatic routing offers.              |
| Standalone attachments section and file-delete controls | Claude history and commit `85c760f`; no current portal callers of the delete endpoint | Removed the attachment-delete endpoint, mutation, notification path, and tests exclusive to deletion. Upload, list, preview, and download remain.       |
| Sample ticket-details card                              | Qoder history and commit `b7719e4`                                                    | Already removed; no independent database model or worker job to remove.                                                                                 |
| Login contact form                                      | Qoder history and commit `fb0898b`                                                    | Already removed; the form was illustrative and had no dedicated database model or worker.                                                               |
| Staff details block                                     | Qoder history and commit `7eeca3f`                                                    | Already removed. Shared category, impact, urgency, and CI data still supports ticket processing and is retained.                                        |
| Docker builds for API/web/worker                        | Claude history and commit `199197f`                                                   | Already removed. The on-site collector Dockerfile and `.dockerignore` were deliberately retained in the earlier session and still have documented uses. |

## Data and worker boundaries

Every current Prisma model has a direct reference in runtime API source. All
four worker queues are wired into the worker entrypoint (warranty sync is
conditional on API credentials). No unused table or worker class was confirmed
by this review, and no database or Redis cleanup was performed.

Attachment soft-deletion fields and read filters remain: existing deleted files
must not reappear, and historical deletion attribution must remain available.
Existing migrations remain intact, including the migration that drops the old
social-login tables. Migration history is required to build and upgrade databases.

## Build hygiene

The API now clears its output before building and excludes unit tests from
production output. Production builds disable incremental compilation so a clean
output directory is always repopulated. Installer scripts remain copied as build
assets. The first clean rebuild reduced output by 1,506,070 bytes before the
additional attachment-delete cleanup.

Changes are local; this cleanup does not deploy services or apply migrations.

## Validation after the history review

- Incident service and authorization contract tests: 234 passed.
- API source and API test-project type checks passed.
- API production build passed; output contains no orphan JavaScript/declaration
  files or compiled unit tests.
- Compiled controller inspection confirms upload, list, and download handlers
  remain and the attachment-delete handler is absent.
- ESLint passed for the changed incident files; formatting and diff checks passed.
