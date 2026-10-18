import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { APP_VERSION, DEFAULT_SHEET_TITLE } from "../js/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("pages assets are relative and the app has no Google sign-in config", () => {
  const files = {
    "index.html": read("index.html"),
    "css/styles.css": read("css/styles.css"),
    "js/app.js": read("js/app.js"),
    "js/config.js": read("js/config.js"),
    "js/script.js": read("js/script.js"),
    "manifest.json": read("manifest.json"),
    "sw.js": read("sw.js"),
    "README.md": read("README.md"),
    "apps-script/Code.gs": read("apps-script/Code.gs"),
  };
  for (const [name, source] of Object.entries(files)) {
    if (name.endsWith(".md") || name.endsWith(".gs")) continue;
    assert.doesNotMatch(source, /(?:src|href)\s*=\s*["']\//, `${name} has a root-absolute asset`);
    assert.doesNotMatch(source, /url\(\s*["']?\//, `${name} has a root-absolute css url`);
  }
  assert.match(files["index.html"], /href="css\/styles.css\?v=0\.6\.0"/);
  assert.match(files["index.html"], /src="js\/app.js\?v=0\.6\.0"/);
  assert.match(files["index.html"], /href="manifest\.json\?v=0\.6\.0"/);
  assert.match(files["index.html"], /lang="es-CO"/);
  assert.match(files["index.html"], /planes-swipe v0\.6\.0/);
  assert.match(files["index.html"], /Probar conexión/);
  assert.match(files["index.html"], /Me interesa/);
  assert.doesNotMatch(files["index.html"], /intriga/);
  assert.doesNotMatch(files["index.html"], /Entrar con Google/);
  assert.doesNotMatch(files["js/config.js"], /GOOGLE_|drive\.file|CLIENT_ID|API_KEY/);
  assert.doesNotMatch(files["js/app.js"], /accounts\.google|picker|googleapis/);
  assert.doesNotMatch(files["sw.js"], /google\.js/);
  assert.match(files["js/script.js"], /text\/plain/);
  assert.match(files["apps-script/Code.gs"], /getSheets\(\)\[0\]/);
  assert.match(files["apps-script/Code.gs"], /LockService/);
  assert.match(files["apps-script/Code.gs"], /me_intriga/);
  assert.match(files["apps-script/Code.gs"], /action === "quiero"/);
  assert.match(files["apps-script/Code.gs"], /quiero ir/);
  assert.match(files["index.html"], /Quiero ir/);
  assert.match(files["js/app.js"], /Quiero ir/);
  assert.match(files["README.md"], /Gestionar implementaciones/);
  assert.match(files["README.md"], /Extensiones → Apps Script/);
  assert.match(files["README.md"], /Implementar → Nueva implementación → Aplicación web/);
  assert.match(files["README.md"], /Ejecutar como: yo/);
  assert.match(files["README.md"], /Acceso: cualquier usuario/);
  assert.equal(APP_VERSION, "0.6.0");
  assert.match(files["js/config.js"], /planes-swipe v0\.6\.0/);
  assert.match(files["sw.js"], /const CACHE = "planes-swipe-v0\.6\.0"/);
  assert.match(files["sw.js"], /\.\/css\/styles\.css\?v=0\.6\.0/);
  assert.match(files["sw.js"], /\.\/js\/app\.js\?v=0\.6\.0/);
  assert.match(files["sw.js"], /\.\/manifest\.json\?v=0\.6\.0/);
  assert.match(files["sw.js"], /\.\/downloads\/plantilla-eventos\.xlsx/);
  assert.match(files["sw.js"], /\.\/downloads\/Code\.gs/);
  assert.match(files["manifest.json"], /"version": "0\.6\.0"/);
  assert.match(files["README.md"], /planes-swipe v0\.6\.0/);
  assert.match(files["index.html"], /Cómo preparar la hoja/);
  assert.match(files["index.html"], /id="help-dialog"/);
  assert.match(files["index.html"], /downloads\/plantilla-eventos\.xlsx/);
  assert.match(files["index.html"], /downloads\/Code\.gs/);
  assert.match(files["index.html"], /Cualquier usuario/);
  assert.match(files["css/styles.css"], /:root\[data-theme="light"\] \.icon-btn \.icon-sun \{ display: none; \}/);
  assert.match(files["css/styles.css"], /:root\[data-theme="dark"\] \.icon-btn \.icon-moon \{ display: none; \}/);
  assert.equal(DEFAULT_SHEET_TITLE, "Eventos y planes");
  assert.match(read("js/sheet.js"), /me_intriga/);
  assert.match(files["js/config.js"], /me_interesa/);
  assert.doesNotMatch(files["js/config.js"], /me_intriga/);
  assert.match(read(".nojekyll"), /^$/);
  assert.throws(() => read("js/google.js"));
});
