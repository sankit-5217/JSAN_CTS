import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { normalizeAlertmanagerWebhook } from "@cts-dc-opsdesk/prometheus-adapter";
import { normalizeSnmpTrap, SnmpNormalizationError } from "@cts-dc-opsdesk/snmp-adapter";
import {
  AlertNormalizationError as ZabbixNormalizationError,
  normalizeZabbixEvent,
} from "@cts-dc-opsdesk/zabbix-adapter";
import { UserRole } from "@prisma/client";
import { NotificationsPublisher } from "../../common/notifications/notifications.publisher";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { ChangesService } from "../changes/changes.service";
import { IncidentsService } from "../incidents/incidents.service";
import { AlertRulesService } from "./alert-rules.service";
import type { AlertState } from "./alerts.constants";
import { computeAlertFingerprint } from "./alerts.fingerprint";
import { AlertmanagerWebhookDto } from "./dto/alertmanager-webhook.dto";
import { IngestAlertDto } from "./dto/ingest-alert.dto";
import { QueryAlertsDto } from "./dto/query-alerts.dto";
import { SnmpTrapDto } from "./dto/snmp-trap.dto";
import { ZabbixWebhookEventDto } from "./dto/zabbix-webhook.dto";

/** Outcome of an ingestion call. Safe to return to the calling adapter/collector. */
export interface AlertIngestResult {
  alertId: string;
  fingerprint: string;
  /** true when the payload matched an existing (source, externalEventId) row. */
  deduped: boolean;
  /** true when this call moved the alert between OPEN / ACKNOWLEDGED / RECOVERED. */
  stateChanged: boolean;
  siteResolved: boolean;
  ciResolved: boolean;
  /** same fingerprint seen at least `flappingThreshold` times in the recent window. */
  flapping: boolean;
  recentOccurrences: number;
  /**
   * The alert's CI is in MAINTENANCE lifecycle, or covered by an approved change
   * window right now (spec §10.10 rule 5). The alert is still recorded; whether
   * that also silences auto-ticketing is `autoTicketSuppressed`.
   */
  suppressedByMaintenance: boolean;
  /**
   * `suppressedByMaintenance` AND the active rule's
   * `suppressAutoTicketDuringMaintenance` — this ingest skipped incident
   * correlation and the NOC page. When false a suppressed alert is only
   * labelled expected and still correlates / pages.
   */
  autoTicketSuppressed: boolean;
  /**
   * Id of a still-open incident on the same CI that this alert was attached to
   * (spec §10.10), or the id it was already linked to on an earlier ingest.
   * null when the CI is unknown, has no open incident, the alert has RECOVERED,
   * or auto-ticketing was suppressed. Link-only — never opens or mutates a ticket.
   */
  correlatedIncidentId: string | null;
}

/** One alert rejected during source-specific normalization. */
export interface RejectedAlert {
  index: number;
  field?: string;
  message: string;
}

/** Outcome of a source webhook: what was normalized + ingested, and what wasn't. */
export interface SourceIngestResult {
  accepted: AlertIngestResult[];
  rejected: RejectedAlert[];
}

