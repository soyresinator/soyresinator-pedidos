/**
 * Soy Resinator · backend del portal de pedidos B2C (Google Apps Script)
 *
 * Vinculado a la hoja "RES · Pedidos Web". Se publica como aplicación web
 * (Ejecutar como: yo · Acceso: cualquier usuario).
 *
 *   GET  ?accion=config              -> cola, pedidos abiertos y colores elegibles (caché 5 min)
 *   POST {accion:"pedido", ...}      -> valida, recalcula, guarda y manda los correos
 *   POST {accion:"estado", id, email}-> estado de un pedido, solo si el email coincide
 *
 * Los POST llegan como text/plain con JSON dentro (así el navegador no hace la petición previa de CORS).
 * Las reglas de cajas, totales y colores son las mismas que js/calc.js y js/core.js de la web.
 * Si cambias una, cámbiala en los dos sitios. Aquí es donde manda.
 */

// =====================  AJUSTES: revísalos antes de desplegar  =====================
const AJUSTES = {
  // URL pública de GitHub Pages, con la barra final. De aquí se leen catalog.json, shipping.json y los textos.
  PAGES_BASE: 'https://soyresinator.com/',
  EMAIL_TIENDA: 'soyresinator@gmail.com',
  NOMBRE_REMITENTE: 'Soy Resinator',
  ZONA_HORARIA: 'Europe/Madrid',
  MAX_PEDIDOS_EMAIL_DIA: 5,
  MAX_BYTES: 20 * 1024,
  MAX_UNIDADES: 30,
  MAX_CONSULTAS_ID_HORA: 20,
  CACHE_FICHEROS_S: 600, // catalog.json, shipping.json, textos: 10 min
  CACHE_CONFIG_S: 300    // respuesta de ?accion=config: 5 min
};
// ===================================================================================

const IDIOMAS = ['en', 'es', 'de', 'fr', 'it'];
const ALFABETO_ID = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RE_ID = /^SR-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const H = { PEDIDOS: 'PEDIDOS_WEB', ESTADO: 'ESTADO_WEB', CONFIG: 'CONFIG', COLORES: 'COLORES' };

const ENCABEZADOS = {
  PEDIDOS_WEB: ['ID_WEB', 'FECHA', 'IDIOMA', 'NOMBRE', 'EMAIL', 'TELEFONO', 'DIRECCION', 'CP', 'CIUDAD', 'PAIS',
    'INSTAGRAM', 'ITEMS_JSON', 'RESUMEN_ES', 'NOTAS_ORIGINAL', 'SUBTOTAL', 'MONTAJE', 'ENVIO', 'TOTAL',
    'MODO_PAGO', 'SERVICIO_ENVIO', 'CAJAS', 'CONSENTIMIENTO', 'REGISTRADO', 'ID_APP'],
  ESTADO_WEB: ['ID_WEB', 'EMAIL_HASH', 'ESTADO', 'PLACAS_HECHAS', 'PLACAS_TOTAL', 'PAGO', 'FECHA_PAGO',
    'FECHA_ENVIO_ESTIMADA', 'SERVICIO', 'TRACKING', 'ACTUALIZADO'],
  CONFIG: ['HORAS_COLA', 'HORAS_DIA', 'DIAS_PREPARACION', 'ACTUALIZADO', 'PEDIDOS_ABIERTOS'],
  COLORES: ['COLOR_ID', 'NOMBRE_ES', 'NOMBRE_EN', 'NOMBRE_DE', 'NOMBRE_FR', 'NOMBRE_IT', 'HEX',
    'IDS_FILAMENTO', 'DISPONIBLE_G', 'ELEGIBLE', 'ACTUALIZADO']
};

// Formato de cada columna al escribir una fila: '@' = texto (evita fórmulas y que se pierdan ceros), '0.00' = número.
const FORMATO_PEDIDOS = ['@', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@',
  '0.00', '0.00', '0.00', '0.00', '@', '@', '0', '@', '@', '@'];
const FORMATO_ESTADO = ['@', '@', '@', '0', '0', '@', '@', '@', '@', '@', '@'];

