import assert from "node:assert/strict";
import { mock } from "node:test";
import test from "node:test";
import {
  APP_ID,
  APP_VERSION,
  STORAGE_CONNECTION_KEY,
  STORAGE_QUEUE_KEY,
  STORAGE_QUIERO_KEY,
  STORAGE_THEME_KEY,
} from "../js/config.js";
import { flushMetaForHide, metaStorageKey, metaUpdate, registerStats, scheduleMetaUpdate, setMetaLive } from "../js/meta.js";
import { STATS, backfillProgress, startProgress, syncProgress } from "../js/progress.js";
import { createMemoryStorage } from "../js/queue.js";

const KEY = metaStorageKey(APP_ID);
const CORRUPT = `${KEY}.corrupt`;
const NOW = new Date("2026-10-23T18:00:00.000Z");
const URL = "https://script.google.com/macros/s/IDSentinela/exec";
const SECRET = "ClaveSentinela";
const COMMENT_A = "NotaSentinelaUno";
const COMMENT_B = "NotaSentinelaDos";
const NAME = "NombreSentinela";
const PLACE = "LugarSentinela";
const PLAN_ID = "EV-SENTINELA";

function oldRows() {
  return [
    {
      id: PLAN_ID,
      nombre_evento: NAME,
      lugar: PLACE,
      preferencia: "me_gusta",
      comentario_usuario: COMMENT_A,
      "quiero ir": "FALSE",
    },
    { preferencia: "me_encanta", comentario_usuario: "", "quiero ir": "TRUE" },
    { preferencia: "me_interesa", comentario_usuario: COMMENT_B, "quiero ir": true },
    { preferencia: "no_me_gusta", comentario_usuario: "  ", "quiero ir": "FALSE" },
    { preferencia: "", comentario_usuario: "", "quiero ir": "false" },
    { preferencia: "me_intriga", comentario_usuario: "", "quiero ir": "" },
  ];
}

function seedOldSave(storage) {
  storage.setItem(STORAGE_CONNECTION_KEY, JSON.stringify({ url: URL, key: SECRET }));
  storage.setItem(STORAGE_THEME_KEY, "dark");
  storage.setItem(STORAGE_QUEUE_KEY, JSON.stringify([
    {
      id: PLAN_ID,
      preferencia: "me_gusta",
      comentario: COMMENT_A,
      calificado_en: "2026-10-01T00:00:00-05:00",
      endpoint: URL,
    },
  ]));
  storage.setItem(STORAGE_QUIERO_KEY, JSON.stringify([
    { id: PLAN_ID, quiero: true, endpoint: URL },
  ]));
}

function savedKeys(storage) {
  return {
    connection: storage.getItem(STORAGE_CONNECTION_KEY),
    queue: storage.getItem(STORAGE_QUEUE_KEY),
    quiero: storage.getItem(STORAGE_QUIERO_KEY),
    theme: storage.getItem(STORAGE_THEME_KEY),
  };
}

