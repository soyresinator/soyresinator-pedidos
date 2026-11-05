// Soy Resinator · vista de pedido (#pedido en index.html)
// Tarjeta por unidad, datos y envío, pago, resumen, envío al Apps Script y confirmación.
import * as C from './core.js?v=20261105';
import { totales, plazoDias, extrasDe } from './calc.js?v=20261105';

const $ = id => document.getElementById(id);
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_ID = /^SR-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

let S = null;              // estado compartido con catalogo.js
let prefijoTocado = false; // si el cliente escribe su prefijo, ya no lo cambiamos al cambiar de país
let enviando = false;
let notaTimer = null;
let picker = null;         // buscador de país del formulario

/* =================== Arranque y navegación =================== */

export function initPedido(state) {
  S = state;
  picker = C.countryPicker($('f-pais'), S.ship.paises, () => C.loadCart().pais, code => { clearErr($('f-pais')); setPais(code); });
  wire();
  paintLegalLabels();
  window.addEventListener('hashchange', route);
  document.addEventListener('sr:lang', () => {
    picker.paint();
    paintLegalLabels();
    if (!$('pedido').hidden && !$('ped-main').hidden) refresh();
  });
  route();
}

/** catalogo.js lo llama cuando llegan los colores y la cola del Apps Script. */
export function onRemote() {
  if (!$('pedido').hidden && !$('ped-main').hidden) refresh();
}

function route() {
  const enPedido = location.hash === '#pedido';
  document.querySelectorAll('[data-view="catalogo"]').forEach(el => { el.hidden = enPedido; });
  $('pedido').hidden = !enPedido;
  if (enPedido) {
    $('confirmacion').hidden = true;
    $('ped-main').hidden = false;
    refresh();
    window.scrollTo(0, 0);
    $('pedido-titulo').focus({ preventScroll: true });
  } else if (location.hash) {
    // El destino estaba oculto cuando cambió el hash: desplazamos ahora.
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  }
  document.dispatchEvent(new CustomEvent('sr:view'));
}

function refresh() {
  validarCarrito();
  renderItems();
  renderPago();
  renderResumen();
  $('ped-cerrado').hidden = S.abiertos;
  $('btn-enviar').disabled = !S.abiertos;
}

/* =================== Datos auxiliares =================== */

const prodDe = pid => S.cat.productos.find(p => p.id === pid);
const paisDe = code => S.ship.paises.find(p => p.code === code) || null;
const paisActual = () => paisDe(C.loadCart().pais);

/** Colores para una parte de una unidad: los disponibles y, si el script no responde, también el ya guardado. */
function coloresDe(part, it) {
  const list = C.coloresParaParte(part, S.remote, S.serie, S.cfg.stock_minimo_g);
  const cur = it.colores[part.grupo];
  if (!S.remote.ok && cur && !list.some(c => c.id === cur) && it.snap && it.snap[part.grupo]) {
    list.push({ id: cur, ...it.snap[part.grupo], de_serie: false });
  }
  return list;
}

function colorElegido(part, it) {
  const list = coloresDe(part, it);
  return list.find(c => c.id === it.colores[part.grupo]) || list[0];
}

function chosenText(c) {
  return C.t('ped.elegido', { color: C.colorName(c) }) + (c.de_serie ? ' · ' + C.t('cat.de_serie') : '');
}

/* =================== Validación del carrito guardado =================== */

/**
 * Al volver a la página: quita productos que ya no existen, pone el color de serie
 * donde el color guardado ya no está disponible y quita el montaje fuera de España.
 */
