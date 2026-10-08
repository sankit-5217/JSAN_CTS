// Not spec-mandated DB config (unlike SLA times/priorities) — a code
// constant here follows the same precedent as MAX_BULK_ITEMS in the cmdb
// module. Adjust here if real usage needs a wider allowlist or ceiling.
//
// Where attachments live: the bytes go to S3-compatible object storage
// (MinIO locally, a real S3 bucket in production — see
// common/storage/storage.service.ts and S3_* in .env) under
// `incidents/<incidentId>/<uuid>-<original name>`; Postgres keeps only the
// `attachments` row (key, type, size, sha256, uploader). Reads go through
// short-lived signed URLs, the object itself is never public.
export const MAX_ATTACHMENT_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB — screen recordings

export const ALLOWED_ATTACHMENT_CONTENT_TYPES: readonly string[] = [
  // screenshots / photos of fault lights and labels
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  // screen recordings
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  // logs, exports, documents
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/x-log",
  "application/json",
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-gzip",
];

/**
 * Browsers send a `.log` (and sometimes `.txt`/`.har`) file as
 * `application/octet-stream` because the OS has no registered type for it.
 * Those are accepted by extension only; any other octet-stream is refused.
 */
export const ALLOWED_OCTET_STREAM_EXTENSIONS: readonly string[] = [
  ".log",
  ".txt",
  ".har",
  ".json",
  ".csv",
  ".zip",
  ".gz",
  ".tgz",
];

export function isAllowedAttachment(contentType: string, originalName: string): boolean {
  const type = contentType.toLowerCase().split(";")[0].trim();
  if (ALLOWED_ATTACHMENT_CONTENT_TYPES.includes(type)) {
    return true;
  }
  if (type === "application/octet-stream") {
    const lower = originalName.toLowerCase();
    return ALLOWED_OCTET_STREAM_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }
  return false;
}
