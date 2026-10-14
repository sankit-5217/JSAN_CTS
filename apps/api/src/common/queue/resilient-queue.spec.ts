import { EventEmitter } from "events";
import { Logger } from "@nestjs/common";

// A Redis that can be "down" or "up", and a Queue whose add() follows it.
const redis = { up: true, added: [] as { name: string; jobId?: string }[] };
let connection: EventEmitter;

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => {
    connection = new EventEmitter();
    (connection as unknown as { quit: () => Promise<void> }).quit = () => Promise.resolve();
    return connection;
  });
});
jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn((name: string, _data: unknown, opts?: { jobId?: string }) =>
      redis.up
        ? Promise.resolve(redis.added.push({ name, jobId: opts?.jobId }))
        : Promise.reject(new Error("Connection is closed.")),
    ),
    close: () => Promise.resolve(),
  })),
}));

import { ResilientQueue } from "./resilient-queue";

const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() } as unknown as Logger;
const make = (holdMax: number, redisUrl: string | undefined = "redis://x") =>
  new ResilientQueue<{ n: number }>({
    queueName: "test",
    redisUrl,
    defaultJobOptions: {},
    logger,
    holdMax,
  });

describe("ResilientQueue", () => {
  beforeEach(() => {
    redis.up = true;
    redis.added = [];
    jest.clearAllMocks();
  });

  it("queues straight away while Redis is up", async () => {
    const q = make(10);
    await expect(q.add("job", { n: 1 })).resolves.toBe("queued");
    expect(redis.added).toHaveLength(1);
    await q.close();
  });

  it("holds jobs while Redis is down and sends them, in order, once it is back", async () => {
    const q = make(10);
    await q.add("first", { n: 0 }); // creates the connection
    redis.up = false;
    await expect(q.add("a", { n: 1 }, "id-a")).resolves.toBe("held");
    await expect(q.add("b", { n: 2 })).resolves.toBe("held");
    await expect(q.add("a-again", { n: 1 }, "id-a")).resolves.toBe("held"); // same jobId, not doubled
    expect(q.heldCount).toBe(2);

    redis.up = true;
    connection.emit("ready"); // Redis is back: the queue flushes on its own
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(q.heldCount).toBe(0);
    expect(redis.added.map((j) => j.name)).toEqual(["first", "a", "b"]);
    await q.close();
  });

  it("drops the oldest held job when the buffer is full", async () => {
    const q = make(2);
    await q.add("first", { n: 0 });
    redis.up = false;
    await q.add("a", { n: 1 });
    await q.add("b", { n: 2 });
    await q.add("c", { n: 3 });
    redis.up = true;
    await q.flush();
    expect(redis.added.map((j) => j.name)).toEqual(["first", "b", "c"]);
    await q.close();
  });

  it("does not hold when holding is off (live-secret emails)", async () => {
    const q = make(0);
    await q.add("first", { n: 0 });
    redis.up = false;
    await expect(q.add("invite", { n: 1 })).resolves.toBe("dropped");
    expect(q.heldCount).toBe(0);
    await q.close();
  });

  it("is a no-op without REDIS_URL", async () => {
    const q = make(10, "");
    await expect(q.add("x", { n: 1 })).resolves.toBe("dropped");
    await q.close();
  });
});
