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
};

export const CRITICALITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
// Zabbix 7.0 SNMPv3 protocol codes.
const AUTH_PROTOCOLS = { MD5: 0, SHA1: 1, SHA224: 2, SHA256: 3, SHA384: 4, SHA512: 5 };
const PRIV_PROTOCOLS = { DES: 0, AES128: 1, AES192: 2, AES256: 3, AES192C: 4, AES256C: 5 };

const COLUMNS = [
  "host", "name", "type", "address", "port", "snmp_version", "snmp_community",
  "v3_user", "v3_auth_protocol", "v3_auth_pass", "v3_priv_protocol", "v3_priv_pass", "v3_context",
  "template", "manufacturer", "model", "criticality", "location",
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
      ciType: type.ciType,
      kind: type.kind ?? null,
      iface: type.iface,
      manufacturer: r.manufacturer || null,
      model: r.model || null,
      criticality,
      location: r.location || null,
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
    devices.push(dev);
  });
  return { devices, errors, warnings };
}
