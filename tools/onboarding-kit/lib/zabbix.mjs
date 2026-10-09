// Shared Zabbix helpers for the onboarding kit and the client site lab.
// Every function is idempotent: safe to run again, never duplicates objects.
import { randomBytes } from "node:crypto";

export const UPS_TEMPLATE = "OpsDesk UPS-MIB by SNMP";
export const WEBHOOK_USER = "opsdesk-webhook";
export const WEBHOOK_USER_GROUP = "OpsDesk webhook";

/** JSON-RPC client for the Zabbix 7.x API, authenticated with an API token. */
export function zabbixClient(url, token) {
  let rpcId = 1;
  return async function zbx(method, params) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json-rpc", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: rpcId++ }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json();
    if (body.error) throw new Error(`Zabbix ${method}: ${body.error.message} ${body.error.data ?? ""}`.trim());
    return body.result;
  };
}

/** Anonymous Zabbix call (apiinfo.version must not carry a token). */
export async function zabbixVersion(url) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json-rpc" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "apiinfo.version", params: {}, id: 1 }),
    signal: AbortSignal.timeout(15000),
  });
  return (await res.json()).result;
}

/**
 * Central (JSAN-side, one-time) Zabbix objects: the UPS-MIB template, the
 * OpsDesk webhook media type, the dedicated webhook user and the action.
 */
