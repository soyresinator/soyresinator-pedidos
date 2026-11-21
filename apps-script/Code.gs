/**
 * Soy Resinator · backend del portal de pedidos B2C (Google Apps Script)
 *
 * Vinculado a la hoja "RES · Pedidos Web". Se publica como aplicación web
 * (Ejecutar como: yo · Acceso: cualquier usuario).
 *
 *   GET  ?accion=config              -> cola, pedidos abiertos y colores elegibles (caché 5 min)
 *   POST {accion:"pedido", ...}      -> valida, recalcula, guarda y manda los correos
 *   POST {accion:"estado", id, email}-> estado de un pedido, solo si el email coincide
 *   GET  ?accion=resenas             -> reseñas aprobadas (PUBLICAR = sí) y media por producto (caché 10 min)
 *   POST {accion:"resena_info", id, k} -> ¿vale el enlace de reseña? productos del pedido y si ya opinó
 *   POST {accion:"resena", id, k, ...} -> guarda la reseña en RESENAS como no publicada y avisa a la tienda
 *   GET  ?accion=manual&id&m&e&k     -> manual de montaje (plantilla + textos de los 6 idiomas) desde Drive,
 *                                       con el enlace firmado que da "estado" cuando el pedido está enviado
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
  // Freno global contra abusos (alguien mandando pedidos falsos a muchos emails para usar nuestro Gmail):
  // por encima de esto la web dice "algo ha fallado, inténtalo más tarde" y avisamos a la tienda una vez al día.
  // Gmail deja ~100 destinatarios al día y cada pedido gasta 2 (cliente + tienda).
  MAX_PEDIDOS_HORA: 10,
  MAX_PEDIDOS_DIA_TOTAL: 30,
  MAX_BYTES: 20 * 1024,
  MAX_UNIDADES: 30,
  MAX_CONSULTAS_ID_HORA: 20,
  CACHE_FICHEROS_S: 600, // catalog.json, shipping.json, textos: 10 min
  CACHE_CONFIG_S: 300,   // respuesta de ?accion=config: 5 min
  CACHE_RESENAS_S: 600,  // respuesta de ?accion=resenas: 10 min (al aprobar una, tarda eso en salir; o ejecuta limpiarCache)
  RESENA_TEXTO_MIN: 10,
  RESENA_TEXTO_MAX: 1000,
  // Fotos de reseñas: las reduce el navegador (JPEG ~1600 px). Se guardan en Drive, privadas hasta que la tienda las aprueba.
  FOTOS_MAX: 3,
  FOTO_MAX_BYTES: 900 * 1024,        // por foto, ya decodificada
  MAX_BYTES_RESENA: 4 * 1024 * 1024, // tamaño máximo de una petición de reseña con fotos (el resto: MAX_BYTES)
  // Manuales de montaje: el enlace de "Mi pedido" vale estas horas. Después el cliente vuelve a entrar con su ID y email.
  HORAS_ENLACE_MANUAL: 24,
  MAX_MANUALES_ID_HORA: 30
};

/* Manuales de montaje: qué manual lleva cada ID_REPLICA de RES · Pedidos (LINEAS).
 * El fichero <clave>.json vive en la carpeta de Drive "Soy Resinator · manuales" (nunca en GitHub):
 * { plantilla: "<article class=manual>…", textos: { es: {…}, en: {…}, … } }. Se sube a mano tras ejecutar prepararManuales(). */
const MANUALES = {
  'heavy-bolt': ['BOLTER-PRIMARIS', 'BOLTER-PRIMARIS-SW', 'BOLTER-PRIMARIS-UM', 'ASA-RAIL-HB', 'CULATA-HB', 'TAMBOR-HB'],
  'trench-las-rifle': ['RIFLE-KRIEG'],
  'trooper-las-rifle': ['RIFLE-CADIA'],
  'founders-bolt-pistol': ['PISTOLA-PF'],
  'las-pistol': ['PISTOLA-LASER'],
  'heavybolt-pistol': ['PISTOLA-PRIMARIS'],
  'founders-bolt': ['BOLTER-PF', 'BOLTER-PF-SW', 'BOLTER-CAOS', 'BOLTER-PLAGUE'],
  'pulse-carabine': ['RIFLE-TAU-CORTO'],
  'pulse-long-shot': ['RIFLE-TAU-LARGO']
};
// ===================================================================================

const IDIOMAS = ['en', 'es', 'pt', 'de', 'fr', 'it'];
const ALFABETO_ID = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RE_ID = /^SR-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
// El email empieza por letra o número: así nunca puede empezar como una fórmula (=, +, -, @).
const RE_EMAIL = /^[A-Za-z0-9][^\s@]*@[^\s@]+\.[^\s@]{2,}$/;

const H = { PEDIDOS: 'PEDIDOS_WEB', ESTADO: 'ESTADO_WEB', CONFIG: 'CONFIG', COLORES: 'COLORES', RESENAS: 'RESENAS',
  CLICS: 'CLICS_CORREO' };

const ENCABEZADOS = {
  PEDIDOS_WEB: ['ID_WEB', 'FECHA', 'IDIOMA', 'NOMBRE', 'EMAIL', 'TELEFONO', 'DIRECCION', 'CP', 'CIUDAD', 'PAIS',
    'INSTAGRAM', 'ITEMS_JSON', 'RESUMEN_ES', 'NOTAS_ORIGINAL', 'SUBTOTAL', 'MONTAJE', 'ENVIO', 'TOTAL',
    'MODO_PAGO', 'SERVICIO_ENVIO', 'CAJAS', 'CONSENTIMIENTO', 'REGISTRADO', 'ID_APP'],
  // ID_PEDIDO (L) = RES-AAAA-NNN. Lo rellena la tarea; en los pedidos del formulario antiguo lo pone asignarSRFormulario().
  // AVISO_ENVIO (M) = fecha ISO del correo "tu pedido ha salido" (o "previo"). Bórrala para que se reenvíe.
  // ENTREGADO_EL (N) = primera vez que la tarea vio el pedido Entregado. AVISO_RESENA (O) = fecha del correo
  // pidiendo la reseña (o "previo"); la tarea lo manda TAREA.DIAS_RESENA días después de N.
  // MANUALES (P) = claves de MANUALES separadas por comas (p. ej. "heavy-bolt"); la tarea las saca de LINEAS.
  ESTADO_WEB: ['ID_WEB', 'EMAIL_HASH', 'ESTADO', 'PLACAS_HECHAS', 'PLACAS_TOTAL', 'PAGO', 'FECHA_PAGO',
    'FECHA_ENVIO_ESTIMADA', 'SERVICIO', 'TRACKING', 'ACTUALIZADO', 'ID_PEDIDO', 'AVISO_ENVIO', 'ENTREGADO_EL', 'AVISO_RESENA',
    'MANUALES'],
  CONFIG: ['HORAS_COLA', 'HORAS_DIA', 'DIAS_PREPARACION', 'ACTUALIZADO', 'PEDIDOS_ABIERTOS'],
  COLORES: ['COLOR_ID', 'NOMBRE_ES', 'NOMBRE_EN', 'NOMBRE_DE', 'NOMBRE_FR', 'NOMBRE_IT', 'HEX',
    'IDS_FILAMENTO', 'DISPONIBLE_G', 'ELEGIBLE', 'ACTUALIZADO'],
  // Una fila por reseña (una por pedido). PUBLICAR (J): "sí" si pasa el filtro automático (sale en la web al momento);
  // "no" si el filtro la retiene. MOTIVO (K): por qué se retuvo (lenguaje ofensivo, pagos, marcas) o "retirada a mano".
  // FOTOS (L): ids de Drive separados por comas. FOTOS_PUBLICAR (M): "no" al llegar; "sí" cuando la tienda las aprueba.
  RESENAS: ['FECHA', 'ID_WEB', 'IDIOMA', 'ESTRELLAS', 'NOMBRE', 'PAIS', 'PIDS', 'PRODUCTOS', 'TEXTO', 'PUBLICAR', 'MOTIVO',
    'FOTOS', 'FOTOS_PUBLICAR']
};

// Formato de cada columna al escribir una fila: '@' = texto (evita fórmulas y que se pierdan ceros), '0.00' = número.
const FORMATO_PEDIDOS = ['@', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@',
  '0.00', '0.00', '0.00', '0.00', '@', '@', '0', '@', '@', '@'];
