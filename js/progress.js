import { APP_ID } from "./config.js";
import { metaBackfill, readMeta, scheduleMetaUpdate } from "./meta.js";
import { loadQueue, loadQuieroQueue } from "./queue.js";
import { isQuieroIr, normalizePreferencia } from "./sheet.js";

const RATING_KEYS = {
  me_encanta: "ratings_me_encanta",
  me_gusta: "ratings_me_gusta",
  me_interesa: "ratings_me_interesa",
  no_me_gusta: "ratings_no_me_gusta",
};

const SHEET_STAT_KEYS = [
  "plans_total",
  "plans_rated",
  "plans_unrated",
  "ratings_me_encanta",
  "ratings_me_gusta",
  "ratings_me_interesa",
  "ratings_no_me_gusta",
  "ratings_other",
  "comments",
  "quiero_ir",
];

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Stable ids. Conditions read counts only.
export const ACHIEVEMENTS = [
  { id: "first_session", when: (s) => s.sessions >= 1 }, // opened the app
  { id: "first_rating", when: (s) => s.plans_rated >= 1 }, // rated one plan
  { id: "first_comment", when: (s) => s.comments >= 1 }, // saved one comment
  { id: "first_quiero", when: (s) => s.quiero_ir >= 1 }, // marked quiero ir once
  { id: "every_rating", when: (s) => s.ratings_me_encanta >= 1 && s.ratings_me_gusta >= 1 && s.ratings_me_interesa >= 1 && s.ratings_no_me_gusta >= 1 }, // used all four ratings
  { id: "ten_rated", when: (s) => s.plans_rated >= 10 }, // rated 10 plans
  { id: "fifty_rated", when: (s) => s.plans_rated >= 50 }, // rated 50 plans
  { id: "hundred_rated", when: (s) => s.plans_rated >= 100 }, // rated 100 plans
  { id: "ten_quiero", when: (s) => s.quiero_ir >= 10 }, // marked quiero ir on 10 plans
  { id: "used_undo", when: (s) => s.undos >= 1 }, // undid one rating
  { id: "offline_queue", when: (s) => s.queue_pending >= 1 || s.quiero_pending >= 1 }, // one change waiting offline
  { id: "ten_sessions", when: (s) => s.sessions >= 10 }, // opened the app 10 times
];

function earned(stats) {
  const ids = [];
  for (const item of ACHIEVEMENTS) {
    try {
      if (item.when(stats)) ids.push(item.id);
    } catch {
      /* ignore */
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
  const progress = collectProgress(loaded ? rows : [], storage, { sessions, undos });
  if (!loaded) {
    const prev = existing.stats && typeof existing.stats === "object" ? existing.stats : {};
    for (const key of SHEET_STAT_KEYS) {
      if (typeof prev[key] === "number" && Number.isFinite(prev[key])) progress.stats[key] = prev[key];
    }
    progress.logros = earned(progress.stats);
  }
  scheduleMetaUpdate(APP_ID, version, progress, storage);
  return { sessions, undos };
}