// Filas iniciales de COLORES (foto del 04/11/2026). Luego las mantiene la tarea programada.
const COLORES_INICIALES = [
  ['negro', 'Negro', 'Black', 'Schwarz', 'Noir', 'Nero', '#1f1d1a', 'FIL-PLAM-CHARCOAL', 5684],
  ['gris-titan', 'Gris titán', 'Titan grey', 'Titangrau', 'Gris titane', 'Grigio titanio', '#8c9094', 'FIL-SILK-GREYTITAN', 3812],
  ['dorado', 'Dorado', 'Gold', 'Gold', 'Doré', 'Oro', '#c9a24a', 'FIL-SILK-GOLD;FIL-WINKLE-SILK-GOLD', 4316],
  ['rojo-oscuro', 'Rojo oscuro', 'Dark red', 'Dunkelrot', 'Rouge foncé', 'Rosso scuro', '#7a1e1e', 'FIL-PLAM-DARKRED', 1262],
  ['rojo-escarlata', 'Rojo escarlata', 'Scarlet red', 'Scharlachrot', 'Rouge écarlate', 'Rosso scarlatto', '#b3261e', 'FIL-PLAM-REDSCARLET', 1000],
  ['rojo-lava', 'Rojo lava', 'Lava red', 'Lavarot', 'Rouge lave', 'Rosso lava', '#c0301f', 'FIL-PANCHROMA-MATTE-LAVARED', 300],
  ['rojo-bombero', 'Rojo bombero', 'Fire engine red', 'Feuerwehrrot', 'Rouge pompier', 'Rosso pompiere', '#c8102e', 'FIL-ESUN-LITE-FIREENGINERED', 1000],
  ['cobre-rojo', 'Cobre rojo', 'Red copper', 'Rotkupfer', 'Cuivre rouge', 'Rame rosso', '#a04a2c', 'FIL-SUNLU-SILK-REDCOPPER', 650],
  ['naranja', 'Naranja mandarina', 'Mandarin orange', 'Mandarinenorange', 'Orange mandarine', 'Arancione mandarino', '#df7a26', 'FIL-PLAM-MANDARINORANGE', 1000],
  ['amarillo', 'Amarillo limón', 'Lemon yellow', 'Zitronengelb', 'Jaune citron', 'Giallo limone', '#e3c62c', 'FIL-PLAM-LEMONYELLOW', 1000],
  ['amarillo-canario', 'Amarillo canario', 'Canary yellow', 'Kanariengelb', 'Jaune canari', 'Giallo canarino', '#f2d50f', 'FIL-WINKLE-HD-CANARYYELLOW', 300],
  ['verde-hierba', 'Verde hierba', 'Grass green', 'Grasgrün', 'Vert herbe', 'Verde erba', '#4f7a2e', 'FIL-PLAM-GRASSGREEN', 1000],
  ['verde-oscuro', 'Verde oscuro', 'Dark green', 'Dunkelgrün', 'Vert foncé', 'Verde scuro', '#2f4a2a', 'FIL-PLAM-DARKGREEN', 2845],
  ['azul-marino', 'Azul marino', 'Navy blue', 'Marineblau', 'Bleu marine', 'Blu marino', '#1f3a68', 'FIL-PLAM-MARINEBLUE', 1000],
  ['azul', 'Azul', 'Blue', 'Blau', 'Bleu', 'Blu', '#0a5bb5', 'FIL-PLAB-BLUE', 800],
  ['azul-ultramar', 'Azul ultramar', 'Ultramarine blue', 'Ultramarinblau', 'Bleu outremer', 'Blu oltremare', '#2a3f9e', 'FIL-PLA-ULTRAMARINE', 100],
  ['blanco-marfil', 'Blanco marfil', 'Ivory white', 'Elfenbeinweiß', 'Blanc ivoire', 'Bianco avorio', '#e9e4d6', 'FIL-PLAM-WHITEIVORY', 2950],
  ['blanco-puro', 'Blanco puro', 'Pure white', 'Reinweiß', 'Blanc pur', 'Bianco puro', '#f5f5f2', 'FIL-PURE-WHITE', 1000],
  ['beige-claro', 'Beige claro', 'Light beige', 'Hellbeige', 'Beige clair', 'Beige chiaro', '#d9c8a9', 'FIL-PLAM-BEIGECLARO', 800],
  ['marron-oscuro', 'Marrón oscuro', 'Dark brown', 'Dunkelbraun', 'Marron foncé', 'Marrone scuro', '#4a3326', 'FIL-PLAM-DARKBROWN', 316],
  ['rosa-sakura', 'Rosa sakura', 'Sakura pink', 'Sakurarosa', 'Rose sakura', 'Rosa sakura', '#e8a9b8', 'FIL-PLAM-SAKURAPINK', 1000],
  ['gris-ceniza', 'Gris ceniza', 'Ash grey', 'Aschgrau', 'Gris cendré', 'Grigio cenere', '#9a9a96', 'FIL-WINKLE-HD-ASHGREY', 800]
];

/* =====================================================================
 * INSTALACIÓN: ejecútala una vez desde el editor (Ejecutar > instalar)
 * ===================================================================== */