/**
 * Owns: normalized alerts, fingerprints, dedup, flapping signal (spec §10.9-10.10).
 * Must not own: raw time-series storage (that stays in Zabbix/Prometheus), and
 * must not mutate incident/SLA tables directly — correlation calls
 * IncidentsService (read `findOpenByCi`, write `linkAlert`), never the tables.
 *
 * Ingestion tunables (flapping threshold + window, NOC-paging severities,
 * auto-correlate + maintenance-suppression toggles) come from the `alert_rules`
 * table via AlertRulesService.resolveRule({ siteId, alertType }) — the most
 * specific active rule for this alert wins — not env / constants (spec §10.10).
 * Maintenance windows are read via ChangesService (best-effort).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsPublisher,
    private readonly incidents: IncidentsService,
    private readonly alertRules: AlertRulesService,
    private readonly changes: ChangesService,
  ) {}

  async ingest(dto: IngestAlertDto, actor: ActorContext): Promise<AlertIngestResult> {
    const occurredAt = new Date(dto.occurredAt);

    const site = await this.prisma.site.findUnique({ where: { code: dto.siteCode } });
    const ci = await this.prisma.configurationItem.findUnique({ where: { ciCode: dto.ciCode } });

    const rule = await this.alertRules.resolveRule({
      siteId: site?.id ?? null,
      alertType: dto.alertType,
    });

    if (!site) {
      this.logger.warn(
        `Alert ${dto.source}:${dto.eventId} references unknown site "${dto.siteCode}" — stored unresolved`,
      );
    }
    if (!ci) {
      this.logger.warn(
        `Alert ${dto.source}:${dto.eventId} references unknown CI "${dto.ciCode}" — stored unresolved`,
      );
    }

    const fingerprint = computeAlertFingerprint({
      siteCode: dto.siteCode,
      ciCode: dto.ciCode,
      alertType: dto.alertType,
      componentKey: dto.componentKey,
    });

    const existing = await this.prisma.alert.findUnique({
      where: {
        source_externalEventId: { source: dto.source, externalEventId: dto.eventId },
      },
    });

    let alertId: string;
    let deduped: boolean;
    let stateChanged: boolean;
    let finalState: AlertState;

    if (existing) {
      const nextState = reduceAlertState(existing.state as AlertState, dto.state);
      finalState = nextState;
      deduped = true;
      stateChanged = nextState !== existing.state;
      const updateData = {
        severity: dto.severity,
        state: nextState,
        lastSeenAt:
          occurredAt.getTime() > existing.lastSeenAt.getTime() ? occurredAt : existing.lastSeenAt,
        // backfill references if the site / CI became known since first sighting
        siteId: existing.siteId ?? site?.id ?? null,
        ciId: existing.ciId ?? ci?.id ?? null,
      };

      if (stateChanged) {
        // A lifecycle move is auditable; a plain dedup / lastSeenAt bump is not
        // (ingestion is high-volume — only state changes earn an audit row).
        const updated = await this.prisma.$transaction(async (tx) => {
          const u = await tx.alert.update({ where: { id: existing.id }, data: updateData });
          await this.audit.record(
            {
              actorId: actor.actorId,
              correlationId: actor.correlationId,
              entityType: "alert",
              entityId: existing.id,
              action: "ALERT_STATE_CHANGED",
              before: { state: existing.state, severity: existing.severity },
              after: { state: u.state, severity: u.severity },
            },
            tx,
          );
          return u;
        });
        alertId = updated.id;
      } else {
        const updated = await this.prisma.alert.update({
          where: { id: existing.id },
          data: updateData,
        });
        alertId = updated.id;
      }
    } else {
      deduped = false;
      stateChanged = true;
      finalState = dto.state;
      const created = await this.prisma.$transaction(async (tx) => {
        const c = await tx.alert.create({
          data: {
            externalEventId: dto.eventId,
            source: dto.source,
            siteId: site?.id ?? null,
            ciId: ci?.id ?? null,
            alertType: dto.alertType,
            severity: dto.severity,
            fingerprint,
            firstSeenAt: occurredAt,
            lastSeenAt: occurredAt,
            state: dto.state,
            rawReference: extractRawReference(dto.attributes),
          },
        });
        await this.audit.record(
          {
            actorId: actor.actorId,
            correlationId: actor.correlationId,
            entityType: "alert",
            entityId: c.id,
            action: "ALERT_RAISED",
            after: {
              source: c.source,
              externalEventId: c.externalEventId,
              fingerprint,
              state: c.state,
              severity: c.severity,
              siteId: c.siteId,
              ciId: c.ciId,
            },
          },
          tx,
        );
        return c;
      });
      alertId = created.id;
    }

    const since = new Date(Date.now() - rule.flappingWindowMinutes * 60_000);
    const recentOccurrences = await this.prisma.alert.count({
      where: { fingerprint, lastSeenAt: { gte: since } },
    });

    // §10.10 rule 5: a CI in MAINTENANCE lifecycle, or under an approved change
    // window right now, is expected to be noisy. `autoTicketSuppressed` decides
    // whether that also silences correlation + the NOC page, or just labels it.
    const suppressedByMaintenance =
      ci?.lifecycleStatus === "MAINTENANCE" || (ci ? await this.isCiUnderMaintenance(ci.id) : false);
    const autoTicketSuppressed = suppressedByMaintenance && rule.suppressAutoTicketDuringMaintenance;

    if (!deduped && rule.pagingSeverities.includes(dto.severity) && !autoTicketSuppressed) {
      await this.notifyNocOfCriticalAlert(alertId, dto);
    }

    const ciId = ci?.id ?? existing?.ciId ?? null;
    let correlatedIncidentId = existing?.correlatedIncidentId ?? null;
    if (
      rule.autoCorrelateIncidents &&
      !autoTicketSuppressed &&
      ciId &&
      finalState !== "RECOVERED" &&
      !correlatedIncidentId
    ) {
      correlatedIncidentId = await this.correlateToOpenIncident(
        alertId,
        ciId,
        {
          alertType: dto.alertType,
          severity: dto.severity,
          source: dto.source,
          fingerprint,
        },
        actor,
      );
    }

    return {
      alertId,
      fingerprint,
      deduped,
      stateChanged,
      siteResolved: Boolean(site),
      ciResolved: Boolean(ci),
      flapping: recentOccurrences >= rule.flappingThreshold,
      recentOccurrences,
      suppressedByMaintenance,
      autoTicketSuppressed,
      correlatedIncidentId,
    };
  }

  /**
   * Is the CI covered by an approved change window right now? Best-effort — a
   * failure in the changes module must not fail alert ingestion, so it is
   * logged and treated as "not under maintenance".
   */
  private async isCiUnderMaintenance(ciId: string): Promise<boolean> {
    try {
      const windows = await this.changes.getActiveMaintenanceWindows(new Date(), ciId);
      return windows.length > 0;
    } catch (err) {
      this.logger.warn(
        `maintenance-window check for CI ${ciId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /**
   * Attach this alert to a still-open incident on the same CI, if one exists
   * (spec §10.10). Link-only: never opens a ticket, never touches incident
   * status. Best-effort — a correlation failure is logged and swallowed so it
   * can't fail (or roll back) the ingest; the next ingest of the same alert
   * retries until it is linked. `IncidentsService.linkAlert` is itself
   * idempotent, so a re-link is a no-op even if the row update below is lost.
   */
  private async correlateToOpenIncident(
    alertId: string,
    ciId: string,
    meta: { alertType: string; severity: string; source: string; fingerprint: string },
    actor: ActorContext,
  ): Promise<string | null> {
    try {
      const incident = await this.incidents.findOpenByCi(ciId);
      if (!incident) {
        return null;
      }
      await this.incidents.linkAlert(incident.id, { id: alertId, ...meta }, actor);
      await this.prisma.alert.update({
        where: { id: alertId },
        data: { correlatedIncidentId: incident.id },
      });
      this.logger.log(
        `alert ${alertId} correlated to open incident ${incident.incidentNo}`,
      );
      return incident.id;
    } catch (err) {
      this.logger.warn(
        `alert ${alertId} incident correlation skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Best-effort: a brand-new CRITICAL alert pages the NOC roster. Only on first
   * sighting (not dedup) so a re-fired trap doesn't re-page. Fully swallowed —
   * ingestion never blocks or fails on the notification.
   */
  private async notifyNocOfCriticalAlert(alertId: string, dto: IngestAlertDto): Promise<void> {
    try {
      const roster = await this.prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: [UserRole.SERVICE_DESK_NOC, UserRole.INFRASTRUCTURE_LEAD] },
        },
        select: { email: true, displayName: true },
      });
      if (roster.length === 0) {
        return;
      }
      await this.notifications.enqueue(
        {
          event: {
            kind: "ALERT_RAISED",
            entity: {
              key: `ALRT-${alertId.slice(0, 8)}`,
              title: dto.summary || dto.alertType,
              siteCode: dto.siteCode,
              severity: "CRITICAL",
            },
            alertType: dto.alertType,
            state: dto.state,
          },
          recipients: { to: roster.map((u) => ({ name: u.displayName, email: u.email })) },
        },
        `ALERT_RAISED:${alertId}`,
      );
    } catch (err) {
      this.logger.warn(
        `critical alert ${alertId} NOC notification skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Ingest a batch of raw Zabbix webhook events: normalize each via the Zabbix
   * adapter, then run it through {@link ingest} (idempotent + deduped). Events
   * that fail normalization are reported in `rejected`, not thrown — one bad
   * event must not drop the batch.
   */
  async ingestFromZabbix(
    events: ZabbixWebhookEventDto[],
    actor: ActorContext,
  ): Promise<SourceIngestResult> {
    const accepted: AlertIngestResult[] = [];
    const rejected: RejectedAlert[] = [];

    for (const [index, event] of events.entries()) {
      let normalized: ReturnType<typeof normalizeZabbixEvent>;
      try {
        normalized = normalizeZabbixEvent(event);
      } catch (err) {
        rejected.push(toRejectedAlert(index, err));
        continue;
      }
      accepted.push(await this.ingest(normalized, actor));
    }

    if (rejected.length > 0) {
      this.logger.warn(`Zabbix batch: ${accepted.length} accepted, ${rejected.length} rejected`);
    }
    return { accepted, rejected };
  }

  /**
   * Ingest a Prometheus Alertmanager webhook delivery: normalize every alert via
   * the Prometheus adapter (per-alert failures collected, not fatal), then run
   * each through {@link ingest}.
   */
  async ingestFromAlertmanager(
    payload: AlertmanagerWebhookDto,
    actor: ActorContext,
  ): Promise<SourceIngestResult> {
    const { normalized, errors } = normalizeAlertmanagerWebhook(payload);

    const accepted: AlertIngestResult[] = [];
    for (const alert of normalized) {
      accepted.push(await this.ingest(alert, actor));
    }

    const rejected: RejectedAlert[] = errors.map((err) => ({
      index: err.index ?? -1,
      field: err.field,
      message: err.message,
    }));

    if (rejected.length > 0) {
      this.logger.warn(
        `Alertmanager delivery: ${accepted.length} accepted, ${rejected.length} rejected`,
      );
    }
    return { accepted, rejected };
  }

  /**
   * Ingest a batch of parsed SNMP traps from the site collector's trap receiver:
   * normalize each via the SNMP adapter, then run it through {@link ingest}.
   * Traps that fail normalization are reported in `rejected`, not thrown.
   */
  async ingestFromSnmp(traps: SnmpTrapDto[], actor: ActorContext): Promise<SourceIngestResult> {
    const accepted: AlertIngestResult[] = [];
    const rejected: RejectedAlert[] = [];

    for (const [index, trap] of traps.entries()) {
      let normalized: ReturnType<typeof normalizeSnmpTrap>;
      try {
        normalized = normalizeSnmpTrap(trap);
      } catch (err) {
        rejected.push(toRejectedAlert(index, err));
        continue;
      }
      accepted.push(await this.ingest(normalized, actor));
    }

    if (rejected.length > 0) {
      this.logger.warn(`SNMP batch: ${accepted.length} accepted, ${rejected.length} rejected`);
    }
    return { accepted, rejected };
  }

  async findAll(query: QueryAlertsDto) {
    let ciId: string | undefined;
    if (query.ciCode) {
      const ci = await this.prisma.configurationItem.findUnique({
        where: { ciCode: query.ciCode },
      });
      if (!ci) {
        return [];
      }
      ciId = ci.id;
    }

    return this.prisma.alert.findMany({
      where: {
        ...(query.state ? { state: query.state } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.fingerprint ? { fingerprint: query.fingerprint } : {}),
        ...(ciId ? { ciId } : {}),
      },
      orderBy: { lastSeenAt: "desc" },
      take: query.limit ?? 50,
    });
  }

  async findOne(id: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }
    return alert;
  }
}

/**
 * Alert lifecycle on a repeat event for the same external id. RECOVERED is
 * terminal for a given external event id — a genuinely new condition arrives
 * under a new id — and a repeated OPEN never downgrades an ACKNOWLEDGED alert.
 */
function reduceAlertState(current: AlertState, incoming: AlertState): AlertState {
  if (current === "RECOVERED") {
    return "RECOVERED";
  }
  if (incoming === "RECOVERED") {
    return "RECOVERED";
  }
  if (incoming === "ACKNOWLEDGED" && current === "OPEN") {
    return "ACKNOWLEDGED";
  }
  return current;
}

function extractRawReference(attributes: Record<string, unknown> | undefined): string | null {
  const ref = attributes?.rawReference;
  return typeof ref === "string" && ref.length > 0 ? ref : null;
}

function toRejectedAlert(index: number, err: unknown): RejectedAlert {
  if (err instanceof ZabbixNormalizationError || err instanceof SnmpNormalizationError) {
    return { index, field: err.field, message: err.message };
  }
  return { index, message: err instanceof Error ? err.message : String(err) };
}
