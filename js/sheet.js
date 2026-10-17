import { QUIERO_HEADER, RATINGS } from "./config.js";

const RATING_IDS = new Set(["", ...RATINGS.map((rating) => rating.id)]);
const NEEDED = ["id", "preferencia", "calificado_en", "comentario_usuario"];

// Sheets written before the rename stored the down-swipe as me_intriga.
export function normalizePreferencia(value) {
  const text = String(value ?? "").trim();
  return text === "me_intriga" ? "me_interesa" : text;
}

// Sheets stores the flag as a boolean, which displays as TRUE/FALSE.
export function isQuieroIr(value) {
  if (value === true) return true;
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function quieroText(value) {
  return isQuieroIr(value) ? "TRUE" : "FALSE";
}

export function columnLetter(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function quoteSheet(title) {
  return `'${String(title).replaceAll("'", "''")}'`;
}

export function firstSheetTitle(spreadsheet) {
  const sheets = Array.isArray(spreadsheet?.sheets) ? spreadsheet.sheets : [];
  const sorted = sheets.slice().sort((a, b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0));
  const title = sorted[0]?.properties?.title;
  if (!title) {
    const err = new Error("no_sheet");
    err.code = "no_sheet";
    throw err;
  }
  return title;
}

export function rowsFromValues(values) {
  const table = Array.isArray(values) ? values : [];
  if (!table.length) return { headers: [], rows: [] };
  const headers = (table[0] || []).map((cell) => String(cell ?? "").trim().toLowerCase());
  const rows = [];
  for (let r = 1; r < table.length; r += 1) {
    const line = table[r] || [];
    const row = {};
    headers.forEach((header, column) => {
      if (!header || Object.prototype.hasOwnProperty.call(row, header)) return;
      const raw = line[column] ?? "";
      if (header === QUIERO_HEADER) {
        row[header] = quieroText(raw);
        return;
      }
      const text = String(raw).trim();
      row[header] = header === "preferencia" ? normalizePreferencia(text) : text;
    });
    if (row.id) rows.push(row);
  }
  return { headers, rows };
}

export function objectsToMatrix(objects, headers) {
  return [
    headers.slice(),
    ...objects.map((row) => headers.map((header) => String(row?.[header] ?? ""))),
  ];
}

export function isUnrated(row) {
  return !String(row?.preferencia ?? "").trim();
}

// The values array is aligned to row 1 because the range starts at row 1.
// Never reuse a row number from a previous read: the sheet is rewritten elsewhere.
export function findRowNumber(columnValues, id) {
  const want = String(id ?? "").trim();
  if (!want) return null;
  for (let i = 0; i < columnValues.length; i += 1) {
    const cell = Array.isArray(columnValues[i]) ? columnValues[i][0] : columnValues[i];
    if (String(cell ?? "").trim() === want) return i + 1;
  }
  return null;
}

function headerIndex(headers, name) {
  return headers.findIndex((header) => header === name);
}

export async function loadGrid(client, spreadsheetId) {
  const meta = await client.getSpreadsheet(spreadsheetId);
  const tabTitle = firstSheetTitle(meta);
  const range = `${quoteSheet(tabTitle)}!A1:ZZ2000`;
  const [got] = await client.batchGet(spreadsheetId, [range]);
  const parsed = rowsFromValues(got?.values || []);
  return {
    spreadsheetTitle: meta?.properties?.title || "",
    tabTitle,
    headers: parsed.headers,
    rows: parsed.rows,
  };
}

export async function commitRating(client, { spreadsheetId, eventId, preferencia, comentario, calificadoEn }) {
  const pref = normalizePreferencia(preferencia);
  if (!RATING_IDS.has(pref)) return { ok: false, reason: "rating" };
  const meta = await client.getSpreadsheet(spreadsheetId);
  const tabTitle = firstSheetTitle(meta);
  const quoted = quoteSheet(tabTitle);
  const [headerGot] = await client.batchGet(spreadsheetId, [`${quoted}!1:1`]);
  const headers = (headerGot?.values?.[0] || []).map((cell) => String(cell ?? "").trim().toLowerCase());
  const columns = Object.fromEntries(NEEDED.map((name) => [name, headerIndex(headers, name)]));
  if (NEEDED.some((name) => columns[name] < 0)) return { ok: false, reason: "headers" };

  const idRange = `${quoted}!${columnLetter(columns.id)}:${columnLetter(columns.id)}`;
  const [idGot] = await client.batchGet(spreadsheetId, [idRange]);
  const rowNumber = findRowNumber(idGot?.values || [], eventId);
  if (!rowNumber) return { ok: false, reason: "missing_id" };

  const data = [
    { range: `${quoted}!${columnLetter(columns.preferencia)}${rowNumber}`, values: [[pref]] },
    { range: `${quoted}!${columnLetter(columns.calificado_en)}${rowNumber}`, values: [[calificadoEn ?? ""]] },
    { range: `${quoted}!${columnLetter(columns.comentario_usuario)}${rowNumber}`, values: [[comentario ?? ""]] },
  ];
  await client.batchUpdate(spreadsheetId, data);

  const verifyRange = `${quoted}!${columnLetter(columns.preferencia)}${rowNumber}`;
  const [verified] = await client.batchGet(spreadsheetId, [verifyRange]);
  const got = String(verified?.values?.[0]?.[0] ?? "").trim();
  return { ok: got === pref, reason: got === pref ? "ok" : "mismatch", row: rowNumber, got };
}

export async function commitRatingRetry(client, args) {
  const first = await commitRating(client, args);
  if (first.ok || first.reason !== "mismatch") return { ...first, attempts: 1, retried: false };
  const second = await commitRating(client, args);
  return { ...second, attempts: 2, retried: true };
}

export async function commitQuiero(client, { spreadsheetId, eventId, quiero }) {
  if (typeof quiero !== "boolean") return { ok: false, reason: "bad_request" };
  const meta = await client.getSpreadsheet(spreadsheetId);
  const tabTitle = firstSheetTitle(meta);
  const quoted = quoteSheet(tabTitle);
  const [headerGot] = await client.batchGet(spreadsheetId, [`${quoted}!1:1`]);
  const headers = (headerGot?.values?.[0] || []).map((cell) => String(cell ?? "").trim().toLowerCase());
  const idColumn = headerIndex(headers, "id");
  const quieroColumn = headerIndex(headers, QUIERO_HEADER);
  if (idColumn < 0 || quieroColumn < 0) return { ok: false, reason: "headers" };

  const idRange = `${quoted}!${columnLetter(idColumn)}:${columnLetter(idColumn)}`;
  const [idGot] = await client.batchGet(spreadsheetId, [idRange]);
  const rowNumber = findRowNumber(idGot?.values || [], eventId);
  if (!rowNumber) return { ok: false, reason: "missing_id" };

  const written = quieroText(quiero);
  const range = `${quoted}!${columnLetter(quieroColumn)}${rowNumber}`;
  await client.batchUpdate(spreadsheetId, [{ range, values: [[written]] }]);

  const [verified] = await client.batchGet(spreadsheetId, [range]);
  const got = quieroText(verified?.values?.[0]?.[0] ?? "");
  return {
    ok: got === written,
    reason: got === written ? "ok" : "mismatch",
    row: rowNumber,
    [QUIERO_HEADER]: got,
  };
}

export async function commitQuieroRetry(client, args) {
  const first = await commitQuiero(client, args);
  if (first.ok || first.reason !== "mismatch") return { ...first, attempts: 1, retried: false };
  const second = await commitQuiero(client, args);
  return { ...second, attempts: 2, retried: true };
}

function columnIndex(letters) {
  let n = 0;
  for (const char of letters) n = n * 26 + (char.charCodeAt(0) - 64);
  return n - 1;
}

function parseRange(range) {
  const bang = range.lastIndexOf("!");
  const a1 = (bang >= 0 ? range.slice(bang + 1) : range).replace(/\$/g, "");
  let match;
  if ((match = /^([A-Z]+):([A-Z]+)$/.exec(a1))) {
    return { c1: columnIndex(match[1]), c2: columnIndex(match[2]), r1: 0, r2: Infinity };
  }
  if ((match = /^(\d+):(\d+)$/.exec(a1))) {
    return { c1: 0, c2: Infinity, r1: Number(match[1]) - 1, r2: Number(match[2]) - 1 };
  }
  if ((match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a1))) {
    return {
      c1: columnIndex(match[1]),
      r1: Number(match[2]) - 1,
      c2: columnIndex(match[3]),
      r2: Number(match[4]) - 1,
    };
  }
  if ((match = /^([A-Z]+)(\d+)$/.exec(a1))) {
    const column = columnIndex(match[1]);
    const row = Number(match[2]) - 1;
    return { c1: column, c2: column, r1: row, r2: row };
  }
  throw new Error(`bad range ${range}`);
}

function readRange(matrix, range) {
  const { r1, r2, c1, c2 } = parseRange(range);
  const lastRow = Math.min(matrix.length - 1, r2);
  const out = [];
  for (let r = r1; r <= lastRow; r += 1) {
    const row = matrix[r] || [];
    const lastCol = Math.min(Math.max(row.length - 1, c1), c2);
    const slice = [];
    for (let c = c1; c <= lastCol; c += 1) slice.push(row[c] ?? "");
    out.push(slice);
  }
  return out;
}

function writeRange(matrix, range, values) {
  const { r1, c1 } = parseRange(range);
  (values || []).forEach((row, dr) => {
    (row || []).forEach((cell, dc) => {
      const r = r1 + dr;
      const c = c1 + dc;
      while (matrix.length <= r) matrix.push([]);
      const line = matrix[r];
      while (line.length <= c) line.push("");
      line[c] = cell == null ? "" : String(cell);
    });
  });
}

export function createMemoryClient(matrix, { title = "Eventos", spreadsheetTitle = "" } = {}) {
  const values = matrix.map((row) => row.map((cell) => String(cell ?? "")));
  return {
    snapshot: () => values.map((row) => row.slice()),
    async getSpreadsheet() {
      return {
        properties: { title: spreadsheetTitle },
        sheets: [
          { properties: { title: "Otra", index: 1 } },
          { properties: { title, index: 0 } },
        ],
      };
    },
    async batchGet(_id, ranges) {
      return ranges.map((range) => ({ range, values: readRange(values, range) }));
    },
    async batchUpdate(_id, data) {
      for (const item of data) writeRange(values, item.range, item.values);
    },
  };
}
