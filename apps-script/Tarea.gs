/**
 * Soy Resinator · tarea programada de cada hora (va en el mismo proyecto que Code.gs)
 *
 * Hace cuatro cosas, en este orden:
 *   1. COLORES      <- RES · Inventario (STOCK): gramos disponibles de cada color.
 *   2. PEDIDOS_WEB  -> RES · Pedidos: copia cada pedido web nuevo una sola vez (PEDIDOS, LINEAS y CLIENTES)
 *                      y apunta el RES-AAAA-NNN en la columna W (REGISTRADO).
 *   3. ESTADO_WEB   <- RES · Pedidos y COMPROMETIDO: estado, pago, placas, servicio, tracking e ID_APP (columna X).
 *   4. CONFIG       <- horas de impresión que quedan en cola (A2) y fecha (D2). PEDIDOS_ABIERTOS (E2) no se toca.
 *
 * Instalación: ejecuta instalarTarea() una vez. Para probar sin esperar: ejecuta tareaHoraria().
 * Para pararla: ejecuta quitarTarea().
 */

const TAREA = {
  ID_PEDIDOS: '1cV7D0LwBZCqQdgznJN6SVJA-pFeHtrWg_5cAtqPxVAY',    // RES · Pedidos
  ID_INVENTARIO: '1vqMkX0nOf9kKBq4OS1lWmz02HBNua4v2LZGP771EtP8', // RES · Inventario
  // modelo de catalog.json -> ID_REPLICA de RES · Pedidos (si no está aquí, se usa el modelo en mayúsculas)
  REPLICA: { 'krieg': 'RIFLE-KRIEG', 'cadia': 'RIFLE-CADIA' },
  // Horas de impresión de lo que no está en la web (para la cola). Lo que no aparezca: HORAS_OTROS.
  HORAS_EXTRA: { 'STAND': 8, 'TOKEN-BOX': 10, 'SHELF-CASE': 12 },
  HORAS_OTROS: 10
};

const MAPA_ESTADO = {
  'por cobrar': 'pendiente_pago', 'en producción': 'en_produccion', 'en produccion': 'en_produccion',
  'listo': 'listo', 'empaquetado': 'listo', 'enviado': 'enviado', 'entregado': 'entregado', 'cancelado': 'cancelado'
};
const MAPA_PAGO = { 'pendiente': 'pendiente', '1ª parte': 'parcial', '1a parte': 'parcial', 'pagado': 'pagado', 'regalo': 'pagado' };
const MAPA_SERVICIO_RES = { 'InPost': 'InPost', 'Correos Standard': 'Standard', 'Correos Premium': 'Premium' };
const MAPA_SERVICIO_WEB = { 'InPost': 'InPost', 'Standard': 'Correos Standard', 'Premium': 'Correos Premium' };

function instalarTarea() {
  quitarTarea();
  ScriptApp.newTrigger('tareaHoraria').timeBased().everyHours(1).create();
  return tareaHoraria();
}

function quitarTarea() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tareaHoraria') ScriptApp.deleteTrigger(t);
  });
}

