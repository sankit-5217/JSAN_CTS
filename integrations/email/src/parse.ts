import type { InboundEmail, ParsedInboundEmail } from "./types";

/** Thrown when an inbound email cannot be parsed into a ticket-intake shape. */
export class EmailParseError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "EmailParseError";
  }
}

const ANGLE_ADDRESS_RE = /^(.*?)<([^<>@\s]+@[^<>@\s]+)>\s*$/;
const BARE_ADDRESS_RE = /^([^<>@\s]+@[^<>@\s]+)$/;
const REPLY_SUBJECT_RE = /^\s*(re|aw|sv|antw|vs)\s*:/i;
const ENTITY_TAG_RE = /\[([A-Z]{2,5}-\d+)\]/;
const ENTITY_BARE_RE = /\b(INC|CHG|PRB|VC|ALRT)-\d+\b/;

/** Lines at/after any of these begin the quoted history — everything below is dropped. */
const QUOTE_MARKERS: RegExp[] = [
  /^-{2,}\s*original message\s*-{2,}/i,
  /^_{5,}$/,
  /^On .+ wrote:$/,
  /^From:\s.+$/i, // Outlook-style quoted header block
  /^Sent from my /i,
];

function parseAddress(raw: string): { name?: string; email: string } {
  const s = (raw ?? "").trim();
  const angled = s.match(ANGLE_ADDRESS_RE);
  if (angled) {
    const name = angled[1].trim().replace(/^"|"$/g, "").trim();
    return { ...(name ? { name } : {}), email: angled[2].toLowerCase() };
  }
  const bare = s.match(BARE_ADDRESS_RE);
  if (bare) {
    return { email: bare[1].toLowerCase() };
  }
  throw new EmailParseError(`cannot parse an email address from "${raw}"`, "from");
}

/** Strip quoted reply history and a trailing `-- ` signature block. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let consecutiveQuoted = 0;

  for (const line of lines) {
    if (QUOTE_MARKERS.some((re) => re.test(line.trim()))) {
      break;
    }
    if (line.trimStart().startsWith(">")) {
      consecutiveQuoted += 1;
      // a lone ">" inside otherwise-fresh text is tolerated; a run of them ends the body
      if (consecutiveQuoted >= 2) {
        while (kept.length && kept[kept.length - 1].trim() === "") {
          kept.pop();
        }
        break;
      }
      continue;
    }
    consecutiveQuoted = 0;
    if (/^--\s*$/.test(line)) {
      // RFC 3676 signature delimiter ("-- ")
      break;
    }
    kept.push(line);
  }

  return kept.join("\n").trim();
}

function extractEntityKey(email: InboundEmail): string | undefined {
  const fromHeader = email.opsDeskEntityKey?.trim();
  if (fromHeader) {
    return fromHeader.toUpperCase();
  }
  const tagged = email.subject.match(ENTITY_TAG_RE);
  if (tagged) {
    return tagged[1].toUpperCase();
  }
  const bare = email.subject.match(ENTITY_BARE_RE);
  return bare ? bare[0].toUpperCase() : undefined;
}

/**
 * Normalize a received email into a ticket-intake shape. Pure and deterministic —
 * the caller has already decoded MIME and pulled out the text part. Best-effort
 * removal of quoted history and signatures; correlation to an existing ticket is
 * via `entityKey` (from our `X-OpsDesk-Entity` header or an `[INC-1042]` subject
 * tag) and `threadRef`. Throws {@link EmailParseError} when `from` has no address.
 */
export function parseInboundEmail(email: InboundEmail): ParsedInboundEmail {
  if (!email || typeof email.subject !== "string" || typeof email.text !== "string") {
    throw new EmailParseError("inbound email is missing subject or text", "email");
  }
  const { name, email: fromEmail } = parseAddress(email.from ?? "");

  const references = email.references ?? [];
  const isReply =
    Boolean(email.inReplyTo) || references.length > 0 || REPLY_SUBJECT_RE.test(email.subject);

  const entityKey = extractEntityKey(email);
  const threadRef =
    email.inReplyTo?.trim() ||
    references[0]?.trim() ||
    (entityKey ? `<opsdesk.${entityKey.toLowerCase()}@opsdesk.local>` : undefined);

  let receivedAt: string;
  if (email.receivedAt?.trim()) {
    const parsed = Date.parse(email.receivedAt.trim());
    if (Number.isNaN(parsed)) {
      throw new EmailParseError(`unparseable receivedAt "${email.receivedAt}"`, "receivedAt");
    }
    receivedAt = new Date(parsed).toISOString();
  } else {
    receivedAt = new Date().toISOString();
  }

  return {
    fromEmail,
    ...(name ? { fromName: name } : {}),
    subject: email.subject.trim(),
    body: stripQuotedReply(email.text),
    ...(entityKey ? { entityKey } : {}),
    isReply,
    ...(threadRef ? { threadRef } : {}),
    receivedAt,
  };
}
