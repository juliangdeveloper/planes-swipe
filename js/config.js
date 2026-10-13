// planes-swipe v0.2.0 — static config. No URL and no key live in this file.
export const APP_ID = "planes-swipe";
export const APP_VERSION = "0.2.0";
export const STORAGE_CONNECTION_KEY = "planes-swipe.connection.v1";
export const STORAGE_QUEUE_KEY = "planes-swipe.queue.v1";
export const STORAGE_THEME_KEY = "planes-swipe.theme";

// Nombre de la hoja a la que se liga el Apps Script. No es una URL ni una clave.
export const DEFAULT_SHEET_TITLE = "Eventos y planes";

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
