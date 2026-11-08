# Soy Resinator · portal de pedidos B2C

Web estática para GitHub Pages (HTML, CSS y JS sin compilación) más un backend en Google Apps Script
vinculado a la hoja **"RES · Pedidos Web"**. El cliente no necesita cuenta.

## Instalación paso a paso

Hazlo en este orden: la web tiene que estar publicada antes de desplegar el script, porque el script lee de ella el catálogo, las tarifas y los textos.

### 1. Publicar la web en GitHub Pages

1. Sube este repositorio a GitHub (por ejemplo `soyresinator-pedidos`).
2. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)` y **Save**.
3. Espera uno o dos minutos y apunta la dirección que te da, por ejemplo
   `https://TU-USUARIO.github.io/soyresinator-pedidos/`.
4. Ábrela y comprueba que se ve el catálogo. Todavía no se pueden enviar pedidos: es normal.

### 2. Crear la hoja y pegar el script

1. En Google Drive, dentro de la carpeta **GESTION**: **Nuevo → Hojas de cálculo de Google**. Llámala **RES · Pedidos Web**.
2. En la hoja: **Extensiones → Apps Script**. Se abre el editor con un fichero `Código.gs`.
3. Borra lo que trae y pega todo el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
4. Arriba del todo, en `AJUSTES`, cambia `PAGES_BASE` por la dirección del paso 1.3, **con la barra final**.
5. Manifiesto: en el editor, **Configuración del proyecto (rueda) → marca "Mostrar el archivo de manifiesto appsscript.json"**. Vuelve a **Editor**, abre `appsscript.json` y sustitúyelo por [`apps-script/appsscript.json`](apps-script/appsscript.json).
6. Guarda (icono del disquete).

### 3. Ejecutar `instalar()`

1. En la barra superior del editor, elige la función **instalar** y pulsa **Ejecutar**.
2. Google pedirá permisos la primera vez: **Revisar permisos → tu cuenta → Configuración avanzada → Ir a (nombre del proyecto) → Permitir**.
   Pide tres cosas: editar esta hoja, conectarse a servicios externos (para leer la web) y enviar correo en tu nombre.
3. En la hoja aparecerán las pestañas **PEDIDOS_WEB, ESTADO_WEB, CONFIG y COLORES**, con sus encabezados y los 22 colores iniciales.
   Puedes ejecutar `instalar()` otra vez sin miedo: no borra pedidos ni pisa COLORES si ya tiene filas.

### 4. Desplegar como aplicación web

1. **Implementar → Nueva implementación → tipo (rueda) → Aplicación web**.
2. Descripción: `Portal B2C`. **Ejecutar como: Yo**. **Quién tiene acceso: Cualquier usuario**.
3. **Implementar** y copia la **URL de la aplicación web** (acaba en `/exec`).
4. Comprueba que responde: abre en el navegador esa URL con `?accion=config` al final. Debe salir un JSON con `"ok":true` y la lista de colores.

> **Cuando cambies el script**: **Implementar → Gestionar implementaciones → lápiz → Versión: Nueva versión → Implementar**.
> Así la URL no cambia. Si creas una implementación nueva, la URL cambia y hay que volver a ponerla en la web.

### 5. Conectar la web con el script

1. En este repositorio, abre [`data/config.json`](data/config.json) y pega la URL del paso 4.3 en `"api_url"`.
2. Sube el cambio a GitHub. En un par de minutos la web ya muestra los colores del stock y acepta pedidos.
3. Haz un pedido de prueba con tu propio correo: tiene que aparecer una fila en PEDIDOS_WEB y otra en ESTADO_WEB, y deben llegar dos correos (el del cliente y la copia "Pedido web nuevo SR-…").
   Después borra esas dos filas a mano.

### 6. Instalar la tarea de cada hora

La tarea está en [`apps-script/Tarea.gs`](apps-script/Tarea.gs) y va en el mismo proyecto que `Code.gs`. Cada hora:

1. **COLORES** ← "RES · Inventario" (pestaña STOCK): gramos DISPONIBLE de cada filamento. `IDS_FILAMENTO` queda como `ID:gramos;ID:gramos` y `DISPONIBLE_G` es la suma. Los negativos cuentan como 0. ELEGIBLE no se toca.
2. **PEDIDOS_WEB ↔ "RES · Pedidos"**: la tarea **no crea pedidos**. Los importa la app Pedidos Resinator, que escribe el SR-XXXXXX en ID_FORM y `web-sr-xxxxxx` en ID_APP. La tarea busca cada pedido web por ID_FORM y apunta su RES-AAAA-NNN en la columna **W** (REGISTRADO) de PEDIDOS_WEB; si la app aún no lo ha importado, lo vuelve a mirar a la hora siguiente.
3. **ESTADO_WEB** ← "RES · Pedidos": estado, pago, servicio y tracking; placas hechas/total según las "Bandeja N" de COMPROMETIDO (una bandeja está hecha cuando todas sus filas están CONSUMIDO). La primera vez que el pago deja de ser Pendiente se fija FECHA_PAGO y FECHA_ENVIO_ESTIMADA, y ya no cambian. El ID_APP de RES · Pedidos pasa a la columna **X**.
4. **CONFIG**: A2 = horas que quedan por imprimir de los pedidos "En producción" (las horas de catalog.json, descontando las bandejas hechas) y D2 = fecha. **E2 (PEDIDOS_ABIERTOS) no se toca.**

