import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ZabbixConnection } from "@prisma/client";
import {
  SecretDecryptError,
  SecretsKeyMissingError,
  decryptSecret,
  encryptSecret,
  loadSecretsKey,
} from "../../../common/crypto/secret-cipher";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { ActorContext } from "../../../common/types/actor-context.type";
import { AuditService } from "../../audit/audit.service";
import { AuthzService } from "../../auth/authz.service";
import { AuthenticatedUser } from "../../auth/types/jwt-payload.type";
import { ZabbixApiError, ZabbixEndpoint, callZabbix, zabbixWebBaseUrl } from "./zabbix-api.client";
import {
  AcknowledgeZabbixProblemDto,
  ListZabbixProblemsQueryDto,
  TestZabbixConnectionDto,
  UpdateZabbixSettingsDto,
  ZabbixHistoryQueryDto,
} from "./zabbix.dto";

/** The seeded row every read uses (one Zabbix server per deployment in v1). */
export const DEFAULT_CONNECTION_NAME = "default";

/** Host tags that tie a Zabbix host to an OpsDesk site and CMDB item. */
export const SITE_TAG = "site";
export const CI_TAG = "ci";

export const SEVERITY_LABELS = [
  "Not classified",
  "Information",
  "Warning",
  "Average",
  "High",
  "Disaster",
] as const;

const MAX_HISTORY_RANGE_S = 31 * 24 * 3600;
const TRENDS_AFTER_S = 3 * 24 * 3600; // longer ranges read hourly trends
const DEFAULT_HISTORY_RANGE_S = 6 * 3600;

// Zabbix item value types: 0 float, 1 char, 2 log, 3 unsigned, 4 text.
const NUMERIC_VALUE_TYPES = new Set(["0", "3"]);

export type CheckStatus = "PASS" | "WARN" | "FAIL" | "SKIP";
export interface ConnectionCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export type Availability = "UP" | "DOWN" | "UNKNOWN";

export interface RawTag {
  tag: string;
  value: string;
}
export interface RawInterface {
  type: string;
  ip: string;
  dns: string;
  useip: string;
  port: string;
  available: string;
  error: string;
}
export interface RawHost {
  hostid: string;
  host: string;
  name: string;
  status: string;
  maintenance_status: string;
  active_available?: string;
  tags?: RawTag[];
  interfaces?: RawInterface[];
  hostgroups?: { name: string }[];
}
export interface RawProblem {
  eventid: string;
  objectid: string;
  clock: string;
  name: string;
  severity: string;
  acknowledged: string;
  suppressed: string;
  opdata: string;
  tags?: RawTag[];
  acknowledges?: { clock: string; message: string; action: string; username?: string }[];
}
export interface RawItem {
  itemid: string;
  hostid: string;
  name: string;
  key_: string;
  lastvalue: string;
  lastclock: string;
  prevvalue: string;
  units: string;
  value_type: string;
  state: string;
  error: string;
}

const INTERFACE_TYPES: Record<string, string> = {
  "1": "AGENT",
  "2": "SNMP",
  "3": "IPMI",
  "4": "JMX",
};

/**
 * Zabbix integration (monitoring module). Owns the ZabbixConnection settings
 * row and proxies live, read-only views of Zabbix to OpsDesk users, filtered
 * by the same site scope as every other read. The single write is problem
 * acknowledgement, which is audited. Nothing Zabbix returns is persisted —
 * raw telemetry stays in Zabbix (spec §3.2, ADR-003).
 */
