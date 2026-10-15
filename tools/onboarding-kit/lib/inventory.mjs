// Client device inventory (CSV) -> validated device list.
// Validation is strict on purpose: a bad row stops onboarding before anything
// is created in Zabbix or OpsDesk.
import { isIP } from "node:net";

/**
 * Device types the kit knows. `iface`: how the proxy reaches the device.
 * `ciType` must be an OpsDesk CiType; kinds OpsDesk has no CI type for yet
 * (Wi-Fi, CCTV, access control) are stored as SERVICE with `deviceKind` in
 * the CI metadata.
 */
export const DEVICE_TYPES = {
  "firewall-fortigate": { template: "FortiGate by SNMP", ciType: "FIREWALL", iface: "snmp" },
  firewall: { template: "Network Generic Device by SNMP", ciType: "FIREWALL", iface: "snmp" },
  switch: { template: "Network Generic Device by SNMP", ciType: "SWITCH", iface: "snmp" },
  router: { template: "Network Generic Device by SNMP", ciType: "SWITCH", iface: "snmp", kind: "router" },
  ups: { template: "OpsDesk UPS-MIB by SNMP", ciType: "UPS", iface: "snmp" },
  pdu: { template: "Generic by SNMP", ciType: "PDU", iface: "snmp" },
  "wifi-controller": { template: "Generic by SNMP", ciType: "SERVICE", iface: "snmp", kind: "wifi-controller" },
  "cctv-nvr": { template: "Generic by SNMP", ciType: "SERVICE", iface: "snmp", kind: "cctv-nvr" },
  "access-control": { template: "ICMP Ping", ciType: "SERVICE", iface: "ping", kind: "access-control" },
  "isp-link": { template: "ICMP Ping", ciType: "CIRCUIT", iface: "ping" },
  "generic-snmp": { template: "Generic by SNMP", ciType: "SERVICE", iface: "snmp" },
  "ping-only": { template: "ICMP Ping", ciType: "SERVICE", iface: "ping" },
  "server-linux": { template: "Linux by Zabbix agent active", ciType: "SERVER", iface: "agent-active" },
  "server-windows": { template: "Windows by Zabbix agent active", ciType: "SERVER", iface: "agent-active" },
  // Added for the site inventory workbooks (see lib/coverage.mjs).
  "server-idrac": { template: "Dell iDRAC by SNMP", ciType: "SERVER", iface: "snmp", kind: "server-bmc" },
  "router-mikrotik": { template: "Mikrotik by SNMP", ciType: "SWITCH", iface: "snmp", kind: "router" },
  "ups-apc": { template: "APC UPS by SNMP", ciType: "UPS", iface: "snmp" },
  "wifi-ap": { template: "Network Generic Device by SNMP", ciType: "SERVICE", iface: "snmp", kind: "wifi-ap" },
  printer: { template: "Generic by SNMP", ciType: "SERVICE", iface: "snmp", kind: "printer" },
  "lte-hotspot": { template: "ICMP Ping", ciType: "CIRCUIT", iface: "ping", kind: "lte-backup" },
  // Hikvision's template has no up/down check of its own, so ICMP Ping goes with it.
  "cctv-hikvision": {
    template: "ICMP Ping",
    extraTemplates: ["Hikvision camera by HTTP"],
    ciType: "SERVICE",
    iface: "http",
    kind: "cctv",
  },
  "workstation-windows": { template: "Windows by Zabbix agent active", ciType: "SERVICE", iface: "agent-active", kind: "workstation" },
};

export const CRITICALITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
// Zabbix 7.0 SNMPv3 protocol codes.
const AUTH_PROTOCOLS = { MD5: 0, SHA1: 1, SHA224: 2, SHA256: 3, SHA384: 4, SHA512: 5 };
const PRIV_PROTOCOLS = { DES: 0, AES128: 1, AES192: 2, AES256: 3, AES192C: 4, AES256C: 5 };

const COLUMNS = [
  "host", "name", "type", "address", "port", "snmp_version", "snmp_community",
  "v3_user", "v3_auth_protocol", "v3_auth_pass", "v3_priv_protocol", "v3_priv_pass", "v3_context",
  "template", "manufacturer", "model", "criticality", "location",
  "http_user", "http_pass", "inventory_number",
];

/**
 * RFC 4180-ish CSV parser (quoted fields, doubled quotes, CRLF). Each returned
 * row carries `.line`, its 1-based line number in the file, so messages point
 * at the right line even with comments or blank lines in between.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false, line = 1, rowLine = 1;
  const endRow = () => {
    row.push(field); field = "";
    if (row.some((f) => f.trim() !== "")) { row.line = rowLine; rows.push(row); }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else { if (ch === "\n") line++; field += ch; }
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else field += ch;
  }
  endRow();
  return rows;
}

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * @returns {{ devices: object[], errors: string[], warnings: string[] }}
 */
