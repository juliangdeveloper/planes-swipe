import { STORAGE_CONNECTION_KEY } from "./config.js";

export function connectionError(url, key) {
  const trimmed = String(url ?? "").trim();
  const secret = String(key ?? "");
  if (!trimmed || !secret.trim()) return "Escribe la URL /exec y la clave.";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Esa URL no es válida.";
  }
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!(parsed.protocol === "https:" || (parsed.protocol === "http:" && local))) {
    return "La URL tiene que empezar por https.";
  }
  if (!parsed.pathname.endsWith("/exec")) {
    return "Usa la URL que termina en /exec.";
  }
  return "";
}

export function loadConnection(storage) {
  if (!storage) return null;
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_CONNECTION_KEY) || "null");
    if (!raw || typeof raw.url !== "string" || typeof raw.key !== "string") return null;
    const url = raw.url.trim();
    if (!url || !raw.key.trim() || connectionError(url, raw.key)) return null;
    return { url, key: raw.key };
  } catch {
    return null;
  }
}

export function saveConnection(storage, connection) {
  storage.setItem(STORAGE_CONNECTION_KEY, JSON.stringify({
    url: connection.url,
    key: connection.key,
  }));
}

export function clearConnection(storage) {
  storage.removeItem(STORAGE_CONNECTION_KEY);
}

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store", ...options });
  } catch {
    throw Object.assign(new Error("network"), { code: "network" });
  }
  if (!response.ok) {
    throw Object.assign(new Error("http"), { code: "http", status: response.status });
  }
  try {
    return await response.json();
  } catch {
    throw Object.assign(new Error("bad_request"), { code: "bad_request" });
  }
}

export async function listRows(url, key) {
  const endpoint = new URL(url);
  endpoint.searchParams.set("action", "list");
  endpoint.searchParams.set("key", key);
  return request(endpoint.toString(), { method: "GET" });
}

export async function sendRating(url, key, { id, preferencia, comentario }) {
  const body = JSON.stringify({
    key,
    action: "rate",
    id,
    preferencia,
    comentario_usuario: comentario ?? "",
  });
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body,
  });
}

function asResult(body) {
  if (body && body.ok === true) {
    return {
      ok: true,
      reason: "ok",
      preferencia: body.preferencia,
      calificado_en: body.calificado_en,
      comentario_usuario: body.comentario_usuario,
    };
  }
  return { ok: false, reason: body?.error || "server" };
}

export async function rateWithRetry(url, key, rating) {
  const first = asResult(await sendRating(url, key, rating));
  if (first.ok || first.reason !== "mismatch") return { ...first, attempts: 1, retried: false };
  const second = asResult(await sendRating(url, key, rating));
  return { ...second, attempts: 2, retried: true };
}
