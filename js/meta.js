const live = { on: true };
const declared = [];
const slots = new WeakMap();
const slotList = new Set();

export const FASE = Object.freeze({ IDEA: 1, DEFINICION: 2, DISENO: 3, CONSTRUCCION: 4, VALIDACION: 5, LANZAMIENTO_Y_MANTENIMIENTO: 6, DESCARTADA: 7 });
export const ESTADO_FASE = Object.freeze({ PENDIENTE: 0, EN_CURSO: 1, BLOQUEADA: 2, EN_REVISION: 3, COMPLETADA: 4 });
export const TIPO_STAT = Object.freeze({ TOTAL_ACUMULADO: 'total_acumulado', MEJOR_MARCA: 'mejor_marca', VALOR_ACTUAL: 'valor_actual' });
export const TIPO_PROYECTO = Object.freeze({ PROYECTO: 'proyecto', AREA: 'area', RECURSO: 'recurso', ARCHIVO: 'archivo' });

export const PROYECTO = {
  objetivo: 'App personal para calificar mis planes deslizando tarjetas, y publicada en la App Store.',
  fase: FASE.CONSTRUCCION,
  fase_estado: ESTADO_FASE.EN_CURSO,
  fases_completadas: 3,
  tipo: TIPO_PROYECTO.AREA
};
