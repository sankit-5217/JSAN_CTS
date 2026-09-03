import { readFileSync } from "node:fs";
import { Agent } from "undici";
import { buildApiDispatcher, buildEndpointDispatcher } from "./tls";

jest.mock("node:fs", () => ({
  readFileSync: jest.fn((path: string) => `--- contents of ${path} ---`),
}));

const readMock = readFileSync as jest.MockedFunction<typeof readFileSync>;

describe("buildApiDispatcher", () => {
  beforeEach(() => readMock.mockClear());

  it("returns undefined when no TLS material is configured", () => {
    expect(buildApiDispatcher(undefined)).toBeUndefined();
  });

  it("reads cert + key (and ca when given) and returns an undici Agent", () => {
    const agent = buildApiDispatcher({
      certFile: "/etc/collector/client.crt",
      keyFile: "/etc/collector/client.key",
      caFile: "/etc/collector/ca.pem",
    });
    expect(agent).toBeInstanceOf(Agent);
    expect(readMock).toHaveBeenCalledWith("/etc/collector/client.crt", "utf8");
    expect(readMock).toHaveBeenCalledWith("/etc/collector/client.key", "utf8");
    expect(readMock).toHaveBeenCalledWith("/etc/collector/ca.pem", "utf8");
  });

  it("does not read a ca file when none is configured", () => {
    buildApiDispatcher({ certFile: "c", keyFile: "k" });
    expect(readMock).toHaveBeenCalledTimes(2);
  });
});

describe("buildEndpointDispatcher", () => {
  it("returns undefined unless insecure is explicitly true", () => {
    expect(buildEndpointDispatcher(false)).toBeUndefined();
    expect(buildEndpointDispatcher(true)).toBeInstanceOf(Agent);
  });
});