function instalar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(AJUSTES.ZONA_HORARIA);
  const ahora = new Date().toISOString();

  Object.keys(ENCABEZADOS).forEach(function (nombre) {
    const sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    const enc = ENCABEZADOS[nombre];
    sh.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });

  const siNo = SpreadsheetApp.newDataValidation().requireValueInList(['sí', 'no'], true).setAllowInvalid(false).build();

  // CONFIG: fila 2. HORAS_COLA vacía hasta que la rellene la tarea (la web dirá "unas 3 semanas").
  const cfg = ss.getSheetByName(H.CONFIG);
  if (cfg.getLastRow() < 2) {
    cfg.getRange(2, 1, 1, 5).setValues([['', 16, 2, ahora, 'sí']]);
  }
  cfg.getRange(2, 5, 1, 1).setDataValidation(siNo);

  // COLORES: solo si está vacía, para no pisar lo que ya haya sincronizado la tarea.
  const col = ss.getSheetByName(H.COLORES);
  if (col.getLastRow() < 2) {
    const filas = COLORES_INICIALES.map(function (r) { return r.concat(['sí', ahora]); });
    col.getRange(2, 1, filas.length, 11).setValues(filas);
  }
  col.getRange(2, 10, Math.max(col.getLastRow() - 1, 1), 1).setDataValidation(siNo);

  // Quita la hoja vacía que trae una hoja nueva ("Hoja 1" / "Sheet1").
  ss.getSheets().forEach(function (sh) {
    if (!ENCABEZADOS[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 4) ss.deleteSheet(sh);
  });

  limpiarCache();
  return 'Instalado: ' + Object.keys(ENCABEZADOS).join(', ');
}

/** Bórrala si cambias catalog.json o shipping.json y no quieres esperar los 10 minutos de caché. */
function limpiarCache() {
  CacheService.getScriptCache().removeAll(['config_pub', 'f:data/catalog.json', 'f:data/shipping.json',
    'f:data/config.json', 'f:data/colores-serie.json'].concat(IDIOMAS.map(function (l) { return 'f:i18n/' + l + '.json'; })));
}

/* =====================================================================
 * ENTRADAS WEB
 * ===================================================================== */
function doGet(e) {
  try {
    const accion = e && e.parameter && e.parameter.accion;
    if (accion === 'config') return json(configPublica());
    return json({ ok: false, error: 'accion_desconocida' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'servidor' });
  }
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (!raw || Utilities.newBlob(raw).getBytes().length > AJUSTES.MAX_BYTES) return json({ ok: false, error: 'datos_invalidos' });
    let body;
    try { body = JSON.parse(raw); } catch (err) { return json({ ok: false, error: 'datos_invalidos' }); }
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'datos_invalidos' });
    if (body.accion === 'pedido') return json(crearPedido(body));
    if (body.accion === 'estado') return json(consultarEstado(body));
    return json({ ok: false, error: 'accion_desconocida' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'servidor' });
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================================
 * ?accion=config
 * ===================================================================== */
function configPublica() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('config_pub');
  if (hit) return JSON.parse(hit);

  const c = leerConfig();
  const colores = leerColores().filter(function (x) { return x.elegible; }).map(function (x) {
    return { id: x.id, nombres: x.nombres, hex: x.hex, disponible_g: x.disponible_g };
  });
  const out = {
    ok: true,
    horas_cola: c.horas_cola,
    horas_dia: c.horas_dia,
    dias_preparacion: c.dias_preparacion,
    pedidos_abiertos: c.abiertos,
    colores: colores
  };
  cache.put('config_pub', JSON.stringify(out), AJUSTES.CACHE_CONFIG_S);
  return out;
}

/* =====================================================================
 * accion: "pedido"
 * ===================================================================== */
