import { ConnectedMailTransport } from "./connected-transport";
import type { RenderedEmail } from "@cts-dc-opsdesk/email-adapter";
const email: RenderedEmail = {
  to: ["recipient@example.com"],
  subject: "Ticket",
  text: "Comment",
  html: "<p>Comment</p>",
  headers: {},
};
describe("ConnectedMailTransport", () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });
  it("keeps system notifications on the configured service transport", async () => {
    const system = { send: jest.fn().mockResolvedValue(undefined) };
    global.fetch = jest.fn();
    await new ConnectedMailTransport(system).send(email);
    expect(system.send).toHaveBeenCalledWith(email);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("passes the actor identity to personal delivery without exposing credentials in jobs", async () => {
    const system = { send: jest.fn() };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    await new ConnectedMailTransport(system, "https://api.example/api/v1/", "worker-secret").send(
      email,
      "actor-id",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.example/api/v1/sending-mail/deliver",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-mail-worker-key": "worker-secret" }),
        body: JSON.stringify({ userId: "actor-id", email }),
      }),
    );
    expect(system.send).not.toHaveBeenCalled();
  });
  it("fails without falling back to a different sender when personal delivery is unavailable", async () => {
    const system = { send: jest.fn() };
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(
      new ConnectedMailTransport(system, "https://api.example/api/v1", "key").send(
        email,
        "actor-id",
      ),
    ).rejects.toThrow("No fallback");
    expect(system.send).not.toHaveBeenCalled();
  });
  it("keeps account and automatic emails on the configured service transport", async () => {
    const system = { send: jest.fn() };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    await new ConnectedMailTransport(system, "https://api.example/api/v1", "key").send(email);
    expect(system.send).toHaveBeenCalledWith(email);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("fails closed when worker configuration is missing", async () => {
    const system = { send: jest.fn() };
    await expect(
      new ConnectedMailTransport(system, "", "").send(email, "actor-id"),
    ).rejects.toThrow("requires");
    expect(system.send).not.toHaveBeenCalled();
  });
});
