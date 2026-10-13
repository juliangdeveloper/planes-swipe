import {
  APP_VERSION,
  GROUP_ORDER,
  RATINGS,
  STORAGE_THEME_KEY,
} from "./config.js";
import { DEMO_TITLE, demoMatrix } from "./demo.js";
import { bogotaIso, formatFecha, formatLugar, formatPrecio, safeHttpUrl, safeImageUrl } from "./format.js";
import { createMemoryStorage, enqueue, isNetworkError, loadQueue, removeQueued } from "./queue.js";
import {
  clearConnection,
  connectionError,
  listRows,
  loadConnection,
  rateWithRetry,
  saveConnection,
} from "./script.js";
import { commitRatingRetry, createMemoryClient, isUnrated, loadGrid, normalizePreferencia } from "./sheet.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const demo = params.get("demo") === "1";
const DIR = { left: "no_me_gusta", right: "me_gusta", up: "me_encanta", down: "me_interesa" };
const ESTADO = {
  "Solo anuncio": "anuncio",
  "Entradas a la venta": "venta",
  "Agotado": "agotado",
  "Cancelado": "cancelado",
};

const state = {
  view: "loading",
  rows: [],
  connection: null,
  spreadsheetTitle: "",
  client: null,
  storage: null,
  undo: null,
  busy: false,
  flushing: false,
  editing: "",
  editRating: "",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function currentTheme() {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", currentTheme() === "dark" ? "#000000" : "#f2f2f7");
  $("theme").setAttribute("aria-label", currentTheme() === "dark" ? "Usar tema claro" : "Usar tema oscuro");
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(STORAGE_THEME_KEY, next); } catch { /* private mode */ }
  applyThemeColor();
}

let toastTimer = 0;
function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

function tick() {
  try { navigator.vibrate?.(10); } catch { /* ignore */ }
}

function show(name) {
  state.view = name;
  $("loading").hidden = name !== "loading";
  $("gate").hidden = name !== "gate";
  $("stage").hidden = name !== "stack";
  $("rated").hidden = name !== "rated";
}

function queuedJobs() {
  const jobs = loadQueue(state.storage);
  if (demo) return jobs.filter((job) => job.fileId === "demo");
  const endpoint = state.connection?.url;
  return jobs.filter((job) => job.endpoint === endpoint);
}

function applyJob(job) {
  const row = state.rows.find((item) => item.id === job.id);
  if (!row) return;
  row.preferencia = normalizePreferencia(job.preferencia);
  row.calificado_en = job.calificado_en;
  row.comentario_usuario = job.comentario;
}

function overlayQueue() {
  for (const job of queuedJobs()) {
    const row = state.rows.find((item) => item.id === job.id);
    if (!row) continue;
    row.preferencia = normalizePreferencia(job.preferencia);
    row.calificado_en = job.calificado_en;
    row.comentario_usuario = job.comentario;
  }
}

async function refreshRows() {
  if (demo) {
    const grid = await loadGrid(state.client, "demo");
    state.rows = grid.rows;
    state.spreadsheetTitle = grid.spreadsheetTitle || DEMO_TITLE;
    const missing = ["id", "preferencia", "calificado_en", "comentario_usuario"].filter(
      (name) => !grid.headers.includes(name),
    );
    if (missing.length) throw Object.assign(new Error("headers"), { code: "headers", missing });
  } else {
    const body = await listRows(state.connection.url, state.connection.key);
    if (!body || body.ok !== true || !Array.isArray(body.rows)) {
      throw Object.assign(new Error(body?.error || "bad_request"), { code: body?.error || "bad_request" });
    }
    state.rows = body.rows.map((row) => ({
      ...row,
      id: String(row?.id ?? "").trim(),
      preferencia: normalizePreferencia(row?.preferencia),
      calificado_en: String(row?.calificado_en ?? ""),
      comentario_usuario: String(row?.comentario_usuario ?? ""),
    })).filter((row) => row.id);
    state.spreadsheetTitle = String(body.title || "Planes");
  }
  overlayQueue();
  render();
}

