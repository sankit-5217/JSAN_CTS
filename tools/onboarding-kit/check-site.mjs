// Go-live checklist for one onboarded site (read-only).
//   node tools/onboarding-kit/check-site.mjs --site SITE03
// Exit code 0 when every check passes (warnings allowed), 1 otherwise.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR, loadConfig, parseArgs } from "./lib/config.mjs";
import { opsdeskClient } from "./lib/opsdesk.mjs";
import { WEBHOOK_USER_GROUP, zabbixClient } from "./lib/zabbix.mjs";

const args = parseArgs(process.argv.slice(2));
const SITE = String(args.site ?? "").toUpperCase();
if (!SITE) { console.error("Usage: node check-site.mjs --site SITE03"); process.exit(2); }
const PROXY = `${SITE}-PROXY`;
const cfg = loadConfig();
const zbx = zabbixClient(cfg.zabbixUrl, cfg.zabbixToken);
const rows = [];
const check = (status, label, detail) => rows.push({ status, label, detail });
const now = Math.floor(Date.now() / 1000);

const summaryPath = join(OUT_DIR, SITE, "onboarding-summary.json");
const expected = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")).devices : null;

const [proxy] = await zbx("proxy.get", {
  filter: { name: [PROXY] },
  output: ["proxyid", "state", "lastaccess", "version", "compatibility", "operating_mode", "tls_accept"],
});
if (!proxy) {
  check("FAIL", "Proxy registered in Zabbix", `${PROXY} not found — run onboard-site.mjs`);
} else {
  check("PASS", "Proxy registered in Zabbix", `${PROXY} (active mode)`);
  check(proxy.tls_accept === "2" ? "PASS" : "FAIL", "Proxy link is encrypted (PSK only)", proxy.tls_accept === "2" ? "unencrypted connections refused" : `tls_accept=${proxy.tls_accept}`);
  const age = now - Number(proxy.lastaccess);
  const online = proxy.state === "2" && age < 120;
  check(online ? "PASS" : "FAIL", "Proxy is online", Number(proxy.lastaccess) ? `last seen ${age}s ago` : "never connected — has the client run install-proxy.sh?");
  if (!Number(proxy.lastaccess)) {
    check("SKIP", "Proxy version matches the server", "not connected yet");
  } else {
    const compat = { 0: "unknown", 1: "current", 2: "outdated (works, upgrade soon)", 3: "unsupported" }[proxy.compatibility] ?? proxy.compatibility;
    const v = Number(proxy.version);
    const pretty = v ? `${Math.floor(v / 10000)}.${Math.floor(v / 100) % 100}.${v % 100}` : "unknown";
    check(proxy.compatibility === "1" ? "PASS" : proxy.compatibility === "2" ? "WARN" : "FAIL", "Proxy version matches the server", `${pretty} — ${compat}`);
  }
}

const hosts = proxy
  ? await zbx("host.get", {
      proxyids: [proxy.proxyid],
      output: ["hostid", "host", "status", "active_available"],
      selectTags: ["tag", "value"],
      selectInterfaces: ["type", "available", "error"],
      selectHostGroups: ["groupid", "name"],
    })
  : [];
if (expected) {
  const missing = expected.filter((d) => !hosts.some((h) => h.host === d.host)).map((d) => d.host);
  check(missing.length ? "FAIL" : "PASS", "Every inventory device exists in Zabbix", missing.length ? `missing: ${missing.join(", ")}` : `${expected.length} of ${expected.length}`);
}
const untagged = hosts.filter((h) => h.tags.find((t) => t.tag === "site")?.value !== SITE || !h.tags.some((t) => t.tag === "ci"));
check(untagged.length ? "FAIL" : "PASS", `Every host tagged site=${SITE} and ci`, untagged.length ? untagged.map((h) => h.host).join(", ") : `${hosts.length} hosts`);

for (const h of hosts) {
  const items = await zbx("item.get", { hostids: [h.hostid], output: ["lastclock", "state"], monitored: true });
  const withData = items.filter((i) => i.lastclock !== "0").length;
  const unsupported = items.filter((i) => i.state === "1").length;
  let reach;
  if (h.interfaces.length) {
    const states = h.interfaces.map((i) => i.available);
    reach = states.includes("2") ? "DOWN" : states.includes("1") ? "UP" : "UNKNOWN";
    // Ping-only hosts have an agent-type interface that is never polled; judge them by data.
    if (reach === "UNKNOWN" && withData > 0) reach = "UP";
  } else {
    reach = h.active_available === "1" ? "UP" : h.active_available === "2" ? "DOWN" : "UNKNOWN";
  }
  const err = h.interfaces.find((i) => i.error)?.error;
  const status = reach === "UP" && withData > 0 ? (unsupported > items.length / 2 ? "WARN" : "PASS") : "FAIL";
  check(status, `Device ${h.host} collecting`, `${reach}, ${withData}/${items.length} items with data${unsupported ? `, ${unsupported} unsupported` : ""}${err ? ` — ${err}` : ""}`);
}

// The webhook user must be able to read this site's hosts, or no alert reaches OpsDesk.
const [ug] = await zbx("usergroup.get", { filter: { name: [WEBHOOK_USER_GROUP] }, output: ["usrgrpid"], selectHostGroupRights: ["id", "permission"] });
const groupIds = new Set(hosts.flatMap((h) => h.hostgroups.map((g) => g.groupid)));
const readable = ug ? [...groupIds].every((id) => ug.hostgroup_rights.some((r) => r.id === id && Number(r.permission) >= 2)) : false;
check(readable ? "PASS" : "FAIL", "Alerts for this site can reach OpsDesk", readable ? "webhook user can read every host group of the site" : "webhook user cannot read this site's hosts — run onboard-site.mjs again");

const ops = await opsdeskClient(cfg.opsdeskApi, cfg.adminEmail, cfg.adminPassword);
const site = await ops.findSite(SITE);
check(site ? "PASS" : "FAIL", "Site exists in OpsDesk", site ? `${site.code} — ${site.name}` : "missing");
if (site) {
  const missingCi = [];
  for (const h of hosts) {
    const ci = await ops.findCi(h.host);
    if (!ci || ci.siteId !== site.id) missingCi.push(h.host);
  }
  check(missingCi.length ? "FAIL" : "PASS", "Every device has a CMDB record at this site", missingCi.length ? `missing: ${missingCi.join(", ")}` : `${hosts.length} records`);
  const view = await ops.call("GET", "/monitoring/zabbix/hosts");
  const visible = (view.items ?? []).filter((h) => h.siteCode === SITE).length;
  check(visible === hosts.length ? "PASS" : "FAIL", "OpsDesk Zabbix page shows the site", `${visible} of ${hosts.length} hosts visible`);
}

const width = Math.max(...rows.map((r) => r.label.length));
console.log(`Go-live checklist for ${SITE}\n`);
for (const r of rows) console.log(`${r.status.padEnd(5)} ${r.label.padEnd(width)}  ${r.detail}`);
const failed = rows.filter((r) => r.status === "FAIL").length;
const warned = rows.filter((r) => r.status === "WARN").length;
console.log(`\n${rows.length - failed - warned} passed, ${warned} warning(s), ${failed} failed`);
process.exit(failed ? 1 : 0);