const FORMATO_ESTADO = ['@', '@', '@', '0', '0', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@', '@'];
const FORMATO_RESENAS = ['@', '@', '@', '0', '@', '@', '@', '@', '@', '@', '@', '@', '@'];

/* Filtro de reseñas. Se compara en minúsculas y sin acentos. Si aparece algo de estas listas, la reseña NO se publica
 * sola: queda en "no" con el MOTIVO y os llega el aviso para decidir. El filtro nunca cambia el texto del cliente
 * (salvo emails y teléfonos, que se sustituyen por [dato]). Añadid aquí lo que se escape. */
const FILTRO_RESENAS = {
  // Insultos y lenguaje ofensivo (es, en, pt, de, fr, it)
  'lenguaje ofensivo': ['mierda', 'puta', 'puto', 'putas', 'gilipollas', 'cabron', 'cabrones', 'imbecil', 'idiota', 'joder', 'jodido',
    'cono', 'subnormal', 'maricon', 'retrasado', 'zorra', 'polla', 'capullo', 'mamon', 'pendejo', 'culero', 'hijo de puta', 'hdp',
    'fuck', 'fucking', 'fucked', 'shit', 'bullshit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'motherfucker', 'retard',
    'retarded', 'faggot', 'fag', 'nigger', 'nigga', 'whore', 'slut', 'wanker', 'twat', 'prick',
    'merda', 'porra', 'caralho', 'foda', 'fodase', 'fdp', 'viado', 'buceta', 'otario', 'babaca', 'arrombado', 'filho da puta',
    'scheisse', 'arschloch', 'fotze', 'wichser', 'hurensohn', 'schlampe', 'missgeburt', 'spast', 'drecksau',
    'merde', 'putain', 'connard', 'connasse', 'salope', 'encule', 'batard', 'pute', 'nique', 'fils de pute', 'abruti',
    'cazzo', 'stronzo', 'vaffanculo', 'puttana', 'troia', 'coglione', 'minchia', 'figa', 'bastardo', 'frocio'],
  // Lo que hace saltar a los procesadores de pago con las réplicas: que parezca un arma real o que dispare
  'política de pagos': ['arma real', 'armas reales', 'arma de verdad', 'arma de fuego', 'armas de fuego', 'municion real', 'balas reales',
    'dispara de verdad', 'disparar de verdad', 'se puede disparar', 'puede disparar', 'dispara bolas', 'perdigones', 'letal', 'arma letal',
    'real gun', 'real weapon', 'real firearm', 'firearm', 'firearms', 'live ammo', 'real ammo', 'real bullets', 'can shoot', 'it shoots',
    'actually shoots', 'it fires', 'actually fires', 'working gun', 'functional gun', 'functional weapon', 'bb gun', 'lethal',
    'arma de fogo', 'municao real', 'balas reais', 'atira de verdade', 'dispara de verdade',
    'echte waffe', 'schusswaffe', 'scharfe munition', 'echte munition', 'kann schiessen', 'schiesst',
    'vraie arme', 'arme a feu', 'munitions reelles', 'balles reelles', 'peut tirer', 'tire vraiment',
    'arma vera', 'arma da fuoco', 'munizioni vere', 'proiettili veri', 'puo sparare', 'spara davvero',
    'airsoft', 'softair', 'gel blaster', 'gelblaster', 'nerf'],
  // Marcas y franquicias de terceros que la web no nombra (propiedad intelectual)
  'marcas': ['warhammer', 'games workshop', 'gamesworkshop', '40k', 'wh40k', '40.000', 'space marine', 'space marines', 'astartes',
    'adeptus', 'imperium', 'ultramarines', 'blood angels', 'dark angels', 'space wolves', 'death guard', 'nurgle', 'khorne',
    'tzeentch', 'slaanesh', 'horus heresy', 'horus', 'necron', 'necrons', 'tyranid', 'tyranids', 'eldar', 'aeldari', 'tau empire',
    'adepta sororitas', 'sisters of battle', 'astra militarum', 'imperial guard', 'guardia imperial', 'marines espaciales',
    'marine espacial', 'bolter', 'boltgun', 'bolt gun', 'lasgun', 'death korps', 'cadian', 'cadians']
};

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
  ['gris-ceniza', 'Gris ceniza', 'Ash grey', 'Aschgrau', 'Gris cendré', 'Grigio cenere', '#9a9a96', 'FIL-WINKLE-HD-ASHGREY', 800],
  // 16/11/2026: para el Ultra-sea Heavy Bolt (en la hoja se añade a mano al publicarlo).
  ['azul-oscuro', 'Azul oscuro', 'Dark blue', 'Dunkelblau', 'Bleu foncé', 'Blu scuro', '#042f56', 'FIL-PLAM-DARKBLUE', 1400]
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
  // RESENAS: PUBLICAR (J) solo admite sí / no.
  ss.getSheetByName(H.RESENAS).getRange(2, 10, 999, 1).setDataValidation(siNo);

  // Quita la hoja vacía que trae una hoja nueva ("Hoja 1" / "Sheet1").
  ss.getSheets().forEach(function (sh) {
    if (!ENCABEZADOS[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > Object.keys(ENCABEZADOS).length) ss.deleteSheet(sh);
  });

  limpiarCache();
  return 'Instalado: ' + Object.keys(ENCABEZADOS).join(', ');
}

/** Bórrala si cambias catalog.json o shipping.json y no quieres esperar los 10 minutos de caché. */
function limpiarCache() {
  CacheService.getScriptCache().removeAll(['config_pub', 'resenas_pub', 'f:data/catalog.json', 'f:data/shipping.json',
    'f:data/config.json', 'f:data/colores-serie.json'].concat(IDIOMAS.map(function (l) { return 'f:i18n/' + l + '.json'; })));
}

/* =====================================================================
 * ENTRADAS WEB
 * ===================================================================== */
function doGet(e) {
  try {
    const accion = e && e.parameter && e.parameter.accion;
    if (accion === 'config') return json(configPublica());
    if (accion === 'resenas') return json(resenasPublicas());
    if (accion === 'moderar') return pedirConfirmacionModeracion(e.parameter);
    if (accion === 'manual') return servirManual(e.parameter);
    return json({ ok: false, error: 'accion_desconocida' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'servidor' });
  }
}

function doPost(e) {
  try {
    // Formulario de confirmación de los botones del correo de reseñas (llega como formulario, no como JSON).
    if (e && e.parameter && e.parameter.accion === 'moderar') return aplicarModeracion(e.parameter);
    const raw = (e && e.postData && e.postData.contents) || '';
    // Las reseñas pueden traer fotos: límite mayor solo para esa acción.
    const bytes = raw ? Utilities.newBlob(raw).getBytes().length : 0;
    if (!raw || bytes > AJUSTES.MAX_BYTES_RESENA) return json({ ok: false, error: 'datos_invalidos' });
    let body;
    try { body = JSON.parse(raw); } catch (err) { return json({ ok: false, error: 'datos_invalidos' }); }
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'datos_invalidos' });
    if (body.accion !== 'resena' && bytes > AJUSTES.MAX_BYTES) return json({ ok: false, error: 'datos_invalidos' });
    if (body.accion === 'pedido') return json(crearPedido(body));
    if (body.accion === 'estado') return json(consultarEstado(body));
    if (body.accion === 'resena_info') return json(infoResena(body));
    if (body.accion === 'resena') return json(guardarResena(body));
    if (body.accion === 'clic') return json(clicWeb(body));
    if (body.accion === 'ev') return json(registrarEventos(body));
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
  // sinFormula: ningún texto del cliente empieza por = + - @, así no puede convertirse en fórmula
  // ni aquí ni en ninguna hoja a la que se copie después. El teléfono ya lo valida su expresión regular.
  const cliente = {
    nombre: sinFormula(limpiar(cl.nombre, 120)),
    email: limpiar(cl.email, 160).toLowerCase(),
    telefono: limpiar(cl.telefono, 30),
    direccion: sinFormula(limpiar(cl.direccion, 200)),
    cp: sinFormula(limpiar(cl.cp, 12)),
    ciudad: sinFormula(limpiar(cl.ciudad, 100)),
    instagram: sinFormula(limpiar(cl.instagram, 60))
  };
  if (cliente.nombre.length < 2 || !RE_EMAIL.test(cliente.email) || !cliente.direccion || !cliente.cp || !cliente.ciudad) {
    return { ok: false, error: 'datos_invalidos' };
  }
  const tel = cliente.telefono.match(/^\+(\d{1,4})\s*([\d\s().-]+)$/);
  if (!tel || !/^\d{6,15}$/.test(tel[2].replace(/[\s().-]/g, ''))) return { ok: false, error: 'datos_invalidos' };
  const paisBase = ship.paises.filter(function (p) { return p.code === b.pais; })[0];
  if (!paisBase) return { ok: false, error: 'datos_invalidos' };
  // Servicio de envío: el de la alternativa (hoy, Premium en EE. UU.) solo si el país la tiene y el cliente la eligió.
  if (b.envio !== undefined && b.envio !== 'standard' && !(paisBase.alternativa && b.envio === paisBase.alternativa.id)) {
    return { ok: false, error: 'datos_invalidos' };
  }
  const pais = conEnvio(paisBase, b.envio);
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
    const nota = sinFormula(limpiar(it.nota, notaMax, true));

    // Versión (Display Stand: bolt / las). Solo productos con variantes y un id de su lista; sin elegir, la de serie.
    let variante = null;
    if (prod.variantes && (prod.variantes.opciones || []).length) {
      const ops = prod.variantes.opciones;
      if (it.variante !== undefined && !ops.some(function (o) { return o.id === it.variante; })) return { ok: false, error: 'datos_invalidos' };
      const o = ops.filter(function (x) { return x.id === it.variante; })[0] ||
        ops.filter(function (x) { return x.id === prod.variantes.defecto; })[0] || ops[0];
      variante = { id: o.id, etiqueta: o.etiqueta, es: es[o.etiqueta] || o.id, etiqueta_grupo: prod.variantes.etiqueta };
    } else if (it.variante !== undefined) {
      return { ok: false, error: 'datos_invalidos' };
    }

    // Extras: { tipo: cantidad }. Solo tipos que tiene el producto, enteros entre 0 y el máximo.
    const pedidosEx = it.extras === undefined || it.extras === null ? {} : it.extras;
    if (typeof pedidosEx !== 'object' || Array.isArray(pedidosEx)) return { ok: false, error: 'datos_invalidos' };
    const tiposProd = (prod.extras || []).map(function (x) { return x.tipo; });
    const tiposMal = Object.keys(pedidosEx).filter(function (k) {
      const v = pedidosEx[k];
      const max = ((cat.extras_def || {})[k] || {}).max || 0;
      return tiposProd.indexOf(k) < 0 || typeof v !== 'number' || v !== Math.floor(v) || v < 0 || v > max;
    });
    if (tiposMal.length) return { ok: false, error: 'datos_invalidos' };
    // Opciones de extras: { tipo: id }. Solo tipos con opciones y un id de su lista.
    const pedidosOp = it.extras_op === undefined || it.extras_op === null ? {} : it.extras_op;
    if (typeof pedidosOp !== 'object' || Array.isArray(pedidosOp)) return { ok: false, error: 'datos_invalidos' };
    const opsMal = Object.keys(pedidosOp).filter(function (k) {
      const ops = ((cat.extras_def || {})[k] || {}).opciones || [];
      return tiposProd.indexOf(k) < 0 || !ops.some(function (o) { return o.id === pedidosOp[k]; });
    });
    if (opsMal.length) return { ok: false, error: 'datos_invalidos' };
    const extras = extrasDe({ extras: pedidosEx, extras_op: pedidosOp }, prod, cat).map(function (e) {
      const def = cat.extras_def[e.tipo];
      // Nombre corto para RESUMEN_ES si lo tiene (asa: "Asa con rail"); si no, el texto del formulario.
      e.nombre_es = def.resumen_es || es[def.etiqueta] || e.tipo;
      e.etiqueta_key = def.etiqueta;
      if (e.opcion) e.opcion_es = es[e.opcion.etiqueta] || e.opcion.id;
      return e;
    });
    // Extras que necesitan explicación (Custom Badge): la nota de la unidad no puede ir vacía.
    if (extras.some(function (e) { return cat.extras_def[e.tipo].nota_obligatoria; }) && !nota.trim()) {
      return { ok: false, error: 'nota_obligatoria' };
    }
    unidades.push({ prod: prod, montaje: montaje, colores: elegidos, extras: extras, nota: nota, variante: variante });
  }

  // 6. Recalculamos todo con nuestros ficheros. Lo que diga el navegador no cuenta.
  const tot = totales(unidades.map(function (u) {
    const ex = {};
    const op = {};
    u.extras.forEach(function (e) { ex[e.tipo] = e.cantidad; if (e.opcion) op[e.tipo] = e.opcion.id; });
    return { pid: u.prod.id, montaje: u.montaje, extras: ex, extras_op: op };
  }), cat, pais, ship);

  // 7. Escritura con bloqueo: límite por email, ID único y las dos filas.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let id;
  const fecha = new Date();
  const fechaIso = fecha.toISOString();
  try {
    const cuenta = contarPedidos(cliente.email);
    if (cuenta.hora >= AJUSTES.MAX_PEDIDOS_HORA || cuenta.dia >= AJUSTES.MAX_PEDIDOS_DIA_TOTAL) {
      avisarFreno(cuenta);
      return { ok: false, error: 'ocupado' }; // la web no tiene texto para esto: muestra "algo ha fallado, inténtalo en unos minutos"
    }
    if (cuenta.email >= AJUSTES.MAX_PEDIDOS_EMAIL_DIA) return { ok: false, error: 'demasiados_pedidos' };
    id = nuevoId();

    const itemsJson = unidades.map(function (u) {
      return {
        pid: u.prod.id, modelo: u.prod.modelo, id_replica: u.prod.id_replica || '', nombre: u.prod.nombre,
        precio: u.prod.pvp, montaje: u.montaje,
        // Display Stand: versión elegida (bolt / las).
        variante: u.variante ? u.variante.id : undefined, variante_es: u.variante ? u.variante.es : undefined,
        // placas = bandejas de RES · Catálogo (PLACAS) de esa réplica que se imprimen con id_filamento
        // en lugar de filamento_serie.
        colores: u.colores.map(function (c) {
          return { grupo: c.grupo, etiqueta_es: c.etiqueta_es, color_id: c.color_id, color_es: c.color_es,
            id_filamento: c.id_filamento, gramos: c.gramos, de_serie: c.de_serie,
            placas: c.placas, filamento_serie: c.filamento_serie };
        }),
        // Extras de esta unidad (van con su arma). Balas: cantidad = balas sueltas, bandejas = ⌈balas / 4⌉ de BALAS-X4.
        extras: u.extras.map(function (e) {
          const x = { tipo: e.tipo, id_replica: e.id_replica, nombre_es: e.nombre_es, cantidad: e.cantidad,
            bandejas: e.bandejas, precio_ud: e.pvp, importe: e.importe };
          // Soporte: version (bolt / las). Badge: color e id_filamento con el que se imprime.
          if (e.opcion) {
            x.opcion = e.opcion.id;
            x.opcion_es = e.opcion_es;
            if (e.opcion.filamento) x.id_filamento = e.opcion.filamento;
          }
          return x;
        }),
        nota: u.nota
      };
    });

    const fila = [
      id, fechaIso, idioma, cliente.nombre, cliente.email, cliente.telefono, cliente.direccion, cliente.cp,
      cliente.ciudad, pais.nombre_es, cliente.instagram, JSON.stringify(itemsJson), resumenEs(unidades),
      // SUBTOTAL incluye los extras (precio de réplicas + extras).
      // Envío a consultar: ENVIO vacío y SERVICIO_ENVIO "A consultar" (TOTAL va sin envío).
      notasOriginal(unidades), tot.subtotal + tot.extras, tot.montaje, tot.consultar ? '' : tot.envio, tot.total, modo,
      tot.consultar ? 'A consultar' : pais.servicio,
      tot.cajas, fechaIso, '', ''
    ];
    escribirFila(hoja(H.PEDIDOS), fila, FORMATO_PEDIDOS);
    escribirFila(hoja(H.ESTADO),
      [id, hashEmail(cliente.email), 'recibido', '', '', 'pendiente', '', '', '', '', fechaIso, '', '', '', '', ''], FORMATO_ESTADO);
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
  const datos = sh.getRange(2, 1, filas, 16).getValues();
  const r = datos.filter(function (x) { return String(x[0]).trim() === id; })[0];
  if (!r || String(r[1]).trim() !== hashEmail(email)) return NO;

  // Manuales de montaje: solo cuando el pedido ya ha salido. Enlace firmado que caduca (no hace falta volver a dar el email).
  const estadoTxt = String(r[2] || 'recibido');
  const manuales = (estadoTxt === 'enviado' || estadoTxt === 'entregado') ? enlacesManuales(id, r[15]) : [];

  return {
    manuales: manuales,
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
 * MANUALES DE MONTAJE
 * "estado" da, para cada manual del pedido, un enlace firmado {m, e, k}: e = caducidad (segundos UNIX), k = firma.
 * manual.html lo pide con ?accion=manual&id&m&e&k y lo pinta. El manual vive en Drive y nunca en el repositorio.
 * ===================================================================== */
function firmaManual(id, m, e) {
  return hashEmail(secretoResenas() + '|manual|' + id + '|' + m + '|' + e).slice(0, 32);
}

/** Claves de la columna MANUALES ("heavy-bolt,…") → [{ m, e, k }] (solo las que existen en MANUALES). */
function enlacesManuales(id, columna) {
  const e = Math.floor(Date.now() / 1000) + AJUSTES.HORAS_ENLACE_MANUAL * 3600;
  return String(columna || '').split(',').map(function (s) { return s.trim(); })
    .filter(function (m, i, a) { return m && MANUALES[m] && a.indexOf(m) === i; })
    .map(function (m) { return { m: m, e: e, k: firmaManual(id, m, e) }; });
}

/** Carpeta de Drive de los manuales. Se crea sola la primera vez; su id queda en las propiedades del script. */
function carpetaManuales() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('MANUALES_CARPETA');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* borrada: creamos otra */ } }
  const f = DriveApp.createFolder('Soy Resinator · manuales');
  props.setProperty('MANUALES_CARPETA', f.getId());
  return f;
}

