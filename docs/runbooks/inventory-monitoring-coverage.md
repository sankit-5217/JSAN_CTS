# Site inventory → Zabbix monitoring coverage

**When to use this**: a site sends (or updates) its asset workbook — e.g.
`[PRJ-008] Site Level Inventory Details.xlsx` — and you need to know, item by
item, whether Zabbix will watch it in real time, how, and what is missing
before the site is onboarded.

```bash
# Offline: plan + sheet data problems
node tools/onboarding-kit/coverage-report.mjs --xlsx "<workbook>.xlsx"

# Also prove every claim against the JSAN Zabbix server (read-only)
KIT_SECRETS_DIR=secrets/railway \
ZABBIX_URL=https://zabbix-web-production-242b.up.railway.app/api_jsonrpc.php \
  node tools/onboarding-kit/coverage-report.mjs --xlsx "<workbook>.xlsx" --live
```

The report (it contains serial numbers) is written to
`tools/onboarding-kit/out/coverage/` — gitignored. Exit code 1 when the rubric
fails. The workbook itself is never committed.

## How each item is classified

| Coverage | Meaning |
| --- | --- |
| **direct** | Its own Zabbix host (template + interface), up/down checked every minute; alerts reach OpsDesk through the webhook. |
| **via** | No network interface of its own, but a monitored device reports on it (UPS battery → UPS, drive → iDRAC, analog camera → DVR, SFP → router/firewall port, AC → server inlet temperature in the same room). |
| **none** | Nothing can watch it (cables, furniture, USB peripherals, basic PDUs); inventory only, with the reason. |

Every item is also placed in **Hardware** or **Networking**. **Software** is the
layer running on monitored devices — firmware/BIOS and the operating system —
rated *direct* (version collected, alert when it changes), *partial* (firmware
text in the SNMP system description only) or *none* (ping-only devices).

Rules live in `tools/onboarding-kit/lib/coverage.mjs` (ordered, first match wins);
the device types they point to are in `lib/inventory.mjs` (`DEVICE_TYPES`), so the
same plan is what `onboard-site.mjs` applies later.

## Coverage rubric

IDs are referenced by `tools/onboarding-kit/test/coverage.test.mjs` (offline) and
`coverage.live.test.mjs` (against a real Zabbix).

| ID | Requirement |
| --- | --- |
| M1 | **Every item gets a decision** — no "unknown"; each lands on the rule reviewed for it (golden list from the PRJ-008 sheets). |
| M2 | **Categories are known** — spacing/case/NBSP tolerated; an unknown category is an error, never guessed. |
| M3 | **Templates exist** on the JSAN Zabbix server for every plan and every device type the kit can emit (live). |
| M4 | **Real time** — every monitored item has an up/down check every ≤ 60 s (live). Hikvision's template has none, so ICMP Ping is linked with it. |
| M5 | **Claims are real** — everything the plan says is watched (disks, fans, PSUs, battery, ports, VPN, inlet temperature…) matches an item, prototype or trigger in the template, for direct and via items (live). |
| M6 | **Onboarding can apply it** — every direct plan is a `DEVICE_TYPES` entry the CSV validator accepts, with the same templates (model-specific MikroTik templates included). |
| M7 | **Location travels with the item** — `location`, `area`, `inventory` (and `site`, `ci`, `device`) tags on the Zabbix host; Hikvision ISAPI host is the literal address, password a secret macro. |
| M8 | **Honest about the rest** — passive items are never claimed as monitored and always say why; "via" items say through what. |
| M9 | **Gaps are explicit** — per-camera video loss, door events, LTE signal, rooms with no temperature sensor, via-items with no monitored parent. |
| M10 | **Third-party equipment** — a router owned by the ISP (e.g. CBN, Lintasartha) is watched as the ISP link (ping), not via SNMP; spares (InStock/NoUse) are planned but inactive. |
| M11 | **Sheet data problems are reported** — empty status/location/model/serial, unknown status, duplicate serials, numbered empty rows, numbering gaps, repeated numbers. |
| M12 | **Reads the real workbook** — shared/inline/rich strings, sparse cells, NBSP, line breaks, empty sheets; non-.xlsx input fails clearly. No dependencies. |
| M13 | **No secrets or serials in git** — the fixture has no serials/remarks; device passwords only as secret macros. |
| M14 | **Hardware / Networking / Software** — every component placed in an area; all PRJ-008 networking gear (ISP routers, firewalls, routers, APs, optics, LTE, network cables) accounted for. |
| M15 | **Software layer** — every monitored device states firmware/OS coverage (none needs a reason); servers get firmware via iDRAC **and** OS via the agent; each claim matches its template (live, Linux and Windows agent templates checked separately). |

## Verification (2026-10-15)

`[PRJ-008] Site Level Inventory Details.xlsx` — sheets ID, TH (WIP), SA (WIP), BG_Sofia (empty):

| | Direct | Via | Partial | None |
| --- | --- | --- | --- | --- |
| Hardware (149 items) | 31 | 18 | – | 100 |
| Networking (26 items) | 13 | 3 | – | 10 |
| Software layers (56) | 33 | – | 10 | 13 |

- Offline rubric: 40/40 tests (incl. the real workbook via `INVENTORY_XLSX`).
- Live rubric: M3/M4/M5/M15 pass on local Zabbix 7.0.31 **and production** (Railway, 7.0.31) — 116/116 checks.
- 0 unknown items, 0 sheet errors; 105 warnings to fix in the sheets (mostly TH blanks: status 41, location 37), 9 known gaps.
- The rubric caught and corrected two wrong claims during the build: "Generic by SNMP" has no port monitoring (APs moved to "Network Generic Device by SNMP"), and iDRAC does not report network ports (SFPs are watched through routers/firewalls only).

What the sheet alone can't give: device IP addresses and SNMP/ISAPI credentials.
Those go into the onboarding CSV (`tools/onboarding-kit/README.md`) when the
site is actually brought under monitoring.
