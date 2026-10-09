// End-to-end smoke test for the client site lab:
//   fault on a simulated client device -> Zabbix proxy -> Zabbix server ->
//   OpsDesk webhook -> OpsDesk alert (and auto incident for Disaster) ->
//   acknowledge from OpsDesk -> recovery.
// Run on Windows with the API up:  node tools/client-site-lab/smoke.mjs [--quick]
// --quick skips the slow ISP ping scenario (~4 min).
import { execFileSync } from "node:child_process";

const API = process.env.OPSDESK_API ?? "http://127.0.0.1:3000/api/v1";
const DISTRO = process.env.WSL_DISTRO ?? "Ubuntu-24.04";
const PW = process.env.OPSDESK_DEMO_PASSWORD ?? "OpsDesk-Demo-2026!";
const QUICK = process.argv.includes("--quick");

const results = [];
const t0 = Date.now();
const secs = (from) => Math.round((Date.now() - from) / 1000);

function lab(...args) {
  return execFileSync("wsl", ["-d", DISTRO, "-u", "root", "--", "opsdesk-lab", ...args], { encoding: "utf8" }).trim();
}

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return (await r.json()).accessToken;
}

async function api(jwt, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

function record(id, label, ok, detail) {
  results.push({ id, label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id.padEnd(4)} ${label.padEnd(60)} ${detail}`);
}

/** Poll until fn() returns a truthy value or the timeout passes. */
async function waitFor(fn, timeoutS) {
  const start = Date.now();
  while (secs(start) < timeoutS) {
    const v = await fn();
    if (v) return { value: v, after: secs(start) };
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { value: null, after: secs(start) };
}

const ADMIN = await login("admin@example.com");
const ENG02 = await login("engineer@example.com"); // SITE_ENGINEER, SITE02 only
const NOC01 = await login("servicedesk@example.com"); // SERVICE_DESK_NOC, SITE01 only

async function alerts(ciCode) {
  const r = await api(ADMIN, "GET", `/alerts?ciCode=${ciCode}`);
  return r.body ?? [];
}
const findAlert = async (ciCode, pred) => (await alerts(ciCode)).find(pred);

console.log("Starting from a clean state…");
lab("reset");
await new Promise((r) => setTimeout(r, 45000)); // let any old faults recover

// --- Visibility (site scoping) -------------------------------------------
{
  const eng = await api(ENG02, "GET", "/monitoring/zabbix/hosts");
  const site02 = (eng.body?.items ?? []).filter((h) => h.siteCode === "SITE02");
  record("V1", "SITE02 engineer sees the 5 client devices", site02.length === 5, `${site02.length} hosts`);
  const noc = await api(NOC01, "GET", "/monitoring/zabbix/hosts");
  const leak = (noc.body?.items ?? []).filter((h) => h.siteCode === "SITE02");
  record("V2", "SITE01 NOC cannot see SITE02 devices", noc.status === 200 && leak.length === 0, `${leak.length} SITE02 hosts`);
  const up = site02.filter((h) => h.availability === "UP").map((h) => h.host).sort();
  record("V3", "Proxy-monitored devices report UP", up.length >= 4, up.join(", "));
}

// --- UPS on battery -> HIGH alert --------------------------------------
let start = Date.now();
lab("ups-on-battery");
let w = await waitFor(
  () => findAlert("SITE02-UPS-001", (a) => a.alertType === "ups.on_battery" && a.state === "OPEN" && Date.parse(a.lastSeenAt) >= start - 5000),
  150,
);
record("U1", "UPS on battery -> OpsDesk HIGH alert", w.value?.severity === "HIGH", w.value ? `after ${w.after}s, ${w.value.severity}` : `none after ${w.after}s`);
record("U2", "On-battery alert does NOT open a ticket", w.value && !w.value.correlatedIncidentId, w.value?.correlatedIncidentId ?? "no incident");

// --- Battery low -> CRITICAL alert + auto incident ---------------------
start = Date.now();
lab("ups-battery-low");
w = await waitFor(
  () => findAlert("SITE02-UPS-001", (a) => a.alertType === "ups.battery_low" && a.state === "OPEN" && a.correlatedIncidentId),
  150,
);
record("U3", "Battery low -> CRITICAL alert with an auto-created incident", w.value?.severity === "CRITICAL", w.value ? `after ${w.after}s` : `none after ${w.after}s`);
let incident = null;
if (w.value) {
  incident = (await api(ADMIN, "GET", `/incidents/${w.value.correlatedIncidentId}`)).body;
  record("U4", "Incident is P1 on SITE02-UPS-001", incident?.priority === "P1", `${incident?.incidentNo ?? incident?.id} ${incident?.priority} ${incident?.status}`);
}

// --- Acknowledge from OpsDesk -> Zabbix -> back to the OpsDesk alert ---
{
  const probs = await api(ENG02, "GET", "/monitoring/zabbix/problems");
  const p = (probs.body?.items ?? []).find((x) => x.host?.host === "SITE02-UPS-001" && x.name.startsWith("UPS battery is low"));
  record("A1", "Problem visible on the OpsDesk Zabbix page (SITE02 engineer)", Boolean(p), p ? `${p.severityLabel}: ${p.name}` : "missing");
  if (p) {
    const ack = await api(ENG02, "POST", `/monitoring/zabbix/problems/${p.eventId}/acknowledge`, { message: "Smoke test: engineer dispatched" });
    record("A2", "SITE02 engineer acknowledges it from OpsDesk", ack.status === 201, `HTTP ${ack.status}`);
    w = await waitFor(() => findAlert("SITE02-UPS-001", (a) => a.alertType === "ups.battery_low" && a.state === "ACKNOWLEDGED"), 90);
    record("A3", "Zabbix echoes the ack back: OpsDesk alert ACKNOWLEDGED", Boolean(w.value), w.value ? `after ${w.after}s` : `not after ${w.after}s`);
  }
}

// --- Mains restored -> both alerts recover ------------------------------
lab("ups-normal");
w = await waitFor(async () => {
  const list = await alerts("SITE02-UPS-001");
  const bat = list.find((a) => a.alertType === "ups.on_battery");
  const low = list.find((a) => a.alertType === "ups.battery_low");
  return bat?.state === "RECOVERED" && low?.state === "RECOVERED" ? true : null;
}, 150);
record("U5", "Mains back -> both UPS alerts RECOVERED", Boolean(w.value), `after ${w.after}s`);

// --- Firewall WAN link down -> HIGH alert, then recovery ----------------
start = Date.now();
lab("wan-down");
w = await waitFor(
  () => findAlert("SITE02-FW-001", (a) => /ifOperStatus\.1\]|link_down|wan1/i.test(`${a.alertType} ${a.summary ?? ""}`) && a.state === "OPEN"),
  180,
);
record("F1", "Firewall wan1 down -> OpsDesk alert", Boolean(w.value), w.value ? `after ${w.after}s, ${w.value.severity}: ${w.value.summary}` : `none after ${w.after}s`);
lab("wan-up");
if (w.value) {
  const id = w.value.id;
  const r = await waitFor(async () => (await alerts("SITE02-FW-001")).find((a) => a.id === id && a.state === "RECOVERED"), 180);
  record("F2", "wan1 back up -> alert RECOVERED", Boolean(r.value), `after ${r.after}s`);
}

// --- ISP gateway stops answering ping (slow: 3 failed checks) -----------
if (!QUICK) {
  lab("isp-down");
  w = await waitFor(() => findAlert("SITE02-ISP-001", (a) => a.state === "OPEN"), 330);
  record("I1", "ISP gateway unreachable -> OpsDesk alert", Boolean(w.value), w.value ? `after ${w.after}s, ${w.value.severity}: ${w.value.summary}` : `none after ${w.after}s`);
  lab("isp-up");
  if (w.value) {
    const id = w.value.id;
    const r = await waitFor(async () => (await alerts("SITE02-ISP-001")).find((a) => a.id === id && a.state === "RECOVERED"), 240);
    record("I2", "ISP back -> alert RECOVERED", Boolean(r.value), `after ${r.after}s`);
  }
}

lab("reset");
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed, ${secs(t0)}s total${incident ? ` · test incident ${incident.incidentNo ?? incident.id} left open in OpsDesk` : ""}`);
process.exit(failed ? 1 : 0);
