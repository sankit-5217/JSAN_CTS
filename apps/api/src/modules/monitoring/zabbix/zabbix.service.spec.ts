import { randomBytes } from "crypto";
import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import {
  SECRETS_KEY_ENV,
  decryptSecret,
  encryptSecret,
} from "../../../common/crypto/secret-cipher";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { AuthzService } from "../../auth/authz.service";
import { AuthenticatedUser } from "../../auth/types/jwt-payload.type";
import { ZabbixService, availabilityOf } from "./zabbix.service";

const KEY = randomBytes(32);
const ACTOR = { actorId: "user-1", correlationId: "corr-1" };
const ADMIN: AuthenticatedUser = {
  id: "u-admin",
  email: "admin@x",
  role: UserRole.SUPER_ADMIN,
  isActive: true,
};
const ENGINEER: AuthenticatedUser = {
  id: "u-eng",
  email: "eng@x",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
};

const HOSTS = [
  {
    hostid: "10084",
    host: "fw01",
    name: "Firewall 01",
    status: "0",
    maintenance_status: "0",
    tags: [
      { tag: "site", value: "SITE01" },
      { tag: "ci", value: "SITE01-FW-001" },
    ],
    interfaces: [
      { type: "2", ip: "10.0.0.1", dns: "", useip: "1", port: "161", available: "1", error: "" },
    ],
    hostgroups: [{ name: "Firewalls" }],
  },
  {
    hostid: "10085",
    host: "ups02",
    name: "UPS 02",
    status: "0",
    maintenance_status: "0",
    tags: [{ tag: "site", value: "SITE02" }],
    interfaces: [
      {
        type: "2",
        ip: "10.0.1.5",
        dns: "",
        useip: "1",
        port: "161",
        available: "2",
        error: "timeout",
      },
    ],
  },
];

type Handler = (params: Record<string, unknown>) => unknown;

/** Fake Zabbix: routes JSON-RPC methods to handlers and records calls. */
function fakeZabbix(handlers: Record<string, Handler>) {
  const calls: { method: string; params: Record<string, unknown>; auth?: string }[] = [];
  const fetchFn = jest.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      method: string;
      params: Record<string, unknown>;
    };
    const auth = (init.headers as Record<string, string>).Authorization;
    calls.push({ method: body.method, params: body.params, auth });
    const h = handlers[body.method];
    if (!h)
      return new Response(
        JSON.stringify({ error: { code: -32601, message: `no ${body.method}` } }),
      );
    return new Response(JSON.stringify({ jsonrpc: "2.0", result: h(body.params), id: 1 }));
  });
  return { fetchFn, calls };
}

/** host.get honouring hostids + tag filters like Zabbix does. */
const hostGet: Handler = (p) => {
  if (p.countOutput) return String(HOSTS.length);
  let hosts = HOSTS;
  if (p.hostids) hosts = hosts.filter((h) => (p.hostids as string[]).includes(h.hostid));
  if (p.tags) {
    const values = (p.tags as { value: string }[]).map((t) => t.value);
    hosts = hosts.filter((h) => h.tags.some((t) => t.tag === "site" && values.includes(t.value)));
  }
  return hosts;
};

