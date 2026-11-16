import type { RenderedEmail } from "@cts-dc-opsdesk/email-adapter";
import type { MailTransport } from "../mail/transport";
import { processNotificationJob } from "./notifications.queue";
import type { NotificationJob } from "./notifications.queue";

function collectingTransport() {
  const sent: RenderedEmail[] = [];
  const transport: MailTransport = {
    send: async (email) => {
      sent.push(email);
    },
  };
  return { sent, transport };
}

describe("processNotificationJob", () => {
  it("renders the event and sends it through the transport", async () => {
    const { sent, transport } = collectingTransport();
    const job: NotificationJob = {
      event: {
        kind: "SLA_BREACHED",
        entity: { key: "INC-1042", title: "DB latency spike", siteCode: "SITE01" },
        slaKind: "RESOLUTION",
        breachedAt: "2026-09-03T12:00:00.000Z",
      },
      recipients: { to: [{ name: "Sam Lead", email: "sam@corp.example" }] },
    };

    await processNotificationJob(job, transport);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["Sam Lead <sam@corp.example>"]);
    expect(sent[0].subject).toContain("INC-1042");
    expect(sent[0].subject).toContain("RESOLUTION SLA BREACHED");
    expect(sent[0].headers["X-OpsDesk-Event"]).toBe("SLA_BREACHED");
  });

  it("passes the ticket update actor's stable identity to delivery", async () => {
    const transport = { send: jest.fn().mockResolvedValue(undefined) };
    await processNotificationJob(
      {
        event: {
          kind: "INCIDENT_COMMENT_ADDED",
          entity: {
            key: "INC-1042",
            title: "Issue",
            ticket: { updatedBy: { userId: "actor-id", name: "Jane", at: "2026-11-16T08:00:00Z" } },
          },
          author: { email: "jane@example.com" },
          body: "Update",
        },
        recipients: { to: [{ email: "recipient@example.com" }] },
      },
      transport,
    );
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("INC-1042") }),
      "actor-id",
    );
  });

  it("uses the explicit actor for non-ticket user-triggered mail", async () => {
    const transport = { send: jest.fn().mockResolvedValue(undefined) };
    await processNotificationJob(
      {
        event: {
          kind: "CHANGE_APPROVED",
          entity: { key: "CHG-8", title: "swap PSU" },
          approver: { email: "lead@corp.example" },
          windowStart: "2026-09-10T22:00:00.000Z",
          windowEnd: "2026-09-10T23:00:00.000Z",
        },
        recipients: { to: [{ email: "eng@corp.example" }] },
        senderUserId: "approver-id",
      },
      transport,
    );
    expect(transport.send).toHaveBeenCalledWith(expect.anything(), "approver-id");
  });

  it("passes render options through (portal link)", async () => {
    const { sent, transport } = collectingTransport();
    await processNotificationJob(
      {
        event: {
          kind: "CHANGE_APPROVED",
          entity: { key: "CHG-8", title: "swap PSU" },
          approver: { email: "lead@corp.example" },
          windowStart: "2026-09-10T22:00:00.000Z",
          windowEnd: "2026-09-10T23:00:00.000Z",
        },
        recipients: { to: [{ email: "eng@corp.example" }] },
        options: { portalBaseUrl: "https://opsdesk.example" },
      },
      transport,
    );

    expect(sent[0].text).toContain("View in portal: https://opsdesk.example/entity/CHG-8");
  });

  it("propagates a render error so the job fails and BullMQ retries", async () => {
    const { transport } = collectingTransport();
    await expect(
      processNotificationJob(
        {
          event: {
            kind: "SLA_BREACHED",
            entity: { key: "", title: "" },
            slaKind: "RESOLUTION",
            breachedAt: "x",
          },
          recipients: { to: [] },
        } as NotificationJob,
        transport,
      ),
    ).rejects.toThrow();
  });
});
