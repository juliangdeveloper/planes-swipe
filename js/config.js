// planes-swipe v0.7.0 — static config. No URL and no key live in this file.
export const APP_ID = "planes-swipe";
export const APP_VERSION = "0.7.0";
export const STORAGE_CONNECTION_KEY = "planes-swipe.connection.v1";
export const STORAGE_QUEUE_KEY = "planes-swipe.queue.v1";
export const STORAGE_QUIERO_KEY = "planes-swipe.quiero.v1";
export const STORAGE_THEME_KEY = "planes-swipe.theme";
export const QUIERO_HEADER = "quiero ir";

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
  QUIERO_HEADER,
];

// Una frase por columna, en el mismo orden que HEADERS. La pantalla de ayuda la muestra.
export const COLUMN_HELP = {
  id: "Identificador único de la fila. Un texto corto, por ejemplo EJEMPLO-001. No lo repitas.",
  fecha_registro: "Fecha en que anotaste el plan. Formato AAAA-MM-DD.",
  nombre_evento: "Nombre del plan, tal como se ve en la tarjeta.",
  categoria: "Tipo de plan: Música, Teatro, Comida, Cultura u otro texto corto.",
  fecha_evento: "Día en que ocurre. Formato AAAA-MM-DD.",
  ciudad: "Ciudad donde es el plan.",
  departamento: "Departamento o región.",
  lugar: "Sitio o dirección corta.",
  precio: "Un número entero, como 45000, o la palabra Gratis.",
  estado: "Solo anuncio, Entradas a la venta, Agotado o Cancelado.",
  link_info: "Enlace http o https con más información, o vacío.",
  link_entradas: "Enlace http o https de la boletería, o vacío.",
  para_quien: "Para quién es el plan. Texto libre.",
  motivo_recomendacion: "Por qué conviene ir. Se muestra en la tarjeta.",
  ultima_revision: "Última vez que revisaste el dato. Formato AAAA-MM-DD.",
  preferencia: "Déjala vacía. La app escribe no_me_gusta, me_interesa, me_gusta o me_encanta.",
  calificado_en: "Déjala vacía. El script escribe la hora de Bogotá al calificar.",
  comentario_usuario: "Déjala vacía. La app escribe aquí el comentario.",
  imagen_1: "Enlace http o https de la foto principal, o vacío.",
  imagen_2: "Segunda foto (http o https), o vacío.",
  imagen_3: "Tercera foto (http o https), o vacío.",
  [QUIERO_HEADER]: "TRUE o FALSE. La app lo cambia con el botón Quiero ir.",
};
