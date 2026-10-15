// node --test tools/onboarding-kit/test/coverage.live.test.mjs
// Inventory → Zabbix coverage rubric, live part (M3–M5), against a real Zabbix
// server — read-only. Local by default; production with
//   KIT_SECRETS_DIR=secrets/railway ZABBIX_URL=https://<zabbix-web>/api_jsonrpc.php
// Skipped (not failed) when no token is configured or the server is unreachable.
import assert from "node:assert/strict";
import { test } from "node:test";
import { secretFile } from "../lib/config.mjs";
import { planWorkbook, templatesFor } from "../lib/coverage.mjs";
import { liveChecks, ruleDeviceTypes } from "../lib/coverage-live.mjs";
import { zabbixClient, zabbixVersion } from "../lib/zabbix.mjs";
import { fixtureSheets } from "./fixture-sheets.mjs";

const URL_ = process.env.ZABBIX_URL ?? "http://127.0.0.1/zabbix/api_jsonrpc.php";
const TOKEN = process.env.ZABBIX_API_TOKEN ?? secretFile("zabbix-api-token");

let skip = false;
let version = null;
if (!TOKEN) skip = "no Zabbix API token (secrets/zabbix-api-token or ZABBIX_API_TOKEN)";
else {
  version = await zabbixVersion(URL_).catch(() => null);
  if (!version) skip = `Zabbix not reachable at ${URL_}`;
}

const results = skip ? [] : (await liveChecks(zabbixClient(URL_, TOKEN), planWorkbook(fixtureSheets()).plans, { extraDeviceTypes: ruleDeviceTypes() })).results;
const byId = (id) => results.filter((r) => r.id === id);
const failures = (id) => byId(id).filter((r) => !r.ok).map((r) => `${r.subject}: ${r.detail}`);

test(`M3: every template the plan or the kit uses exists on Zabbix ${version ?? ""} (${URL_})`, { skip }, () => {
  // Device types sharing a template set (e.g. every ping-only type) are checked once.
  const distinct = new Set(ruleDeviceTypes().map((t) => templatesFor({ deviceType: t }).join("+")));
  const checked = new Set(byId("M3").map((r) => r.detail));
  for (const set of distinct) assert.ok(checked.has(set.replace(/\+/g, " + ")), `template set not checked: ${set}`);
  assert.deepEqual(failures("M3"), []);
});

test("M4: every monitored item is checked up/down at least once a minute", { skip }, () => {
  assert.ok(byId("M4").length > 0);
  assert.deepEqual(failures("M4"), []);
});

test("M5: everything the plan says Zabbix watches is really in the templates (direct and via)", { skip }, () => {
  assert.ok(byId("M5").length > 0);
  assert.deepEqual(failures("M5"), []);
});

test("M15: every software claim (firmware, BIOS, OS version, services) is really in its template", { skip }, () => {
  assert.ok(byId("M15").length > 0);
  assert.deepEqual(failures("M15"), []);
});