function validarCarrito() {
  const cart = C.loadCart();
  const avisos = [];
  let cambiado = false;

  const antes = cart.items.length;
  cart.items = cart.items.filter(it => it && prodDe(it.pid));
  if (cart.items.length !== antes) { cambiado = true; avisos.push(C.esc(C.t('ped.producto_retirado'))); }

  const pais = paisDe(cart.pais);
  const cambiados = [];
  for (const it of cart.items) {
    const prod = prodDe(it.pid);
    if (!it.uid) { it.uid = C.uid(); cambiado = true; }
    if (!it.colores || typeof it.colores !== 'object') { it.colores = {}; cambiado = true; }
    if (typeof it.nota !== 'string') { it.nota = ''; cambiado = true; }
    if (it.nota.length > S.cfg.nota_max) { it.nota = it.nota.slice(0, S.cfg.nota_max); cambiado = true; }
    // Extras: solo los que tiene el producto, enteros y dentro del máximo.
    if (!it.extras || typeof it.extras !== 'object') { it.extras = {}; cambiado = true; }
    const validos = {};
    extrasDe(it, prod, S.cat).forEach(e => { validos[e.tipo] = e.cantidad; });
    if (JSON.stringify(validos) !== JSON.stringify(it.extras)) { it.extras = validos; cambiado = true; }
    const grupos = prod.partes.map(p => p.grupo);
    Object.keys(it.colores).forEach(g => { if (!grupos.includes(g)) { delete it.colores[g]; cambiado = true; } });
    for (const part of prod.partes) {
      const cur = it.colores[part.grupo];
      if (!cur) { it.colores[part.grupo] = part.de_serie; cambiado = true; continue; }
      // Solo podemos saber si se ha agotado cuando tenemos los datos de COLORES.
      if (S.remote.ok) {
        const list = C.coloresParaParte(part, S.remote, S.serie, S.cfg.stock_minimo_g);
        if (!list.some(c => c.id === cur)) {
          it.colores[part.grupo] = part.de_serie;
          if (it.snap) delete it.snap[part.grupo];
          cambiados.push(`${prod.nombre} · ${C.t(part.etiqueta)}`);
          cambiado = true;
        }
      }
    }
    if (it.montaje && !(pais && pais.montaje)) { it.montaje = false; cambiado = true; }
  }
  if (cambiados.length) avisos.push(C.esc(C.t('ped.colores_cambiados', { lista: cambiados.join(', ') })));
  if (cambiado) C.saveCart(cart);

  const box = $('ped-avisos');
  if (avisos.length) {
    box.innerHTML = avisos.map(a => `<p>${a}</p>`).join('');
    box.hidden = false;
  } else if (!cambiado) {
    // Dejamos visible un aviso anterior hasta que el cliente cambie algo.
  }
}

/* =================== Tarjetas por unidad =================== */

function renderItems() {
  const cart = C.loadCart();
  const box = $('items');
  if (!cart.items.length) {
    box.innerHTML = `
      <div class="empty">
        <p>${C.esc(C.t('ped.vacio'))}</p>
        <a class="btn btn-primary" href="#catalogo">${C.esc(C.t('ped.seguir'))}</a>
      </div>`;
    $('ped-form').hidden = true;
    return;
  }
  $('ped-form').hidden = false;
  const pais = paisDe(cart.pais);
  box.innerHTML = cart.items.map((it, i) => itemCard(it, i, pais)).join('');
}

