import { EmailRenderError, entityMessageId, renderNotification } from "./render";
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