function render() {
  if (state.view === "gate" || state.view === "loading") return;
  show(state.view === "rated" ? "rated" : "stack");
  const unrated = state.rows.filter(isUnrated);
  const pending = queuedJobs().length;
  const title = state.spreadsheetTitle || "Planes";
  $("subtitle").textContent = pending ? `${title} · ${pending} por enviar` : title;
  $("count").textContent = state.view === "rated"
    ? `${state.rows.length - unrated.length} calificados`
    : `${unrated.length} sin calificar`;
  $("undo").disabled = !state.undo || state.busy;
  $("view").textContent = state.view === "rated" ? "Planes" : "Calificados";
  $("view").setAttribute("aria-pressed", state.view === "rated" ? "true" : "false");
  if (state.view === "rated") renderRated();
  else renderStack(unrated);
  document.querySelectorAll("#actions [data-rate]").forEach((button) => {
    button.disabled = unrated.length === 0 || state.busy;
  });
  document.documentElement.dataset.ready = "1";
}

function renderStack(unrated) {
  const stack = $("stack");
  const empty = $("empty");
  stack.replaceChildren();
  empty.hidden = unrated.length !== 0;
  stack.hidden = unrated.length === 0;
  unrated.slice(0, 3).forEach((row, index) => {
    const card = buildCard(row, index);
    stack.append(card);
  });
}

function buildCard(row, index) {
  const card = el("article", index === 0 ? "card top" : "card back");
  card.style.zIndex = String(30 - index);
  if (index === 0) {
    card.id = "top-card";
    card.dataset.id = row.id;
    card.dataset.name = row.nombre_evento || row.id;
  } else {
    card.style.transform = `translateY(${8 + index * 8}px) scale(${1 - index * 0.035})`;
    card.setAttribute("aria-hidden", "true");
  }
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", row.nombre_evento || row.id);

  const photos = [row.imagen_1, row.imagen_2, row.imagen_3].map(safeImageUrl).filter(Boolean);
  card.dataset.photos = JSON.stringify(photos);
  const photo = el("div", "photo");
  const img = document.createElement("img");
  img.alt = row.nombre_evento || "Plan";
  img.hidden = true;
  const fallback = el("div", "fallback", "Sin foto");
  fallback.hidden = photos.length > 0;
  photo.append(img, fallback);
  if (photos.length > 1) {
    const dots = el("div", "dots");
    dots.setAttribute("role", "tablist");
    dots.setAttribute("aria-label", "Fotos");
    photos.forEach((_, photoIndex) => {
      const dot = el("button", "dot");
      dot.type = "button";
      dot.dataset.i = String(photoIndex);
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", `Foto ${photoIndex + 1}`);
      dot.addEventListener("click", (event) => {
        event.stopPropagation();
        showPhoto(card, photoIndex);
      });
      dots.append(dot);
    });
    photo.append(dots);
  }
  card.append(photo);

  for (const rating of RATINGS) {
    const stamp = el("div", `stamp ${rating.dir}`, rating.label);
    stamp.dataset.dir = rating.dir;
    card.append(stamp);
  }

  const body = el("div", "card-body");
  body.append(el("h2", "name", row.nombre_evento || row.id));
  const when = formatFecha(row.fecha_evento);
  if (when) body.append(el("p", "when", when));
  const where = [formatLugar(row), formatPrecio(row.precio)].filter(Boolean).join(" · ");
  if (where) body.append(el("p", "where", where));

  const chips = el("div", "chips");
  if (row.estado) chips.append(chip(row.estado, `chip ${ESTADO[row.estado] || ""}`));
  if (row.para_quien) chips.append(chip(row.para_quien, "chip quien"));
  if (chips.childElementCount) body.append(chips);
  if (row.motivo_recomendacion) body.append(el("p", "motivo", row.motivo_recomendacion));

  const links = el("p", "links");
  addLink(links, row.link_info, "Más info");
  addLink(links, row.link_entradas, "Entradas");
  if (links.childElementCount) body.append(links);
  card.append(body);

  if (index === 0) {
    showPhoto(card, 0);
    bindCard(card);
  }
  return card;
}

function chip(text, className) {
  const node = el("span", className, text);
  return node;
}

function addLink(parent, href, label) {
  const url = safeHttpUrl(href);
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  parent.append(link);
}

