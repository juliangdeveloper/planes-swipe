import assert from "node:assert/strict";
import test from "node:test";
import { HEADERS } from "../js/config.js";
import { createEnv, payload } from "./gas-harness.mjs";

function sampleRow(overrides = {}) {
  return {
    id: "EV-001",
    fecha_registro: "2026-10-01",
    nombre_evento: "Feria del libro",
    categoria: "Libros",
    fecha_evento: "2026-11-21",
    ciudad: "Bogotá",
    departamento: "Cundinamarca",
    lugar: "Corferias",
    precio: "45000",
    estado: "Entradas a la venta",
    link_info: "https://example.com/feria",
    link_entradas: "",
    para_quien: "Ambos",
    motivo_recomendacion: "Valen quiere la firma.",
    ultima_revision: "2026-10-12",
    preferencia: "",
    calificado_en: "",
    comentario_usuario: "",
    imagen_1: "",
    imagen_2: "",
    imagen_3: "",
    ...overrides,
  };
}

function column(name) {
  return HEADERS.indexOf(name);
}

function post(env, body, key = "s3cret") {
  return payload(env.doPost({
    postData: { contents: JSON.stringify({ key, ...body }), type: "text/plain" },
  }));
}

test("rejects a key that does not match SECRET", () => {
  const env = createEnv({ rows: [sampleRow()] });
  const denied = payload(env.doGet({ parameter: { action: "list", key: "nope" } }));
  assert.deepEqual(denied, { ok: false, error: "forbidden" });
  assert.deepEqual(payload(env.doGet({ parameter: { action: "list" } })), { ok: false, error: "forbidden" });
  assert.equal(post(env, { action: "rate", id: "EV-001", preferencia: "me_gusta" }, "s3cre").error, "forbidden");
  assert.equal(post(env, { action: "rate", id: "EV-001", preferencia: "me_gusta" }, "s3cret-extra").error, "forbidden");
  assert.equal(env.writes.length, 0);
  assert.equal(env.locks.length, 0);

  const open = createEnv({ secret: "", rows: [sampleRow()] });
  assert.equal(payload(open.doGet({ parameter: { action: "list", key: "" } })).error, "forbidden");
});

test("lists rows of the first sheet as objects keyed by header", () => {
  const dated = sampleRow({ id: "EV-001", preferencia: "me_intriga" });
  const env = createEnv({
    rows: [dated, sampleRow({ id: "", nombre_evento: "sin id" }), sampleRow({ id: "EV-002", nombre_evento: "Teatro" })],
    extraRows: [sampleRow({ id: "EV-999", nombre_evento: "Otra pestaña" })],
  });
  const fechaCol = column("fecha_evento");
  const precioCol = column("precio");
  env.values[1][fechaCol] = new Date("2026-11-21T05:00:00Z");
  env.values[1][precioCol] = 45000;
  env.values[0][column("preferencia")] = "Preferencia";

  const output = env.doGet({ parameter: { action: "list", key: "s3cret" } });
  assert.equal(output.mimeType, "application/json");
  const listed = payload(output);
  assert.equal(listed.ok, true);
  assert.equal(listed.title, "Eventos y planes — Julian y Valen");
  assert.deepEqual(listed.rows.map((row) => row.id), ["EV-001", "EV-002"]);
  assert.equal(listed.rows[0].preferencia, "me_interesa");
  assert.equal(listed.rows[0].nombre_evento, "Feria del libro");
  assert.equal(listed.rows[0].fecha_evento, "2026-11-21");
  assert.equal(listed.rows[0].precio, "45000");
  assert.equal(env.values[1][column("preferencia")], "me_intriga");
  assert.equal(env.locks.length, 0);
  assert.equal(payload(env.doGet({ parameter: { action: "nope", key: "s3cret" } })).error, "bad_request");
});

test("rates by id at write time and only touches the three rating cells", () => {
  const env = createEnv({
    rows: [
      sampleRow({ id: "EV-001", nombre_evento: "Feria del libro", precio: "45000" }),
      sampleRow({ id: "EV-002", nombre_evento: "Teatro", preferencia: "me_gusta" }),
    ],
  });
  const before = env.snapshot();
  env.values.splice(1, 0, before[2].slice());
  env.values[2] = before[1].slice();

  const rated = post(env, {
    action: "rate",
    id: "EV-001",
    preferencia: " me_intriga ",
    comentario_usuario: "  vamos  ",
  });
  assert.equal(rated.ok, true);
  assert.equal(rated.preferencia, "me_interesa");
  assert.match(rated.calificado_en, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-05:00$/);
  assert.equal(rated.comentario_usuario, "vamos");
  assert.equal(env.values[2][column("id")], "EV-001");
  assert.equal(env.values[2][column("preferencia")], "me_interesa");
  assert.equal(env.values[1][column("preferencia")], "me_gusta");
  assert.equal(env.values[2][column("nombre_evento")], "Feria del libro");
  assert.equal(env.values[2][column("precio")], "45000");
  assert.deepEqual(
    env.writes.map((write) => write.col).sort((a, b) => a - b),
    [column("preferencia") + 1, column("calificado_en") + 1, column("comentario_usuario") + 1].sort((a, b) => a - b),
  );
  assert.deepEqual(env.locks, [["waitLock", 30000], "flush", "releaseLock"]);
});

test("clears a rating, rejects unknown values, and verifies the write", () => {
  const env = createEnv({
    rows: [sampleRow({ preferencia: "me_gusta", calificado_en: "2026-10-01T10:00:00-05:00", comentario_usuario: "antes" })],
  });
  const cleared = post(env, { action: "rate", id: "EV-001", preferencia: "", comentario_usuario: "" });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.preferencia, "");
  assert.equal(cleared.calificado_en, "");
  assert.equal(env.values[1][column("preferencia")], "");
  assert.equal(env.values[1][column("calificado_en")], "");

  const invalid = createEnv({ rows: [sampleRow()] });
  assert.equal(post(invalid, { action: "rate", id: "EV-001", preferencia: "me_ama" }).error, "rating");
  assert.equal(invalid.writes.length, 0);
  assert.equal(invalid.locks.length, 0);
  assert.equal(post(invalid, { action: "rate", id: "EV-404", preferencia: "me_gusta" }).error, "missing_id");
  assert.equal(invalid.writes.length, 0);
  assert.deepEqual(invalid.locks, [["waitLock", 30000], "releaseLock"]);
  assert.equal(payload(invalid.doPost({ postData: { contents: "no-json" } })).error, "bad_request");

  const flaky = createEnv({ rows: [sampleRow()], failPreferencia: 1 });
  const mismatch = post(flaky, { action: "rate", id: "EV-001", preferencia: "me_encanta", comentario_usuario: "si" });
  assert.equal(mismatch.error, "mismatch");
  assert.equal(flaky.values[1][column("preferencia")], "");
  const retried = post(flaky, { action: "rate", id: "EV-001", preferencia: "me_encanta", comentario_usuario: "si" });
  assert.equal(retried.ok, true);
  assert.equal(flaky.values[1][column("preferencia")], "me_encanta");
  assert.equal(flaky.values[1][column("nombre_evento")], "Feria del libro");

  const locked = createEnv({ rows: [sampleRow()], lockMode: "timeout" });
  assert.equal(post(locked, { action: "rate", id: "EV-001", preferencia: "me_gusta" }).error, "lock");
  assert.equal(locked.locks.includes("releaseLock"), false);
  assert.equal(locked.writes.length, 0);
});
