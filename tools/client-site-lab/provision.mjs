// Client site lab — provisioning (runs on Windows, after setup-wsl.sh).
//   node tools/client-site-lab/provision.mjs
//
// Idempotent. Registers in Zabbix: the SITE02 proxy (PSK), a UPS-MIB template,
// the five client devices (tagged site/ci, monitored by the proxy), the OpsDesk
// webhook media type + action. Registers in OpsDesk: the matching CMDB items
// and (once) an odk_ API token the webhook uses.
//
// Secrets read from tools/client-site-lab/secrets/ (gitignored):
//   zabbix-api-token      Zabbix API token (Users -> API tokens)
//   opsdesk-webhook-token odk_ token for the webhook (created here if missing)
// Env overrides: ZABBIX_URL, OPSDESK_API, OPSDESK_ADMIN_EMAIL, OPSDESK_ADMIN_PASSWORD, WSL_DISTRO.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRETS = join(HERE, "secrets");
const ZABBIX_URL = process.env.ZABBIX_URL ?? "http://127.0.0.1/zabbix/api_jsonrpc.php";
const OPSDESK_API = process.env.OPSDESK_API ?? "http://127.0.0.1:3000/api/v1";
// What the Zabbix server (inside WSL) calls. Mirrored WSL networking shares localhost.
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "http://127.0.0.1:3000/api/v1/alerts/sources/zabbix";
const DISTRO = process.env.WSL_DISTRO ?? "Ubuntu-24.04";

const SITE = "SITE02";
const PROXY = "SITE02-PROXY";
const GROUP = "Client SITE02";
const UPS_TEMPLATE = "OpsDesk UPS-MIB by SNMP";

const DEVICES = [
  {
    host: "SITE02-FW-001",
    name: "SITE02 Firewall (FortiGate-60F)",
    template: "FortiGate by SNMP",
    snmp: "127.0.0.21",
    ci: { ciType: "FIREWALL", manufacturer: "Fortinet", model: "FortiGate-60F", criticality: "CRITICAL" },
  },
  {
    host: "SITE02-SW-001",
    name: "SITE02 Core switch (Catalyst 2960-X)",
    template: "Network Generic Device by SNMP",
    snmp: "127.0.0.22",
    ci: { ciType: "SWITCH", manufacturer: "Cisco", model: "Catalyst 2960-X", criticality: "HIGH" },
  },
  {
    host: "SITE02-UPS-001",
    name: "SITE02 UPS (Smart-UPS SRT 5000)",
    template: UPS_TEMPLATE,
    snmp: "127.0.0.23",
    ci: { ciType: "UPS", manufacturer: "APC", model: "Smart-UPS SRT 5000", criticality: "CRITICAL" },
  },
  {
    host: "SITE02-ISP-001",
    name: "SITE02 ISP-A link (Airtel 100M)",
    template: "ICMP Ping",
    ping: "127.0.0.30",
    ci: { ciType: "CIRCUIT", manufacturer: "Airtel", model: "100 Mbps ILL", criticality: "HIGH" },
  },
  {
    host: "SITE02-SRV-001",
    name: "SITE02 File server (Linux)",
    template: "Linux by Zabbix agent active",
    ci: { ciType: "SERVER", manufacturer: "Generic", model: "Linux VM", criticality: "HIGH" },
  },
];

// ------------------------------------------------------------------ helpers

function secret(name) {
  const p = join(SECRETS, name);
  return existsSync(p) ? readFileSync(p, "utf8").trim() : null;
}

const zbxToken = secret("zabbix-api-token");
if (!zbxToken) {
  console.error(`Missing ${join(SECRETS, "zabbix-api-token")} — create a Zabbix API token first (see README).`);
  process.exit(1);
}

