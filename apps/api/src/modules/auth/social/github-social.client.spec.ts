import { GithubSocialClient } from "./github-social.client";

const CONFIG = {
  id: "github" as const,
  kind: "github" as const,
  label: "GitHub",
  clientId: "gh-client",
  clientSecret: "gh-secret",
  webUrl: "https://github.com",
  apiUrl: "https://api.github.com",
};
const REDIRECT = "https://opsdesk.example/api/v1/auth/social/github/callback";

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function makeClient(routes: Record<string, () => Promise<Response>>) {
  const http = jest.fn((url: string | URL | Request) => {
    const key = Object.keys(routes).find((k) => String(url).endsWith(k));
    return key ? routes[key]() : json({ message: "not found" }, 404);
  });
  return {
    client: new GithubSocialClient(CONFIG, REDIRECT, http as unknown as typeof fetch),
    http,
  };
}

const TX = { provider: "github" as const, state: "state-1" };

describe("GithubSocialClient", () => {
  it("builds the authorize URL with state, scopes and no sign-up", async () => {
    const { client } = makeClient({});
    const { url, tx } = await client.startLogin();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("gh-client");
    expect(u.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(u.searchParams.get("scope")).toBe("read:user user:email");
    expect(u.searchParams.get("state")).toBe(tx.state);
    expect(u.searchParams.get("allow_signup")).toBe("false");
  });

  it("exchanges the code and returns the numeric id and primary verified email", async () => {
    const { client, http } = makeClient({
      "/login/oauth/access_token": () => json({ access_token: "gho_x" }),
      "/user": () => json({ id: 4242, login: "priya", name: "Priya S" }),
      "/user/emails": () =>
        json([
          { email: "old@example.com", primary: false, verified: true },
          { email: "priya@example.com", primary: true, verified: true },
        ]),
    });
    await expect(client.completeLogin({ code: "c", state: "state-1" }, TX)).resolves.toEqual({
      provider: "github",
      issuer: "https://github.com",
      subject: "4242",
      email: "priya@example.com",
      emailVerified: true,
      name: "Priya S",
    });
    const tokenCall = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(tokenCall[1].body))).toMatchObject({
      client_secret: "gh-secret",
      code: "c",
    });
  });

  it("reports an unverified primary email as unverified", async () => {
    const { client } = makeClient({
      "/login/oauth/access_token": () => json({ access_token: "gho_x" }),
      "/user": () => json({ id: 1, login: "x", name: null }),
      "/user/emails": () => json([{ email: "x@example.com", primary: true, verified: false }]),
    });
    await expect(client.completeLogin({ code: "c", state: "state-1" }, TX)).resolves.toMatchObject({
      email: "x@example.com",
      emailVerified: false,
      name: "x",
    });
  });

  it("rejects a wrong state before calling GitHub", async () => {
    const { client, http } = makeClient({});
    await expect(client.completeLogin({ code: "c", state: "evil" }, TX)).rejects.toThrow(/state/);
    expect(http).not.toHaveBeenCalled();
  });

  it("surfaces a failed code exchange", async () => {
    const { client } = makeClient({
      "/login/oauth/access_token": () => json({ error: "bad_verification_code" }),
    });
    await expect(client.completeLogin({ code: "c", state: "state-1" }, TX)).rejects.toThrow(
      /bad_verification_code/,
    );
  });
});
