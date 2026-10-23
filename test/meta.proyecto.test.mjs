import assert from "node:assert/strict";
import test from "node:test";
import { APP_ID } from "../js/config.js";
import { PROYECTO, metaBackfill, metaProyecto, metaSetProyecto, metaStorageKey, metaUpdate, setMetaLive } from "../js/meta.js";
import { STATS } from "../js/progress.js";

function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

const KEY = metaStorageKey(APP_ID);
const NOW = new Date("2026-10-23T18:00:00.000Z");

test.beforeEach(() => { setMetaLive(true); metaSetProyecto(null); });
test.after(() => metaSetProyecto(null));

test("PROYECTO is a valid block within the shared ranges", () => {
  assert.deepEqual(metaProyecto(PROYECTO), { ...PROYECTO });
  assert.ok(Array.from(PROYECTO.objetivo).length <= 140);
  const keys = Object.keys(STATS);
  assert.equal(keys.some((k) => k === "proyecto" || String(k).startsWith("fase")), false);
});

test("backfill and updates write the proyecto block outside stats", () => {
  const storage = createMemoryStorage();
  assert.ok(metaBackfill(APP_ID, "v9.9.9", { stats: {}, logros: [] }, storage, NOW));
  const stored = JSON.parse(storage.getItem(KEY));
  assert.equal(stored.v, 1);
  assert.deepEqual(stored.proyecto, { ...PROYECTO });
  assert.equal("proyecto" in stored.stats, false);
  const other = createMemoryStorage({ [KEY]: storage.getItem(KEY) });
  metaUpdate(APP_ID, "v9.9.9", { stats: {}, logros: ["first_session"] }, other, NOW);
  assert.deepEqual(JSON.parse(other.getItem(KEY)).proyecto, { ...PROYECTO });
});

test("an invalid block is left out and never throws", () => {
  const bad = [
    "x", [], {},
    { ...PROYECTO, objetivo: "" },
    { ...PROYECTO, objetivo: "a".repeat(141) },
    { ...PROYECTO, objetivo: 5 },
    { ...PROYECTO, fase: 0 }, { ...PROYECTO, fase: 8 }, { ...PROYECTO, fase: 2.5 }, { ...PROYECTO, fase: "4" },
    { ...PROYECTO, fase_estado: -1 }, { ...PROYECTO, fase_estado: 5 },
    { ...PROYECTO, fases_completadas: 7 }, { ...PROYECTO, fases_completadas: NaN },
    { get objetivo() { throw new Error("boom"); } },
  ];
  for (const p of bad) {
    assert.equal(metaProyecto(p), null);
    const storage = createMemoryStorage();
    metaSetProyecto(p);
    let rec;
    assert.doesNotThrow(() => { rec = metaUpdate(APP_ID, "v9.9.9", { stats: {}, logros: ["first_session"] }, storage, NOW); });
    assert.ok(rec);
    const stored = JSON.parse(storage.getItem(KEY));
    assert.equal("proyecto" in stored, false);
    assert.deepEqual(stored.logros, ["first_session"]);
  }
});

test("an old record without proyecto is still valid and gains the block", () => {
  const old = {
    v: 1, slug: APP_ID, version: "0.8.4", updatedAt: "2026-01-01T00:00:00.000Z",
    stats: {}, logros: ["first_session"], hitos: { first_session: "2026-01-01T00:00:00.000Z" },
  };
  const storage = createMemoryStorage({ [KEY]: JSON.stringify(old) });
  const kept = metaBackfill(APP_ID, "v9.9.9", { stats: {}, logros: [] }, storage, NOW);
  assert.deepEqual(kept, old);
  assert.equal(storage.getItem(`${KEY}.corrupt`), null);
  assert.equal(storage.getItem(KEY), JSON.stringify(old));
  const rec = metaUpdate(APP_ID, "v9.9.9", { stats: {}, logros: [] }, storage, NOW);
  assert.equal(rec.hitos.first_session, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(rec.proyecto, { ...PROYECTO });
});

test("a stored record with a different proyecto gets the current block on the next write", () => {
  const old = {
    v: 1, slug: APP_ID, version: "0.8.4", updatedAt: "2026-01-01T00:00:00.000Z",
    stats: {}, logros: ["first_session"], hitos: { first_session: "2026-01-01T00:00:00.000Z" },
    proyecto: { extra: 1, objetivo: "Objetivo anterior.", fase: 2, fase_estado: 3, fases_completadas: 1 },
  };
  const storage = createMemoryStorage({ [KEY]: JSON.stringify(old) });
  metaUpdate(APP_ID, "v9.9.9", { stats: {}, logros: [] }, storage, NOW);
  const rec = JSON.parse(storage.getItem(KEY));
  assert.deepEqual(rec.proyecto, { ...PROYECTO });
  assert.equal(rec.hitos.first_session, "2026-01-01T00:00:00.000Z");
  assert.equal(storage.getItem(`${KEY}.corrupt`), null);

  metaSetProyecto({ fase: 9 });
  const second = createMemoryStorage({ [KEY]: JSON.stringify(old) });
  metaUpdate(APP_ID, "v9.9.9", { stats: {}, logros: [] }, second, NOW);
  assert.equal("proyecto" in JSON.parse(second.getItem(KEY)), false);
});

test("fase 7 (Descartada) is accepted", () => {
  const D = { ...PROYECTO, fase: 7, fase_estado: 4 };
  assert.deepEqual(metaProyecto(D), D);
});
