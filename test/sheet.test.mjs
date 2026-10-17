import assert from "node:assert/strict";
import test from "node:test";
import { HEADERS, QUIERO_HEADER } from "../js/config.js";
import { bogotaIso, formatFecha, formatPrecio } from "../js/format.js";
import { createMemoryStorage, enqueue, enqueueQuiero, loadQueue, loadQuieroQueue } from "../js/queue.js";
import {
  columnLetter,
  commitQuieroRetry,
  commitRatingRetry,
  createMemoryClient,
  firstSheetTitle,
  loadGrid,
  normalizePreferencia,
  quoteSheet,
  rowsFromValues,
} from "../js/sheet.js";

test("bogota timestamps use the America/Bogota offset", () => {
  assert.equal(bogotaIso(new Date("2026-10-13T18:30:00Z")), "2026-10-13T13:30:00-05:00");
  assert.equal(bogotaIso(new Date("2026-10-14T02:30:00Z")), "2026-10-13T21:30:00-05:00");
});

test("fecha and precio format for the card", () => {
  assert.match(formatFecha("2026-11-21"), /21/);
  assert.match(formatFecha("2026-11-21"), /nov/i);
  assert.equal(formatFecha("pronto"), "pronto");
  assert.equal(formatPrecio("Gratis"), "Gratis");
  assert.equal(formatPrecio("$50.000"), "$50.000");
  assert.equal(
    formatPrecio("480000"),
    new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(480000),
  );
});

test("legacy me_intriga is read and rewritten as me_interesa", async () => {
  assert.equal(normalizePreferencia("me_intriga"), "me_interesa");
  assert.equal(normalizePreferencia(" me_intriga "), "me_interesa");
  assert.equal(normalizePreferencia("me_interesa"), "me_interesa");
  const matrix = [
    ["nombre_evento", "preferencia", "id", "calificado_en", "comentario_usuario"],
    ["Feria del libro", "me_intriga", "EV-061", "2026-10-08T18:40:00-05:00", "hola"],
  ];
  assert.equal(rowsFromValues(matrix).rows[0].preferencia, "me_interesa");
  assert.equal(rowsFromValues(matrix).rows[0].nombre_evento, "Feria del libro");

  const client = createMemoryClient(matrix, { title: "Primera" });
  const grid = await loadGrid(client, "file");
  assert.equal(grid.tabTitle, "Primera");
  assert.equal(grid.rows[0].preferencia, "me_interesa");

  const result = await commitRatingRetry(client, {
    spreadsheetId: "file",
    eventId: "EV-061",
    preferencia: "me_intriga",
    comentario: "sigue en el radar",
    calificadoEn: "2026-10-13T13:30:00-05:00",
  });
  assert.equal(result.ok, true);
  assert.equal(result.retried, false);
  const snap = client.snapshot();
  assert.equal(snap[1][0], "Feria del libro");
  assert.equal(snap[1][1], "me_interesa");
  assert.equal(snap[1][2], "EV-061");
  assert.equal(snap[1][3], "2026-10-13T13:30:00-05:00");
  assert.equal(snap[1][4], "sigue en el radar");
});

test("writes by header name and verifies", async () => {
  const matrix = [
    ["precio", "id", "preferencia", "calificado_en", "comentario_usuario"],
    ["10", "EV-001", "", "", ""],
    ["20", "EV-002", "", "", ""],
  ];
  const client = createMemoryClient(matrix, { title: "Primera" });
  const result = await commitRatingRetry(client, {
    spreadsheetId: "file",
    eventId: "EV-002",
    preferencia: "me_gusta",
    comentario: "hola",
    calificadoEn: "2026-10-13T13:30:00-05:00",
  });
  assert.equal(result.ok, true);
  const snap = client.snapshot();
  assert.equal(snap[2][2], "me_gusta");
  assert.equal(snap[2][3], "2026-10-13T13:30:00-05:00");
  assert.equal(snap[2][4], "hola");
  assert.equal(snap[1][2], "");
});

