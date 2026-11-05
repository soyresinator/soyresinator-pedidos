// Soy Resinator · cálculos del pedido.
// El Apps Script repite exactamente estas reglas en el servidor: si cambias algo aquí, cámbialo también en Code.gs.

/**
 * Extras elegidos de una unidad, como lista: [{ tipo, id_replica, cantidad, pvp, importe, horas, bandejas }].
 * `it.extras` es { tipo: cantidad }. Lo que no está en el catálogo del producto o es 0 no cuenta.
 */
export function extrasDe(it, prod, cat) {
  const elegidos = (it && it.extras) || {};
  const out = [];
  for (const ex of prod.extras || []) {
    const def = (cat.extras_def || {})[ex.tipo] || {};
    const n = Math.min(Math.max(Math.floor(Number(elegidos[ex.tipo]) || 0), 0), def.max || 0);
    if (!n) continue;
    // Las balas se imprimen en bandejas de `por_bandeja`: `horas` es por bandeja.
    const bandejas = def.por_bandeja ? Math.ceil(n / def.por_bandeja) : n;
    out.push({ tipo: ex.tipo, id_replica: ex.id_replica, cantidad: n, pvp: ex.pvp, importe: n * ex.pvp,
      horas: bandejas * ex.horas, bandejas });
  }
  return out;
}

/**
 * Cajas de envío. Cada réplica ocupa `volumen`; se llenan cajas de hasta volumen_caja_5kg,
 * de la más grande a la más pequeña (primera caja donde quepa).
 * Una caja con un solo artículo paga precio_1; con más, precio_4kg si su volumen no pasa de
 * volumen_caja_4kg y precio_5kg si pasa. Los extras no suman volumen.
 * Devuelve [{ tipo: '1' | '4kg' | '5kg', volumen, n }].
 */
export function cajasEnvio(items, cat, ship) {
  const max5 = ship.volumen_caja_5kg;
  const vols = [];
  for (const it of items) {
    const p = cat.productos.find(x => x.id === it.pid);
    if (p) vols.push(Number(p.volumen) || 0);
  }
  vols.sort((a, b) => b - a);
  const cajas = [];
  for (const v of vols) {
    const c = cajas.find(x => x.volumen + v <= max5 + 1e-9);
    if (c) { c.volumen += v; c.n++; } else cajas.push({ volumen: v, n: 1 });
  }
  return cajas.map(c => ({ ...c, tipo: c.n === 1 ? '1' : (c.volumen <= ship.volumen_caja_4kg + 1e-9 ? '4kg' : '5kg') }));
}

export function precioCaja(caja, pais) {
  return caja.tipo === '1' ? pais.precio_1 : (caja.tipo === '4kg' ? pais.precio_4kg : pais.precio_5kg);
}

/** Totales del pedido. `pais` es la fila de shipping.json o null si aún no se ha elegido. */
export function totales(items, cat, pais, ship) {
  let subtotal = 0;
  let extras = 0;
  let horas = 0;
  for (const it of items) {
    const p = cat.productos.find(x => x.id === it.pid);
    if (!p) continue;
    subtotal += p.pvp;
    horas += p.horas;
    for (const e of extrasDe(it, p, cat)) { extras += e.importe; horas += e.horas; }
  }
  const montajeUds = pais && pais.montaje ? items.filter(i => i.montaje).length : 0;
  const montaje = montajeUds * cat.montaje_pvp;
  const lista = cajasEnvio(items, cat, ship);
  // Países sin tarifa (envio_a_consultar): no damos precio y el total va sin envío.
  const consultar = !!(pais && pais.envio_a_consultar);
  const envio = pais && !consultar ? lista.reduce((s, c) => s + precioCaja(c, pais), 0) : null;
  const total = subtotal + extras + montaje + (envio || 0);
  return { subtotal, extras, montajeUds, montaje, cajas: lista.length, listaCajas: lista, envio, consultar, total, horas };
}

/**
 * Días hasta el envío, contados desde el pago:
 * máx(21, ⌈(HORAS_COLA + horas del pedido × 1,08) / HORAS_DIA⌉ + DIAS_PREPARACION).
 * Devuelve null si no hay datos de la cola (entonces se muestra "unas 3 semanas").
 */
export function plazoDias(horasPedido, remote, cfg) {
  if (!remote || !remote.ok) return null;
  const p = cfg.plazo;
  if (remote.horas_cola === null || remote.horas_cola === undefined || remote.horas_cola === '') return null;
  const cola = Number(remote.horas_cola);
  if (!Number.isFinite(cola)) return null;
  const hd = Number(remote.horas_dia) > 0 ? Number(remote.horas_dia) : p.horas_dia_defecto;
  const prepN = Number(remote.dias_preparacion);
  const prep = Number.isFinite(prepN) ? prepN : p.dias_preparacion_defecto;
  return Math.max(p.dias_minimo, Math.ceil((cola + horasPedido * p.factor_horas) / hd) + prep);
}
