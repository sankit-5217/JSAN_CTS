/** Mirrors the API's InAppNotificationKind enum. */
export type NotificationKind =
  | "INCIDENT_CREATED"
  | "INCIDENT_ASSIGNED"
  | "INCIDENT_GROUP_ASSIGNED"
  | "INCIDENT_STATUS_CHANGED"
  | "INCIDENT_COMMENT_ADDED"
  | "SLA_WARNING"
  | "SLA_BREACHED"
  | "INCIDENT_OFFERED"
  | "INCIDENT_OFFER_UNACCEPTED"
  | "ALERT_RAISED"
  | "ALERT_RECOVERED"
  | "CUSTOMER_RESPONDED";

/** Mirrors the API's NotificationUrgency enum, loudest first. */
export type NotificationUrgency = "CRITICAL" | "HIGH" | "NORMAL" | "SILENT";

export const URGENCIES: readonly NotificationUrgency[] = ["CRITICAL", "HIGH", "NORMAL", "SILENT"];

/** The tiers that make a sound. */
export type AudibleUrgency = Exclude<NotificationUrgency, "SILENT">;

export const AUDIBLE_URGENCIES: readonly AudibleUrgency[] = ["CRITICAL", "HIGH", "NORMAL"];

export const URGENCY_LABEL: Record<NotificationUrgency, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  NORMAL: "Normal",
  SILENT: "Silent",
};

export interface InAppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  entityType: string;
  entityId: string;
  urgency: NotificationUrgency;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: InAppNotification[];
  unreadCount: number;
}
