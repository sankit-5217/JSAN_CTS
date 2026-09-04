/**
 * Alert vocabulary shared across this module. Values match the Prisma
 * `AlertSeverity` / `AlertState` enums and the free-form `source` column
 * (build spec §13). Keep in sync with `NormalizedAlertPayload` in
 * `@cts-dc-opsdesk/shared-types` until that package is wired as an API
 * dependency and these can be imported from it directly.
 */
export type AlertSource = "ZABBIX" | "PROMETHEUS" | "REDFISH" | "SNMP" | "SYSLOG";
export const ALERT_SOURCES: readonly AlertSource[] = [
  "ZABBIX",
  "PROMETHEUS",
  "REDFISH",
  "SNMP",
  "SYSLOG",
];

export type AlertSeverity = "CRITICAL" | "HIGH" | "WARNING" | "INFO";
export const ALERT_SEVERITIES: readonly AlertSeverity[] = ["CRITICAL", "HIGH", "WARNING", "INFO"];

export type AlertState = "OPEN" | "ACKNOWLEDGED" | "RECOVERED";
export const ALERT_STATES: readonly AlertState[] = ["OPEN", "ACKNOWLEDGED", "RECOVERED"];

/**
 * Effective ingestion policy the alerts service acts on — either the newest
 * active `AlertRule` row or, when none exists, {@link DEFAULT_ALERT_RULE}.
 */
export interface EffectiveAlertRule {
  flappingThreshold: number;
  flappingWindowMinutes: number;
  pagingSeverities: AlertSeverity[];
  autoCorrelateIncidents: boolean;
  /** §10.10 rule 5: maintenance window suppresses auto-ticketing vs only labels. */
  suppressAutoTicketDuringMaintenance: boolean;
}

/**
 * Code fallback used only until the `alert_rules` table is seeded (or if every
 * row is deactivated). Matches the Prisma column defaults so behaviour is the
 * same whether or not a row exists.
 */
export const DEFAULT_ALERT_RULE: EffectiveAlertRule = {
  flappingThreshold: 3,
  flappingWindowMinutes: 30,
  pagingSeverities: ["CRITICAL"],
  autoCorrelateIncidents: true,
  suppressAutoTicketDuringMaintenance: true,
};