let rpcId = 1;
async function zbx(method, params) {
  const res = await fetch(ZABBIX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json-rpc", Authorization: `Bearer ${zbxToken}` },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: rpcId++ }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`Zabbix ${method}: ${body.error.message} ${body.error.data ?? ""}`);
  return body.result;
}

let jwt;
async function ops(method, path, body) {
  const res = await fetch(`${OPSDESK_API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`OpsDesk ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return data;
}

const log = (msg) => console.log(`  ${msg}`);

// ------------------------------------------------------------------ Zabbix

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

async function ensureProxy() {
  const psk = execFileSync("wsl", ["-d", DISTRO, "-u", "root", "--", "cat", "/etc/zabbix/client-lab/site02-proxy.psk"], {
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{64}$/i.test(psk)) throw new Error("PSK file in WSL is missing or malformed — run setup-wsl.sh");
  const fields = {
    operating_mode: 0, // active: the proxy connects out to the server
    tls_accept: 2, // PSK only
    tls_psk_identity: PROXY,
    tls_psk: psk,
    description: "Client site lab: pretend client office SITE02 (tools/client-site-lab)",
  };
  const [p] = await zbx("proxy.get", { filter: { name: [PROXY] }, output: ["proxyid"] });
  if (p) {
    await zbx("proxy.update", { proxyid: p.proxyid, ...fields });
    log(`proxy ${PROXY} updated`);
    return p.proxyid;
  }
  const r = await zbx("proxy.create", { name: PROXY, ...fields });
  log(`proxy ${PROXY} created (active, PSK)`);
  return r.proxyids[0];
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

async function ensureHost(dev, proxyid, groupid) {
  const templates = [{ templateid: await templateId(dev.template) }];
  const tags = [
    { tag: "site", value: SITE },
    { tag: "ci", value: dev.host },
  ];
  const common = { name: dev.name, groups: [{ groupid }], templates, tags, monitored_by: 1, proxyid };
  const [h] = await zbx("host.get", { filter: { host: [dev.host] }, output: ["hostid"] });
  if (h) {
    await zbx("host.update", { hostid: h.hostid, ...common });
    log(`host ${dev.host} updated`);
    return { hostid: h.hostid, created: false };
  }
  const interfaces = [];
  const macros = [];
  if (dev.snmp) {
    interfaces.push({
      type: 2, main: 1, useip: 1, ip: dev.snmp, dns: "", port: "1161",
      details: { version: 2, bulk: 1, community: "{$SNMP_COMMUNITY}" },
    });
    macros.push({ macro: "{$SNMP_COMMUNITY}", value: "public" });
  }
  if (dev.ping) {
    interfaces.push({ type: 1, main: 1, useip: 1, ip: dev.ping, dns: "", port: "10050" });
  }
  const r = await zbx("host.create", { host: dev.host, ...common, interfaces, macros });
  log(`host ${dev.host} created`);
  return { hostid: r.hostids[0], created: true };
}

/** Run discovery rules now instead of waiting up to their (1 h) interval. */
async function discoverNow(hostids) {
  // Only SNMP rules (type 20): dependent rules follow their master item, and
  // active-agent rules are pulled by the agent, so neither can be "checked now".
  const rules = (await zbx("discoveryrule.get", { hostids, output: ["itemid", "type"] })).filter(
    (r) => r.type === "20",
  );
  const items = await zbx("item.get", { hostids, output: ["itemid"], filter: { type: [20] }, limit: 500 });
  const ids = [...rules, ...items].map((r) => r.itemid);
  for (let i = 0; i < ids.length; i += 50) {
    await zbx("task.create", ids.slice(i, i + 50).map((itemid) => ({ type: 6, request: { itemid } })));
  }
  log(`asked Zabbix to check ${ids.length} items/discovery rules now`);
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
var req = new HttpRequest();
req.addHeader('Content-Type: application/json');
req.addHeader('Authorization: Bearer ' + p.token);
var resp = req.post(p.url, JSON.stringify({ events: [ev] }));
var status = req.getStatus();
if (status < 200 || status >= 300) { throw 'OpsDesk answered HTTP ' + status + ': ' + resp; }
return 'OK';
`.trim();

async function ensureWebhook(odkToken) {
  const parameters = [
    ["url", WEBHOOK_URL],
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

async function ensureAdminMedia(mediatypeid) {
  const [admin] = await zbx("user.get", { filter: { username: ["Admin"] }, output: ["userid"], selectMedias: "extend" });
  const medias = (admin.medias ?? []).map(({ mediatypeid: mt, sendto, active, severity, period }) => ({
    mediatypeid: mt, sendto, active, severity, period,
  }));
  if (!medias.some((x) => x.mediatypeid === mediatypeid)) {
    medias.push({ mediatypeid, sendto: "opsdesk", active: 0, severity: 63, period: "1-7,00:00-24:00" });
    await zbx("user.update", { userid: admin.userid, medias });
    log("Admin user given the OpsDesk media");
  }
  return admin.userid;
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

// ------------------------------------------------------------------ OpsDesk

async function opsdeskLogin() {
  const email = process.env.OPSDESK_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.OPSDESK_ADMIN_PASSWORD ?? "OpsDesk-Demo-2026!";
  jwt = (await ops("POST", "/auth/login", { email, password })).accessToken;
  const users = await ops("GET", "/admin/users");
  const list = Array.isArray(users) ? users : users.items;
  const me = list.find((u) => u.email === email);
  return me.id;
}

async function ensureWebhookToken(adminId) {
  const existing = secret("opsdesk-webhook-token");
  if (existing) return existing;
  const created = await ops("POST", `/admin/users/${adminId}/api-tokens`, {
    name: "Zabbix webhook (client site lab, local)",
    expiresInDays: 365,
  });
  writeFileSync(join(SECRETS, "opsdesk-webhook-token"), created.token, { mode: 0o600 });
  log("OpsDesk API token for the webhook created and saved to secrets/");
  return created.token;
}

async function ensureCis() {
  const sites = await ops("GET", "/sites?limit=100");
  const site = (sites.items ?? sites).find((s) => s.code === SITE);
  if (!site) throw new Error(`OpsDesk site ${SITE} not found — run the seed`);
  for (const dev of DEVICES) {
    const found = await ops("GET", `/cis?q=${encodeURIComponent(dev.host)}&limit=5`);
    if ((found.items ?? found).some((c) => c.ciCode === dev.host)) {
      log(`CMDB ${dev.host} exists`);
      continue;
    }
    await ops("POST", "/cis", {
      ciCode: dev.host,
      siteId: site.id,
      name: dev.name,
      ciType: dev.ci.ciType,
      manufacturer: dev.ci.manufacturer,
      model: dev.ci.model,
      managementAddress: dev.snmp ? `${dev.snmp}:1161 (SNMP)` : dev.ping ?? undefined,
      managedBy: "JSAN",
      criticality: dev.ci.criticality,
      lifecycleStatus: "ACTIVE",
      metadata: { zabbixHost: dev.host, zabbixProxy: PROXY, lab: "client-site-lab" },
    });
    log(`CMDB ${dev.host} created (${dev.ci.ciType})`);
  }
}

// ------------------------------------------------------------------ main

console.log("OpsDesk");
const adminId = await opsdeskLogin();
const odkToken = await ensureWebhookToken(adminId);
await ensureCis();

console.log("Zabbix");
const groupid = await ensureHostGroup(GROUP);
const proxyid = await ensureProxy();
await ensureUpsTemplate();
const created = [];
for (const dev of DEVICES) {
  const { hostid } = await ensureHost(dev, proxyid, groupid);
  created.push(hostid);
}
const mediatypeid = await ensureWebhook(odkToken);
const userid = await ensureAdminMedia(mediatypeid);
await ensureAction(mediatypeid, userid);

// The proxy picks up its config within ProxyConfigFrequency (10 s).
await new Promise((r) => setTimeout(r, 15000));
await discoverNow(created);
console.log("Done. Watch: Zabbix -> Data collection -> Proxies, and OpsDesk -> Monitoring -> Zabbix.");