function crearPedido(b) {
  // 1. Campo trampa: un humano nunca lo ve ni lo rellena.
  if (b.web) return { ok: false, error: 'datos_invalidos' };

  // 2. ¿Está abierta la forja? (se lee en el momento, sin caché)
  if (!leerConfig().abiertos) return { ok: false, error: 'pedidos_cerrados' };

  // 3. Datos de referencia publicados en GitHub Pages.
  const cat = ficheroPages('data/catalog.json');
  const ship = ficheroPages('data/shipping.json');
  const cfgWeb = ficheroPages('data/config.json');
  const minimo = Number(cfgWeb.stock_minimo_g) || 0;
  const notaMax = Number(cfgWeb.nota_max) || 500;
  const es = ficheroPages('i18n/es.json');

  // 4. Validación de campos.
  const idioma = IDIOMAS.indexOf(b.idioma) >= 0 ? b.idioma : 'en';
  const cl = b.cliente || {};
  const cliente = {
    nombre: limpiar(cl.nombre, 120),
    email: limpiar(cl.email, 160).toLowerCase(),
    telefono: limpiar(cl.telefono, 30),
    direccion: limpiar(cl.direccion, 200),
    cp: limpiar(cl.cp, 12),
    ciudad: limpiar(cl.ciudad, 100),
    instagram: limpiar(cl.instagram, 60)
  };
  if (cliente.nombre.length < 2 || !RE_EMAIL.test(cliente.email) || !cliente.direccion || !cliente.cp || !cliente.ciudad) {
    return { ok: false, error: 'datos_invalidos' };
  }
  const tel = cliente.telefono.match(/^\+(\d{1,4})\s*([\d\s().-]+)$/);
  if (!tel || !/^\d{6,15}$/.test(tel[2].replace(/[\s().-]/g, ''))) return { ok: false, error: 'datos_invalidos' };
  const pais = ship.paises.filter(function (p) { return p.code === b.pais; })[0];
  if (!pais) return { ok: false, error: 'datos_invalidos' };
  const modo = b.modo_pago === 'dos_partes' ? 'dos_partes' : (b.modo_pago === 'completo' ? 'completo' : null);
  if (!modo || b.consentimiento !== true) return { ok: false, error: 'datos_invalidos' };
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > AJUSTES.MAX_UNIDADES) {
    return { ok: false, error: 'datos_invalidos' };
  }

  // 5. Unidades: producto, montaje y colores (leyendo COLORES ahora, no la caché).
  const colores = leerColores();
  const serie = (function () { try { return ficheroPages('data/colores-serie.json').colores || []; } catch (e) { return []; } })();
  const unidades = [];
  for (let i = 0; i < b.items.length; i++) {
    const it = b.items[i] || {};
    const prod = cat.productos.filter(function (p) { return p.id === it.pid; })[0];
    if (!prod || prod.oculto) return { ok: false, error: 'producto_no_existe' };
    if (typeof it.montaje !== 'boolean' && it.montaje !== undefined) return { ok: false, error: 'datos_invalidos' };
    const montaje = it.montaje === true;
    if (montaje && !pais.montaje) return { ok: false, error: 'montaje_no_disponible' };

    const enviados = Array.isArray(it.colores) ? it.colores : [];
    if (enviados.length !== prod.partes.length) return { ok: false, error: 'datos_invalidos' };
    const elegidos = [];
    for (let k = 0; k < prod.partes.length; k++) {
      const part = prod.partes[k];
      const env = enviados.filter(function (c) { return c && c.grupo === part.grupo; })[0];
      if (!env || typeof env.color_id !== 'string') return { ok: false, error: 'datos_invalidos' };
      if (!colorDisponible(part, env.color_id, colores, minimo)) return { ok: false, error: 'color_no_disponible' };
      const fila = colores.filter(function (c) { return c.id === env.color_id; })[0];
      const resp = serie.filter(function (c) { return c.id === env.color_id; })[0];
      const nombres = fila ? fila.nombres : (resp ? resp.nombres : { es: env.color_id });
      elegidos.push({
        grupo: part.grupo,
        etiqueta_es: es[part.etiqueta] || part.etiqueta,
        etiqueta_key: part.etiqueta,
        color_id: env.color_id,
        color_es: nombres.es || env.color_id,
        nombres: nombres,
        id_filamento: fila ? mejorFilamento(fila.filamentos) : '',
        gramos: part.gramos,
        de_serie: env.color_id === part.de_serie,
        placas: Array.isArray(part.placas) ? part.placas : [],
        filamento_serie: part.filamento_serie || ''
      });
    }
    const nota = limpiar(it.nota, notaMax, true);
    unidades.push({ prod: prod, montaje: montaje, colores: elegidos, nota: nota });
  }

  // 6. Recalculamos todo con nuestros ficheros. Lo que diga el navegador no cuenta.
  const tot = totales(unidades.map(function (u) { return { pid: u.prod.id, montaje: u.montaje }; }), cat, pais);

  // 7. Escritura con bloqueo: límite por email, ID único y las dos filas.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let id;
  const fecha = new Date();
  const fechaIso = fecha.toISOString();
  try {
    if (pedidosHoy(cliente.email) >= AJUSTES.MAX_PEDIDOS_EMAIL_DIA) return { ok: false, error: 'demasiados_pedidos' };
    id = nuevoId();

    const itemsJson = unidades.map(function (u) {
      return {
        pid: u.prod.id, modelo: u.prod.modelo, id_replica: u.prod.id_replica || '', nombre: u.prod.nombre,
        precio: u.prod.pvp, montaje: u.montaje,
        // placas = bandejas de RES · Catálogo (PLACAS) de esa réplica que se imprimen con id_filamento
        // en lugar de filamento_serie.
        colores: u.colores.map(function (c) {
          return { grupo: c.grupo, etiqueta_es: c.etiqueta_es, color_id: c.color_id, color_es: c.color_es,
            id_filamento: c.id_filamento, gramos: c.gramos, de_serie: c.de_serie,
            placas: c.placas, filamento_serie: c.filamento_serie };
        }),
        nota: u.nota
      };
    });

    const fila = [
      id, fechaIso, idioma, cliente.nombre, cliente.email, cliente.telefono, cliente.direccion, cliente.cp,
      cliente.ciudad, pais.nombre_es, cliente.instagram, JSON.stringify(itemsJson), resumenEs(unidades),
      notasOriginal(unidades), tot.subtotal, tot.montaje, tot.envio, tot.total, modo, pais.servicio,
      tot.cajas, fechaIso, '', ''
    ];
    escribirFila(hoja(H.PEDIDOS), fila, FORMATO_PEDIDOS);
    escribirFila(hoja(H.ESTADO),
      [id, hashEmail(cliente.email), 'recibido', '', '', 'pendiente', '', '', '', '', fechaIso], FORMATO_ESTADO);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // 8. Correos. Si fallan, el pedido ya está guardado: no se lo decimos al cliente como error.
  const ctx = { id: id, idioma: idioma, cliente: cliente, pais: pais, modo: modo, tot: tot, unidades: unidades, cat: cat };
  try { correoCliente(ctx); } catch (err) { console.error('correo cliente ' + id + ': ' + err); }
  try { correoTienda(ctx); } catch (err) { console.error('correo tienda ' + id + ': ' + err); }

  return { ok: true, id: id, total: tot.total };
}

