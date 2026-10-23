import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = process.env.SHOTS_DIR || "";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
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

async function fits(page) {
  return page.evaluate(() => {
    const composer = document.getElementById("composer");
    const box = composer ? composer.getBoundingClientRect() : null;
    return {
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      composerBottom: box ? box.bottom : 0,
      innerH: window.innerHeight,
    };
  });
}

function assertFits(metrics) {
  assert.ok(metrics.scrollH <= metrics.clientH + 1, `vertical scroll ${metrics.scrollH} > ${metrics.clientH}`);
  assert.ok(metrics.scrollW <= metrics.clientW + 1, `horizontal scroll ${metrics.scrollW} > ${metrics.clientW}`);
  assert.ok(metrics.composerBottom <= metrics.innerH + 1, `composer ${metrics.composerBottom} > ${metrics.innerH}`);
}

async function drag(page, dx, dy) {
  return page.evaluate((dx, dy) => {
    const card = document.getElementById("top-card");
    const rect = card.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + Math.min(110, rect.height * 0.3);
    const fire = (type, cx, cy, buttons) => card.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      buttons,
      isPrimary: true,
    }));
    fire("pointerdown", x, y, 1);
    fire("pointermove", x + dx, y + dy, 1);
    return { x, y, armed: card.dataset.armed || "" };
  }, dx, dy);
}