function tareaHoraria() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'Otra ejecución en marcha';
  try {
    const inv = SpreadsheetApp.openById(TAREA.ID_INVENTARIO);
    const res = SpreadsheetApp.openById(TAREA.ID_PEDIDOS);
    const cat = ficheroPages('data/catalog.json');
    const ship = ficheroPages('data/shipping.json');
    const cfgWeb = ficheroPages('data/config.json');
    const ahora = new Date();
    const log = [];

    log.push(sincronizarColores(inv, ahora));
    log.push(registrarPedidos(res, cat, ship, ahora));
    const placas = leerPlacas(inv);
    const cola = calcularCola(res, cat, placas);
    log.push(actualizarEstados(res, cat, cfgWeb, placas, cola, ahora));
    log.push(escribirCola(cola.total, ahora));

    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('config_pub');
    const txt = log.join(' · ');
    console.log(txt);
    return txt;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 1. COLORES ---------- */
function sincronizarColores(inv, ahora) {
  const stock = {};
  tabla(inv.getSheetByName('STOCK')).filas.forEach(function (r) {
    stock[str(r.ID_ITEM)] = Math.max(0, Math.floor(num(r.DISPONIBLE)));
  });
  const sh = hoja(H.COLORES);
  const n = sh.getLastRow() - 1;
  if (n < 1) return 'COLORES vacía';
  const rango = sh.getRange(2, 8, n, 2); // H: IDS_FILAMENTO, I: DISPONIBLE_G
  const v = rango.getValues();
  let cambios = 0;
  const salida = v.map(function (r) {
    const ids = String(r[0] || '').split(';').map(function (s) { return s.split(':')[0].trim(); }).filter(String);
    if (!ids.length) return r;
    const g = ids.map(function (id) { return stock[id] || 0; });
    const nuevo = [ids.map(function (id, i) { return id + ':' + g[i]; }).join(';'), g.reduce(function (a, b) { return a + b; }, 0)];
    if (String(nuevo[0]) !== String(r[0]) || Number(nuevo[1]) !== Number(r[1])) cambios++;
    return nuevo;
  });
  rango.setValues(salida);
  sh.getRange(2, 11, n, 1).setValues(salida.map(function () { return [ahora.toISOString()]; }));
  return 'COLORES: ' + cambios + ' cambios';
}

/* ---------- 2. Copiar pedidos web nuevos a RES · Pedidos ---------- */
function registrarPedidos(res, cat, ship, ahora) {
  const web = hoja(H.PEDIDOS);
  const n = web.getLastRow() - 1;
  if (n < 1) return 'Pedidos nuevos: 0';
  const datos = web.getRange(2, 1, n, 24).getValues();

  const shP = res.getSheetByName('PEDIDOS');
  const shL = res.getSheetByName('LINEAS');
  const shC = res.getSheetByName('CLIENTES');
  const pedidos = tabla(shP);
  const ya = {};
  pedidos.filas.forEach(function (r) { if (str(r.ID_FORM)) ya[str(r.ID_FORM)] = str(r.ID_PEDIDO); });
  const nombresReplica = {};
  tabla(shL).filas.forEach(function (r) { if (!nombresReplica[str(r.ID_REPLICA)]) nombresReplica[str(r.ID_REPLICA)] = str(r.PRODUCTO); });
  const clientes = tabla(shC);

  let nuevos = 0;
  datos.forEach(function (w, i) {
    const idWeb = str(w[0]);
    if (!idWeb || str(w[22])) return;                   // sin ID o ya registrado
    if (ya[idWeb]) { web.getRange(i + 2, 23).setNumberFormat('@').setValue(ya[idWeb]); return; } // copiado a mano

    const items = JSON.parse(String(w[11] || '[]'));
    const fecha = w[1] instanceof Date ? w[1] : new Date(String(w[1]));
    const email = str(w[4]).toLowerCase();
    const paisNombre = str(w[9]);
    const pais = ship.paises.filter(function (p) { return p.nombre_es === paisNombre; })[0] || {};

    // Cliente: por email; si no existe, uno nuevo.
    let cli = clientes.filas.filter(function (c) { return str(c.EMAIL).toLowerCase() === email; })[0];
    let idCli = cli ? str(cli.ID_CLIENTE) : siguienteId(clientes.filas.map(function (c) { return str(c.ID_CLIENTE); }), 'CLI-', 3);
    if (!cli) {
      const fila = { ID_CLIENTE: idCli, NOMBRE: str(w[3]), EMAIL: email, TELEFONO: str(w[5]),
        DIRECCION: str(w[6]) + ', ' + str(w[7]) + ' ' + str(w[8]), PAIS: paisNombre, INSTAGRAM: str(w[10]) };
      anadirFila(shC, clientes.enc, fila);
      clientes.filas.push(fila);
    }

    // Líneas: una por unidad, con el nombre que ya usa RES · Pedidos para esa réplica.
    const lineas = items.map(function (it, k) {
      const rep = idReplica(it.modelo);
      const colores = (it.colores || []).map(function (c) { return c.etiqueta_es + ': ' + c.color_es; }).join(', ');
      return { LINEA: k + 1, ID_REPLICA: rep, PRODUCTO: nombresReplica[rep] || it.nombre, CANTIDAD: 1,
        TEXTO_CLIENTE: it.nombre + (colores ? ' (' + colores + ')' : '') };
    });
    const cuenta = {};
    lineas.forEach(function (l) { cuenta[l.PRODUCTO] = (cuenta[l.PRODUCTO] || 0) + 1; });
    const productos = Object.keys(cuenta).map(function (p) { return (cuenta[p] > 1 ? cuenta[p] + '× ' : '') + p; }).join(', ');

    const anio = Utilities.formatDate(fecha, AJUSTES.ZONA_HORARIA, 'yyyy');
    const idRes = siguienteId(pedidos.filas.map(function (r) { return str(r.ID_PEDIDO); }), 'RES-' + anio + '-', 3);
    const notas = str(w[12]) + (str(w[13]) ? ' · Notas: ' + str(w[13]) : '') + (str(w[18]) === 'dos_partes' ? ' · Pago en dos partes' : '');
    const filaP = {
      ID_PEDIDO: idRes, FECHA: fecha, ID_CLIENTE: idCli, CLIENTE: str(w[3]), PAIS: paisNombre, PRODUCTOS: productos,
      ESTADO: 'Por cobrar', PAGO: 'Pendiente', FORMA_PAGO: pais.ue ? 'TRANSFERENCIA' : 'PAYPAL',
      IMPORTE_PRODUCTOS: num(w[14]) + num(w[15]), ENVIO_COBRADO: num(w[16]), COBRADO: 0,
      MONTAJE: num(w[15]) > 0 ? 'SÍ' : 'NO', SERVICIO_ENVIO: MAPA_SERVICIO_RES[str(w[19])] || str(w[19]),
      NOTAS_CLIENTE: notas, ID_FORM: idWeb,
      CLAVE_FORM: Utilities.formatDate(fecha, AJUSTES.ZONA_HORARIA, 'd/MM/yyyy H:mm:ss') + '|' + email + '|' + idWeb + '|' +
        items.map(function (it) { return it.nombre; }).join(', ')
    };
    anadirFila(shP, pedidos.enc, filaP);
    pedidos.filas.push(filaP);
    lineas.forEach(function (l) { l.ID_PEDIDO = idRes; anadirFila(shL, tabla(shL).enc, l); });

    web.getRange(i + 2, 23).setNumberFormat('@').setValue(idRes);
    ya[idWeb] = idRes;
    nuevos++;
  });
  return 'Pedidos nuevos: ' + nuevos;
}

/* ---------- Placas (bandejas) por pedido, desde COMPROMETIDO ---------- */
function leerPlacas(inv) {
  const porPedido = {};
  tabla(inv.getSheetByName('COMPROMETIDO')).filas.forEach(function (r) {
    const origen = str(r.ORIGEN);
    if (!/^bandeja/i.test(origen)) return;
    const p = str(r.PEDIDO);
    const est = str(r.ESTADO).toUpperCase();
    if (est === 'LIBERADO') return;
    porPedido[p] = porPedido[p] || {};
    const b = porPedido[p][origen] = porPedido[p][origen] || { hecha: true };
    if (est !== 'CONSUMIDO') b.hecha = false;
  });
  const out = {};
  Object.keys(porPedido).forEach(function (p) {
    const b = Object.keys(porPedido[p]);
    out[p] = { total: b.length, hechas: b.filter(function (k) { return porPedido[p][k].hecha; }).length };
  });
  return out;
}

/* ---------- Horas de cola: lo que queda por imprimir de los pedidos en producción ---------- */
function calcularCola(res, cat, placas) {
  const horasReplica = {};
  cat.productos.forEach(function (p) { horasReplica[idReplica(p.modelo)] = p.horas; });
  const horasPedido = {};
  tabla(res.getSheetByName('LINEAS')).filas.forEach(function (l) {
    const rep = str(l.ID_REPLICA);
    const h = horasReplica[rep] !== undefined ? horasReplica[rep]
      : (TAREA.HORAS_EXTRA[rep] !== undefined ? TAREA.HORAS_EXTRA[rep] : TAREA.HORAS_OTROS);
    horasPedido[str(l.ID_PEDIDO)] = (horasPedido[str(l.ID_PEDIDO)] || 0) + h * (num(l.CANTIDAD) || 1);
  });
  const restante = {};
  let total = 0;
  tabla(res.getSheetByName('PEDIDOS')).filas.forEach(function (r) {
    const id = str(r.ID_PEDIDO);
    if (MAPA_ESTADO[str(r.ESTADO).toLowerCase()] !== 'en_produccion') return;
    const pl = placas[id];
    const parte = pl && pl.total ? (pl.total - pl.hechas) / pl.total : 1;
    restante[id] = (horasPedido[id] || 0) * parte;
    total += restante[id];
  });
  return { total: Math.round(total * 10) / 10, restante: restante, horasPedido: horasPedido };
}

/* ---------- 3. ESTADO_WEB ---------- */
function actualizarEstados(res, cat, cfgWeb, placas, cola, ahora) {
  const web = hoja(H.PEDIDOS);
  const est = hoja(H.ESTADO);
  const nW = web.getLastRow() - 1, nE = est.getLastRow() - 1;
  if (nW < 1 || nE < 1) return 'Estados: 0';
  const registro = {};
  web.getRange(2, 1, nW, 24).getValues().forEach(function (w, i) {
    if (str(w[22])) registro[str(w[0])] = { res: str(w[22]), fila: i + 2, servicio: str(w[19]), appActual: str(w[23]) };
  });
  const resPorId = {};
  tabla(res.getSheetByName('PEDIDOS')).filas.forEach(function (r) { resPorId[str(r.ID_PEDIDO)] = r; });
  const cfg = leerConfig();
  const pl = cfgWeb.plazo || {};

  const rango = est.getRange(2, 1, nE, 11);
  const v = rango.getValues();
  let cambios = 0;
  v.forEach(function (e) {
    const reg = registro[str(e[0])];
    if (!reg) return;
    const r = resPorId[reg.res];
    if (!r) return;
    const antes = JSON.stringify(e.slice(2, 10));
    e[2] = MAPA_ESTADO[str(r.ESTADO).toLowerCase()] || e[2];
    const p = placas[reg.res];
    e[3] = p ? p.hechas : '';
    e[4] = p ? p.total : '';
    e[5] = MAPA_PAGO[str(r.PAGO).toLowerCase()] || e[5];
    if (e[5] !== 'pendiente' && !str(e[6])) {
      // Primera vez que vemos el pago: fijamos la fecha estimada con la cola de este momento.
      const hoy = Utilities.formatDate(ahora, AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd');
      e[6] = hoy;
      const horas = cola.horasPedido[reg.res] || 0;
      const otros = Math.max(0, cola.total - (cola.restante[reg.res] || 0));
      const dias = Math.max(pl.dias_minimo || 21,
        Math.ceil((otros + horas * (pl.factor_horas || 1.08)) / (cfg.horas_dia || 16)) + cfg.dias_preparacion);
      e[7] = Utilities.formatDate(new Date(ahora.getTime() + dias * 86400000), AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd');
    }
    e[8] = MAPA_SERVICIO_WEB[str(r.SERVICIO_ENVIO)] || reg.servicio;
    e[9] = str(r.TRACKING);
    if (JSON.stringify(e.slice(2, 10)) !== antes) { e[10] = ahora.toISOString(); cambios++; }
    if (str(r.ID_APP) && str(r.ID_APP) !== reg.appActual) web.getRange(reg.fila, 24).setNumberFormat('@').setValue(str(r.ID_APP));
  });
  rango.setNumberFormats(v.map(function () { return FORMATO_ESTADO; }));
  rango.setValues(v);
  return 'Estados: ' + cambios + ' cambios';
}

/* ---------- 4. CONFIG ---------- */
function escribirCola(horas, ahora) {
  hoja(H.CONFIG).getRange(2, 1).setValue(horas);
  hoja(H.CONFIG).getRange(2, 4).setValue(ahora.toISOString());
  return 'Cola: ' + horas + ' h';
}

/* ---------- utilidades de la tarea ---------- */
function tabla(sh) {
  const v = sh.getDataRange().getValues();
  const enc = (v[0] || []).map(function (h) { return str(h); });
  const filas = v.slice(1).filter(function (r) { return r.some(function (c) { return c !== '' && c !== null; }); })
    .map(function (r) { const o = {}; enc.forEach(function (h, i) { if (h) o[h] = r[i]; }); return o; });
  return { enc: enc, filas: filas };
}

/** Añade una fila al final copiando formato y fórmulas de la fila anterior; escribe solo las columnas que no son fórmula. */
function anadirFila(sh, enc, obj) {
  const ultima = sh.getLastRow();
  const nueva = ultima + 1;
  const ancho = enc.length;
  const formulas = ultima >= 2 ? sh.getRange(ultima, 1, 1, ancho).getFormulasR1C1()[0] : [];
  if (ultima >= 2) {
    sh.getRange(ultima, 1, 1, ancho).copyTo(sh.getRange(nueva, 1, 1, ancho), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sh.getRange(ultima, 1, 1, ancho).copyTo(sh.getRange(nueva, 1, 1, ancho), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  enc.forEach(function (h, i) {
    const celda = sh.getRange(nueva, i + 1);
    if (formulas[i]) { celda.setFormulaR1C1(formulas[i]); return; }
    if (!h || obj[h] === undefined) return;
    const val = obj[h];
    if (typeof val === 'string') celda.setNumberFormat('@');
    celda.setValue(val);
  });
}

function siguienteId(ids, prefijo, digitos) {
  let max = 0;
  ids.forEach(function (id) { if (id.indexOf(prefijo) === 0) max = Math.max(max, parseInt(id.slice(prefijo.length), 10) || 0); });
  return prefijo + String(max + 1).padStart(digitos, '0');
}

function idReplica(modelo) {
  const m = String(modelo || '').toLowerCase();
  return TAREA.REPLICA[m] || m.toUpperCase();
}

function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').replace(/[^\d,.-]/g, '');
  const n = Number(s.indexOf(',') >= 0 ? s.replace(/\./g, '').replace(',', '.') : s);
  return isNaN(n) ? 0 : n;
}
