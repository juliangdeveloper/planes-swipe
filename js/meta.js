const live = { on: true };
const declared = [];
const slots = new WeakMap();
const slotList = new Set();

export function setMetaLive(on) {
  live.on = on !== false;
  if (live.on) return;
  for (const slot of slotList) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = 0;
    slot.pending = null;
  }
}

export function registerStats(list) {
  declared.length = 0;
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    if (declared.length >= 20) break;
    const key = typeof item === "string" ? item : item?.key;
    if (typeof key !== "string" || !key || seen.has(key)) continue;
    seen.add(key);
    declared.push({ key, monotonic: Boolean(item?.monotonic) });
  }
}

export function metaStorageKey(slug) {
  return `meta.v1.${slug}`;
}

function corruptKey(slug) {
  return `${metaStorageKey(slug)}.corrupt`;
}

function plainVersion(version) {
  const text = String(version ?? "");
  return text.startsWith("v") ? text.slice(1) : text;
}

function toIso(now) {
  const date = now instanceof Date ? now : now ? new Date(now) : new Date();
  return date.toISOString();
}

function storeOf(storage) {
  return storage || globalThis.localStorage;
}

function inspect(store, slug) {
  let raw = null;
  try {
    raw = store.getItem(metaStorageKey(slug));
  } catch {
    return { kind: "missing" };
  }
  if (raw == null || raw === "") return { kind: "missing" };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.v !== 1 || parsed.slug !== slug) {
      return { kind: "corrupt", raw };
    }
    return { kind: "valid", raw, record: parsed };
  } catch {
    return { kind: "corrupt", raw };
  }
}

export function readMeta(slug, storage) {
  try {
    const store = storeOf(storage);
    if (!store || !slug) return null;
    const found = inspect(store, slug);
    return found.kind === "valid" ? found.record : null;
  } catch {
    return null;
  }
}

function mergeStats(previous, incoming) {
  const prev = previous?.stats && typeof previous.stats === "object" && !Array.isArray(previous.stats)
    ? previous.stats
    : {};
  const next = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  const stats = {};
  for (const { key, monotonic } of declared) {
    const newer = next[key];
    const older = prev[key];
    const hasNew = typeof newer === "number" && Number.isFinite(newer);
    const hasOld = typeof older === "number" && Number.isFinite(older);
    if (hasNew && monotonic && hasOld) stats[key] = Math.max(older, newer);
    else if (hasNew) stats[key] = newer;
    else if (hasOld) stats[key] = older;
  }
  return stats;
}

function buildRecord(slug, version, stats, logros, previous, nowIso) {
  const prevLogros = Array.isArray(previous?.logros) ? previous.logros : [];
  const prevHitos = previous?.hitos && typeof previous.hitos === "object" && !Array.isArray(previous.hitos)
    ? previous.hitos
    : {};
  const ids = new Set();
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
    version: plainVersion(version),
    updatedAt: nowIso,
    stats: mergeStats(previous, stats),
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

function commit(job) {
  const found = inspect(job.store, job.slug);
  if (found.kind === "corrupt") {
    try {
      job.store.setItem(corruptKey(job.slug), String(found.raw));
    } catch {
      /* ignore */
    }
  }
  const previous = found.kind === "valid" ? found.record : null;
  const record = buildRecord(job.slug, job.version, job.payload?.stats, job.payload?.logros, previous, toIso(job.now));
  job.store.setItem(metaStorageKey(job.slug), JSON.stringify(record));
  notify(metaStorageKey(job.slug), record);
  return record;
}

function slotFor(storage, slug) {
  let bySlug = slots.get(storage);
  if (!bySlug) {
    bySlug = new Map();
    slots.set(storage, bySlug);
  }
  let slot = bySlug.get(slug);
  if (!slot) {
    slot = { lastWrite: null, timer: 0, pending: null };
    bySlug.set(slug, slot);
    slotList.add(slot);
  }
  return slot;
}

function writable(slot) {
  return slot.lastWrite == null || Date.now() - slot.lastWrite >= 1000;
}

function drain(slot) {
  if (!live.on || !slot.pending || !writable(slot)) return null;
  const job = slot.pending;
  slot.pending = null;
  slot.lastWrite = Date.now();
  return commit(job);
}

function arm(slot) {
  if (slot.timer || !slot.pending || writable(slot)) return;
  const wait = Math.max(0, 1000 - (Date.now() - slot.lastWrite));
  slot.timer = setTimeout(() => {
    slot.timer = 0;
    try {
      drain(slot);
    } catch {
      /* ignore */
    }
  }, wait);
}

function enqueue(store, slug, version, payload, now) {
  if (!live.on || !store || !slug) return null;
  const slot = slotFor(store, slug);
  slot.pending = { store, slug, version, payload, now };
  if (writable(slot)) {
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = 0;
    }
    return drain(slot);
  }
  arm(slot);
  return null;
}

export function metaUpdate(slug, version, payload = {}, storage, now) {
  try {
    return enqueue(storeOf(storage), slug, version, payload, now);
  } catch {
    return null;
  }
}

export function metaBackfill(slug, version, payload = {}, storage, now) {
  try {
    if (!live.on) return null;
    const store = storeOf(storage);
    if (!store || !slug) return null;
    const found = inspect(store, slug);
    if (found.kind === "valid") return found.record;
    return enqueue(store, slug, version, payload, now);
  } catch {
    return null;
  }
}

export function scheduleMetaUpdate(slug, version, payload = {}, storage, now) {
  try {
    enqueue(storeOf(storage), slug, version, payload, now);
  } catch {
    /* ignore */
  }
}

export function flushScheduledMeta(storage, slug) {
  try {
    if (!live.on) return;
    const store = storeOf(storage);
    if (!store) return;
    const bySlug = slots.get(store);
    if (!bySlug) return;
    const list = slug ? [bySlug.get(slug)] : [...bySlug.values()];
    for (const slot of list) {
      if (!slot?.pending) continue;
      if (slot.timer) {
        clearTimeout(slot.timer);
        slot.timer = 0;
      }
      const job = slot.pending;
      slot.pending = null;
      slot.lastWrite = Date.now();
      commit(job);
    }
  } catch {
    /* ignore */
  }
}

export function flushMetaForHide(type, storage, slug, visibilityState) {
  if (type === "visibilitychange" && visibilityState !== "hidden") return;
  if (type !== "pagehide" && type !== "visibilitychange") return;
  flushScheduledMeta(storage, slug);
}
