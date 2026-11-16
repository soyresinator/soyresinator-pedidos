/**
 * Soy Resinator · tarea programada de cada hora (va en el mismo proyecto que Code.gs)
 *
 * Hace cuatro cosas, en este orden:
 *   1. COLORES      <- RES · Inventario (STOCK): gramos disponibles de cada color.
 *   2. PEDIDOS_WEB  <-> RES · Pedidos: NO crea pedidos (eso lo hace la app Pedidos Resinator).
 *                      Busca el pedido por ID_FORM = SR-XXXXXX y apunta su RES-AAAA-NNN en la columna W (REGISTRADO).
 *   3. ESTADO_WEB   <- RES · Pedidos y COMPROMETIDO: estado, pago, placas, servicio, tracking e ID_APP (columna X).
 *                      También los pedidos del formulario antiguo a los que asignarSRFormulario() dio un SR-
 *                      (su RES-… va en la columna L de ESTADO_WEB).
 *                      Si el pedido pasa a Enviado con TRACKING, manda UNA vez el correo "tu pedido ha salido"
 *                      y apunta la fecha en la columna M (AVISO_ENVIO). Se controla con TAREA.AVISO_ENVIO.
 *                      Pide la reseña DIAS_RESENA días después de Entregado (N y O; TAREA.AVISO_RESENA). Un pedido que
 *                      sigue en Enviado se da por entregado pasados DIAS_ENTREGA_SUPUESTA / DIAS_ENTREGA_SIN_FECHA.
 *                      Clientes anteriores a la web: importarClientesAntiguos(), una vez.
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
  HORAS_OTROS: 10,
  // Correo "tu pedido ha salido" (ESTADO = Enviado y con TRACKING en RES · Pedidos):
  //   'no' = apagado · 'prueba' = solo a los SR de AVISO_PRUEBA · 'todos' = a todos los clientes.
  // Antes de poner 'todos', ejecuta marcarAvisosPrevios() una vez para no escribir a quien ya recibió su pedido.
  AVISO_ENVIO: 'todos',
  AVISO_PRUEBA: ['SR-GKN655'], // p. ej. ['SR-ABC123']
  // Correo pidiendo una reseña, DIAS_RESENA días después de que la app marque el pedido como Entregado:
  //   'no' = apagado · 'prueba' = solo a los SR de RESENA_PRUEBA · 'todos' = a todos los clientes.
  // Antes de poner 'todos', decide si los pedidos ya entregados reciben el correo: si no, ejecuta marcarResenasPrevias().
  AVISO_RESENA: 'todos',
  RESENA_PRUEBA: ['SR-GKN655'],
  DIAS_RESENA: 4,
  // Para que lleguen bien (y no todos de golpe): solo entre estas horas de Madrid y como mucho N por hora.
  // Los que no caben salen en las horas siguientes.
  HORAS_RESENA: [10, 21], // de 10:00 a 20:59
  MAX_RESENAS_HORA: 10,
  // Entrega supuesta: si la app sigue en Enviado, lo damos por entregado N días después de FECHA_ENVIO
  // (o, si no hay FECHA_ENVIO, N días después de la fecha del pedido). Así los pedidos antiguos también piden reseña.
  DIAS_ENTREGA_SUPUESTA: 21,
  DIAS_ENTREGA_SIN_FECHA: 60,
  // Clientes de prueba de RES · Pedidos: importarClientesAntiguos() no los toca.
  CLIENTES_PRUEBA: ['CLI-044', 'CLI-045']
};

// Idioma de los correos para los pedidos que no vienen de la web (país como lo escribe RES · Pedidos).
const IDIOMA_PAIS = {
  'España': 'es', 'México': 'es', 'Argentina': 'es', 'Chile': 'es', 'Colombia': 'es', 'Perú': 'es', 'Uruguay': 'es',
  'Francia': 'fr', 'Bélgica': 'fr', 'Luxemburgo': 'fr', 'Mónaco': 'fr',
  'Alemania': 'de', 'Austria': 'de', 'Suiza': 'de', 'Liechtenstein': 'de',
  'Portugal': 'pt', 'Brasil': 'pt', 'Italia': 'it', 'San Marino': 'it'
};

const MAPA_ESTADO = {
  'por cobrar': 'pendiente_pago', 'en producción': 'en_produccion', 'en produccion': 'en_produccion',
  'listo': 'listo', 'empaquetado': 'listo', 'enviado': 'enviado', 'entregado': 'entregado', 'cancelado': 'cancelado'
};
const MAPA_PAGO = { 'pendiente': 'pendiente', '1ª parte': 'parcial', '1a parte': 'parcial', 'pagado': 'pagado', 'regalo': 'pagado' };
// Solo enviamos con Correos (InPost se dejó de usar el 07/11/2026).
const MAPA_SERVICIO_WEB = { 'Standard': 'Correos Standard', 'Premium': 'Correos Premium' };

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
    const cfgWeb = ficheroPages('data/config.json');
    const ahora = new Date();
    const log = [];

    log.push(sincronizarColores(inv, ahora));
    log.push(registrarPedidos(res));
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

/* ---------- 2. Enlazar pedidos web con RES · Pedidos ----------
 * Los pedidos los crea la app Pedidos Resinator (con ID_FORM = SR-XXXXXX). Esta tarea NO crea filas
 * en PEDIDOS, LINEAS ni CLIENTES: solo busca el pedido por ID_FORM y apunta su RES-AAAA-NNN en la
 * columna W (REGISTRADO) de PEDIDOS_WEB. Si la app aún no lo ha importado, lo deja para la hora siguiente.
 */
