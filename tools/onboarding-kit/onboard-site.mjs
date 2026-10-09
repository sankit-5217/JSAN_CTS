// Onboard one client site (JSAN side). Re-runnable; --dry-run changes nothing.
//
//   node tools/onboarding-kit/onboard-site.mjs \
//     --site SITE03 --name "Acme Pune office" --timezone Asia/Kolkata \
//     --server monitor.jsan.example --inventory path/to/devices.csv [--dry-run]
//
// Options:
//   --server HOST[:PORT]     address the client's proxy dials (JSAN Zabbix server), default port 10051
//   --proxy-listen-port N    proxy's local port for agents on the client LAN (default 10051)
//   --no-proxy-agent         don't monitor the proxy VM itself
//   --is247                  the site is staffed/covered 24x7
//   --rotate-psk             issue a new proxy key (the client must reinstall the bundle)
//
// Order: validate everything, then write. Nothing is created if any check fails.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KIT_DIR, OUT_DIR, loadConfig, parseArgs } from "./lib/config.mjs";
import { validateInventory } from "./lib/inventory.mjs";
import { opsdeskClient } from "./lib/opsdesk.mjs";
import { WEBHOOK_USER_GROUP, zabbixCentral, zabbixClient, zabbixVersion } from "./lib/zabbix.mjs";

const args = parseArgs(process.argv.slice(2));
const usage = () => {
  console.error(
    'Usage: node onboard-site.mjs --site SITE03 --name "Client office" --timezone Asia/Kolkata --server HOST[:PORT] --inventory devices.csv [--dry-run]',
  );
  process.exit(2);
};
const SITE = String(args.site ?? "").toUpperCase();
if (!/^[A-Z][A-Z0-9]{2,15}$/.test(SITE)) { console.error("--site must look like SITE03 (letters/digits, 3-16 chars)"); usage(); }
if (!args.name || !args.timezone || !args.server || !args.inventory) usage();
const DRY = Boolean(args["dry-run"]);
const [serverHost, serverPortRaw] = String(args.server).split(":");
const serverPort = Number(serverPortRaw ?? 10051);
const listenPort = Number(args["proxy-listen-port"] ?? 10051);
const withProxyAgent = !args["no-proxy-agent"];
const PROXY = `${SITE}-PROXY`;
const PROXY_VM = `${SITE}-PROXY-VM`;
const GROUP = `Client ${SITE}`;
const BUNDLE = join(OUT_DIR, SITE);

const problems = [];
const fail = (m) => problems.push(m);
const log = (m) => console.log(`  ${m}`);

// ------------------------------------------------------------------ 1. inputs
console.log(`Onboarding ${SITE} — "${args.name}"${DRY ? "  (dry run: nothing will be changed)" : ""}`);
try {
  Intl.DateTimeFormat(undefined, { timeZone: args.timezone });
} catch {
  fail(`--timezone "${args.timezone}" is not a valid IANA time zone (e.g. Asia/Kolkata)`);
}
if (!serverHost || !Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) fail(`--server "${args.server}" is not HOST[:PORT]`);
if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) fail("--proxy-listen-port is not a port");
if (!existsSync(args.inventory)) fail(`inventory file not found: ${args.inventory}`);

let devices = [];
if (existsSync(args.inventory)) {
  const inv = validateInventory(readFileSync(args.inventory, "utf8"), SITE);
  inv.warnings.forEach((w) => console.log(`  warning: ${w}`));
  inv.errors.forEach(fail);
  devices = inv.devices;
}
if (withProxyAgent) {
  if (devices.some((d) => d.host === PROXY_VM)) fail(`${PROXY_VM} is reserved for the proxy VM — remove it from the inventory or use --no-proxy-agent`);
  devices.push({
    host: PROXY_VM,
    name: `${args.name} — monitoring proxy VM`,
    type: "server-linux",
    template: "Linux by Zabbix agent active",
    ciType: "VM",
    kind: "monitoring-proxy",
    iface: "agent-active",
    criticality: "HIGH",
    manufacturer: null,
    model: "Zabbix proxy host",
    location: null,
  });
}

