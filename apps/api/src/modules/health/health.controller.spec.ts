import { ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  const make = (queryRaw: jest.Mock) =>
    new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);

  it("reports ok when the database answers", async () => {
    const result = await make(jest.fn().mockResolvedValue([{ "?column?": 1 }])).check();
    expect(result).toMatchObject({ status: "ok", service: "cts-dc-opsdesk-api", database: "ok" });
  });

  it("answers 503 when the database is unreachable", async () => {
    await expect(
      make(jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED"))).check(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("liveness never touches the database", () => {
    const queryRaw = jest.fn();
    expect(make(queryRaw).live().status).toBe("ok");
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