function showPhoto(card, index) {
  const photos = JSON.parse(card.dataset.photos || "[]");
  const img = card.querySelector("img");
  const fallback = card.querySelector(".fallback");
  if (!photos.length) {
    img.hidden = true;
    fallback.hidden = false;
    return;
  }
  const next = (index + photos.length) % photos.length;
  card.dataset.photo = String(next);
  fallback.hidden = true;
  img.hidden = false;
  img.onload = () => {
    img.hidden = false;
    fallback.hidden = true;
  };
  img.onerror = () => {
    img.hidden = true;
    fallback.hidden = false;
  };
  img.src = photos[next];
  card.querySelectorAll(".dot").forEach((dot, dotIndex) => {
    dot.setAttribute("aria-selected", dotIndex === next ? "true" : "false");
  });
}

function stepPhoto(card, delta) {
  const photos = JSON.parse(card.dataset.photos || "[]");
  if (photos.length < 2) return;
  const current = Number(card.dataset.photo || "0");
  showPhoto(card, current + delta);
}

function dominant(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function setStamps(card, dir, opacity) {
  card.querySelectorAll(".stamp").forEach((stamp) => {
    stamp.style.opacity = stamp.dataset.dir === dir ? String(opacity) : "0";
  });
  const rating = DIR[dir] || "";
  card.dataset.armed = opacity >= 1 ? rating : "";
}

function highlight(rating, on) {
  document.querySelectorAll("#actions [data-rate]").forEach((button) => {
    button.classList.toggle("is-armed", Boolean(on && button.dataset.rate === rating));
  });
}

function resetCard(card) {
  card.style.transition = "transform 480ms cubic-bezier(0.34, 1.56, 0.64, 1)";
  card.style.transform = "";
  setStamps(card, "", 0);
  highlight("", false);
}

function fly(card, dir) {
  const width = card.offsetWidth || 300;
  const height = card.offsetHeight || 420;
  const to = {
    left: `translate(${-width * 1.35}px, 20px) rotate(-16deg)`,
    right: `translate(${width * 1.35}px, 20px) rotate(16deg)`,
    up: `translate(0, ${-height * 1.15}px) scale(0.96)`,
    down: `translate(0, ${height * 1.05}px) scale(0.98)`,
  }[dir];
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    card.style.transition = "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)";
    card.style.transform = to;
    card.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 460);
  });
}

function bindCard(card) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let dragging = false;
  let pointerId = null;
  let armed = "";
  const photo = card.querySelector(".photo");

  card.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.busy) return;
    if (event.target.closest("a, button, input, textarea")) return;
    dragging = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    dy = 0;
    armed = "";
    card.setPointerCapture(event.pointerId);
    card.style.animation = "none";
    card.style.transition = "none";
  });

  card.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    dx = event.clientX - startX;
    dy = event.clientY - startY;
    const rot = Math.max(-16, Math.min(16, dx / 18));
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    const dir = dominant(dx, dy);
    const mag = dir === "left" || dir === "right" ? Math.abs(dx) : Math.abs(dy);
    const opacity = Math.max(0, Math.min(1, mag / 72));
    setStamps(card, dir, opacity);
    const nextArmed = opacity >= 1 ? DIR[dir] : "";
    if (nextArmed && nextArmed !== armed) tick();
    armed = nextArmed;
    highlight(nextArmed, Boolean(nextArmed));
  });

  const finish = (event, cancel) => {
    if (!dragging || (event && pointerId != null && event.pointerId !== pointerId)) return;
    dragging = false;
    const tap = Math.hypot(dx, dy) < 10;
    if (tap && !cancel && photo && event) {
      const rect = photo.getBoundingClientRect();
      if (event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientY <= rect.bottom - 28) {
        const x = event.clientX - rect.left;
        if (x < rect.width * 0.33) stepPhoto(card, -1);
        else if (x > rect.width * 0.67) stepPhoto(card, 1);
      }
      resetCard(card);
      return;
    }
    const dir = dominant(dx, dy);
    const mag = dir === "left" || dir === "right" ? Math.abs(dx) : Math.abs(dy);
    if (!cancel && mag >= 72) {
      const rating = DIR[dir];
      const id = card.dataset.id;
      const comentario = $("comment").value;
      state.busy = true;
      fly(card, dir).then(() => finishRating(id, rating, comentario));
      return;
    }
    resetCard(card);
  };

  card.addEventListener("pointerup", (event) => finish(event, false));
  card.addEventListener("pointercancel", (event) => finish(event, true));
}

function dirOf(rating) {
  return RATINGS.find((item) => item.id === rating)?.dir || "right";
}

