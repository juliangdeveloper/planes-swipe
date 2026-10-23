
var RATING_VALUES_ = {
  "": true,
  "no_me_gusta": true,
  "me_interesa": true,
  "me_gusta": true,
  "me_encanta": true,
};

var NEEDED_HEADERS_ = ["id", "preferencia", "calificado_en", "comentario_usuario"];
var QUIERO_HEADER_ = "quiero ir";

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!authorized_(params.key)) return json_({ ok: false, error: "forbidden" });
  if (params.action !== "list") return json_({ ok: false, error: "bad_request" });
  try {
    return json_(listRows_());
  } catch (err) {
    return json_({ ok: false, error: "server" });
  }
}

function doPost(e) {
  var body = parseBody_(e);
  if (!body) return json_({ ok: false, error: "bad_request" });
  if (!authorized_(body.key)) return json_({ ok: false, error: "forbidden" });
  try {
    if (body.action === "rate") return json_(rate_(body));
    if (body.action === "quiero") return json_(quiero_(body));
    return json_({ ok: false, error: "bad_request" });
  } catch (err) {
    return json_({ ok: false, error: "server" });
  }
}

function authorized_(given) {
  var secret = "";
  try {
    secret = String(PropertiesService.getScriptProperties().getProperty("SECRET") || "");
  } catch (err) {
    secret = "";
  }
  if (!secret) return false;
  var provided = String(given == null ? "" : given);
  var length = Math.max(provided.length, secret.length);
  var diff = provided.length ^ secret.length;
  for (var i = 0; i < length; i += 1) {
    var left = i < provided.length ? provided.charCodeAt(i) : 0;
    var right = i < secret.length ? secret.charCodeAt(i) : 0;
    diff |= left ^ right;
  }
  return diff === 0;
}

function parseBody_(e) {
  var raw = e && e.postData && e.postData.contents;
  if (typeof raw !== "string" || !raw) return null;
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Object.prototype.toString.call(parsed) === "[object Array]") {
      return null;
    }
    return parsed;
  } catch (err) {
    return null;
  }
}

function normalizePreferencia_(value) {
  var text = String(value == null ? "" : value).trim();
  return text === "me_intriga" ? "me_interesa" : text;
}

function isQuieroIr_(value) {
  if (value === true) return true;
  return String(value == null ? "" : value).trim().toLowerCase() === "true";
}

function quieroText_(value) {
  return isQuieroIr_(value) ? "TRUE" : "FALSE";
}

function parseQuiero_(value) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    var text = value.trim().toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return null;
}

function bogotaIso_() {
  return Utilities.formatDate(new Date(), "America/Bogota", "yyyy-MM-dd'T'HH:mm:ss") + "-05:00";
}

function cellText_(value) {
  if (value == null) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) return "";
    var clock = Utilities.formatDate(value, "America/Bogota", "HH:mm:ss");
    if (clock === "00:00:00") return Utilities.formatDate(value, "America/Bogota", "yyyy-MM-dd");
    return Utilities.formatDate(value, "America/Bogota", "yyyy-MM-dd'T'HH:mm:ss") + "-05:00";
  }
  if (typeof value === "number") {
    if (!isFinite(value)) return "";
    return String(value);
  }
  return String(value).trim();
}

function readContext_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  if (!sheets || !sheets.length) return { ok: false, error: "headers" };
  var sheet = sheets[0];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { ok: false, error: "headers" };
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headerRow = values[0] || [];
  var headers = [];
  var map = {};
  for (var c = 0; c < headerRow.length; c += 1) {
    var name = cellText_(headerRow[c]).toLowerCase();
    headers.push(name);
    if (name && !Object.prototype.hasOwnProperty.call(map, name)) map[name] = c + 1;
  }
  for (var i = 0; i < NEEDED_HEADERS_.length; i += 1) {
    if (!map[NEEDED_HEADERS_[i]]) return { ok: false, error: "headers" };
  }
  return { ok: true, ss: ss, sheet: sheet, values: values, headers: headers, map: map };
}

