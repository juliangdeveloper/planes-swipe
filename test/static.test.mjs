import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_FILE_ID, GOOGLE_API_KEY, GOOGLE_APP_ID, GOOGLE_CLIENT_ID, SCOPE } from "../js/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("pages assets are relative and Google ids match food-log", () => {
  const files = {
    "index.html": read("index.html"),
    "css/styles.css": read("css/styles.css"),
    "js/app.js": read("js/app.js"),
    "js/config.js": read("js/config.js"),
    "js/google.js": read("js/google.js"),
    "manifest.json": read("manifest.json"),
    "sw.js": read("sw.js"),
  };
  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(source, /(?:src|href)\s*=\s*["']\//, `${name} has a root-absolute asset`);
    assert.doesNotMatch(source, /url\(\s*["']?\//, `${name} has a root-absolute css url`);
  }
  assert.match(files["index.html"], /href="css\/styles.css"/);
  assert.match(files["index.html"], /src="js\/app.js"/);
  assert.match(files["index.html"], /lang="es-CO"/);
  assert.match(files["index.html"], /planes-swipe v0\.1\.0/);
  assert.match(files["index.html"], /Me interesa/);
  assert.doesNotMatch(files["index.html"], /intriga/);
  assert.equal(GOOGLE_CLIENT_ID, "");
  assert.equal(GOOGLE_API_KEY, "");
  assert.equal(GOOGLE_APP_ID, "");
  assert.equal(DEFAULT_FILE_ID, "1_TuTWcX-5_kdocBhsqMqwOQVv5cy_6gwBJnp4bQc_Dg");
  assert.equal(SCOPE, "https://www.googleapis.com/auth/drive.file");
  assert.match(files["js/config.js"], /auth\/drive\.file/);
  assert.match(files["js/google.js"], /scope: SCOPE/);
  assert.match(files["js/google.js"], /setAppId/);
  assert.match(read("js/sheet.js"), /me_intriga/);
  assert.match(files["js/config.js"], /me_interesa/);
  assert.doesNotMatch(files["js/config.js"], /me_intriga/);
  assert.match(read(".nojekyll"), /^$/);
});
