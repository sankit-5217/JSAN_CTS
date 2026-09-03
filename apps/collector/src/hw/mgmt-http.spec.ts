import { MgmtHttp, MgmtHttpError } from "./mgmt-http";
import type { MgmtFetch } from "./mgmt-http";

interface Call {
  url: string;
  headers: Record<string, string>;
}

function fake(responder: (url: string) => { ok: boolean; status: number; text: string }): {
  fetchImpl: MgmtFetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: MgmtFetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = responder(url);
    return { ok: r.ok, status: r.status, text: async () => r.text };
  };
  return { fetchImpl, calls };
}

const CRED = { username: "root", password: "calvin" };

describe("MgmtHttp", () => {
  it("GETs with Basic auth and an Accept header", async () => {
    const { fetchImpl, calls } = fake(() => ({ ok: true, status: 200, text: '{"ok":1}' }));
    const http = new MgmtHttp("https://10.20.1.40/", CRED, fetchImpl);

    const body = await http.get("/redfish/v1/Systems");

    expect(body).toEqual({ ok: 1 });
    expect(calls[0].url).toBe("https://10.20.1.40/redfish/v1/Systems");
    expect(calls[0].headers.authorization).toBe(
      `Basic ${Buffer.from("root:calvin").toString("base64")}`,
    );
    expect(calls[0].headers.accept).toBe("application/json");
  });

  it("throws MgmtHttpError on a non-2xx", async () => {
    const { fetchImpl } = fake(() => ({ ok: false, status: 401, text: "no" }));
    const http = new MgmtHttp("https://x", CRED, fetchImpl);
    await expect(http.get("/y")).rejects.toBeInstanceOf(MgmtHttpError);
  });

  it("tryGet swallows a 404 but re-throws other errors", async () => {
    const { fetchImpl } = fake((url) =>
      url.endsWith("/missing")
        ? { ok: false, status: 404, text: "" }
        : { ok: false, status: 500, text: "" },
    );
    const http = new MgmtHttp("https://x", CRED, fetchImpl);
    await expect(http.tryGet("/missing")).resolves.toBeUndefined();
    await expect(http.tryGet("/boom")).rejects.toBeInstanceOf(MgmtHttpError);
  });
});