/* =====================================================================
 * accion: "estado"
 * ===================================================================== */
function consultarEstado(b) {
  const NO = { ok: false, error: 'no_encontrado' };
  const id = String(b.id || '').trim().toUpperCase();
  const email = String(b.email || '');
  if (!RE_ID.test(id) || !email) return NO;

  // Freno a la fuerza bruta: como mucho N consultas por ID y hora.
  const cache = CacheService.getScriptCache();
  const k = 'q:' + id;
  const n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), 3600);
  if (n > AJUSTES.MAX_CONSULTAS_ID_HORA) return NO;

  const sh = hoja(H.ESTADO);
  const filas = sh.getLastRow() - 1;
  if (filas < 1) return NO;
  const datos = sh.getRange(2, 1, filas, 11).getValues();
  const r = datos.filter(function (x) { return String(x[0]).trim() === id; })[0];
  if (!r || String(r[1]).trim() !== hashEmail(email)) return NO;

  return {
    ok: true,
    id: id,
    estado: String(r[2] || 'recibido'),
    placas_hechas: numOVacio(r[3]),
    placas_total: numOVacio(r[4]),
    pago: String(r[5] || 'pendiente'),
    fecha_pago: fechaTexto(r[6]),
    fecha_envio_estimada: fechaTexto(r[7]),
    servicio: String(r[8] || ''),
    tracking: String(r[9] || ''),
    actualizado: fechaTexto(r[10])
  };
}

/* =====================================================================
 * REGLAS (idénticas a js/calc.js y coloresParaParte de js/core.js)
 * ===================================================================== */

/** cajas = máx(nº de réplicas largas, ⌈nº de pistolas / 2⌉) */
function contarCajas(items, cat) {
  let largas = 0, pistolas = 0;
  items.forEach(function (it) {
    const p = cat.productos.filter(function (x) { return x.id === it.pid; })[0];
    if (!p) return;
    if (p.caja === 'pistola') pistolas++; else largas++;
  });
  return Math.max(largas, Math.ceil(pistolas / 2));
}

function totales(items, cat, pais) {
  let subtotal = 0, horas = 0;
  items.forEach(function (it) {
    const p = cat.productos.filter(function (x) { return x.id === it.pid; })[0];
    if (!p) return;
    subtotal += p.pvp;
    horas += p.horas;
  });
  const montajeUds = pais && pais.montaje ? items.filter(function (i) { return i.montaje; }).length : 0;
  const montaje = montajeUds * cat.montaje_pvp;
  const cajas = contarCajas(items, cat);
  const envio = pais ? cajas * pais.por_caja : 0;
  return { subtotal: subtotal, montajeUds: montajeUds, montaje: montaje, cajas: cajas, envio: envio,
    total: subtotal + montaje + envio, horas: horas };
}

/**
 * Un color vale para una parte si es el de serie (siempre), o si en COLORES está ELEGIBLE = sí,
 * con DISPONIBLE_G >= máx(gramos de la parte, stock mínimo) y dentro de la lista cerrada si la hay.
 */
function colorDisponible(part, colorId, colores, minimo) {
  if (colorId === part.de_serie) return true;
  if (Array.isArray(part.opciones) && part.opciones.indexOf(colorId) < 0) return false;
  const c = colores.filter(function (x) { return x.id === colorId && x.elegible; })[0];
  if (!c) return false;
  return c.disponible_g >= Math.max(part.gramos, minimo || 0);
}

/**
 * De los IDS_FILAMENTO de un color, el que tenga más disponible.
 * Si la tarea escribe los gramos de cada uno ("FIL-A:2500;FIL-B:1816"), elegimos el mayor;
 * si no hay gramos por filamento, el primero de la lista.
 */
function mejorFilamento(filamentos) {
  if (!filamentos.length) return '';
  let mejor = filamentos[0];
  filamentos.forEach(function (f) { if (f.g !== null && (mejor.g === null || f.g > mejor.g)) mejor = f; });
  return mejor.id;
}

/* =====================================================================
 * TEXTOS PARA NOSOTROS (siempre en español)
 * ===================================================================== */
