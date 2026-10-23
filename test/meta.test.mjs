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
import { flushScheduledMeta, metaStorageKey, metaUpdate, scheduleMetaUpdate } from "../js/meta.js";
import { backfillProgress, startProgress } from "../js/progress.js";
import { createMemoryStorage } from "../js/queue.js";

const KEY = metaStorageKey(APP_ID);
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
    assert.equal(record.updatedAt, "2026-10-23T18:00:00.000Z");
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
    assert.deepEqual(savedKeys(storage), before);
    assert.equal(storage.getItem(KEY).includes(SECRET), false);

    const broken = createMemoryStorage();
    broken.setItem(KEY, "not-json");
    assert.doesNotThrow(() => {
      record = metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 1 }, logros: ["first_session"] }, broken, NOW);
    });
    assert.equal(record.stats.sessions, 1);
    assert.deepEqual(record.logros, ["first_session"]);

    const empty = createMemoryStorage();
    empty.setItem(KEY, "null");
    assert.doesNotThrow(() => {
      record = metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 2 }, logros: [] }, empty, NOW);
    });
    assert.equal(record.stats.sessions, 2);

    const quota = {
      getItem() { return null; },
      setItem() { throw new Error("quota"); },
    };
    assert.doesNotThrow(() => {
      assert.equal(metaUpdate(APP_ID, APP_VERSION, { stats: { sessions: 1 }, logros: [] }, quota, NOW), null);
    });
  });

  await t.test("metaUpdate merges counts, keeps hitos, and posts the record", () => {
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
      metaUpdate(APP_ID, APP_VERSION, {
        stats: { sessions: 1, plans_rated: 1, legacy_count: 4 },
        logros: ["first_rating", "first_session"],
      }, storage, new Date("2026-10-20T15:01:02.000Z"));
      const record = metaUpdate(APP_ID, APP_VERSION, {
        stats: { sessions: Number.POSITIVE_INFINITY, plans_rated: 2, note: NAME },
        logros: ["ten_rated", "first_session"],
      }, storage, new Date("2026-10-21T19:22:10.000Z"));
      assert.equal(record.v, 1);
      assert.equal(record.slug, APP_ID);
      assert.equal(record.version, APP_VERSION);
      assert.equal(record.updatedAt, "2026-10-21T19:22:10.000Z");
      assert.equal(record.stats.sessions, 1);
      assert.equal(record.stats.plans_rated, 2);
      assert.equal(record.stats.legacy_count, 4);
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
      metaUpdate(APP_ID, APP_VERSION, { stats: { plans_rated: 3 }, logros: [] }, storage, NOW);
      assert.deepEqual(messages, []);

      globalThis.window = {
        parent: {
          postMessage() { throw new Error("blocked"); },
        },
      };
      const saved = metaUpdate(APP_ID, APP_VERSION, { stats: { plans_rated: 4 }, logros: [] }, storage, NOW);
      assert.equal(saved.stats.plans_rated, 4);
      assert.equal(saved.hitos.first_session, "2026-10-20T15:01:02.000Z");
    } finally {
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
      flushScheduledMeta(storage, APP_ID);
      assert.equal(JSON.parse(storage.getItem(KEY)).stats.sessions, 4);
      mock.timers.tick(5000);
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
});
