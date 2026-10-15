// Live rubric checks (M3–M5): does the JSAN Zabbix server really have what
// the coverage plan claims? Read-only — template/item/trigger lookups only.
import { DEVICE_TYPES } from "./inventory.mjs";
import { OS_AGENT_TEMPLATES, SIGNALS, templatesFor } from "./coverage.mjs";

/** Item keys that tell Zabbix whether a device is up. */
export const AVAILABILITY_KEYS = [
  "icmpping",
  "agent.ping",
  "zabbix[host,snmp,available]",
  "zabbix[host,active_agent,available]",
  "zabbix[host,agent,available]",
];

/** "1m" → 60, "30s" → 30, "90" → 90, "1h" → 3600; null for "0"/macros. */
export function intervalSeconds(delay) {
  const m = /^(\d+)([smhdw]?)$/.exec(String(delay ?? "").trim());
  if (!m || m[1] === "0") return null;
  return Number(m[1]) * { "": 1, s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2]];
}

/** Every name a template exposes: items, item prototypes, triggers, trigger prototypes. */
export async function loadTemplates(zbx, names) {
  const out = new Map();
  for (const name of [...new Set(names)]) {
    const [t] = await zbx("template.get", {
      filter: { host: [name] },
      output: ["templateid", "host"],
      selectItems: ["name", "key_", "delay"],
      selectTriggers: ["description"],
    });
    if (!t) { out.set(name, null); continue; }
    const protos = await zbx("itemprototype.get", { templateids: [t.templateid], output: ["name", "key_"] });
    const trigProtos = await zbx("triggerprototype.get", { templateids: [t.templateid], output: ["description"] });
    out.set(name, {
      items: t.items,
      names: [
        ...t.items.map((i) => i.name),
        ...protos.map((i) => i.name),
        ...t.triggers.map((x) => x.description),
        ...trigProtos.map((x) => x.description),
      ],
    });
  }
  return out;
}

/** The fastest availability check across a set of templates, in seconds (null = none). */
export function availabilityInterval(templates) {
  let best = null;
  for (const t of templates) {
    for (const i of t?.items ?? []) {
      if (!AVAILABILITY_KEYS.includes(i.key_)) continue;
      const s = intervalSeconds(i.delay);
      if (s !== null && (best === null || s < best)) best = s;
    }
  }
  return best;
}

/**
 * Check every direct plan shape the rules can produce, plus every "via"
 * claim against its parent's templates.
 * @param plans  planned items (planWorkbook().plans) — may be empty
 * @param extraDeviceTypes device types to check even if no item uses them
 * @returns {{ results: {id: string, subject: string, ok: boolean, detail: string}[] }}
 */
export async function liveChecks(zbx, plans, { extraDeviceTypes = [], maxAvailabilitySeconds = 60 } = {}) {
  const results = [];
  const shapes = new Map(); // "templates|signals" → {templates, signals, subject}
  for (const p of plans.filter((q) => q.coverage === "direct")) {
    const key = `${p.templates.join("+")}|${p.signals.join(",")}`;
    if (!shapes.has(key)) shapes.set(key, { templates: p.templates, signals: p.signals, subject: `${p.deviceType} (${p.inventoryNumber}…)` });
  }
  // Software claims (firmware / OS). The OS layer of a server lists both agent
  // templates (Linux or Windows): each must carry the signals on its own.
  const software = new Map();
  for (const p of plans.filter((q) => q.coverage === "direct")) {
    for (const sw of p.software ?? []) {
      if (!sw.templates || !sw.signals) continue;
      const sets = sw.templates === OS_AGENT_TEMPLATES ? sw.templates.map((t) => [t]) : [sw.templates];
      for (const templates of sets) {
        const key = `${templates.join("+")}|${sw.signals.join(",")}`;
        if (!software.has(key)) software.set(key, { templates, signals: sw.signals, subject: `${p.deviceType} software: ${sw.layer} (${templates.join(" + ")})` });
      }
    }
  }
  for (const type of extraDeviceTypes) {
    const templates = templatesFor({ deviceType: type });
    const key = `${templates.join("+")}|`;
    if (!shapes.has(key)) shapes.set(key, { templates, signals: [], subject: type });
  }
  const viaParents = new Map();
  for (const p of plans.filter((q) => q.coverage === "via" && q.parentItems)) {
    const parents = plans.filter((q) => q.siteCode === p.siteCode && p.parentItems.includes(q.inventoryNumber));
    for (const parent of parents) {
      const key = `${parent.templates.join("+")}|${p.signals.join(",")}`;
      if (!viaParents.has(key)) viaParents.set(key, { templates: parent.templates, signals: p.signals, subject: `${p.rule} via ${parent.deviceType}` });
    }
  }

  const allNames = [...shapes.values(), ...viaParents.values(), ...software.values()].flatMap((s) => s.templates);
  const tpl = await loadTemplates(zbx, allNames);

  for (const s of shapes.values()) {
    const loaded = s.templates.map((n) => tpl.get(n));
    const missing = s.templates.filter((n) => !tpl.get(n));
    results.push({ id: "M3", subject: s.subject, ok: missing.length === 0,
      detail: missing.length ? `template(s) not on the server: ${missing.join(", ")}` : s.templates.join(" + ") });
    if (missing.length) continue;
    const every = availabilityInterval(loaded);
    results.push({ id: "M4", subject: s.subject, ok: every !== null && every <= maxAvailabilitySeconds,
      detail: every === null ? "no up/down check in its templates" : `up/down checked every ${every}s` });
    for (const sig of s.signals) results.push(signalResult("M5", s.subject, sig, loaded));
  }
  for (const s of viaParents.values()) {
    const loaded = s.templates.map((n) => tpl.get(n));
    if (loaded.some((t) => !t)) continue; // already reported under M3
    for (const sig of s.signals) results.push(signalResult("M5", s.subject, sig, loaded));
  }
  for (const s of software.values()) {
    const loaded = s.templates.map((n) => tpl.get(n));
    const missing = s.templates.filter((n) => !tpl.get(n));
    if (missing.length) {
      results.push({ id: "M15", subject: s.subject, ok: false, detail: `template(s) not on the server: ${missing.join(", ")}` });
      continue;
    }
    for (const sig of s.signals) results.push(signalResult("M15", s.subject, sig, loaded));
  }
  return { results };
}

function signalResult(id, subject, sig, loaded) {
  const def = SIGNALS[sig];
  const hit = def && loaded.flatMap((t) => t.names).find((n) => def.pattern.test(n));
  return { id, subject, ok: Boolean(hit), detail: def ? `${def.label}: ${hit ? `"${hit}"` : "nothing in the template matches"}` : `unknown signal "${sig}"` };
}

/** Device types the rules can emit (so a rule can't point at a missing template). */
export function ruleDeviceTypes() {
  return Object.keys(DEVICE_TYPES);
}
