import { createHash, randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AgentEnrollment } from "@prisma/client";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { ActorContext } from "../../../common/types/actor-context.type";
import { AuditService } from "../../audit/audit.service";
import { CmdbService } from "../../cmdb/cmdb.service";
import { ZabbixService } from "../zabbix/zabbix.service";
import { AgentStatusDto, CreateAgentEnrollmentDto, RegisterAgentDto } from "./agent-enrollment.dto";

export type InstallerOs = "linux" | "windows";

/** Longest an enrollment link may live; the admin picks 1..this many days. */
export const MAX_ENROLLMENT_DAYS = 30;

const SCRIPT_FILES: Record<InstallerOs, string> = {
  linux: "install.sh",
  windows: "install.ps1",
};

/** Enrollment codes are 32 random bytes, base64url (43 chars). */
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * One-line monitoring agent enrollment (monitoring module). An admin creates a
 * per-site link; the client runs `curl .../install.sh | sudo bash` (or the
 * PowerShell equivalent) on any number of machines; each machine registers
 * here and gets its own Zabbix host + PSK and a CMDB record in that site.
 * Zabbix work goes through ZabbixService and CMDB records through
 * CmdbService — this module never writes either directly.
 */
@Injectable()
export class AgentEnrollmentService {
  private readonly logger = new Logger(AgentEnrollmentService.name);
  private readonly scripts = new Map<InstallerOs, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly zabbix: ZabbixService,
    private readonly cmdb: CmdbService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------ admin side

  async create(dto: CreateAgentEnrollmentDto, actor: ActorContext) {
    const site = await this.prisma.site.findUnique({ where: { id: dto.siteId } });
    if (!site) throw new NotFoundException(`Site ${dto.siteId} not found`);
    // Fail now (not on the client's machine) if Zabbix can't take agents yet.
    await this.zabbix.agentInstallTarget();

    const code = randomBytes(32).toString("base64url");
    const days = dto.expiresInDays ?? 7;
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agentEnrollment.create({
        data: {
          siteId: site.id,
          label: dto.label?.trim() || null,
          codeHash: hashCode(code),
          expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000),
          createdById: actor.actorId,
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          entityType: "AgentEnrollment",
          entityId: created.id,
          action: "AGENT_ENROLLMENT_CREATED",
          // Never the code itself: it is a credential.
          after: { siteCode: site.code, label: created.label, expiresAt: created.expiresAt },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return created;
    });
    return { ...this.toView(row, site.code), code, commands: this.commands(code) };
  }

