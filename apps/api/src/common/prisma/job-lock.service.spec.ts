import { JobLockService } from "./job-lock.service";
import { PrismaService } from "./prisma.service";

function make(locked: boolean) {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked }]) };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  return { service: new JobLockService(prisma), tx };
}

describe("JobLockService", () => {
  it("runs the job when this instance gets the lock", async () => {
    const { service } = make(true);
    const job = jest.fn().mockResolvedValue(undefined);
    await expect(service.runExclusive("sla-escalation-scan", job)).resolves.toBe(true);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("skips the job when another instance holds the lock", async () => {
    const { service } = make(false);
    const job = jest.fn();
    await expect(service.runExclusive("sla-escalation-scan", job)).resolves.toBe(false);
    expect(job).not.toHaveBeenCalled();
  });

  it("never lets a failing job escape into the scheduler", async () => {
    const { service } = make(true);
    await expect(
      service.runExclusive("x", () => Promise.reject(new Error("boom"))),
    ).resolves.toBe(false);
  });
});
