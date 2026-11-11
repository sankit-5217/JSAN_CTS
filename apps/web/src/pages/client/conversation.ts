import { ApiError, apiGet, apiPost, apiUpload } from "../../api/client";

/** A file on a ticket (GET /incidents/:id/attachments, or inside a message). */
export interface TicketAttachment {
  id: string;
  objectKey: string;
  sizeBytes: number;
  uploadedById: string | null;
  commentId?: string | null;
  createdAt: string;
}

/** GET /incidents/:id/comments: who wrote it (by email), and the files sent with it. */
export interface ConversationMessage {
  id: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: { id: string; displayName: string; email?: string | null; role: string | null };
  attachments: TicketAttachment[];
}

/** Who sent a message or saved an edit, as shown on it: their email. */
export function senderLabel(person: {
  email?: string | null;
  displayName?: string;
  name?: string;
}): string {
  return person.email || person.displayName || person.name || "Unknown user";
}

/** The original file name, without the uuid prefix the object key carries. */
export function attachmentName(a: Pick<TicketAttachment, "objectKey">): string {
  return (
    a.objectKey
      .split("/")
      .pop()
      ?.replace(/^[0-9a-f-]{36}-/, "") ?? a.objectKey
  );
}

/** "inline" = View in the browser, "attachment" = Download. */
export type AttachmentDisposition = "inline" | "attachment";

/**
 * Fetches a short-lived signed link for a ticket file and either opens it
 * in a new tab (View) or saves it under its original name (Download). The
 * link carries the disposition, so the browser does the rest.
 */
export async function openAttachment(
  incidentId: string,
  attachmentId: string,
  disposition: AttachmentDisposition,
): Promise<void> {
  const { url } = await apiGet<{ url: string }>(
    `/incidents/${incidentId}/attachments/${attachmentId}/download?disposition=${disposition}`,
  );
  if (disposition === "inline") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  // An attachment response downloads without leaving the page.
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * "name.png (why)" for a file that didn't upload, so the person (and
 * whoever they forward it to) can tell a refused type from a storage fault.
 */
export function describeFailedUpload(file: File, err: unknown): string {
  let reason: string;
  if (err instanceof ApiError) {
    const detail = (err.body as { message?: unknown } | null)?.message;
    if (typeof detail === "string" && detail) reason = detail;
    else if (Array.isArray(detail)) reason = detail.join("; ");
    else if (err.status === 413) reason = "file is too large";
    else if (err.status >= 500) reason = `server couldn't store it (${err.status})`;
    else reason = `error ${err.status}`;
  } else {
    reason = "network error";
  }
  return `${file.name} (${reason})`;
}

/**
 * Posts a message and then each file with it. The message is saved first,
 * so a failed upload never loses the words; the names of files that didn't
 * make it come back for the caller to report.
 */
export async function sendMessage(
  incidentId: string,
  body: string,
  files: File[],
  isInternal?: boolean,
): Promise<{ failedUploads: string[] }> {
  const text = body.trim() || (files.length === 1 ? "Shared a file" : "Shared files");
  const comment = await apiPost<{ id: string }>(`/incidents/${incidentId}/comments`, {
    body: text,
    ...(isInternal === undefined ? {} : { isInternal }),
  });
  const failedUploads: string[] = [];
  for (const file of files) {
    try {
      await apiUpload(`/incidents/${incidentId}/attachments`, file, { commentId: comment.id });
    } catch (err) {
      failedUploads.push(describeFailedUpload(file, err));
    }
  }
  return { failedUploads };
}
