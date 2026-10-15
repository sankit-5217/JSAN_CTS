// node --test tools/onboarding-kit/test/
// Inventory → Zabbix coverage rubric, offline part (M1, M2, M6–M13).
// IDs: docs/runbooks/inventory-monitoring-coverage.md. Live part: coverage.live.test.mjs.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { deflateRawSync, crc32 } from "node:zlib";
import {
  CATEGORIES, DOMAINS, OS_AGENT_TEMPLATES, RULES, canonicalCategory, normalizeLocation, planItem, planWorkbook, summarize, summarizeDomains,
} from "../lib/coverage.mjs";
import { DEVICE_TYPES, deviceTemplates, validateInventory, zabbixHostSpec } from "../lib/inventory.mjs";
import { readWorkbook } from "../lib/xlsx.mjs";

import { FIXTURE, fixtureSheets } from "./fixture-sheets.mjs";

const plan = (fields) => planItem({
  inventoryNumber: "ID_INV_0001", quantity: "1", serial: "X1", status: "InUse", owner: "JSAN",
  location: "Server Rack", barcode: "", remark: "", model: "", siteCode: "ID", sheet: "ID_Asset_Tracker", row: 2, ...fields,
});

// ---------------------------------------------------------------- M1 every item has a decision
test("M1: every item in the PRJ-008 sheets gets a coverage decision, none unknown", () => {
  const { plans } = planWorkbook(fixtureSheets());
  const unknown = plans.filter((p) => p.coverage === "unknown");
  assert.deepEqual(unknown.map((p) => `${p.category}: ${p.name}`), []);
  assert.equal(plans.length, FIXTURE.length);
});

test("M1: each item lands on the rule reviewed for it (golden list from the sheet)", () => {
  const { plans } = planWorkbook(fixtureSheets());
  const wrong = plans
    .map((p, i) => ({ p, want: FIXTURE[i]?.expect }))
    .filter(({ p, want }) => p.rule !== want)
    .map(({ p, want }) => `${p.name}: got ${p.rule}, want ${want}`);
  assert.deepEqual(wrong, []);
});

