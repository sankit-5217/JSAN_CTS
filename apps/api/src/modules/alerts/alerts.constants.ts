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
