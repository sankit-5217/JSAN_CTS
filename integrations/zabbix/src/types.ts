/**
 * Canonical Zabbix webhook payload the OpsDesk media type must emit — one JSON
 * object per problem / recovery / update event. Zabbix webhook bodies are
 * operator-defined in the media type script, so this is the contract that
 * script must satisfy (see README.md). Every value arrives as a string because
 * it is produced from a Zabbix macro.
 */
export interface ZabbixWebhookEvent {
  /** `{EVENT.ID}` — stable across a problem and its later recovery. */
  eventId: string;
  /** `{EVENT.VALUE}` — "1" problem, "0" recovery. */
  eventValue: string;
  /** `{EVENT.UPDATE.STATUS}` — "1" when this delivery is a problem update (ack / close / comment). */
  eventUpdateStatus?: string;
  /** `{EVENT.ACK.STATUS}` — "Yes" / "No". */
  eventAckStatus?: string;
  /** `{EVENT.NAME}` — human-readable problem name. */
  name: string;
  /** `{EVENT.SEVERITY}` — textual severity ("Not classified" .. "Disaster"). */
  severity?: string;
  /** `{EVENT.NSEVERITY}` — numeric severity 0..5; preferred over the textual form. */
  nseverity?: string;
  /** `{EVENT.TIMESTAMP}` — unix epoch seconds. */
  timestamp: string;
  /** `{HOST.HOST}` — technical host name. */
  host: string;
  /** `{HOST.NAME}` — visible host name. */
  hostName?: string;
  /** `{ITEM.KEY}` — triggering item key, when the trigger references a single item. */
  itemKey?: string;
  /** `{TRIGGER.ID}`. */
  triggerId?: string;
  /** `{EVENT.OPDATA}` — operational data string. */
  opdata?: string;
  /**
   * Event tags as a flat map. The OpsDesk media type must set `site` and `ci`
   * tags on every exported trigger, and should set `component` and `alertType`
   * where meaningful.
   */
  tags?: Record<string, string>;
}