@Injectable()
export class ZabbixService {
  private readonly logger = new Logger(ZabbixService.name);
  /** Swappable in tests. */
  fetchFn: typeof fetch = (...args) => fetch(...args);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authz: AuthzService,
  ) {}

  // ---------------------------------------------------------------- settings

  async getSettings() {
    const row = await this.prisma.zabbixConnection.findUnique({
      where: { name: DEFAULT_CONNECTION_NAME },
    });
    return this.toSettingsView(row);
  }

  async updateSettings(dto: UpdateZabbixSettingsDto, actor: ActorContext) {
    if (dto.apiToken && dto.clearToken) {
      throw new BadRequestException("Send either apiToken or clearToken, not both");
    }
    const before = await this.prisma.zabbixConnection.findUnique({
      where: { name: DEFAULT_CONNECTION_NAME },
    });
    if (!before && !dto.apiUrl) {
      throw new BadRequestException("apiUrl is required the first time Zabbix is configured");
    }

    const tokenData: Partial<ZabbixConnection> = {};
    if (dto.apiToken) {
      const token = dto.apiToken.trim();
      tokenData.tokenCiphertext = encryptSecret(token, this.secretsKey());
      tokenData.tokenLast4 = token.slice(-4);
      tokenData.tokenUpdatedAt = new Date();
    } else if (dto.clearToken) {
      tokenData.tokenCiphertext = null;
      tokenData.tokenLast4 = null;
      tokenData.tokenUpdatedAt = new Date();
    }
    const fields = {
      apiUrl: dto.apiUrl?.trim(),
      enabled: dto.enabled,
      requestTimeoutMs: dto.requestTimeoutMs,
      ...tokenData,
    };

    return this.prisma.$transaction(async (tx) => {
      // Not an upsert: Prisma validates the `create` branch even when the row
      // exists, and a partial update (e.g. token only) has no apiUrl for it.
      const after = before
        ? await tx.zabbixConnection.update({
            where: { name: DEFAULT_CONNECTION_NAME },
            data: fields,
          })
        : await tx.zabbixConnection.create({
            data: {
              name: DEFAULT_CONNECTION_NAME,
              apiUrl: fields.apiUrl as string,
              enabled: fields.enabled ?? true,
              requestTimeoutMs: fields.requestTimeoutMs ?? 10000,
              ...tokenData,
            },
          });
      const beforeView = before ? this.toSettingsView(before) : null;
      const afterView = this.toSettingsView(after);
      await this.audit.record(
        {
          actorId: actor.actorId,
          entityType: "ZabbixConnection",
          entityId: after.id,
          action: before ? "UPDATE" : "CREATE",
          // The token itself is never written to the audit trail.
          before: beforeView,
          after: {
            ...afterView,
            tokenChanged: Boolean(dto.apiToken),
            tokenCleared: Boolean(dto.clearToken),
          },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return afterView;
    });
  }

  /**
   * Pass/fail checklist for the connection — what the settings page shows
   * under "Test connection". Never throws for Zabbix-side failures; each one
   * becomes a FAIL row with the reason.
   */
  async testConnection(overrides: TestZabbixConnectionDto = {}) {
    const checks: ConnectionCheck[] = [];
    const add = (key: string, label: string, status: CheckStatus, detail: string) =>
      checks.push({ key, label, status, detail });

    const row = await this.prisma.zabbixConnection.findUnique({
      where: { name: DEFAULT_CONNECTION_NAME },
    });
    const url = overrides.apiUrl ?? row?.apiUrl;
    const timeoutMs = row?.requestTimeoutMs ?? 10000;

    if (!url) {
      add("url", "API URL configured", "FAIL", "No Zabbix API URL is saved");
      return { ok: false, checkedAt: new Date().toISOString(), checks };
    }
    add("url", "API URL configured", "PASS", url);
    add(
      "enabled",
      "Integration switched on",
      row?.enabled === false ? "WARN" : "PASS",
      row?.enabled === false ? "Disabled — OpsDesk pages will not query Zabbix" : "Enabled",
    );

    const anon: ZabbixEndpoint = { url, timeoutMs };
    try {
      const version = await callZabbix<string>(anon, "apiinfo.version", {}, this.fetchFn);
      add("reachable", "Zabbix API reachable", "PASS", `Zabbix ${version} answered`);
      const major = Number(version.split(".")[0]);
      add(
        "version",
        "Supported Zabbix version",
        major >= 7 ? "PASS" : "WARN",
        major >= 7 ? `${version} (7.x API)` : `${version} — built and tested against Zabbix 7.0`,
      );
    } catch (err) {
      add("reachable", "Zabbix API reachable", "FAIL", (err as Error).message);
      return { ok: false, checkedAt: new Date().toISOString(), checks };
    }

    let token: string | undefined = overrides.apiToken;
    if (!token) {
      if (!row?.tokenCiphertext) {
        add("token", "API token stored", "FAIL", "No API token saved yet");
        return { ok: false, checkedAt: new Date().toISOString(), checks };
      }
      try {
        token = decryptSecret(row.tokenCiphertext, this.secretsKey());
        add("token", "API token stored", "PASS", `Encrypted, ending …${row.tokenLast4 ?? ""}`);
      } catch (err) {
        add("token", "API token stored", "FAIL", (err as Error).message);
        return { ok: false, checkedAt: new Date().toISOString(), checks };
      }
    } else {
      add(
        "token",
        "API token stored",
        "SKIP",
        "Testing the token typed on the page (not saved yet)",
      );
    }

    const ep: ZabbixEndpoint = { url, token, timeoutMs };
    let hosts: RawHost[];
    try {
      hosts = await callZabbix<RawHost[]>(
        ep,
        "host.get",
        {
          output: ["hostid", "status", "active_available"],
          selectTags: ["tag", "value"],
          selectInterfaces: ["available"],
        },
        this.fetchFn,
      );
      add("auth", "Token accepted", "PASS", "Zabbix accepted the token");
    } catch (err) {
      add("auth", "Token accepted", "FAIL", (err as Error).message);
      return { ok: false, checkedAt: new Date().toISOString(), checks };
    }

    const monitored = hosts.filter((h) => h.status === "0");
    add(
      "hosts",
      "Monitored hosts visible",
      monitored.length > 0 ? "PASS" : "WARN",
      `${monitored.length} monitored host(s), ${hosts.length - monitored.length} disabled`,
    );
    const tagged = monitored.filter((h) => tagValue(h.tags, SITE_TAG));
    add(
      "site-tags",
      `Hosts tagged with "${SITE_TAG}"`,
      monitored.length === 0 ? "SKIP" : tagged.length === monitored.length ? "PASS" : "WARN",
      `${tagged.length} of ${monitored.length} — untagged hosts are visible only to all-site roles`,
    );
    const up = monitored.filter((h) => availabilityOf(h) === "UP").length;
    const down = monitored.filter((h) => availabilityOf(h) === "DOWN").length;
    add(
      "availability",
      "Hosts reachable by Zabbix",
      monitored.length === 0 ? "SKIP" : down > 0 ? "WARN" : "PASS",
      `${up} up, ${down} down, ${monitored.length - up - down} unknown`,
    );
    try {
      const count = await callZabbix<string>(
        ep,
        "problem.get",
        { countOutput: true },
        this.fetchFn,
      );
      add("problems", "Problems readable", "PASS", `${count} active problem(s)`);
    } catch (err) {
      add("problems", "Problems readable", "FAIL", (err as Error).message);
    }

    return {
      ok: checks.every((c) => c.status !== "FAIL"),
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  // ------------------------------------------------------------------ reads

  async listHosts(user: AuthenticatedUser) {
    const ep = await this.endpoint();
    const hosts = await this.scopedHosts(ep, user);
    if (hosts.length === 0) return { webUrl: zabbixWebBaseUrl(ep.url), items: [] };

    const problems = await this.zbx<RawProblem[]>(ep, "problem.get", {
      output: ["eventid", "objectid", "severity"],
      hostids: hosts.map((h) => h.hostid),
    });
    const triggerHosts = await this.triggerHostMap(
      ep,
      problems.map((p) => p.objectid),
    );
    const counts = new Map<string, { count: number; maxSeverity: number }>();
    for (const p of problems) {
      for (const hostid of triggerHosts.get(p.objectid) ?? []) {
        const c = counts.get(hostid) ?? { count: 0, maxSeverity: -1 };
        c.count += 1;
        c.maxSeverity = Math.max(c.maxSeverity, Number(p.severity));
        counts.set(hostid, c);
      }
    }
    const ciIds = await this.ciIdsByCode(hosts.map((h) => tagValue(h.tags, CI_TAG)));

    return {
      webUrl: zabbixWebBaseUrl(ep.url),
      items: hosts.map((h) => ({
        ...this.toHostView(h, ciIds),
        problemCount: counts.get(h.hostid)?.count ?? 0,
        maxSeverity: counts.has(h.hostid) ? counts.get(h.hostid)!.maxSeverity : null,
      })),
    };
  }

  async getHost(user: AuthenticatedUser, hostId: string) {
    const ep = await this.endpoint();
    const host = await this.scopedHost(ep, user, hostId);
    const ciIds = await this.ciIdsByCode([tagValue(host.tags, CI_TAG)]);
    return { webUrl: zabbixWebBaseUrl(ep.url), ...this.toHostView(host, ciIds) };
  }

  async listItems(user: AuthenticatedUser, hostId: string) {
    const ep = await this.endpoint();
    await this.scopedHost(ep, user, hostId);
    const items = await this.zbx<RawItem[]>(ep, "item.get", {
      hostids: [hostId],
      output: [
        "itemid",
        "hostid",
        "name",
        "key_",
        "lastvalue",
        "lastclock",
        "prevvalue",
        "units",
        "value_type",
        "state",
        "error",
      ],
      filter: { status: "0" },
      sortfield: "name",
      limit: 2000,
    });
    return items.map((i) => ({
      itemId: i.itemid,
      name: i.name,
      key: i.key_,
      lastValue: i.lastclock === "0" ? null : i.lastvalue,
      previousValue: i.prevvalue || null,
      lastSeenAt: i.lastclock === "0" ? null : toIso(i.lastclock),
      units: i.units,
      numeric: NUMERIC_VALUE_TYPES.has(i.value_type),
      supported: i.state === "0",
      error: i.error || null,
    }));
  }

  async getHistory(user: AuthenticatedUser, itemId: string, query: ZabbixHistoryQueryDto) {
    const now = Math.floor(Date.now() / 1000);
    const to = query.to ?? now;
    const from = query.from ?? to - DEFAULT_HISTORY_RANGE_S;
    if (from >= to) throw new BadRequestException("from must be before to");
    if (to - from > MAX_HISTORY_RANGE_S) {
      throw new BadRequestException("History range is limited to 31 days");
    }

    const ep = await this.endpoint();
    const [item] = await this.zbx<RawItem[]>(ep, "item.get", {
      itemids: [itemId],
      output: ["itemid", "hostid", "name", "units", "value_type"],
    });
    if (!item) throw new NotFoundException(`Zabbix item ${itemId} not found`);
    await this.scopedHost(ep, user, item.hostid);

    const numeric = NUMERIC_VALUE_TYPES.has(item.value_type);
    const base = { itemId, name: item.name, units: item.units, numeric, from, to };

    if (numeric && to - from > TRENDS_AFTER_S) {
      const trends = await this.zbx<
        { clock: string; value_min: string; value_avg: string; value_max: string }[]
      >(ep, "trend.get", {
        itemids: [itemId],
        time_from: from,
        time_till: to,
        output: ["clock", "value_min", "value_avg", "value_max"],
      });
      return {
        ...base,
        source: "trends" as const,
        points: trends
          .map((t) => ({
            t: Number(t.clock) * 1000,
            v: Number(t.value_avg),
            min: Number(t.value_min),
            max: Number(t.value_max),
          }))
          .sort((a, b) => a.t - b.t),
      };
    }

    const history = await this.zbx<{ clock: string; value: string }[]>(ep, "history.get", {
      history: Number(item.value_type),
      itemids: [itemId],
      time_from: from,
      time_till: to,
      output: ["clock", "value"],
      sortfield: "clock",
      sortorder: numeric ? "ASC" : "DESC",
      limit: numeric ? 5000 : 200,
    });
    return {
      ...base,
      source: "history" as const,
      points: numeric
        ? history.map((h) => ({ t: Number(h.clock) * 1000, v: Number(h.value) }))
        : [],
      values: numeric ? [] : history.map((h) => ({ t: Number(h.clock) * 1000, value: h.value })),
    };
  }

  async listProblems(user: AuthenticatedUser, query: ListZabbixProblemsQueryDto) {
    const ep = await this.endpoint();
    const hosts = await this.scopedHosts(ep, user);
    const hostsById = new Map(hosts.map((h) => [h.hostid, h]));
    if (query.hostId && !hostsById.has(query.hostId)) {
      throw new NotFoundException(`Zabbix host ${query.hostId} not found`);
    }
    const hostids = query.hostId ? [query.hostId] : hosts.map((h) => h.hostid);
    if (hostids.length === 0) return { webUrl: zabbixWebBaseUrl(ep.url), items: [] };

    const min = query.minSeverity ?? 0;
    const problems = await this.zbx<RawProblem[]>(ep, "problem.get", {
      output: "extend",
      hostids,
      severities: [0, 1, 2, 3, 4, 5].filter((s) => s >= min),
      selectTags: ["tag", "value"],
      selectAcknowledges: "extend",
      sortfield: ["eventid"],
      sortorder: "DESC",
      limit: 500,
    });
    const triggerHosts = await this.triggerHostMap(
      ep,
      problems.map((p) => p.objectid),
    );
    const ciIds = await this.ciIdsByCode(hosts.map((h) => tagValue(h.tags, CI_TAG)));
    const now = Date.now();

    return {
      webUrl: zabbixWebBaseUrl(ep.url),
      items: problems.map((p) => {
        const host = (triggerHosts.get(p.objectid) ?? [])
          .map((id) => hostsById.get(id))
          .find(Boolean);
        const severity = Number(p.severity);
        return {
          eventId: p.eventid,
          name: p.name,
          severity,
          severityLabel: SEVERITY_LABELS[severity] ?? "Unknown",
          startedAt: toIso(p.clock),
          ageSeconds: Math.max(0, Math.floor(now / 1000) - Number(p.clock)),
          acknowledged: p.acknowledged === "1",
          suppressed: p.suppressed === "1",
          operationalData: p.opdata || null,
          tags: p.tags ?? [],
          host: host ? this.toHostView(host, ciIds) : null,
          acknowledges: (p.acknowledges ?? [])
            .filter((a) => a.message)
            .map((a) => ({ at: toIso(a.clock), message: a.message, by: a.username ?? null })),
        };
      }),
    };
  }

  // ------------------------------------------------------------------ write

  async acknowledgeProblem(
    user: AuthenticatedUser,
    eventId: string,
    dto: AcknowledgeZabbixProblemDto,
    actor: ActorContext,
  ) {
    const ep = await this.endpoint();
    const [problem] = await this.zbx<RawProblem[]>(ep, "problem.get", {
      eventids: [eventId],
      output: ["eventid", "objectid", "name", "severity", "acknowledged"],
    });
    if (!problem)
      throw new NotFoundException(`Zabbix problem ${eventId} not found or already resolved`);

    const allowed = new Map((await this.scopedHosts(ep, user)).map((h) => [h.hostid, h]));
    const hostIds = (await this.triggerHostMap(ep, [problem.objectid])).get(problem.objectid) ?? [];
    const host = hostIds.map((id) => allowed.get(id)).find(Boolean);
    if (!host)
      throw new NotFoundException(`Zabbix problem ${eventId} not found or already resolved`);

    const note = dto.message?.trim();
    const alreadyAcked = problem.acknowledged === "1";
    if (alreadyAcked && !note) {
      throw new ConflictException(
        "This problem is already acknowledged — add a message to comment on it",
      );
    }
    // Zabbix event.acknowledge action bitmask: 2 = acknowledge, 4 = add message.
    const action = (alreadyAcked ? 0 : 2) | 4;
    const message = `[OpsDesk · ${user.email}] ${note || "Acknowledged from OpsDesk"}`;
    await this.zbx(ep, "event.acknowledge", { eventids: [eventId], action, message });

    await this.audit.record({
      actorId: actor.actorId,
      entityType: "ZabbixProblem",
      entityId: eventId,
      action: alreadyAcked ? "COMMENT" : "ACKNOWLEDGE",
      after: {
        eventId,
        problem: problem.name,
        severity: Number(problem.severity),
        hostId: host.hostid,
        host: host.name,
        siteCode: tagValue(host.tags, SITE_TAG),
        message: note ?? null,
      },
      correlationId: actor.correlationId,
    });
    return { eventId, acknowledged: true };
  }

  // ---------------------------------------------------------------- helpers

  private secretsKey(): Buffer {
    try {
      return loadSecretsKey();
    } catch (err) {
      if (err instanceof SecretsKeyMissingError) {
        this.logger.error(err.message);
        throw new ServiceUnavailableException({
          code: "SECRETS_KEY_MISSING",
          message:
            "The server has no INTEGRATION_SECRETS_KEY, so it cannot store or read the Zabbix token",
        });
      }
      throw err;
    }
  }

  /** The configured endpoint, or a 503 the UI can explain. */
  private async endpoint(): Promise<ZabbixEndpoint> {
    const row = await this.prisma.zabbixConnection.findUnique({
      where: { name: DEFAULT_CONNECTION_NAME },
    });
    if (!row || !row.tokenCiphertext) {
      throw new ServiceUnavailableException({
        code: "ZABBIX_NOT_CONFIGURED",
        message: "Zabbix is not configured yet — an admin needs to save the API URL and token",
      });
    }
    if (!row.enabled) {
      throw new ServiceUnavailableException({
        code: "ZABBIX_DISABLED",
        message: "The Zabbix integration is switched off in its settings",
      });
    }
    let token: string;
    try {
      token = decryptSecret(row.tokenCiphertext, this.secretsKey());
    } catch (err) {
      if (err instanceof SecretDecryptError) {
        this.logger.error(`Zabbix token unreadable: ${err.message}`);
        throw new ServiceUnavailableException({
          code: "ZABBIX_TOKEN_UNREADABLE",
          message: err.message,
        });
      }
      throw err;
    }
    return { url: row.apiUrl, token, timeoutMs: row.requestTimeoutMs };
  }

  private async zbx<T>(ep: ZabbixEndpoint, method: string, params: unknown): Promise<T> {
    try {
      return await callZabbix<T>(ep, method, params, this.fetchFn);
    } catch (err) {
      if (err instanceof ZabbixApiError) {
        this.logger.warn(`Zabbix ${method} failed (${err.kind}): ${err.message}`);
        throw new BadGatewayException({ code: `ZABBIX_${err.kind}`, message: err.message });
      }
      throw err;
    }
  }

  /** Site codes the user may see; null = every site. */
  private async allowedSiteCodes(user: AuthenticatedUser): Promise<string[] | null> {
    const siteIds = await this.authz.getAccessibleSiteIds(user);
    if (siteIds === null) return null;
    if (siteIds.length === 0) return [];
    const sites = await this.prisma.site.findMany({
      where: { id: { in: siteIds } },
      select: { code: true },
    });
    return sites.map((s) => s.code);
  }

  /**
   * Hosts the user may see. All-site roles see every host (tagged or not);
   * everyone else only hosts whose "site" tag is one of their sites.
   */
  private async scopedHosts(ep: ZabbixEndpoint, user: AuthenticatedUser, hostIds?: string[]) {
    const codes = await this.allowedSiteCodes(user);
    if (codes !== null && codes.length === 0) return [];
    const params: Record<string, unknown> = {
      output: ["hostid", "host", "name", "status", "maintenance_status", "active_available"],
      selectTags: ["tag", "value"],
      selectInterfaces: ["type", "ip", "dns", "useip", "port", "available", "error"],
      selectHostGroups: ["name"],
      sortfield: "name",
    };
    if (hostIds) params.hostids = hostIds;
    if (codes !== null) {
      params.tags = codes.map((value) => ({ tag: SITE_TAG, value, operator: 1 }));
      params.evaltype = 2; // OR across the tag conditions
    }
    const hosts = await this.zbx<RawHost[]>(ep, "host.get", params);
    // Defence in depth: Zabbix's tag filter is the primary gate, re-check here.
    return codes === null
      ? hosts
      : hosts.filter((h) => codes.includes(tagValue(h.tags, SITE_TAG) ?? ""));
  }

  private async scopedHost(ep: ZabbixEndpoint, user: AuthenticatedUser, hostId: string) {
    const [host] = await this.scopedHosts(ep, user, [hostId]);
    // 404 rather than 403: don't reveal hosts outside the user's sites.
    if (!host) throw new NotFoundException(`Zabbix host ${hostId} not found`);
    return host;
  }

  private async triggerHostMap(ep: ZabbixEndpoint, triggerIds: string[]) {
    const map = new Map<string, string[]>();
    const unique = [...new Set(triggerIds)];
    if (unique.length === 0) return map;
    const triggers = await this.zbx<{ triggerid: string; hosts: { hostid: string }[] }[]>(
      ep,
      "trigger.get",
      { triggerids: unique, output: ["triggerid"], selectHosts: ["hostid"] },
    );
    for (const t of triggers)
      map.set(
        t.triggerid,
        t.hosts.map((h) => h.hostid),
      );
    return map;
  }

  private async ciIdsByCode(codes: (string | null)[]) {
    const wanted = [...new Set(codes.filter((c): c is string => Boolean(c)))];
    if (wanted.length === 0) return new Map<string, string>();
    const cis = await this.prisma.configurationItem.findMany({
      where: { ciCode: { in: wanted } },
      select: { id: true, ciCode: true },
    });
    return new Map(cis.map((c) => [c.ciCode, c.id]));
  }

  private toHostView(h: RawHost, ciIds: Map<string, string>) {
    const ciCode = tagValue(h.tags, CI_TAG);
    return {
      hostId: h.hostid,
      host: h.host,
      name: h.name,
      enabled: h.status === "0",
      inMaintenance: h.maintenance_status === "1",
      availability: availabilityOf(h),
      siteCode: tagValue(h.tags, SITE_TAG),
      ciCode,
      ciId: ciCode ? (ciIds.get(ciCode) ?? null) : null,
      groups: (h.hostgroups ?? []).map((g) => g.name),
      tags: h.tags ?? [],
      interfaces: (h.interfaces ?? []).map((i) => ({
        type: INTERFACE_TYPES[i.type] ?? i.type,
        address: i.useip === "1" ? i.ip : i.dns,
        port: i.port,
        availability: interfaceAvailability(i.available),
        error: i.error || null,
      })),
    };
  }

  private toSettingsView(row: ZabbixConnection | null) {
    if (!row) {
      return {
        configured: false,
        apiUrl: null,
        webUrl: null,
        enabled: false,
        requestTimeoutMs: 10000,
        tokenConfigured: false,
        tokenLast4: null,
        tokenUpdatedAt: null,
        updatedAt: null,
      };
    }
    return {
      configured: Boolean(row.tokenCiphertext),
      apiUrl: row.apiUrl,
      webUrl: zabbixWebBaseUrl(row.apiUrl),
      enabled: row.enabled,
      requestTimeoutMs: row.requestTimeoutMs,
      tokenConfigured: Boolean(row.tokenCiphertext),
      tokenLast4: row.tokenLast4,
      tokenUpdatedAt: row.tokenUpdatedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function tagValue(tags: RawTag[] | undefined, tag: string): string | null {
  return tags?.find((t) => t.tag === tag)?.value || null;
}

function interfaceAvailability(available: string): Availability {
  return available === "1" ? "UP" : available === "2" ? "DOWN" : "UNKNOWN";
}

/** Any unreachable interface marks the host DOWN; any reachable one UP. */
export function availabilityOf(h: Pick<RawHost, "interfaces" | "active_available">): Availability {
  const states = (h.interfaces ?? []).map((i) => interfaceAvailability(i.available));
  if (states.includes("DOWN")) return "DOWN";
  if (states.includes("UP")) return "UP";
  if (h.active_available === "1") return "UP";
  if (h.active_available === "2") return "DOWN";
  return "UNKNOWN";
}

function toIso(unixSeconds: string): string {
  return new Date(Number(unixSeconds) * 1000).toISOString();
}
