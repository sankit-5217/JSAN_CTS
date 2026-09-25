import { processAccountMailJob } from "./account-mail.queue";

describe("processAccountMailJob", () => {
  it("renders the account email and hands it to the transport", async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    await processAccountMailJob(
      {
        kind: "ACCOUNT_INVITE",
        to: { email: "new@example.com" },
        link: "https://opsdesk.example/auth/set-password#token=t",
        expiresAt: "2026-09-28 10:00",
      },
      { send },
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["new@example.com"],
        subject: "You're invited to JSAN OpsDesk",
      }),
    );
  });
});
