# planes-swipe

Califica eventos y planes al estilo Tinder (interfaz en es-CO). Es un sitio estático, sin bundler: `index.html` carga `js/app.js` como módulo y los recursos usan rutas relativas. Se publica en GitHub Pages desde la raíz de `main`, igual que [food-log](https://github.com/juliangdeveloper/food-log).

Sitio: <https://juliangdeveloper.github.io/planes-swipe/>

Demo sin hoja: <https://juliangdeveloper.github.io/planes-swipe/?demo=1>

La app no guarda ninguna URL ni ninguna clave en el repositorio. La primera vez pide la URL `/exec` de Apps Script y la clave, y las deja solo en `localStorage` de ese navegador (`planes-swipe.connection.v1`).

## Publicación

Igual que food-log: GitHub Pages sirve la raíz de `main` (hay un `.nojekyll` para que Pages no ignore las carpetas que empiezan por `_` ni pase el HTML por Jekyll). En el repositorio: **Settings → Pages → Build and deployment → Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda. La primera visita a la URL de arriba puede tardar un minuto.

## Hoja

El script va ligado a **Eventos y planes**. Siempre usa la primera pestaña: `SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]`. Las columnas se reconocen por el nombre del encabezado: `id`, `fecha_registro`, `nombre_evento`, `categoria`, `fecha_evento`, `ciudad`, `departamento`, `lugar`, `precio`, `estado`, `link_info`, `link_entradas`, `para_quien`, `motivo_recomendacion`, `ultima_revision`, `preferencia`, `calificado_en`, `comentario_usuario`, `imagen_1`, `imagen_2`, `imagen_3`.

Al calificar, el script busca la fila por `id` en ese momento (no reutiliza un número de fila) y escribe solo `preferencia`, `calificado_en` y `comentario_usuario`. El resto de las columnas no se toca.

## Calificaciones

| Gesto | Botón | Valor en la hoja |
| --- | --- | --- |
| Deslizar a la izquierda | No me gusta | `no_me_gusta` |
| Deslizar hacia abajo | Me interesa | `me_interesa` |
| Deslizar a la derecha | Me gusta | `me_gusta` |
| Deslizar hacia arriba | Me encanta | `me_encanta` |

Un `preferencia` vacío es un plan sin calificar. Deshacer envía `preferencia` vacío y borra también `calificado_en`. Si la hoja todavía tiene el valor anterior `me_intriga`, se lee y se guarda como `me_interesa`.

`calificado_en` lo escribe el script con la hora de Bogotá (`America/Bogota`, por ejemplo `2026-10-13T13:30:00-05:00`). El comentario opcional va en `comentario_usuario`.

Después de escribir, el script vuelve a leer esas tres celdas. Si no coinciden, la app reintenta una vez y muestra un aviso. Sin conexión, la calificación entra en la cola `planes-swipe.queue.v1` y se reintenta al volver la red.

La lista llega con `GET ?action=list&key=…`. Calificar es un `POST` con `Content-Type: text/plain` y un JSON `{key, action:'rate', id, preferencia, comentario_usuario}`.

## Publicar la aplicación web

El código está en `apps-script/Code.gs`.

1. Abre la hoja **Eventos y planes**.
2. **Extensiones → Apps Script**.
3. Borra el ejemplo y pega el contenido de `apps-script/Code.gs`.
4. En el editor: **Configuración del proyecto → Propiedades del script**. Añade la propiedad `SECRET` con una clave larga. Esa clave no va en el repositorio: se escribe en la app al pulsar **Probar conexión**.
5. **Implementar → Nueva implementación → Aplicación web**.
6. **Ejecutar como: yo**.
7. **Acceso: cualquier usuario**.
8. Implementa, acepta los permisos y copia la URL que termina en `/exec`.
9. Abre Planes, pega esa URL y la clave, y pulsa **Probar conexión**.

Para cambiarlas, pulsa el nombre de la hoja en la barra: **Probar y guardar** vuelve a probar, y **Olvidar conexión** las borra de este navegador. Si cambias `Code.gs`, publica una versión nueva: **Implementar → Gestionar implementaciones → Editar → Nueva versión**. La URL `/exec` se mantiene.

## Versión

La insignia dice `planes-swipe v0.3.0`.

Pruebas: `node --test`.