function itemCard(it, i, pais) {
  const prod = prodDe(it.pid);
  const n = i + 1;
  const max = S.cfg.nota_max;

  const partes = prod.partes.map(part => {
    const list = coloresDe(part, it);
    const sel = colorElegido(part, it);
    const name = `c-${it.uid}-${part.grupo}`;
    const sw = list.map(c => {
      const nm = C.colorName(c);
      const sr = nm + (c.de_serie ? ` (${C.t('cat.de_serie')})` : '');
      return `
        <label class="sw" title="${C.esc(nm)}">
          <input type="radio" name="${name}" value="${C.esc(c.id)}" data-uid="${it.uid}" data-grupo="${part.grupo}" ${c.id === sel.id ? 'checked' : ''}>
          <span class="sw-dot" style="background:${C.esc(c.hex)}" aria-hidden="true"></span>
          <span class="sr-only">${C.esc(sr)}</span>
          ${c.de_serie ? `<span class="sw-tag" aria-hidden="true">${C.esc(C.t('cat.de_serie'))}</span>` : ''}
        </label>`;
    }).join('');
    return `
      <fieldset class="part">
        <legend>${C.esc(C.t(part.etiqueta))}</legend>
        <div class="swatches">${sw}</div>
        <p class="chosen" id="ch-${it.uid}-${part.grupo}" aria-live="polite">${C.esc(chosenText(sel))}</p>
      </fieldset>`;
  }).join('');

  const offline = !S.remote.ok && prod.partes.length
    ? `<p class="help">${C.esc(C.t('colores.nota_offline'))}</p>` : '';

  const montaje = pais && pais.montaje ? `
      <label class="check">
        <input type="checkbox" class="montaje" data-uid="${it.uid}" ${it.montaje ? 'checked' : ''} aria-describedby="mh-${it.uid}">
        <span>${C.esc(C.t('ped.montaje', { precio: C.money(S.cat.montaje_pvp) }))}</span>
      </label>
      <p class="help" id="mh-${it.uid}">${C.esc(C.t('ped.montaje_ayuda'))}</p>` : '';

  return `
    <article class="unit" data-uid="${it.uid}">
      <div class="unit-head">
        <img class="unit-thumb" src="img/${C.esc(prod.id)}-1.webp" alt="" width="160" height="90" loading="lazy" decoding="async" onerror="this.remove()">
        <h3 class="unit-title" id="u-${it.uid}" tabindex="-1">${n}. ${C.esc(prod.nombre)}</h3>
        <span class="price">${C.esc(C.money(prod.pvp))}</span>
      </div>
      ${partes || `<p class="colors-line">${C.esc(C.t('cat.colores_serie'))}</p>`}
      ${offline}
      ${extrasHtml(it, prod)}
      <div class="field">
        <label for="n-${it.uid}">${C.esc(C.t('ped.notas'))}</label>
        <textarea id="n-${it.uid}" class="nota" data-uid="${it.uid}" rows="2" maxlength="${max}" aria-describedby="nc-${it.uid}">${C.esc(it.nota)}</textarea>
        <p class="help" id="nc-${it.uid}">${C.esc(C.t('ped.caracteres', { n: max - it.nota.length }))}</p>
      </div>
      ${montaje}
      <div class="btn-row">
        <button type="button" class="btn btn-ghost btn-sm" data-act="dup" data-uid="${it.uid}" aria-label="${C.esc(C.t('ped.duplicar_aria', { n, nombre: prod.nombre }))}">${C.esc(C.t('ped.duplicar'))}</button>
        <button type="button" class="btn btn-ghost btn-sm btn-danger" data-act="del" data-uid="${it.uid}" aria-label="${C.esc(C.t('ped.quitar_aria', { n, nombre: prod.nombre }))}">${C.esc(C.t('ped.quitar'))}</button>
      </div>
    </article>`;
}

/** Bloque "Extras" de una unidad: un contador (− n +) por cada extra que admite el producto. */
function extrasHtml(it, prod) {
  if (!(prod.extras || []).length) return '';
  const filas = prod.extras.map(ex => {
    const def = S.cat.extras_def[ex.tipo] || {};
    const n = Number((it.extras || {})[ex.tipo]) || 0;
    const nombre = C.t(def.etiqueta);
    const id = `x-${it.uid}-${ex.tipo}`;
    return `
      <div class="extra-row">
        <span class="extra-name" id="${id}-l">${C.esc(nombre)} <span class="extra-price">${C.esc(C.t('extra.precio_ud', { precio: C.money(ex.pvp) }))}</span></span>
        <span class="stepper" role="group" aria-labelledby="${id}-l">
          <button type="button" class="step" data-act="extra" data-uid="${it.uid}" data-tipo="${ex.tipo}" data-d="-1" ${n <= 0 ? 'disabled' : ''} aria-label="${C.esc(C.t('extra.menos', { nombre }))}">−</button>
          <output id="${id}" class="step-n" aria-live="polite">${n}</output>
          <button type="button" class="step" data-act="extra" data-uid="${it.uid}" data-tipo="${ex.tipo}" data-d="1" ${n >= (def.max || 0) ? 'disabled' : ''} aria-label="${C.esc(C.t('extra.mas', { nombre }))}">+</button>
        </span>
      </div>`;
  }).join('');
  return `
      <fieldset class="part extras">
        <legend>${C.esc(C.t('extra.titulo'))}</legend>
        ${filas}
      </fieldset>`;
}

