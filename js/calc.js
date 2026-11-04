// Soy Resinator · cálculos del pedido.
// El Apps Script repite exactamente estas reglas en el servidor: si cambias algo aquí, cámbialo también en Code.gs.

/** cajas = máx(nº de réplicas largas, ⌈nº de pistolas / 2⌉) */
export function contarCajas(items, cat) {
  let largas = 0;
  let pistolas = 0;
  for (const it of items) {
    const p = cat.productos.find(x => x.id === it.pid);
    if (!p) continue;
    if (p.caja === 'pistola') pistolas++;
    else largas++;
  }
  return Math.max(largas, Math.ceil(pistolas / 2));
}

/** Totales del pedido. `pais` es la fila de shipping.json o null si aún no se ha elegido. */
export function totales(items, cat, pais) {
  let subtotal = 0;
  let horas = 0;
  for (const it of items) {
    const p = cat.productos.find(x => x.id === it.pid);
    if (!p) continue;
    subtotal += p.pvp;
    horas += p.horas;
  }
  const montajeUds = pais && pais.montaje ? items.filter(i => i.montaje).length : 0;
  const montaje = montajeUds * cat.montaje_pvp;
  const cajas = contarCajas(items, cat);
  const envio = pais ? cajas * pais.por_caja : null;
  const total = subtotal + montaje + (envio || 0);
  return { subtotal, montajeUds, montaje, cajas, envio, total, horas };
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