function resumenEs(unidades) {
  return unidades.map(function (u, i) {
    const partes = u.colores.length
      ? u.colores.map(function (c) { return c.etiqueta_es + ': ' + c.color_es + (c.de_serie ? ' (de serie)' : ''); }).join(' · ')
      : 'colores de serie';
    return (i + 1) + '. ' + u.prod.nombre + ' · ' + partes + ' · Montaje: ' + (u.montaje ? 'sí' : 'no');
  }).join(' | ');
}

function notasOriginal(unidades) {
  return unidades.map(function (u, i) { return u.nota ? (i + 1) + ': ' + u.nota : ''; })
    .filter(String).join(' | ');
}

/* =====================================================================
 * CORREOS
 * ===================================================================== */
function correoCliente(ctx) {
  const L = ctx.idioma;
  const d = ficheroPages('i18n/' + L + '.json');
  const t = function (k, v) { return tr(d, k, v); };
  const link = AJUSTES.PAGES_BASE + 'pedido.html?id=' + encodeURIComponent(ctx.id);

  const lineas = lineasResumen(ctx, L, d);
  const pagoTxt = t(ctx.modo === 'dos_partes' ? 'pago.dos_partes' : 'pago.completo') +
    (ctx.modo === 'dos_partes' ? ' · ' + t('res.dos_partes_detalle', {
      a: dinero(Math.ceil(ctx.tot.total / 2), L), b: dinero(ctx.tot.total - Math.ceil(ctx.tot.total / 2), L) }) : '');
  const impuestos = ctx.pais.ue ? t('precio.ue') : t('precio.fuera_ue') + ' · ' + t('precio.aduanas');
  const pasos = [t('conf.paso1'), t('conf.paso2'), t('conf.paso3')];
  const envioA = [ctx.cliente.nombre, ctx.cliente.direccion, ctx.cliente.cp + ' ' + ctx.cliente.ciudad, nombrePais(ctx.pais, L)];

  const texto = [
    t('mail.saludo', { nombre: ctx.cliente.nombre }), '',
    t('mail.intro'), '',
    t('conf.id_label') + ': ' + ctx.id, '',
    t('res.titulo').toUpperCase()
  ].concat(lineas.map(function (l) { return '- ' + l.a + (l.det ? ' (' + l.det + ')' : '') + ': ' + l.b; }))
    .concat([t('res.total') + ': ' + dinero(ctx.tot.total, L) + ' · ' + impuestos,
      t('res.pago') + ': ' + pagoTxt, '',
      t('conf.pasos').toUpperCase()])
    .concat(pasos.map(function (p, i) { return (i + 1) + '. ' + p; }))
    .concat(['', t('mail.envio_a') + ': ' + envioA.join(', '), '',
      t('mail.seguir') + ': ' + link, '', t('mail.dudas'), '', t('mail.firma')]).join('\n');

  const filas = lineas.map(function (l) {
    return '<tr><td style="padding:8px 0;border-bottom:1px solid #e4dccd">' + esc(l.a) +
      (l.det ? '<br><span style="color:#6b655c;font-size:13px">' + esc(l.det) + '</span>' : '') +
      '</td><td style="padding:8px 0;border-bottom:1px solid #e4dccd;text-align:right;white-space:nowrap">' + esc(l.b) + '</td></tr>';
  }).join('');

  const html =
    '<div style="background:#f4f0e8;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1a150c">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">' +
    '<div style="background:#0B0800;padding:18px 24px;color:#A77F41;font-size:20px;font-weight:bold;letter-spacing:2px">SOY RESINATOR</div>' +
    '<div style="padding:24px">' +
    '<p>' + esc(t('mail.saludo', { nombre: ctx.cliente.nombre })) + '</p>' +
    '<p>' + esc(t('mail.intro')) + '</p>' +
    '<div style="border:1px solid #A77F41;border-radius:8px;padding:16px;text-align:center;margin:20px 0">' +
    '<div style="font-size:12px;letter-spacing:2px;color:#6b655c;text-transform:uppercase">' + esc(t('conf.id_label')) + '</div>' +
    '<div style="font-size:32px;font-weight:bold;letter-spacing:3px;color:#7A5A26">' + esc(ctx.id) + '</div></div>' +
    '<h2 style="color:#7A5A26;font-size:18px;text-transform:uppercase">' + esc(t('res.titulo')) + '</h2>' +
    '<table style="width:100%;border-collapse:collapse;font-size:15px">' + filas +
    '<tr><td style="padding:12px 0;font-weight:bold">' + esc(t('res.total')) + '</td>' +
    '<td style="padding:12px 0;text-align:right;font-weight:bold;font-size:20px;color:#7A5A26">' + esc(dinero(ctx.tot.total, L)) + '</td></tr></table>' +
    '<p style="color:#6b655c;font-size:13px;margin:0">' + esc(impuestos) + '</p>' +
    '<p><strong>' + esc(t('res.pago')) + ':</strong> ' + esc(pagoTxt) + '</p>' +
    '<h2 style="color:#7A5A26;font-size:18px;text-transform:uppercase">' + esc(t('conf.pasos')) + '</h2>' +
    '<ol style="padding-left:20px">' + pasos.map(function (p) { return '<li style="margin-bottom:6px">' + esc(p) + '</li>'; }).join('') + '</ol>' +
    '<p><strong>' + esc(t('mail.envio_a')) + ':</strong><br>' + envioA.map(esc).join('<br>') + '</p>' +
    '<p style="text-align:center;margin:28px 0"><a href="' + esc(link) + '" style="background:#7A5A26;color:#ffffff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold">' + esc(t('mail.seguir')) + '</a></p>' +
    '<p>' + esc(t('mail.dudas')) + '</p><p>' + esc(t('mail.firma')) + '</p>' +
    '</div></div></div>';

  MailApp.sendEmail({
    to: ctx.cliente.email,
    replyTo: AJUSTES.EMAIL_TIENDA,
    name: AJUSTES.NOMBRE_REMITENTE,
    subject: t('mail.asunto', { id: ctx.id }),
    body: texto,
    htmlBody: html
  });
}