/** Ejecútala UNA vez desde el editor: crea la carpeta. Sube a ella heavy-bolt.json (y los manuales que vengan). */
function prepararManuales() {
  const f = carpetaManuales();
  const hay = Object.keys(MANUALES).map(function (m) { return m + '.json: ' + (f.getFilesByName(m + '.json').hasNext() ? 'sí' : 'FALTA'); });
  return 'Carpeta de manuales: ' + f.getUrl() + ' · ' + hay.join(' · ');
}

function servirManual(p) {
  const NO = { ok: false, error: 'enlace_caducado' };
  const id = String(p.id || '').trim().toUpperCase(), m = String(p.m || ''), e = Number(p.e), k = String(p.k || '');
  const ahora = Math.floor(Date.now() / 1000);
  if (!RE_ID.test(id) || !MANUALES[m] || !(e > ahora) || e > ahora + AJUSTES.HORAS_ENLACE_MANUAL * 3600 + 60) return json(NO);
  if (k.length !== 32 || k !== firmaManual(id, m, String(p.e))) return json(NO);
  // Freno: como mucho N descargas por pedido y hora (cada una son ~2 MB).
  const cache = CacheService.getScriptCache(), ck = 'man:' + id;
  const n = Number(cache.get(ck) || 0) + 1;
  cache.put(ck, String(n), 3600);
  if (n > AJUSTES.MAX_MANUALES_ID_HORA) return json({ ok: false, error: 'ocupado' });
  const files = carpetaManuales().getFilesByName(m + '.json');
  if (!files.hasNext()) return json({ ok: false, error: 'no_disponible' });
  // El fichero ya es JSON: va tal cual dentro de la respuesta (sin parsear ~2 MB en el servidor).
  const contenido = files.next().getBlob().getDataAsString('UTF-8');
  return ContentService.createTextOutput('{"ok":true,"manual":' + contenido + '}').setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================================
 * RESEÑAS
 * Solo puede opinar quien tiene el enlace del correo (id + k) y su pedido está Entregado. Una reseña por pedido.
 * Llegan con PUBLICAR = "no": salen en la web cuando la tienda pone "sí" en la pestaña RESENAS.
 * ===================================================================== */

/** Clave secreta de los enlaces de reseña. Se crea sola la primera vez y vive en las propiedades del script
 *  (nunca en el código ni en el repositorio). Si se borra, los enlaces ya enviados dejan de valer. */
function secretoResenas() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('RESENA_SECRETO');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('RESENA_SECRETO', s);
  }
  return s;
}

