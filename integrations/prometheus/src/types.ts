/**
 * Subset of the Prometheus Alertmanager webhook payload (schema version 4) that
 * OpsDesk consumes. Alertmanager posts this to a configured receiver; the
 * OpsDesk route must carry `site` and `ci` labels on every alert (add them via
 * `external_labels` or relabeling — see README.md).
 */
export interface AlertmanagerWebhook {
  version: string;
  status: "firing" | "resolved";
  alerts: AlertmanagerAlert[];
}

export interface AlertmanagerAlert {
  status: "firing" | "resolved";
  labels: Record<string, string>;
  annotations: Record<string, string>;
  /** RFC 3339 timestamp. */
  startsAt: string;
  /** RFC 3339 timestamp; the zero value ("0001-01-01T00:00:00Z") while firing. */
  endsAt: string;
  /** Alertmanager's own label-set fingerprint — stable per alerting series. */
  fingerprint: string;
  generatorURL?: string;
}