// ------------------------------------------------------------------ 2. preflight (read-only)
const cfg = loadConfig();
const zbx = zabbixClient(cfg.zabbixUrl, cfg.zabbixToken);
const central = zabbixCentral(zbx, log);
let ops;
let site = null;
let proxy = null;
const existingHosts = new Map();

if (!problems.length) {
  const version = await zabbixVersion(cfg.zabbixUrl).catch(() => null);
  if (!version) fail(`Zabbix API not reachable at ${cfg.zabbixUrl}`);
  else if (!String(version).startsWith("7.")) fail(`Zabbix ${version}: this kit needs Zabbix 7.x`);
}
if (!problems.length) {
  ops = await opsdeskClient(cfg.opsdeskApi, cfg.adminEmail, cfg.adminPassword).catch((e) => {
    fail(`OpsDesk login failed: ${e.message}`);
    return null;
  });
}
if (!problems.length) {
  // Central setup present and enabled?
  const [mt] = await zbx("mediatype.get", { filter: { name: ["OpsDesk"] }, output: ["status"] });
  if (!mt) fail("Zabbix media type OpsDesk is missing — run setup-central.mjs first");
  else if (mt.status !== "0") fail("Zabbix media type OpsDesk is disabled — run setup-central.mjs");
  const [ug] = await zbx("usergroup.get", { filter: { name: [WEBHOOK_USER_GROUP] }, output: ["usrgrpid"] });
  if (!ug) fail(`Zabbix user group "${WEBHOOK_USER_GROUP}" is missing — run setup-central.mjs first`);
  const [action] = await zbx("action.get", { filter: { name: ["Send problems to OpsDesk"] }, output: ["status"] });
  if (!action || action.status !== "0") fail('Zabbix action "Send problems to OpsDesk" is missing or disabled — run setup-central.mjs');

  // Templates exist?
  for (const t of new Set(devices.map((d) => d.template))) {
    const [tpl] = await zbx("template.get", { filter: { host: [t] }, output: ["templateid"] });
    if (!tpl) fail(`Zabbix template "${t}" not found${t.startsWith("OpsDesk") ? " — run setup-central.mjs" : ""}`);
  }

  // Proxy: must be ours if it exists.
  [proxy] = await zbx("proxy.get", { filter: { name: [PROXY] }, output: ["proxyid", "operating_mode", "tls_accept"] });

  // Hosts: an existing host must already belong to this site and this proxy.
  const found = await zbx("host.get", {
    filter: { host: devices.map((d) => d.host) },
    output: ["hostid", "host", "proxyid", "monitored_by"],
    selectTags: ["tag", "value"],
  });
  for (const h of found) {
    const siteTag = h.tags.find((t) => t.tag === "site")?.value;
    if (siteTag && siteTag !== SITE) fail(`Zabbix host ${h.host} already exists for site ${siteTag}`);
    else if (proxy && h.monitored_by === "1" && h.proxyid !== proxy.proxyid) fail(`Zabbix host ${h.host} is monitored by another proxy`);
    existingHosts.set(h.host, h);
  }
  // The same IP:port twice behind THIS proxy means a copy-paste mistake. Other
  // clients may legitimately reuse private addresses (192.168.x.x), so only
  // hosts already on this site's proxy are compared.
  const snmpDevs = devices.filter((d) => d.iface === "snmp");
  if (snmpDevs.length && proxy) {
    const ifaces = await zbx("hostinterface.get", { output: ["hostid", "ip", "dns", "port"], filter: { type: 2 } });
    const others = ifaces.filter((i) => !found.some((h) => h.hostid === i.hostid));
    if (others.length) {
      const otherHosts = await zbx("host.get", {
        hostids: [...new Set(others.map((i) => i.hostid))],
        output: ["hostid", "host", "proxyid"],
      });
      for (const d of snmpDevs) {
        for (const i of others) {
          const host = otherHosts.find((h) => h.hostid === i.hostid);
          if ((i.ip === d.address || i.dns === d.address) && Number(i.port) === d.port && host?.proxyid === proxy.proxyid) {
            fail(`${d.host}: ${d.address}:${d.port} is already monitored as ${host?.host}`);
          }
        }
      }
    }
  }

  // OpsDesk: site and CI codes.
  site = await ops.findSite(SITE);
  if (site && site.name !== args.name) console.log(`  note: OpsDesk site ${SITE} exists as "${site.name}" — keeping that name`);
  for (const d of devices) {
    const ci = await ops.findCi(d.host);
    if (ci && site && ci.siteId !== site.id) fail(`OpsDesk CI ${d.host} already exists at another site`);
    if (ci && !site) fail(`OpsDesk CI ${d.host} exists but site ${SITE} does not`);
    d.existingCi = ci;
  }
}

