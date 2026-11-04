export function normalizePreferencia(value) {
  const text = String(value ?? "").trim();
  return text === "me_intriga" ? "me_interesa" : text;
}

export function isQuieroIr(value) {
  if (value === true) return true;
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function quieroText(value) {
  return isQuieroIr(value) ? "TRUE" : "FALSE";
}

export function objectsToMatrix(objects, headers) {
  return [
    headers.slice(),
    ...objects.map((row) => headers.map((header) => String(row?.[header] ?? ""))),
  ];
}

export function isUnrated(row) {
  return !String(row?.preferencia ?? "").trim();
}
