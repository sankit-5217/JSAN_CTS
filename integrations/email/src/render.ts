import { formatUtc } from "./time";
import type { EntityRef, NotificationEvent, Party, RenderedEmail, RenderOptions } from "./types";

/** Thrown when a notification event cannot be rendered into an email. */
export class EmailRenderError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "EmailRenderError";
  }
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Stable synthetic Message-ID anchor for an entity, so every notification
 *  about it threads together in the recipient's mail client. */
export function entityMessageId(key: string): string {
  return `<opsdesk.${slug(key)}@opsdesk.local>`;
}

function addr(p: Party): string {
  return p.name ? `${p.name} <${p.email}>` : p.email;
}

function entityUrl(entity: EntityRef, opts: RenderOptions): string | undefined {
  if (entity.url) {
    return entity.url;
  }
  if (opts.portalBaseUrl) {
    return `${opts.portalBaseUrl.replace(/\/+$/, "")}/entity/${encodeURIComponent(entity.key)}`;
  }
  return undefined;
}

function minutesPhrase(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) {
    return `${m} min`;
  }
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/**
 * An incident email's subject: `INC-00002[Bug][P3,S3] Uploads are slow`.
 * A missing part is left out (`INC-00002[P3] ...`), never shown empty.
 */
export function ticketSubject(entity: EntityRef): string {
  const oneLine = (v: string | undefined) => (v ?? "").replace(/[\r\n]+/g, " ").trim();
  const issueType = oneLine(entity.ticket?.issueType);
  const levels = [oneLine(entity.priority), oneLine(entity.severity)].filter(Boolean).join(",");
  const tags = `${issueType ? `[${issueType}]` : ""}${levels ? `[${levels}]` : ""}`;
  return `${entity.key}${tags} ${oneLine(entity.title)}`.trim();
}

/** "<who> <did what> on <when>", from the first line of an incident email. */
const TICKET_VERB: Partial<Record<NotificationEvent["kind"], string>> = {
  INCIDENT_CREATED: "raised this ticket",
  INCIDENT_ASSIGNED: "assigned this ticket",
  INCIDENT_GROUP_ASSIGNED: "assigned this ticket",
  INCIDENT_STATUS_CHANGED: "changed the status",
  INCIDENT_COMMENT_ADDED: "added a comment",
  INCIDENT_UPDATED: "updated this ticket",
  INCIDENT_ATTACHMENT_ADDED: "added a file",
};

/** The event lines of an incident email; who did it is said once, above them. */
function ticketLines(event: NotificationEvent): string[] | undefined {
  switch (event.kind) {
    case "INCIDENT_CREATED":
      return event.description ? ["Description:", event.description] : [];
    case "INCIDENT_ASSIGNED":
      return [`Assigned to ${event.assignee.name ?? event.assignee.email}.`];
    case "INCIDENT_GROUP_ASSIGNED":
      return [`Assigned to the ${event.group.name} group.`];
    case "INCIDENT_STATUS_CHANGED":
      return [`Status: ${event.from} → ${event.to}`, event.comment ? `Note: ${event.comment}` : ""];
    case "INCIDENT_COMMENT_ADDED":
      return [
        event.internal ? "Internal note (staff only, not sent to the client):" : "Comment:",
        event.body,
      ];
    case "INCIDENT_UPDATED":
      return ["What changed:", ...event.changes.map((change) => `- ${change}`)];
    case "INCIDENT_ATTACHMENT_ADDED":
      return [`File: ${event.fileName}`];
    default:
      return undefined;
  }
}

function ticketActorLine(event: NotificationEvent): string {
  const by = event.entity.ticket?.updatedBy;
  if (!by) return "";
  const who = by.role ? `${by.name} (${by.role})` : by.name;
  return `${who} ${TICKET_VERB[event.kind] ?? "updated this ticket"} on ${formatUtc(by.at)}.`;
}

function ticketSummary(entity: EntityRef): string[] {
  const t = entity.ticket ?? {};
  return [
    `Ticket: ${entity.key} - ${entity.title}`,
    t.status ? `Status: ${t.status}` : "",
    t.issueType ? `Issue type: ${t.issueType}` : "",
    entity.priority ? `Priority: ${entity.priority}` : "",
    entity.severity ? `Severity: ${entity.severity}` : "",
    `Assignee: ${t.assignee ?? "Not assigned yet"}`,
    `Assignee group: ${t.assigneeGroup ?? "None"}`,
  ];
}