  async list(siteId?: string) {
    const rows = await this.prisma.agentEnrollment.findMany({
      where: siteId ? { siteId } : undefined,
      include: { site: { select: { code: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((r) => this.toView(r, r.site.code));
  }

  async revoke(id: string, actor: ActorContext) {
    const row = await this.prisma.agentEnrollment.findUnique({
      where: { id },
      include: { site: { select: { code: true } } },
    });
    if (!row) throw new NotFoundException(`Enrollment ${id} not found`);
    if (row.revokedAt) return this.toView(row, row.site.code);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.agentEnrollment.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(
        {
          actorId: actor.actorId,
          entityType: "AgentEnrollment",
          entityId: id,
          action: "AGENT_ENROLLMENT_REVOKED",
          before: { revokedAt: null },
          after: { revokedAt: u.revokedAt },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return u;
    });
    return this.toView(updated, row.site.code);
  }

  // ----------------------------------------------------------- public side

  /** The installer for one OS with this link's settings filled in. */
  async renderInstaller(code: string, os: InstallerOs): Promise<string> {
    const { enrollment, siteCode } = await this.resolve(code);
    const target = await this.zabbix.agentInstallTarget();
    const series = target.version.split(".").slice(0, 2).join(".");
    const values: Record<string, string> = {
      __OPSDESK_API__: this.apiBase(),
      __OPSDESK_CODE__: code,
      __OPSDESK_SITE__: siteCode,
      __OPSDESK_ZBX_VERSION__: target.version,
      __OPSDESK_ZBX_SERIES__: series,
      __OPSDESK_SERVER__: target.serverAddress,
    };
    this.logger.log(`installer (${os}) served for enrollment ${enrollment.id} (${siteCode})`);
    return renderTemplate(this.script(os), values);
  }

  /**
   * The installer, or — when the link is invalid/expired/revoked or the server
   * side isn't ready — a tiny script that prints why and exits non-zero.
   * Served with HTTP 200 on purpose: with `curl -f ... | bash` a 4xx/5xx makes
   * curl print only "error: 404" and bash then exits 0 on its empty input, so
   * the client would neither understand the problem nor get a failing exit code.
   */
  async installerOrError(code: string, os: InstallerOs): Promise<string> {
    try {
      return await this.renderInstaller(code, os);
    } catch (err) {
      if (!(err instanceof HttpException)) throw err;
      const body = err.getResponse() as { message?: unknown } | string;
      const message =
        typeof body === "string"
          ? body
          : typeof body.message === "string"
            ? body.message
            : "The installer could not be prepared";
      return errorScript(os, message);
    }
  }

  /**
   * Called by the installer on the client's machine. Creates or refreshes the
   * machine's Zabbix host (new PSK every time) and its CMDB record, audited as
   * the admin who created the link.
   */
  async register(code: string, dto: RegisterAgentDto) {
    const { enrollment, siteCode } = await this.resolve(code);
    const target = await this.zabbix.agentInstallTarget();
    const host = agentHostName(siteCode, dto.hostname);
    const ciCode = host;
    const actor: ActorContext = {
      actorId: enrollment.createdById,
      correlationId: `agent-enrollment:${enrollment.id}`,
    };

    // A different machine already enrolled under this name: never take it over.
    const existingCi = await this.cmdb.findByCode(ciCode);
    if (existingCi && existingCi.siteId !== enrollment.siteId) {
      throw new ConflictException({
        code: "AGENT_NAME_OTHER_SITE",
        message: `${ciCode} is already registered to another site`,
      });
    }
    const knownMachine = (existingCi?.metadata as { machineId?: string } | null)?.machineId;
    if (knownMachine && knownMachine !== dto.machineId) {
      throw new ConflictException({
        code: "AGENT_NAME_TAKEN",
        message: `Another machine is already enrolled as ${host}. Rename this one or re-run with --name <NAME> (Windows: $env:OPSDESK_AGENT_NAME).`,
      });
    }

    const psk = randomBytes(32).toString("hex");
    const pskIdentity = `opsdesk-${host}`;
    const zbx = await this.zabbix.upsertAgentHost({
      host,
      name: `${dto.hostname} (${siteCode})`,
      siteCode,
      ciCode,
      os: dto.os,
      pskIdentity,
      psk,
    });

    const metadata = {
      enrolledVia: "agent-enrollment",
      enrollmentId: enrollment.id,
      machineId: dto.machineId,
      os: dto.os,
      osVersion: dto.osVersion ?? null,
      zabbixHostId: zbx.hostId,
    };
    if (!existingCi) {
      await this.cmdb.create(
        {
          ciCode,
          siteId: enrollment.siteId,
          ciType: "SERVER",
          name: dto.hostname,
          managementAddress: dto.address || undefined,
          managedBy: "SHARED",
          criticality: "MEDIUM",
          metadata,
        },
        actor,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.agentEnrollment.update({
        where: { id: enrollment.id },
        data: { enrolledCount: { increment: 1 }, lastUsedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          entityType: "AgentEnrollment",
          entityId: enrollment.id,
          action: "AGENT_ENROLLED",
          // The PSK is never written to the audit trail.
          after: {
            host,
            siteCode,
            os: dto.os,
            osVersion: dto.osVersion ?? null,
            address: dto.address ?? null,
            zabbixHostId: zbx.hostId,
            newHost: zbx.created,
          },
          correlationId: actor.correlationId,
        },
        tx,
      );
    });
    this.logger.log(`agent ${host} enrolled (${zbx.created ? "new" : "re-enrolled"})`);
    return { hostName: host, serverActive: target.serverAddress, pskIdentity, psk };
  }

  /**
   * The installer's final check: does Zabbix see this machine's agent? Only
   * answers for a usable link and the machine that registered the name.
   */
  async status(code: string, dto: AgentStatusDto) {
    const { enrollment, siteCode } = await this.resolve(code);
    const host = agentHostName(siteCode, dto.hostname);
    const ci = await this.cmdb.findByCode(host);
    const knownMachine = (ci?.metadata as { machineId?: string } | null)?.machineId;
    if (!ci || ci.siteId !== enrollment.siteId || (knownMachine && knownMachine !== dto.machineId)) {
      throw new NotFoundException({ code: "AGENT_NOT_ENROLLED", message: `${host} is not enrolled from this machine` });
    }
    return { hostName: host, agent: await this.zabbix.agentHostAvailability(host) };
  }

  // -------------------------------------------------------------- helpers

  /** A usable link, or a uniform 404 (never says whether a code exists). */
  private async resolve(code: string): Promise<{ enrollment: AgentEnrollment; siteCode: string }> {
    const notFound = new NotFoundException({
      code: "ENROLLMENT_INVALID",
      message: "This enrollment link is invalid, expired or revoked. Ask JSAN for a new one.",
    });
    if (!CODE_PATTERN.test(code)) throw notFound;
    const row = await this.prisma.agentEnrollment.findUnique({
      where: { codeHash: hashCode(code) },
      include: { site: { select: { code: true } } },
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) throw notFound;
    return { enrollment: row, siteCode: row.site.code };
  }

  private apiBase(): string {
    const base = (this.config.get<string>("API_PUBLIC_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
    return `${base}/api/v1`;
  }

  private commands(code: string) {
    const base = `${this.apiBase()}/enroll/${code}`;
    return {
      linux: `curl -fsSL ${base}/install.sh | sudo bash`,
      windowsPowerShell: `irm ${base}/install.ps1 | iex`,
      // Not "-Command -": PowerShell then reads stdin line by line and silently
      // skips the installer's multi-line block (exit 0). Read it whole, then run it.
      windowsCurl: `curl.exe -fsSL ${base}/install.ps1 | powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::In.ReadToEnd() | iex"`,
    };
  }

  private script(os: InstallerOs): string {
    let text = this.scripts.get(os);
    if (!text) {
      text = readFileSync(join(__dirname, "scripts", SCRIPT_FILES[os]), "utf8");
      this.scripts.set(os, text);
    }
    return text;
  }

  private toView(row: AgentEnrollment, siteCode: string) {
    const now = Date.now();
    return {
      id: row.id,
      siteId: row.siteId,
      siteCode,
      label: row.label,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      status: row.revokedAt ? "REVOKED" : row.expiresAt.getTime() <= now ? "EXPIRED" : "ACTIVE",
      enrolledCount: row.enrolledCount,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** "SITE04" + "web-01.corp" → "SITE04-WEB-01.CORP" (a valid Zabbix host name and CMDB code). */
export function agentHostName(siteCode: string, hostname: string): string {
  const clean = hostname
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .toUpperCase();
  if (!clean || clean === "-") throw new BadRequestException("hostname has no usable characters");
  const prefix = `${siteCode}-`;
  const name = clean.startsWith(prefix) ? clean : `${prefix}${clean}`;
  return name.slice(0, 120);
}

/** Characters allowed in any value written into an installer script. */
const SAFE_SCRIPT_VALUE = /^[A-Za-z0-9._:/-]+$/;

/**
 * Replaces every __PLACEHOLDER__. Throws if a value has a character outside
 * SAFE_SCRIPT_VALUE (nothing can break out of the script's quotes) or if a
 * placeholder is left (a template/code mismatch).
 */
export function renderTemplate(template: string, values: Record<string, string>): string {
  for (const [key, value] of Object.entries(values)) {
    if (!SAFE_SCRIPT_VALUE.test(value)) {
      throw new Error(`installer value for ${key} has characters that are not allowed in a script`);
    }
  }
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.split(key).join(value);
  const left = out.match(/__OPSDESK_[A-Z_]+__/);
  if (left) throw new Error(`installer template placeholder ${left[0]} has no value`);
  return out;
}

/**
 * A script that only explains a failure and exits 1 (R20). The message is
 * reduced to plain characters so it cannot break out of its quotes.
 */
export function errorScript(os: InstallerOs, message: string): string {
  const text = message
    .replace(/[^A-Za-z0-9 .,:()/_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const lines =
    os === "linux"
      ? [
          "#!/usr/bin/env bash",
          "# JSAN OpsDesk monitoring agent installer - not available",
          `echo "ERROR: ${text}" >&2`,
          "exit 1",
        ]
      : [
          "# JSAN OpsDesk monitoring agent installer - not available",
          `Write-Host 'ERROR: ${text}' -ForegroundColor Red`,
          // `iex` cannot exit the caller's shell; a terminating error stops the line.
          "throw 'JSAN OpsDesk installer not available'",
        ];
  return lines.join("\n") + "\n";
}
