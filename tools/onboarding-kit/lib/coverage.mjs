// Site inventory workbook → Zabbix monitoring coverage plan.
//
// For every inventory row: can Zabbix watch it in real time, and how?
//   direct — it gets its own Zabbix host (template(s) + interface), checked every minute;
//   via    — it has no network interface of its own, but another monitored
//            device reports on it (a UPS battery through the UPS, a disk through iDRAC);
//   none   — nothing can watch it (cables, furniture, USB peripherals); inventory only.
// Rules are explicit and ordered; a row no rule matches is "unknown" and fails
// the rubric (docs/runbooks/inventory-monitoring-coverage.md) instead of being guessed.
import { DEVICE_TYPES } from "./inventory.mjs";

/** The workbook's columns, matched by header text (order may differ per sheet). */
export const SHEET_COLUMNS = {
  inventoryNumber: "inventory number",
  category: "category",
  name: "inventory item name",
  quantity: "quantity",
  model: "inventory model number",
  serial: "item serial number",
  location: "item located at",
  status: "status",
  owner: "owner",
  barcode: "jsan_barcode sticker created & attached",
  remark: "remark",
};

/** Categories used in the workbook. Anything else stops the report. */
export const CATEGORIES = [
  "Server", "Network", "Power", "Monitor", "Peripheral", "CCTV", "AC", "Computer",
  "Printer", "Scanner", "Storage", "Access Control", "Rack", "Cable", "Furniture",
];

export const STATUSES = { inuse: "InUse", instock: "InStock", nouse: "NoUse" };

/** Owner that means "ours"; anything else is third-party equipment (e.g. an ISP's router). */
export const JSAN_OWNER = "JSAN";

/** Collapse NBSPs, line breaks and runs of spaces; trim. */
export function clean(value) {
  return String(value ?? "").replace(/[ \s]+/g, " ").trim();
}

const EMPTY = new Set(["", "na", "n/a", "nan", "-"]);
const blank = (v) => EMPTY.has(clean(v).toLowerCase());

/**
 * Where an item sits, as a Zabbix tag value: the site prefix dropped
 * ("SA Server Room" → "Server Room"), underscores as spaces. Null when unknown.
 */
export function normalizeLocation(raw, siteCode) {
  let loc = clean(raw).replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (blank(loc)) return null;
  if (siteCode && loc.toUpperCase().startsWith(`${siteCode} `)) loc = loc.slice(siteCode.length + 1);
  return loc;
}

/** The room an item is in, for grouping: Server Room, Desk Room, Office, Storage. */
export function areaOf(location) {
  if (!location) return null;
  if (/server/i.test(location)) return "Server Room";
  if (/desk/i.test(location)) return "Desk Room";
  if (/office/i.test(location)) return "Office";
  if (/storage/i.test(location)) return "Storage";
  return location;
}

const d = (deviceType, signals, extra = {}) => ({ coverage: "direct", deviceType, signals, ...extra });
const via = (parent, signals, extra = {}) => ({ coverage: "via", parent, signals, ...extra });
const none = (reason, extra = {}) => ({ coverage: "none", reason, ...extra });

/**
 * What each direct plan claims Zabbix watches. Each signal names a pattern
 * that must match an item, item prototype or trigger in the plan's templates
 * on the live Zabbix server (rubric M5), so a claim can't drift from reality.
 */