export function zabbixCentral(zbx, log = () => {}) {
  async function ensureHostGroup(name) {
    const [g] = await zbx("hostgroup.get", { filter: { name: [name] }, output: ["groupid"] });
    if (g) return g.groupid;
    const r = await zbx("hostgroup.create", { name });
    log(`host group "${name}" created`);
    return r.groupids[0];
  }


  async function ensureTemplateGroup(name) {
    const [g] = await zbx("templategroup.get", { filter: { name: [name] }, output: ["groupid"] });
    if (g) return g.groupid;
    return (await zbx("templategroup.create", { name })).groupids[0];
  }


  async function ensureUpsTemplate() {
    const [existing] = await zbx("template.get", { filter: { host: [UPS_TEMPLATE] }, output: ["templateid"] });
    if (existing) {
      log(`template "${UPS_TEMPLATE}" exists`);
      return existing.templateid;
    }
    const groupid = await ensureTemplateGroup("Templates/OpsDesk");
    const { templateids } = await zbx("template.create", {
      host: UPS_TEMPLATE,
      description: "RFC 1628 UPS-MIB (vendor-neutral). Built by tools/client-site-lab/provision.mjs.",
      groups: [{ groupid }],
      macros: [
        { macro: "{$UPS.RUNTIME.CRIT}", value: "600", description: "Seconds of battery runtime that count as critical" },
        { macro: "{$UPS.LOAD.WARN}", value: "80" },
        { macro: "{$UPS.CHARGE.WARN}", value: "50" },
      ],
    });
    const templateid = templateids[0];
    const vm = async (name, mappings) =>
      (
        await zbx("valuemap.create", {
          hostid: templateid,
          name,
          mappings: Object.entries(mappings).map(([value, newvalue]) => ({ value, newvalue })),
        })
      ).valuemapids[0];
    const batteryMap = await vm("UPS-MIB battery status", { 1: "Unknown", 2: "Normal", 3: "Low", 4: "Depleted" });
    const sourceMap = await vm("UPS-MIB output source", {
      1: "Other", 2: "None", 3: "Mains (normal)", 4: "Bypass", 5: "Battery", 6: "Booster", 7: "Reducer",
    });

    const U = "1.3.6.1.2.1.33.1";
    const snmp = (key, name, oid, extra = {}) => ({
      hostid: templateid,
      type: 20,
      key_: key,
      name,
      snmp_oid: `get[${oid}]`,
      value_type: 3,
      delay: "30s",
      history: "7d",
      trends: "365d",
      ...extra,
    });
    const scale = (factor) => ({ preprocessing: [{ type: 1, params: String(factor), error_handler: 0, error_handler_params: "" }] });
    const text = { value_type: 1, delay: "1h", trends: "0" };
    const tag = (value) => ({ tags: [{ tag: "component", value }] });
    await zbx("item.create", [
      snmp("ups.manufacturer", "UPS manufacturer", `${U}.1.1.0`, { ...text, ...tag("inventory") }),
      snmp("ups.model", "UPS model", `${U}.1.2.0`, { ...text, ...tag("inventory") }),
      snmp("ups.firmware", "UPS firmware", `${U}.1.3.0`, { ...text, ...tag("inventory") }),
      snmp("ups.agent.firmware", "UPS management card firmware", `${U}.1.4.0`, { ...text, ...tag("inventory") }),
      snmp("ups.battery.status", "Battery status", `${U}.2.1.0`, { valuemapid: batteryMap, ...tag("battery") }),
      snmp("ups.battery.time_on", "Time on battery", `${U}.2.2.0`, { units: "s", ...tag("battery") }),
      snmp("ups.battery.runtime", "Battery runtime remaining", `${U}.2.3.0`, { units: "s", ...scale(60), ...tag("battery") }),
      snmp("ups.battery.charge", "Battery charge", `${U}.2.4.0`, { units: "%", ...tag("battery") }),
      snmp("ups.battery.voltage", "Battery voltage", `${U}.2.5.0`, { value_type: 0, units: "V", ...scale(0.1), ...tag("battery") }),
      snmp("ups.battery.temperature", "Battery temperature", `${U}.2.7.0`, { units: "°C", ...tag("battery") }),
      snmp("ups.input.frequency", "Input frequency", `${U}.3.3.1.2.1`, { value_type: 0, units: "Hz", ...scale(0.1), ...tag("input") }),
      snmp("ups.input.voltage", "Input voltage", `${U}.3.3.1.3.1`, { units: "V", ...tag("input") }),
      snmp("ups.output.source", "Output source", `${U}.4.1.0`, { valuemapid: sourceMap, ...tag("output") }),
      snmp("ups.output.voltage", "Output voltage", `${U}.4.4.1.2.1`, { units: "V", ...tag("output") }),
      snmp("ups.output.load", "Output load", `${U}.4.4.1.5.1`, { units: "%", ...tag("output") }),
      {
        hostid: templateid,
        type: 5, // Zabbix internal
        key_: "zabbix[host,snmp,available]",
        name: "SNMP agent availability",
        value_type: 3,
        delay: "1m",
        history: "7d",
        ...tag("status"),
      },
    ]);

    const T = `/${UPS_TEMPLATE}`;
    const trig = (description, priority, expression, alertType, extra = {}) => ({
      description,
      priority,
      expression,
      tags: [{ tag: "alertType", value: alertType }],
      ...extra,
    });
    await zbx("trigger.create", [
      trig("UPS is running on battery", 4, `last(${T}/ups.output.source)=5`, "ups.on_battery", {
        comments: "Mains power to the UPS has failed. Check the input feed / building power.",
      }),
      trig(
        "UPS battery is low: {ITEM.LASTVALUE2} runtime left",
        5,
        `last(${T}/ups.battery.status)>=3 or last(${T}/ups.battery.runtime)<{$UPS.RUNTIME.CRIT}`,
        "ups.battery_low",
        {
          recovery_mode: 1,
          recovery_expression: `last(${T}/ups.battery.status)=2 and last(${T}/ups.battery.runtime)>={$UPS.RUNTIME.CRIT}`,
          comments: "Equipment will lose power soon. Start graceful shutdowns.",
        },
      ),
      trig("UPS load is high (over {$UPS.LOAD.WARN}%)", 2, `min(${T}/ups.output.load,2m)>{$UPS.LOAD.WARN}`, "ups.overload"),
      trig("UPS battery charge below {$UPS.CHARGE.WARN}%", 3, `last(${T}/ups.battery.charge)<{$UPS.CHARGE.WARN}`, "ups.battery_charge_low"),
      trig("UPS battery temperature is high (over 40°C)", 2, `last(${T}/ups.battery.temperature)>40`, "ups.battery_temperature"),
      trig("UPS has no SNMP data", 3, `max(${T}/zabbix[host,snmp,available],2m)=0`, "ups.snmp_unreachable"),
    ]);
    log(`template "${UPS_TEMPLATE}" created (15 items, 6 triggers)`);
    return templateid;
  }


  async function templateId(name) {
    const [t] = await zbx("template.get", { filter: { host: [name] }, output: ["templateid"] });
    if (!t) throw new Error(`Zabbix template "${name}" not found`);
    return t.templateid;
  }


  const WEBHOOK_SCRIPT = `
  var p = JSON.parse(value);
  var tags = {};
  try { JSON.parse(p.tagsJson).forEach(function (t) { tags[t.tag] = t.value; }); } catch (e) {}
  var ev = {
    eventId: p.eventId, eventValue: p.eventValue, eventUpdateStatus: p.eventUpdateStatus,
    eventAckStatus: p.eventAckStatus, name: p.name, severity: p.severity, nseverity: p.nseverity,
    timestamp: p.timestamp, host: p.host, hostName: p.hostName, itemKey: p.itemKey,
    triggerId: p.triggerId, opdata: p.opdata, tags: tags
  };
  // Drop macros Zabbix could not resolve for this event (e.g. {ITEM.KEY} on multi-item triggers).
  Object.keys(ev).forEach(function (k) {
    if (typeof ev[k] === 'string' && (ev[k] === '' || ev[k].charAt(0) === '{')) { delete ev[k]; }
  });
  // {EVENT.TIMESTAMP} can come back unresolved (e.g. on some action operations); OpsDesk
  // requires a timestamp, so fall back to "now" in Unix seconds.
  if (!/^[0-9]+$/.test(ev.timestamp || '')) { ev.timestamp = String(Math.floor(Date.now() / 1000)); }
  var req = new HttpRequest();
  req.addHeader('Content-Type: application/json');
  req.addHeader('Authorization: Bearer ' + p.token);
  var resp = req.post(p.url, JSON.stringify({ events: [ev] }));
  var status = req.getStatus();
  if (status < 200 || status >= 300) { throw 'OpsDesk answered HTTP ' + status + ': ' + resp; }
  return 'OK';
  `.trim();

  async function ensureWebhook(odkToken, webhookUrl) {
    const parameters = [
      ["url", webhookUrl],
      ["token", odkToken],
      ["eventId", "{EVENT.ID}"],
      ["eventValue", "{EVENT.VALUE}"],
      ["eventUpdateStatus", "{EVENT.UPDATE.STATUS}"],
      ["eventAckStatus", "{EVENT.ACK.STATUS}"],
      ["name", "{EVENT.NAME}"],
      ["severity", "{EVENT.SEVERITY}"],
      ["nseverity", "{EVENT.NSEVERITY}"],
      ["timestamp", "{EVENT.TIMESTAMP}"],
      ["host", "{HOST.HOST}"],
      ["hostName", "{HOST.NAME}"],
      ["itemKey", "{ITEM.KEY}"],
      ["triggerId", "{TRIGGER.ID}"],
      ["opdata", "{EVENT.OPDATA}"],
      ["tagsJson", "{EVENT.TAGSJSON}"],
    ].map(([name, value]) => ({ name, value }));
    const fields = {
      type: 4, // webhook
      status: 0, // enabled — Zabbix creates media types disabled otherwise
      script: WEBHOOK_SCRIPT,
      parameters,
      timeout: "10s",
      maxattempts: 3,
      attempt_interval: "10s",
      description: "Pushes problems, recoveries and acknowledgements to OpsDesk /alerts/sources/zabbix",
      message_templates: [0, 1, 2].map((recovery) => ({
        eventsource: 0,
        recovery,
        subject: "{EVENT.NAME}",
        message: "{EVENT.NAME} on {HOST.NAME}",
      })),
    };
    const [m] = await zbx("mediatype.get", { filter: { name: ["OpsDesk"] }, output: ["mediatypeid"] });
    if (m) {
      await zbx("mediatype.update", { mediatypeid: m.mediatypeid, ...fields });
      log("media type OpsDesk updated");
      return m.mediatypeid;
    }
    const r = await zbx("mediatype.create", { name: "OpsDesk", ...fields });
    log("media type OpsDesk created");
    return r.mediatypeids[0];
  }

  /**
   * A dedicated, frontend-less Zabbix user that only receives the OpsDesk media.
   * It must NOT be the user behind the API token: Zabbix never sends an update
   * notification to the user who made the update, so an acknowledge done from
   * OpsDesk (as the token's user) would never be echoed back to OpsDesk.
   */

  /**
   * A dedicated, frontend-less Zabbix user that only receives the OpsDesk media.
   * It must NOT be the user behind the API token: Zabbix never sends an update
   * notification to the user who made the update, so an acknowledge done from
   * OpsDesk (as the token's user) would never be echoed back to OpsDesk.
   */
  async function ensureWebhookUser(mediatypeid) {
    const USER = WEBHOOK_USER;
    const GROUP_NAME = WEBHOOK_USER_GROUP;
    const hostgroups = await zbx("hostgroup.get", { output: ["groupid"] });
    const hostgroup_rights = hostgroups.map((g) => ({ id: g.groupid, permission: 2 })); // read
    let [grp] = await zbx("usergroup.get", { filter: { name: [GROUP_NAME] }, output: ["usrgrpid"] });
    if (grp) {
      await zbx("usergroup.update", { usrgrpid: grp.usrgrpid, hostgroup_rights });
    } else {
      const r = await zbx("usergroup.create", { name: GROUP_NAME, gui_access: 3, hostgroup_rights }); // 3 = no frontend
      grp = { usrgrpid: r.usrgrpids[0] };
      log(`user group "${GROUP_NAME}" created (read-only, no frontend)`);
    }
    const [role] = await zbx("role.get", { filter: { name: ["User role"] }, output: ["roleid"] });
    const medias = [{ mediatypeid, sendto: "opsdesk", active: 0, severity: 63, period: "1-7,00:00-24:00" }];
    let [user] = await zbx("user.get", { filter: { username: [USER] }, output: ["userid"] });
    if (user) {
      await zbx("user.update", { userid: user.userid, usrgrps: [{ usrgrpid: grp.usrgrpid }], medias });
    } else {
      const r = await zbx("user.create", {
        username: USER,
        name: "OpsDesk",
        surname: "webhook",
        passwd: `${randomBytes(18).toString("base64url")}aA1!`,
        roleid: role.roleid,
        usrgrps: [{ usrgrpid: grp.usrgrpid }],
        medias,
      });
      user = { userid: r.userids[0] };
      log(`user ${USER} created (receives the OpsDesk media only)`);
    }
    // Earlier versions of this script put the media on Admin; take it off again.
    const [admin] = await zbx("user.get", { filter: { username: ["Admin"] }, output: ["userid"], selectMedias: "extend" });
    const adminMedias = admin.medias ?? [];
    if (adminMedias.some((m) => m.mediatypeid === mediatypeid)) {
      await zbx("user.update", {
        userid: admin.userid,
        medias: adminMedias
          .filter((m) => m.mediatypeid !== mediatypeid)
          .map(({ mediatypeid: mt, sendto, active, severity, period }) => ({ mediatypeid: mt, sendto, active, severity, period })),
      });
      log("OpsDesk media removed from Admin");
    }
    return user.userid;
  }


  async function ensureAction(mediatypeid, userid) {
    const fields = {
      eventsource: 0,
      status: 0,
      esc_period: "1h",
      // Only events that carry a "site" tag (host tags are inherited by events).
      filter: { evaltype: 0, conditions: [{ conditiontype: 25, operator: 0, value: "site" }] },
      operations: [
        {
          operationtype: 0,
          esc_step_from: 1,
          esc_step_to: 1,
          opmessage: { default_msg: 1, mediatypeid },
          opmessage_usr: [{ userid }],
        },
      ],
      recovery_operations: [{ operationtype: 11, opmessage: { default_msg: 1 } }],
      update_operations: [{ operationtype: 12, opmessage: { default_msg: 1 } }],
    };
    const [a] = await zbx("action.get", { filter: { name: ["Send problems to OpsDesk"] }, output: ["actionid"] });
    if (a) {
      await zbx("action.update", { actionid: a.actionid, ...fields });
      log('action "Send problems to OpsDesk" updated');
      return;
    }
    await zbx("action.create", { name: "Send problems to OpsDesk", ...fields });
    log('action "Send problems to OpsDesk" created');
  }

  /**
   * Adds read access for one host group to the webhook user group, keeping the
   * groups it already has. Without this, a site onboarded after the central
   * setup would never be notified: Zabbix only notifies users who can read the
   * host.
   */
  async function grantWebhookRead(groupid) {
    const [grp] = await zbx("usergroup.get", {
      filter: { name: [WEBHOOK_USER_GROUP] },
      output: ["usrgrpid"],
      selectHostGroupRights: ["id", "permission"],
    });
    if (!grp) throw new Error(`Zabbix user group "${WEBHOOK_USER_GROUP}" missing — run setup-central.mjs first`);
    const rights = grp.hostgroup_rights ?? [];
    if (rights.some((r) => r.id === groupid && Number(r.permission) >= 2)) return false;
    const merged = [...rights.filter((r) => r.id !== groupid).map((r) => ({ id: r.id, permission: Number(r.permission) })), { id: groupid, permission: 2 }];
    await zbx("usergroup.update", { usrgrpid: grp.usrgrpid, hostgroup_rights: merged });
    log(`webhook user group can now read host group ${groupid}`);
    return true;
  }

  return {
    ensureHostGroup,
    ensureTemplateGroup,
    ensureUpsTemplate,
    templateId,
    ensureWebhook,
    ensureWebhookUser,
    ensureAction,
    grantWebhookRead,
  };
}