export function validateInventory(text, siteCode) {
  const errors = [];
  const warnings = [];
  const rows = parseCsv(text.replace(/^﻿/, "")).filter((r) => !r[0]?.trim().startsWith("#"));
  if (rows.length < 2) return { devices: [], errors: ["Inventory has no device rows"], warnings };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  for (const required of ["host", "name", "type"]) {
    if (!header.includes(required)) errors.push(`Missing column "${required}"`);
  }
  const unknownCols = header.filter((h) => h && !COLUMNS.includes(h));
  if (unknownCols.length) errors.push(`Unknown column(s): ${unknownCols.join(", ")}`);
  if (errors.length) return { devices: [], errors, warnings };

  const seenHosts = new Set();
  const seenEndpoints = new Map();
  const devices = [];
  rows.slice(1).forEach((cells) => {
    const line = cells.line;
    const r = Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
    const where = `line ${line} (${r.host || "no host"})`;
    const err = (m) => errors.push(`${where}: ${m}`);
    const warn = (m) => warnings.push(`${where}: ${m}`);

    if (cells.length > header.length) err(`${cells.length} values but ${header.length} columns — quote values that contain commas`);
    if (!/^[A-Z0-9][A-Z0-9-]{1,62}$/.test(r.host)) err(`host must be UPPERCASE letters, digits and dashes (got "${r.host}")`);
    else if (!r.host.startsWith(`${siteCode}-`)) err(`host must start with "${siteCode}-" so it is unmistakably this client's`);
    if (seenHosts.has(r.host)) err("duplicate host");
    seenHosts.add(r.host);
    if (!r.name) err("name is empty");
    if (r.name.length > 128) err("name is longer than 128 characters");

    const type = DEVICE_TYPES[r.type];
    if (!type) {
      err(`unknown type "${r.type}" — one of: ${Object.keys(DEVICE_TYPES).join(", ")}`);
      return;
    }
    const criticality = (r.criticality || "MEDIUM").toUpperCase();
    if (!CRITICALITIES.includes(criticality)) err(`criticality must be one of ${CRITICALITIES.join(", ")}`);

    const dev = {
      host: r.host,
      name: r.name,
      type: r.type,
      template: r.template || type.template,
      extraTemplates: type.extraTemplates ?? [],
      ciType: type.ciType,
      kind: type.kind ?? null,
      iface: type.iface,
      manufacturer: r.manufacturer || null,
      model: r.model || null,
      criticality,
      location: r.location || null,
      inventoryNumber: r.inventory_number || null,
    };

    if (type.iface === "agent-active") {
      if (r.address) warn("address is ignored for active-agent servers (the agent connects to the proxy)");
      dev.note = `Set Hostname=${r.host} in the agent config on that server`;
    } else {
      if (!r.address) err("address is required");
      else if (!isIP(r.address) && !HOSTNAME_RE.test(r.address)) err(`address "${r.address}" is not an IP or hostname`);
      dev.address = r.address;
    }

    if (type.iface === "snmp") {
      const port = r.port ? Number(r.port) : 161;
      if (!Number.isInteger(port) || port < 1 || port > 65535) err(`port "${r.port}" is not valid`);
      dev.port = port;
      const version = r.snmp_version || "3";
      if (version === "2" || version === "2c") {
        if (!r.snmp_community) err("snmp_community is required for SNMP v2c");
        if (r.snmp_community === "public" || r.snmp_community === "private") {
          warn(`community "${r.snmp_community}" is a well-known default — ask the client for a unique read-only community`);
        }
        warn("SNMP v2c is unencrypted — prefer SNMPv3 (authPriv) where the device supports it");
        dev.snmp = { version: 2, community: r.snmp_community };
      } else if (version === "3") {
        const auth = (r.v3_auth_protocol || "SHA256").toUpperCase();
        const priv = (r.v3_priv_protocol || "AES128").toUpperCase();
        if (!r.v3_user) err("v3_user is required for SNMPv3");
        if (!(auth in AUTH_PROTOCOLS)) err(`v3_auth_protocol must be one of ${Object.keys(AUTH_PROTOCOLS).join(", ")}`);
        if (!(priv in PRIV_PROTOCOLS)) err(`v3_priv_protocol must be one of ${Object.keys(PRIV_PROTOCOLS).join(", ")}`);
        if ((r.v3_auth_pass ?? "").length < 8) err("v3_auth_pass must be at least 8 characters");
        if ((r.v3_priv_pass ?? "").length < 8) err("v3_priv_pass must be at least 8 characters");
        if (["MD5", "SHA1"].includes(auth)) warn(`${auth} is weak — prefer SHA256 or stronger`);
        if (priv === "DES") warn("DES is weak — prefer AES128 or stronger");
        dev.snmp = {
          version: 3,
          user: r.v3_user,
          authProtocol: AUTH_PROTOCOLS[auth],
          authPass: r.v3_auth_pass,
          privProtocol: PRIV_PROTOCOLS[priv],
          privPass: r.v3_priv_pass,
          // SNMPv3 context name; empty for most devices, required by some (and by snmpsim).
          context: r.v3_context || "",
        };
      } else {
        err(`snmp_version must be 2c or 3 (got "${r.snmp_version}")`);
      }
      const endpoint = `${r.address}:${port}`;
      if (seenEndpoints.has(endpoint)) err(`same address and port as ${seenEndpoints.get(endpoint)}`);
      seenEndpoints.set(endpoint, r.host);
    } else if (r.snmp_community || r.v3_user) {
      warn(`SNMP credentials are ignored for type "${r.type}"`);
    }

    if (type.iface === "http") {
      // Read-only device API user (e.g. Hikvision ISAPI); the password is a Zabbix secret macro.
      const port = r.port ? Number(r.port) : 80;
      if (!Number.isInteger(port) || port < 1 || port > 65535) err(`port "${r.port}" is not valid`);
      if (!r.http_user) err("http_user is required (a read-only user on the device)");
      if ((r.http_pass ?? "").length < 8) err("http_pass must be at least 8 characters");
      if (r.http_user === "admin") warn('http_user "admin" — create a separate read-only user for monitoring');
      dev.port = port;
      dev.http = { user: r.http_user, pass: r.http_pass };
    } else if (r.http_user || r.http_pass) {
      warn(`http_user/http_pass are ignored for type "${r.type}"`);
    }
    devices.push(dev);
  });
  return { devices, errors, warnings };
}