interface Rendered {
  /** short phrase for the subject line, after the entity key */
  phrase: string;
  /** body lines specific to this event */
  lines: string[];
  /** true → prefix the subject with a marker */
  urgent?: boolean;
}

function renderBody(event: NotificationEvent): Rendered {
  switch (event.kind) {
    case "INCIDENT_CREATED":
      return {
        phrase: "new ticket needs triage",
        lines: [
          `${event.entity.key} was just raised${event.reporter ? ` by ${addr(event.reporter)}` : ""} and is waiting in the queue.`,
        ],
      };
    case "INCIDENT_ASSIGNED":
      return {
        phrase: `assigned to ${event.assignee.name ?? event.assignee.email}`,
        lines: [
          `${event.entity.key} has been assigned to ${addr(event.assignee)}.`,
          event.actor ? `Assigned by ${addr(event.actor)}.` : "",
        ],
      };
    case "INCIDENT_GROUP_ASSIGNED":
      return {
        phrase: `assigned to ${event.group.name}`,
        lines: [
          `${event.entity.key} has been assigned to the ${event.group.name} group — no individual owner yet.`,
          event.actor ? `Assigned by ${addr(event.actor)}.` : "",
        ],
      };
    case "INCIDENT_STATUS_CHANGED":
      return {
        phrase: `${event.from} → ${event.to}`,
        lines: [
          `${event.entity.key} moved from ${event.from} to ${event.to}.`,
          event.actor ? `Changed by ${addr(event.actor)}.` : "",
          event.comment ? `Comment: ${event.comment}` : "",
        ],
      };
    case "INCIDENT_COMMENT_ADDED":
      return {
        phrase: `new comment from ${event.author.name ?? event.author.email}`,
        lines: [`${addr(event.author)} commented on ${event.entity.key}:`, event.body],
      };
    case "INCIDENT_ATTACHMENT_ADDED":
      return {
        phrase: "file added",
        lines: [`A file was added to ${event.entity.key}: ${event.fileName}`],
      };
    case "INCIDENT_UPDATED":
      return {
        phrase: "ticket updated",
        lines: [
          `The service desk updated ${event.entity.key}:`,
          ...event.changes.map((change) => `- ${change}`),
        ],
      };
    case "SLA_WARNING":
      return {
        phrase: `${event.slaKind} SLA due in ${minutesPhrase(event.minutesRemaining)}`,
        urgent: event.minutesRemaining <= 15,
        lines: [
          `The ${event.slaKind.toLowerCase()} SLA for ${event.entity.key} is due at ${event.dueAt}`,
          `(${minutesPhrase(event.minutesRemaining)} remaining).`,
        ],
      };
    case "SLA_BREACHED":
      return {
        phrase: `${event.slaKind} SLA BREACHED`,
        urgent: true,
        lines: [
          `The ${event.slaKind.toLowerCase()} SLA for ${event.entity.key} breached at ${event.breachedAt}.`,
        ],
      };
    case "INCIDENT_OFFERED":
      return {
        phrase: `offered to you (accept within ${minutesPhrase(event.timeoutMinutes)})`,
        urgent: true,
        lines: [
          `${event.entity.key} matches your skills and shift, so it has been offered to ${addr(event.offeredTo)}.`,
          `Accept or decline it in the portal before ${formatUtc(event.expiresAt)}. If you don't respond, it goes to the next engineer.`,
        ],
      };
    case "INCIDENT_OFFER_UNACCEPTED":
      return {
        phrase: "no engineer accepted, needs manual assignment",
        urgent: true,
        lines: [
          `No engineer accepted ${event.entity.key}. It was offered to: ${event.offeredTo.join(", ")}.`,
          "It is still NEW and unowned. Please assign it manually.",
        ],
      };
    case "CHANGE_APPROVED":
      return {
        phrase: `approved by ${event.approver.name ?? event.approver.email}`,
        lines: [
          `${event.entity.key} was approved by ${addr(event.approver)}.`,
          `Maintenance window: ${event.windowStart} → ${event.windowEnd}.`,
        ],
      };
    case "ALERT_RAISED":
      return {
        phrase: `${event.alertType} (${event.state})`,
        urgent: (event.entity.severity ?? "").toUpperCase() === "CRITICAL",
        lines: [`Alert ${event.alertType} is ${event.state} on ${event.entity.key}.`],
      };
    case "INCIDENT_ALERT_RECOVERED_AFTER_RESOLVE":
      return {
        phrase: `${event.alertType} recovered`,
        lines: [
          `The ${event.alertType} (${event.severity}) alert linked to ${event.entity.key} was ` +
            `just reported RECOVERED by monitoring, at ${event.recoveredAt}.`,
          `This ticket was already resolved/closed before that happened — the underlying ` +
            `condition has now genuinely cleared.`,
        ],
      };
    case "VENDOR_CASE_UPDATE":
      return {
        phrase: "vendor update",
        lines: [
          `New update on ${event.entity.key}${event.author ? ` from ${addr(event.author)}` : ""}:`,
          event.note,
        ],
      };
    case "RISK_STATUS_CHANGED":
      return {
        phrase: `${event.from} → ${event.to}`,
        lines: [
          `${event.entity.key} moved from ${event.from} to ${event.to}.`,
          event.actor ? `Changed by ${addr(event.actor)}.` : "",
          event.note ? `Mitigation / rationale: ${event.note}` : "",
        ],
      };
    default: {
      const exhaustive: never = event;
      throw new EmailRenderError(
        `unknown notification kind ${(exhaustive as { kind: string }).kind}`,
        "kind",
      );
    }
  }
}