/** Guarda en el carrito las notas que aún estén pendientes del temporizador. */
function flushNotas() {
  clearTimeout(notaTimer);
  const cart = C.loadCart();
  let cambiado = false;
  document.querySelectorAll('#items textarea.nota').forEach(ta => {
    const it = cart.items.find(i => i.uid === ta.dataset.uid);
    const v = ta.value.slice(0, S.cfg.nota_max);
    if (it && it.nota !== v) { it.nota = v; cambiado = true; }
  });
  if (cambiado) C.saveCart(cart);
}

/* =================== País, pago y resumen =================== */

/** Único punto donde cambia el país (catálogo o formulario). */
export function setPais(code) {
  const cart = C.loadCart();
  const pais = paisDe(code);
  cart.pais = pais ? code : '';
  let quitado = false;
  if (!pais || !pais.montaje) {
    cart.items.forEach(it => { if (it.montaje) { it.montaje = false; quitado = true; } });
  }
  C.saveCart(cart);
  if (quitado) C.toast(C.t('ped.montaje_quitado'));
  if (pais && !prefijoTocado) $('f-prefijo').value = pais.prefijo;
  if (picker) picker.paint();
  document.dispatchEvent(new CustomEvent('sr:pais'));
  if (!$('pedido').hidden && !$('ped-main').hidden) {
    renderItems();
    renderPago();
    renderResumen();
  }
}

function renderPago() {
  const cart = C.loadCart();
  const pais = paisDe(cart.pais);
  if (document.activeElement !== $('f-pais')) picker.paint();
  if (pais && !prefijoTocado && !$('f-prefijo').value) $('f-prefijo').value = pais.prefijo;
  const modo = cart.modo === 'dos_partes' ? 'dos_partes' : 'completo';
  document.querySelectorAll('input[name="modo"]').forEach(r => { r.checked = r.value === modo; });
  $('pago-metodo').textContent = !pais ? C.t('pago.metodo_sin_pais')
    : (pais.ue ? C.t('pago.metodo_transfer') : C.t('pago.metodo_paypal'));
}

function paintLegalLabels() {
  $('l-condiciones').innerHTML = C.tHtml('res.acepto_condiciones', {
    enlace: `<a href="condiciones.html" target="_blank" rel="noopener">${C.esc(C.t('res.enlace_condiciones'))}</a>`
  });
  $('l-privacidad').innerHTML = C.tHtml('res.acepto_privacidad', {
    enlace: `<a href="privacidad.html" target="_blank" rel="noopener">${C.esc(C.t('res.enlace_privacidad'))}</a>`
  });
}

function textoColores(it, prod) {
  if (!prod.partes.length) return C.t('cat.colores_serie');
  return prod.partes.map(part => `${C.t(part.etiqueta)}: ${C.colorName(colorElegido(part, it))}`).join(' · ');
}

function plazoTexto(horas) {
  const n = plazoDias(horas, S.remote, S.cfg);
  if (n === null) return C.t('res.plazo_defecto');
  const fecha = new Date(Date.now() + n * 86400000)
    .toLocaleDateString(C.locale(), { day: 'numeric', month: 'long' });
  return C.t('res.plazo', { n, fecha }) + ' ' + C.t('res.plazo_fijo');
}

/** Texto de un extra: "Cargador extra × 2". */
function textoExtra(e) {
  return C.t('extra.linea', { nombre: C.t(S.cat.extras_def[e.tipo].etiqueta), n: e.cantidad });
}

/** "InPost · 1 caja grande (5 kg) + 1 caja": cuántas cajas de cada tipo. */
function textoCajas(tot, pais) {
  const cuenta = { '1': 0, '4kg': 0, '5kg': 0 };
  tot.listaCajas.forEach(c => { cuenta[c.tipo]++; });
  const partes = [];
  if (cuenta['5kg']) partes.push(C.t('res.caja_5kg', { n: cuenta['5kg'] }));
  if (cuenta['4kg']) partes.push(C.t('res.caja_4kg', { n: cuenta['4kg'] }));
  if (cuenta['1']) partes.push(C.t('res.caja_1', { n: cuenta['1'] }));
  return C.t('res.envio_detalle', { servicio: pais.servicio, cajas: partes.join(' + ') });
}

