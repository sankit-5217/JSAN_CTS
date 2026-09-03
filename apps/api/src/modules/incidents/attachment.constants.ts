// Not spec-mandated DB config (unlike SLA times/priorities) — a code
// constant here follows the same precedent as MAX_BULK_ITEMS in the cmdb
// module. Adjust here if real usage needs a wider allowlist or ceiling.
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_ATTACHMENT_CONTENT_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/json",
];
