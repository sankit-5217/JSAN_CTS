// Minimal OpsDesk API client for the onboarding kit (admin session).

export async function opsdeskClient(api, email, password) {
  let jwt;
  async function call(method, path, body) {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = new Error(`OpsDesk ${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  jwt = (await call("POST", "/auth/login", { email, password })).accessToken;
  const items = (x) => (Array.isArray(x) ? x : (x?.items ?? []));

  return {
    call,
    async adminUserId() {
      const me = items(await call("GET", "/admin/users")).find((u) => u.email === email);
      if (!me) throw new Error(`OpsDesk user ${email} not found in the user list`);
      return me.id;
    },
    async findSite(code) {
      return items(await call("GET", "/sites?limit=200")).find((s) => s.code === code) ?? null;
    },
    async createSite({ code, name, timezone, is247 }) {
      return call("POST", "/sites", { code, name, timezone, is247 });
    },
    async findCi(ciCode) {
      const list = items(await call("GET", `/cis?q=${encodeURIComponent(ciCode)}&limit=20`));
      return list.find((c) => c.ciCode === ciCode) ?? null;
    },
    async createCi(ci) {
      return call("POST", "/cis", ci);
    },
  };
}