function resumenHtml(cart) {
  const pais = paisDe(cart.pais);
  const tot = totales(cart.items, S.cat, pais, S.ship);
  const row = (a, b, det, cls = '') => `
    <div class="sum-row${cls ? ' ' + cls : ''}">
      <div><span>${C.esc(a)}</span>${det ? `<span class="sum-det">${C.esc(det)}</span>` : ''}</div>
      <span class="sum-val">${C.esc(b)}</span>
    </div>`;

  const rows = [];
  cart.items.forEach((it, i) => {
    const p = prodDe(it.pid);
    const det = textoColores(it, p) + (it.montaje && pais && pais.montaje ? ' · ' + C.t('res.montaje') : '');
    rows.push(row(`${i + 1}. ${p.nombre}`, C.money(p.pvp), det));
    extrasDe(it, p, S.cat).forEach(e => rows.push(row('+ ' + textoExtra(e), C.money(e.importe), '', 'sum-extra')));
  });
  if (tot.montajeUds) {
    rows.push(row(C.t('res.montaje'), C.money(tot.montaje),
      C.t('res.montaje_detalle', { n: tot.montajeUds, precio: C.money(S.cat.montaje_pvp) })));
  }
  rows.push(pais
    ? row(C.t('res.envio_aprox'), C.money(tot.envio), textoCajas(tot, pais) + ' · ' + C.t('res.envio_nota'))
    : row(C.t('res.envio'), '…', C.t('res.envio_pendiente')));

  const modo = cart.modo === 'dos_partes' ? 'dos_partes' : 'completo';
  const tax = pais ? (pais.ue ? C.t('precio.ue') : C.t('precio.fuera_ue')) : '';
  let pago = `${C.t('res.pago')}: ${C.t(modo === 'dos_partes' ? 'pago.dos_partes' : 'pago.completo')}`;
  if (modo === 'dos_partes') {
    const a = Math.ceil(tot.total / 2);
    pago += ' · ' + C.t('res.dos_partes_detalle', { a: C.money(a), b: C.money(tot.total - a) });
  }

  return `
    <div class="sum">
      ${rows.join('')}
      <div class="sum-total">
        <span>${C.esc(C.t('res.total'))}</span>
        <span class="price">${C.esc(C.money(tot.total))}</span>
      </div>
      ${tax ? `<p class="tax">${C.esc(tax)}${pais && !pais.ue ? ' · ' + C.esc(C.t('precio.aduanas')) : ''}</p>` : ''}
      <p class="sum-note">${C.esc(pago)}</p>
      <p class="sum-note">${C.esc(plazoTexto(tot.horas))}</p>
    </div>`;
}

function renderResumen() {
  $('resumen').innerHTML = resumenHtml(C.loadCart());
}

/** Texto plano para copiar y mandarnos por correo o Instagram si el envío falla. */
function resumenTexto() {
  const cart = C.loadCart();
  const pais = paisDe(cart.pais);
  const tot = totales(cart.items, S.cat, pais, S.ship);
  const v = id => $(id).value.trim();
  const lines = ['Soy Resinator', ''];
  cart.items.forEach((it, i) => {
    const p = prodDe(it.pid);
    lines.push(`${i + 1}. ${p.nombre} (${C.money(p.pvp)}) · ${textoColores(it, p)}${it.montaje ? ' · ' + C.t('res.montaje') : ''}`);
    extrasDe(it, p, S.cat).forEach(e => lines.push(`   + ${textoExtra(e)} (${C.money(e.importe)})`));
    if (it.nota.trim()) lines.push(`   ${C.t('ped.notas')}: ${it.nota.trim()}`);
  });
  lines.push('');
  if (tot.montajeUds) lines.push(`${C.t('res.montaje')}: ${C.money(tot.montaje)}`);
  if (pais) lines.push(`${C.t('res.envio_aprox')}: ${C.money(tot.envio)} (${textoCajas(tot, pais)})`);
  lines.push(`${C.t('res.total')}: ${C.money(tot.total)}`);
  lines.push(`${C.t('res.pago')}: ${C.t(cart.modo === 'dos_partes' ? 'pago.dos_partes' : 'pago.completo')}`);
  lines.push('');
  lines.push(`${C.t('datos.nombre')}: ${v('f-nombre')}`);
  lines.push(`${C.t('datos.email')}: ${v('f-email')}`);
  lines.push(`${C.t('datos.telefono')}: ${v('f-prefijo')} ${v('f-telefono')}`);
  lines.push(`${C.t('datos.direccion')}: ${v('f-direccion')}, ${v('f-cp')} ${v('f-ciudad')}, ${pais ? C.countryName(pais) : ''}`);
  if (v('f-instagram')) lines.push(`Instagram: ${v('f-instagram')}`);
  return lines.join('\n');
}

