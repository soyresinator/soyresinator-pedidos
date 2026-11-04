# Pruebas antes de darlo por terminado (sección 11)

Pasadas en local el 04/11/2026. **El script de Google todavía no está desplegado**: el servidor se ha probado con
[`tools/test-backend.html`](tools/test-backend.html), que ejecuta `apps-script/Code.gs` con hojas, caché, correo
y UrlFetch simulados (35 de 35 pruebas correctas). Al desplegarlo, repetid los puntos marcados con ★ contra el script real.

| # | Prueba | Resultado | Cómo se ha comprobado |
|---|---|---|---|
| 1 | Los cinco idiomas muestran todas las claves sin huecos | OK | `tools/check_i18n.py` (194 claves, textos legales con la misma estructura) y las 5 páginas × 5 idiomas en el navegador: ningún hueco, ninguna clave a la vista, ninguna `{variable}` sin rellenar |
| 2 | Un pedido en alemán tiene RESUMEN_ES en español ★ | OK | Banco de pruebas: RESUMEN_ES `Detalles rojos: Azul marino`; correo al cliente en alemán (`Rote Details: Marineblau`) |
| 3 | Founders Bolt azul marino + Las Pistol + montaje a España = 370 € | OK | Web (resumen) y servidor |
| 4 | 3 pistolas a Alemania = 2 cajas = 30 €; 2 bólters + 1 pistola a EE. UU. = 2 cajas = 180 € | OK | Web y servidor |
| 5 | Azul ultramar con 100 g no aparece; forzado, el servidor lo rechaza; el de serie aparece con stock 0 ★ | OK | Web con `tools/mock-config.json` y servidor (rechazado también en el Detalle dorado de 19 g por el mínimo de 200 g) |
| 6 | Heavy Bolt Wolf solo deja amarillo o azul marino en el color principal | OK | Web y servidor (negro rechazado) |
| 7 | Montaje con España y cambio a Francia: se desmarca y baja el total | OK | Web: 370 € → 275 € con aviso; servidor rechaza montaje fuera de España |
| 8 | Precio manipulado en el navegador: el servidor calcula el bueno ★ | OK | Servidor: `total_cliente: 1` → guarda y devuelve 370 € |
| 9 | "Mi pedido" con email equivocado no muestra nada; el email no aparece en ninguna URL ★ | OK | Web: mismo mensaje "no encontrado", la URL solo lleva `?id=`; el formulario no tiene `name` ni `action`. Servidor: email erróneo e ID inexistente dan la misma respuesta |
| 10 | PEDIDOS_ABIERTOS = "no": no se puede añadir nada y el servidor rechaza un pedido forzado ★ | OK | Web con `tools/mock-config-cerrado.json`: 0 botones "Añadir", aviso con Instagram, envío desactivado. Servidor: `pedidos_cerrados` |
| 11 | A 375 px no hay scroll horizontal | OK | Las 5 vistas en los 5 idiomas, también con notas largas |
| 12 | Con el script caído, el pedido no se pierde y solo se ofrecen colores de serie | OK | Envío fallido: el carrito sigue, panel "Copiar resumen", nunca se muestra un ID; solo muestras de serie y la nota "más colores disponibles" |

También probado en el servidor: campo trampa, 6.º pedido del mismo email en el día, cuerpo > 20 KB, producto
inexistente, país fuera de la lista, color con ELEGIBLE "no", textos que empiezan por `=` guardados como texto,
y que la consulta de estado no devuelve datos personales.

## Primera prueba con el script real

1. Pedido de prueba con vuestro correo (punto 5 del README).
2. En COLORES, poned `azul-ultramar` a 100 g y comprobad que no sale en ninguna parte (tarda hasta 5 minutos por la caché).
3. CONFIG E2 a `no`: el aviso aparece y un pedido falla con "la forja está llena". Volved a `sí`.
4. "Mi pedido" con el ID del pedido de prueba: con vuestro email se ve "Recibido"; con otro, nada.
5. Borrad las filas de prueba de PEDIDOS_WEB y ESTADO_WEB.