test("re-reads the id column and retries once when the write is overwritten", async () => {
  const headers = ["fecha_evento", "id", "precio", "preferencia", "calificado_en", "comentario_usuario"];
  let ids = ["id", "EV-001", "EV-002", "EV-009"];
  let pref = ["preferencia", "", "", ""];
  const writes = [];
  const client = {
    async getSpreadsheet() {
      return { sheets: [{ properties: { title: "Hoja 1", index: 0 } }] };
    },
    async batchGet(_id, ranges) {
      return ranges.map((range) => {
        if (range.endsWith("!1:1")) return { values: [headers] };
        if (range.includes("!B:B")) return { values: ids.map((value) => [value]) };
        if (range.includes("!D")) {
          const row = Number(range.match(/D(\d+)/)[1]);
          return { values: [[pref[row - 1] ?? ""]] };
        }
        throw new Error(range);
      });
    },
    async batchUpdate(_id, data) {
      writes.push(data.map((item) => item.range));
      if (writes.length === 1) {
        ids = ["id", "EV-001", "EV-002", "", "", "EV-009"];
        pref = ["preferencia", "", "", "", "", ""];
        return;
      }
      const row = Number(data[0].range.match(/(\d+)$/)[1]);
      pref[row - 1] = data[0].values[0][0];
    },
  };
  const result = await commitRatingRetry(client, {
    spreadsheetId: "abc",
    eventId: "EV-009",
    preferencia: "me_encanta",
    comentario: "vamos",
    calificadoEn: "2026-10-13T08:00:00-05:00",
  });
  assert.equal(result.ok, true);
  assert.equal(result.retried, true);
  assert.equal(result.attempts, 2);
  assert.ok(writes[0].some((range) => range.includes("!D4")));
  assert.ok(writes[1].some((range) => range.includes("!D6")));
  assert.ok(writes[1].some((range) => range.includes("!E6")));
  assert.ok(writes[1].some((range) => range.includes("!F6")));
  assert.equal(pref[5], "me_encanta");
});