/* =================== Eventos =================== */

function wire() {
  const items = $('items');

  items.addEventListener('change', e => {
    const el = e.target;
    const uid = el.dataset.uid;
    if (!uid) return;
    const cart = C.loadCart();
    const it = cart.items.find(i => i.uid === uid);
    if (!it) return;
    if (el.type === 'radio') {
      const grupo = el.dataset.grupo;
      const part = prodDe(it.pid).partes.find(p => p.grupo === grupo);
      const c = coloresDe(part, it).find(x => x.id === el.value);
      if (!c) return;
      it.colores[grupo] = c.id;
      it.snap = it.snap || {};
      it.snap[grupo] = { hex: c.hex, nombres: c.nombres };
      C.saveCart(cart);
      const out = $(`ch-${uid}-${grupo}`);
      if (out) out.textContent = chosenText(c);
      $('ped-avisos').hidden = true;
      renderResumen();
    } else if (el.classList.contains('montaje')) {
      const pais = paisDe(cart.pais);
      it.montaje = el.checked && !!(pais && pais.montaje);
      el.checked = it.montaje;
      C.saveCart(cart);
      renderResumen();
    }
  });

  items.addEventListener('input', e => {
    const el = e.target;
    if (!el.classList.contains('nota')) return;
    const cnt = $(`nc-${el.dataset.uid}`);
    if (cnt) cnt.textContent = C.t('ped.caracteres', { n: S.cfg.nota_max - el.value.length });
    clearTimeout(notaTimer);
    notaTimer = setTimeout(flushNotas, 300);
  });

  items.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    flushNotas();
    const cart = C.loadCart();
    const idx = cart.items.findIndex(i => i.uid === b.dataset.uid);
    if (idx < 0) return;
    if (b.dataset.act === 'extra') {
      const it = cart.items[idx];
      const tipo = b.dataset.tipo;
      const max = (S.cat.extras_def[tipo] || {}).max || 0;
      it.extras = it.extras || {};
      const n = Math.min(Math.max((Number(it.extras[tipo]) || 0) + Number(b.dataset.d), 0), max);
      if (n) it.extras[tipo] = n; else delete it.extras[tipo];
      C.saveCart(cart);
      const focusSel = `button[data-act="extra"][data-uid="${it.uid}"][data-tipo="${tipo}"][data-d="${b.dataset.d}"]`;
      renderItems();
      renderResumen();
      const again = document.querySelector(focusSel);
      // Si el botón queda desactivado (0 o máximo), el foco pasa al otro del mismo contador.
      (again && !again.disabled ? again
        : document.querySelector(`button[data-act="extra"][data-uid="${it.uid}"][data-tipo="${tipo}"]:not([disabled])`) || again)?.focus();
      return;
    }
    const nombre = prodDe(cart.items[idx].pid).nombre;
    let focusId = null;
    if (b.dataset.act === 'dup') {
      const copia = JSON.parse(JSON.stringify(cart.items[idx]));
      copia.uid = C.uid();
      cart.items.splice(idx + 1, 0, copia);
      focusId = `u-${copia.uid}`;
      C.toast(C.t('ped.duplicado', { nombre }));
    } else {
      cart.items.splice(idx, 1);
      const next = cart.items[idx] || cart.items[idx - 1];
      focusId = next ? `u-${next.uid}` : 'pedido-titulo';
      C.toast(C.t('ped.quitado', { nombre }));
    }
    C.saveCart(cart);
    renderItems();
    renderResumen();
    const f = $(focusId);
    if (f) f.focus();
  });

  $('f-prefijo').addEventListener('input', () => { prefijoTocado = true; });

  document.querySelectorAll('input[name="modo"]').forEach(r => r.addEventListener('change', () => {
    const cart = C.loadCart();
    cart.modo = r.value === 'dos_partes' ? 'dos_partes' : 'completo';
    C.saveCart(cart);
    renderResumen();
  }));

  // Al corregir un campo, quitamos su error.
  $('ped-form').addEventListener('input', e => clearErr(e.target));
  $('ped-form').addEventListener('change', e => clearErr(e.target));
  $('ped-form').addEventListener('submit', enviar);

  $('btn-copiar-resumen').addEventListener('click', async () => {
    flushNotas();
    if (await C.copyText(resumenTexto())) C.toast(C.t('err.copiado'));
  });
  $('btn-copiar-id').addEventListener('click', async () => {
    if (await C.copyText($('conf-id').textContent)) C.toast(C.t('conf.copiado'));
  });
}