function tokenResena(id) {
  return hashEmail(secretoResenas() + '|' + id).slice(0, 24);
}

function enlaceResena(id, idioma) {
  return AJUSTES.PAGES_BASE + 'resena.html?id=' + encodeURIComponent(id) + '&k=' + tokenResena(id) +
    (IDIOMAS.indexOf(idioma) >= 0 ? '&lang=' + idioma : '');
}

/* ---------- Clics en los botones del correo de reseña ----------
 * Pestaña CLICS_CORREO: FECHA, ID_WEB, BOTON ("resena" = abrió el formulario; "web" = fue a la web).
 * Una fila por pedido y botón (el primer clic). No se guarda IP, navegador ni nada del cliente.
 * No medimos aperturas: el píxel invisible no es fiable (Apple lo abre solo, Gmail lo guarda en caché),
 * empeora la entrega (filtros de spam) y en la UE necesitaría consentimiento.
 */
function tokenClic(id) {
  return hashEmail(secretoResenas() + '|web|' + id).slice(0, 24);
}

/** Enlace a la web desde el correo: la portada con ?c=SR&k=… (core.js lo registra y lo quita de la barra). */
function enlaceWebCorreo(id) {
  return AJUSTES.PAGES_BASE + '?c=' + encodeURIComponent(id) + '&k=' + tokenClic(id);
}

function registrarClic(id, boton) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(H.CLICS);
    if (!sh) {
      sh = ss.insertSheet(H.CLICS);
      sh.getRange(1, 1, 1, 3).setValues([['FECHA', 'ID_WEB', 'BOTON']]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    const n = sh.getLastRow() - 1;
    if (n > 0 && sh.getRange(2, 2, n, 2).getValues().some(function (r) { return str(r[0]) === id && str(r[1]) === boton; })) return;
    escribirFila(sh, [new Date().toISOString(), id, boton], ['@', '@', '@']);
  } catch (err) {
    console.error('Clic ' + boton + ' ' + id + ': no se pudo apuntar');
  }
}

/** POST {accion:"clic", id, k} desde la web (core.js) cuando se llega con el enlace del correo. */
function clicWeb(b) {
  const id = String(b.id || '').trim().toUpperCase();
  const k = String(b.k || '');
  if (!RE_ID.test(id) || k.length !== 24 || k !== tokenClic(id)) return { ok: false, error: 'enlace_invalido' };
  registrarClic(id, 'web');
  return { ok: true };
}

/* =====================================================================
 * ANALÍTICA PROPIA (POST accion:"ev", la manda js/analitica.js)
 * Eventos anónimos de la web: sin datos de contacto, sin IP y sin parámetros de la URL.
 * Se guardan en una hoja aparte, "RES · Analítica" (pestaña EVENTOS), para no cargar la de pedidos.
 * La crea sola el primer evento, en la misma carpeta que esta hoja; su id queda en la propiedad ANALITICA_ID.
 * ===================================================================== */
const ANALITICA = {
  EVENTOS: ['vista', 'seccion', 'prod', 'ficha', 'ficha_abrir', 'carrito', 'ver_pedido', 'quitar', 'duplicar', 'color', 'extra',
    'envio', 'pais', 'idioma', 'form_inicio', 'form_error', 'pedido', 'pedido_error', 'enlace', 'salida', 'visor3d'],
  MAX_EVENTOS: 40,          // por envío
  MAX_ENVIOS_SESION: 60,    // por visita y hora
  MAX_FILAS_HORA: 5000,     // tope global, por si alguien abusa del endpoint
  ENCABEZADOS: ['FECHA', 'SESION', 'SEG', 'EVENTO', 'PAGINA', 'DATOS', 'ORIGEN', 'UTM', 'IDIOMA', 'DISPOSITIVO', 'ZONA', 'ANCHO', 'PRUEBA']
};

function hojaAnalitica() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('ANALITICA_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('RES · Analítica');
    try {
      const padre = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
      if (padre.hasNext()) DriveApp.getFileById(ss.getId()).moveTo(padre.next());
    } catch (e) { console.warn('No se ha podido mover la hoja de analítica: ' + e); }
    const sh = ss.getSheets()[0];
    sh.setName('EVENTOS');
    sh.getRange(1, 1, 1, ANALITICA.ENCABEZADOS.length).setValues([ANALITICA.ENCABEZADOS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    props.setProperty('ANALITICA_ID', ss.getId());
  }
  return ss.getSheetByName('EVENTOS') || ss.getSheets()[0];
}

/** Texto corto y limpio para la hoja: sin saltos ni caracteres de control, y sin empezar como fórmula. */
function textoAnalitica(v, max) {
  let s = String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 60);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function registrarEventos(b) {
  const s = String(b.s || '');
  if (!/^[a-z0-9]{6,16}$/.test(s) || !Array.isArray(b.e) || !b.e.length) return { ok: false, error: 'datos_invalidos' };
  const cache = CacheService.getScriptCache();
  const kS = 'an_s_' + s, nS = Number(cache.get(kS) || 0);
  if (nS >= ANALITICA.MAX_ENVIOS_SESION) return { ok: true };
  cache.put(kS, String(nS + 1), 3600);
  const hora = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHH'), kH = 'an_h_' + hora, nH = Number(cache.get(kH) || 0);
  if (nH >= ANALITICA.MAX_FILAS_HORA) return { ok: true };

  const m = b.m && typeof b.m === 'object' ? b.m : null;
  const utm = m && m.utm && typeof m.utm === 'object'
    ? ['source', 'medium', 'campaign', 'content'].map(function (k) { return textoAnalitica(m.utm[k], 40); }).join('|').replace(/\|+$/, '') : '';
  const ahora = new Date().toISOString();
  const filas = [];
  b.e.slice(0, ANALITICA.MAX_EVENTOS).forEach(function (x, i) {
    if (!Array.isArray(x)) return;
    const tipo = String(x[0] || '');
    if (ANALITICA.EVENTOS.indexOf(tipo) < 0) return;
    const seg = Math.max(0, Math.min(86400, Math.round(Number(x[1]) || 0)));
    const d = x[2] && typeof x[2] === 'object' ? x[2] : {};
    const datos = {};
    Object.keys(d).slice(0, 8).forEach(function (k) {
      if (!/^[a-z]{1,10}$/.test(k)) return;
      const v = d[k];
      datos[k] = typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : textoAnalitica(v, k === 'pids' ? 200 : 60);
    });
    const pag = tipo === 'vista' ? textoAnalitica(datos.pag, 40) : '';
    const conMeta = m && filas.length === 0;   // los datos de la visita van solo en su primera fila
    filas.push([ahora, s, seg, tipo, pag, JSON.stringify(datos),
      conMeta ? textoAnalitica(m.ref, 60) : '', conMeta ? utm : '', conMeta ? textoAnalitica(m.lang, 5) : '',
      conMeta ? textoAnalitica(m.dev, 10) : '', conMeta ? textoAnalitica(m.tz, 40) : '', conMeta ? Math.max(0, Math.min(9999, Math.round(Number(m.w) || 0))) : '',
      m && Number(m.pr) === 1 ? 'sí' : '']);
  });
  if (!filas.length) return { ok: true };
  cache.put(kH, String(nH + filas.length), 3700);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, error: 'ocupado' };
  try {
    const sh = hojaAnalitica();
    sh.getRange(sh.getLastRow() + 1, 1, filas.length, ANALITICA.ENCABEZADOS.length).setValues(filas);
  } finally { lock.releaseLock(); }
  return { ok: true };
}

/** Borra los eventos de más de 12 meses (la privacidad dice que no se guardan más). Ejecútala de vez en cuando. */
function podarAnalitica() {
  const sh = hojaAnalitica(), n = sh.getLastRow() - 1;
  if (n < 1) return 'Sin eventos';
  const limite = Date.now() - 365 * 86400000;
  const fechas = sh.getRange(2, 1, n, 1).getValues();
  let borrar = 0;
  while (borrar < n && new Date(fechas[borrar][0]).getTime() < limite) borrar++;
  if (borrar) sh.deleteRows(2, borrar);
  return 'Borrados ' + borrar + ' eventos de hace más de 12 meses';
}

/** Ejecútala desde el editor cuando queráis ver cómo van los correos de reseña. */
function resumenCorreosResena() {
  const est = hoja(H.ESTADO);
  const nE = est.getLastRow() - 1;
  const enviados = {};
  if (nE > 0) est.getRange(2, 1, nE, 15).getValues().forEach(function (e) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(str(e[14]))) enviados[str(e[0])] = true;
  });
  const cuenta = function (lista) { return lista.filter(function (id) { return enviados[id]; }).length; };
  const clics = { resena: [], web: [] };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(H.CLICS);
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 2, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (clics[str(r[1])]) clics[str(r[1])].push(str(r[0]));
  });
  const rs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(H.RESENAS);
  const resenas = rs && rs.getLastRow() > 1 ? rs.getRange(2, 2, rs.getLastRow() - 1, 1).getValues().map(function (r) { return str(r[0]); }) : [];
  const total = Object.keys(enviados).length;
  return 'Correos de reseña enviados: ' + total + ' · Abrieron el formulario: ' + cuenta(clics.resena) +
    ' · Fueron a la web: ' + cuenta(clics.web) + ' · Reseñas recibidas: ' + cuenta(resenas);
}

