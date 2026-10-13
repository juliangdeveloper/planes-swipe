import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { HEADERS } from "../js/config.js";
import { objectsToMatrix } from "../js/sheet.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "apps-script/Code.gs"), "utf8");

export function formatDate(date, timeZone, pattern) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => {
    const value = parts.find((part) => part.type === type)?.value || "00";
    return type === "hour" && value === "24" ? "00" : value;
  };
  const tokens = {
    yyyy: pick("year"),
    MM: pick("month"),
    dd: pick("day"),
    HH: pick("hour"),
    mm: pick("minute"),
    ss: pick("second"),
  };
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === "'") {
      if (pattern[i + 1] === "'") {
        out += "'";
        i += 1;
        continue;
      }
      const end = pattern.indexOf("'", i + 1);
      out += pattern.slice(i + 1, end === -1 ? pattern.length : end);
      i = end === -1 ? pattern.length : end;
      continue;
    }
    const token = Object.keys(tokens).find((name) => pattern.startsWith(name, i));
    if (token) {
      out += tokens[token];
      i += token.length - 1;
      continue;
    }
    out += pattern[i];
  }
  return out;
}

function createSheet(matrix, failPreferencia) {
  const values = matrix.map((row) => row.slice());
  const prefIndex = (values[0] || []).findIndex((cell) => String(cell).trim().toLowerCase() === "preferencia");
  let remaining = failPreferencia;
  const writes = [];
  const api = {
    getLastRow() {
      return values.length;
    },
    getLastColumn() {
      return values.reduce((max, row) => Math.max(max, row.length), 0);
    },
    getRange(row, col, numRows, numCols) {
      const height = numRows == null ? 1 : numRows;
      const width = numCols == null ? 1 : numCols;
      return {
        getValue() {
          return values[row - 1]?.[col - 1] ?? "";
        },
        getValues() {
          const out = [];
          for (let r = 0; r < height; r += 1) {
            const line = [];
            for (let c = 0; c < width; c += 1) line.push(values[row - 1 + r]?.[col - 1 + c] ?? "");
            out.push(line);
          }
          return out;
        },
        setValue(value) {
          writes.push({ row, col, value });
          if (col - 1 === prefIndex && remaining > 0) {
            remaining -= 1;
            return;
          }
          while (values.length < row) values.push([]);
          const line = values[row - 1];
          while (line.length < col) line.push("");
          line[col - 1] = value;
        },
      };
    },
  };
  return { api, values, writes };
}

export function payload(output) {
  return JSON.parse(output.getContent());
}

export function createEnv({
  secret = "s3cret",
  rows = [],
  extraRows = null,
  failPreferencia = 0,
  lockMode = "ok",
  title = "Eventos y planes — Julian y Valen",
} = {}) {
  const main = createSheet(objectsToMatrix(rows, HEADERS), failPreferencia);
  const sheets = [main];
  if (extraRows) sheets.push(createSheet(objectsToMatrix(extraRows, HEADERS), 0));
  const locks = [];
  const sandbox = {
    Object,
    Array,
    String,
    Number,
    Math,
    JSON,
    Date,
    Error,
    isFinite,
    isNaN,
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getName: () => title,
          getSheets: () => sheets.map((sheet) => sheet.api),
        };
      },
      flush() {
        locks.push("flush");
      },
    },
    LockService: {
      getScriptLock() {
        return {
          waitLock(ms) {
            locks.push(["waitLock", ms]);
            if (lockMode === "timeout") throw new Error("timeout");
          },
          releaseLock() {
            locks.push("releaseLock");
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            return name === "SECRET" ? secret : null;
          },
        };
      },
    },
    Utilities: { formatDate },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(text) {
        return {
          text,
          mimeType: "",
          setMimeType(mime) {
            this.mimeType = mime;
            return this;
          },
          getContent() {
            return this.text;
          },
        };
      },
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "apps-script/Code.gs" });
  return {
    doGet: sandbox.doGet,
    doPost: sandbox.doPost,
    locks,
    writes: main.writes,
    values: main.values,
    snapshot: () => main.values.map((row) => row.map((cell) => (cell instanceof Date ? cell.toISOString() : cell))),
  };
}
