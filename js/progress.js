import { APP_ID } from "./config.js";
import { TIPO_STAT, metaBackfill, readMeta, registerStats, scheduleMetaUpdate } from "./meta.js";
import { loadQueue, loadQuieroQueue } from "./queue.js";
import { isQuieroIr, normalizePreferencia } from "./sheet.js";

const RATING_KEYS = {
  me_encanta: "ratings_me_encanta",
  me_gusta: "ratings_me_gusta",
  me_interesa: "ratings_me_interesa",
  no_me_gusta: "ratings_no_me_gusta",
};

export const STATS = Object.freeze({
  sessions: { tipo: TIPO_STAT.TOTAL_ACUMULADO, unidad: "sesiones abiertas" },
  undos: { tipo: TIPO_STAT.TOTAL_ACUMULADO, unidad: "calificaciones deshechas" },
  plans_total: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "planes en la hoja" },
  plans_rated: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "planes calificados" },
  plans_unrated: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "planes sin calificar" },
  ratings_me_encanta: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "planes calificados me encanta" },
  ratings_me_gusta: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "planes calificados me gusta" },
  ratings_me_interesa: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "planes calificados me interesa" },
  ratings_no_me_gusta: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "planes calificados no me gusta" },
  ratings_other: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "planes con otra calificación" },
  comments: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "planes con comentario" },
  quiero_ir: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "planes marcados quiero ir" },
  queue_pending: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "calificaciones sin sincronizar" },
  quiero_pending: { tipo: TIPO_STAT.VALOR_ACTUAL, unidad: "marcas quiero ir sin sincronizar" }
});

registerStats(STATS);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export const ACHIEVEMENTS = [
  { id: "first_session", when: (s) => s.sessions >= 1 },
  { id: "first_rating", when: (s) => s.plans_rated >= 1 },
  { id: "first_comment", when: (s) => s.comments >= 1 },
  { id: "first_quiero", when: (s) => s.quiero_ir >= 1 },
  { id: "every_rating", when: (s) => s.ratings_me_encanta >= 1 && s.ratings_me_gusta >= 1 && s.ratings_me_interesa >= 1 && s.ratings_no_me_gusta >= 1 },
  { id: "ten_rated", when: (s) => s.plans_rated >= 10 },
  { id: "fifty_rated", when: (s) => s.plans_rated >= 50 },
  { id: "hundred_rated", when: (s) => s.plans_rated >= 100 },
  { id: "ten_quiero", when: (s) => s.quiero_ir >= 10 },
  { id: "used_undo", when: (s) => s.undos >= 1 },
  { id: "offline_queue", when: (s) => s.queue_pending >= 1 || s.quiero_pending >= 1 },
  { id: "ten_sessions", when: (s) => s.sessions >= 10 },
];

function earned(stats) {
  const ids = [];
  for (const item of ACHIEVEMENTS) {
    try {
      if (item.when(stats)) ids.push(item.id);
    } catch {
    }
  }
  return ids;
}

export function collectProgress(rows, storage, cumulative = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const stats = {
    sessions: finite(cumulative.sessions),
    undos: finite(cumulative.undos),
    plans_total: 0,
    plans_rated: 0,
    plans_unrated: 0,
    ratings_me_encanta: 0,
    ratings_me_gusta: 0,
    ratings_me_interesa: 0,
    ratings_no_me_gusta: 0,
    ratings_other: 0,
    comments: 0,
    quiero_ir: 0,
    queue_pending: 0,
    quiero_pending: 0,
  };
  for (const row of list) {
    const preference = normalizePreferencia(row?.preferencia);
    if (!preference) stats.plans_unrated += 1;
    else {
      stats.plans_rated += 1;
      const key = RATING_KEYS[preference];
      if (key) stats[key] += 1;
      else stats.ratings_other += 1;
    }
    if (String(row?.comentario_usuario ?? "").trim()) stats.comments += 1;
    if (isQuieroIr(row?.["quiero ir"])) stats.quiero_ir += 1;
  }
  stats.plans_total = list.length;
  try {
    stats.queue_pending = loadQueue(storage).length;
  } catch {
    stats.queue_pending = 0;
  }
  try {
    stats.quiero_pending = loadQuieroQueue(storage).length;
  } catch {
    stats.quiero_pending = 0;
  }
  return { stats, logros: earned(stats) };
}

export function backfillProgress(storage, rows, version, now) {
  const progress = collectProgress(rows, storage, { sessions: 1, undos: 0 });
  return metaBackfill(APP_ID, version, progress, storage, now);
}

export function syncProgress(storage, rows, version, cumulative = {}) {
  const progress = collectProgress(rows, storage, cumulative);
  scheduleMetaUpdate(APP_ID, version, progress, storage);
  return progress;
}

export function startProgress(storage, rows, version, { loaded = false } = {}) {
  const existing = readMeta(APP_ID, storage);
  if (!existing) {
    return { sessions: 1, undos: 0, record: backfillProgress(storage, rows, version) };
  }
  const sessions = finite(existing.stats?.sessions) + 1;
  const undos = finite(existing.stats?.undos);
  if (!loaded) {
    const local = collectProgress([], storage, { sessions, undos });
    const view = { ...(existing.stats || {}) };
    view.sessions = sessions;
    view.undos = undos;
    view.queue_pending = local.stats.queue_pending;
    view.quiero_pending = local.stats.quiero_pending;
    scheduleMetaUpdate(APP_ID, version, {
      stats: {
        sessions,
        undos,
        queue_pending: local.stats.queue_pending,
        quiero_pending: local.stats.quiero_pending,
      },
      logros: earned(view),
    }, storage);
    return { sessions, undos };
  }
  scheduleMetaUpdate(APP_ID, version, collectProgress(rows, storage, { sessions, undos }), storage);
  return { sessions, undos };
}
