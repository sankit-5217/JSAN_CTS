// Minimal .xlsx reader (no dependencies): enough to read a site inventory
// workbook — every sheet's cell values as text, in row order. Formulas give
// their cached value; styles, merged cells and dates-as-dates are ignored.
// An .xlsx is a zip of XML parts; Node's zlib inflates them.
import { inflateRawSync } from "node:zlib";

/** Zip entries by name → Buffer (stored or deflated only). */
export function unzip(buf) {
  // End of central directory: last occurrence of PK\x05\x06.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not an .xlsx file (no zip directory found)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt .xlsx (bad zip directory)");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`Unsupported zip compression ${method} in ${name}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : ENTITIES[e.toLowerCase()],
  );
}

/** Text of a <si> or <is> element: all <t> runs joined (rich text keeps its text). */
function runsText(xml) {
  let text = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) text += decodeXml(m[1] ?? "");
  return text;
}

/** "AB12" → 27 (0-based column index). */
export function columnIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * @param {Buffer} buf the .xlsx file
 * @returns {{ name: string, rows: string[][] }[]} sheets in workbook order;
 *   each row is an array of cell texts ("" for empty), with `.row` = 1-based row number.
 */
export function readWorkbook(buf) {
  const parts = unzip(buf);
  const text = (name) => parts.get(name)?.toString("utf8");
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("Not an .xlsx workbook (xl/workbook.xml missing)");

  const shared = [];
  const sst = text("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runsText(m[1]));

  const rels = new Map();
  for (const m of (text("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const xml = text(rels.get(rid) ?? "");
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNum = Number(/\br="(\d+)"/.exec(r[1])?.[1] ?? rows.length + 1);
      const cells = [];
      for (const c of (r[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1];
        const type = /\bt="([^"]+)"/.exec(c[1])?.[1];
        const body = c[2] ?? "";
        let value = "";
        if (type === "inlineStr") value = runsText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
        else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          if (v !== undefined) value = type === "s" ? (shared[Number(v)] ?? "") : decodeXml(v);
        }
        cells[ref ? columnIndex(ref) : cells.length] = value;
      }
      const row = Array.from(cells, (v) => v ?? "");
      row.row = rowNum;
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
