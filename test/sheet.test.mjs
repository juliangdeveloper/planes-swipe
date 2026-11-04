import assert from "node:assert/strict";
import test from "node:test";
import { HEADERS, QUIERO_HEADER } from "../js/config.js";
import { bogotaIso, formatFecha, formatPrecio } from "../js/format.js";
import { createMemoryStorage, enqueue, enqueueQuiero, loadQueue, loadQuieroQueue } from "../js/queue.js";
import { isQuieroIr, normalizePreferencia, quieroText } from "../js/sheet.js";

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

test("legacy me_intriga is read as me_interesa", () => {
  assert.equal(normalizePreferencia("me_intriga"), "me_interesa");
  assert.equal(normalizePreferencia(" me_intriga "), "me_interesa");
  assert.equal(normalizePreferencia("me_interesa"), "me_interesa");
});

test("quiero ir is column V and is read from booleans", () => {
  assert.equal(HEADERS.indexOf(QUIERO_HEADER), 21);
  assert.deepEqual([true, false, "TRUE", "FALSE"].map(quieroText), ["TRUE", "FALSE", "TRUE", "FALSE"]);
  assert.equal(isQuieroIr(" true "), true);
  assert.equal(isQuieroIr(""), false);
});

test("offline queue keeps the latest rating per id", () => {
  const storage = createMemoryStorage();
  enqueue(storage, { id: "EV-001", preferencia: "me_gusta", comentario: "", calificado_en: "a" });
  enqueue(storage, { id: "EV-001", preferencia: "me_interesa", comentario: "luego", calificado_en: "b" });
  enqueue(storage, { id: "EV-002", preferencia: "no_me_gusta", comentario: "", calificado_en: "c" });
  const jobs = loadQueue(storage);
  assert.equal(jobs.length, 2);
  assert.equal(jobs.find((job) => job.id === "EV-001").preferencia, "me_interesa");
  enqueueQuiero(storage, { id: "EV-001", quiero: true, endpoint: "https://script.google.com/macros/s/abc/exec" });
  enqueueQuiero(storage, { id: "EV-001", quiero: false, endpoint: "https://script.google.com/macros/s/abc/exec" });
  enqueue(storage, { id: "EV-001", preferencia: "me_gusta", comentario: "", calificado_en: "d" });
  assert.equal(loadQueue(storage).find((job) => job.id === "EV-001").preferencia, "me_gusta");
  assert.equal(loadQuieroQueue(storage).find((job) => job.id === "EV-001").quiero, false);
});