function correoTienda(ctx) {
  const es = ficheroPages('i18n/es.json');
  const lineas = lineasResumen(ctx, 'es', es);
  const c = ctx.cliente;
  const notas = notasOriginal(ctx.unidades);
  const texto = [
    'Pedido web nuevo ' + ctx.id + ' (idioma del cliente: ' + ctx.idioma + ')', '',
    'RESUMEN'
  ].concat(lineas.map(function (l) { return '- ' + l.a + (l.det ? ' (' + l.det + ')' : '') + ': ' + l.b; }))
    .concat([
      'Total: ' + dinero(ctx.tot.total, 'es'),
      'Pago: ' + (ctx.modo === 'dos_partes' ? 'en dos partes' : 'completo') + ' · ' + (ctx.pais.ue ? 'transferencia' : 'PayPal'),
      'Envío: ' + ctx.pais.servicio + ', ' + ctx.tot.cajas + ' caja(s)', '',
      'CLIENTE',
      'Nombre: ' + c.nombre,
      'Email: ' + c.email,
      'Teléfono: ' + c.telefono,
      'Dirección: ' + c.direccion + ', ' + c.cp + ' ' + c.ciudad + ', ' + ctx.pais.nombre_es,
      'Instagram: ' + (c.instagram || '-'), '',
      'NOTAS (tal cual, sin traducir): ' + (notas || '-'), '',
      'Recuerda: enviar los datos de pago en 24 horas.'
    ]).join('\n');

  MailApp.sendEmail({
    to: AJUSTES.EMAIL_TIENDA,
    replyTo: c.email,
    name: AJUSTES.NOMBRE_REMITENTE,
    subject: 'Pedido web nuevo ' + ctx.id,
    body: texto
  });
}

/** Líneas del resumen en un idioma: unidades, montaje y envío. */
function lineasResumen(ctx, L, d) {
  const t = function (k, v) { return tr(d, k, v); };
  const out = ctx.unidades.map(function (u, i) {
    const det = (u.colores.length
      ? u.colores.map(function (c) {
          return t(c.etiqueta_key) + ': ' + (c.nombres[L] || c.nombres.es || c.color_id) + (c.de_serie ? ' (' + t('cat.de_serie') + ')' : '');
        }).join(' · ')
      : t('cat.colores_serie')) + (u.montaje ? ' · ' + t('res.montaje') : '') + (u.nota ? ' · ' + t('ped.notas') + ': ' + u.nota : '');
    return { a: (i + 1) + '. ' + u.prod.nombre, det: det, b: dinero(u.prod.pvp, L) };
  });
  if (ctx.tot.montajeUds) {
    out.push({ a: t('res.montaje'), det: t('res.montaje_detalle', { n: ctx.tot.montajeUds, precio: dinero(ctx.cat.montaje_pvp, L) }),
      b: dinero(ctx.tot.montaje, L) });
  }
  out.push({ a: t('res.envio'),
    det: t('res.envio_detalle', { servicio: ctx.pais.servicio, cajas: ctx.tot.cajas, tarifa: dinero(ctx.pais.por_caja, L) }),
    b: dinero(ctx.tot.envio, L) });
  return out;
}

/* =====================================================================
 * HOJA
 * ===================================================================== */
function hoja(nombre) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la pestaña ' + nombre + '. Ejecuta instalar().');
  return sh;
}

function escribirFila(sh, valores, formatos) {
  const r = sh.getRange(sh.getLastRow() + 1, 1, 1, valores.length);
  r.setNumberFormats([formatos]);
  r.setValues([valores]);
}