function hojaResenas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(H.RESENAS);
  if (!sh) {
    sh = ss.insertSheet(H.RESENAS);
    sh.getRange(1, 1, 1, ENCABEZADOS.RESENAS.length).setValues([ENCABEZADOS.RESENAS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 10, 999, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['sí', 'no'], true).setAllowInvalid(false).build());
  }
  // Las columnas MOTIVO (K), FOTOS (L) y FOTOS_PUBLICAR (M) llegaron después: encabezados si la pestaña es anterior.
  if (str(sh.getRange(1, 13).getValue()) !== 'FOTOS_PUBLICAR') {
    sh.getRange(1, 11, 1, 3).setValues([['MOTIVO', 'FOTOS', 'FOTOS_PUBLICAR']]).setFontWeight('bold');
  }
  return sh;
}

/* ---------- Fotos de reseñas (Drive) ---------- */

/** Carpeta de Drive para las fotos. Se crea sola la primera vez; su id queda en las propiedades del script. */
function carpetaFotos() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOTOS_CARPETA');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* borrada: creamos otra */ } }
  const f = DriveApp.createFolder('Soy Resinator · fotos de reseñas');
  props.setProperty('FOTOS_CARPETA', f.getId());
  return f;
}

/** Ejecútala UNA vez desde el editor tras publicar: pide el permiso de Drive y crea la carpeta. */
function autorizarFotos() {
  const f = carpetaFotos();
  return 'Carpeta de fotos lista: ' + f.getName() + ' · ' + f.getUrl();
}

/** Valida las fotos que manda la web ("data:image/jpeg;base64,..."). Devuelve los blobs o null si algo no cuadra. */
function fotosDeResena(fotos, id) {
  if (fotos === undefined || fotos === null) return [];
  if (!Array.isArray(fotos) || fotos.length > AJUSTES.FOTOS_MAX) return null;
  const out = [];
  for (let i = 0; i < fotos.length; i++) {
    const m = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(fotos[i] || ''));
    if (!m) return null;
    const bytes = Utilities.base64Decode(m[2]);
    if (!bytes.length || bytes.length > AJUSTES.FOTO_MAX_BYTES) return null;
    out.push(Utilities.newBlob(bytes, 'image/' + m[1], id + '-' + (i + 1) + (m[1] === 'jpeg' ? '.jpg' : '.webp')));
  }
  return out;
}

/** Comparte (o deja privadas) las fotos de una reseña: solo las aprobadas se pueden ver desde la web. */
function compartirFotos(ids, publicas) {
  ids.forEach(function (fid) {
    try {
      DriveApp.getFileById(fid).setSharing(publicas ? DriveApp.Access.ANYONE_WITH_LINK : DriveApp.Access.PRIVATE,
        publicas ? DriveApp.Permission.VIEW : DriveApp.Permission.NONE);
    } catch (e) { console.error('Foto ' + fid + ': no se pudo cambiar el permiso'); }
  });
}

/** Miniatura pública de Drive (solo funciona si el fichero está compartido con enlace). */
function urlFoto(fid, ancho) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fid) + '&sz=w' + ancho;
}

/** Comprueba el enlace y devuelve el pedido; o { error } si no vale. */
function pedidoParaResena(b) {
  const NO = { error: 'enlace_invalido' };
  const id = String(b.id || '').trim().toUpperCase();
  const k = String(b.k || '');
  if (!RE_ID.test(id) || k.length !== 24 || k !== tokenResena(id)) return NO;

  // Freno: como mucho N peticiones por pedido y hora.
  const cache = CacheService.getScriptCache();
  const ck = 'r:' + id;
  const n = Number(cache.get(ck) || 0) + 1;
  cache.put(ck, String(n), 3600);
  if (n > AJUSTES.MAX_CONSULTAS_ID_HORA) return NO;

  const est = hoja(H.ESTADO);
  const nE = est.getLastRow() - 1;
  const e = nE > 0 ? est.getRange(2, 1, nE, 12).getValues().filter(function (x) { return str(x[0]) === id; })[0] : null;
  if (!e) return NO;
  if (str(e[2]) !== 'entregado') return { error: 'no_entregado' };

  // Datos del pedido web. Los que no vienen de la web no tienen fila en PEDIDOS_WEB: se sacan de RES · Pedidos.
  const web = hoja(H.PEDIDOS);
  const nW = web.getLastRow() - 1;
  const w = nW > 0 ? web.getRange(2, 1, nW, 12).getValues().filter(function (x) { return str(x[0]) === id; })[0] : null;
  const productos = [];
  if (w) {
    let items = [];
    try { items = JSON.parse(w[11] || '[]'); } catch (err) { items = []; }
    items.forEach(function (u) {
      if (u && u.pid && !productos.some(function (p) { return p.pid === u.pid; })) productos.push({ pid: str(u.pid), nombre: str(u.nombre) });
    });
  }
  let nombre = w ? str(w[3]) : '', paisEs = w ? str(w[9]) : '', idioma = w ? str(w[2]) : '';
  if (!w && str(e[11])) {
    try {
      const res = SpreadsheetApp.openById(TAREA.ID_PEDIDOS);
      const r = tabla(res.getSheetByName('PEDIDOS')).filas.filter(function (x) { return str(x.ID_PEDIDO) === str(e[11]); })[0];
      if (r) {
        productosRes(tabla(res.getSheetByName('LINEAS')).filas, str(r.ID_PEDIDO), ficheroPages('data/catalog.json'))
          .forEach(function (p) { if (p.pid) productos.push({ pid: p.pid, nombre: p.nombre }); });
        nombre = str(r.CLIENTE); paisEs = str(r.PAIS); idioma = idiomaPais(r.PAIS);
      }
    } catch (err) { /* sin datos: el cliente escribe su nombre y país */ }
  }
  let paisCode = '';
  if (paisEs) {
    try {
      const p = ficheroPages('data/shipping.json').paises.filter(function (x) { return x.nombre_es === paisEs; })[0];
      if (p) paisCode = p.code;
    } catch (err) { /* sin país: el cliente lo escribe */ }
  }
  return { id: id, productos: productos, nombre: nombre.split(' ')[0], pais: paisCode, idioma: idioma };
}

/** Minúsculas, sin acentos ni signos, con espacios alrededor: así ' puta ' no salta con 'disputa'. */
function normalizarFiltro(s) {
  return ' ' + String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

/** Quita emails y teléfonos y busca lo que no debe publicarse sin revisar. Devuelve { texto, nombre, motivos, palabras }. */
function filtrarResena(texto, nombre, pais) {
  // Primero emails y teléfonos (si no, "pepe@x.com" quedaría como "pepe@[enlace]"); después, los enlaces.
  const quitar = function (s) {
    return sinEnlaces(String(s).replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[dato]').replace(/\+?\d[\d\s().-]{7,}\d/g, '[dato]'));
  };
  texto = quitar(texto);
  nombre = quitar(nombre);
  const todo = normalizarFiltro(texto + ' ' + nombre + ' ' + pais);
  const motivos = [], palabras = [];
  Object.keys(FILTRO_RESENAS).forEach(function (motivo) {
    const hits = FILTRO_RESENAS[motivo].filter(function (w) { return todo.indexOf(normalizarFiltro(w)) >= 0; });
    if (hits.length) { motivos.push(motivo); hits.forEach(function (h) { palabras.push(h); }); }
  });
  return { texto: texto, nombre: nombre, motivos: motivos, palabras: palabras };
}

/** Enlace firmado para publicar (a = "si") o retirar (a = "no") una reseña desde el correo. Abre una página que pide confirmar. */
function tokenModeracion(id, a) {
  return hashEmail(secretoResenas() + '|mod|' + id + '|' + a).slice(0, 24);
}
function enlaceModeracion(id, a) {
  return ScriptApp.getService().getUrl() + '?accion=moderar&id=' + encodeURIComponent(id) + '&a=' + a + '&k=' + tokenModeracion(id, a);
}

/** Fila de la reseña de un pedido en RESENAS: { sh, fila, fotos: [ids] } o null. */
function buscarResena(id) {
  const sh = hojaResenas();
  const n = sh.getLastRow() - 1;
  if (n < 1) return null;
  const v = sh.getRange(2, 1, n, 13).getValues();
  for (let i = 0; i < n; i++) {
    if (str(v[i][1]) === id) return { sh: sh, fila: i + 2, fotos: str(v[i][11]).split(',').filter(String) };
  }
  return null;
}

/** Cambia PUBLICAR (y MOTIVO) de la reseña de un pedido y vacía la caché de la web. Retirarla oculta también sus fotos. */
function marcarResena(id, publicar, motivo) {
  const r = buscarResena(id);
  if (!r) return false;
  r.sh.getRange(r.fila, 10, 1, 2).setValues([[publicar ? 'sí' : 'no', motivo]]);
  if (!publicar && r.fotos.length) { compartirFotos(r.fotos, false); r.sh.getRange(r.fila, 13).setValue('no'); }
  CacheService.getScriptCache().remove('resenas_pub');
  return true;
}

/** Publica u oculta las fotos de una reseña (FOTOS_PUBLICAR y permiso de Drive). Devuelve false si no tiene fotos. */
function marcarFotos(id, publicar) {
  const r = buscarResena(id);
  if (!r || !r.fotos.length) return false;
  compartirFotos(r.fotos, publicar);
  r.sh.getRange(r.fila, 13).setValue(publicar ? 'sí' : 'no');
  CacheService.getScriptCache().remove('resenas_pub');
  return true;
}

// Acciones de los botones del correo
const ACCIONES_MODERACION = {
  si: 'Publicar la reseña en la web', no: 'Retirar la reseña de la web',
  fotos: 'Publicar las fotos', sinfotos: 'Ocultar las fotos'
};

/** Página sencilla para las acciones desde el correo (se abre en el navegador de la tienda). */
function paginaModeracion(titulo, cuerpoHtml) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:40px auto;padding:24px;border:1px solid #e4dccd;border-radius:8px">' +
    '<h2 style="margin-top:0;color:#7A5A26">' + esc(titulo) + '</h2>' + cuerpoHtml + '</div>').setTitle('Soy Resinator · reseñas');
}