export const SIGNALS = {
  reachable: { label: "Up/down (ICMP ping, every 1 min)", pattern: /ICMP ping/i },
  snmpUp: { label: "SNMP reachable (every 1 min)", pattern: /SNMP (agent availability|data collection)/i },
  agentUp: { label: "Agent reachable (every 1 min)", pattern: /Active agent availability|agent ping/i },
  restart: { label: "Restarts", pattern: /(restarted|uptime)/i },
  firmware: { label: "Firmware / OS version changes", pattern: /(firmware|version|operating system).*(changed|has changed)|(firmware|software) version/i },
  interfaces: { label: "Port up/down and traffic", pattern: /Interface .*: (Operational status|Bits received|Bits sent)/i },
  cpuMem: { label: "CPU and memory", pattern: /CPU utili[sz]ation|Memory utili[sz]ation/i },
  hwStatus: { label: "Overall hardware health", pattern: /System status|Overall system health/i },
  disks: { label: "Physical / virtual disk health", pattern: /(Physical|Virtual) disk \[.*\]: (Status|S\.M\.A\.R\.T)/i },
  fans: { label: "Fans", pattern: /Fan \[/i },
  psu: { label: "Power supplies", pattern: /Power supply \[.*\]: (State|Status)/i },
  temperature: { label: "Device temperature", pattern: /temperature/i },
  roomTemperature: { label: "Room (inlet) temperature from the server's sensors", pattern: /^Probe \[.*\]: Value$/ },
  ups: { label: "On battery, load, input voltage", pattern: /on battery|Output load|input voltage/i },
  battery: { label: "Battery capacity, runtime, replacement", pattern: /Battery (needs replacement|has low capacity|capacity|runtime)/i },
  vpn: { label: "VPN tunnels", pattern: /VPN/i },
  sessions: { label: "Active sessions", pattern: /Active sessions/i },
  camera: { label: "Per-channel video stream (resolution, frame rate)", pattern: /^Channel .*: (Resolution (width|height)|Frame rate)/ },
  services: { label: "Services, disks, memory", pattern: /Filesystem|FS \[|Memory utilization|Number of processes/i },
  osVersion: { label: "OS version (alert when it changes)", pattern: /Operating system description has changed/i },
  packages: { label: "Installed packages count (alert when it changes)", pattern: /Number of installed packages/i },
  osServices: { label: "Windows services / running processes", pattern: /State of service|Number of processes/i },
  sysDescr: { label: "Firmware text in the system description (no change alert)", pattern: /^System description$/ },
};

/**
 * Ordered rules: first match wins. `match` sees the cleaned row; `plan` may
 * look at it too (owner, status). Specific products come before category defaults.
 */
export const RULES = [
  // ---- third-party network equipment (the ISP's router in our rack) ------------------
  {
    id: "isp-cpe",
    match: (r) => r.category === "Network" && /mikrotik|router|ccr\d/i.test(r.text) && !r.ownedByJsan,
    plan: (r) => d("isp-link", ["reachable"], {
      why: `Owned by ${r.owner} (the ISP's router): watched as the ISP link — ping loss and latency to it from the site proxy. Full SNMP only if ${r.owner} grants read access.`,
    }),
  },
  // ---- servers ----------------------------------------------------------------------
  {
    id: "server-dell",
    match: (r) => r.category === "Server" && /dell|poweredge|r\d{3,4}\b/i.test(r.text),
    plan: () => d("server-idrac", ["snmpUp", "hwStatus", "disks", "fans", "psu", "roomTemperature", "firmware", "restart"], {
      also: "Install the OS agent with the one-line installer too (CPU, memory, filesystems, services).",
    }),
  },
  { id: "server-other", match: (r) => r.category === "Server", plan: () => d("server-linux", ["agentUp", "services"]) },
  // ---- network ----------------------------------------------------------------------
  {
    id: "firewall-fortigate",
    match: (r) => /fortigate|\bFG-?\d{2,4}[A-Z]?\b|firewall/i.test(r.text),
    plan: () => d("firewall-fortigate", ["reachable", "snmpUp", "cpuMem", "interfaces", "vpn", "sessions", "firmware"]),
  },
  {
    id: "router-mikrotik",
    match: (r) => /mikrotik|\bccr\d/i.test(r.text),
    plan: (r) => d("router-mikrotik", ["reachable", "snmpUp", "cpuMem", "interfaces", "temperature", "firmware"], {
      template: mikrotikTemplate(r.text),
    }),
  },
  {
    id: "ups-nmc",
    match: (r) => /network management card|\bAP96\d\d\b/i.test(r.text),
    plan: () => via("ups", ["ups", "battery"], {
      why: "It is the UPS's network card: the UPS is monitored through it (its address is the UPS host's SNMP address).",
    }),
  },
  { id: "kvm", match: (r) => /\bkvm\b/i.test(r.text) && r.category !== "Cable", plan: () => none("Local KVM switch (USB/VGA) — no network interface.") },
  {
    id: "sfp",
    match: (r) => /\bsfp\b/i.test(r.text) && r.category !== "Cable",
    plan: () => via("network", ["interfaces"], {
      why: "An optic plugged into a router/firewall/server port: watched as that port's link status and errors.",
    }),
  },
  {
    id: "wifi-ap",
    match: (r) => /access point|\bEAP\d+|\bRG-AP|wi-?fi ?\d? .*access/i.test(r.text),
    plan: () => d("wifi-ap", ["reachable", "snmpUp", "interfaces", "restart"]),
  },
  {
    id: "lte-hotspot",
    match: (r) => /\b(4g|lte|5g)\b.*(wi-?fi|hotspot|router)|\bM7350\b/i.test(r.text),
    plan: () => d("lte-hotspot", ["reachable"], {
      gap: "Ping shows the hotspot is powered and on the LAN; its mobile signal/uplink needs the vendor web API (not covered).",
    }),
  },
  { id: "poe-injector", match: (r) => /poe injector/i.test(r.text), plan: () => none("Passive PoE injector — no management interface.") },
  // ---- power ------------------------------------------------------------------------
  {
    id: "ups-battery",
    match: (r) => r.category === "Power" && /battery|\bSRT\d+BP\b|\bBP\b/i.test(r.text),
    plan: () => via("ups", ["battery"], { why: "External battery pack: its capacity, runtime, temperature and replace-battery alarm come from the UPS." }),
  },
  {
    id: "ups-apc",
    match: (r) => r.category === "Power" && /\bups\b|smart-?ups|\bSRT ?\d|\bSMT\d|\bSMX\d/i.test(r.text),
    plan: () => d("ups-apc", ["snmpUp", "ups", "battery", "temperature", "restart"], {
      needs: "The UPS's network management card (AP9640/AP9641) — its IP is the host address.",
    }),
  },
  {
    id: "pdu-managed",
    match: (r) => r.category === "Power" && /pdu/i.test(r.text) && /\bAP(79|84|86|88|89)\d\d\b/i.test(r.text),
    plan: () => d("pdu", ["reachable", "snmpUp"]),
  },
  {
    id: "pdu-basic",
    match: (r) => r.category === "Power" && /pdu/i.test(r.text),
    plan: () => none("Basic (unmetered, unswitched) rack PDU — no network card. Metered/switched models (AP79xx/AP86xx/AP88xx) can be monitored."),
  },
  // ---- CCTV and access control ------------------------------------------------------
  {
    id: "cctv-analog-camera",
    match: (r) => r.category === "CCTV" && /\bDS-2CE|turbo ?hd|analog/i.test(r.text),
    plan: () => via("cctv-recorder", ["reachable"], {
      why: "Analog (coax) camera: no network of its own; it is recorded by the DVR, which is monitored.",
      gap: "Per-camera video loss needs a custom ISAPI item on the DVR (not in the stock template).",
    }),
  },
  {
    id: "access-terminal",
    match: (r) => /face recognition|\bDS-K1T|zkteco|finger|access door/i.test(r.text),
    plan: () => d("access-control", ["reachable"], {
      gap: "Door events (forced, held open, denied) need the vendor SDK/ISAPI events — not covered; availability is.",
    }),
  },
  {
    id: "cctv-hikvision",
    match: (r) => r.category === "CCTV" && /hikvision|\bDS-2CD|\bDS-7\d|\biDS-7|\bnvr\b|\bdvr\b|ip camera/i.test(r.text),
    plan: () => d("cctv-hikvision", ["reachable", "camera", "cpuMem", "firmware", "restart"], {
      needs: "A read-only ISAPI user on the device (http_user/http_pass in the onboarding CSV).",
    }),
  },
  { id: "access-wired", match: (r) => r.category === "Access Control", plan: () => none("Wired door sensor / call point — reports to the door controller, no network of its own.") },
  // ---- end-user equipment -----------------------------------------------------------
  {
    id: "workstation",
    match: (r) => r.category === "Computer",
    plan: () => d("workstation-windows", ["agentUp", "services", "firmware"], {
      note: "Laptops leave the office: keep them LOW criticality so an offline laptop never opens a ticket.",
    }),
  },
  {
    id: "printer-network",
    match: (r) => r.category === "Printer" && !/barcode|label|thermal/i.test(r.text),
    plan: () => d("printer", ["reachable", "snmpUp", "restart"]),
  },
  { id: "printer-label", match: (r) => r.category === "Printer", plan: () => none("USB label/barcode printer — attached to a PC, no network interface.") },
  { id: "scanner", match: (r) => r.category === "Scanner", plan: () => none("USB/Bluetooth barcode scanner — attached to a PC.") },
  {
    id: "storage-disk",
    match: (r) => r.category === "Storage",
    plan: () => via("server", ["disks"], { why: "A drive: watched by the server's iDRAC (status, S.M.A.R.T.) once it is installed in a server." }),
  },
  {
    id: "ac",
    match: (r) => r.category === "AC",
    plan: () => via("room-temperature", ["roomTemperature"], {
      why: "Portable AC with no network: its effect is watched instead — the temperature reported by monitored equipment in the same room.",
    }),
  },
  { id: "monitor", match: (r) => r.category === "Monitor", plan: () => none("Display — passive, no network interface.") },
  { id: "rack", match: (r) => r.category === "Rack", plan: () => none("Passive rack enclosure.") },
  { id: "cable", match: (r) => r.category === "Cable", plan: () => none("Cable — passive. Network cables show up as port link status on the devices they connect.") },
  { id: "furniture", match: (r) => r.category === "Furniture", plan: () => none("Furniture / tools.") },
  { id: "peripheral", match: (r) => r.category === "Peripheral", plan: () => none("USB/Bluetooth peripheral or accessory — no network interface.") },
];

/** MikroTik ships per-model templates; fall back to the generic MikroTik one. */
export function mikrotikTemplate(text) {
  if (/CCR2004-16G-2S/i.test(text)) return "MikroTik CCR2004-16G-2S by SNMP";
  if (/CCR2004-1G-12S/i.test(text)) return "MikroTik CCR2004-1G-12S2XS by SNMP";
  return "Mikrotik by SNMP";
}

/** Which "via" parents each direct device type can stand in for. */
const PARENT_PROVIDERS = {
  ups: ["ups-apc"],
  server: ["server-idrac"],
  network: ["firewall-fortigate", "router-mikrotik"],
  "cctv-recorder": ["cctv-hikvision"],
  // Temperature in a room: a monitored device in that room with temperature sensors.
  "room-temperature": ["server-idrac"],
};

/** All templates a direct plan links (device type's, plus any rule override). */
export function templatesFor(plan) {
  const type = DEVICE_TYPES[plan.deviceType];
  if (!type) return [];
  return [plan.template ?? type.template, ...(type.extraTemplates ?? [])];
}

/** The three areas the coverage is reported in. Software lives on the hardware (see softwareLayers). */
export const DOMAINS = ["Hardware", "Networking", "Software"];

const NETWORK_RULES = new Set(["isp-cpe", "firewall-fortigate", "router-mikrotik", "sfp", "wifi-ap", "lte-hotspot", "poe-injector"]);
const NETWORK_CABLE = /\bcat ?\d|\bdac\b|direct attach|\bsfp|fib(er|re)|patch|twinax|ethernet|rj-?45|\bom\d\b/i;

/** Hardware or Networking for a physical item. */
export function domainOf(p) {
  if (NETWORK_RULES.has(p.rule)) return "Networking";
  if (p.rule === "cable" && NETWORK_CABLE.test(p.text ?? p.name ?? "")) return "Networking";
  return "Hardware";
}

/** OS agents for a server's operating system (the sheet doesn't say which OS). */
export const OS_AGENT_TEMPLATES = ["Linux by Zabbix agent active", "Windows by Zabbix agent active"];

/**
 * The software running on a monitored device — firmware/BIOS and operating
 * system — and how much of it Zabbix sees:
 *   direct  — version collected and an alert raised when it changes;
 *   partial — only the firmware text inside the SNMP system description;
 *   none    — not visible (ping-only devices), with the reason.
 */
export function softwareLayers(p) {
  const firmware = (coverage, extra) => ({ layer: "Firmware", coverage, ...extra });
  switch (p.deviceType) {
    case "server-idrac":
      return [
        firmware("direct", { templates: p.templates, signals: ["firmware"], how: "BIOS, iDRAC and firmware versions from iDRAC" }),
        {
          layer: "Operating system",
          coverage: "direct",
          templates: OS_AGENT_TEMPLATES,
          signals: ["agentUp", "osVersion", "services"],
          how: "Install the OS agent with the one-line installer (Linux or Windows): OS version, CPU, memory, filesystems, services",
        },
      ];
    case "workstation-windows":
    case "server-linux":
    case "server-windows":
      return [
        { layer: "Operating system", coverage: "direct", templates: p.templates, signals: ["agentUp", "osVersion", p.deviceType === "server-linux" ? "packages" : "osServices"], how: "OS agent" },
        firmware("none", { reason: "BIOS/firmware version is not collected by the OS agent template." }),
      ];
    case "firewall-fortigate":
    case "router-mikrotik":
    case "cctv-hikvision":
      return [firmware("direct", { templates: p.templates, signals: ["firmware"], how: "Firmware version, alert on change" })];
    case "ups-apc":
    case "wifi-ap":
    case "printer":
    case "pdu":
      return [firmware("partial", { templates: p.templates, signals: ["sysDescr"], how: "Firmware text in the SNMP system description; no change alert" })];
    default:
      return [firmware("none", { reason: "Up/down (ping) only: no firmware or software visibility." })];
  }
}

/** Hardware / Networking item counts, and Software layer counts. */
export function summarizeDomains(plans) {
  const out = Object.fromEntries(DOMAINS.map((d) => [d, { direct: 0, via: 0, partial: 0, none: 0, unknown: 0 }]));
  for (const p of plans) {
    if (p.coverage === "empty") continue;
    out[p.domain ?? "Hardware"][p.coverage] += 1;
    for (const sw of p.software ?? []) out.Software[sw.coverage] += 1;
  }
  return out;
}

/**
 * Rows of one sheet (first row = header) → cleaned item records.
 * @returns {{ items: object[], issues: object[], siteCode: string|null }}
 */
export function readSheet(sheet) {
  const issues = [];
  const siteCode = /^([A-Z]{2,5})_/.exec(sheet.name)?.[1] ?? null;
  const [header, ...body] = sheet.rows;
  if (!header) return { siteCode, items: [], issues: [{ sheet: sheet.name, level: "info", message: "Sheet is empty — no inventory yet" }] };
  const cols = {};
  const names = header.map((h) => clean(h).toLowerCase());
  for (const [key, title] of Object.entries(SHEET_COLUMNS)) {
    const i = names.indexOf(title);
    if (i >= 0) cols[key] = i;
    else if (["inventoryNumber", "category", "name"].includes(key)) {
      issues.push({ sheet: sheet.name, level: "error", message: `Missing column "${title}"` });
    }
  }
  if (issues.some((i) => i.level === "error")) return { siteCode, items: [], issues };

  const items = [];
  for (const row of body) {
    const get = (k) => (cols[k] === undefined ? "" : clean(row[cols[k]]));
    const rec = Object.fromEntries(Object.keys(SHEET_COLUMNS).map((k) => [k, get(k)]));
    if (Object.values(rec).every((v) => v === "")) continue; // formatting-only row
    rec.sheet = sheet.name;
    rec.row = row.row;
    rec.siteCode = siteCode;
    items.push(rec);
  }
  return { siteCode, items, issues };
}

/** Plan one cleaned item. */
export function planItem(rec) {
  const r = {
    ...rec,
    text: [rec.name, rec.model].filter(Boolean).join(" "),
    ownedByJsan: blank(rec.owner) || rec.owner.toUpperCase() === JSAN_OWNER,
    location: normalizeLocation(rec.location, rec.siteCode),
  };
  r.area = areaOf(r.location);
  r.statusRaw = rec.status;
  r.status = statusOf(rec.status);
  if (!rec.category && !rec.name) return { ...r, rule: "empty", coverage: "empty" };
  const rule = RULES.find((x) => CATEGORIES.includes(r.category) && x.match(r));
  if (!rule) return { ...r, rule: null, coverage: "unknown" };
  const plan = rule.plan(r);
  const out = { ...r, rule: rule.id, ...plan };
  out.domain = domainOf(out);
  if (plan.coverage === "direct") {
    out.templates = templatesFor(plan);
    out.tags = zabbixLocationTags(r);
    out.active = r.status === "InUse";
    out.software = softwareLayers(out);
  }
  return out;
}

/** InUse / InStock / NoUse, or null when blank / not recognised. */
export function statusOf(raw) {
  return STATUSES[clean(raw).toLowerCase().replace(/[\s_-]/g, "")] ?? null;
}

/** The tags a monitored item carries in Zabbix so every alert says where it is. */
export function zabbixLocationTags(r) {
  return [
    ...(r.location ? [{ tag: "location", value: r.location }] : []),
    ...(r.area ? [{ tag: "area", value: r.area }] : []),
    ...(r.inventoryNumber ? [{ tag: "inventory", value: r.inventoryNumber }] : []),
  ];
}

/**
 * The whole workbook → per-item plans, "via" parents resolved within each
 * site, and data-quality issues.
 */
export function planWorkbook(sheets) {
  const issues = [];
  const plans = [];
  for (const sheet of sheets) {
    const { items, issues: sheetIssues } = readSheet(sheet);
    issues.push(...sheetIssues);
    plans.push(...items.map((rec) => planItem({ ...rec, category: canonicalCategory(rec.category) })));
  }
  for (const p of plans) {
    if (p.coverage !== "via") continue;
    const providers = PARENT_PROVIDERS[p.parent] ?? [];
    const sameSite = plans.filter((q) => q.coverage === "direct" && q.siteCode === p.siteCode && providers.includes(q.deviceType));
    // Temperature is only meaningful from equipment in the same room.
    const candidates = p.parent === "room-temperature" ? sameSite.filter((q) => q.area && q.area === p.area) : sameSite;
    if (candidates.length) p.parentItems = candidates.map((q) => q.inventoryNumber);
    else {
      p.coverage = p.parent === "room-temperature" ? "none" : "via";
      p.gap = p.parent === "room-temperature"
        ? `No monitored equipment with a temperature sensor in ${p.area ?? "its room"} — add a temperature sensor (e.g. on the UPS network card) to watch this AC.`
        : `No monitored ${p.parent} at this site to report on it.`;
      if (p.parent === "room-temperature") p.reason = "Portable AC with no network and no monitored temperature sensor in its room.";
    }
  }
  issues.push(...dataQualityIssues(plans));
  return { plans, issues };
}

/** "Peripheral " / "access control" → "Peripheral" / "Access Control"; unknown kept as is. */
export function canonicalCategory(raw) {
  const c = clean(raw);
  return CATEGORIES.find((k) => k.toLowerCase() === c.toLowerCase()) ?? c;
}

/** Problems in the sheet that would weaken monitoring, warranty or audit. */
export function dataQualityIssues(plans) {
  const issues = [];
  const at = (p) => ({ sheet: p.sheet, row: p.row, item: p.inventoryNumber || "(no number)" });
  const serials = new Map();
  const numbers = new Map();
  for (const p of plans) {
    if (p.inventoryNumber) {
      if (numbers.has(p.inventoryNumber)) issues.push({ ...at(p), level: "error", message: `Inventory number repeated (row ${numbers.get(p.inventoryNumber)})` });
      else numbers.set(p.inventoryNumber, p.row);
      if (p.siteCode && !p.inventoryNumber.startsWith(`${p.siteCode}_`)) {
        issues.push({ ...at(p), level: "warning", message: `Inventory number does not start with "${p.siteCode}_"` });
      }
    }
    if (p.coverage === "empty") { issues.push({ ...at(p), level: "warning", message: "Numbered row with no item — remove it or fill it in" }); continue; }
    if (p.coverage === "unknown") {
      issues.push({ ...at(p), level: "error", message: CATEGORIES.includes(p.category) ? `No coverage rule matches "${p.name}"` : `Unknown category "${p.category}"` });
    }
    if (!p.category) issues.push({ ...at(p), level: "error", message: "Category is empty" });
    if (!p.status) {
      issues.push({ ...at(p), level: "warning", message: blank(p.statusRaw) ? "Status is empty" : `Status "${p.statusRaw}" is not InUse/InStock/NoUse` });
    }
    if (!p.location) issues.push({ ...at(p), level: "warning", message: "Location (Item Located At) is empty — alerts could not say where it is" });
    if (p.coverage === "direct") {
      if (!p.model) issues.push({ ...at(p), level: "warning", message: "Model is empty — needed to pick the exact Zabbix template and check firmware" });
      if (!p.serial) issues.push({ ...at(p), level: "warning", message: "Serial number is empty — needed for warranty and to spot a swapped device" });
    }
    if (p.serial && Number(p.quantity || 1) <= 1) {
      const key = p.serial.toUpperCase().replace(/\s/g, "");
      if (serials.has(key)) issues.push({ ...at(p), level: "warning", message: `Serial "${p.serial}" also on ${serials.get(key)} — truncated or copied?` });
      else serials.set(key, p.inventoryNumber);
    }
  }
  // Gaps in each site's numbering (TH_INV_0028 → TH_INV_0031).
  const bySite = new Map();
  for (const p of plans) {
    const m = /^([A-Z]+)_INV_(\d+)$/.exec(p.inventoryNumber ?? "");
    if (m) bySite.set(m[1], [...(bySite.get(m[1]) ?? []), Number(m[2])]);
  }
  for (const [site, nums] of bySite) {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] > 1) {
        const from = sorted[i - 1] + 1, to = sorted[i] - 1;
        const fmt = (n) => `${site}_INV_${String(n).padStart(4, "0")}`;
        issues.push({ sheet: site, level: "warning", message: `Numbering gap: ${from === to ? fmt(from) : `${fmt(from)}–${fmt(to)}`} missing` });
      }
    }
  }
  return issues;
}

/** Counts per site × coverage, and per category. */
export function summarize(plans) {
  const bySite = {};
  const byCategory = {};
  for (const p of plans) {
    if (p.coverage === "empty") continue;
    const s = (bySite[p.siteCode ?? "?"] ??= { direct: 0, via: 0, none: 0, unknown: 0, items: 0 });
    s[p.coverage] += 1;
    s.items += 1;
    const c = (byCategory[p.category || "(blank)"] ??= { direct: 0, via: 0, none: 0, unknown: 0 });
    c[p.coverage] += 1;
  }
  return { bySite, byCategory };
}