test("meta.v1 progress record", { concurrency: 1 }, async (t) => {
  await t.test("old save without the key backfills a record", () => {
    const storage = createMemoryStorage();
    seedOldSave(storage);
    const before = savedKeys(storage);
    assert.equal(storage.getItem(KEY), null);

    const record = backfillProgress(storage, oldRows(), APP_VERSION, NOW);

    assert.deepEqual(savedKeys(storage), before);
    assert.deepEqual(Object.keys(record), ["v", "slug", "version", "updatedAt", "stats", "logros", "hitos"]);
    assert.equal(record.v, 1);
    assert.equal(record.slug, APP_ID);
    assert.equal(record.version, APP_VERSION);
    assert.equal(KEY, "meta.v1.planes-swipe");
    assert.equal(record.version.startsWith("v"), false);
    assert.equal(record.updatedAt, "2026-10-23T18:00:00.000Z");
    assert.deepEqual(Object.keys(record.stats), STATS.map((item) => item.key));
    assert.deepEqual(record.stats, {
      sessions: 1,
      undos: 0,
      plans_total: 6,
      plans_rated: 5,
      plans_unrated: 1,
      ratings_me_encanta: 1,
      ratings_me_gusta: 1,
      ratings_me_interesa: 2,
      ratings_no_me_gusta: 1,
      ratings_other: 0,
      comments: 2,
      quiero_ir: 2,
      queue_pending: 1,
      quiero_pending: 1,
    });
    assert.deepEqual(record.logros, [
      "every_rating",
      "first_comment",
      "first_quiero",
      "first_rating",
      "first_session",
      "offline_queue",
    ]);
    assert.deepEqual(Object.keys(record.hitos), record.logros);
    for (const id of record.logros) assert.equal(record.hitos[id], "2026-10-23T18:00:00.000Z");
    const raw = storage.getItem(KEY);
    for (const secret of [URL, SECRET, COMMENT_A, COMMENT_B, NAME, PLACE, PLAN_ID]) {
      assert.equal(raw.includes(secret), false);
    }
    const again = storage.getItem(KEY);
    backfillProgress(storage, [{ preferencia: "me_encanta", comentario_usuario: COMMENT_A }], APP_VERSION, new Date("2026-11-01T00:00:00.000Z"));
    assert.equal(storage.getItem(KEY), again);
  });

  await t.test("existing record is not overwritten by backfill", () => {
    const storage = createMemoryStorage();
    seedOldSave(storage);
    const existing = {
      v: 1,
      slug: APP_ID,
      version: "0.8.1",
      updatedAt: "2026-01-02T03:04:05.000Z",
      stats: { sessions: 7, plans_rated: 2, legacy_count: 3 },
      logros: ["first_session"],
      hitos: { first_session: "2026-01-01T00:00:00.000Z" },
    };
    storage.setItem(KEY, JSON.stringify(existing));
    const raw = storage.getItem(KEY);
    const before = savedKeys(storage);

    const result = backfillProgress(storage, oldRows(), APP_VERSION, NOW);

    assert.equal(storage.getItem(KEY), raw);
    assert.deepEqual(result, existing);
    assert.deepEqual(savedKeys(storage), before);
  });

  await t.test("corrupt JSON does not crash", () => {
    const storage = createMemoryStorage();
    seedOldSave(storage);
    storage.setItem(KEY, "{");
    const before = savedKeys(storage);
    let record;
    assert.doesNotThrow(() => {
      record = backfillProgress(storage, oldRows(), APP_VERSION, NOW);
    });
    assert.equal(record.v, 1);
    assert.equal(record.slug, APP_ID);
    assert.equal(record.stats.plans_rated, 5);
    assert.equal(storage.getItem(CORRUPT), "{");
    assert.deepEqual(savedKeys(storage), before);
    assert.equal(storage.getItem(KEY).includes(SECRET), false);

    const broken = createMemoryStorage();
    broken.setItem(KEY, "not-json");
    assert.doesNotThrow(() => {
      record = metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 1 }, logros: ["first_session"] }, broken, NOW);
    });
    assert.equal(broken.getItem(CORRUPT), "not-json");
    assert.equal(record.stats.sessions, 1);
    assert.deepEqual(record.logros, ["first_session"]);

    const empty = createMemoryStorage();
    empty.setItem(KEY, "null");
    assert.doesNotThrow(() => {
      record = metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 2 }, logros: [] }, empty, NOW);
    });
    assert.equal(empty.getItem(CORRUPT), "null");
    assert.equal(record.stats.sessions, 2);

    const wrong = createMemoryStorage();
    const wrongRaw = JSON.stringify({ v: 2, slug: APP_ID, stats: { sessions: 9 } });
    wrong.setItem(KEY, wrongRaw);
    record = backfillProgress(wrong, [], APP_VERSION, NOW);
    assert.equal(wrong.getItem(CORRUPT), wrongRaw);
    assert.equal(record.v, 1);
    assert.equal(record.stats.sessions, 1);

    const other = createMemoryStorage();
    const otherRaw = JSON.stringify({ v: 1, slug: "other-app" });
    other.setItem(KEY, otherRaw);
    record = backfillProgress(other, [], APP_VERSION, NOW);
    assert.equal(other.getItem(CORRUPT), otherRaw);
    assert.equal(record.slug, APP_ID);

    const list = createMemoryStorage();
    list.setItem(KEY, "[]");
    record = backfillProgress(list, [], APP_VERSION, NOW);
    assert.equal(list.getItem(CORRUPT), "[]");
    assert.equal(record.v, 1);

    const quota = {
      getItem() { return null; },
      setItem() { throw new Error("quota"); },
    };
    assert.doesNotThrow(() => {
      assert.equal(metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 1 }, logros: [] }, quota, NOW), null);
    });
  });

  await t.test("metaUpdate merges counts, keeps hitos, and posts the record", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const storage = createMemoryStorage();
    const messages = [];
    const previousWindow = globalThis.window;
    const previousLocation = globalThis.location;
    globalThis.window = {
      parent: {
        postMessage(data, origin) {
          messages.push({ data, origin });
        },
      },
    };
    globalThis.location = { origin: "https://planes.test" };
    try {
      const first = metaUpdate(APP_ID, "v0.8.3", {
        stats: { sessions: 1, plans_rated: 1, legacy_count: 4 },
        logros: ["first_rating", "first_session"],
      }, storage, new Date("2026-10-20T15:01:02.000Z"));
      assert.equal(first.version, "0.8.3");
      mock.timers.tick(1000);
      const record = metaUpdate(APP_ID, APP_VERSION, {
        stats: { sessions: Number.POSITIVE_INFINITY, plans_rated: 2, note: NAME },
        logros: ["ten_rated", "first_session"],
      }, storage, new Date("2026-10-21T19:22:10.000Z"));
      assert.equal(record.v, 1);
      assert.equal(record.slug, APP_ID);
      assert.equal(record.version, APP_VERSION);
      assert.equal(record.version.startsWith("v"), false);
      assert.equal(record.updatedAt, "2026-10-21T19:22:10.000Z");
      assert.equal(record.stats.sessions, 1);
      assert.equal(record.stats.plans_rated, 2);
      assert.equal("legacy_count" in record.stats, false);
      assert.equal("note" in record.stats, false);
      assert.deepEqual(record.logros, ["first_rating", "first_session", "ten_rated"]);
      assert.equal(record.hitos.first_session, "2026-10-20T15:01:02.000Z");
      assert.equal(record.hitos.first_rating, "2026-10-20T15:01:02.000Z");
      assert.equal(record.hitos.ten_rated, "2026-10-21T19:22:10.000Z");
      assert.equal(messages.length, 2);
      assert.equal(messages[1].origin, "https://planes.test");
      assert.deepEqual(messages[1].data, {
        type: "meta",
        key: KEY,
        data: record,
      });
      assert.equal(JSON.stringify(record).includes(NAME), false);

      messages.length = 0;
      const same = { postMessage() { messages.push("same"); } };
      same.parent = same;
      globalThis.window = same;
      mock.timers.tick(1000);
      metaUpdate(APP_ID, APP_VERSION, { stats: { plans_rated: 3 }, logros: [] }, storage, NOW);
      assert.deepEqual(messages, []);
      assert.equal(JSON.parse(storage.getItem(KEY)).stats.plans_rated, 3);

      globalThis.window = {
        parent: {
          postMessage() { throw new Error("blocked"); },
        },
      };
      mock.timers.tick(1000);
      const saved = metaUpdate(APP_ID, APP_VERSION, { stats: { plans_rated: 4 }, logros: [] }, storage, NOW);
      assert.equal(saved.stats.plans_rated, 4);
      assert.equal(saved.hitos.first_session, "2026-10-20T15:01:02.000Z");
    } finally {
      mock.timers.reset();
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousLocation === undefined) delete globalThis.location;
      else globalThis.location = previousLocation;
    }
  });

  await t.test("schedule writes at most once per second", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const storage = createMemoryStorage();
      scheduleMetaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 1 }, logros: [] }, storage);
      scheduleMetaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 2 }, logros: [] }, storage);
      scheduleMetaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 3 }, logros: [] }, storage);
      assert.equal(JSON.parse(storage.getItem(KEY)).stats.sessions, 1);
      mock.timers.tick(999);
      assert.equal(JSON.parse(storage.getItem(KEY)).stats.sessions, 1);
      mock.timers.tick(1);
      assert.equal(JSON.parse(storage.getItem(KEY)).stats.sessions, 3);

      scheduleMetaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 4 }, logros: [] }, storage);
      assert.equal(JSON.parse(storage.getItem(KEY)).stats.sessions, 3);
      mock.timers.tick(1000);
      assert.equal(JSON.parse(storage.getItem(KEY)).stats.sessions, 4);
    } finally {
      mock.timers.reset();
    }
  });

  await t.test("a later session keeps sheet counts when the list did not load", () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, JSON.stringify({
      v: 1,
      slug: APP_ID,
      version: "0.8.1",
      updatedAt: "2026-01-02T03:04:05.000Z",
      stats: { sessions: 3, undos: 2, plans_rated: 8, plans_total: 9, comments: 1 },
      logros: ["first_session", "first_rating"],
      hitos: {
        first_session: "2026-01-01T00:00:00.000Z",
        first_rating: "2026-01-02T03:04:05.000Z",
      },
    }));
    const started = startProgress(storage, [], APP_VERSION, { loaded: false });
    assert.equal(started.sessions, 4);
    assert.equal(started.undos, 2);
    const record = JSON.parse(storage.getItem(KEY));
    assert.equal(record.stats.sessions, 4);
    assert.equal(record.stats.undos, 2);
    assert.equal(record.stats.plans_rated, 8);
    assert.equal(record.stats.plans_total, 9);
    assert.equal(record.stats.comments, 1);
    assert.equal(record.hitos.first_rating, "2026-01-02T03:04:05.000Z");
    assert.equal(record.version, APP_VERSION);

    const loaded = createMemoryStorage();
    loaded.setItem(KEY, storage.getItem(KEY));
    startProgress(loaded, [
      { preferencia: "me_gusta", comentario_usuario: "", "quiero ir": "FALSE" },
      { preferencia: "", comentario_usuario: "", "quiero ir": "TRUE" },
    ], APP_VERSION, { loaded: true });
    const next = JSON.parse(loaded.getItem(KEY));
    assert.equal(next.stats.sessions, 5);
    assert.equal(next.stats.plans_rated, 1);
    assert.equal(next.stats.plans_total, 2);
    assert.equal(next.stats.quiero_ir, 1);
    assert.equal(next.hitos.first_rating, "2026-01-02T03:04:05.000Z");
  });

  await t.test("declared stats are capped, ordered, and monotonic", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const many = Array.from({ length: 21 }, (_, index) => ({
        key: `stat_${String(index).padStart(2, "0")}`,
        monotonic: index === 0,
      }));
      registerStats(many);
      const storage = createMemoryStorage();
      const stats = { picture: "data:image/png;base64,AAAA", extra: 7 };
      many.forEach((item, index) => {
        stats[item.key] = index + 1;
      });
      const record = metaUpdate(APP_ID, APP_VERSION, { stats, logros: [] }, storage, NOW);
      assert.deepEqual(Object.keys(record.stats), many.slice(0, 20).map((item) => item.key));
      assert.equal(record.stats.stat_20, undefined);
      assert.equal("picture" in record.stats, false);
      assert.equal("extra" in record.stats, false);
      mock.timers.tick(1000);
      const lowered = metaUpdate(APP_ID, APP_VERSION, {
        stats: { stat_00: 0, stat_01: 1 },
        logros: [],
      }, storage, NOW);
      assert.equal(lowered.stats.stat_00, 1);
      assert.equal(lowered.stats.stat_01, 1);
      assert.equal(lowered.stats.stat_02, 3);

      registerStats(STATS);
      const app = createMemoryStorage();
      metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 5, undos: 2, plans_total: 9 }, logros: [] }, app, NOW);
      mock.timers.tick(1000);
      const next = metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 1, plans_total: 4 }, logros: [] }, app, NOW);
      assert.equal(next.stats.sessions, 5);
      assert.equal(next.stats.undos, 2);
      assert.equal(next.stats.plans_total, 4);
      assert.deepEqual(Object.keys(next.stats), ["sessions", "undos", "plans_total"]);
    } finally {
      registerStats(STATS);
      mock.timers.reset();
    }
  });

  await t.test("backfill stays within one write per second", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const storage = createMemoryStorage();
      seedOldSave(storage);
      const before = savedKeys(storage);
      const writes = [];
      const counted = {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
          writes.push(key);
          storage.setItem(key, value);
        },
        removeItem: (key) => storage.removeItem(key),
      };
      backfillProgress(counted, oldRows(), APP_VERSION, NOW);
      syncProgress(counted, oldRows(), APP_VERSION, { sessions: 2, undos: 1 });
      assert.deepEqual(writes, [KEY]);
      assert.deepEqual(savedKeys(counted), before);
      mock.timers.tick(999);
      assert.deepEqual(writes, [KEY]);
      mock.timers.tick(1);
      assert.deepEqual(writes, [KEY, KEY]);
      assert.equal(JSON.parse(counted.getItem(KEY)).stats.sessions, 2);
      assert.deepEqual(savedKeys(counted), before);
    } finally {
      mock.timers.reset();
    }
  });

  await t.test("a pending change flushes on pagehide and when the page is hidden", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const messages = [];
    const previousWindow = globalThis.window;
    const previousLocation = globalThis.location;
    globalThis.window = {
      parent: {
        postMessage(data, origin) {
          messages.push({ data, origin });
        },
      },
    };
    globalThis.location = { origin: "https://planes.test" };
    try {
      const storage = createMemoryStorage();
      const writes = [];
      const counted = {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
          writes.push(key);
          storage.setItem(key, value);
        },
        removeItem: (key) => storage.removeItem(key),
      };
      metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 1 }, logros: ["first_session"] }, counted, NOW);
      scheduleMetaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 2 }, logros: ["first_session"] }, counted, NOW);
      assert.deepEqual(writes, [KEY]);
      flushMetaForHide("visibilitychange", counted, APP_ID, "visible");
      assert.deepEqual(writes, [KEY]);
      assert.equal(messages.length, 1);

      flushMetaForHide("pagehide", counted, APP_ID);
      assert.deepEqual(writes, [KEY, KEY]);
      assert.equal(JSON.parse(counted.getItem(KEY)).stats.sessions, 2);
      assert.equal(messages.length, 2);
      assert.equal(messages[1].origin, "https://planes.test");
      assert.equal(messages[1].data.key, KEY);
      assert.equal(messages[1].data.data.stats.sessions, 2);
      flushMetaForHide("pagehide", counted, APP_ID);
      flushMetaForHide("visibilitychange", counted, APP_ID, "hidden");
      assert.deepEqual(writes, [KEY, KEY]);

      const hidden = createMemoryStorage();
      const hiddenWrites = [];
      const hiddenStore = {
        getItem: (key) => hidden.getItem(key),
        setItem: (key, value) => {
          hiddenWrites.push(key);
          hidden.setItem(key, value);
        },
        removeItem: (key) => hidden.removeItem(key),
      };
      metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 1 }, logros: [] }, hiddenStore, NOW);
      scheduleMetaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 4 }, logros: [] }, hiddenStore, NOW);
      flushMetaForHide("visibilitychange", hiddenStore, APP_ID, "hidden");
      assert.deepEqual(hiddenWrites, [KEY, KEY]);
      assert.equal(JSON.parse(hidden.getItem(KEY)).stats.sessions, 4);
      const posted = messages.length;
      flushMetaForHide("visibilitychange", hiddenStore, APP_ID, "hidden");
      assert.equal(messages.length, posted);
      assert.deepEqual(hiddenWrites, [KEY, KEY]);
    } finally {
      mock.timers.reset();
      setMetaLive(true);
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousLocation === undefined) delete globalThis.location;
      else globalThis.location = previousLocation;
    }
  });

  await t.test("demo mode does not write or postMessage and real mode does", () => {
    const messages = [];
    const previousWindow = globalThis.window;
    const previousLocation = globalThis.location;
    globalThis.window = {
      parent: {
        postMessage(data, origin) {
          messages.push({ data, origin });
        },
      },
    };
    globalThis.location = { origin: "https://planes.test" };
    try {
      setMetaLive(false);
      const storage = createMemoryStorage();
      seedOldSave(storage);
      const before = savedKeys(storage);
      const rows = [{ preferencia: "me_encanta", comentario_usuario: COMMENT_A, nombre_evento: NAME, "quiero ir": "TRUE" }];
      startProgress(storage, rows, APP_VERSION, { loaded: true });
      syncProgress(storage, rows, APP_VERSION, { sessions: 4, undos: 1 });
      backfillProgress(storage, rows, APP_VERSION, NOW);
      scheduleMetaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 3 }, logros: ["first_session"] }, storage, NOW);
      metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 3 }, logros: ["first_session"] }, storage, NOW);
      flushMetaForHide("pagehide", storage, APP_ID);
      flushMetaForHide("visibilitychange", storage, APP_ID, "hidden");
      assert.equal(storage.getItem(KEY), null);
      assert.equal(storage.getItem(CORRUPT), null);
      assert.deepEqual(messages, []);
      assert.deepEqual(savedKeys(storage), before);
      assert.equal(JSON.stringify(savedKeys(storage)).includes(NAME), false);

      setMetaLive(true);
      const real = createMemoryStorage();
      const record = metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 1 }, logros: ["first_session"] }, real, NOW);
      assert.equal(record.stats.sessions, 1);
      assert.equal(record.slug, APP_ID);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].origin, "https://planes.test");
      assert.equal(messages[0].data.type, "meta");
      assert.equal(messages[0].data.key, KEY);
      assert.equal(messages[0].data.data.stats.sessions, 1);
      assert.equal(real.getItem(KEY).includes(NAME), false);
    } finally {
      setMetaLive(true);
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousLocation === undefined) delete globalThis.location;
      else globalThis.location = previousLocation;
    }
  });
});