/** GET ?accion=moderar: NO cambia nada (los antivirus del correo abren los enlaces); solo enseña el botón de confirmar. */
function pedirConfirmacionModeracion(p) {
  const id = str(p.id).toUpperCase(), a = ACCIONES_MODERACION[p.a] ? p.a : 'no', k = str(p.k);
  if (!RE_ID.test(id) || k !== tokenModeracion(id, a)) return paginaModeracion('Enlace no válido', '<p>Este enlace no es válido.</p>');
  const accion = ACCIONES_MODERACION[a];
  return paginaModeracion('Reseña ' + id,
    '<form method="post" action="' + esc(ScriptApp.getService().getUrl()) + '" target="_top">' +
    '<input type="hidden" name="accion" value="moderar"><input type="hidden" name="id" value="' + esc(id) + '">' +
    '<input type="hidden" name="a" value="' + a + '"><input type="hidden" name="k" value="' + esc(k) + '">' +
    '<button type="submit" style="background:#7A5A26;color:#fff;border:0;padding:14px 24px;border-radius:6px;font-weight:bold;font-size:16px;cursor:pointer">' +
    esc(accion) + '</button></form>');
}

/** POST del formulario de confirmación: aplica la decisión. */
function aplicarModeracion(p) {
  const id = str(p.id).toUpperCase(), a = ACCIONES_MODERACION[p.a] ? p.a : 'no', k = str(p.k);
  if (!RE_ID.test(id) || k !== tokenModeracion(id, a)) return paginaModeracion('Enlace no válido', '<p>Este enlace no es válido.</p>');
  const nota = '<p style="color:#6b655c;font-size:14px">Podéis cambiarlo cuando queráis en la pestaña RESENAS (columnas PUBLICAR y FOTOS_PUBLICAR).</p>';
  if (a === 'fotos' || a === 'sinfotos') {
    if (!marcarFotos(id, a === 'fotos')) return paginaModeracion('Sin fotos', '<p>La reseña del pedido ' + esc(id) + ' no tiene fotos.</p>');
    return paginaModeracion(a === 'fotos' ? 'Fotos publicadas' : 'Fotos ocultas',
      '<p>Las fotos de la reseña del pedido ' + esc(id) + (a === 'fotos'
        ? ' ya se ven en soyresinator.com (si la reseña está publicada).' : ' ya no se ven en la web.') + '</p>' + nota);
  }
  const ok = marcarResena(id, a === 'si', a === 'si' ? '' : 'retirada a mano');
  if (!ok) return paginaModeracion('No encontrada', '<p>No hay ninguna reseña del pedido ' + esc(id) + '.</p>');
  return paginaModeracion(a === 'si' ? 'Reseña publicada' : 'Reseña retirada',
    '<p>La reseña del pedido ' + esc(id) + (a === 'si' ? ' ya se ve en soyresinator.com.' : ' ya no se ve en la web (ni sus fotos).') + '</p>' + nota);
}

function resenaYaEnviada(id) {
  const sh = hojaResenas();
  const n = sh.getLastRow() - 1;
  return n > 0 && sh.getRange(2, 2, n, 1).getValues().some(function (x) { return str(x[0]) === id; });
}

function infoResena(b) {
  const p = pedidoParaResena(b);
  if (p.error) return { ok: false, error: p.error };
  registrarClic(p.id, 'resena'); // abrió el formulario desde el botón del correo
  return { ok: true, id: p.id, ya: resenaYaEnviada(p.id), productos: p.productos, nombre: p.nombre, pais: p.pais };
}

