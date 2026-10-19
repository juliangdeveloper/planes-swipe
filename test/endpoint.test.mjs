import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HEADERS } from "../js/config.js";
import { createEnv } from "./gas-harness.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = process.env.SHOTS_DIR || "";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".mjs": "text/javascript; charset=utf-8",
};

function eventRow() {
  return {
    id: "EV-201",
    fecha_registro: "2026-10-01",
    nombre_evento: "Feria del libro",
    categoria: "Libros",
    fecha_evento: "2026-11-21",
    ciudad: "Puerto Lumbre",
    departamento: "Región Norte",
    lugar: "Centro de Convenciones",
    precio: "45000",
    estado: "Entradas a la venta",
    link_info: "https://example.com/feria",
    link_entradas: "",
    para_quien: "Ambos",
    motivo_recomendacion: "Acompañante quiere la firma.",
    ultima_revision: "2026-10-12",
    preferencia: "",
    calificado_en: "",
    comentario_usuario: "",
    imagen_1: "img/books.svg",
    imagen_2: "",
    imagen_3: "",
  };
}

function startServer(env, posts) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/exec") {
      let output;
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const contents = Buffer.concat(chunks).toString("utf8");
        posts.push({ type: String(req.headers["content-type"] || ""), body: contents });
        output = env.doPost({ postData: { contents, type: req.headers["content-type"] || "" } });
      } else {
        output = env.doGet({ parameter: Object.fromEntries(url.searchParams) });
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(output.getContent());
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function loadPuppeteer() {
  const candidates = [
    "puppeteer-core",
    "/tmp/planes-tools/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js",
  ];
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      return mod.default || mod;
    } catch {
      /* try the next path */
    }
  }
  return null;
}

function pref(env) {
  const row = env.values.find((line) => line[HEADERS.indexOf("id")] === "EV-201");
  return {
    preferencia: row[HEADERS.indexOf("preferencia")],
    calificado_en: row[HEADERS.indexOf("calificado_en")],
    comentario_usuario: row[HEADERS.indexOf("comentario_usuario")],
    nombre_evento: row[HEADERS.indexOf("nombre_evento")],
    precio: row[HEADERS.indexOf("precio")],
  };
}

test("app rates through a mocked Apps Script endpoint", { timeout: 120000 }, async (t) => {
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    t.skip("puppeteer-core is not installed");
    return;
  }
  if (shots) mkdirSync(shots, { recursive: true });
  const env = createEnv({ rows: [eventRow()], secret: "s3cret" });
  const posts = [];
  const server = await startServer(env, posts);
  const { port } = server.address();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  try {
    await page.evaluateOnNewDocument(() => {
      const apply = () => {
        const root = document.documentElement;
        if (!root || root.dataset.safe === "mini") return;
        root.dataset.safe = "mini";
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
      else apply();
    });
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`http://127.0.0.1:${port}/?nosw=1`, { waitUntil: "load" });
    await page.waitForSelector("#test-connection");
    const gateText = await page.$eval("#gate", (el) => el.innerText);
    assert.match(gateText, /Probar conexión/);
    assert.doesNotMatch(gateText, /Google/);
    if (shots) await page.screenshot({ path: join(shots, "screenshot_setup_375.png") });

    await page.$eval("#script-url", (el, value) => { el.value = value; }, `http://127.0.0.1:${port}/exec`);
    await page.$eval("#script-key", (el) => { el.value = "mala"; });
    await page.click("#test-connection");
    await page.waitForSelector("#gate-error:not([hidden])");
    assert.match(await page.$eval("#gate-error", (el) => el.textContent), /clave/);
    assert.equal(await page.$("#top-card"), null);

    await page.$eval("#script-key", (el) => { el.value = "s3cret"; });
    await page.click("#test-connection");
    await page.waitForSelector("#top-card .name");
    assert.match(await page.$eval("#top-card .name", (el) => el.textContent), /Feria del libro/);
    assert.match(await page.$eval("#subtitle", (el) => el.textContent), /Eventos y planes/);
    const metrics = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    assert.ok(metrics.scrollH <= metrics.clientH + 1);
    assert.ok(metrics.scrollW <= metrics.clientW + 1);

    const quieroCol = HEADERS.indexOf("quiero ir");
    assert.equal(env.values[1][quieroCol], "");
    assert.equal(env.values[1][HEADERS.indexOf("preferencia")], "");
    await page.click("#top-card .quiero");
    for (let attempt = 0; attempt < 50 && env.values[1][quieroCol] !== true; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(env.values[1][quieroCol], true);
    assert.equal(env.values[1][HEADERS.indexOf("preferencia")], "");
    assert.equal(env.values[1][HEADERS.indexOf("calificado_en")], "");
    assert.equal(env.values[1][HEADERS.indexOf("comentario_usuario")], "");
    assert.match(posts.at(-1).type, /^text\/plain/i);
    assert.equal(JSON.parse(posts.at(-1).body).action, "quiero");
    assert.equal(JSON.parse(posts.at(-1).body).quiero_ir, true);
    assert.equal(await page.$eval("#top-card .quiero", (el) => el.getAttribute("aria-pressed")), "true");

    await page.type("#comment", "vamos");
    await page.click('[data-rate="me_gusta"]');
    await page.waitForFunction(() => document.querySelector("#empty") && !document.querySelector("#empty").hidden);
    let saved = pref(env);
    assert.equal(saved.preferencia, "me_gusta");
    assert.match(saved.calificado_en, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-05:00$/);
    assert.equal(saved.comentario_usuario, "vamos");
    assert.equal(env.values[1][HEADERS.indexOf("quiero ir")], true);
    assert.equal(saved.nombre_evento, "Feria del libro");
    assert.equal(saved.precio, "45000");
    assert.match(posts.at(-1).type, /^text\/plain/i);
    assert.equal(JSON.parse(posts.at(-1).body).action, "rate");

    await page.click("#undo");
    await page.waitForFunction(() => document.querySelector("#top-card .name")?.textContent.includes("Feria"));
    saved = pref(env);
    assert.equal(saved.preferencia, "");
    assert.equal(saved.calificado_en, "");
    assert.equal(saved.nombre_evento, "Feria del libro");
    assert.equal(env.values[1][HEADERS.indexOf("quiero ir")], true);

    await page.setOfflineMode(true);
    await page.click('[data-rate="me_encanta"]');
    await page.waitForFunction(() => {
      const toast = document.getElementById("toast");
      return toast && !toast.hidden && /cola/.test(toast.textContent);
    });
    assert.equal(pref(env).preferencia, "");
    await page.setOfflineMode(false);
    await page.waitForFunction(() => navigator.onLine);
    await page.$eval("#refresh", (el) => el.click());
    for (let attempt = 0; attempt < 50 && pref(env).preferencia !== "me_encanta"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    saved = pref(env);
    assert.equal(saved.preferencia, "me_encanta");
    assert.equal(saved.comentario_usuario, "");
    assert.equal(saved.precio, "45000");
    assert.equal(env.values[1][HEADERS.indexOf("quiero ir")], true);

    const stored = await page.evaluate(() => localStorage.getItem("planes-swipe.connection.v1"));
    assert.match(stored, /s3cret/);
    await page.$eval("#pick", (el) => el.click());
    await page.waitForSelector("#settings-dialog[open]");
    await page.$eval("#settings-clear", (el) => el.click());
    await page.waitForSelector("#test-connection");
    assert.equal(await page.$eval("#gate", (el) => el.hidden), false);
    const cleared = await page.evaluate(() => localStorage.getItem("planes-swipe.connection.v1"));
    assert.equal(cleared, null);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
