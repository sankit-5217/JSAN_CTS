/** Normalized alert payload shape per spec §14.2. */
export interface NormalizedAlertPayload {
  eventId: string;
  source: "ZABBIX" | "PROMETHEUS" | "REDFISH" | "SNMP" | "SYSLOG";
  siteCode: string;
  ciCode: string;
  alertType: string;
  severity: "CRITICAL" | "HIGH" | "WARNING" | "INFO";
  componentKey?: string;
  occurredAt: string;
  state: "OPEN" | "ACKNOWLEDGED" | "RECOVERED";
  summary: string;
  attributes?: Record<string, unknown>;
}
