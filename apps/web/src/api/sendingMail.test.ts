import { describe, expect, it } from "vitest";
import { hasMatchingSendingEmail, sendingMailReturnPath } from "./sendingMail";

describe("hasMatchingSendingEmail", () => {
  it("accepts a connected mailbox that matches the registered email", () => {
    expect(
      hasMatchingSendingEmail({
        senderEmail: "client@example.com",
        account: { email: "client@example.com" },
      }),
    ).toBe(true);
  });

  it("accepts the same address regardless of case", () => {
    expect(
      hasMatchingSendingEmail({
        senderEmail: "Client@Example.com",
        account: { email: "client@example.com" },
      }),
    ).toBe(true);
  });

  it("rejects a mailbox that belongs to somebody else", () => {
    expect(
      hasMatchingSendingEmail({
        senderEmail: "client@example.com",
        account: { email: "desk@example.com" },
      }),
    ).toBe(false);
  });

  it("rejects an account that was never connected", () => {
    expect(
      hasMatchingSendingEmail({ senderEmail: "client@example.com", account: null }),
    ).toBe(false);
  });
});

describe("sendingMailReturnPath", () => {
  it("sends a client to the client portal", () => {
    expect(sendingMailReturnPath("CLIENT_MANAGER_VIEWER")).toBe("/client/home");
  });

  it.each(["SERVICE_DESK_NOC", "SITE_ENGINEER", "INFRASTRUCTURE_LEAD", "SUPER_ADMIN"])(
    "sends %s to the ops console",
    (role) => {
      expect(sendingMailReturnPath(role)).toBe("/");
    },
  );

  it("falls back to the console when the role is unknown", () => {
    expect(sendingMailReturnPath(null)).toBe("/");
  });
});
