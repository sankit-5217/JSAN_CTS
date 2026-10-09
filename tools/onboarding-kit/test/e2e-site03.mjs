// TEST ONLY: end-to-end check of a site onboarded with the kit (SITE03 demo).
//   node tools/onboarding-kit/test/e2e-site03.mjs
// Needs: the jsan-client-site03 WSL machine with demo devices + installed proxy, API on :3000.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KIT_DIR, OUT_DIR, loadConfig } from "../lib/config.mjs";

const CLIENT = process.env.CLIENT_DISTRO ?? "jsan-client-site03";
const cfg = loadConfig();
const API = cfg.opsdeskApi;
const FAULT = "/mnt/c" + join(KIT_DIR, "test", "demo-fault.sh").slice(2).replace(/\\/g, "/");
const results = [];
const secs = (t) => Math.round((Date.now() - t) / 1000);

const fault = (...a) => execFileSync("wsl", ["-d", CLIENT, "-u", "root", "--", "bash", FAULT, ...a], { encoding: "utf8" }).trim();
async function login(email, password = "OpsDesk-Demo-2026!") {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return (await r.json()).accessToken;
}
async function get(jwt, path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
  return { status: r.status, body: await r.json() };
}
function record(id, label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${id.padEnd(3)} ${label.padEnd(58)} ${detail}`);
}
async function waitFor(fn, timeoutS) {
  const t = Date.now();
  while (secs(t) < timeoutS) {
    const v = await fn();
    if (v) return { v, after: secs(t) };
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { v: null, after: secs(t) };
}

const ADMIN = await login(cfg.adminEmail, cfg.adminPassword);
const NOC01 = await login("servicedesk@example.com"); // SITE01 only
const alerts = async (ci) => (await get(ADMIN, `/alerts?ciCode=${ci}`)).body ?? [];

// Idempotency: onboarding twice changes nothing and keeps the key.
{
  const before = readFileSync(join(OUT_DIR, "SITE03", "proxy.env"), "utf8");
  const out = execFileSync("node", [join(KIT_DIR, "onboard-site.mjs"), "--site", "SITE03", "--name", "Acme Pune office (test)",
    "--timezone", "Asia/Kolkata", "--server", "127.0.0.1:10051", "--proxy-listen-port", "10063",
    "--inventory", join(KIT_DIR, "test", "site03-demo-inventory.csv")], { encoding: "utf8" });
  const after = readFileSync(join(OUT_DIR, "SITE03", "proxy.env"), "utf8");
  const created = (out.match(/ created/g) ?? []).length;
  record("R1", "Re-running onboarding creates nothing new", created === 0, `${created} 'created' lines`);
  record("R2", "Re-running onboarding keeps the proxy key", before === after && !out.includes("NEW key"), before === after ? "key unchanged" : "KEY CHANGED");
}

// Scoping.
{
  const noc = await get(NOC01, "/monitoring/zabbix/hosts");
  const leak = (noc.body.items ?? []).filter((h) => h.siteCode === "SITE03").length;
  record("S1", "SITE01 user cannot see SITE03 devices", noc.status === 200 && leak === 0, `${leak} visible`);
}

fault("ups-normal");
fault("isp-up");
await new Promise((r) => setTimeout(r, 40000));

let t = Date.now();
fault("ups-on-battery");
let w = await waitFor(async () => (await alerts("SITE03-UPS-001")).find((a) => a.alertType === "ups.on_battery" && a.state === "OPEN" && Date.parse(a.lastSeenAt) >= t - 5000), 150);
record("U1", "SITE03 UPS on battery -> OpsDesk HIGH alert (via SNMPv3)", w.v?.severity === "HIGH", w.v ? `after ${w.after}s` : `none after ${w.after}s`);
const siteOk = w.v ? (await get(ADMIN, `/sites?limit=200`)).body.items?.find((s) => s.id === w.v.siteId)?.code === "SITE03" : false;
record("U2", "Alert is filed under site SITE03", siteOk, siteOk ? "SITE03" : "wrong or no site");

fault("ups-battery-low");
w = await waitFor(async () => (await alerts("SITE03-UPS-001")).find((a) => a.alertType === "ups.battery_low" && a.state === "OPEN" && a.correlatedIncidentId), 150);
record("U3", "Battery low -> CRITICAL alert + automatic incident", w.v?.severity === "CRITICAL", w.v ? `after ${w.after}s` : `none after ${w.after}s`);
if (w.v) {
  const inc = (await get(ADMIN, `/incidents/${w.v.correlatedIncidentId}`)).body;
  record("U4", "Incident is P1 at SITE03", inc.priority === "P1" && inc.siteId === w.v.siteId, `${inc.incidentNo} ${inc.priority}`);
}

fault("ups-normal");
w = await waitFor(async () => {
  const l = await alerts("SITE03-UPS-001");
  return ["ups.on_battery", "ups.battery_low"].every((k) => l.find((a) => a.alertType === k)?.state === "RECOVERED") || null;
}, 150);
record("U5", "Mains back -> UPS alerts RECOVERED", Boolean(w.v), `after ${w.after}s`);

// A problem still open from an earlier run would swallow this one (same
// event, no new notification), so start only once the link is clean.
const clean = await waitFor(async () => !(await alerts("SITE03-ISP-001")).some((a) => a.state !== "RECOVERED") || null, 240);
record("I0", "No ISP alert left open before the test", Boolean(clean.v), `after ${clean.after}s`);
t = Date.now();
fault("isp-down");
w = await waitFor(async () => (await alerts("SITE03-ISP-001")).find((a) => a.state === "OPEN" && Date.parse(a.lastSeenAt) >= t - 5000), 330);
record("I1", "SITE03 ISP unreachable -> OpsDesk alert", Boolean(w.v), w.v ? `after ${w.after}s, ${w.v.severity}` : `none after ${w.after}s`);
fault("isp-up");
if (w.v) {
  const id = w.v.id;
  const r = await waitFor(async () => (await alerts("SITE03-ISP-001")).find((a) => a.id === id && a.state === "RECOVERED"), 240);
  record("I2", "ISP back -> alert RECOVERED", Boolean(r.v), `after ${r.after}s`);
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