Equivalencias estado: Por cobrar → pendiente_pago · En producción → en_produccion · Listo y Empaquetado → listo · Enviado · Entregado · Cancelado. Pago: Pendiente · 1ª parte → parcial · Pagado y Regalo → pagado.

Instalación:

1. **Borra antes los pedidos de prueba** de PEDIDOS_WEB y ESTADO_WEB: si no, la app los importará a "RES · Pedidos" como pedidos reales.
2. En el editor de Apps Script: **+ (Añadir archivo) → Secuencia de comandos**, llámalo `Tarea` y pega [`apps-script/Tarea.gs`](apps-script/Tarea.gs).
3. Sustituye `appsscript.json` por [`apps-script/appsscript.json`](apps-script/appsscript.json): ahora pide acceso a tus hojas (para abrir Inventario y Pedidos) y a los activadores.
4. Guarda, elige **instalarTarea** y **Ejecutar**. Google volverá a pedir permisos. Crea el activador de cada hora y hace la primera pasada; el registro de ejecución muestra un resumen (`COLORES: … · Pedidos nuevos: … · Estados: … · Cola: … h`).
5. **Implementar → Gestionar implementaciones → lápiz → Nueva versión** para que la aplicación web use los permisos nuevos. La URL no cambia.

Ajustes en `TAREA`, al principio de `Tarea.gs`: los IDs de las dos hojas, la equivalencia modelo → ID_REPLICA (`krieg` → RIFLE-KRIEG, `cadia` → RIFLE-CADIA) y las horas de lo que no está en la web (STAND 8, TOKEN-BOX 10, SHELF-CASE 12, el resto 10). Para pararla: ejecuta `quitarTarea`.

### 7. Antes de abrir al público: textos legales

[`privacidad.html`](privacidad.html), [`condiciones.html`](condiciones.html) y [`aviso-legal.html`](aviso-legal.html) son **plantillas para revisar con vuestro asesor**.
Los datos de la titular están una sola vez, en `"legal"` dentro de [`data/config.json`](data/config.json):
`titular`, `nif`, `domicilio`, `dias_pago` (días para recibir el primer pago antes de cancelar, ahora 7),
`dias_incidencias` (días para avisar de una pieza rota, ahora 7) y `actualizado` (fecha que se muestra).
Los textos están en `legal/<idioma>.json`; si cambiáis uno, cambiad los seis (también pt) y ejecutad `python -I tools/check_i18n.py`.

## Uso diario

| Quiero… | Dónde |
|---|---|
| Cerrar o abrir pedidos | Pestaña **CONFIG**, celda **E2**: `no` o `sí`. Tarda hasta 5 minutos en verse en la web (el servidor lo aplica al instante). |
| Que un color no se ofrezca | Pestaña **COLORES**, columna **ELEGIBLE**: `no`. |
| Cambiar precios, partes o productos | [`data/catalog.json`](data/catalog.json). El servidor recalcula siempre con este fichero (caché de 10 minutos). |
| Cambiar tarifas de envío o países | [`data/shipping.json`](data/shipping.json). |
| Cambiar el stock mínimo para ofrecer un color | `stock_minimo_g` en [`data/config.json`](data/config.json) (ahora 200 g). |
| Cambiar textos de la web o de los correos | `i18n/<idioma>.json`, la misma clave en los seis ficheros (en, es, pt, de, fr, it). Los nombres de color en portugués van solo en pt.json como `color.<id>`. Luego: `python -I tools/check_i18n.py`. |
| Que un cambio de la web llegue ya al servidor | En el editor del script, ejecuta `limpiarCache`. |
| Subir cambios de JS o CSS | Cambia el número `?v=` (la fecha) en los 5 HTML y en los `import` de `js/*.js`, todos iguales, para que nadie mezcle ficheros nuevos con viejos de la caché. |
| Subir cambios de textos o del catálogo (SEO) | Ejecuta `python -I tools/prerender.py` antes de subir. Escribe en los HTML el contenido en inglés (título, descripción, textos, tarjetas del catálogo y datos JSON-LD) y regenera `sitemap.xml`, para que Google lo vea sin JavaScript. Las descripciones de cada réplica son las claves `desc.<id>` de `i18n/*.json`. |
| Cambiar tarifas de envío | Edita `data/shipping.json` y, tras subirlo, ejecuta `limpiarCache` en el Apps Script para no esperar los 10 minutos de caché. |
| Dar código SR a pedidos del formulario | En el editor del script, ejecuta `asignarSRFormulario` (no duplica). La lista para avisar a los clientes queda en la pestaña **AVISOS_SR**. |
| Correo "tu pedido ha salido" | Lo manda la tarea horaria cuando un pedido pasa a **Enviado** con TRACKING en RES · Pedidos, una sola vez (fecha en la columna M **AVISO_ENVIO** de ESTADO_WEB; bórrala para reenviarlo). En `Tarea.gs`, `TAREA.AVISO_ENVIO`: `'no'`, `'prueba'` (solo los SR de `AVISO_PRUEBA`) o `'todos'`. Antes de pasar a `'todos'`, ejecuta `marcarAvisosPrevios` una vez. |
| Pedidos de prueba | En RES · Pedidos, columna AA **PRUEBA** = `SÍ`. La tarea no los suma a la cola (CONFIG A2), pero ESTADO_WEB y el correo "tu pedido ha salido" funcionan igual. |
| Forma de pago | Desde el 08/11/2026, PayPal en todos los países (ya no hay transferencia). |
| Subtítulos en los textos legales | En `legal/*.json`, un párrafo que empieza por `## ` se muestra como subtítulo. |