describe("ZabbixService", () => {
  let prisma: {
    zabbixConnection: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
    site: { findMany: jest.Mock };
    configurationItem: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let authz: { getAccessibleSiteIds: jest.Mock };
  let service: ZabbixService;
  let row: Record<string, unknown>;

  beforeEach(() => {
    process.env[SECRETS_KEY_ENV] = KEY.toString("base64");
    row = {
      id: "conn-1",
      name: "default",
      apiUrl: "http://zbx/zabbix/api_jsonrpc.php",
      enabled: true,
      requestTimeoutMs: 5000,
      tokenCiphertext: encryptSecret("secret-token-1234", KEY),
      tokenLast4: "1234",
      tokenUpdatedAt: new Date("2026-10-09T00:00:00Z"),
      updatedAt: new Date("2026-10-09T00:00:00Z"),
    };
    prisma = {
      zabbixConnection: {
        findUnique: jest.fn(async () => row),
        update: jest.fn(async ({ data }) => ({ ...row, ...stripUndefined(data) })),
        create: jest.fn(async ({ data }) => ({ ...row, ...data })),
      },
      site: { findMany: jest.fn(async () => [{ code: "SITE01" }]) },
      configurationItem: {
        findMany: jest.fn(async () => [{ id: "ci-fw", ciCode: "SITE01-FW-001" }]),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    audit = { record: jest.fn() };
    authz = {
      getAccessibleSiteIds: jest.fn(async (u: AuthenticatedUser) =>
        u.role === UserRole.SUPER_ADMIN ? null : ["site-1"],
      ),
    };
    service = new ZabbixService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      authz as unknown as AuthzService,
    );
  });

  afterEach(() => {
    delete process.env[SECRETS_KEY_ENV];
  });

  describe("settings", () => {
    it("never returns the token or its ciphertext", async () => {
      const view = await service.getSettings();
      expect(view).toMatchObject({
        configured: true,
        tokenConfigured: true,
        tokenLast4: "1234",
        webUrl: "http://zbx/zabbix/",
      });
      expect(JSON.stringify(view)).not.toContain("secret-token");
      expect(view).not.toHaveProperty("tokenCiphertext");
    });

    it("encrypts a new token and audits without leaking it", async () => {
      await service.updateSettings({ apiToken: "new-token-abcd" }, ACTOR);
      const update = prisma.zabbixConnection.update.mock.calls[0][0].data;
      expect(update.apiUrl).toBeUndefined(); // token-only change leaves the URL alone
      expect(prisma.zabbixConnection.create).not.toHaveBeenCalled();
      expect(update.tokenLast4).toBe("abcd");
      expect(decryptSecret(update.tokenCiphertext, KEY)).toBe("new-token-abcd");
      const auditInput = audit.record.mock.calls[0][0];
      expect(auditInput).toMatchObject({
        entityType: "ZabbixConnection",
        action: "UPDATE",
        actorId: "user-1",
      });
      expect(auditInput.after.tokenChanged).toBe(true);
      expect(JSON.stringify(auditInput)).not.toContain("new-token-abcd");
    });

    it("creates the row the first time, and requires a URL for it", async () => {
      prisma.zabbixConnection.findUnique.mockResolvedValue(null);
      await expect(service.updateSettings({ enabled: true }, ACTOR)).rejects.toThrow(
        /apiUrl is required/,
      );
      await service.updateSettings({ apiUrl: "http://zbx/zabbix/api_jsonrpc.php" }, ACTOR);
      expect(prisma.zabbixConnection.create).toHaveBeenCalled();
      expect(audit.record.mock.calls[0][0].action).toBe("CREATE");
    });

    it("refuses to store a token when the secrets key is missing", async () => {
      delete process.env[SECRETS_KEY_ENV];
      await expect(
        service.updateSettings({ apiToken: "new-token-abcd" }, ACTOR),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.zabbixConnection.update).not.toHaveBeenCalled();
    });
  });

  describe("testConnection", () => {
    it("passes every check against a healthy Zabbix", async () => {
      const zbx = fakeZabbix({
        "apiinfo.version": () => "7.0.31",
        "host.get": hostGet,
        "problem.get": () => "3",
      });
      service.fetchFn = zbx.fetchFn as unknown as typeof fetch;
      const result = await service.testConnection();
      const byKey = Object.fromEntries(result.checks.map((c) => [c.key, c.status]));
      expect(byKey).toMatchObject({
        url: "PASS",
        reachable: "PASS",
        version: "PASS",
        token: "PASS",
        auth: "PASS",
        hosts: "PASS",
        "site-tags": "PASS",
        problems: "PASS",
      });
      expect(byKey.availability).toBe("WARN"); // ups02 is down
      expect(result.ok).toBe(true);
      expect(zbx.calls.find((c) => c.method === "apiinfo.version")?.auth).toBeUndefined();
      expect(zbx.calls.find((c) => c.method === "host.get")?.auth).toBe("Bearer secret-token-1234");
    });

    it("reports an unreachable server as a FAIL row instead of throwing", async () => {
      service.fetchFn = jest
        .fn()
        .mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;
      const result = await service.testConnection();
      expect(result.ok).toBe(false);
      expect(result.checks.find((c) => c.key === "reachable")?.status).toBe("FAIL");
    });

    it("reports a rejected token", async () => {
      const zbx = fakeZabbix({ "apiinfo.version": () => "7.0.31" });
      service.fetchFn = zbx.fetchFn as unknown as typeof fetch;
      const result = await service.testConnection({ apiToken: "wrong-token-xx" });
      expect(result.checks.find((c) => c.key === "auth")?.status).toBe("FAIL");
      expect(zbx.calls.find((c) => c.method === "host.get")?.auth).toBe("Bearer wrong-token-xx");
    });
  });

  describe("reads", () => {
    beforeEach(() => {
      const zbx = fakeZabbix({
        "host.get": hostGet,
        "problem.get": (p) => {
          const all = [
            {
              eventid: "500",
              objectid: "t1",
              clock: "1760000000",
              name: "Interface down",
              severity: "4",
              acknowledged: "0",
              suppressed: "0",
              opdata: "",
            },
            {
              eventid: "501",
              objectid: "t2",
              clock: "1760000100",
              name: "On battery",
              severity: "5",
              acknowledged: "0",
              suppressed: "0",
              opdata: "",
            },
          ];
          if (p.eventids) return all.filter((e) => (p.eventids as string[]).includes(e.eventid));
          return all;
        },
        "trigger.get": () => [
          { triggerid: "t1", hosts: [{ hostid: "10084" }] },
          { triggerid: "t2", hosts: [{ hostid: "10085" }] },
        ],
        "event.acknowledge": () => ({ eventids: ["500"] }),
      });
      service.fetchFn = zbx.fetchFn as unknown as typeof fetch;
    });

    it("shows all hosts to all-site roles with CMDB links and problem counts", async () => {
      const { items } = await service.listHosts(ADMIN);
      expect(items.map((h) => h.hostId)).toEqual(["10084", "10085"]);
      expect(items[0]).toMatchObject({
        siteCode: "SITE01",
        ciId: "ci-fw",
        availability: "UP",
        problemCount: 1,
        maxSeverity: 4,
      });
      expect(items[1]).toMatchObject({ availability: "DOWN", problemCount: 1, maxSeverity: 5 });
    });

    it("limits site-scoped users to hosts tagged with their sites", async () => {
      const { items } = await service.listHosts(ENGINEER);
      expect(items.map((h) => h.hostId)).toEqual(["10084"]);
    });

    it("hides another site's host as 404", async () => {
      await expect(service.getHost(ENGINEER, "10085")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("lists problems with host details, scoped by site", async () => {
      const admin = await service.listProblems(ADMIN, {});
      expect(admin.items).toHaveLength(2);
      expect(admin.items[0]).toMatchObject({
        eventId: "500",
        severityLabel: "High",
        host: { hostId: "10084" },
      });
    });

    it("acknowledges and audits", async () => {
      await service.acknowledgeProblem(ENGINEER, "500", { message: "on it" }, ACTOR);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "ZabbixProblem",
          entityId: "500",
          action: "ACKNOWLEDGE",
        }),
      );
    });

    it("will not acknowledge a problem on another site", async () => {
      await expect(service.acknowledgeProblem(ENGINEER, "501", {}, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  it("rejects a second plain acknowledge", async () => {
    const zbx = fakeZabbix({
      "host.get": hostGet,
      "problem.get": () => [
        { eventid: "500", objectid: "t1", name: "x", severity: "4", acknowledged: "1" },
      ],
      "trigger.get": () => [{ triggerid: "t1", hosts: [{ hostid: "10084" }] }],
    });
    service.fetchFn = zbx.fetchFn as unknown as typeof fetch;
    await expect(service.acknowledgeProblem(ADMIN, "500", {}, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("explains a missing configuration", async () => {
    row.tokenCiphertext = null;
    await expect(service.listHosts(ADMIN)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "ZABBIX_NOT_CONFIGURED" }),
    });
  });

  it("maps Zabbix failures to 502", async () => {
    service.fetchFn = jest
      .fn()
      .mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;
    await expect(service.listHosts(ADMIN)).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe("availabilityOf", () => {
  it("prefers DOWN, then UP, then active agent state", () => {
    expect(
      availabilityOf({ interfaces: [{ available: "1" } as never, { available: "2" } as never] }),
    ).toBe("DOWN");
    expect(availabilityOf({ interfaces: [{ available: "1" } as never] })).toBe("UP");
    expect(availabilityOf({ interfaces: [], active_available: "1" })).toBe("UP");
    expect(availabilityOf({ interfaces: [] })).toBe("UNKNOWN");
  });
});

function stripUndefined(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}
