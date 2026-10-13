# planes-swipe

Califica eventos y planes al estilo Tinder (interfaz en es-CO). Es un sitio estático, sin bundler: `index.html` carga `js/app.js` como módulo y los recursos usan rutas relativas. Se publica en GitHub Pages desde la raíz de `main`, igual que [food-log](https://github.com/juliangdeveloper/food-log).

Sitio: <https://juliangdeveloper.github.io/planes-swipe/>

Demo sin Google: <https://juliangdeveloper.github.io/planes-swipe/?demo=1>

## Hoja

La hoja por defecto es **Eventos y planes — Julian y Valen**, archivo `1_TuTWcX-5_kdocBhsqMqwOQVv5cy_6gwBJnp4bQc_Dg`. El id elegido con el selector de Drive se guarda en `localStorage` (`planes-swipe.file.v1`). Siempre se lee la **primera pestaña** (la de menor `index` en `spreadsheets.get`); el título de esa pestaña no está fijo en el código.

Las columnas se reconocen por el nombre del encabezado: `id`, `fecha_registro`, `nombre_evento`, `categoria`, `fecha_evento`, `ciudad`, `departamento`, `lugar`, `precio`, `estado`, `link_info`, `link_entradas`, `para_quien`, `motivo_recomendacion`, `ultima_revision`, `preferencia`, `calificado_en`, `comentario_usuario`, `imagen_1`, `imagen_2`, `imagen_3`.

## Calificaciones

| Gesto | Botón | Valor en la hoja |
| --- | --- | --- |
| Deslizar a la izquierda | No me gusta | `no_me_gusta` |
| Deslizar hacia abajo | Me interesa | `me_interesa` |
| Deslizar a la derecha | Me gusta | `me_gusta` |
| Deslizar hacia arriba | Me encanta | `me_encanta` |

Un `preferencia` vacío es un plan sin calificar. Si la hoja todavía tiene el valor anterior `me_intriga`, se lee como `me_interesa`. Al volver a guardar, se escribe `me_interesa`.

`calificado_en` es una fecha ISO con la hora de Bogotá (`America/Bogota`, por ejemplo `2026-10-13T13:30:00-05:00`). El comentario opcional va en `comentario_usuario`.

Justo antes de escribir se vuelve a leer la columna `id`. No se reutiliza un número de fila guardado en memoria: otro proceso reescribe la hoja los lunes y viernes cerca de las 11:00, hora de Bogotá. Después de escribir se lee de nuevo `preferencia`. Si el valor no quedó, se reintenta una vez y aparece un aviso. Sin conexión, la calificación entra en la cola `planes-swipe.queue.v1` y se reintenta al volver la red.

## Google

El inicio de sesión usa Google Identity Services (token client) y el selector es Google Picker, filtrado a hojas de cálculo. El alcance es solo `https://www.googleapis.com/auth/drive.file`. Con ese alcance, la Sheets API v4 puede leer y escribir la hoja que la persona eligió en el Picker.

`js/config.js` guarda la configuración igual que food-log:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_API_KEY`
- `GOOGLE_APP_ID` (número de proyecto; el Picker lo pide como App ID en `setAppId`)

En food-log v0.2.0 (`js/config.js`, commit `765a52b`) el client id y la clave de API están vacíos y no hay número de proyecto. Aquí se copian esos mismos valores vacíos y `GOOGLE_APP_ID` queda vacío a propósito: no se inventa una credencial.

El origen de JavaScript autorizado del cliente OAuth tiene que incluir exactamente:

`https://juliangdeveloper.github.io`

Sin ruta y sin barra final. Ese origen ya debería estar, porque food-log se sirve ahí. Las páginas de proyecto de GitHub Pages comparten ese origen; `/planes-swipe/` no forma parte de él.

### Si el origen o las APIs no están habilitadas

1. Abre [Google Cloud Console](https://console.cloud.google.com/) y elige el mismo proyecto que food-log (su número es el `GOOGLE_APP_ID`).
2. **APIs y servicios → Biblioteca** (APIs & Services → Library). Busca y pulsa **Habilitar / Enable** en:
   - Google Sheets API
   - Google Picker API
   - Google Drive API (el Picker lista los archivos con ella)
3. **APIs y servicios → Credenciales**. Abre el cliente OAuth 2.0 de tipo **Aplicación web / Web application** (el mismo client id que food-log).
4. En **Orígenes de JavaScript autorizados / Authorized JavaScript origins** confirma `https://juliangdeveloper.github.io`. Si falta, agrégalo y guarda. No hace falta una URI de redirección: el token client no usa redirect.
5. Abre la clave de API del navegador. En referentes HTTP incluye `https://juliangdeveloper.github.io/*`. Si la clave restringe APIs, incluye Sheets, Picker y Drive.
6. Pega en `js/config.js` el client id, la clave y el número de proyecto. Publica el cambio en `main`.
7. Si la pantalla de consentimiento está en **Pruebas / Testing**, añade como usuario de prueba la cuenta con la que abres la hoja.
8. La primera vez, entra y pulsa **Elegir hoja**. Aunque el id por defecto ya está en la app, `drive.file` solo autoriza el archivo que se elige en el Picker (o que la app haya creado). Elige **Eventos y planes — Julian y Valen**.

## Versión

La insignia dice `planes-swipe v0.1.0`.

Pruebas: `node --test`.
