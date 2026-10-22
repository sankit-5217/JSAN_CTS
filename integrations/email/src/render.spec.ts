import { EmailRenderError, entityMessageId, renderNotification, ticketSubject } from "./render";
import type { EntityRef, NotificationEvent, Party } from "./types";

const JANE: Party = { name: "Jane Doe", email: "jane@corp.example" };
const LEAD: Party = { name: "Sam Lead", email: "sam@corp.example" };

function incident(overrides: Partial<EntityRef> = {}): EntityRef {
  return {
    key: "INC-1042",
    title: "DB latency spike on the primary",
    siteCode: "SITE01",
    priority: "P2",
    ...overrides,
  };
}

const OPTS = { portalBaseUrl: "https://opsdesk.jsan.example/" };

describe("renderNotification", () => {
  it("renders a customer-facing ticket update as one line per change", () => {
    const mail = renderNotification(
      {
        kind: "INCIDENT_UPDATED",
        entity: incident(),
        changes: ["Now handled by Rahul", "Priority changed from P2 to P1"],
      },
      { to: [JANE], cc: [LEAD] },
    );
    expect(mail.subject).toBe("[SITE01] INC-1042 — ticket updated");
    expect(mail.text).toContain("The service desk updated INC-1042:");
    expect(mail.text).toContain("- Now handled by Rahul");
    expect(mail.text).toContain("- Priority changed from P2 to P1");
  });

  it("renders a new ticket notification, with and without a reporter", () => {
    const withReporter: NotificationEvent = {
      kind: "INCIDENT_CREATED",
      entity: incident(),
      reporter: JANE,
    };
    const mail = renderNotification(withReporter, { to: [LEAD] });
    expect(mail.subject).toBe("[SITE01] INC-1042 — new ticket needs triage");
    expect(mail.text).toContain("was just raised by Jane Doe <jane@corp.example> and is waiting");

    const withoutReporter: NotificationEvent = { kind: "INCIDENT_CREATED", entity: incident() };
    const mail2 = renderNotification(withoutReporter, { to: [LEAD] });
    expect(mail2.text).toContain("was just raised and is waiting");
  });

  it("renders an assignment with threading + filter headers", () => {
    const event: NotificationEvent = {
      kind: "INCIDENT_ASSIGNED",
      entity: incident(),
      assignee: JANE,
      actor: LEAD,
    };

    const mail = renderNotification(event, { to: [JANE] }, OPTS);

    expect(mail.subject).toBe("[SITE01] INC-1042 — assigned to Jane Doe");
    expect(mail.to).toEqual(["Jane Doe <jane@corp.example>"]);
    expect(mail.headers).toMatchObject({
      "In-Reply-To": entityMessageId("INC-1042"),
      References: entityMessageId("INC-1042"),
      "X-OpsDesk-Event": "INCIDENT_ASSIGNED",
      "X-OpsDesk-Entity": "INC-1042",
      "X-OpsDesk-Site": "SITE01",
    });
    expect(mail.text).toContain("DB latency spike on the primary");
    expect(mail.text).toContain("assigned to Jane Doe <jane@corp.example>");
    expect(mail.text).toContain("View in portal: https://opsdesk.jsan.example/entity/INC-1042");
    expect(mail.html).toContain('<a href="https://opsdesk.jsan.example/entity/INC-1042">');
  });

  it("marks an SLA breach urgent", () => {
    const event: NotificationEvent = {
      kind: "SLA_BREACHED",
      entity: incident(),
      slaKind: "RESOLUTION",
      breachedAt: "2026-09-03T12:00:00.000Z",
    };

    const mail = renderNotification(event, { to: [LEAD] });

    expect(mail.subject).toBe("‼ [SITE01] INC-1042 — RESOLUTION SLA BREACHED");
    expect(mail.headers["X-Priority"]).toBe("1");
  });

  it("renders a routing offer with its accept window", () => {
    const mail = renderNotification(
      {
        kind: "INCIDENT_OFFERED",
        entity: incident(),
        offeredTo: LEAD,
        expiresAt: "2026-09-03T12:05:00.000Z",
        timeoutMinutes: 5,
      },
      { to: [LEAD] },
    );
    expect(mail.subject).toBe("‼ [SITE01] INC-1042 — offered to you (accept within 5 min)");
    expect(mail.text).toContain("before 3 Sep 2026, 12:05 UTC");
  });

  it("tells the desk when nobody accepted a routing offer", () => {
    const mail = renderNotification(
      { kind: "INCIDENT_OFFER_UNACCEPTED", entity: incident(), offeredTo: ["Ana", "Ben"] },
      { to: [LEAD] },
    );
    expect(mail.subject).toContain("no engineer accepted");
    expect(mail.text).toContain("It was offered to: Ana, Ben.");
  });

  it("phrases the SLA warning window and flags urgency under 15 min", () => {
    const near = renderNotification(
      {
        kind: "SLA_WARNING",
        entity: incident(),
        slaKind: "RESPONSE",
        dueAt: "2026-09-03T12:10:00.000Z",
        minutesRemaining: 10,
      },
      { to: [LEAD] },
    );
    expect(near.subject).toContain("RESPONSE SLA due in 10 min");
    expect(near.subject.startsWith("‼ ")).toBe(true);

    const far = renderNotification(
      {
        kind: "SLA_WARNING",
        entity: incident(),
        slaKind: "RESPONSE",
        dueAt: "x",
        minutesRemaining: 90,
      },
      { to: [LEAD] },
    );
    expect(far.subject).toContain("due in 1h 30m");
    expect(far.subject.startsWith("‼")).toBe(false);
  });

  it("uses entity.url verbatim and includes cc", () => {
    const event: NotificationEvent = {
      kind: "VENDOR_CASE_UPDATE",
      entity: { key: "VC-SR100", title: "PSU RMA", url: "https://portal/vc/SR100" },
      note: "Vendor shipped the replacement, tracking 1Z999.",
    };

    const mail = renderNotification(event, { to: [JANE], cc: [LEAD] }, OPTS);

    expect(mail.cc).toEqual(["Sam Lead <sam@corp.example>"]);
    expect(mail.text).toContain("View in portal: https://portal/vc/SR100");
    expect(mail.text).toContain("Vendor shipped the replacement, tracking 1Z999.");
  });

  it("renders a risk status change with the mitigation note", () => {
    const mail = renderNotification(
      {
        kind: "RISK_STATUS_CHANGED",
        entity: { key: "RISK-7", title: "Single power feed to Row 4", siteCode: "SITE01" },
        from: "OPEN",
        to: "ACCEPTED",
        actor: LEAD,
        note: "Residual accepted by the infra lead until the B-feed works land.",
      },
      { to: [JANE] },
    );

    expect(mail.subject).toBe("[SITE01] RISK-7 — OPEN → ACCEPTED");
    expect(mail.headers["X-OpsDesk-Event"]).toBe("RISK_STATUS_CHANGED");
    expect(mail.text).toContain("moved from OPEN to ACCEPTED");
    expect(mail.text).toContain("Mitigation / rationale: Residual accepted by the infra lead");
  });

  it("renders a group-assignment notification, addressed to every member", () => {
    const mail = renderNotification(
      {
        kind: "INCIDENT_GROUP_ASSIGNED",
        entity: incident(),
        group: { name: "Networking" },
        actor: LEAD,
      },
      { to: [JANE, { name: "Pat Roe", email: "pat@corp.example" }] },
    );

    expect(mail.subject).toBe("[SITE01] INC-1042 — assigned to Networking");
    expect(mail.to).toEqual(["Jane Doe <jane@corp.example>", "Pat Roe <pat@corp.example>"]);
    expect(mail.headers["X-OpsDesk-Event"]).toBe("INCIDENT_GROUP_ASSIGNED");
    expect(mail.text).toContain("assigned to the Networking group — no individual owner yet.");
    expect(mail.text).toContain("Assigned by Sam Lead <sam@corp.example>.");
  });

  it("renders a comment-added notification with the author and body", () => {
    const mail = renderNotification(
      {
        kind: "INCIDENT_COMMENT_ADDED",
        entity: incident(),
        author: JANE,
        body: "Can you confirm the server's asset tag?",
      },
      { to: [LEAD] },
    );

    expect(mail.subject).toBe("[SITE01] INC-1042 — new comment from Jane Doe");
    expect(mail.headers["X-OpsDesk-Event"]).toBe("INCIDENT_COMMENT_ADDED");
    expect(mail.text).toContain("Jane Doe <jane@corp.example> commented on INC-1042:");
    expect(mail.text).toContain("Can you confirm the server's asset tag?");
  });

  it("renders an alert recovering after the ticket was already resolved", () => {
    const event: NotificationEvent = {
      kind: "INCIDENT_ALERT_RECOVERED_AFTER_RESOLVE",
      entity: incident(),
      alertType: "hardware.health_degraded",
      severity: "CRITICAL",
      recoveredAt: "2026-09-18T08:31:00.000Z",
    };

    const mail = renderNotification(event, { to: [JANE] });

    expect(mail.subject).toBe("[SITE01] INC-1042 — hardware.health_degraded recovered");
    expect(mail.headers["X-OpsDesk-Event"]).toBe("INCIDENT_ALERT_RECOVERED_AFTER_RESOLVE");
    expect(mail.text).toContain("was just reported RECOVERED by monitoring");
    expect(mail.text).toContain("already resolved/closed before that happened");
  });

  it("throws EmailRenderError when there are no recipients or no entity key", () => {
    const event: NotificationEvent = {
      kind: "INCIDENT_ASSIGNED",
      entity: incident(),
      assignee: JANE,
    };
    expect(() => renderNotification(event, { to: [] })).toThrow(EmailRenderError);

    try {
      renderNotification(
        { kind: "INCIDENT_ASSIGNED", entity: incident({ key: "  " }), assignee: JANE },
        { to: [JANE] },
      );
      throw new Error("expected renderNotification to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailRenderError);
      expect((err as EmailRenderError).field).toBe("entity.key");
    }
  });
});

describe("incident ticket emails", () => {
  const ticket = (overrides: Partial<EntityRef> = {}): EntityRef => ({
    key: "INC-00002",
    title: "Uploads are slow",
    siteCode: "SITE01",
    priority: "P3",
    severity: "S3",
    ticket: {
      issueType: "Bug",
      status: "In Progress",
      assignee: "Rahul Sharma",
      assigneeGroup: "Infra team",
      updatedBy: { name: "Rahul Sharma", role: "Engineer", at: "2026-10-22T11:10:00.000Z" },
    },
    ...overrides,
  });
  const recipients = { to: [LEAD], cc: [JANE, { email: "ops@client.example" }] };

  it("builds the subject as KEY[Issue type][Priority,Severity] Subject", () => {
    expect(ticketSubject(ticket())).toBe("INC-00002[Bug][P3,S3] Uploads are slow");
  });

  it("leaves out a missing part instead of showing it empty", () => {
    expect(ticketSubject(ticket({ severity: undefined }))).toBe(
      "INC-00002[Bug][P3] Uploads are slow",
    );
    expect(ticketSubject(ticket({ priority: undefined, severity: undefined, ticket: {} }))).toBe(
      "INC-00002 Uploads are slow",
    );
  });

  it("keeps the subject on one line whatever the title holds", () => {
    const title = ["Uploads", "Bcc: x@evil.example"].join(String.fromCharCode(13, 10));
    expect(ticketSubject(ticket({ title }))).toBe(
      "INC-00002[Bug][P3,S3] Uploads Bcc: x@evil.example",
    );
  });

  it("uses the ticket subject for every kind, including staff-only SLA mails", () => {
    const sla = renderNotification(
      {
        kind: "SLA_BREACHED",
        entity: ticket(),
        slaKind: "RESOLUTION",
        breachedAt: "2026-10-22T12:00:00Z",
      },
      { to: [LEAD] },
    );
    expect(sla.subject).toBe("INC-00002[Bug][P3,S3] Uploads are slow");
    expect(sla.headers["X-Priority"]).toBe("1");
  });

  it("says who commented, with role and time, then the comment and the ticket summary", () => {
    const mail = renderNotification(
      {
        kind: "INCIDENT_COMMENT_ADDED",
        entity: ticket(),
        author: LEAD,
        body: "Line one\nLine two",
      },
      recipients,
      OPTS,
    );
    const lines = mail.text.split("\n");
    expect(lines[0]).toBe("Rahul Sharma (Engineer) added a comment on 22 Oct 2026, 11:10 UTC.");
    expect(mail.text).toContain("Comment:\nLine one\nLine two");
    expect(mail.text).toContain("Status: In Progress");
    expect(mail.text).toContain("Assignee: Rahul Sharma");
    expect(mail.text).toContain("Assignee group: Infra team");
    expect(mail.text).toContain("View in portal: https://opsdesk.jsan.example/entity/INC-00002");
    expect(mail.html).toContain("white-space:pre-wrap");
  });

  it("shows every CC recipient on the mail itself", () => {
    const mail = renderNotification(
      { kind: "INCIDENT_UPDATED", entity: ticket(), changes: ["Severity: S2 → S3"] },
      recipients,
    );
    expect(mail.to).toEqual(["Sam Lead <sam@corp.example>"]);
    expect(mail.cc).toEqual(["Jane Doe <jane@corp.example>", "ops@client.example"]);
    expect(mail.text).toContain("Rahul Sharma (Engineer) updated this ticket on");
    expect(mail.text).toContain("What changed:\n- Severity: S2 → S3");
  });

  it("labels an internal note as staff only", () => {
    const mail = renderNotification(
      {
        kind: "INCIDENT_COMMENT_ADDED",
        entity: ticket(),
        author: LEAD,
        body: "check the RAID",
        internal: true,
      },
      { to: [LEAD] },
    );
    expect(mail.text).toContain("Internal note (staff only, not sent to the client):");
  });

  it("names an added file, and an unassigned ticket says so", () => {
    const mail = renderNotification(
      {
        kind: "INCIDENT_ATTACHMENT_ADDED",
        entity: ticket({
          ticket: {
            issueType: "Bug",
            updatedBy: { name: "Jane Doe", role: "Client", at: "2026-10-22T11:10:00Z" },
          },
        }),
        fileName: "shot.png",
      },
      { to: [LEAD] },
    );
    expect(mail.text).toContain("Jane Doe (Client) added a file on 22 Oct 2026, 11:10 UTC.");
    expect(mail.text).toContain("File: shot.png");
    expect(mail.text).toContain("Assignee: Not assigned yet");
  });
});