function leerConfig() {
  const v = hoja(H.CONFIG).getRange(2, 1, 1, 5).getValues()[0];
  const num = function (x) { return x === '' || x === null || isNaN(Number(x)) ? null : Number(x); };
  return {
    horas_cola: num(v[0]),
    horas_dia: num(v[1]) || 16,
    dias_preparacion: num(v[2]) === null ? 2 : num(v[2]),
    abiertos: !esNo(v[4])
  };
}

function leerColores() {
  const sh = hoja(H.COLORES);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 11).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return {
        id: String(r[0]).trim(),
        nombres: { es: str(r[1]), en: str(r[2]), de: str(r[3]), fr: str(r[4]), it: str(r[5]) },
        hex: str(r[6]) || '#777777',
        filamentos: String(r[7] || '').split(';').map(function (s) { return s.trim(); }).filter(String).map(function (s) {
          const m = s.match(/^(.*?)\s*:\s*(\d+(?:[.,]\d+)?)$/);
          return m ? { id: m[1].trim(), g: Number(m[2].replace(',', '.')) } : { id: s, g: null };
        }),
        disponible_g: Number(String(r[8]).replace(',', '.')) || 0,
        elegible: esSi(r[9])
      };
    });
}

function pedidosHoy(email) {
  const sh = hoja(H.PEDIDOS);
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const desde = Math.max(2, sh.getLastRow() - 1999); // basta con mirar los últimos 2000
  const datos = sh.getRange(desde, 2, sh.getLastRow() - desde + 1, 4).getValues(); // B..E
  const hoy = Utilities.formatDate(new Date(), AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd');
  return datos.filter(function (r) {
    if (String(r[3]).trim().toLowerCase() !== email) return false;
    const f = r[0] instanceof Date ? r[0] : new Date(String(r[0]));
    return !isNaN(f) && Utilities.formatDate(f, AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd') === hoy;
  }).length;
}

function nuevoId() {
  const usados = {};
  [H.PEDIDOS, H.ESTADO].forEach(function (nombre) {
    const sh = hoja(nombre);
    const n = sh.getLastRow() - 1;
    if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach(function (r) { usados[String(r[0]).trim()] = true; });
  });
  for (let intento = 0; intento < 50; intento++) {
    let id = 'SR-';
    for (let i = 0; i < 6; i++) id += ALFABETO_ID.charAt(Math.floor(Math.random() * ALFABETO_ID.length));
    if (!usados[id]) return id;
  }
  throw new Error('No se pudo generar un ID libre');
}

/* =====================================================================
 * UTILIDADES
 * ===================================================================== */
function ficheroPages(ruta) {
  const cache = CacheService.getScriptCache();
  const key = 'f:' + ruta;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const res = UrlFetchApp.fetch(AJUSTES.PAGES_BASE + ruta, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('No se pudo leer ' + ruta + ' (' + res.getResponseCode() + ')');
  const txt = res.getContentText('UTF-8');
  const obj = JSON.parse(txt);
  if (txt.length < 90000) cache.put(key, txt, AJUSTES.CACHE_FICHEROS_S);
  return obj;
}

function hashEmail(email) {
  const limpio = String(email).toLowerCase().replace(/\s+/g, '');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, limpio, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { const v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** Quita caracteres de control; con multilinea conserva los saltos de línea. */
function limpiar(v, max, multilinea) {
  let s = String(v === undefined || v === null ? '' : v);
  s = multilinea ? s.replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n')
    : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return s.trim().slice(0, max);
}

function tr(dict, key, vars) {
  let s = dict[key] !== undefined ? dict[key] : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] !== undefined ? vars[n] : m; });
  return s;
}

function dinero(n, lang) {
  const entero = Math.round(n * 100) % 100 === 0;
  const partes = (entero ? String(Math.round(n)) : Number(n).toFixed(2)).split('.');
  const sepMiles = lang === 'en' ? ',' : (lang === 'fr' ? ' ' : '.');
  const sepDec = lang === 'en' ? '.' : ',';
  const s = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, sepMiles) + (partes[1] ? sepDec + partes[1] : '');
  return lang === 'en' ? '€' + s : s + ' €';
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function nombrePais(pais, lang) {
  try {
    const n = new Intl.DisplayNames([lang], { type: 'region' }).of(pais.code);
    if (n && n !== pais.code) return n;
  } catch (e) { /* sin Intl.DisplayNames: usamos el nombre en español */ }
  return pais.nombre_es;
}

function str(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function esSi(v) { return v === true || /^(s[ií]|yes|y|true|1)$/i.test(String(v).trim()); }
function esNo(v) { return v === false || /^(no|n|false|0)$/i.test(String(v).trim()); }
function numOVacio(v) { return v === '' || v === null || isNaN(Number(v)) ? null : Number(v); }
function fechaTexto(v) {
  if (v instanceof Date) return Utilities.formatDate(v, AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd');
  return String(v || '');
}