async function onRate(rating) {
  if (state.busy || state.view !== "stack") return;
  const card = $("top-card");
  if (!card) return;
  state.busy = true;
  tick();
  highlight(rating, true);
  const id = card.dataset.id;
  const comentario = $("comment").value;
  setStamps(card, dirOf(rating), 1);
  await fly(card, dirOf(rating));
  await finishRating(id, rating, comentario);
}

async function onUndo() {
  if (!state.undo || state.busy) return;
  const { id, before } = state.undo;
  await finishRating(id, before.preferencia, before.comentario_usuario, before.calificado_en);
}

async function finishRating(id, preferencia, comentario, calificadoEn) {
  state.busy = true;
  const row = state.rows.find((item) => item.id === id);
  if (!row) {
    toast("Ese plan ya no está en la lista.");
    state.busy = false;
    render();
    return;
  }
  const before = {
    preferencia: row.preferencia || "",
    calificado_en: row.calificado_en || "",
    comentario_usuario: row.comentario_usuario || "",
  };
  const when = calificadoEn === undefined ? bogotaIso() : calificadoEn;
  const job = {
    id,
    preferencia: normalizePreferencia(preferencia),
    comentario: String(comentario ?? "").trim(),
    calificado_en: when,
    fileId: demo ? "demo" : "",
    endpoint: state.connection?.url || "",
  };
  try {
    if (navigator.onLine === false) {
      enqueue(state.storage, job);
      applyJob(job);
      state.undo = { id, before };
      toast("Sin conexión. La calificación queda en cola y se envía al volver.");
      $("comment").value = "";
      render();
      return;
    }
    const result = await persistRating(job);
    if (result.ok) {
      removeQueued(state.storage, id);
      applyJob({
        ...job,
        preferencia: result.preferencia ?? job.preferencia,
        calificado_en: result.calificado_en ?? job.calificado_en,
        comentario: result.comentario_usuario ?? job.comentario,
      });
      state.undo = { id, before };
      if (result.retried) toast("La hoja cambió al guardar. Se reintentó una vez.");
      $("comment").value = "";
      try { await refreshRows(); } catch { render(); }
      return;
    }
    if (result.reason === "missing_id") {
      toast("Ese plan ya no está en la hoja. Se actualizó la lista.");
      state.undo = null;
      await refreshRows();
      return;
    }
    if (result.reason === "forbidden") {
      toast("La clave no coincide.");
      showGate("La clave no coincide.");
      return;
    }
    toast(result.reason === "headers"
      ? "La hoja no tiene las columnas de calificación."
      : "No se pudo guardar la calificación.");
    render();
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(state.storage, job);
      applyJob(job);
      state.undo = { id, before };
      toast("Sin conexión. La calificación queda en cola y se envía al volver.");
      $("comment").value = "";
      render();
      return;
    }
    if (err.code === "forbidden") {
      toast("La clave no coincide.");
      showGate("La clave no coincide.");
      return;
    }
    toast("No se pudo guardar la calificación.");
    render();
  } finally {
    state.busy = false;
    highlight("", false);
    if (state.view === "stack" || state.view === "rated") render();
  }
}

async function persistRating(job) {
  if (demo) {
    return commitRatingRetry(state.client, {
      spreadsheetId: "demo",
      eventId: job.id,
      preferencia: job.preferencia,
      comentario: job.comentario,
      calificadoEn: job.calificado_en,
    });
  }
  return rateWithRetry(state.connection.url, state.connection.key, {
    id: job.id,
    preferencia: job.preferencia,
    comentario: job.comentario,
  });
}

async function flushQueue() {
  if (state.flushing || demo || !state.connection) return;
  const jobs = queuedJobs();
  if (!jobs.length) return;
  state.flushing = true;
  try {
    for (const job of jobs) {
      try {
        const result = await persistRating(job);
        if (result.ok) {
          removeQueued(state.storage, job.id);
          if (result.retried) toast("La hoja cambió al guardar. Se reintentó una vez.");
        } else if (result.reason === "missing_id") {
          removeQueued(state.storage, job.id);
          toast("Un plan en cola ya no está en la hoja.");
        } else if (result.reason === "forbidden") {
          toast("La clave no coincide.");
          break;
        } else {
          toast("No se pudo guardar una calificación en cola.");
          break;
        }
      } catch (err) {
        if (isNetworkError(err)) break;
        toast("No se pudo enviar la cola.");
        break;
      }
    }
    if (state.view === "stack" || state.view === "rated") await refreshRows();
  } finally {
    state.flushing = false;
  }
}

