// node --test tools/onboarding-kit/test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv, validateInventory } from "../lib/inventory.mjs";

const HEADER = "host,name,type,address,port,snmp_version,snmp_community,v3_user,v3_auth_protocol,v3_auth_pass,v3_priv_protocol,v3_priv_pass,criticality";
const csv = (...rows) => [HEADER, ...rows].join("\n");

test("parses quoted fields, doubled quotes and CRLF", () => {
  const rows = parseCsv('a,"b,c","d ""e"""\r\n1,2,3\r\n');
  assert.deepEqual(rows.map((r) => [...r]), [["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
  assert.deepEqual(rows.map((r) => r.line), [1, 2]);
});

test("accepts a valid SNMPv3, v2c, ping and agent inventory", () => {
  const { devices, errors, warnings } = validateInventory(
    csv(
      "SITE03-UPS-001,Main UPS,ups,10.0.0.5,,3,,opsdesk,SHA256,authpass123,AES128,privpass123,CRITICAL",
      "SITE03-SW-001,Core switch,switch,10.0.0.2,161,2c,s3cr3t-ro,,,,,,HIGH",
      "SITE03-ISP-001,ISP-A,isp-link,203.0.113.1,,,,,,,,,",
      "SITE03-SRV-001,File server,server-linux,,,,,,,,,,",
    ),
    "SITE03",
  );
  assert.deepEqual(errors, []);
  assert.equal(devices.length, 4);
  assert.equal(devices[0].snmp.version, 3);
  assert.equal(devices[0].snmp.authProtocol, 3); // SHA256
  assert.equal(devices[0].snmp.context, "");
  assert.equal(devices[1].snmp.community, "s3cr3t-ro");
  assert.equal(devices[2].iface, "ping");
  assert.equal(devices[3].iface, "agent-active");
  assert.ok(warnings.some((w) => w.includes("v2c is unencrypted")));
});

test("rejects hosts of another site, duplicates and bad types", () => {
  const { errors } = validateInventory(
    csv(
      "SITE02-UPS-001,Wrong site,ups,10.0.0.5,,3,,u,SHA256,authpass123,AES128,privpass123,",
      "SITE03-SW-001,A,switch,10.0.0.2,,2c,ro,,,,,,",
      "SITE03-SW-001,B,switch,10.0.0.3,,2c,ro,,,,,,",
      "SITE03-X-001,C,toaster,10.0.0.9,,,,,,,,,",
    ),
    "SITE03",
  );
  assert.ok(errors.some((e) => e.includes('must start with "SITE03-"')));
  assert.ok(errors.some((e) => e.includes("duplicate host")));
  assert.ok(errors.some((e) => e.includes('unknown type "toaster"')));
});

test("rejects missing or weak SNMP credentials and bad addresses", () => {
  const { errors } = validateInventory(
    csv(
      "SITE03-UPS-001,UPS,ups,10.0.0.5,,3,,,SHA256,short,AES128,privpass123,",
      "SITE03-SW-001,SW,switch,10.0.0.2,,2c,,,,,,,",
      "SITE03-FW-001,FW,firewall,not an address!,,2c,ro,,,,,,",
      "SITE03-SW-002,SW2,switch,10.0.0.7,99999,2c,ro,,,,,,",
    ),
    "SITE03",
  );
  assert.ok(errors.some((e) => e.includes("v3_user is required")));
  assert.ok(errors.some((e) => e.includes("v3_auth_pass must be at least 8")));
  assert.ok(errors.some((e) => e.includes("snmp_community is required")));
  assert.ok(errors.some((e) => e.includes("is not an IP or hostname")));
  assert.ok(errors.some((e) => e.includes("is not valid")));
});

test("rejects the same address and port twice", () => {
  const { errors } = validateInventory(
    csv("SITE03-SW-001,A,switch,10.0.0.2,,2c,ro,,,,,,", "SITE03-SW-002,B,switch,10.0.0.2,161,2c,ro,,,,,,"),
    "SITE03",
  );
  assert.ok(errors.some((e) => e.includes("same address and port as SITE03-SW-001")));
});

test("flags an unquoted comma that shifts columns", () => {
  const { errors } = validateInventory(csv("SITE03-SW-001,Core, floor 2,switch,10.0.0.2,,2c,ro,,,,,,"), "SITE03");
  assert.ok(errors.some((e) => e.includes("quote values that contain commas")));
});

test("reports real file line numbers across comments and blank lines", () => {
  const text = [HEADER, "# comment", "", "SITE03-SW-001,SW,switch,10.0.0.2,,2c,,,,,,,"].join("\n");
  const { errors } = validateInventory(text, "SITE03");
  assert.ok(errors.some((e) => e.startsWith("line 4 (SITE03-SW-001)")), errors.join(" | "));
});

test("rejects unknown columns and empty files", () => {
  assert.ok(validateInventory("host,name,type,colour\nSITE03-A,a,switch,red", "SITE03").errors[0].includes("Unknown column"));
  assert.ok(validateInventory(HEADER, "SITE03").errors[0].includes("no device rows"));
});
