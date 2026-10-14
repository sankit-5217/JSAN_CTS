import { ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { CmdbService } from "../../cmdb/cmdb.service";
import { ZabbixService } from "../zabbix/zabbix.service";
import {
  AgentEnrollmentService,
  agentHostName,
  errorScript,
  hashCode,
} from "./agent-enrollment.service";

const SITE = { id: "11111111-1111-4111-8111-111111111111", code: "SITE04" };
const ACTOR = { actorId: "admin-1", correlationId: "corr-1" };
const MACHINE = "a".repeat(32);

function setup() {
  const rows = new Map<string, Record<string, unknown>>();
  const auditRecords: Record<string, unknown>[] = [];
  const tx = {
    agentEnrollment: {
      create: jest.fn(async ({ data }) => {
        const row = {
          id: "enr-1",
          enrolledCount: 0,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
          ...data,
        };
        rows.set(row.codeHash, row);
        return row;
      }),
      update: jest.fn(async ({ data }) => ({ ...[...rows.values()][0], ...data })),
    },
  };
  const prisma = {
    site: { findUnique: jest.fn(async () => SITE) },
    agentEnrollment: {
      findUnique: jest.fn(async ({ where }) => {
        const row = rows.get(where.codeHash);
        return row ? { ...row, site: { code: SITE.code } } : null;
      }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const audit = {
    record: jest.fn(async (rec: Record<string, unknown>) => {
      auditRecords.push(rec);
    }),
  } as unknown as AuditService;
  const zabbix = {
    agentInstallTarget: jest.fn(async () => ({
      version: "7.0.31",
      serverAddress: "zbx.example.com:12762",
    })),
    upsertAgentHost: jest.fn(async () => ({ hostId: "10500", created: true })),
    agentHostAvailability: jest.fn(async () => "AVAILABLE"),
  } as unknown as ZabbixService;
  const cmdb = {
    findByCode: jest.fn(async () => null),
    create: jest.fn(async () => ({ id: "ci-1" })),
  } as unknown as CmdbService;
  const config = {
    get: jest.fn(() => "https://api.example.com"),
  } as unknown as ConfigService;
  const svc = new AgentEnrollmentService(prisma, audit, zabbix, cmdb, config);
  return { svc, rows, auditRecords, zabbix, cmdb, prisma };
}

describe("AgentEnrollmentService", () => {
  it("creates a link: stores only the hash, returns the code and commands once, audits without the code", async () => {
    const { svc, rows, auditRecords } = setup();
    const res = await svc.create({ siteId: SITE.id, label: "Acme servers" }, ACTOR);

    expect(res.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...rows.keys()]).toEqual([hashCode(res.code)]);
    expect(res.commands.linux).toBe(
      `curl -fsSL https://api.example.com/api/v1/enroll/${res.code}/install.sh | sudo bash`,
    );
    expect(res.commands.windowsPowerShell).toContain(`/enroll/${res.code}/install.ps1 | iex`);
    expect(res.commands.windowsCurl).toMatch(/^curl\.exe -fsSL .*\| powershell /);
    expect(res.status).toBe("ACTIVE");
    expect(JSON.stringify(auditRecords)).not.toContain(res.code);
    expect(auditRecords[0]).toMatchObject({ action: "AGENT_ENROLLMENT_CREATED", actorId: "admin-1" });
  });

  it("defaults to 7 days", async () => {
    const { svc } = setup();
    const res = await svc.create({ siteId: SITE.id }, ACTOR);
    const days = (new Date(res.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("serves the installer with the link's values filled in", async () => {
    const { svc } = setup();
    const { code } = await svc.create({ siteId: SITE.id }, ACTOR);
    const sh = await svc.renderInstaller(code, "linux");
    expect(sh).toContain(`readonly ENROLL_CODE="${code}"`);
    expect(sh).toContain('readonly SITE_CODE="SITE04"');
    expect(sh).toContain('readonly ZBX_SERIES="7.0"');
    const ps1 = await svc.renderInstaller(code, "windows");
    expect(ps1).toContain("$ZbxVersion = '7.0.31'");
  });

  it.each([
    ["malformed", (code: string) => code.slice(1)],
    ["unknown", () => "B".repeat(43)],
  ])("404s a %s code", async (_label, mutate) => {
    const { svc } = setup();
    const { code } = await svc.create({ siteId: SITE.id }, ACTOR);
    await expect(svc.renderInstaller(mutate(code), "linux")).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ["expired", { expiresAt: new Date(Date.now() - 1000) }],
    ["revoked", { revokedAt: new Date() }],
  ])("404s an %s link", async (_label, patch) => {
    const { svc, rows } = setup();
    const { code } = await svc.create({ siteId: SITE.id }, ACTOR);
    Object.assign(rows.get(hashCode(code))!, patch);
    await expect(svc.register(code, { hostname: "web-01", os: "linux", machineId: MACHINE })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("registers a machine: Zabbix host with its own PSK, CMDB record, audit without the PSK", async () => {
    const { svc, zabbix, cmdb, auditRecords } = setup();
    const { code } = await svc.create({ siteId: SITE.id }, ACTOR);
    const res = await svc.register(code, {
      hostname: "web-01",
      os: "linux",
      osVersion: "Ubuntu 24.04 LTS",
      machineId: MACHINE,
      address: "10.0.0.10",
    });

    expect(res).toMatchObject({
      hostName: "SITE04-WEB-01",
      serverActive: "zbx.example.com:12762",
      pskIdentity: "opsdesk-SITE04-WEB-01",
    });
    expect(res.psk).toMatch(/^[a-f0-9]{64}$/);
    expect(zabbix.upsertAgentHost).toHaveBeenCalledWith(
      expect.objectContaining({ host: "SITE04-WEB-01", siteCode: "SITE04", os: "linux", psk: res.psk }),
    );
    expect(cmdb.create).toHaveBeenCalledWith(
      expect.objectContaining({ ciCode: "SITE04-WEB-01", siteId: SITE.id, ciType: "SERVER" }),
      { actorId: "admin-1", correlationId: "agent-enrollment:enr-1" },
    );
    expect(JSON.stringify(auditRecords)).not.toContain(res.psk);
    expect(auditRecords.at(-1)).toMatchObject({ action: "AGENT_ENROLLED" });
  });

  it("re-enrolling the same machine refreshes it without a second CMDB record", async () => {
    const { svc, cmdb } = setup();
    (cmdb.findByCode as jest.Mock).mockResolvedValue({
      id: "ci-1",
      siteId: SITE.id,
      metadata: { machineId: MACHINE },
    });
    const { code } = await svc.create({ siteId: SITE.id }, ACTOR);
    await svc.register(code, { hostname: "web-01", os: "linux", machineId: MACHINE });
    expect(cmdb.create).not.toHaveBeenCalled();
  });

  it("refuses a different machine with the same name (no silent takeover)", async () => {
    const { svc, cmdb, zabbix } = setup();
    (cmdb.findByCode as jest.Mock).mockResolvedValue({
      id: "ci-1",
      siteId: SITE.id,
      metadata: { machineId: "b".repeat(32) },
    });
    const { code } = await svc.create({ siteId: SITE.id }, ACTOR);
    await expect(
      svc.register(code, { hostname: "web-01", os: "linux", machineId: MACHINE }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(zabbix.upsertAgentHost).not.toHaveBeenCalled();
  });

  it("refuses a name that belongs to another site", async () => {
    const { svc, cmdb } = setup();
    (cmdb.findByCode as jest.Mock).mockResolvedValue({ id: "ci-9", siteId: "other-site", metadata: null });
    const { code } = await svc.create({ siteId: SITE.id }, ACTOR);
    await expect(
      svc.register(code, { hostname: "web-01", os: "windows", machineId: MACHINE }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("installer status check (R13)", () => {
  it("reports what Zabbix sees for the machine that enrolled the name", async () => {
    const { svc, cmdb } = setup();
    (cmdb.findByCode as jest.Mock).mockResolvedValue({ id: "ci-1", siteId: SITE.id, metadata: { machineId: MACHINE } });
    const { code } = await svc.create({ siteId: SITE.id }, ACTOR);
    await expect(svc.status(code, { hostname: "web-01", machineId: MACHINE })).resolves.toEqual({
      hostName: "SITE04-WEB-01",
      agent: "AVAILABLE",
    });
  });

  it("does not answer for another machine, another site or an unknown name", async () => {
    const { svc, cmdb } = setup();
    const { code } = await svc.create({ siteId: SITE.id }, ACTOR);
    for (const ci of [
      null,
      { id: "ci-1", siteId: SITE.id, metadata: { machineId: "b".repeat(32) } },
      { id: "ci-1", siteId: "other", metadata: { machineId: MACHINE } },
    ]) {
      (cmdb.findByCode as jest.Mock).mockResolvedValueOnce(ci);
      await expect(svc.status(code, { hostname: "web-01", machineId: MACHINE })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
  });
});

describe("R20: a bad link fails clearly with a non-zero exit", () => {
  it("serves an explaining script instead of a 404 for an unknown code", async () => {
    const { svc } = setup();
    const sh = await svc.installerOrError("B".repeat(43), "linux");
    expect(sh).toContain("invalid, expired or revoked");
    expect(sh).toContain("exit 1");
    expect(sh).not.toContain("ENROLL_CODE");
    const ps1 = await svc.installerOrError("B".repeat(43), "windows");
    expect(ps1).toContain("throw");
  });

  it("explains a server-side problem too (Zabbix not ready)", async () => {
    const { svc, zabbix } = setup();
    const { code } = await svc.create({ siteId: SITE.id }, ACTOR);
    const { ServiceUnavailableException } = await import("@nestjs/common");
    (zabbix.agentInstallTarget as jest.Mock).mockRejectedValueOnce(
      new ServiceUnavailableException({ code: "X", message: "Zabbix is switched off" }),
    );
    expect(await svc.installerOrError(code, "linux")).toContain("Zabbix is switched off");
  });

  it("the error script really exits 1 in bash, and hostile text cannot escape its quotes", () => {
    const { spawnSync } = jest.requireActual<typeof import("child_process")>("child_process");
    if (spawnSync("bash", ["-c", "true"]).status !== 0) return;
    const script = errorScript("linux", 'Link gone"; touch /tmp/pwned; echo "$(id)`id`');
    expect(script).not.toMatch(/[$`"]\s*;|\$\(|`/);
    const r = spawnSync("bash", ["-s"], { input: script, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ERROR: Link gone");
  });
});

describe("agentHostName", () => {
  it.each([
    ["web-01", "SITE04-WEB-01"],
    ["Web_01.corp", "SITE04-WEB_01.CORP"],
    ["site04-db", "SITE04-DB"],
    ["a  b", "SITE04-A-B"],
  ])("%s → %s", (input, expected) => {
    expect(agentHostName("SITE04", input)).toBe(expected);
  });
});