test("a missing id is not written and is not retried", async () => {
  let writes = 0;
  const client = {
    async getSpreadsheet() {
      return { sheets: [{ properties: { title: "Hoja", index: 0 } }] };
    },
    async batchGet(_id, ranges) {
      return ranges.map((range) => {
        if (range.endsWith("!1:1")) {
          return { values: [["id", "preferencia", "calificado_en", "comentario_usuario"]] };
        }
        return { values: [["id"], ["EV-001"]] };
      });
    },
    async batchUpdate() {
      writes += 1;
    },
  };
  const result = await commitRatingRetry(client, {
    spreadsheetId: "abc",
    eventId: "EV-404",
    preferencia: "me_gusta",
    comentario: "",
    calificadoEn: "2026-10-13T08:00:00-05:00",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_id");
  assert.equal(result.retried, false);
  assert.equal(writes, 0);
});

test("first tab is the lowest index, not the first array entry", () => {
  const title = firstSheetTitle({
    sheets: [
      { properties: { title: "Otra", index: 1 } },
      { properties: { title: "Primera", index: 0 } },
    ],
  });
  assert.equal(title, "Primera");
  assert.equal(quoteSheet("O'Hara"), "'O''Hara'");
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
});

test("quiero ir is column V and is read from booleans", () => {
  assert.equal(HEADERS.indexOf(QUIERO_HEADER), 21);
  assert.equal(columnLetter(HEADERS.indexOf(QUIERO_HEADER)), "V");
  const parsed = rowsFromValues([
    ["id", "quiero ir", "preferencia"],
    ["EV-001", true, ""],
    ["EV-002", false, "me_gusta"],
    ["EV-003", "TRUE", ""],
    ["EV-004", "FALSE", ""],
  ]);
  assert.deepEqual(parsed.rows.map((row) => row["quiero ir"]), ["TRUE", "FALSE", "TRUE", "FALSE"]);
  assert.equal(parsed.rows[1].preferencia, "me_gusta");
});

test("quiero ir writes by header name and a rating does not clear it", async () => {
  const matrix = [
    ["quiero ir", "precio", "id", "preferencia", "calificado_en", "comentario_usuario"],
    ["FALSE", "10", "EV-001", "me_gusta", "2026-10-13T13:30:00-05:00", "hola"],
    ["TRUE", "20", "EV-002", "", "", ""],
  ];
  const client = createMemoryClient(matrix, { title: "Primera" });
  const off = await commitQuieroRetry(client, { spreadsheetId: "file", eventId: "EV-002", quiero: false });
  assert.equal(off.ok, true);
  assert.equal(off.retried, false);
  let snap = client.snapshot();
  assert.equal(snap[2][0], "FALSE");
  assert.equal(snap[2][2], "EV-002");
  assert.equal(snap[2][3], "");
  assert.equal(snap[1][0], "FALSE");
  assert.equal(snap[1][3], "me_gusta");

  const rated = await commitRatingRetry(client, {
    spreadsheetId: "file",
    eventId: "EV-002",
    preferencia: "me_encanta",
    comentario: "vamos",
    calificadoEn: "2026-10-14T09:00:00-05:00",
  });
  assert.equal(rated.ok, true);
  snap = client.snapshot();
  assert.equal(snap[2][0], "FALSE");
  assert.equal(snap[2][3], "me_encanta");
  assert.equal(snap[2][4], "2026-10-14T09:00:00-05:00");
  assert.equal(snap[2][5], "vamos");
  assert.equal(snap[1][0], "FALSE");
  assert.equal(snap[1][3], "me_gusta");
  assert.equal(snap[1][4], "2026-10-13T13:30:00-05:00");
  assert.equal(snap[1][5], "hola");

  const on = await commitQuieroRetry(client, { spreadsheetId: "file", eventId: "EV-001", quiero: true });
  assert.equal(on.ok, true);
  snap = client.snapshot();
  assert.equal(snap[1][0], "TRUE");
  assert.equal(snap[1][3], "me_gusta");
  assert.equal(snap[1][4], "2026-10-13T13:30:00-05:00");
  assert.equal(snap[1][5], "hola");
  assert.equal(snap[2][3], "me_encanta");
});

test("a missing quiero ir column or id is not written", async () => {
  let writes = 0;
  const client = {
    async getSpreadsheet() {
      return { sheets: [{ properties: { title: "Hoja", index: 0 } }] };
    },
    async batchGet(_id, ranges) {
      return ranges.map((range) => {
        if (range.endsWith("!1:1")) return { values: [["id", "preferencia", "calificado_en", "comentario_usuario"]] };
        return { values: [["id"], ["EV-001"]] };
      });
    },
    async batchUpdate() {
      writes += 1;
    },
  };
  const missingHeader = await commitQuieroRetry(client, { spreadsheetId: "abc", eventId: "EV-001", quiero: true });
  assert.equal(missingHeader.ok, false);
  assert.equal(missingHeader.reason, "headers");
  assert.equal(missingHeader.retried, false);
  const missingId = await commitQuieroRetry({
    ...client,
    async batchGet(_id, ranges) {
      return ranges.map((range) => {
        if (range.endsWith("!1:1")) return { values: [["precio", "quiero ir", "id"]] };
        return { values: [["id"], ["EV-001"]] };
      });
    },
  }, { spreadsheetId: "abc", eventId: "EV-404", quiero: true });
  assert.equal(missingId.ok, false);
  assert.equal(missingId.reason, "missing_id");
  assert.equal(missingId.retried, false);
  assert.equal(writes, 0);
  const bad = await commitQuieroRetry(client, { spreadsheetId: "abc", eventId: "EV-001", quiero: "TRUE" });
  assert.equal(bad.reason, "bad_request");
});

test("offline queue keeps the latest rating per id", () => {
  const storage = createMemoryStorage();
  enqueue(storage, { id: "EV-001", preferencia: "me_gusta", comentario: "", calificado_en: "a", fileId: "demo" });
  enqueue(storage, { id: "EV-001", preferencia: "me_interesa", comentario: "luego", calificado_en: "b", fileId: "demo" });
  enqueue(storage, { id: "EV-002", preferencia: "no_me_gusta", comentario: "", calificado_en: "c", fileId: "demo" });
  const jobs = loadQueue(storage);
  assert.equal(jobs.length, 2);
  assert.equal(jobs.find((job) => job.id === "EV-001").preferencia, "me_interesa");
  enqueueQuiero(storage, { id: "EV-001", quiero: true, endpoint: "https://script.google.com/macros/s/abc/exec" });
  enqueueQuiero(storage, { id: "EV-001", quiero: false, endpoint: "https://script.google.com/macros/s/abc/exec" });
  enqueue(storage, { id: "EV-001", preferencia: "me_gusta", comentario: "", calificado_en: "d", fileId: "demo" });
  assert.equal(loadQueue(storage).find((job) => job.id === "EV-001").preferencia, "me_gusta");
  assert.equal(loadQuieroQueue(storage).find((job) => job.id === "EV-001").quiero, false);
});