/**
 * Render a notification event into an email. Pure and deterministic — all
 * timing comes from the event fields, never the clock. Threads every
 * notification about the same entity together via a stable `References` anchor,
 * and tags the
 * message with `X-OpsDesk-*` headers so the inbound parser can correlate replies
 * and mail clients can filter. Throws {@link EmailRenderError} when there are no
 * recipients or the entity has no key.
 */
export function renderNotification(
  event: NotificationEvent,
  recipients: { to: Party[]; cc?: Party[] },
  options: RenderOptions = {},
): RenderedEmail {
  if (!recipients.to || recipients.to.length === 0) {
    throw new EmailRenderError(`notification ${event.kind} has no "to" recipients`, "to");
  }
  const key = event.entity?.key?.trim();
  if (!key) {
    throw new EmailRenderError(`notification ${event.kind} has no entity key`, "entity.key");
  }

  const { phrase, lines, urgent } = renderBody(event);
  const url = entityUrl(event.entity, options);
  const footer = [
    url ? `View in portal: ${url}` : "",
    "—",
    "Automated OpsDesk notification. Reply above this line to add a worklog comment.",
  ];

  let subject: string;
  let bodyLines: string[];
  if (event.entity.ticket) {
    // Every email about a ticket: one subject format (so they all thread
    // together), who did what first, then the ticket as it stands now.
    subject = ticketSubject({ ...event.entity, key });
    // A blank line between the sections, so the plain-text part reads well.
    bodyLines = [
      [ticketActorLine(event)],
      ticketLines(event) ?? lines,
      ticketSummary(event.entity),
      footer,
    ]
      .map((section) => section.filter(Boolean))
      .filter((section) => section.length > 0)
      .flatMap((section, i) => (i === 0 ? section : ["", ...section]));
  } else {
    const sitePrefix = event.entity.siteCode ? `[${event.entity.siteCode}] ` : "";
    const marker = urgent ? "‼ " : "";
    subject = `${marker}${sitePrefix}${key} — ${phrase}`;
    bodyLines = [
      `${key}: ${event.entity.title}`,
      event.entity.priority ? `Priority: ${event.entity.priority}` : "",
      event.entity.severity ? `Severity: ${event.entity.severity}` : "",
      "",
      ...lines.filter(Boolean),
      "",
      ...footer,
    ].filter((l) => l !== "");
  }

  const text = bodyLines.join("\n");
  const html = renderHtml(bodyLines, url);

  const anchor = entityMessageId(key);
  const headers: Record<string, string> = {
    "In-Reply-To": anchor,
    References: anchor,
    "X-OpsDesk-Event": event.kind,
    "X-OpsDesk-Entity": key,
  };
  if (event.entity.siteCode) {
    headers["X-OpsDesk-Site"] = event.entity.siteCode;
  }
  if (urgent) {
    headers["X-Priority"] = "1";
  }

  return {
    to: recipients.to.map(addr),
    ...(recipients.cc && recipients.cc.length ? { cc: recipients.cc.map(addr) } : {}),
    subject,
    text,
    html,
    headers,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(lines: string[], url: string | undefined): string {
  const body = lines
    .map((line) => {
      if (url && line.endsWith(url)) {
        const label = line.slice(0, line.length - url.length);
        return `<p>${escapeHtml(label)}<a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`;
      }
      // pre-wrap keeps a multi-line comment's own line breaks.
      return line === "" ? "<br>" : `<p style="white-space:pre-wrap">${escapeHtml(line)}</p>`;
    })
    .join("\n");
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif">\n${body}\n</body></html>`;
}
