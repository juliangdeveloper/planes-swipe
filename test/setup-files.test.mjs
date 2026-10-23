import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { COLUMN_HELP, HEADERS } from "../js/config.js";
import { buildTemplate, readSourceScript, SCRIPT_REL, TEMPLATE_REL } from "../scripts/build-setup.mjs";

const root = join(import.meta.dirname, "..");

function unzipStore(buf) {
  const files = new Map();
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compressed = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");
    const dataStart = nameStart + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compressed);
    assert.equal(method, 0, name);
    files.set(name, Buffer.from(data));
    offset = dataStart + compressed;
  }
  return files;
}

function decodeXml(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function sheetMatrix(xml) {
  const rows = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cell of row[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) cells.push(decodeXml(cell[1]));
    rows.push(cells);
  }
  return rows;
}

const PRIVATE = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /spreadsheets\/d\/[A-Za-z0-9_-]{8,}/,
  /drive\.google\.com\/(?:file\/d\/|open\?id=)[A-Za-z0-9_-]{8,}/,
  /\/macros\/s\/[A-Za-z0-9_-]{8,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
];

test("setup downloads match the schema and carry no personal data", () => {
  assert.deepEqual(Object.keys(COLUMN_HELP), HEADERS);
  for (const header of HEADERS) assert.ok(COLUMN_HELP[header].trim().length > 8, header);

  const xlsx = readFileSync(join(root, TEMPLATE_REL));
  assert.deepEqual(xlsx, buildTemplate());
  const files = unzipStore(xlsx);
  const sheet = files.get("xl/worksheets/sheet1.xml").toString("utf8");
  const matrix = sheetMatrix(sheet);
  assert.deepEqual(matrix[0], HEADERS);
  assert.equal(matrix.length, 3);
  assert.equal(matrix[1][0], "EJEMPLO-001");
  assert.equal(matrix[2][0], "EJEMPLO-002");
  assert.match(files.get("xl/workbook.xml").toString("utf8"), /name="Eventos"/);
  assert.equal(matrix[1][HEADERS.indexOf("preferencia")], "");
  assert.equal(matrix[1][HEADERS.indexOf("calificado_en")], "");
  assert.equal(matrix[2][HEADERS.indexOf("estado")], "Entradas a la venta");

  const script = readFileSync(join(root, SCRIPT_REL));
  assert.deepEqual(script, readSourceScript());
  assert.match(script.toString("utf8"), /var sheet = sheets\[0\];/);
  assert.match(script.toString("utf8"), /quiero ir/);

  const help = readFileSync(join(root, "index.html"), "utf8");
  const helpStart = help.indexOf('id="help-dialog"');
  assert.ok(helpStart > 0);
  const blob = [
    help.slice(helpStart),
    script.toString("utf8"),
    sheet,
    Object.values(COLUMN_HELP).join("\n"),
  ].join("\n");
  for (const pattern of PRIVATE) assert.doesNotMatch(blob, pattern);
});