### Reglas de los colores

Un color se ofrece para una parte si en COLORES tiene **ELEGIBLE = sí** y **DISPONIBLE_G ≥ máx(gramos de la parte, stock mínimo)**, y si está en la lista cerrada de la parte cuando la tiene. El color de serie se ofrece siempre.

**IDS_FILAMENTO**: si la tarea escribe los gramos de cada filamento (`FIL-SILK-GOLD:900;FIL-WINKLE-SILK-GOLD:2500`), el pedido guarda el que tiene más. Si solo hay IDs (`FIL-SILK-GOLD;FIL-WINKLE-SILK-GOLD`), guarda el primero.

## Estructura

| Ruta | Qué es |
|---|---|
| `index.html` | Catálogo y pedido (vista `#pedido`) |
| `pedido.html` | "Mi pedido": estado con ID y email (`js/seguimiento.js`) |
| `privacidad.html`, `condiciones.html`, `aviso-legal.html` | Textos legales (`js/legal.js`, textos en `legal/<idioma>.json`) |
| `PRUEBAS.md` | Resultado de las pruebas de la sección 11 y la primera prueba con el script real |
| `css/styles.css` | Estilos. Oscuro por defecto, modo claro con `data-theme="light"` |
| `js/core.js` | Idioma, carrito, colores disponibles, configuración remota |
| `js/calc.js` | Cajas, totales y plazo (las mismas reglas que el servidor) |
| `js/catalogo.js`, `js/carrito.js` | Catálogo; tarjetas por unidad, formulario, envío y confirmación |
| `data/catalog.json` | Productos, precios, partes con color, horas de impresión, volumen para el envío y extras (balas, cargador, stand) con su ID de réplica |
| `data/shipping.json` | Todos los países (se generan con su zona de Correos), servicio, precio con 1 artículo / caja de 4 kg / caja de 5 kg, UE sí/no, montaje, prefijo. La regla de cajas está en `regla_cajas` |
| `data/config.json` | URL del script (`api_url`), correo, Instagram, stock mínimo, plazo |
| `data/colores-serie.json` | Respaldo con los colores de serie, por si no se puede leer COLORES |
| `i18n/*.json` | Todos los textos (web y correos), mismas claves en en, es, de, fr, it |
| `img/` | Fotos reales `<id>-1.jpg` (ver `img/LEEME.md`) |
| `apps-script/` | `Code.gs` (web), `Tarea.gs` (tarea de cada hora) y `appsscript.json` del backend |
| `tools/check_i18n.py` | Comprueba que no falta ninguna clave en ningún idioma |
| `tools/test-backend.html` | Ejecuta `Code.gs` con Sheets y Gmail simulados y pasa las pruebas del encargo |
| `tools/test-tarea.html` | Ejecuta `Code.gs` + `Tarea.gs` con RES · Pedidos y RES · Inventario simulados |
| `tools/mock-config.json`, `tools/mock-config-cerrado.json` | Respuestas simuladas para probar la web sin script (abierta y con la forja cerrada) |

## Probar en local

Los JSON se cargan con `fetch`, así que hace falta un servidor (abrir el HTML con doble clic no funciona):

```bash
python -m http.server 8765
```

- Web: http://localhost:8765
- Pruebas del script: http://localhost:8765/tools/test-backend.html (deben salir todas en OK)

Para probar la web con colores de stock sin el script, pon temporalmente `"api_url": "tools/mock-config.json"` en `data/config.json`. El envío del pedido fallará a propósito, así ves qué pasa cuando el script está caído. **Vuelve a poner la URL real antes de subirlo.**

## Límites a tener en cuenta

- **Correos**: una cuenta de Gmail gratuita puede enviar unos 100 correos al día con Apps Script. Cada pedido gasta 2.
- **Antiabuso**: campo trampa oculto, 5 pedidos por email y día, cuerpo de 20 KB como máximo, bloqueo al escribir, y 20 consultas de estado por ID y hora.
- **Seguridad**: los textos del cliente se guardan con formato de texto, así que algo como `=IMPORTXML(...)` nunca se ejecuta como fórmula.