function renderRated() {
  const root = $("rated");
  root.replaceChildren();
  const labels = Object.fromEntries(RATINGS.map((rating) => [rating.id, rating.label]));
  let any = false;
  for (const id of GROUP_ORDER) {
    const items = state.rows.filter((row) => row.preferencia === id);
    if (!items.length) continue;
    any = true;
    root.append(ratedGroup(labels[id], items));
  }
  const extras = state.rows.filter((row) => row.preferencia && !GROUP_ORDER.includes(row.preferencia));
  if (extras.length) {
    any = true;
    root.append(ratedGroup("Otra", extras));
  }
  if (!any) root.append(el("p", "empty-copy", "Todavía no hay planes calificados."));
}

function ratedGroup(label, items) {
  const section = el("section", "group");
  const heading = el("h2", null, label);
  heading.append(el("span", "gcount", String(items.length)));
  section.append(heading);
  const list = el("ul", "rated-list");
  for (const row of items) list.append(ratedItem(row));
  section.append(list);
  return section;
}

function ratedItem(row) {
  const item = el("li", "rated-item");
  const src = [row.imagen_1, row.imagen_2, row.imagen_3].map(safeImageUrl).find(Boolean);
  if (src) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = "";
    img.src = src;
    img.addEventListener("error", () => img.replaceWith(el("div", "thumb")));
    item.append(img);
  } else {
    item.append(el("div", "thumb"));
  }
  const copy = el("div", "rated-copy");
  copy.append(el("strong", null, row.nombre_evento || row.id));
  const meta = [formatFecha(row.fecha_evento), formatLugar(row)].filter(Boolean).join(" · ");
  if (meta) copy.append(el("p", null, meta));
  if (row.comentario_usuario) copy.append(el("p", "note", row.comentario_usuario));
  item.append(copy);
  const button = el("button", "text-btn", "Cambiar");
  button.type = "button";
  button.dataset.change = row.id;
  item.append(button);
  return item;
}

function openEdit(id) {
  const row = state.rows.find((item) => item.id === id);
  if (!row) return;
  state.editing = id;
  state.editRating = row.preferencia || "me_gusta";
  $("edit-title").textContent = row.nombre_evento || row.id;
  $("edit-comment").value = row.comentario_usuario || "";
  syncEditButtons();
  $("edit-dialog").showModal();
}

