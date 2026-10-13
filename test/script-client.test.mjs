import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { HEADERS } from "../js/config.js";
import { connectionError, listRows, rateWithRetry } from "../js/script.js";
import { createEnv, payload } from "./gas-harness.mjs";

function row() {
  return {
    id: "EV-001",
    nombre_evento: "Feria del libro",
    preferencia: "",
    calificado_en: "",
    comentario_usuario: "",
  };
}

function listen(env, posts) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/exec") {
      res.writeHead(404);
      res.end();
      return;
    }
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
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(output.getContent());
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("the script url must be https or local and end in /exec", () => {
  assert.match(connectionError("", "clave"), /URL/);
  assert.match(connectionError("http://example.com/exec", "clave"), /https/);
  assert.match(connectionError("https://script.google.com/macros/s/abc/dev", "clave"), /\/exec/);
  assert.equal(connectionError("https://script.google.com/macros/s/abc/exec", "clave"), "");
  assert.equal(connectionError("http://127.0.0.1:9/exec", "clave"), "");
});

test("the client lists with GET and retries a mismatched rating once", async () => {
  const env = createEnv({ rows: [row()], failPreferencia: 1 });
  const posts = [];
  const server = await listen(env, posts);
  try {
    const url = `http://127.0.0.1:${server.address().port}/exec`;
    const listed = await listRows(url, "s3cret");
    assert.equal(listed.ok, true);
    assert.equal(listed.rows[0].nombre_evento, "Feria del libro");
    const denied = await listRows(url, "otra");
    assert.equal(denied.error, "forbidden");

    const rated = await rateWithRetry(url, "s3cret", {
      id: "EV-001",
      preferencia: "me_gusta",
      comentario: "hola",
    });
    assert.equal(rated.ok, true);
    assert.equal(rated.retried, true);
    assert.equal(rated.attempts, 2);
    assert.equal(posts.length, 2);
    assert.match(posts[0].type, /^text\/plain/i);
    assert.equal(JSON.parse(posts[0].body).action, "rate");
    assert.equal(JSON.parse(posts[0].body).comentario_usuario, "hola");
    assert.equal(env.values[1][HEADERS.indexOf("preferencia")], "me_gusta");
    assert.equal(env.values[1][HEADERS.indexOf("nombre_evento")], "Feria del libro");
    assert.equal(payload(env.doGet({ parameter: { action: "list", key: "s3cret" } })).rows[0].comentario_usuario, "hola");
  } finally {
    server.close();
  }
});
