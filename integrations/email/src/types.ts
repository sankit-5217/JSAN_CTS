/**
 * Shapes for the email adapter. Everything here is transport-agnostic — this
 * package never opens an SMTP/IMAP connection. The worker renders a
 * {@link NotificationEvent} into a {@link RenderedEmail} and hands it to its
 * mail transport; the `incidents` module turns a {@link ParsedInboundEmail}
 * into a ticket (spec §10.3, §28).
 */

/** A person an email is addressed to / from. */
export interface Party {
  name?: string;
  email: string;
}

/**
 * The minimal, module-agnostic view of a domain entity a notification is about.
 * The worker fills this from whichever module raised the event, so this package
 * needs no dependency on incidents / sla / changes / vendors.
 */
export interface EntityRef {
  /** Human key, e.g. "INC-1042", "CHG-88", "VC-SR100", "ALRT-3f9c". */
  key: string;
  /** One-line title / summary. */
  title: string;
  /** Deep link into the portal; if absent, built from `portalBaseUrl`. */
  url?: string;
  /** Site code — used for the subject-line prefix and the X-OpsDesk-Site header. */
  siteCode?: string;
  priority?: string;
  severity?: string;
}

export type SlaKind = "RESPONSE" | "RESOLUTION";

/** Outbound notification events the worker can raise. Discriminated on `kind`. */
export type NotificationEvent =
  | { kind: "INCIDENT_ASSIGNED"; entity: EntityRef; assignee: Party; actor?: Party }
  | {
      kind: "INCIDENT_STATUS_CHANGED";
      entity: EntityRef;
      from: string;
      to: string;
      actor?: Party;
      comment?: string;
    }
  | {
      kind: "SLA_WARNING";
      entity: EntityRef;
      slaKind: SlaKind;
      dueAt: string;
      minutesRemaining: number;
    }
  | { kind: "SLA_BREACHED"; entity: EntityRef; slaKind: SlaKind; breachedAt: string }
  | {
      kind: "CHANGE_APPROVED";
      entity: EntityRef;
      approver: Party;
      windowStart: string;
      windowEnd: string;
    }
  | { kind: "ALERT_RAISED"; entity: EntityRef; alertType: string; state: string }
  | { kind: "VENDOR_CASE_UPDATE"; entity: EntityRef; note: string; author?: Party };

export type NotificationKind = NotificationEvent["kind"];

export interface RenderOptions {
  /** Base URL to build an entity link from when `entity.url` is absent, e.g. "https://opsdesk.jsan.example". */
  portalBaseUrl?: string;
}

/** The result the worker hands to its mail transport. `from` is the transport's concern. */
export interface RenderedEmail {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html: string;
  /** Includes threading (`In-Reply-To`, `References`) and `X-OpsDesk-*` filter headers. */
  headers: Record<string, string>;
}

/** A received email, already decoded from MIME by the caller. */
export interface InboundEmail {
  /** "Jane Doe <jane@corp.com>" or "jane@corp.com". */
  from: string;
  to?: string[];
  cc?: string[];
  subject: string;
  /** Plain-text body (the caller extracted text from the MIME tree). */
  text: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  receivedAt?: string;
  /** `X-OpsDesk-Entity` header value, when the message is a reply to one of our notifications. */
  opsDeskEntityKey?: string;
}

export interface ParsedInboundEmail {
  fromEmail: string;
  fromName?: string;
  subject: string;
  /** Body with quoted history and a trailing signature block removed (best effort). */
  body: string;
  /** Entity key from the `X-OpsDesk-Entity` header or an `[INC-1042]` subject tag. */
  entityKey?: string;
  /** True when this looks like a reply (In-Reply-To / References / "Re:" subject). */
  isReply: boolean;
  /** Threading anchor for correlating to an existing ticket. */
  threadRef?: string;
  receivedAt: string;
}