function registrarPedidos(res) {
  const web = hoja(H.PEDIDOS);
  const n = web.getLastRow() - 1;
  if (n < 1) return 'Pedidos enlazados: 0';
  const datos = web.getRange(2, 1, n, 24).getValues();

  const ya = {};
  tabla(res.getSheetByName('PEDIDOS')).filas.forEach(function (r) {
    if (str(r.ID_FORM)) ya[str(r.ID_FORM)] = str(r.ID_PEDIDO);
  });

  let enlazados = 0, esperando = 0;
  datos.forEach(function (w, i) {
    const idWeb = str(w[0]);
    if (!idWeb || str(w[22])) return;                   // sin ID o ya enlazado
    if (!ya[idWeb]) { esperando++; return; }            // la app todavía no lo ha importado
    web.getRange(i + 2, 23).setNumberFormat('@').setValue(ya[idWeb]);
    enlazados++;
  });
  return 'Pedidos enlazados: ' + enlazados + (esperando ? ' (' + esperando + ' esperando a la app)' : '');
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
  const porBandeja = {}; // BALAS-X4: CANTIDAD en LINEAS son balas sueltas; se imprimen de 4 en 4
  cat.productos.forEach(function (p) {
    horasReplica[p.id_replica || idReplica(p.modelo)] = p.horas;
    // Extras (cargadores, STAND, BALAS-X4): horas por pieza (en balas, por bandeja).
    (p.extras || []).forEach(function (e) {
      horasReplica[e.id_replica] = e.horas;
      const def = (cat.extras_def || {})[e.tipo] || {};
      if (def.por_bandeja) porBandeja[e.id_replica] = def.por_bandeja;
    });
  });
  const horasPedido = {};
  tabla(res.getSheetByName('LINEAS')).filas.forEach(function (l) {
    const rep = str(l.ID_REPLICA);
    const h = horasReplica[rep] !== undefined ? horasReplica[rep]
      : (TAREA.HORAS_EXTRA[rep] !== undefined ? TAREA.HORAS_EXTRA[rep] : TAREA.HORAS_OTROS);
    const cant = num(l.CANTIDAD) || 1;
    const veces = porBandeja[rep] ? Math.ceil(cant / porBandeja[rep]) : cant;
    horasPedido[str(l.ID_PEDIDO)] = (horasPedido[str(l.ID_PEDIDO)] || 0) + h * veces;
  });
  const restante = {};
  let total = 0;
  tabla(res.getSheetByName('PEDIDOS')).filas.forEach(function (r) {
    const id = str(r.ID_PEDIDO);
    if (MAPA_ESTADO[str(r.ESTADO).toLowerCase()] !== 'en_produccion') return;
    if (esPrueba(r)) return; // pedidos de prueba (columna PRUEBA = SÍ): no ocupan cola
    const pl = placas[id];
    const parte = pl && pl.total ? (pl.total - pl.hechas) / pl.total : 1;
    restante[id] = (horasPedido[id] || 0) * parte;
    total += restante[id];
  });
  return { total: Math.round(total * 10) / 10, restante: restante, horasPedido: horasPedido };
}

/** Columna PRUEBA (AA) de PEDIDOS: "SÍ" en los pedidos de prueba. Solo cuenta para la cola. */
function esPrueba(r) {
  const v = str(r.PRUEBA).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return v === 'SI' || v === 'TRUE';
}

