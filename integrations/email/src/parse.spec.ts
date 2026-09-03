import { EmailParseError, parseInboundEmail, stripQuotedReply } from "./parse";
import type { InboundEmail } from "./types";

function inbound(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    from: "Jane Doe <Jane@Corp.Example>",
    subject: "Printer in NOC is on fire",
    text: "The label printer is smoking. Please raise a ticket.\n",
    receivedAt: "2026-09-03T09:00:00.000Z",
    ...overrides,
  };
}

describe("parseInboundEmail", () => {
  it("parses a fresh email with no ticket reference", () => {
    const parsed = parseInboundEmail(inbound());

    expect(parsed).toMatchObject({
      fromEmail: "jane@corp.example",
      fromName: "Jane Doe",
      subject: "Printer in NOC is on fire",
      isReply: false,
      receivedAt: "2026-09-03T09:00:00.000Z",
    });
    expect(parsed.entityKey).toBeUndefined();
    expect(parsed.body).toBe("The label printer is smoking. Please raise a ticket.");
  });

  it("treats a Re: with In-Reply-To as a reply, pulls the [INC-1042] tag, strips history", () => {
    const parsed = parseInboundEmail(
      inbound({
        subject: "Re: [SITE01] [INC-1042] — assigned to Jane Doe",
        inReplyTo: "<opsdesk.inc-1042@opsdesk.local>",
        text: [
          "Confirmed, failing over to the replica now.",
          "",
          "On Wed, 3 Sep 2026, OpsDesk wrote:",
          "> INC-1042: DB latency spike",
          "> View in portal: https://...",
        ].join("\n"),
      }),
    );

    expect(parsed.isReply).toBe(true);
    expect(parsed.entityKey).toBe("INC-1042");
    expect(parsed.threadRef).toBe("<opsdesk.inc-1042@opsdesk.local>");
    expect(parsed.body).toBe("Confirmed, failing over to the replica now.");
  });

  it("prefers the X-OpsDesk-Entity header over the subject and upper-cases it", () => {
    const parsed = parseInboundEmail(
      inbound({
        subject: "Re: something vague",
        opsDeskEntityKey: "chg-88",
        references: ["<a@b>"],
      }),
    );
    expect(parsed.entityKey).toBe("CHG-88");
    expect(parsed.isReply).toBe(true);
    expect(parsed.threadRef).toBe("<a@b>");
  });

  it("finds a bare INC-99 reference with no brackets", () => {
    const parsed = parseInboundEmail(inbound({ subject: "update on INC-99 please" }));
    expect(parsed.entityKey).toBe("INC-99");
  });

  it("accepts a bare address with no display name", () => {
    const parsed = parseInboundEmail(inbound({ from: "ops@corp.example" }));
    expect(parsed.fromEmail).toBe("ops@corp.example");
    expect(parsed.fromName).toBeUndefined();
  });

  it("throws EmailParseError for an unaddressable from or a bad timestamp", () => {
    expect(() => parseInboundEmail(inbound({ from: "not an address" }))).toThrow(EmailParseError);

    try {
      parseInboundEmail(inbound({ receivedAt: "whenever" }));
      throw new Error("expected parseInboundEmail to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailParseError);
      expect((err as EmailParseError).field).toBe("receivedAt");
    }
  });
});

describe("stripQuotedReply", () => {
  it("drops an Outlook-style quoted header block", () => {
    const out = stripQuotedReply(
      [
        "My reply here.",
        "",
        "From: OpsDesk <no-reply@opsdesk>",
        "Sent: Wednesday",
        "Subject: ...",
      ].join("\n"),
    );
    expect(out).toBe("My reply here.");
  });

  it("drops a trailing signature after '-- '", () => {
    const out = stripQuotedReply(["Please close this.", "-- ", "Jane Doe", "NOC Lead"].join("\n"));
    expect(out).toBe("Please close this.");
  });

  it("keeps the body when there is nothing to strip", () => {
    expect(stripQuotedReply("Line one\nLine two")).toBe("Line one\nLine two");
  });
});
