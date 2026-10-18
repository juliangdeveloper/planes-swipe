// Regenera downloads/plantilla-eventos.xlsx y downloads/Code.gs
// desde HEADERS y apps-script/Code.gs. Sin datos personales.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HEADERS } from "../js/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TEMPLATE_REL = "downloads/plantilla-eventos.xlsx";
export const SCRIPT_REL = "downloads/Code.gs";
export const SOURCE_SCRIPT_REL = "apps-script/Code.gs";

// Dos planes ficticios. Cada fila declara todas las columnas de HEADERS.
export const EXAMPLE_ROWS = [
  {
    id: "EJEMPLO-001",
    fecha_registro: "2026-10-01",
    nombre_evento: "Feria de luces del barrio",
    categoria: "Cultura",
    fecha_evento: "2026-11-14",
    ciudad: "Ciudad Ejemplo",
    departamento: "Departamento Ejemplo",
    lugar: "Parque Central",
    precio: "Gratis",
    estado: "Solo anuncio",
    link_info: "https://example.com/feria",
    link_entradas: "",
    para_quien: "Invitados",
    motivo_recomendacion: "Paseo corto al atardecer, con puesto de agua de panela.",
    ultima_revision: "2026-10-12",
    preferencia: "",
    calificado_en: "",
    comentario_usuario: "",
    imagen_1: "https://example.com/feria.jpg",
    imagen_2: "",
    imagen_3: "",
    "quiero ir": "FALSE",
  },
  {
    id: "EJEMPLO-002",
    fecha_registro: "2026-10-03",
    nombre_evento: "Concierto en la plaza",
    categoria: "Música",
    fecha_evento: "2026-12-05",
    ciudad: "Ciudad Ejemplo",
    departamento: "Departamento Ejemplo",
    lugar: "Plaza Mayor",
    precio: "45000",
    estado: "Entradas a la venta",
    link_info: "https://example.com/concierto",
    link_entradas: "https://example.com/entradas",
    para_quien: "Amigos",
    motivo_recomendacion: "Empieza temprano y se puede llegar a pie.",
    ultima_revision: "2026-10-11",
    preferencia: "",
    calificado_en: "",
    comentario_usuario: "",
    imagen_1: "https://example.com/concierto.jpg",
    imagen_2: "",
    imagen_3: "",
    "quiero ir": "FALSE",
  },
];

function assertExamples(headers, rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 2) {
    throw new Error("la plantilla necesita 1 o 2 filas de ejemplo");
  }
  for (const row of rows) {
    for (const header of headers) {
      if (!Object.prototype.hasOwnProperty.call(row, header)) {
        throw new Error(`fila de ejemplo sin columna ${header}`);
      }
    }
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) throw new Error(`columna desconocida ${key}`);
    }
  }
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function colLetter(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellXml(ref, value, style) {
  const text = xmlEscape(value);
  const space = /^\s|\s$/.test(String(value)) ? ' xml:space="preserve"' : "";
  const styled = style ? ` s="${style}"` : "";
  return `<c r="${ref}" t="inlineStr"${styled}><is><t${space}>${text}</t></is></c>`;
}

export function sheetRows(headers, rows) {
  assertExamples(headers, rows);
  return [headers, ...rows.map((row) => headers.map((header) => String(row[header] ?? "")))];
}

export function buildSheetXml(matrix) {
  const lastCol = colLetter(matrix[0].length - 1);
  const lastRow = matrix.length;
  const rows = matrix.map((line, rowIndex) => {
    const r = rowIndex + 1;
    const cells = line.map((value, colIndex) => cellXml(`${colLetter(colIndex)}${r}`, value, rowIndex === 0 ? "1" : "")).join("");
    return `<row r="${r}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCol}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>${rows}</sheetData>
</worksheet>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function relsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Eventos" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function workbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Fecha fija para que el .xlsx no cambie en cada generación.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 18;

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, data);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

export function buildTemplate(headers = HEADERS, rows = EXAMPLE_ROWS) {
  const matrix = sheetRows(headers, rows);
  const files = [
    { name: "[Content_Types].xml", data: contentTypesXml() },
    { name: "_rels/.rels", data: relsXml() },
    { name: "xl/workbook.xml", data: workbookXml() },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml() },
    { name: "xl/styles.xml", data: stylesXml() },
    { name: "xl/worksheets/sheet1.xml", data: buildSheetXml(matrix) },
  ];
  return zipStore(files);
}

export function readSourceScript() {
  return readFileSync(join(root, SOURCE_SCRIPT_REL));
}

export function writeSetupFiles() {
  const dir = join(root, "downloads");
  mkdirSync(dir, { recursive: true });
  const xlsx = buildTemplate();
  const script = readSourceScript();
  writeFileSync(join(root, TEMPLATE_REL), xlsx);
  writeFileSync(join(root, SCRIPT_REL), script);
  return { xlsx, script };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) writeSetupFiles();