/** True for an IPv4 or IPv6 literal (otherwise the address is a DNS name). */
export function isIpLike(a) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(a) || a.includes(":");
}

/** Every Zabbix template a device links: its main one plus any companions. */
export function deviceTemplates(d) {
  return [d.template, ...(d.extraTemplates ?? [])];
}

/**
 * The Zabbix host for one validated device: tags (site, CMDB code, kind,
 * where it sits), secret/user macros and the main interface. Template ids are
 * resolved by the caller. Passwords only ever travel as secret macros (type 1).
 */
export function zabbixHostSpec(d, siteCode) {
  const tags = [
    { tag: "site", value: siteCode },
    { tag: "ci", value: d.host },
    ...(d.kind ? [{ tag: "device", value: d.kind }] : []),
    ...(d.location ? [{ tag: "location", value: d.location }] : []),
    ...(d.inventoryNumber ? [{ tag: "inventory", value: d.inventoryNumber }] : []),
  ];
  const macros = [];
  const interfaces = [];
  const addr = d.address ?? "";
  const where = { useip: isIpLike(addr) ? 1 : 0, ip: isIpLike(addr) ? addr : "", dns: isIpLike(addr) ? "" : addr };
  if (d.iface === "snmp") {
    const s = d.snmp;
    if (s.version === 2) {
      macros.push({ macro: "{$SNMP_COMMUNITY}", value: s.community, type: 1 });
      interfaces.push({ type: 2, main: 1, ...where, port: String(d.port), details: { version: 2, bulk: 1, community: "{$SNMP_COMMUNITY}" } });
    } else {
      macros.push(
        { macro: "{$SNMPV3.USER}", value: s.user, type: 0 },
        { macro: "{$SNMPV3.AUTH}", value: s.authPass, type: 1 },
        { macro: "{$SNMPV3.PRIV}", value: s.privPass, type: 1 },
      );
      interfaces.push({ type: 2, main: 1, ...where, port: String(d.port), details: { version: 3, bulk: 1, securityname: "{$SNMPV3.USER}", securitylevel: 2,
        authprotocol: s.authProtocol, authpassphrase: "{$SNMPV3.AUTH}", privprotocol: s.privProtocol, privpassphrase: "{$SNMPV3.PRIV}", contextname: s.context } });
    }
  } else if (d.iface === "ping") {
    interfaces.push({ type: 1, main: 1, ...where, port: "10050" });
  } else if (d.iface === "http") {
    // The agent-type interface carries the address for ICMP ping; no agent is
    // installed on the device. Zabbix doesn't expand {HOST.CONN} inside a user
    // macro's value, so the ISAPI host is the literal address.
    interfaces.push({ type: 1, main: 1, ...where, port: "10050" });
    macros.push(
      { macro: "{$HIKVISION_ISAPI_HOST}", value: addr, type: 0 },
      { macro: "{$HIKVISION_ISAPI_PORT}", value: String(d.port ?? 80), type: 0 },
      { macro: "{$USER}", value: d.http.user, type: 0 },
      { macro: "{$PASSWORD}", value: d.http.pass, type: 1 },
    );
  }
  return { tags, macros, interfaces, templates: deviceTemplates(d) };
}
