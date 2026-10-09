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
import { UPS_TEMPLATE, zabbixCentral } from "../onboarding-kit/lib/zabbix.mjs";

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
// Central objects (UPS template, webhook, webhook user, action) are shared with the onboarding kit.
const { ensureHostGroup, ensureUpsTemplate, templateId, ensureWebhook, ensureWebhookUser, ensureAction, grantWebhookRead } =
  zabbixCentral(zbx, log);

// ------------------------------------------------------------------ Zabbix

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
const mediatypeid = await ensureWebhook(odkToken, WEBHOOK_URL);
const userid = await ensureWebhookUser(mediatypeid);
await ensureAction(mediatypeid, userid);
await grantWebhookRead(groupid);

// The proxy picks up its config within ProxyConfigFrequency (10 s).
await new Promise((r) => setTimeout(r, 15000));
await discoverNow(created);
console.log("Done. Watch: Zabbix -> Data collection -> Proxies, and OpsDesk -> Monitoring -> Zabbix.");