function guardarResena(b) {
  if (b.web) return { ok: false, error: 'datos_invalidos' }; // campo trampa
  const p = pedidoParaResena(b);
  if (p.error) return { ok: false, error: p.error };

  const estrellas = b.estrellas;
  const pais = sinEnlaces(sinFormula(limpiar(b.pais, 40)));
  // Filtro: quita emails y teléfonos y mira si hay algo que no deba publicarse sin revisar.
  const f = filtrarResena(sinFormula(limpiar(b.texto, AJUSTES.RESENA_TEXTO_MAX, true)),
    sinFormula(limpiar(b.nombre, 40)), pais);
  const texto = f.texto, nombre = f.nombre;
  const publicar = !f.motivos.length;
  const motivo = f.motivos.length ? f.motivos.join(', ') + ' (' + f.palabras.join(', ') + ')' : '';
  const idioma = IDIOMAS.indexOf(b.idioma) >= 0 ? b.idioma : (p.idioma || 'en');
  if (typeof estrellas !== 'number' || estrellas !== Math.floor(estrellas) || estrellas < 1 || estrellas > 5 ||
    texto.length < AJUSTES.RESENA_TEXTO_MIN || nombre.length < 2 || b.consentimiento !== true) {
    return { ok: false, error: 'datos_invalidos' };
  }
  // Fotos: hasta FOTOS_MAX, JPEG o WebP ya reducidas por el navegador. Nunca se publican sin vuestro visto bueno.
  const blobs = fotosDeResena(b.fotos, p.id);
  if (blobs === null) return { ok: false, error: 'datos_invalidos' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let idsFotos = [], motivoFotos = '';
  try {
    if (resenaYaEnviada(p.id)) return { ok: false, error: 'ya_enviada' };
    if (blobs.length) {
      try {
        const carpeta = carpetaFotos();
        idsFotos = blobs.map(function (bl) { return carpeta.createFile(bl).getId(); }); // privadas al crearse
      } catch (err) {
        console.error('Fotos de ' + p.id + ': no se pudieron guardar en Drive');
        motivoFotos = 'fotos no guardadas';
      }
    }
    escribirFila(hojaResenas(), [new Date().toISOString(), p.id, idioma, estrellas, nombre, pais,
      p.productos.map(function (x) { return x.pid; }).join(','), p.productos.map(function (x) { return x.nombre; }).join(', '),
      texto, publicar ? 'sí' : 'no', [motivo, motivoFotos].filter(String).join('; '),
      idsFotos.join(','), idsFotos.length ? 'no' : ''], FORMATO_RESENAS);
  } finally {
    lock.releaseLock();
  }
  if (publicar) CacheService.getScriptCache().remove('resenas_pub'); // sale en la web al momento

  try { avisoResenaTienda(p, estrellas, nombre, pais, texto, publicar, motivo, idsFotos.length ? blobs : []); }
  catch (err) { console.error('Aviso de reseña ' + p.id + ': no se pudo enviar'); }
  return { ok: true, fotos: idsFotos.length };
}

/** Correo a la tienda: publicada (con botón para retirarla) o retenida por el filtro (con botón para publicarla). */
function avisoResenaTienda(p, estrellas, nombre, pais, texto, publicar, motivo, fotos) {
  fotos = fotos || [];
  const url = publicar ? enlaceModeracion(p.id, 'no') : enlaceModeracion(p.id, 'si');
  // Fotos: van como imágenes dentro del correo (en Drive siguen privadas) y con su propio botón.
  const inline = {};
  fotos.forEach(function (bl, i) { inline['foto' + (i + 1)] = bl; });
  const bloqueFotos = fotos.length
    ? '<p style="font-weight:bold;margin:18px 0 6px">Fotos (' + fotos.length + ') · NO se publican hasta que las aprobéis:</p>' +
      '<p>' + fotos.map(function (bl, i) { return '<img src="cid:foto' + (i + 1) + '" alt="Foto ' + (i + 1) + '" style="max-width:170px;max-height:170px;margin:0 6px 6px 0;border-radius:6px;border:1px solid #e4dccd">'; }).join('') + '</p>' +
      '<p style="margin:12px 0"><a href="' + esc(enlaceModeracion(p.id, 'fotos')) + '" style="background:#2e6b2e;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Publicar las fotos</a></p>' +
      '<p style="color:#6b655c;font-size:13px">Antes de publicarlas, mirad que solo se vea la réplica: sin personas apuntando, sin armas reales al lado y sin logos de otras marcas.</p>'
    : '';
  const boton = publicar ? 'Retirar de la web' : 'Publicar en la web';
  const estado = publicar
    ? 'Ha pasado el filtro y YA ESTÁ PUBLICADA en soyresinator.com.'
    : 'El filtro la ha RETENIDO (no se ve en la web). Motivo: ' + motivo + '.';
  const productos = p.productos.map(function (x) { return x.nombre; }).join(', ') || '-';
  const datos = [['Pedido', p.id], ['Estrellas', estrellas + ' de 5'], ['Nombre', nombre + (pais ? ' (' + pais + ')' : '')], ['Productos', productos]];
  const nota = publicar
    ? 'Recordad: hay que publicar también las negativas. Retiradla solo si tiene insultos, datos personales o no habla del pedido.'
    : 'Si al leerla está bien (por ejemplo, el filtro saltó por una palabra inocente), publicadla. Si no, no hagáis nada: se queda sin publicar.';
  MailApp.sendEmail({
    to: AJUSTES.EMAIL_TIENDA,
    name: AJUSTES.NOMBRE_REMITENTE,
    subject: (publicar ? 'Reseña publicada ' : 'Revisar reseña ') + p.id + ' · ' + '★'.repeat(estrellas),
    inlineImages: inline,
    body: [estado, ''].concat(datos.map(function (x) { return x[0] + ': ' + x[1]; }))
      .concat(['', texto, '', boton + ': ' + url])
      .concat(fotos.length ? ['', 'Fotos: ' + fotos.length + ' (sin publicar). Publicar las fotos: ' + enlaceModeracion(p.id, 'fotos')] : [])
      .concat(['', nota, '', 'También podéis cambiarlo en la pestaña RESENAS (columna PUBLICAR).']).join('\n'),
    htmlBody:
      '<div style="font-family:Arial,Helvetica,sans-serif;color:#1a150c;max-width:560px">' +
      '<p style="font-weight:bold;color:' + (publicar ? '#2e6b2e' : '#9a2b1f') + '">' + esc(estado) + '</p>' +
      '<table style="border-collapse:collapse;font-size:15px;margin:12px 0">' + datos.map(function (x) {
        return '<tr><th style="text-align:left;padding:4px 12px 4px 0;color:#6b655c;font-weight:normal">' + esc(x[0]) +
          '</th><td style="padding:4px 0;font-weight:bold">' + esc(x[1]) + '</td></tr>';
      }).join('') + '</table>' +
      '<blockquote style="margin:12px 0;padding:12px 16px;background:#f4f0e8;border-left:4px solid #A77F41;white-space:pre-line">' + esc(texto) + '</blockquote>' +
      '<p style="margin:20px 0"><a href="' + esc(url) + '" style="background:' + (publicar ? '#3d3528' : '#7A5A26') +
      ';color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">' + esc(boton) + '</a></p>' +
      bloqueFotos +
      '<p style="color:#6b655c;font-size:13px">' + esc(nota) + ' También podéis cambiarlo en la pestaña RESENAS (columna PUBLICAR).</p></div>'
  });
}

/** ?accion=resenas: reseñas con PUBLICAR = sí (las 50 más recientes) y media por producto y total. */
function resenasPublicas() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('resenas_pub');
  if (hit) return JSON.parse(hit);
  const sh = hojaResenas();
  const n = sh.getLastRow() - 1;
  const filas = n > 0 ? sh.getRange(2, 1, n, 13).getValues() : [];
  const pub = filas.filter(function (r) { return esSi(r[9]) && Number(r[3]) >= 1 && Number(r[3]) <= 5; }).map(function (r) {
    // Fotos solo si las habéis aprobado (FOTOS_PUBLICAR = sí): miniatura y versión grande de Drive.
    const fotos = esSi(r[12]) ? str(r[11]).split(',').filter(String).map(function (fid) {
      return { mini: urlFoto(fid, 400), grande: urlFoto(fid, 1600) };
    }) : [];
    return { fecha: fechaTexto(r[0]).slice(0, 10), estrellas: Number(r[3]), nombre: str(r[4]), pais: str(r[5]),
      pids: str(r[6]).split(',').filter(String), texto: str(r[8]), idioma: str(r[2]), fotos: fotos };
  }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
  const medias = {};
  pub.forEach(function (r) {
    r.pids.forEach(function (pid) { const m = medias[pid] = medias[pid] || { suma: 0, n: 0 }; m.suma += r.estrellas; m.n++; });
  });
  Object.keys(medias).forEach(function (pid) { medias[pid] = { media: Math.round(medias[pid].suma / medias[pid].n * 10) / 10, n: medias[pid].n }; });
  const total = pub.length ? { media: Math.round(pub.reduce(function (s, r) { return s + r.estrellas; }, 0) / pub.length * 10) / 10, n: pub.length } : { media: null, n: 0 };
  const out = { ok: true, total: total, medias: medias, resenas: pub.slice(0, 50) };
  cache.put('resenas_pub', JSON.stringify(out), AJUSTES.CACHE_RESENAS_S);
  return out;
}

/* =====================================================================
 * REGLAS (idénticas a js/calc.js y coloresParaParte de js/core.js)
 * ===================================================================== */

/** Extras de una unidad como lista (igual que extrasDe de js/calc.js). */
function extrasDe(it, prod, cat) {
  const elegidos = (it && it.extras) || {};
  const out = [];
  (prod.extras || []).forEach(function (ex) {
    const def = (cat.extras_def || {})[ex.tipo] || {};
    const n = Math.min(Math.max(Math.floor(Number(elegidos[ex.tipo]) || 0), 0), def.max || 0);
    if (!n) return;
    const bandejas = def.por_bandeja ? Math.ceil(n / def.por_bandeja) : n;
    const e = { tipo: ex.tipo, id_replica: ex.id_replica, cantidad: n, pvp: ex.pvp, importe: n * ex.pvp,
      horas: bandejas * ex.horas, bandejas: bandejas };
    const op = opcionExtra(def, ex, ((it && it.extras_op) || {})[ex.tipo]);
    if (op) e.opcion = op;
    out.push(e);
  });
  return out;
}

/** Opción de un extra (igual que opcionExtra de js/calc.js): la pedida si existe; si no, la de serie. */
function opcionExtra(def, ex, pedida) {
  const ops = (def && def.opciones) || [];
  if (!ops.length) return null;
  return ops.filter(function (o) { return o.id === pedida; })[0] ||
    ops.filter(function (o) { return o.id === ex.opcion_defecto; })[0] || ops[0];
}

/**
 * Cajas de envío (igual que cajasEnvio de js/calc.js): cada réplica ocupa `volumen`; se llenan cajas de
 * hasta volumen_caja_5kg, de mayor a menor. 1 artículo: precio_1; más: precio_4kg si no pasa de
 * volumen_caja_4kg, si no precio_5kg. Los extras no suman volumen.
 */
function cajasEnvio(items, cat, ship) {
  const max5 = ship.volumen_caja_5kg;
  const vols = [];
  items.forEach(function (it) {
    const p = cat.productos.filter(function (x) { return x.id === it.pid; })[0];
    if (p) vols.push(Number(p.volumen) || 0);
  });
  vols.sort(function (a, b) { return b - a; });
  const cajas = [];
  vols.forEach(function (v) {
    const c = cajas.filter(function (x) { return x.volumen + v <= max5 + 1e-9; })[0];
    if (c) { c.volumen += v; c.n++; } else cajas.push({ volumen: v, n: 1 });
  });
  return cajas.map(function (c) {
    c.tipo = c.n === 1 ? '1' : (c.volumen <= ship.volumen_caja_4kg + 1e-9 ? '4kg' : '5kg');
    return c;
  });
}

/** Igual que conEnvio de js/calc.js: el país con el servicio de la alternativa si el cliente la eligió. */
function conEnvio(pais, envio) {
  if (!pais || !pais.alternativa || envio !== pais.alternativa.id) return pais;
  const out = {};
  Object.keys(pais).forEach(function (k) { out[k] = pais[k]; });
  Object.keys(pais.alternativa).forEach(function (k) { if (k !== 'id') out[k] = pais.alternativa[k]; });
  out.envioElegido = pais.alternativa.id;
  return out;
}

function precioCaja(caja, pais) {
  return caja.tipo === '1' ? pais.precio_1 : (caja.tipo === '4kg' ? pais.precio_4kg : pais.precio_5kg);
}

function totales(items, cat, pais, ship) {
  let subtotal = 0, extras = 0, horas = 0;
  items.forEach(function (it) {
    const p = cat.productos.filter(function (x) { return x.id === it.pid; })[0];
    if (!p) return;
    subtotal += p.pvp;
    horas += p.horas;
    extrasDe(it, p, cat).forEach(function (e) { extras += e.importe; horas += e.horas; });
  });
  const montajeUds = pais && pais.montaje ? items.filter(function (i) { return i.montaje; }).length : 0;
  const montaje = montajeUds * cat.montaje_pvp;
  const lista = cajasEnvio(items, cat, ship);
  // Países sin tarifa (envio_a_consultar): sin precio de envío; el total va sin envío.
  const consultar = !!(pais && pais.envio_a_consultar);
  const envio = pais && !consultar ? lista.reduce(function (s, c) { return s + precioCaja(c, pais); }, 0) : 0;
  return { subtotal: subtotal, extras: extras, montajeUds: montajeUds, montaje: montaje, cajas: lista.length,
    listaCajas: lista, envio: envio, consultar: consultar, total: subtotal + extras + montaje + envio, horas: horas };
}

/** "1 × caja grande (5 kg) + 1 × caja individual" en el idioma del diccionario. */
function textoCajas(lista, d) {
  const cuenta = { '1': 0, '4kg': 0, '5kg': 0 };
  lista.forEach(function (c) { cuenta[c.tipo]++; });
  const partes = [];
  if (cuenta['5kg']) partes.push(tr(d, 'res.caja_5kg', { n: cuenta['5kg'] }));
  if (cuenta['4kg']) partes.push(tr(d, 'res.caja_4kg', { n: cuenta['4kg'] }));
  if (cuenta['1']) partes.push(tr(d, 'res.caja_1', { n: cuenta['1'] }));
  return partes.join(' + ');
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
    const partes = u.variante ? 'Versión: ' + u.variante.es : (u.colores.length
      ? u.colores.map(function (c) { return c.etiqueta_es + ': ' + c.color_es + (c.de_serie ? ' (de serie)' : ''); }).join(' · ')
      : 'colores de serie');
    const ex = u.extras.length
      ? ' · Extras: ' + u.extras.map(function (e) {
        return e.nombre_es + (e.opcion_es ? ' (' + e.opcion_es + ')' : '') + ' × ' + e.cantidad;
      }).join(', ') : '';
    return (i + 1) + '. ' + u.prod.nombre + ' · ' + partes + ex + ' · Montaje: ' + (u.montaje ? 'sí' : 'no');
  }).join(' | ');
}