/* =================== Validación del formulario =================== */

function setErr(id, key) {
  const el = $(id);
  el.setAttribute('aria-invalid', 'true');
  $(`e-${id}`).textContent = C.t(key);
  return { id, msg: C.t(key) };
}
function clearErr(el) {
  if (!el || !el.id || el.getAttribute('aria-invalid') !== 'true') return;
  el.removeAttribute('aria-invalid');
  const e = $(`e-${el.id}`);
  if (e) e.textContent = '';
}

function validarFormulario() {
  document.querySelectorAll('#ped-form [aria-invalid="true"]').forEach(clearErr);
  const errs = [];
  const v = id => $(id).value.trim();

  if (v('f-nombre').length < 2) errs.push(setErr('f-nombre', 'err.requerido'));
  if (!v('f-email')) errs.push(setErr('f-email', 'err.requerido'));
  else if (!RE_EMAIL.test(v('f-email'))) errs.push(setErr('f-email', 'err.email'));
  if (!v('f-email2')) errs.push(setErr('f-email2', 'err.requerido'));
  else if (v('f-email2').toLowerCase() !== v('f-email').toLowerCase()) errs.push(setErr('f-email2', 'err.email_distinto'));
  if (!/^\+\d{1,4}$/.test(v('f-prefijo'))) errs.push(setErr('f-prefijo', 'err.prefijo'));
  const digitos = v('f-telefono').replace(/[\s().-]/g, '');
  if (!digitos) errs.push(setErr('f-telefono', 'err.requerido'));
  else if (!/^\d{6,15}$/.test(digitos)) errs.push(setErr('f-telefono', 'err.telefono'));
  if (!paisActual()) errs.push(setErr('f-pais', 'err.pais'));
  if (!v('f-direccion')) errs.push(setErr('f-direccion', 'err.requerido'));
  if (!v('f-cp')) errs.push(setErr('f-cp', 'err.requerido'));
  if (!v('f-ciudad')) errs.push(setErr('f-ciudad', 'err.requerido'));
  if (!$('f-condiciones').checked) errs.push(setErr('f-condiciones', 'err.condiciones'));
  if (!$('f-privacidad').checked) errs.push(setErr('f-privacidad', 'err.privacidad'));
  return errs;
}

function mostrarErrores(errs) {
  const box = $('err-resumen');
  if (!errs.length) { box.hidden = true; return; }
  $('err-lista').innerHTML = errs.map(e => {
    const label = document.querySelector(`label[for="${e.id}"]`);
    const nombre = label && label.textContent.trim() && !['f-condiciones', 'f-privacidad'].includes(e.id)
      ? label.textContent.trim() + ': ' : '';
    return `<li><a href="#${e.id}">${C.esc(nombre + e.msg)}</a></li>`;
  }).join('');
  box.hidden = false;
  box.focus();
}

