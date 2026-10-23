export function metaStorageKey(slug) {
  return `meta.v1.${slug}`;
}

export function readMeta(slug, storage) {
  try {
    const store = storage || globalThis.localStorage;
    if (!store || !slug) return null;
    const raw = store.getItem(metaStorageKey(slug));
    if (raw == null || raw === "") return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function finiteStats(source) {
  const stats = {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return stats;
  for (const [key, value] of Object.entries(source)) {
    if (!key || typeof value !== "number" || !Number.isFinite(value)) continue;
    stats[key] = value;
  }
  return stats;
}

function toIso(now) {
  const date = now instanceof Date ? now : now ? new Date(now) : new Date();
  return date.toISOString();
}

function buildRecord(slug, version, stats, logros, previous, nowIso) {
  const merged = finiteStats(previous?.stats);
  Object.assign(merged, finiteStats(stats));
  const ids = new Set();
  const prevLogros = Array.isArray(previous?.logros) ? previous.logros : [];
  const prevHitos = previous?.hitos && typeof previous.hitos === "object" && !Array.isArray(previous.hitos)
    ? previous.hitos
    : {};
  for (const id of prevLogros) {
    if (typeof id === "string" && id) ids.add(id);
  }
  for (const id of Object.keys(prevHitos)) {
    if (id) ids.add(id);
  }
  if (Array.isArray(logros)) {
    for (const id of logros) {
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  const sorted = [...ids].sort();
  const hitos = {};
  for (const id of sorted) {
    const prior = prevHitos[id];
    hitos[id] = typeof prior === "string" && prior ? prior : nowIso;
  }
  return {
    v: 1,
    slug: String(slug),
    version: String(version),
    updatedAt: nowIso,
    stats: merged,
    logros: sorted,
    hitos,
  };
}

function notify(key, record) {
  try {
    if (typeof window !== "undefined" && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "meta", key, data: record }, location.origin);
    }
  } catch {
    /* ignore */
  }
}

function writeRecord(store, key, record) {
  store.setItem(key, JSON.stringify(record));
  notify(key, record);
  return record;
}

export function metaUpdate(slug, version, payload = {}, storage, now) {
  try {
    const store = storage || globalThis.localStorage;
    if (!store || !slug) return null;
    const record = buildRecord(slug, version, payload?.stats, payload?.logros, readMeta(slug, store), toIso(now));
    return writeRecord(store, metaStorageKey(slug), record);
  } catch {
    return null;
  }
}

export function metaBackfill(slug, version, payload = {}, storage, now) {
  try {
    const store = storage || globalThis.localStorage;
    if (!store || !slug) return null;
    const existing = readMeta(slug, store);
    if (existing) return existing;
    const record = buildRecord(slug, version, payload?.stats, payload?.logros, null, toIso(now));
    return writeRecord(store, metaStorageKey(slug), record);
  } catch {
    return null;
  }
}

const slots = new WeakMap();

function slotFor(storage, slug) {
  let bySlug = slots.get(storage);
  if (!bySlug) {
    bySlug = new Map();
    slots.set(storage, bySlug);
  }
  let slot = bySlug.get(slug);
  if (!slot) {
    slot = { last: null, timer: 0, pending: null };
    bySlug.set(slug, slot);
  }
  return slot;
}

export function scheduleMetaUpdate(slug, version, payload = {}, storage, now) {
  try {
    const store = storage || globalThis.localStorage;
    if (!store || !slug) return;
    const slot = slotFor(store, slug);
    slot.pending = { slug, version, payload, now };
    const run = () => {
      slot.timer = 0;
      const next = slot.pending;
      slot.pending = null;
      if (!next) return;
      slot.last = Date.now();
      metaUpdate(next.slug, next.version, next.payload, store, next.now);
    };
    if (slot.timer) return;
    const elapsed = slot.last == null ? 1000 : Date.now() - slot.last;
    const wait = Math.max(0, 1000 - elapsed);
    if (wait === 0) {
      run();
      return;
    }
    slot.timer = setTimeout(run, wait);
  } catch {
    /* ignore */
  }
}

export function flushScheduledMeta(storage, slug) {
  try {
    const store = storage || globalThis.localStorage;
    if (!store) return;
    const bySlug = slots.get(store);
    if (!bySlug) return;
    const list = slug ? [bySlug.get(slug)] : [...bySlug.values()];
    for (const slot of list) {
      if (!slot?.pending) continue;
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = 0;
      const next = slot.pending;
      slot.pending = null;
      slot.last = Date.now();
      metaUpdate(next.slug, next.version, next.payload, store, next.now);
    }
  } catch {
    /* ignore */
  }
}
