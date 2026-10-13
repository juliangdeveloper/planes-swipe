export function bogotaIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "00";
  let hour = pick("hour");
  if (hour === "24") hour = "00";
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const minute = pick("minute");
  const second = pick("second");
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const offsetMin = Math.round((asUtc - date.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${hh}:${mm}`;
}

export function formatFecha(raw) {
  const text = String(raw ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date).replace(/\.$/, "");
}

export function formatPrecio(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (/^gratis$/i.test(text)) return "Gratis";
  if (/^\d+$/.test(text)) {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(Number(text));
  }
  return text;
}

export function formatLugar(row) {
  const lugar = String(row?.lugar ?? "").trim();
  const ciudad = String(row?.ciudad ?? "").trim();
  if (lugar && ciudad && lugar.toLowerCase() !== ciudad.toLowerCase()) return `${lugar} · ${ciudad}`;
  return lugar || ciudad || String(row?.departamento ?? "").trim();
}

export function safeHttpUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    return "";
  }
  return "";
}

export function safeImageUrl(value) {
  const text = String(value ?? "").trim();
  if (/^img\/[a-z0-9-]+\.svg$/i.test(text)) return text;
  return safeHttpUrl(text);
}
