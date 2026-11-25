import { ZabbixApiError, callZabbix, zabbixWebBaseUrl } from "./zabbix-api.client";

const EP = { url: "http://zbx/api_jsonrpc.php", token: "tok", timeoutMs: 1000 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("callZabbix", () => {
  it("sends a JSON-RPC request with a Bearer token and returns the result", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(jsonResponse({ jsonrpc: "2.0", result: [1], id: 1 }));
    const result = await callZabbix<number[]>(EP, "host.get", { limit: 1 }, fetchFn);
    expect(result).toEqual([1]);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(EP.url);
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toMatchObject({
      jsonrpc: "2.0",
      method: "host.get",
      params: { limit: 1 },
    });
  });

  it("omits the token for apiinfo.version", async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ result: "7.0.31" }));
    await callZabbix(EP, "apiinfo.version", {}, fetchFn);
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("maps a Zabbix error object to an API error", async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        error: { code: -32602, message: "Invalid params.", data: "Not authorized." },
      }),
    );
    await expect(callZabbix(EP, "host.get", {}, fetchFn)).rejects.toMatchObject({
      kind: "API",
      message: "Invalid params. Not authorized.",
    });
  });

  it("maps HTTP failures", async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response("nope", { status: 502 }));
    await expect(callZabbix(EP, "host.get", {}, fetchFn)).rejects.toMatchObject({ kind: "HTTP" });
  });

  it("maps non-JSON bodies", async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(callZabbix(EP, "host.get", {}, fetchFn)).rejects.toMatchObject({
      kind: "BAD_RESPONSE",
    });
  });

  it("maps network and timeout failures", async () => {
    const net = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
      );
    await expect(callZabbix(EP, "host.get", {}, net)).rejects.toMatchObject({
      kind: "NETWORK",
      message: expect.stringContaining("ECONNREFUSED"),
    });
    const timeout = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" }));
    await expect(callZabbix(EP, "host.get", {}, timeout)).rejects.toBeInstanceOf(ZabbixApiError);
    await expect(callZabbix(EP, "host.get", {}, timeout)).rejects.toMatchObject({
      kind: "TIMEOUT",
    });
  });
});

describe("zabbixWebBaseUrl", () => {
  it("strips api_jsonrpc.php", () => {
    expect(zabbixWebBaseUrl("http://127.0.0.1/zabbix/api_jsonrpc.php")).toBe(
      "http://127.0.0.1/zabbix/",
    );
  });
});
