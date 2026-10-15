#!/usr/bin/env node
// Monitoring coverage report for a site inventory workbook (.xlsx).
//
//   node tools/onboarding-kit/coverage-report.mjs --xlsx "<workbook>.xlsx" [--live]
//
// For every item: watched by Zabbix directly, through another device, or not
// at all — with the template, what is watched, where it sits, and any gap.
// --live also checks the claims against the JSAN Zabbix server (read-only):
// templates exist (M3), up/down every ≤ 60 s (M4), every claimed signal is in
// the template (M5). Uses ZABBIX_URL and the kit's Zabbix API token
// (KIT_SECRETS_DIR=secrets/railway for production).
//
// The report (with serial numbers) is written under out/coverage/ — gitignored.
// Exit code 1 when the rubric fails: unknown items, sheet errors or a live check.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { OUT_DIR, parseArgs, secretFile } from "./lib/config.mjs";
import { SIGNALS, planWorkbook, summarize, summarizeDomains } from "./lib/coverage.mjs";
import { liveChecks, ruleDeviceTypes } from "./lib/coverage-live.mjs";
import { readWorkbook } from "./lib/xlsx.mjs";
import { zabbixClient } from "./lib/zabbix.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.xlsx || args.xlsx === true) {
  console.error('Usage: node tools/onboarding-kit/coverage-report.mjs --xlsx "<workbook>.xlsx" [--live] [--out report.md]');
  process.exit(2);
}

const { plans, issues } = planWorkbook(readWorkbook(readFileSync(String(args.xlsx))));
const items = plans.filter((p) => p.coverage !== "empty");
const { bySite, byCategory } = summarize(plans);
const domains = summarizeDomains(plans);

let live = null;
if (args.live) {
  const url = process.env.ZABBIX_URL ?? "http://127.0.0.1/zabbix/api_jsonrpc.php";
  const token = process.env.ZABBIX_API_TOKEN ?? secretFile("zabbix-api-token");
  if (!token) {
    console.error("--live needs a Zabbix API token (ZABBIX_API_TOKEN or secrets/zabbix-api-token)");
    process.exit(2);
  }
  live = { url, ...(await liveChecks(zabbixClient(url, token), plans, { extraDeviceTypes: ruleDeviceTypes() })) };
}

const md = [];
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const row = (...cols) => md.push(`| ${cols.map(cell).join(" | ")} |`);
md.push(`# Monitoring coverage — ${basename(String(args.xlsx))}`, "", `Generated ${new Date().toISOString()}.`, "");
md.push("**direct** = own Zabbix host, up/down every minute · **via** = watched through another monitored device · **none** = nothing can watch it (inventory only).", "");

md.push("## Hardware, networking and software", "");
row("Area", "Direct", "Via", "Partial", "None");
md.push("| --- | --- | --- | --- | --- |");
for (const [area, c] of Object.entries(domains)) row(area === "Software" ? "Software (firmware / OS layers)" : area, c.direct, c.via, c.partial, c.none);
md.push("");

md.push("## By site", "");
row("Site", "Items", "Direct", "Via", "None", "Unknown");
md.push("| --- | --- | --- | --- | --- | --- |");
for (const [site, s] of Object.entries(bySite)) row(site, s.items, s.direct, s.via, s.none, s.unknown);

md.push("", "## By category", "");
row("Category", "Direct", "Via", "None", "Unknown");
md.push("| --- | --- | --- | --- | --- |");
for (const [cat, c] of Object.entries(byCategory)) row(cat, c.direct, c.via, c.none, c.unknown);

md.push("", "## Items", "");
row("Item", "Category", "Name", "Model", "Located at", "Coverage", "How", "Watches");
md.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const p of items) {
  const how =
    p.coverage === "direct"
      ? `${p.templates.join(" + ")}${p.active ? "" : " (when deployed)"}`
      : p.coverage === "via"
        ? `through ${p.parentItems?.join(", ") ?? p.parent}${p.why ? ` — ${p.why}` : ""}`
        : p.reason ?? (p.coverage === "unknown" ? "NO RULE MATCHES" : "");
  const watches = (p.signals ?? []).map((s) => SIGNALS[s]?.label ?? s).join("; ");
  row(p.inventoryNumber, p.category, p.name, p.model, p.location ?? "—", p.coverage, how, watches + (p.gap ? ` ⚠ ${p.gap}` : ""));
}

md.push("", "## Software (firmware and operating systems)", "");
row("Item", "Device", "Layer", "Coverage", "How / why not", "Watches");
md.push("| --- | --- | --- | --- | --- | --- |");
for (const p of items.filter((q) => q.software)) {
  for (const sw of p.software) {
    row(p.inventoryNumber, p.name, sw.layer, sw.coverage, sw.how ?? sw.reason, (sw.signals ?? []).map((x) => SIGNALS[x]?.label ?? x).join("; "));
  }
}

const gaps = items.filter((p) => p.gap);
md.push("", `## Known gaps (${gaps.length})`, "");
for (const p of gaps) md.push(`- **${p.inventoryNumber}** ${p.name}: ${p.gap}`);

md.push("", `## Sheet data to fix (${issues.length})`, "");
for (const i of issues) md.push(`- [${i.level}] ${i.sheet}${i.row ? ` row ${i.row}` : ""}${i.item ? ` ${i.item}` : ""}: ${i.message}`);

if (live) {
  const failed = live.results.filter((r) => !r.ok);
  md.push("", `## Live check against ${live.url} — ${live.results.length - failed.length}/${live.results.length} passed`, "");
  for (const r of live.results) md.push(`- ${r.ok ? "PASS" : "**FAIL**"} ${r.id} ${r.subject}: ${r.detail}`);
}

const outPath = args.out && args.out !== true ? String(args.out) : join(OUT_DIR, "coverage", `${basename(String(args.xlsx)).replace(/\.xlsx$/i, "")}.md`);
mkdirSync(join(outPath, ".."), { recursive: true });
writeFileSync(outPath, md.join("\n") + "\n");

// Console summary.
console.log(`Items: ${items.length}`);
for (const [area, c] of Object.entries(domains)) {
  console.log(`  ${area}: ${c.direct} direct, ${c.via} via, ${c.partial} partial, ${c.none} none`);
}
for (const [site, s] of Object.entries(bySite)) {
  console.log(`  ${site}: ${s.direct} direct, ${s.via} via, ${s.none} none${s.unknown ? `, ${s.unknown} UNKNOWN` : ""}`);
}
const errors = issues.filter((i) => i.level === "error");
console.log(`Known gaps: ${gaps.length} · sheet issues: ${issues.length} (${errors.length} errors)`);
const liveFailed = live ? live.results.filter((r) => !r.ok) : [];
if (live) console.log(`Live (${live.url}): ${live.results.length - liveFailed.length}/${live.results.length} passed`);
for (const r of liveFailed) console.log(`  FAIL ${r.id} ${r.subject}: ${r.detail}`);
console.log(`Report: ${outPath}`);
const unknown = items.filter((p) => p.coverage === "unknown").length;
process.exit(unknown || errors.length || liveFailed.length ? 1 : 0);