/* ---------- 3. ESTADO_WEB ---------- */
function actualizarEstados(res, cat, cfgWeb, placas, cola, ahora) {
  const web = hoja(H.PEDIDOS);
  const est = hoja(H.ESTADO);
  const nW = web.getLastRow() - 1, nE = est.getLastRow() - 1;
  if (nE < 1) return 'Estados: 0';
  const registro = {};
  if (nW > 0) web.getRange(2, 1, nW, 24).getValues().forEach(function (w, i) {
    if (str(w[22])) registro[str(w[0])] = { res: str(w[22]), fila: i + 2, servicio: str(w[19]), appActual: str(w[23]),
      idioma: str(w[2]), nombre: str(w[3]), email: str(w[4]), items: w[11] };
  });
  if (est.getRange(1, 13).getValue() !== 'AVISO_ENVIO') est.getRange(1, 13).setValue('AVISO_ENVIO').setFontWeight('bold');
  if (est.getRange(1, 14).getValue() !== 'ENTREGADO_EL') est.getRange(1, 14, 1, 2).setValues([['ENTREGADO_EL', 'AVISO_RESENA']]).setFontWeight('bold');
  if (est.getRange(1, 16).getValue() !== 'MANUALES') est.getRange(1, 16).setValue('MANUALES').setFontWeight('bold');
  // Manuales de cada pedido (P): de las réplicas de LINEAS. Sirve igual para los pedidos web y los del formulario antiguo.
  const lineasRes = tabla(res.getSheetByName('LINEAS')).filas;
  const avisos = [];
  const resenas = [];
  const resPorId = {};
  tabla(res.getSheetByName('PEDIDOS')).filas.forEach(function (r) { resPorId[str(r.ID_PEDIDO)] = r; });
  const cfg = leerConfig();
  const pl = cfgWeb.plazo || {};

  const rango = est.getRange(2, 1, nE, 16);
  const v = rango.getValues();
  let cambios = 0;
  v.forEach(function (e) {
    while (e.length < 16) e.push('');
    // Pedido web: su RES-… está en PEDIDOS_WEB (W). Pedido del formulario antiguo: en ESTADO_WEB (L).
    const reg = registro[str(e[0])];
    const resId = reg ? reg.res : str(e[11]);
    if (!resId) return;
    const r = resPorId[resId];
    if (!r) return;
    e[11] = resId;
    const antes = JSON.stringify(e.slice(2, 10));
    e[2] = MAPA_ESTADO[str(r.ESTADO).toLowerCase()] || e[2];
    // Entrega supuesta (la app rara vez pasa los pedidos antiguos a Entregado).
    if (e[2] === 'enviado') {
      const sup = entregaSupuesta(r);
      if (sup && ahora >= sup) { e[2] = 'entregado'; if (!str(e[13])) e[13] = sup.toISOString(); }
    }
    const p = placas[resId];
    e[3] = p ? p.hechas : '';
    e[4] = p ? p.total : '';
    e[5] = MAPA_PAGO[str(r.PAGO).toLowerCase()] || e[5];
    if (!reg) {
      // Formulario antiguo: la fecha estimada es la ENVIO_IDEAL que lleva la app.
      const ideal = fechaHoja(r.ENVIO_IDEAL);
      if (ideal) e[7] = Utilities.formatDate(ideal, AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd');
    } else if (e[5] !== 'pendiente' && !str(e[6])) {
      // Primera vez que vemos el pago: fijamos la fecha estimada con la cola de este momento.
      const hoy = Utilities.formatDate(ahora, AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd');
      e[6] = hoy;
      const horas = cola.horasPedido[resId] || 0;
      const otros = Math.max(0, cola.total - (cola.restante[resId] || 0));
      const dias = Math.max(pl.dias_minimo || 21,
        Math.ceil((otros + horas * (pl.factor_horas || 1.08)) / (cfg.horas_dia || 16)) + cfg.dias_preparacion);
      e[7] = Utilities.formatDate(new Date(ahora.getTime() + dias * 86400000), AJUSTES.ZONA_HORARIA, 'yyyy-MM-dd');
    }
    // "A consultar" no es un transportista: no se lo enseñamos al cliente hasta que elijáis uno en la app.
    const servicio = MAPA_SERVICIO_WEB[str(r.SERVICIO_ENVIO)] || (reg ? reg.servicio : '');
    e[8] = /consultar/i.test(servicio) ? '' : servicio;
    e[9] = str(r.TRACKING);
    e[15] = manualesPedido(lineasRes, resId);
    if (JSON.stringify(e.slice(2, 10)) !== antes) { e[10] = ahora.toISOString(); cambios++; }
    if (reg && str(r.ID_APP) && str(r.ID_APP) !== reg.appActual) web.getRange(reg.fila, 24).setNumberFormat('@').setValue(str(r.ID_APP));
    // Aviso de envío: una sola vez por pedido (AVISO_ENVIO vacía). Si cambia el tracking, no se reenvía.
    if (str(r.ESTADO).toLowerCase() === 'enviado' && e[9] && !str(e[12]) && avisoPermitido(str(e[0]))) {
      avisos.push({ e: e, r: r, reg: reg });
    }
    // Reseña: apuntamos la primera vez que lo vemos Entregado (N) y, pasados DIAS_RESENA días, pedimos la reseña UNA vez (O).
    if (e[2] === 'entregado') {
      if (!str(e[13])) e[13] = ahora.toISOString();
      const desde = new Date(str(e[13]));
      if (!str(e[14]) && !isNaN(desde) && ahora - desde >= TAREA.DIAS_RESENA * 86400000 && resenaPermitida(str(e[0]), r)) {
        resenas.push({ e: e, r: r, reg: reg });
      }
    }
  });

  let enviados = 0, fallos = 0, pedidas = 0, fallosR = 0;
  const ctx = { clientes: {}, lineas: [], cat: cat };
  if (avisos.length || resenas.length) {
    tabla(res.getSheetByName('CLIENTES')).filas.forEach(function (c) { ctx.clientes[str(c.ID_CLIENTE)] = c; });
    ctx.lineas = lineasRes;
  }
  const hora = Number(Utilities.formatDate(ahora, AJUSTES.ZONA_HORARIA, 'H'));
  const enHora = hora >= TAREA.HORAS_RESENA[0] && hora < TAREA.HORAS_RESENA[1];
  const tanda = enHora ? resenas.slice(0, TAREA.MAX_RESENAS_HORA) : [];
  const esperan = resenas.length - tanda.length;
  tanda.forEach(function (a) {
    try {
      if (correoResena(a, ctx)) { a.e[14] = ahora.toISOString(); pedidas++; } else fallosR++;
    } catch (err) {
      fallosR++;
      console.error('Correo de reseña ' + str(a.e[0]) + ': no se pudo enviar'); // sin direcciones en el log
    }
  });
  if (avisos.length) {
    avisos.forEach(function (a) {
      try {
        if (correoEnvio(a, ctx)) { a.e[12] = ahora.toISOString(); enviados++; } else fallos++;
      } catch (err) {
        fallos++;
        console.error('Aviso de envío ' + str(a.e[0]) + ': no se pudo enviar'); // sin direcciones en el log
      }
    });
  }
  rango.setNumberFormats(v.map(function () { return FORMATO_ESTADO; }));
  rango.setValues(v);
  return 'Estados: ' + cambios + ' cambios' +
    (enviados || fallos ? ' · Avisos de envío: ' + enviados + (fallos ? ' (' + fallos + ' sin enviar)' : '') : '') +
    (pedidas || fallosR ? ' · Reseñas pedidas: ' + pedidas + (fallosR ? ' (' + fallosR + ' sin enviar)' : '') : '') +
    (esperan ? ' · Reseñas en espera: ' + esperan + (enHora ? '' : ' (fuera de horario)') : '');
}

/* ---------- Correo pidiendo la reseña ---------- */
/** En 'todos', los pedidos marcados como PRUEBA en RES · Pedidos solo reciben el correo si están en RESENA_PRUEBA. */
function resenaPermitida(sr, r) {
  if (TAREA.RESENA_PRUEBA.indexOf(sr) >= 0) return TAREA.AVISO_RESENA !== 'no';
  return TAREA.AVISO_RESENA === 'todos' && !(r && esPrueba(r));
}

/** Fecha a partir de la cual damos un pedido Enviado por entregado; null si no hay ninguna fecha. */
function entregaSupuesta(r) {
  const env = fechaHoja(r.FECHA_ENVIO);
  if (env) return new Date(env.getTime() + TAREA.DIAS_ENTREGA_SUPUESTA * 86400000);
  const ped = fechaHoja(r.FECHA);
  return ped ? new Date(ped.getTime() + TAREA.DIAS_ENTREGA_SIN_FECHA * 86400000) : null;
}

function idiomaPais(pais) {
  return IDIOMA_PAIS[str(pais)] || 'en';
}

/**
 * Productos de un pedido de RES · Pedidos (LINEAS), con el nombre y el pid de la web cuando están en el catálogo.
 * Los cargadores y las balas sueltas no cuentan; lo que no está en la web va con el nombre de la app.
 */
function productosRes(lineas, resId, cat) {
  const porReplica = {};
  ((cat && cat.productos) || []).forEach(function (p) { if (p.id_replica) porReplica[p.id_replica] = p; });
  const out = [];
  lineas.forEach(function (l) {
    if (str(l.ID_PEDIDO) !== resId) return;
    const rep = str(l.ID_REPLICA);
    if (/^(CARGADOR|BALAS)/.test(rep)) return;
    const p = porReplica[rep];
    const n = Math.max(1, num(l.CANTIDAD));
    const ya = out.filter(function (x) { return x.rep === rep; })[0];
    if (ya) { ya.n += n; return; }
    out.push({ rep: rep, pid: p ? p.id : '', nombre: p ? p.nombre : str(l.PRODUCTO), n: n });
  });
  return out;
}

/** Manuales de un pedido ("heavy-bolt,…") según las réplicas de sus LINEAS (tabla MANUALES de Code.gs). */
function manualesPedido(lineas, resId) {
  const reps = {};
  lineas.forEach(function (l) { if (str(l.ID_PEDIDO) === resId) reps[str(l.ID_REPLICA)] = true; });
  return Object.keys(MANUALES).filter(function (m) {
    return MANUALES[m].some(function (rep) { return reps[rep]; });
  }).join(',');
}

function textoProductos(lista) {
  return lista.map(function (x) { return (x.n > 1 ? x.n + ' × ' : '') + x.nombre; }).join(', ');
}

/**
 * Email, nombre, idioma y productos del cliente: del pedido web o, si no viene de la web, de CLIENTES y LINEAS
 * (idioma según el país). ctx = { clientes, lineas, cat }.
 */
function datosCliente(a, ctx) {
  const r = a.r, reg = a.reg;
  if (reg) {
    return { email: reg.email, nombre: reg.nombre, L: IDIOMAS.indexOf(reg.idioma) >= 0 ? reg.idioma : 'en',
      productos: productosWeb(reg.items) || str(r.PRODUCTOS) };
  }
  const c = (ctx.clientes || {})[str(r.ID_CLIENTE)] || {};
  return { email: str(c.EMAIL) || str(String(r.CLAVE_FORM || '').split('|')[1]), nombre: str(c.NOMBRE) || str(r.CLIENTE),
    L: idiomaPais(r.PAIS), productos: textoProductos(productosRes(ctx.lineas || [], str(r.ID_PEDIDO), ctx.cat)) || str(r.PRODUCTOS) };
}

/** Devuelve true si se ha enviado; false si falta el email. */
function correoResena(a, ctx) {
  const id = str(a.e[0]);
  const dc = datosCliente(a, ctx);
  const email = String(dc.email || '').toLowerCase();
  if (!RE_EMAIL.test(email)) return false;
  const d = ficheroPages('i18n/' + dc.L + '.json');
  const t = function (k, v) { return tr(d, k, v); };
  const url = enlaceResena(id, dc.L);
  const saludo = dc.nombre ? t('mail.saludo', { nombre: dc.nombre.split(' ')[0] }) : t('mail.env_saludo');
  const intro = t('mail.res_intro', { productos: dc.productos || id });
  const web = AJUSTES.PAGES_BASE;
  const urlWeb = enlaceWebCorreo(id); // la portada con ?c=…&k=…: así sabemos si fue a la web (pestaña CLICS_CORREO)
  const logo = AJUSTES.PAGES_BASE + 'img/logo/icono-512.png'; // ya publicado en la web; si el cliente bloquea imágenes, queda el texto

  const texto = [saludo, '', intro, '', t('mail.res_pedir'), '', t('mail.res_fotos'), '',
    t('mail.res_boton') + ': ' + url, '', t('mail.res_publicar'), '',
    t('mail.res_web') + ' ' + urlWeb, '', t('mail.firma'), '', t('mail.res_baja')].join('\n');
  const boton = function (href, txt, principal) {
    return '<p style="text-align:center;margin:22px 0"><a href="' + esc(href) + '" style="' +
      (principal ? 'background:#7A5A26;color:#ffffff;border:2px solid #7A5A26;' : 'background:#ffffff;color:#7A5A26;border:2px solid #A77F41;') +
      'padding:13px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">' + esc(txt) + '</a></p>';
  };
  const html =
    '<div style="background:#f4f0e8;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1a150c;font-size:15px;line-height:1.5">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">' +
    // Mismo fondo que el del logo (#12100E), para que no se vea el cuadrado de la imagen.
    '<div style="background:#12100E;padding:20px 24px;text-align:center">' +
    '<a href="' + esc(web) + '" style="text-decoration:none"><img src="' + esc(logo) + '" width="72" height="72" alt="Soy Resinator" ' +
    'style="display:block;margin:0 auto 8px;border:0;width:72px;height:72px">' +
    '<span style="color:#A77F41;font-size:20px;font-weight:bold;letter-spacing:3px">SOY RESINATOR</span></a></div>' +
    '<div style="padding:24px">' +
    '<p>' + esc(saludo) + '</p><p>' + esc(intro) + '</p><p>' + esc(t('mail.res_pedir')) + '</p>' +
    '<p style="text-align:center;margin:20px 0 4px;font-size:28px;color:#A77F41;letter-spacing:4px" aria-hidden="true">★★★★★</p>' +
    boton(url, t('mail.res_boton'), true) +
    '<p style="background:#f8f3ea;border-left:4px solid #A77F41;border-radius:4px;padding:12px 14px">' +
    '<span aria-hidden="true">📷 </span>' + esc(t('mail.res_fotos')) + '</p>' +
    '<p style="color:#6b655c;font-size:14px">' + esc(t('mail.res_publicar')) + '</p>' +
    '<div style="border-top:1px solid #e4dccd;margin-top:24px;padding-top:8px">' +
    '<p>' + esc(t('mail.res_web')) + '</p>' + boton(urlWeb, t('mail.res_web_boton'), true) + '</div>' +
    '<p>' + firmaHtml(t('mail.firma')) + '</p>' +
    '<p style="color:#6b655c;font-size:12px;border-top:1px solid #e4dccd;padding-top:12px">' + esc(t('mail.res_baja')) + '</p>' +
    '</div></div></div>';

  MailApp.sendEmail({
    to: email,
    replyTo: AJUSTES.EMAIL_TIENDA,
    name: AJUSTES.NOMBRE_REMITENTE,
    subject: t('mail.res_asunto'), // "Soy Resinator · Cuéntanos tu experiencia": sin el SR, que los clientes antiguos nunca han visto
    body: texto,
    htmlBody: html
  });
  return true;
}

/* ---------- Una sola vez, antes de poner AVISO_RESENA: 'todos' (opcional) ----------
 * Marca como "previo" la reseña de los pedidos que ya están Entregados, para no escribirles ahora.
 * Si queréis pedir reseña también a esos clientes, NO la ejecutéis. No envía nada. Se puede repetir.
 */
function marcarResenasPrevias() {
  const est = hoja(H.ESTADO);
  if (est.getRange(1, 14).getValue() !== 'ENTREGADO_EL') est.getRange(1, 14, 1, 2).setValues([['ENTREGADO_EL', 'AVISO_RESENA']]).setFontWeight('bold');
  const nE = est.getLastRow() - 1;
  if (nE < 1) return 'Marcadas: 0';
  const rango = est.getRange(2, 1, nE, 15);
  const v = rango.getValues();
  let marcadas = 0;
  v.forEach(function (e) {
    if (e[2] === 'entregado' && !str(e[14])) { e[14] = 'previo'; marcadas++; }
  });
  rango.setNumberFormats(v.map(function () { return FORMATO_ESTADO.slice(0, 15); }));
  rango.setValues(v);
  return 'Marcadas como previas: ' + marcadas;
}

/* ---------- Aviso de envío al cliente ---------- */
function avisoPermitido(sr) {
  if (TAREA.AVISO_ENVIO === 'todos') return true;
  if (TAREA.AVISO_ENVIO === 'prueba') return TAREA.AVISO_PRUEBA.indexOf(sr) >= 0;
  return false;
}

/** Enlace al localizador oficial de Correos con el número ya puesto. */
function urlSeguimiento(servicio, tracking) {
  if (/correos/i.test(servicio)) {
    return 'https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=' + encodeURIComponent(tracking);
  }
  return '';
}

/** Productos del pedido web desde ITEMS_JSON: "2 × Trench Las Rifle". */
function productosWeb(itemsJson) {
  let items = [];
  try { items = JSON.parse(itemsJson || '[]'); } catch (err) { return ''; }
  const cuenta = {}, orden = [];
  items.forEach(function (u) {
    const n = str(u.nombre);
    if (!n) return;
    if (!cuenta[n]) { cuenta[n] = 0; orden.push(n); }
    cuenta[n]++;
  });
  return orden.map(function (n) { return (cuenta[n] > 1 ? cuenta[n] + ' × ' : '') + n; }).join(', ');
}

/** Devuelve true si se ha enviado; false si falta el email. */
function correoEnvio(a, ctx) {
  const r = a.r, id = str(a.e[0]);
  const dc = datosCliente(a, ctx);
  const nombre = dc.nombre, L = dc.L, productos = dc.productos;
  const email = String(dc.email || '').toLowerCase();
  if (!RE_EMAIL.test(email)) return false;

  const d = ficheroPages('i18n/' + L + '.json');
  const t = function (k, v) { return tr(d, k, v); };
  const servicio = MAPA_SERVICIO_WEB[str(r.SERVICIO_ENVIO)] || str(r.SERVICIO_ENVIO);
  const tracking = str(r.TRACKING);
  const urlT = urlSeguimiento(servicio, tracking);
  const urlP = AJUSTES.PAGES_BASE + 'pedido.html?id=' + encodeURIComponent(id);
  const saludo = nombre ? t('mail.saludo', { nombre: nombre.split(' ')[0] }) : t('mail.env_saludo');
  const datos = [[t('conf.id_label'), id]];
  if (productos) datos.push([t('mail.env_productos'), productos]);
  if (servicio) datos.push([t('mail.env_servicio'), servicio]);
  datos.push([t('mail.env_tracking'), tracking]);

  const texto = [saludo, '', t('mail.env_intro'), '']
    .concat(datos.map(function (x) { return x[0] + ': ' + x[1]; }))
    .concat(urlT ? ['', t('mail.env_boton_tracking', { servicio: servicio }) + ': ' + urlT, t('mail.env_nota')] : [])
    .concat(['', t('mail.env_pedido') + ': ' + urlP, '', t('mail.dudas'), '', t('mail.firma')]).join('\n');

  const boton = function (url, txt, color) {
    return '<p style="text-align:center;margin:20px 0"><a href="' + esc(url) + '" style="background:' + color +
      ';color:#ffffff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">' + esc(txt) + '</a></p>';
  };
  const html =
    '<div style="background:#f4f0e8;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1a150c">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">' +
    '<div style="background:#0B0800;padding:18px 24px;color:#A77F41;font-size:20px;font-weight:bold;letter-spacing:2px">SOY RESINATOR</div>' +
    '<div style="padding:24px">' +
    '<p>' + esc(saludo) + '</p><p>' + esc(t('mail.env_intro')) + '</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:15px;margin:16px 0">' +
    datos.map(function (x) {
      return '<tr><th scope="row" style="text-align:left;padding:8px 12px 8px 0;border-bottom:1px solid #e4dccd;color:#6b655c;font-weight:normal;white-space:nowrap;vertical-align:top">' +
        esc(x[0]) + '</th><td style="padding:8px 0;border-bottom:1px solid #e4dccd;font-weight:bold">' + esc(x[1]) + '</td></tr>';
    }).join('') + '</table>' +
    (urlT ? boton(urlT, t('mail.env_boton_tracking', { servicio: servicio }), '#7A5A26') +
      '<p style="color:#6b655c;font-size:13px">' + esc(t('mail.env_nota')) + '</p>' : '') +
    boton(urlP, t('mail.env_pedido'), '#3d3528') +
    '<p>' + esc(t('mail.dudas')) + '</p><p>' + firmaHtml(t('mail.firma')) + '</p>' +
    '</div></div></div>';

  MailApp.sendEmail({
    to: email,
    replyTo: AJUSTES.EMAIL_TIENDA,
    name: AJUSTES.NOMBRE_REMITENTE,
    subject: t('mail.env_asunto', { id: id }),
    body: texto,
    htmlBody: html
  });
  return true;
}

/* ---------- Una sola vez, antes de poner AVISO_ENVIO: 'todos' ----------
 * Marca como "previo" los pedidos que ya están Enviados o Entregados en RES · Pedidos,
 * para que la tarea no les mande ahora un aviso atrasado. No envía nada. Se puede repetir.
 */
function marcarAvisosPrevios() {
  const res = SpreadsheetApp.openById(TAREA.ID_PEDIDOS);
  const est = hoja(H.ESTADO);
  if (est.getRange(1, 13).getValue() !== 'AVISO_ENVIO') est.getRange(1, 13).setValue('AVISO_ENVIO').setFontWeight('bold');
  const nE = est.getLastRow() - 1;
  if (nE < 1) return 'Marcados: 0';
  const web = hoja(H.PEDIDOS);
  const nW = web.getLastRow() - 1;
  const resDeWeb = {};
  if (nW > 0) web.getRange(2, 1, nW, 23).getValues().forEach(function (w) { if (str(w[22])) resDeWeb[str(w[0])] = str(w[22]); });
  const estadoRes = {};
  tabla(res.getSheetByName('PEDIDOS')).filas.forEach(function (r) { estadoRes[str(r.ID_PEDIDO)] = str(r.ESTADO).toLowerCase(); });

  const rango = est.getRange(2, 1, nE, 13);
  const v = rango.getValues();
  let marcados = 0;
  v.forEach(function (e) {
    if (str(e[12])) return;
    const resId = resDeWeb[str(e[0])] || str(e[11]);
    const estado = estadoRes[resId] || '';
    if (estado === 'enviado' || estado === 'entregado') { e[12] = 'previo'; marcados++; }
  });
  rango.setNumberFormats(v.map(function () { return FORMATO_ESTADO.slice(0, 13); }));
  rango.setValues(v);
  return 'Marcados como previos: ' + marcados;
}

/* ---------- 4. CONFIG ---------- */
function escribirCola(horas, ahora) {
  hoja(H.CONFIG).getRange(2, 1).setValue(horas);
  hoja(H.CONFIG).getRange(2, 4).setValue(ahora.toISOString());
  return 'Cola: ' + horas + ' h';
}

/* ---------- Una sola vez: códigos SR para los pedidos del formulario antiguo ----------
 * Ejecútala a mano desde el editor (Ejecutar > asignarSRFormulario). Para cada pedido de RES · Pedidos que
 * siga en curso (ni Enviado, ni Entregado, ni Cancelado) y que no tenga ya un SR-:
 *   · crea su fila en ESTADO_WEB con un SR- nuevo, el email del cliente (cifrado) y su RES-… en la columna L;
 *   · apunta nombre, email, SR y RES en la pestaña AVISOS_SR, para mandarles el correo con su código.
 * No toca RES · Pedidos ni PEDIDOS_WEB (así la app no importa nada dos veces). Se puede repetir: no duplica.
 */
function asignarSRFormulario() {
  const res = SpreadsheetApp.openById(TAREA.ID_PEDIDOS);
  const est = hoja(H.ESTADO);
  if (est.getRange(1, 12).getValue() !== 'ID_PEDIDO') est.getRange(1, 12).setValue('ID_PEDIDO').setFontWeight('bold');

  const ya = {};
  const nE = est.getLastRow() - 1;
  if (nE > 0) est.getRange(2, 1, nE, 12).getValues().forEach(function (e) { if (str(e[11])) ya[str(e[11])] = true; });
  const web = hoja(H.PEDIDOS);
  const nW = web.getLastRow() - 1;
  if (nW > 0) web.getRange(2, 23, nW, 1).getValues().forEach(function (w) { if (str(w[0])) ya[str(w[0])] = true; });

  const clientes = {};
  tabla(res.getSheetByName('CLIENTES')).filas.forEach(function (c) { clientes[str(c.ID_CLIENTE)] = c; });

  const avisos = [];
  const ahora = new Date().toISOString();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    tabla(res.getSheetByName('PEDIDOS')).filas.forEach(function (r) {
      const idRes = str(r.ID_PEDIDO);
      const estado = MAPA_ESTADO[str(r.ESTADO).toLowerCase()];
      if (!idRes || ya[idRes] || /^SR-/.test(str(r.ID_FORM))) return;
      if (estado === 'enviado' || estado === 'entregado' || estado === 'cancelado') return;
      const cli = clientes[str(r.ID_CLIENTE)] || {};
      // Email: el de CLIENTES; si falta, el que guarda CLAVE_FORM ("fecha|email|…").
      const email = (str(cli.EMAIL) || str(String(r.CLAVE_FORM || '').split('|')[1])).toLowerCase();
      if (!RE_EMAIL.test(email)) { avisos.push([str(r.CLIENTE), '', '', idRes, 'SIN EMAIL: no se ha creado']); return; }
      const sr = nuevoId();
      escribirFila(est, [sr, hashEmail(email), 'recibido', '', '', 'pendiente', 'formulario', '', '', '', ahora, idRes, '', '', '', ''],
        FORMATO_ESTADO);
      avisos.push([str(r.CLIENTE) || str(cli.NOMBRE), email, sr, idRes, str(r.PRODUCTOS)]);
      ya[idRes] = true;
    });
  } finally {
    lock.releaseLock();
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('AVISOS_SR') || ss.insertSheet('AVISOS_SR');
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, 5).setValues([['NOMBRE', 'EMAIL', 'ID_SR', 'ID_PEDIDO', 'PRODUCTOS']]).setFontWeight('bold');
  if (avisos.length) {
    const r = sh.getRange(sh.getLastRow() + 1, 1, avisos.length, 5);
    r.setNumberFormat('@');
    r.setValues(avisos);
  }
  tareaHoraria(); // rellena ya el estado, el pago y las placas de los nuevos
  return 'Códigos SR creados: ' + avisos.filter(function (a) { return a[2]; }).length + ' (lista en la pestaña AVISOS_SR)';
}

/* ---------- Una sola vez: clientes antiguos para el correo de reseña ----------
 * Ejecútala a mano desde el editor (Ejecutar > importarClientesAntiguos). Para cada cliente de RES · Pedidos que aún
 * no tiene ningún pedido en ESTADO_WEB:
 *   · elige su último pedido Enviado o Entregado y Pagado (si tiene varios, el último con un producto de la web);
 *   · le crea una fila en ESTADO_WEB con un SR- nuevo, su RES-… en la columna L y AVISO_ENVIO = "previo".
 * No manda nada: el correo de reseña lo manda la tarea cuando AVISO_RESENA = 'todos' (tras la entrega supuesta).
 * Deja fuera cancelados, regalos, pedidos de PRUEBA, CLIENTES_PRUEBA y clientes sin email.
 * No toca RES · Pedidos ni PEDIDOS_WEB. Se puede repetir: no duplica.
 */
function importarClientesAntiguos() {
  const res = SpreadsheetApp.openById(TAREA.ID_PEDIDOS);
  const cat = ficheroPages('data/catalog.json');
  const est = hoja(H.ESTADO);
  const pedidos = tabla(res.getSheetByName('PEDIDOS')).filas;
  const lineas = tabla(res.getSheetByName('LINEAS')).filas;
  const clientes = {};
  tabla(res.getSheetByName('CLIENTES')).filas.forEach(function (c) { clientes[str(c.ID_CLIENTE)] = c; });

  // Pedidos que ya están en la web (L de ESTADO_WEB o W de PEDIDOS_WEB) y, con ellos, sus clientes.
  const yaRes = {};
  const nE = est.getLastRow() - 1;
  if (nE > 0) est.getRange(2, 12, nE, 1).getValues().forEach(function (e) { if (str(e[0])) yaRes[str(e[0])] = true; });
  const web = hoja(H.PEDIDOS);
  const nW = web.getLastRow() - 1;
  if (nW > 0) web.getRange(2, 23, nW, 1).getValues().forEach(function (w) { if (str(w[0])) yaRes[str(w[0])] = true; });
  const yaCli = {};
  pedidos.forEach(function (r) { if (yaRes[str(r.ID_PEDIDO)]) yaCli[str(r.ID_CLIENTE)] = true; });

  const elegido = {}, orden = [];
  pedidos.forEach(function (r) {
    const cli = str(r.ID_CLIENTE), estado = MAPA_ESTADO[str(r.ESTADO).toLowerCase()];
    if (!cli || yaCli[cli] || TAREA.CLIENTES_PRUEBA.indexOf(cli) >= 0 || esPrueba(r)) return;
    if ((estado !== 'enviado' && estado !== 'entregado') || str(r.PAGO).toLowerCase() !== 'pagado') return;
    const deWeb = productosRes(lineas, str(r.ID_PEDIDO), cat).some(function (p) { return p.pid; });
    const ant = elegido[cli];
    if (!ant) orden.push(cli);
    // El último pedido, salvo que el anterior tenga un producto de la web y este no.
    if (!ant || deWeb || !ant.deWeb) elegido[cli] = { r: r, deWeb: deWeb };
  });

  let creados = 0, sinEmail = 0;
  const ahora = new Date().toISOString();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    orden.forEach(function (cli) {
      const r = elegido[cli].r;
      const c = clientes[cli] || {};
      const email = (str(c.EMAIL) || str(String(r.CLAVE_FORM || '').split('|')[1])).toLowerCase();
      if (!RE_EMAIL.test(email)) { sinEmail++; return; }
      escribirFila(est, [nuevoId(), hashEmail(email), 'enviado', '', '', 'pagado', 'formulario', '', '', str(r.TRACKING), ahora,
        str(r.ID_PEDIDO), 'previo', '', '', ''], FORMATO_ESTADO);
      creados++;
    });
  } finally {
    lock.releaseLock();
  }
  tareaHoraria(); // aplica ya la entrega supuesta (y, si AVISO_RESENA = 'todos', pide las reseñas que toquen)
  return 'Clientes antiguos importados: ' + creados + (sinEmail ? ' (' + sinEmail + ' sin email)' : ''); // sin direcciones
}

/* ---------- utilidades de la tarea ---------- */
function fechaHoja(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const m = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12) : null;
}

function tabla(sh) {
  const v = sh.getDataRange().getValues();
  const enc = (v[0] || []).map(function (h) { return str(h); });
  const filas = v.slice(1).filter(function (r) { return r.some(function (c) { return c !== '' && c !== null; }); })
    .map(function (r) { const o = {}; enc.forEach(function (h, i) { if (h) o[h] = r[i]; }); return o; });
  return { enc: enc, filas: filas };
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