if (problems.length) {
  console.error(`\nStopped — ${problems.length} problem(s), nothing was changed:`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

// PSK: keep the one in the existing bundle unless asked to rotate.
const envPath = join(BUNDLE, "proxy.env");
let psk = null;
if (existsSync(envPath) && !args["rotate-psk"]) psk = readFileSync(envPath, "utf8").match(/^PSK=([0-9a-f]{64})$/m)?.[1] ?? null;
let pskIsNew = false;
if (!psk) {
  if (proxy && !args["rotate-psk"]) {
    console.error(`\nProxy ${PROXY} exists in Zabbix but its key is not in ${envPath}.`);
    console.error("Zabbix never reveals a stored key. Re-run with --rotate-psk and reinstall the bundle at the client.");
    process.exit(1);
  }
  psk = randomBytes(32).toString("hex");
  pskIsNew = true;
}

console.log("\nPlan:");
log(`OpsDesk site ${SITE}: ${site ? "exists" : "create"}`);
log(`Zabbix proxy ${PROXY} (active, PSK): ${proxy ? (pskIsNew ? "update + NEW key" : "update") : "create"}`);
log(`Zabbix host group "${GROUP}" + webhook read access`);
for (const d of devices) {
  log(`${d.host.padEnd(22)} ${d.type.padEnd(18)} ${(d.address ? `${d.address}${d.port ? `:${d.port}` : ""}` : "agent → proxy").padEnd(22)} ` +
      `Zabbix: ${existingHosts.has(d.host) ? "update" : "create"} · CMDB: ${d.existingCi ? "exists" : "create"}`);
}
if (DRY) {
  console.log("\nDry run complete — nothing was changed.");
  process.exit(0);
}

// ------------------------------------------------------------------ 3. write
console.log("\nApplying:");
if (!site) {
  site = await ops.createSite({ code: SITE, name: String(args.name), timezone: String(args.timezone), is247: Boolean(args.is247) });
  log(`OpsDesk site ${SITE} created`);
}
for (const d of devices) {
  if (d.existingCi) continue;
  await ops.createCi({
    ciCode: d.host,
    siteId: site.id,
    name: d.name,
    ciType: d.ciType,
    manufacturer: d.manufacturer ?? undefined,
    model: d.model ?? undefined,
    managementAddress: d.address ? (d.port ? `${d.address}:${d.port}` : d.address) : undefined,
    managedBy: "JSAN",
    criticality: d.criticality,
    lifecycleStatus: "ACTIVE",
    metadata: {
      zabbixHost: d.host,
      zabbixProxy: PROXY,
      deviceType: d.type,
      ...(d.kind ? { deviceKind: d.kind } : {}),
      ...(d.location ? { location: d.location } : {}),
      onboardedBy: "onboarding-kit",
    },
  });
  log(`CMDB ${d.host} created (${d.ciType})`);
}

const groupid = await central.ensureHostGroup(GROUP);
await central.grantWebhookRead(groupid);

const proxyFields = {
  operating_mode: 0,
  tls_accept: 2,
  tls_psk_identity: PROXY,
  tls_psk: psk,
  description: `Client site ${SITE} — ${args.name}. Onboarded by tools/onboarding-kit.`,
};
let proxyid;
if (proxy) {
  // Only send the key when it changes; Zabbix requires identity+key together.
  const fields = pskIsNew ? proxyFields : { operating_mode: 0, tls_accept: 2, description: proxyFields.description };
  await zbx("proxy.update", { proxyid: proxy.proxyid, ...fields });
  proxyid = proxy.proxyid;
  log(`proxy ${PROXY} updated${pskIsNew ? " with a NEW key" : ""}`);
} else {
  proxyid = (await zbx("proxy.create", { name: PROXY, ...proxyFields })).proxyids[0];
  log(`proxy ${PROXY} created`);
}

for (const d of devices) {
  const templateid = await central.templateId(d.template);
  const tags = [
    { tag: "site", value: SITE },
    { tag: "ci", value: d.host },
    ...(d.kind ? [{ tag: "device", value: d.kind }] : []),
  ];
  const macros = [];
  const interfaces = [];
  if (d.iface === "snmp") {
    const s = d.snmp;
    if (s.version === 2) {
      macros.push({ macro: "{$SNMP_COMMUNITY}", value: s.community, type: 1 });
      interfaces.push({ type: 2, main: 1, useip: isIpLike(d.address) ? 1 : 0, ip: isIpLike(d.address) ? d.address : "", dns: isIpLike(d.address) ? "" : d.address,
        port: String(d.port), details: { version: 2, bulk: 1, community: "{$SNMP_COMMUNITY}" } });
    } else {
      macros.push(
        { macro: "{$SNMPV3.USER}", value: s.user, type: 0 },
        { macro: "{$SNMPV3.AUTH}", value: s.authPass, type: 1 },
        { macro: "{$SNMPV3.PRIV}", value: s.privPass, type: 1 },
      );
      interfaces.push({ type: 2, main: 1, useip: isIpLike(d.address) ? 1 : 0, ip: isIpLike(d.address) ? d.address : "", dns: isIpLike(d.address) ? "" : d.address,
        port: String(d.port), details: { version: 3, bulk: 1, securityname: "{$SNMPV3.USER}", securitylevel: 2,
          authprotocol: s.authProtocol, authpassphrase: "{$SNMPV3.AUTH}", privprotocol: s.privProtocol, privpassphrase: "{$SNMPV3.PRIV}", contextname: s.context } });
    }
  } else if (d.iface === "ping") {
    interfaces.push({ type: 1, main: 1, useip: isIpLike(d.address) ? 1 : 0, ip: isIpLike(d.address) ? d.address : "", dns: isIpLike(d.address) ? "" : d.address, port: "10050" });
  }
  const common = { name: d.name, groups: [{ groupid }], templates: [{ templateid }], tags, monitored_by: 1, proxyid };
  const existing = existingHosts.get(d.host);
  if (existing) {
    // Secret macros are write-only in Zabbix; re-send them so a corrected
    // credential in the inventory takes effect.
    await zbx("host.update", { hostid: existing.hostid, ...common, ...(macros.length ? { macros } : {}) });
    if (interfaces.length) {
      const [cur] = await zbx("hostinterface.get", { hostids: [existing.hostid], output: ["interfaceid"], filter: { main: 1, type: interfaces[0].type } });
      if (cur) await zbx("hostinterface.update", { interfaceid: cur.interfaceid, ...interfaces[0] });
    }
    log(`Zabbix host ${d.host} updated`);
  } else {
    await zbx("host.create", { host: d.host, ...common, interfaces, macros });
    log(`Zabbix host ${d.host} created`);
  }
}

// ------------------------------------------------------------------ 4. client bundle
mkdirSync(BUNDLE, { recursive: true });
writeFileSync(
  envPath,
  [
    "# JSAN OpsDesk monitoring — proxy settings for this client site.",
    "# SECRET: contains the proxy's encryption key. Send it through a secure channel, never plain email.",
    `ZBX_SERVER=${serverHost}`,
    `ZBX_SERVER_PORT=${serverPort}`,
    `PROXY_NAME=${PROXY}`,
    `PSK_IDENTITY=${PROXY}`,
    `PSK=${psk}`,
    `PROXY_LISTEN_PORT=${listenPort}`,
    `INSTALL_AGENT=${withProxyAgent ? "yes" : "no"}`,
    `AGENT_HOSTNAME=${PROXY_VM}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
copyFileSync(join(KIT_DIR, "client", "install-proxy.sh"), join(BUNDLE, "install-proxy.sh"));
const agentServers = devices.filter((d) => d.iface === "agent-active" && d.host !== PROXY_VM);
writeFileSync(join(BUNDLE, "CLIENT-README.txt"), clientReadme(agentServers));
writeFileSync(
  join(BUNDLE, "onboarding-summary.json"),
  JSON.stringify({ site: SITE, name: args.name, proxy: PROXY, server: `${serverHost}:${serverPort}`, generatedAt: new Date().toISOString(),
    devices: devices.map(({ host, type, template, ciType, address, port }) => ({ host, type, template, ciType, address, port })) }, null, 2),
);
console.log(`\nDone. Client bundle: ${BUNDLE}`);
console.log("  proxy.env         SECRET — send through a secure channel");
console.log("  install-proxy.sh  the client runs: sudo bash install-proxy.sh proxy.env");
console.log("  CLIENT-README.txt instructions for the client");
console.log(`Then check: node tools/onboarding-kit/check-site.mjs --site ${SITE}`);

function isIpLike(a) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(a) || a.includes(":");
}

function clientReadme(servers) {
  return `JSAN OpsDesk monitoring — setup for ${args.name} (${SITE})
${"=".repeat(60)}

What this does
  A small "proxy" program on one Linux VM in your network checks your devices
  and sends the results to JSAN. It only connects OUT to JSAN (TCP ${serverPort} to
  ${serverHost}). You do not open any inbound port. It only READS from devices.

1. Prepare one Linux VM
   Ubuntu 22.04 / 24.04 or Debian 12 · 2 vCPU · 4 GB RAM · 40 GB disk ·
   static IP on your management network · always on.

2. Allow network traffic
   - From the VM to ${serverHost} TCP ${serverPort} (outbound)
   - From the VM to your devices: UDP 161 (SNMP) and ICMP (ping)
   - Nothing inbound is needed.

3. Enable READ-ONLY SNMP on each device, restricted to the VM's IP,
   using the credentials agreed with JSAN (SNMPv3 preferred).

4. Install
   Copy proxy.env and install-proxy.sh to the VM, then run:
       sudo bash install-proxy.sh proxy.env
   It checks the connection to JSAN, installs the proxy, and tells you if
   anything is wrong. Keep proxy.env private and delete it afterwards
   (the installer keeps its own copy of the key, readable only by Zabbix).
${servers.length ? `
5. Servers (optional, recommended)
   Install "Zabbix agent 2" on these servers in ACTIVE mode, pointing to the
   proxy VM on port ${listenPort}, with exactly this Hostname:
${servers.map((s) => `       ${s.host}   (${s.name})`).join("\n")}
   Example (Linux, /etc/zabbix/zabbix_agent2.conf):
       ServerActive=<proxy VM IP>:${listenPort}
       Server=<proxy VM IP>
       Hostname=<one of the names above>
` : ""}
Questions: contact the JSAN NOC.
`;
}