function notasOriginal(unidades) {
  return unidades.map(function (u, i) { return u.nota ? (i + 1) + ': ' + u.nota : ''; })
    .filter(String).join(' | ');
}

/* =====================================================================
 * CORREOS
 * ===================================================================== */
function correoCliente(ctxOriginal) {
  // En el correo al cliente los enlaces que haya escrito (nombre, dirección, notas) salen como [enlace]:
  // así nadie puede usar nuestro Gmail para mandar un enlace trampa a otra persona. La hoja y la copia de la tienda
  // conservan el texto original.
  const cl = ctxOriginal.cliente;
  const ctx = Object.assign({}, ctxOriginal, {
    cliente: Object.assign({}, cl, { nombre: sinEnlaces(cl.nombre), direccion: sinEnlaces(cl.direccion), cp: sinEnlaces(cl.cp), ciudad: sinEnlaces(cl.ciudad) }),
    unidades: ctxOriginal.unidades.map(function (u) { return Object.assign({}, u, { nota: sinEnlaces(u.nota) }); })
  });
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
    .concat([t(ctx.tot.consultar ? 'res.total_sin_envio' : 'res.total') + ': ' + dinero(ctx.tot.total, L) + ' · ' + impuestos,
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
    '<tr><td style="padding:12px 0;font-weight:bold">' + esc(t(ctx.tot.consultar ? 'res.total_sin_envio' : 'res.total')) + '</td>' +
    '<td style="padding:12px 0;text-align:right;font-weight:bold;font-size:20px;color:#7A5A26">' + esc(dinero(ctx.tot.total, L)) + '</td></tr></table>' +
    '<p style="color:#6b655c;font-size:13px;margin:0">' + esc(impuestos) + '</p>' +
    '<p><strong>' + esc(t('res.pago')) + ':</strong> ' + esc(pagoTxt) + '</p>' +
    '<h2 style="color:#7A5A26;font-size:18px;text-transform:uppercase">' + esc(t('conf.pasos')) + '</h2>' +
    '<ol style="padding-left:20px">' + pasos.map(function (p) { return '<li style="margin-bottom:6px">' + esc(p) + '</li>'; }).join('') + '</ol>' +
    '<p><strong>' + esc(t('mail.envio_a')) + ':</strong><br>' + envioA.map(esc).join('<br>') + '</p>' +
    '<p style="text-align:center;margin:28px 0"><a href="' + esc(link) + '" style="background:#7A5A26;color:#ffffff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold">' + esc(t('mail.seguir')) + '</a></p>' +
    '<p>' + esc(t('mail.dudas')) + '</p><p>' + firmaHtml(t('mail.firma')) + '</p>' +
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
      (ctx.tot.consultar ? 'Total SIN envío: ' : 'Total: ') + dinero(ctx.tot.total, 'es'),
      'Pago: ' + (ctx.modo === 'dos_partes' ? 'en dos partes' : 'completo') + ' · enlace de pago (o transferencia en la UE)',
      ctx.tot.consultar
        ? 'Envío: A CONSULTAR. ' + ctx.pais.nombre_es + ' no tiene tarifa: escribid al cliente con la mejor opción (' + textoCajas(ctx.tot.listaCajas, es) + '). El total no lo incluye.'
        : 'Envío (aproximado): ' + ctx.pais.servicio + ', ' + textoCajas(ctx.tot.listaCajas, es) + ' = ' + dinero(ctx.tot.envio, 'es'),
      '',
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
  const out = [];
  ctx.unidades.forEach(function (u, i) {
    const det = (u.variante ? t(u.variante.etiqueta_grupo) + ': ' + t(u.variante.etiqueta) : u.colores.length
      ? u.colores.map(function (c) {
          // COLORES no tiene portugués: el nombre va en i18n/pt.json como "color.<id>".
          const nombre = c.nombres[L] || d['color.' + c.color_id] || c.nombres.es || c.color_id;
          return t(c.etiqueta_key) + ': ' + nombre + (c.de_serie ? ' (' + t('cat.de_serie') + ')' : '');
        }).join(' · ')
      : t('cat.colores_serie')) + (u.montaje ? ' · ' + t('res.montaje') : '') + (u.nota ? ' · ' + t('ped.notas') + ': ' + u.nota : '');
    out.push({ a: (i + 1) + '. ' + u.prod.nombre, det: det, b: dinero(u.prod.pvp, L) });
    u.extras.forEach(function (e) {
      out.push({ a: '+ ' + t('extra.linea', { nombre: t(e.etiqueta_key), n: e.cantidad }), det: e.opcion ? t(e.opcion.etiqueta) : '',
        b: dinero(e.importe, L) });
    });
  });
  if (ctx.tot.montajeUds) {
    out.push({ a: t('res.montaje'), det: t('res.montaje_detalle', { n: ctx.tot.montajeUds, precio: dinero(ctx.cat.montaje_pvp, L) }),
      b: dinero(ctx.tot.montaje, L) });
  }
  if (ctx.tot.consultar) {
    out.push({ a: t('res.envio'), det: t('res.envio_consultar'), b: t('res.envio_consultar_val') });
  } else {
    out.push({ a: t('res.envio_aprox'),
      det: t('res.envio_detalle', { servicio: ctx.pais.servicio, cajas: textoCajas(ctx.tot.listaCajas, d) }) + ' · ' + t('res.envio_nota'),
      b: dinero(ctx.tot.envio, L) });
  }
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
  // Google exige el mismo número de formatos que de columnas.
  if (formatos.length !== valores.length) throw new Error('escribirFila: ' + valores.length + ' valores y ' + formatos.length + ' formatos');
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

/** Pedidos de hoy de este email, de hoy en total y de la última hora (mirando los últimos 2000). */
function contarPedidos(email) {
  const out = { email: 0, dia: 0, hora: 0 };
  const sh = hoja(H.PEDIDOS);
  const n = sh.getLastRow() - 1;
  if (n < 1) return out;
  const desde = Math.max(2, sh.getLastRow() - 1999);
  const datos = sh.getRange(desde, 2, sh.getLastRow() - desde + 1, 4).getValues(); // B..E
  const ahora = new Date();
  const hoy = Utilities.formatDate(ahora, AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd');
  datos.forEach(function (r) {
    const f = r[0] instanceof Date ? r[0] : new Date(String(r[0]));
    if (isNaN(f) || Utilities.formatDate(f, AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd') !== hoy) return;
    out.dia++;
    if (ahora - f < 3600 * 1000) out.hora++;
    if (String(r[3]).trim().toLowerCase() === email) out.email++;
  });
  return out;
}

/** Un solo correo al día a la tienda cuando salta el freno global. */
function avisarFreno(cuenta) {
  const cache = CacheService.getScriptCache();
  const k = 'freno:' + Utilities.formatDate(new Date(), AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd');
  if (cache.get(k)) return;
  cache.put(k, '1', 21600);
  try {
    MailApp.sendEmail({
      to: AJUSTES.EMAIL_TIENDA,
      name: AJUSTES.NOMBRE_REMITENTE,
      subject: 'Aviso: la web está frenando pedidos',
      body: 'La web ha recibido ' + cuenta.hora + ' pedidos en la última hora y ' + cuenta.dia + ' hoy.\n' +
        'Por encima de ' + AJUSTES.MAX_PEDIDOS_HORA + ' por hora o ' + AJUSTES.MAX_PEDIDOS_DIA_TOTAL + ' al día deja de aceptarlos ' +
        '(protección contra pedidos falsos).\n\nMirad la pestaña PEDIDOS_WEB: si son pedidos reales, subid los límites ' +
        '(MAX_PEDIDOS_HORA y MAX_PEDIDOS_DIA_TOTAL en Code.gs) y desplegad una versión nueva.'
    });
  } catch (err) { console.error('aviso freno: ' + err); }
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

/** Quita del principio los caracteres con los que una hoja de cálculo empieza una fórmula (= + - @). */
function sinFormula(s) {
  return String(s).replace(/^[\s=+\-@]+/, '');
}

/** Cambia por [enlace] las direcciones web (http..., www..., dominio.com/...) de un texto. */
function sinEnlaces(s) {
  return String(s === undefined || s === null ? '' : s).replace(
    /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|biz|io|co|me|xyz|top|site|online|link|click|app|dev|shop|live|ru|cn|tk)\b(?:\/\S*)?/gi,
    '[enlace]');
}

/** Texto traducido. Si falta en el idioma del cliente, usa el inglés (como t() de la web); si tampoco está, la clave. */
function tr(dict, key, vars) {
  let s = dict[key];
  if (s === undefined) {
    try { s = ficheroPages('i18n/en.json')[key]; } catch (e) { /* sin inglés: seguimos con la clave */ }
  }
  if (s === undefined) s = key;
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

/** Firma de los correos ("Luis y Nicole\nMr & Mrs Resinator"): cada línea en su renglón. */
function firmaHtml(s) {
  return esc(s).replace(/\n/g, '<br>');
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