test("M1: rule ids are unique and every rule is used by the sheets or a test below", () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------- M2 categories
test("M2: every category in the sheets is a known category (spacing/case/NBSP tolerated)", () => {
  for (const it of FIXTURE) assert.ok(CATEGORIES.includes(it.category), it.category);
  assert.equal(canonicalCategory("Peripheral "), "Peripheral");
  assert.equal(canonicalCategory(" access control "), "Access Control");
});

test("M2: an unknown category is an error, never guessed", () => {
  const p = plan({ category: "Drone", name: "DJI Mini" });
  assert.equal(p.coverage, "unknown");
  const { issues } = planWorkbook(fixtureSheets([{ site: "ID", category: "Drone", name: "DJI Mini", model: "", owner: "JSAN", location: "Desk Room", status: "InUse" }]));
  assert.ok(issues.some((i) => i.level === "error" && /Unknown category "Drone"/.test(i.message)));
});

// ---------------------------------------------------------------- M6 onboarding can apply it
const SAMPLE_ROW = {
  snmp: "10.0.0.5,161,3,,mon,SHA256,authpass123,AES128,privpass123,,,,",
  ping: "10.0.0.6,,,,,,,,,,,,",
  "agent-active": ",,,,,,,,,,,,",
  http: "10.0.0.7,80,,,,,,,,,viewer,viewpass123,",
};
test("M6: every direct plan points at a device type the onboarding kit accepts", () => {
  const { plans } = planWorkbook(fixtureSheets());
  const types = new Set(plans.filter((p) => p.coverage === "direct").map((p) => p.deviceType));
  for (const t of types) {
    const def = DEVICE_TYPES[t];
    assert.ok(def, `device type ${t} missing from DEVICE_TYPES`);
    const csv = [
      "host,name,type,address,port,snmp_version,snmp_community,v3_user,v3_auth_protocol,v3_auth_pass,v3_priv_protocol,v3_priv_pass,v3_context,http_user,http_pass,inventory_number",
      `ID-DEV-001,Device,${t},${SAMPLE_ROW[def.iface]}`,
    ].join("\n");
    const { errors, devices } = validateInventory(csv, "ID");
    assert.deepEqual(errors, [], `${t}: ${errors.join("; ")}`);
    assert.equal(devices[0].template, def.template);
  }
});

test("M6: the plan's templates are exactly what onboarding links", () => {
  const { plans } = planWorkbook(fixtureSheets());
  for (const p of plans.filter((q) => q.coverage === "direct" && !q.template)) {
    const def = DEVICE_TYPES[p.deviceType];
    assert.deepEqual(p.templates, deviceTemplates({ template: def.template, extraTemplates: def.extraTemplates }));
  }
});

test("M6: MikroTik models get their own template, others the generic MikroTik one", () => {
  assert.deepEqual(plan({ category: "Network", name: "Mikrotik CCR2004-1G-12S+2XS" }).templates, ["MikroTik CCR2004-1G-12S2XS by SNMP"]);
  assert.deepEqual(plan({ category: "Network", name: "Mikrotik CCR2004-16G-2S+" }).templates, ["MikroTik CCR2004-16G-2S by SNMP"]);
  assert.deepEqual(plan({ category: "Network", name: "Mikrotik CCR2116-12G-4S+" }).templates, ["Mikrotik by SNMP"]);
});

// ---------------------------------------------------------------- M7 location travels with the item
test("M7: location is cleaned and carried as Zabbix tags (location, area, inventory)", () => {
  assert.equal(normalizeLocation("SA Server Room", "SA"), "Server Room");
  assert.equal(normalizeLocation("Server Room_Rack", "SA"), "Server Room Rack");
  assert.equal(normalizeLocation("NA", "TH"), null);
  const p = plan({ category: "Server", name: "Dell PowerEdge R7715", location: "Server Rack" });
  assert.deepEqual(p.tags, [
    { tag: "location", value: "Server Rack" },
    { tag: "area", value: "Server Room" },
    { tag: "inventory", value: "ID_INV_0001" },
  ]);
});

test("M7: onboarding writes site, ci, device, location and inventory tags to the Zabbix host", () => {
  const csv = [
    "host,name,type,address,port,snmp_version,snmp_community,v3_user,v3_auth_protocol,v3_auth_pass,v3_priv_protocol,v3_priv_pass,location,inventory_number",
    "ID-FW-001,Firewall,firewall-fortigate,10.0.0.1,,3,,mon,SHA256,authpass123,AES128,privpass123,Server Rack,ID_INV_0003",
  ].join("\n");
  const { devices } = validateInventory(csv, "ID");
  const spec = zabbixHostSpec(devices[0], "ID");
  assert.deepEqual(spec.tags, [
    { tag: "site", value: "ID" },
    { tag: "ci", value: "ID-FW-001" },
    { tag: "location", value: "Server Rack" },
    { tag: "inventory", value: "ID_INV_0003" },
  ]);
});

test("M7: a Hikvision device links ICMP Ping + Hikvision, ISAPI host is the literal address, password is secret", () => {
  const csv = [
    "host,name,type,address,port,http_user,http_pass",
    "SA-NVR-001,NVR,cctv-hikvision,10.0.0.9,8080,viewer,viewpass123",
  ].join("\n");
  const { devices, errors } = validateInventory(csv, "SA");
  assert.deepEqual(errors, []);
  const spec = zabbixHostSpec(devices[0], "SA");
  assert.deepEqual(spec.templates, ["ICMP Ping", "Hikvision camera by HTTP"]);
  const m = Object.fromEntries(spec.macros.map((x) => [x.macro, x]));
  assert.equal(m["{$HIKVISION_ISAPI_HOST}"].value, "10.0.0.9");
  assert.equal(m["{$HIKVISION_ISAPI_PORT}"].value, "8080");
  assert.equal(m["{$PASSWORD}"].type, 1);
  assert.equal(spec.interfaces[0].ip, "10.0.0.9");
});

test("M7: a Hikvision row without a read-only device user is refused", () => {
  const { errors } = validateInventory("host,name,type,address\nSA-CAM-001,Cam,cctv-hikvision,10.0.0.9", "SA");
  assert.ok(errors.some((e) => /http_user is required/.test(e)));
  assert.ok(errors.some((e) => /http_pass must be at least 8/.test(e)));
});

// ---------------------------------------------------------------- M8 honest about what can't be watched
test("M8: passive items are never claimed as monitored, and say why", () => {
  const { plans } = planWorkbook(fixtureSheets());
  for (const p of plans.filter((q) => ["Cable", "Furniture", "Rack", "Monitor", "Scanner"].includes(q.category))) {
    assert.equal(p.coverage, "none", `${p.name} should be inventory-only`);
  }
  for (const p of plans.filter((q) => q.coverage === "none")) {
    assert.ok(p.reason, `${p.name} has no reason`);
    assert.equal(p.templates, undefined);
  }
  for (const p of plans.filter((q) => q.coverage === "via")) assert.ok(p.why && p.parent, `${p.name}: via without explanation`);
});

test("M8: basic PDUs are not monitorable, metered/switched ones are", () => {
  assert.equal(plan({ category: "Power", name: "PDU APC AP9559" }).coverage, "none");
  assert.equal(plan({ category: "Power", name: "1810-AP-P9565 APC RACK PDU BASIC 1U" }).coverage, "none");
  assert.equal(plan({ category: "Power", name: "APC Switched Rack PDU AP8853" }).coverage, "direct");
});

// ---------------------------------------------------------------- M9 gaps are explicit
test("M9: analog cameras are covered through the DVR, with the per-camera gap stated", () => {
  const { plans } = planWorkbook(fixtureSheets([
    { site: "ID", category: "CCTV", name: "DVR Hikvision iDS-7204HQHI-M1/XT 4-CH", model: "", owner: "JSAN", location: "Server Rack", status: "InUse" },
    { site: "ID", category: "CCTV", name: "Camera Hikvision DS-2CE76K0T-EXLPF", model: "", owner: "JSAN", location: "Desk Room", status: "InUse" },
  ]));
  const cam = plans[1];
  assert.equal(cam.coverage, "via");
  assert.deepEqual(cam.parentItems, ["ID_INV_0001"]);
  assert.match(cam.gap, /video loss/);
});

test("M9: an AC is watched only through a server's temperature sensors in the same room", () => {
  const server = { site: "ID", category: "Server", name: "Dell PowerEdge R7715", model: "Dell R7715", owner: "JSAN", location: "Server Rack", status: "InUse" };
  const acServerRoom = { site: "ID", category: "AC", name: "AC Portable Midea", model: "", owner: "JSAN", location: "Server Room", status: "InUse" };
  const acDeskRoom = { ...acServerRoom, location: "Desk Room" };
  const { plans } = planWorkbook(fixtureSheets([server, acServerRoom, acDeskRoom]));
  assert.equal(plans[1].coverage, "via");
  assert.deepEqual(plans[1].signals, ["roomTemperature"]);
  assert.equal(plans[2].coverage, "none");
  assert.match(plans[2].gap, /temperature sensor/);
});

test("M9: a 'via' item with no monitored parent at its site says so", () => {
  const { plans } = planWorkbook(fixtureSheets([
    { site: "TH", category: "Power", name: "APC UPS Battery SRT96BP", model: "", owner: "JSAN", location: "Server Room", status: "InUse" },
  ]));
  assert.match(plans[0].gap, /No monitored ups/);
});

test("M9: access terminals and LTE hotspots are up/down only, with the gap stated", () => {
  for (const name of ["Access Door Finger and Card ZKTECO X6", "HIKVISION Face Recognition Terminal"]) {
    const p = plan({ category: name.includes("HIKVISION") ? "CCTV" : "Access Control", name });
    assert.equal(p.deviceType, "access-control");
    assert.match(p.gap, /Door events/);
  }
  const lte = plan({ category: "Peripheral", name: "4G LTE Mobile Wi-Fi", model: "M7350" });
  assert.equal(lte.deviceType, "lte-hotspot");
  assert.ok(lte.gap);
});

// ---------------------------------------------------------------- M10 third-party equipment
test("M10: a router owned by the ISP is watched as the ISP link (ping), not via SNMP", () => {
  const isp = plan({ category: "Network", name: "Mikrotik CCR2004-16G-2S+", owner: "CBN" });
  assert.equal(isp.deviceType, "isp-link");
  assert.deepEqual(isp.templates, ["ICMP Ping"]);
  assert.match(isp.why, /CBN/);
  assert.equal(plan({ category: "Network", name: "Mikrotik CCR2116-12G-4S+", owner: "JSAN" }).deviceType, "router-mikrotik");
});

test("M10: spare (InStock/NoUse) devices are planned but marked inactive", () => {
  assert.equal(plan({ category: "Network", name: "Wireless Access Point Ruijie RG-AP640-L", status: "InStock" }).active, false);
  assert.equal(plan({ category: "Network", name: "Wireless Access Point Ruijie RG-AP640-L", status: "InUse" }).active, true);
});

// ---------------------------------------------------------------- M11 sheet data quality
test("M11: data problems that weaken monitoring are reported, not silently accepted", () => {
  const base = { site: "TH", category: "Server", name: "Dell PowerEdge R7715", model: "Dell R7715", owner: "JSAN", location: "Server Room", status: "InUse" };
  const sheets = fixtureSheets([base, { ...base, status: "" }, { ...base, status: "Broken" }, { ...base, location: "NA" }, { ...base, model: "" }]);
  const rows = sheets[0].rows;
  rows[2][5] = rows[1][5]; // duplicate serial
  rows[5][5] = ""; // missing serial on a monitored item
  rows.push(Object.assign(["TH_INV_0009", "", "", "", "", "", "", "", "", "", ""], { row: 7 })); // numbered, empty → gap 6..8
  rows.push(Object.assign(["TH_INV_0009", "Rack", "Rack", "1", "", "", "Server Room", "InUse", "JSAN", "", ""], { row: 8 }));
  const { issues } = planWorkbook(sheets);
  const msgs = issues.map((i) => i.message);
  const has = (re) => assert.ok(msgs.some((m) => re.test(m)), `expected an issue matching ${re}: ${msgs.join(" | ")}`);
  has(/Status is empty/);
  has(/Status "Broken" is not InUse\/InStock\/NoUse/);
  has(/Location .* is empty/);
  has(/Model is empty/);
  has(/Serial number is empty/);
  has(/Serial ".*" also on TH_INV_0001/);
  has(/Numbered row with no item/);
  has(/Numbering gap: TH_INV_0006–TH_INV_0008 missing/);
  has(/Inventory number repeated/);
});

test("M11: an empty sheet (no inventory yet) is reported as info, not an error", () => {
  const { issues, plans } = planWorkbook([{ name: "BG_Sofia_YTS", rows: [] }]);
  assert.equal(plans.length, 0);
  assert.deepEqual(issues.map((i) => i.level), ["info"]);
});

// ---------------------------------------------------------------- M12 reads the real workbook format
/** A tiny .xlsx built in memory: zip of the four XML parts (deflated). */
function buildXlsx(sheetXml, sharedStrings) {
  const files = {
    "xl/workbook.xml": '<workbook xmlns:r="r"><sheets><sheet name="ID_Asset_Tracker" sheetId="1" r:id="rId1"/><sheet name="BG_Sofia_YTS" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    "xl/sharedStrings.xml": `<sst>${sharedStrings.map((s) => `<si>${s}</si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": sheetXml,
    "xl/worksheets/sheet2.xml": "<worksheet><sheetData/></worksheet>",
  };
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8");
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length / 2, 8); eocd.writeUInt16LE(central.length / 2, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test("M12: the .xlsx reader handles shared/inline/rich strings, numbers, gaps, NBSP and line breaks", () => {
  const xml =
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
    '<row r="3"><c r="A3" t="inlineStr"><is><t>ID_INV_0001</t></is></c><c r="C3" t="s"><v>3</v></c><c r="D3"><v>1</v></c></row>' +
    '<row r="4" spans="1:3"/>' +
    '</sheetData></worksheet>';
  const strings = [
    "<t>Inventory Number</t>",
    "<t>Category</t>",
    "<t>Inventory Item Name</t>",
    '<r><t>Camera Hikvision </t></r><r><t xml:space="preserve">DS-2CE &amp; co\nline 2</t></r>',
  ];
  const sheets = readWorkbook(buildXlsx(xml, strings));
  assert.deepEqual(sheets.map((s) => s.name), ["ID_Asset_Tracker", "BG_Sofia_YTS"]);
  const [header, item, empty] = sheets[0].rows;
  assert.deepEqual([...header], ["Inventory Number", "Category", "Inventory Item Name"]);
  assert.equal(item.row, 3);
  assert.deepEqual([...item], ["ID_INV_0001", "", "Camera Hikvision DS-2CE & co\nline 2", "1"]);
  assert.deepEqual([...empty], []);
  assert.deepEqual(sheets[1].rows, []);
});

test("M12: a file that is not an .xlsx fails with a clear message", () => {
  assert.throws(() => readWorkbook(Buffer.from("host,name\n")), /Not an \.xlsx file/);
});

// ---------------------------------------------------------------- M13 no secrets, no serials in git
test("M13: the committed fixture carries no serial numbers or remarks", () => {
  for (const it of FIXTURE) {
    assert.deepEqual(Object.keys(it).sort(), ["category", "expect", "location", "model", "name", "owner", "site", "status"]);
  }
});

test("M13: device passwords only ever travel as secret macros", () => {
  const csv = [
    "host,name,type,address,port,snmp_version,snmp_community,v3_user,v3_auth_protocol,v3_auth_pass,v3_priv_protocol,v3_priv_pass",
    "ID-UPS-001,UPS,ups-apc,10.0.0.4,,3,,mon,SHA256,authpass123,AES128,privpass123",
    "ID-AP-001,AP,wifi-ap,10.0.0.8,,2c,s3cret-ro,,,,,",
  ].join("\n");
  for (const d of validateInventory(csv, "ID").devices) {
    for (const m of zabbixHostSpec(d, "ID").macros) {
      if (/AUTH|PRIV|COMMUNITY|PASSWORD/.test(m.macro)) assert.equal(m.type, 1, `${m.macro} must be a secret macro`);
    }
  }
});

// ---------------------------------------------------------------- M14 hardware / networking / software
test("M14: every component is placed in Hardware or Networking, and the report covers all three areas", () => {
  const { plans } = planWorkbook(fixtureSheets());
  for (const p of plans) assert.ok(["Hardware", "Networking"].includes(p.domain), `${p.name}: ${p.domain}`);
  assert.deepEqual(Object.keys(summarizeDomains(plans)), DOMAINS);
  const net = (fields) => plan(fields).domain;
  assert.equal(net({ category: "Network", name: "Firewall_FG-201G" }), "Networking");
  assert.equal(net({ category: "Network", name: "Wireless Access Point Ruijie RG-AP640-L" }), "Networking");
  assert.equal(net({ category: "Cable", name: "Cat 6A Cables - 10G" }), "Networking");
  assert.equal(net({ category: "Cable", name: "OM4 Multimode Fiber Patch Cable" }), "Networking");
  assert.equal(net({ category: "Cable", name: "C13 - C14 Power Cord Cables" }), "Hardware");
  assert.equal(net({ category: "Server", name: "Dell PowerEdge R7715" }), "Hardware");
});

test("M14: the PRJ-008 networking gear is all accounted for", () => {
  const { plans } = planWorkbook(fixtureSheets());
  const netRules = new Set(plans.filter((p) => p.domain === "Networking").map((p) => p.rule));
  for (const r of ["isp-cpe", "firewall-fortigate", "router-mikrotik", "wifi-ap", "sfp", "lte-hotspot", "cable"]) {
    assert.ok(netRules.has(r), `no networking item via rule ${r}`);
  }
});

// ---------------------------------------------------------------- M15 software layer
test("M15: every monitored device states its software (firmware / OS) coverage", () => {
  const { plans } = planWorkbook(fixtureSheets());
  for (const p of plans.filter((q) => q.coverage === "direct")) {
    assert.ok(p.software?.length, `${p.name}: no software layer`);
    for (const sw of p.software) {
      assert.ok(["direct", "partial", "none"].includes(sw.coverage));
      if (sw.coverage === "none") assert.ok(sw.reason, `${p.name} ${sw.layer}: none without a reason`);
      else assert.ok(sw.templates?.length && sw.signals?.length, `${p.name} ${sw.layer}: claim without templates/signals`);
    }
  }
});

test("M15: a server has both firmware (iDRAC) and operating system (agent) watched", () => {
  const p = plan({ category: "Server", name: "Dell PowerEdge R7715" });
  const layers = Object.fromEntries(p.software.map((sw) => [sw.layer, sw]));
  assert.equal(layers.Firmware.coverage, "direct");
  assert.deepEqual(layers.Firmware.templates, ["Dell iDRAC by SNMP"]);
  assert.equal(layers["Operating system"].coverage, "direct");
  assert.equal(layers["Operating system"].templates, OS_AGENT_TEMPLATES);
  assert.ok(layers["Operating system"].signals.includes("osVersion"));
});

test("M15: firmware is full for FortiGate/MikroTik/Hikvision, partial for UPS/AP/printer, none for ping-only", () => {
  const fw = (fields) => plan(fields).software.find((sw) => sw.layer === "Firmware").coverage;
  assert.equal(fw({ category: "Network", name: "Firewall_FG-201G" }), "direct");
  assert.equal(fw({ category: "Network", name: "Mikrotik CCR2116-12G-4S+" }), "direct");
  assert.equal(fw({ category: "CCTV", name: "HIKVISION DS-7100 Series Network Video Recorder" }), "direct");
  assert.equal(fw({ category: "Power", name: "APC UPS SRT3000XLI" }), "partial");
  assert.equal(fw({ category: "Network", name: "Wireless Access Point Ruijie RG-AP640-L" }), "partial");
  assert.equal(fw({ category: "Printer", name: "Printer HP Colour LaserJet Pro MFP 3303sdw" }), "partial");
  assert.equal(fw({ category: "Access Control", name: "Access Door Finger and Card ZKTECO X6" }), "none");
  assert.equal(fw({ category: "Network", name: "Mikrotik CCR2004-16G-2S+", owner: "CBN" }), "none");
});

// ---------------------------------------------------------------- the real workbook (when present)
const REAL = process.env.INVENTORY_XLSX;
test("Real workbook: every item has a decision and the sheets have no errors", { skip: !REAL || !existsSync(REAL) ? "set INVENTORY_XLSX to the workbook path" : false }, () => {
  const { plans, issues } = planWorkbook(readWorkbook(readFileSync(REAL)));
  const { bySite } = summarize(plans);
  for (const [site, s] of Object.entries(bySite)) assert.equal(s.unknown, 0, `${site} has unknown items`);
  assert.deepEqual(issues.filter((i) => i.level === "error"), []);
});
