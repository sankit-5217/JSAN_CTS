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
    case "INCIDENT_ASSIGNED":
      return {
        phrase: `assigned to ${event.assignee.name ?? event.assignee.email}`,
        lines: [
          `${event.entity.key} has been assigned to ${addr(event.assignee)}.`,
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

  const sitePrefix = event.entity.siteCode ? `[${event.entity.siteCode}] ` : "";
  const marker = urgent ? "‼ " : "";
  const subject = `${marker}${sitePrefix}${key} — ${phrase}`;

  const url = entityUrl(event.entity, options);
  const bodyLines = [
    `${key}: ${event.entity.title}`,
    event.entity.priority ? `Priority: ${event.entity.priority}` : "",
    event.entity.severity ? `Severity: ${event.entity.severity}` : "",
    "",
    ...lines.filter(Boolean),
    "",
    url ? `View in portal: ${url}` : "",
    "—",
    "Automated OpsDesk notification. Reply above this line to add a worklog comment.",
  ].filter((l) => l !== "");

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
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif">\n${body}\n</body></html>`;
}