/* =================== Envío =================== */

function payload() {
  const cart = C.loadCart();
  const v = id => $(id).value.trim();
  return {
    accion: 'pedido',
    idioma: C.getLang(),
    web: $('f-web').value, // campo trampa: debe llegar vacío
    cliente: {
      nombre: v('f-nombre'),
      email: v('f-email').toLowerCase(),
      telefono: `${v('f-prefijo')} ${v('f-telefono')}`,
      direccion: v('f-direccion'),
      cp: v('f-cp'),
      ciudad: v('f-ciudad'),
      instagram: v('f-instagram')
    },
    pais: cart.pais,
    modo_pago: cart.modo === 'dos_partes' ? 'dos_partes' : 'completo',
    items: cart.items.map(it => ({
      pid: it.pid,
      colores: prodDe(it.pid).partes.map(p => ({ grupo: p.grupo, color_id: it.colores[p.grupo] || p.de_serie })),
      extras: Object.fromEntries(extrasDe(it, prodDe(it.pid), S.cat).map(e => [e.tipo, e.cantidad])),
      montaje: !!it.montaje,
      nota: (it.nota || '').trim().slice(0, S.cfg.nota_max)
    })),
    // Solo informativo: el servidor recalcula todo con catalog.json y shipping.json.
    total_cliente: totales(cart.items, S.cat, paisDe(cart.pais), S.ship).total,
    consentimiento: true
  };
}

async function enviar(e) {
  e.preventDefault();
  if (enviando) return;
  flushNotas();
  $('fallo').hidden = true;

  if (!C.loadCart().items.length) { C.toast(C.t('err.carrito_vacio')); return; }
  const errs = validarFormulario();
  mostrarErrores(errs);
  if (errs.length) return;
  if (!S.abiertos) { fallo('pedidos_cerrados'); return; }

  const body = payload();
  const btn = $('btn-enviar');
  enviando = true;
  btn.disabled = true;
  btn.textContent = C.t('res.enviando');

  let res = null;
  try {
    if (!S.cfg.api_url) throw new Error('sin api_url');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      // text/plain evita la petición previa de CORS que Apps Script no responde.
      const r = await fetch(S.cfg.api_url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctl.signal
      });
      res = await r.json();
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    res = { ok: false, error: 'envio_fallido' };
  } finally {
    enviando = false;
    btn.disabled = !S.abiertos;
    btn.textContent = C.t('res.enviar');
  }

  // Nunca mostramos un ID que no venga del servidor.
  if (res && res.ok === true && typeof res.id === 'string' && RE_ID.test(res.id)) {
    confirmar(res, body);
    return;
  }
  const code = res && typeof res.error === 'string' ? res.error : 'servidor';
  if (code === 'pedidos_cerrados') {
    S.abiertos = false;
    $('ped-cerrado').hidden = false;
    btn.disabled = true;
  }
  if (code === 'color_no_disponible') {
    // Releemos COLORES y corregimos el carrito antes de que lo reintente.
    S.remote = await C.loadRemote(S.cfg, true);
    refresh();
  }
  fallo(code);
}

function fallo(code) {
  const key = 'err.' + code;
  $('fallo-motivo').textContent = C.hasKey(key) ? C.t(key) : C.t('err.servidor');
  $('fallo').hidden = false;
  $('fallo').focus();
}

function confirmar(res, body) {
  const cart = C.loadCart();
  $('conf-resumen').innerHTML = resumenHtml(cart);
  $('conf-id').textContent = res.id;
  $('conf-email').textContent = C.t('conf.email', { email: body.cliente.email });
  $('conf-seguir').href = 'pedido.html?id=' + encodeURIComponent(res.id);

  // Pedido enviado: vaciamos el carrito (guardamos país y modo de pago) y el formulario.
  cart.items = [];
  C.saveCart(cart);
  $('ped-form').reset();
  picker.paint();
  $('err-resumen').hidden = true;

  $('ped-main').hidden = true;
  $('confirmacion').hidden = false;
  window.scrollTo(0, 0);
  $('conf-titulo').focus({ preventScroll: true });
}
