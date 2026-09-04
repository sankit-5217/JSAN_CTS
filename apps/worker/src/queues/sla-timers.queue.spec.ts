import type { Job } from "bullmq";
import { relaySlaTimerJob } from "./sla-timers.queue";
import type { NotificationJob } from "./notifications.queue";

function fakeJob(data: NotificationJob, id = "job-1"): Job<NotificationJob> {
  return { id, data } as Job<NotificationJob>;
}

describe("relaySlaTimerJob", () => {
  it("forwards the job's event.kind and full payload to the notifications queue, keyed by the same job id", async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const job = fakeJob({
      event: {
        kind: "SLA_WARNING",
        entity: { key: "INC-1042", title: "DB latency spike", siteCode: "SITE01" },
        slaKind: "RESOLUTION",
        dueAt: "2026-09-03T12:00:00.000Z",
        minutesRemaining: 30,
      },
      recipients: { to: [{ email: "sam@corp.example" }] },
    });

    await relaySlaTimerJob(job, { add });

    expect(add).toHaveBeenCalledWith("SLA_WARNING", job.data, { jobId: "job-1" });
  });
});