function rowObject_(headers, line) {
  var row = {};
  for (var c = 0; c < headers.length; c += 1) {
    var name = headers[c];
    if (!name || Object.prototype.hasOwnProperty.call(row, name)) continue;
    if (name === QUIERO_HEADER_) {
      row[name] = quieroText_(line ? line[c] : "");
      continue;
    }
    var text = cellText_(line ? line[c] : "");
    row[name] = name === "preferencia" ? normalizePreferencia_(text) : text;
  }
  return row;
}

function listRows_() {
  var ctx = readContext_();
  if (!ctx.ok) return ctx;
  var rows = [];
  for (var r = 1; r < ctx.values.length; r += 1) {
    var row = rowObject_(ctx.headers, ctx.values[r]);
    if (row.id) rows.push(row);
  }
  return { ok: true, title: ctx.ss.getName(), rows: rows };
}

function findRow_(ctx, id) {
  var column = ctx.map.id - 1;
  for (var r = 1; r < ctx.values.length; r += 1) {
    var line = ctx.values[r] || [];
    if (cellText_(line[column]) === id) return r + 1;
  }
  return 0;
}

function rate_(body) {
  var preferencia = normalizePreferencia_(body.preferencia);
  if (!Object.prototype.hasOwnProperty.call(RATING_VALUES_, preferencia)) {
    return { ok: false, error: "rating" };
  }
  var id = String(body.id == null ? "" : body.id).trim();
  if (!id) return { ok: false, error: "missing_id" };
  var comentario = String(body.comentario_usuario == null ? "" : body.comentario_usuario).trim();

  var lock = LockService.getScriptLock();
  var held = false;
  try {
    lock.waitLock(30000);
    held = true;
    var ctx = readContext_();
    if (!ctx.ok) return ctx;
    var row = findRow_(ctx, id);
    if (!row) return { ok: false, error: "missing_id" };
    var when = preferencia ? bogotaIso_() : "";
    ctx.sheet.getRange(row, ctx.map.preferencia).setValue(preferencia);
    ctx.sheet.getRange(row, ctx.map.calificado_en).setValue(when);
    ctx.sheet.getRange(row, ctx.map.comentario_usuario).setValue(comentario);
    SpreadsheetApp.flush();
    var gotPreferencia = cellText_(ctx.sheet.getRange(row, ctx.map.preferencia).getValue());
    var gotWhen = cellText_(ctx.sheet.getRange(row, ctx.map.calificado_en).getValue());
    var gotComment = cellText_(ctx.sheet.getRange(row, ctx.map.comentario_usuario).getValue());
    if (gotPreferencia !== preferencia || gotWhen !== when || gotComment !== comentario) {
      return { ok: false, error: "mismatch", id: id };
    }
    return {
      ok: true,
      id: id,
      preferencia: gotPreferencia,
      calificado_en: gotWhen,
      comentario_usuario: gotComment,
    };
  } catch (err) {
    if (!held) return { ok: false, error: "lock" };
    return { ok: false, error: "server" };
  } finally {
    if (held) lock.releaseLock();
  }
}

function quiero_(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "quiero_ir")) return { ok: false, error: "bad_request" };
  var want = parseQuiero_(body.quiero_ir);
  if (want === null) return { ok: false, error: "bad_request" };
  var id = String(body.id == null ? "" : body.id).trim();
  if (!id) return { ok: false, error: "missing_id" };

  var lock = LockService.getScriptLock();
  var held = false;
  try {
    lock.waitLock(30000);
    held = true;
    var ctx = readContext_();
    if (!ctx.ok) return ctx;
    if (!ctx.map[QUIERO_HEADER_]) return { ok: false, error: "headers" };
    var row = findRow_(ctx, id);
    if (!row) return { ok: false, error: "missing_id" };
    ctx.sheet.getRange(row, ctx.map[QUIERO_HEADER_]).setValue(want);
    SpreadsheetApp.flush();
    var got = ctx.sheet.getRange(row, ctx.map[QUIERO_HEADER_]).getValue();
    if (isQuieroIr_(got) !== want) return { ok: false, error: "mismatch", id: id };
    var result = { ok: true, id: id };
    result[QUIERO_HEADER_] = quieroText_(got);
    return result;
  } catch (err) {
    if (!held) return { ok: false, error: "lock" };
    return { ok: false, error: "server" };
  } finally {
    if (held) lock.releaseLock();
  }
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
