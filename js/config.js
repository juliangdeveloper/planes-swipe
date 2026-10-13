// planes-swipe v0.1.0 — static config, same pattern as food-log js/config.js.
export const APP_ID = "planes-swipe";
export const APP_VERSION = "0.1.0";
export const STORAGE_FILE_KEY = "planes-swipe.file.v1";
export const STORAGE_QUEUE_KEY = "planes-swipe.queue.v1";
export const STORAGE_THEME_KEY = "planes-swipe.theme";

// Spreadsheet «Eventos y planes — Julian y Valen».
// This is the file id, not a tab title. The first tab is resolved on each read.
export const DEFAULT_FILE_ID = "1_TuTWcX-5_kdocBhsqMqwOQVv5cy_6gwBJnp4bQc_Dg";
export const DEFAULT_SHEET_TITLE = "Eventos y planes — Julian y Valen";

// Copied from food-log v0.2.0 (commit 765a52b). Both constants are empty there.
// Do not invent a client id or an API key.
export const GOOGLE_CLIENT_ID = "";

// Optional browser API key for the Picker. Empty in food-log. Never commit a secret
// that is not already a referrer-restricted browser key.
export const GOOGLE_API_KEY = "";

// Cloud project NUMBER for Picker setAppId (Google calls this the App ID).
// food-log does not commit one. Leave empty until the same project number is pasted in.
export const GOOGLE_APP_ID = "";

// drive.file is enough for the Sheets API on a file the Picker has granted.
export const SCOPE = "https://www.googleapis.com/auth/drive.file";

export const RATINGS = [
  { id: "no_me_gusta", label: "No me gusta", dir: "left" },
  { id: "me_interesa", label: "Me interesa", dir: "down" },
  { id: "me_gusta", label: "Me gusta", dir: "right" },
  { id: "me_encanta", label: "Me encanta", dir: "up" },
];

export const GROUP_ORDER = ["me_encanta", "me_gusta", "me_interesa", "no_me_gusta"];

export const HEADERS = [
  "id",
  "fecha_registro",
  "nombre_evento",
  "categoria",
  "fecha_evento",
  "ciudad",
  "departamento",
  "lugar",
  "precio",
  "estado",
  "link_info",
  "link_entradas",
  "para_quien",
  "motivo_recomendacion",
  "ultima_revision",
  "preferencia",
  "calificado_en",
  "comentario_usuario",
  "imagen_1",
  "imagen_2",
  "imagen_3",
];