function syncEditButtons() {
  document.querySelectorAll("#edit-actions [data-rate]").forEach((button) => {
    const on = button.dataset.rate === state.editRating;
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function messageFor(err) {
  const code = err?.code || err?.reason;
  if (code === "forbidden") return "La clave no coincide.";
  if (code === "headers") return "La primera pestaña no tiene las columnas de calificación.";
  if (code === "network") return "No se pudo conectar. Revisa la URL /exec.";
  if (code === "lock") return "La hoja está ocupada. Intenta otra vez.";
  return "No se pudo conectar con la aplicación web.";
}

function setFormError(settings, message) {
  const node = $(settings ? "settings-error" : "gate-error");
  node.hidden = !message;
  node.textContent = message || "";
}

function showGate(message) {
  show("gate");
  setFormError(false, message || "");
  $("subtitle").textContent = "Configurar conexión";
  $("count").textContent = "";
  const saved = state.connection || loadConnection(state.storage);
  if (saved && !$("script-url").value) {
    $("script-url").value = saved.url;
    $("script-key").value = saved.key;
  }
  document.documentElement.dataset.ready = "1";
}

async function openConnection(connection) {
  show("loading");
  state.connection = { url: connection.url.trim(), key: connection.key };
  state.view = "stack";
  await refreshRows();
  saveConnection(state.storage, state.connection);
  void flushQueue();
}

function formConnection(settings) {
  return {
    url: $(settings ? "settings-url" : "script-url").value.trim(),
    key: $(settings ? "settings-key" : "script-key").value,
  };
}

async function onTestConnection(settings) {
  const connection = formConnection(settings);
  const problem = connectionError(connection.url, connection.key);
  if (problem) {
    setFormError(settings, problem);
    return;
  }
  const button = $(settings ? "settings-save" : "test-connection");
  button.disabled = true;
  try {
    await openConnection(connection);
    if (settings) $("settings-dialog").close();
  } catch (err) {
    const message = messageFor(err);
    if (settings) setFormError(true, message);
    else {
      showGate(message);
      $("script-url").value = connection.url;
      $("script-key").value = connection.key;
    }
  } finally {
    button.disabled = false;
  }
}

function openSettings() {
  if (demo) {
    toast("La demo no cambia la conexión.");
    return;
  }
  const current = state.connection || loadConnection(state.storage) || { url: "", key: "" };
  $("settings-url").value = current.url;
  $("settings-key").value = current.key;
  setFormError(true, "");
  $("settings-dialog").showModal();
}

function onClearConnection() {
  clearConnection(state.storage);
  state.connection = null;
  state.rows = [];
  state.undo = null;
  $("settings-dialog").close();
  $("script-url").value = "";
  $("script-key").value = "";
  showGate("La conexión se olvidó en este navegador.");
}

async function onRefresh() {
  if (state.busy) return;
  try {
    if (!demo) await flushQueue();
    if (state.view === "gate" || state.view === "loading") return;
    await refreshRows();
    toast("Lista actualizada.");
  } catch {
    toast("No se pudo actualizar la hoja.");
  }
}

function bindUi() {
  $("theme").addEventListener("click", toggleTheme);
  $("refresh").addEventListener("click", () => { void onRefresh(); });
  $("pick").addEventListener("click", () => { openSettings(); });
  $("test-connection").addEventListener("click", () => { void onTestConnection(false); });
  $("settings-save").addEventListener("click", () => { void onTestConnection(true); });
  $("settings-clear").addEventListener("click", onClearConnection);
  $("settings-cancel").addEventListener("click", () => $("settings-dialog").close());
  $("view").addEventListener("click", () => {
    if (state.view !== "stack" && state.view !== "rated") return;
    state.view = state.view === "rated" ? "stack" : "rated";
    render();
  });
  $("goto-rated").addEventListener("click", () => {
    state.view = "rated";
    render();
  });
  $("undo").addEventListener("click", () => { void onUndo(); });
  $("actions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-rate]");
    if (!button) return;
    void onRate(button.dataset.rate);
  });
  $("rated").addEventListener("click", (event) => {
    const button = event.target.closest("[data-change]");
    if (!button) return;
    openEdit(button.dataset.change);
  });
  $("edit-actions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-rate]");
    if (!button) return;
    state.editRating = button.dataset.rate;
    syncEditButtons();
  });
  $("edit-cancel").addEventListener("click", () => $("edit-dialog").close());
  $("edit-save").addEventListener("click", () => {
    const id = state.editing;
    const preferencia = state.editRating;
    const comentario = $("edit-comment").value;
    $("edit-dialog").close();
    if (!id || !preferencia) return;
    void finishRating(id, preferencia, comentario);
  });
  document.addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea") || $("edit-dialog").open || $("settings-dialog").open) return;
    if (state.view !== "stack" || state.busy) return;
    const map = {
      ArrowLeft: "no_me_gusta",
      ArrowRight: "me_gusta",
      ArrowUp: "me_encanta",
      ArrowDown: "me_interesa",
    };
    if (map[event.key]) {
      event.preventDefault();
      void onRate(map[event.key]);
      return;
    }
    if ((event.key === "z" || event.key === "Z") && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void onUndo();
    }
  });
  window.addEventListener("online", () => {
    if (!state.busy) void flushQueue();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) applyThemeColor();
  });
}

async function boot() {
  bindUi();
  applyThemeColor();
  $("version").textContent = `planes-swipe v${APP_VERSION}`;
  if (demo) {
    $("demo-badge").hidden = false;
    state.storage = createMemoryStorage();
    state.client = createMemoryClient(demoMatrix(), { title: "Eventos", spreadsheetTitle: DEMO_TITLE });
    state.view = "stack";
    await refreshRows();
    return;
  }
  state.storage = createMemoryStorage();
  try {
    const probe = "__planes";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    state.storage = localStorage;
  } catch { /* keep memory storage */ }
  const saved = loadConnection(state.storage);
  if (!saved) {
    showGate();
    return;
  }
  try {
    await openConnection(saved);
  } catch (err) {
    showGate(messageFor(err));
    $("script-url").value = saved.url;
    $("script-key").value = saved.key;
  }
}

boot().catch(() => {
  showGate("No se pudo abrir Planes.");
});

if (!params.has("nosw") && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