test("swipe ui at 375x812", { timeout: 120000 }, async (t) => {
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    t.skip("puppeteer-core is not installed");
    return;
  }
  if (shots) mkdirSync(shots, { recursive: true });
  const server = await startServer();
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
    await page.goto(`http://127.0.0.1:${port}/?demo=1&nosw=1`, { waitUntil: "load" });
    await page.waitForSelector("#top-card .name");
    await page.evaluate(() => document.fonts.ready);

    const text = await page.$eval("#top-card", (el) => el.innerText);
    assert.match(text, /Sonido Abierto/);
    assert.match(text, /Entradas a la venta/);
    assert.match(text, /Ambos/);
    assert.match(text, /Parque Central/);
    assert.match(text, /ME INTERESA/);
    assert.doesNotMatch(text, /intriga/i);
    const labels = await page.$$eval("#actions .lbl", (nodes) => nodes.map((node) => node.textContent));
    assert.deepEqual(labels, ["No me gusta", "Me interesa", "Me gusta", "Me encanta"]);
    const quiero = await page.$eval("#top-card .quiero", (el) => ({
      text: el.textContent,
      pressed: el.getAttribute("aria-pressed"),
    }));
    assert.match(quiero.text, /Quiero ir/);
    assert.equal(quiero.pressed, "false");

    assertFits(await fits(page));
    if (shots) await page.screenshot({ path: join(shots, "screenshot_stack_light_375.png") });

    await page.click('#top-card .dot[data-i="1"]');
    await page.waitForSelector("#top-card .fallback:not([hidden])");
    const fallback = await page.$eval("#top-card .fallback", (el) => el.textContent);
    assert.match(fallback, /Sin foto/);
    await page.click('#top-card .dot[data-i="0"]');
    await page.waitForSelector("#top-card img:not([hidden])");

    const stamps = [
      [-120, 0, "no_me_gusta", "screenshot_swipe_no_me_gusta.png"],
      [0, 120, "me_interesa", "screenshot_swipe_me_interesa.png"],
      [120, 0, "me_gusta", "screenshot_swipe_me_gusta.png"],
      [0, -120, "me_encanta", "screenshot_swipe_me_encanta.png"],
    ];
    for (const [dx, dy, rating, name] of stamps) {
      const origin = await drag(page, dx, dy);
      assert.equal(origin.armed, rating, name);
      if (shots) await page.screenshot({ path: join(shots, name) });
      await page.evaluate(({ x, y }) => {
        const card = document.getElementById("top-card");
        const fire = (type, cx, cy) => card.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: cx,
          clientY: cy,
          pointerId: 1,
          pointerType: "touch",
          button: 0,
          buttons: 0,
          isPrimary: true,
        }));
        fire("pointermove", x, y);
        fire("pointerup", x, y);
      }, origin);
      await page.waitForFunction(() => (document.querySelector("#top-card")?.dataset.armed || "") === "");
    }

    await page.waitForFunction(() => {
      const card = document.getElementById("top-card");
      const theme = document.getElementById("theme");
      if (!card || !theme) return false;
      return card.getBoundingClientRect().top >= theme.getBoundingClientRect().bottom - 1;
    });
    await page.click("#theme");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    const darkIcons = await page.evaluate(() => ({
      moon: getComputedStyle(document.querySelector("#theme .icon-moon")).display,
      sun: getComputedStyle(document.querySelector("#theme .icon-sun")).display,
    }));
    assert.equal(darkIcons.moon, "none");
    assert.equal(darkIcons.sun, "block");
    const darkGear = await page.evaluate(() => {
      const gear = document.getElementById("settings");
      const rect = gear.getBoundingClientRect();
      return {
        display: getComputedStyle(gear).display,
        width: rect.width,
        right: rect.right,
        innerW: window.innerWidth,
      };
    });
    assert.notEqual(darkGear.display, "none");
    assert.ok(darkGear.width >= 32 && darkGear.right <= darkGear.innerW + 1);
    assertFits(await fits(page));
    if (shots) await page.screenshot({ path: join(shots, "screenshot_stack_dark_375.png") });
    await page.click("#theme");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    const lightIcons = await page.evaluate(() => ({
      moon: getComputedStyle(document.querySelector("#theme .icon-moon")).display,
      sun: getComputedStyle(document.querySelector("#theme .icon-sun")).display,
    }));
    assert.equal(lightIcons.moon, "block");
    assert.equal(lightIcons.sun, "none");
    const gearBox = await page.evaluate(() => {
      const gear = document.getElementById("settings");
      const theme = document.getElementById("theme");
      const gearRect = gear.getBoundingClientRect();
      const themeRect = theme.getBoundingClientRect();
      const style = getComputedStyle(gear);
      return {
        label: gear.getAttribute("aria-label"),
        display: style.display,
        width: gearRect.width,
        height: gearRect.height,
        top: gearRect.top,
        right: gearRect.right,
        themeTop: themeRect.top,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
      };
    });
    assert.equal(gearBox.label, "Ajustes");
    assert.notEqual(gearBox.display, "none");
    assert.ok(gearBox.width >= 32 && gearBox.height >= 32, "gear is tappable");
    assert.ok(gearBox.top >= 0 && gearBox.right <= gearBox.innerW + 1, "gear stays in the header");
    assert.ok(Math.abs(gearBox.top - gearBox.themeTop) < 2, "gear sits on the theme row");
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    const forcedLight = await page.evaluate(() => ({
      moon: getComputedStyle(document.querySelector("#theme .icon-moon")).display,
      sun: getComputedStyle(document.querySelector("#theme .icon-sun")).display,
    }));
    assert.equal(forcedLight.moon, "block");
    assert.equal(forcedLight.sun, "none");
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

    await page.click("#top-card .quiero");
    await page.waitForFunction(() => document.querySelector("#top-card .quiero")?.getAttribute("aria-pressed") === "true");
    await page.click("#top-card .name");
    await page.waitForSelector("#detail-dialog[open]");
    assert.equal(await page.$eval("#detail-quiero", (el) => el.textContent.trim()), "Quiero ir");
    assert.equal(await page.$eval("#detail-quiero", (el) => el.getAttribute("aria-pressed")), "true");
    await page.click("#detail-quiero");
    await page.waitForFunction(() => document.querySelector("#detail-quiero")?.getAttribute("aria-pressed") === "false");
    await page.click("#detail-close");
    await page.waitForFunction(() => !document.getElementById("detail-dialog").open);
    assert.equal(await page.$eval("#top-card .quiero", (el) => el.getAttribute("aria-pressed")), "false");
    await page.click("#top-card .quiero");
    await page.waitForFunction(() => document.querySelector("#top-card .quiero")?.getAttribute("aria-pressed") === "true");
    if (shots) await page.screenshot({ path: join(shots, "screenshot_quiero_ir.png") });

    await page.click("#view");
    await page.waitForSelector(".group h2");
    const groups = await page.$$eval(".group h2", (nodes) => nodes.map((node) => node.textContent));
    for (const label of ["Me encanta", "Me gusta", "Me interesa", "No me gusta"]) {
      assert.ok(groups.some((group) => group.includes(label)), label);
    }
    assert.ok(!groups.some((group) => /intriga/i.test(group)));
    assert.equal(await page.$eval('[data-quiero="EV-088"]', (el) => el.getAttribute("aria-pressed")), "true");
    assert.match(
      await page.$eval('[data-detail="EV-088"]', (el) => el.getAttribute("aria-label")),
      /Ver detalle de Ciclovía nocturna/,
    );
    await page.click('[data-detail="EV-088"] img');
    await page.waitForSelector("#detail-dialog[open]");
    assert.equal(await page.$eval("#detail-title", (el) => el.textContent), "Ciclovía nocturna");
    const ratedDetail = await page.$eval("#detail-dialog", (el) => el.innerText);
    assert.match(ratedDetail, /Avenida del Río/);
    assert.match(ratedDetail, /Aire libre/);
    assert.match(ratedDetail, /La avenida se presta para ir sin afán/);
    assert.equal(await page.$eval("#detail-quiero", (el) => el.getAttribute("aria-pressed")), "true");
    assert.equal(await page.evaluate(() => document.getElementById("edit-dialog").open), false);
    await page.click("#detail-quiero");
    await page.waitForFunction(() => document.querySelector("#detail-quiero")?.getAttribute("aria-pressed") === "false");
    await page.click("#detail-close");
    await page.waitForFunction(() => !document.getElementById("detail-dialog").open);
    assert.equal(await page.$eval('[data-quiero="EV-088"]', (el) => el.getAttribute("aria-pressed")), "false");
    assert.ok(await page.evaluate(() => {
      const group = [...document.querySelectorAll(".group")].find((node) => node.querySelector("h2")?.textContent.includes("Me encanta"));
      return Boolean(group?.textContent.includes("Ciclovía nocturna"));
    }));
    await page.click('[data-quiero="EV-088"]');
    await page.waitForFunction(() => document.querySelector('[data-quiero="EV-088"]')?.getAttribute("aria-pressed") === "true");
    assert.equal(await page.evaluate(() => document.getElementById("detail-dialog").open), false);

    await page.click('[data-quiero="EV-074"]');
    await page.waitForFunction(() => document.querySelector('[data-quiero="EV-074"]')?.getAttribute("aria-pressed") === "true");
    assert.equal(await page.evaluate(() => document.getElementById("detail-dialog").open), false);
    assert.equal(await page.evaluate(() => document.getElementById("edit-dialog").open), false);
    await page.click('[data-quiero="EV-074"]');
    await page.waitForFunction(() => document.querySelector('[data-quiero="EV-074"]')?.getAttribute("aria-pressed") === "false");

    await page.click('[data-change="EV-061"]');
    await page.waitForSelector("#edit-dialog[open]");
    assert.equal(await page.evaluate(() => document.getElementById("detail-dialog").open), false);
    await page.click("#edit-cancel");
    await page.waitForFunction(() => !document.getElementById("edit-dialog").open);

    await page.evaluate(() => {
      document.querySelector('[data-detail="EV-055"] img').dispatchEvent(new Event("error"));
    });
    await page.click('[data-detail="EV-055"] .thumb');
    await page.waitForSelector("#detail-dialog[open]");
    assert.equal(await page.$eval("#detail-title", (el) => el.textContent), "Partido en el Estadio Municipal");
    assert.match(await page.$eval("#detail-dialog", (el) => el.innerText), /Cancelado/);
    assert.equal(await page.evaluate(() => document.getElementById("edit-dialog").open), false);
    assert.equal(await page.$eval('[data-quiero="EV-055"]', (el) => el.getAttribute("aria-pressed")), "false");
    await page.click("#detail-close");
    await page.waitForFunction(() => !document.getElementById("detail-dialog").open);

    const ratedMetrics = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    assert.ok(ratedMetrics.scrollH <= ratedMetrics.clientH + 1);
    assert.ok(ratedMetrics.scrollW <= ratedMetrics.clientW + 1);
    if (shots) await page.screenshot({ path: join(shots, "screenshot_rated_list.png") });

    await page.click("#view");
    const first = await page.$eval("#top-card .name", (el) => el.textContent);
    await page.click('[data-rate="me_gusta"]');
    await page.waitForFunction((previous) => document.querySelector("#top-card .name")?.textContent !== previous, {}, first);
    await page.click("#undo");
    await page.waitForFunction((previous) => document.querySelector("#top-card .name")?.textContent === previous, {}, first);
    assert.equal(await page.$eval("#top-card .quiero", (el) => el.getAttribute("aria-pressed")), "true");

    await page.click("#view");
    await page.click('[data-change="EV-055"]');
    await page.waitForSelector("#edit-dialog[open]");
    await page.click('#edit-actions [data-rate="me_interesa"]');
    await page.click("#edit-save");
    await page.waitForFunction(() => {
      const group = [...document.querySelectorAll(".group")].find((node) => node.querySelector("h2")?.textContent.includes("Me interesa"));
      return group?.textContent.includes("Estadio Municipal");
    });

    await page.goto(`http://127.0.0.1:${port}/?nosw=1`, { waitUntil: "load" });
    await page.waitForSelector("#gate:not([hidden]) #gate-help");
    assert.equal(await page.$eval("#version", (el) => el.textContent), "planes-swipe v0.8.3");
    const gateIcons = await page.evaluate(() => ({
      moon: getComputedStyle(document.querySelector("#theme .icon-moon")).display,
      sun: getComputedStyle(document.querySelector("#theme .icon-sun")).display,
    }));
    assert.equal(gateIcons.moon, "block");
    assert.equal(gateIcons.sun, "none");
    await page.click("#gate-help");
    await page.waitForSelector("#help-dialog[open]");
    const helpText = await page.$eval("#help-dialog", (el) => el.innerText);
    assert.match(helpText, /Extensiones/);
    assert.match(helpText, /Apps Script/);
    assert.match(helpText, /SECRET/);
    assert.match(helpText, /Cualquier usuario/);
    assert.match(helpText, /\/exec/);
    assert.match(helpText, /quiero ir/);
    assert.match(helpText, /EJEMPLO-001/);
    const downloads = await page.$$eval("#help-dialog a", (nodes) => nodes.map((node) => ({
      href: node.getAttribute("href"),
      download: node.getAttribute("download"),
    })));
    assert.deepEqual(downloads, [
      { href: "downloads/plantilla-eventos.xlsx", download: "plantilla-eventos.xlsx" },
      { href: "downloads/Code.gs", download: "Code.gs" },
    ]);
    await page.click("#help-close");
    await page.waitForFunction(() => !document.getElementById("help-dialog").open);
    await page.click("#settings");
    await page.waitForSelector("#settings-dialog[open]");
    const settingsText = await page.$eval("#settings-dialog", (el) => el.innerText);
    assert.match(settingsText, /Cómo preparar la hoja/);
    assert.match(settingsText, /Descargar plantilla Excel/);
    assert.match(settingsText, /Descargar Code.gs/);
    assert.match(settingsText, /Conectar IA/);
    assert.match(settingsText, /Prompt para pegar en cualquier IA/);
    const settingsDownloads = await page.$$eval("#settings-dialog a", (nodes) => nodes.map((node) => ({
      href: node.getAttribute("href"),
      download: node.getAttribute("download"),
    })));
    assert.deepEqual(settingsDownloads, [
      { href: "downloads/plantilla-eventos.xlsx", download: "plantilla-eventos.xlsx" },
      { href: "downloads/Code.gs", download: "Code.gs" },
      { href: "downloads/conectar-ia-prompt.md", download: "conectar-ia-prompt.md" },
    ]);
    await page.click("#settings-help");
    await page.waitForSelector("#help-dialog[open]");
    assert.equal(await page.evaluate(() => document.getElementById("settings-dialog").open), true);
    await page.click("#help-close");

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
