import test from "node:test";
import assert from "node:assert/strict";
import {
  ESTADO_FASE, FASE, PROYECTO, TIPO_STAT, flushScheduledMeta, metaProyecto, metaStorageKey, metaUpdate, registerStats, scheduleMetaUpdate,
} from "../js/meta.js";
import { STATS } from "../js/progress.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

test("los enums están congelados y PROYECTO usa sus valores", () => {
  for (const e of [FASE, ESTADO_FASE, TIPO_STAT, STATS]) assert.ok(Object.isFrozen(e));
  assert.deepEqual(Object.values(FASE), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(Object.values(ESTADO_FASE), [0, 1, 2, 3, 4]);
  assert.equal(PROYECTO.fase, FASE.DISENO);
  assert.equal(PROYECTO.fase_estado, ESTADO_FASE.EN_CURSO);
  assert.deepEqual(metaProyecto(PROYECTO), { ...PROYECTO });
});

test("cada stat declara un tipo válido y una unidad, y la mezcla respeta su tipo", () => {
  const tipos = Object.values(TIPO_STAT);
  const keys = Object.keys(STATS);
  assert.ok(keys.length >= 1 && keys.length <= 20);
  for (const key of keys) {
    assert.ok(tipos.includes(STATS[key].tipo), key);
    assert.ok(typeof STATS[key].unidad === "string" && STATS[key].unidad.length > 0, key);
  }
  registerStats(STATS);
  const storage = memoryStorage();
  const alto = {};
  const bajo = {};
  for (const key of keys) {
    alto[key] = 10;
    bajo[key] = 3;
  }
  metaUpdate("planes-swipe-tipos", "1", { stats: alto, logros: [] }, storage);
  scheduleMetaUpdate("planes-swipe-tipos", "1", { stats: bajo, logros: [] }, storage);
  flushScheduledMeta(storage, "planes-swipe-tipos");
  const record = JSON.parse(storage.getItem(metaStorageKey("planes-swipe-tipos")));
  for (const key of keys) {
    assert.equal(record.stats[key], STATS[key].tipo === TIPO_STAT.VALOR_ACTUAL ? 3 : 10, key);
  }
});
