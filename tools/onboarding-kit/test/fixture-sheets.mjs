// Shared by the coverage rubric tests: the PRJ-008 fixture as workbook sheets.
import { readFileSync } from "node:fs";

export const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/prj-008-items.json", import.meta.url), "utf8"));
const HEADER = [
  "Inventory Number", "Category", "Inventory Item Name", "Quantity", "Inventory Model Number", "Item Serial Number",
  "Item Located At", "Status", "Owner", "JSAN_Barcode Sticker Created & Attached", "Remark",
];

/** The fixture as workbook sheets (one per site), numbered SITE_INV_0001… */
export function fixtureSheets(items = FIXTURE) {
  const bySite = new Map();
  for (const it of items) bySite.set(it.site, [...(bySite.get(it.site) ?? []), it]);
  return [...bySite].map(([site, rows]) => ({
    name: `${site}_Asset_Tracker`,
    rows: [
      Object.assign([...HEADER], { row: 1 }),
      ...rows.map((it, i) => Object.assign(
        [`${site}_INV_${String(i + 1).padStart(4, "0")}`, it.category, it.name, "1", it.model, `SN-${site}-${i + 1}`, it.location ?? "", it.status ?? "", it.owner, "", ""],
        { row: i + 2 },
      )),
    ],
  }));
}

