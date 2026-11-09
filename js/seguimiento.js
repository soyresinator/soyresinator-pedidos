// Soy Resinator · "Mi pedido" (pedido.html)
// El ID puede venir en la URL (?id=SR-XXXXXX). El email nunca: se escribe y se envía por POST.
import * as C from './core.js?v=20261110';

const $ = id => document.getElementById(id);
const RE_ID = /^SR-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASOS = ['recibido', 'pendiente_pago', 'en_produccion', 'listo', 'enviado', 'entregado'];

let cfg = null;
let ultimo = null; // última respuesta, para repintar al cambiar de idioma
let consultando = false;

async function main() {
  const [c] = await Promise.all([C.loadJSON('data/config.json'), C.initI18n()]);
  cfg = c;
  C.applyI18n();
  C.setupChrome(cfg);

  const id = new URLSearchParams(location.search).get('id');
  if (id && RE_ID.test(id.trim().toUpperCase())) $('s-id').value = id.trim().toUpperCase();
  ($('s-id').value ? $('s-email') : $('s-id')).focus();

  $('seg-form').addEventListener('submit', consultar);
  ['s-id', 's-email'].forEach(x => $(x).addEventListener('input', () => setErr(x, '')));
  document.addEventListener('sr:lang', () => { if (ultimo) pintar(ultimo); });
}

function setErr(id, key) {
  $(`e-${id}`).textContent = key ? C.t(key) : '';
  if (key) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid');
}

function error(key) {
  $('seg-resultado').hidden = true;
  $('seg-error-txt').textContent = C.t(key);
  $('seg-error').hidden = false;
}

async function consultar(e) {
  e.preventDefault();
  if (consultando) return;
  $('seg-error').hidden = true;

  const id = $('s-id').value.trim().toUpperCase();
  const email = $('s-email').value.trim();
  $('s-id').value = id;
  let mal = false;
  if (!RE_ID.test(id)) { setErr('s-id', 'seg.id_invalido'); mal = true; }
  if (!RE_EMAIL.test(email)) { setErr('s-email', 'err.email'); mal = true; }
  if (mal) return;
  if (!cfg.api_url) { error('seg.sin_api'); return; }

  consultando = true;
  const btn = $('s-btn');
  btn.disabled = true;
  btn.textContent = C.t('seg.consultando');
  let res = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(cfg.api_url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ accion: 'estado', id, email }),
        signal: ctl.signal
      });
      res = await r.json();
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    res = { ok: false, error: 'envio_fallido' };
  } finally {
    consultando = false;
    btn.disabled = false;
    btn.textContent = C.t('seg.consultar');
  }

  if (res && res.ok === true) {
    ultimo = res;
    pintar(res);
    $('r-estado').focus();
  } else if (res && res.error === 'no_encontrado') {
    ultimo = null;
    error('err.no_encontrado');
  } else {
    ultimo = null;
    error(res && res.error === 'envio_fallido' ? 'seg.sin_api' : 'err.servidor');
  }
}

function fecha(s, conAnio = true) {
  if (!s) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
  if (isNaN(d)) return String(s);
  return d.toLocaleDateString(C.locale(), conAnio ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' });
}

/** true si la fecha (AAAA-MM-DD) es anterior a hoy. */
function fechaPasada(s) {
  const hoy = new Date();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T23:59:59') : new Date(s);
  return !isNaN(d) && d < hoy;
}

function pintar(r) {
  $('seg-error').hidden = true;
  const estado = C.hasKey('estado.' + r.estado) ? r.estado : 'recibido';
  $('r-estado').textContent = C.t('estado.' + estado);
  $('r-id').textContent = r.id;

  const cancelado = estado === 'cancelado';
  $('r-cancelado').hidden = !cancelado;
  $('r-pasos').hidden = cancelado;
  const actual = PASOS.indexOf(estado);
  $('r-pasos').innerHTML = PASOS.map((p, i) => {
    const cls = i < actual ? 'done' : (i === actual ? 'current' : '');
    return `<li class="${cls}"${i === actual ? ' aria-current="step"' : ''}>${C.esc(C.t('estado.' + p))}</li>`;
  }).join('');

  const filas = [];
  const fila = (k, v) => filas.push(`<div><dt>${C.esc(C.t(k))}</dt><dd>${v}</dd></div>`);
  const pago = C.hasKey('pagoest.' + r.pago) ? r.pago : 'pendiente';
  fila('seg.pago', C.esc(C.t('pagoest.' + pago)));

  // Impreso y preparado, pero falta el segundo pago: se lo decimos claro.
  const aviso = !cancelado && estado === 'listo' && pago === 'parcial'
    ? `<p class="notice">${C.esc(C.t('seg.listo_segundo_pago'))}</p>` : '';

  if (!cancelado) {
    if (Number(r.placas_total) > 0) {
      const hechas = Math.min(Number(r.placas_hechas) || 0, Number(r.placas_total));
      fila('seg.placas', `<progress max="${Number(r.placas_total)}" value="${hechas}"></progress>
        <span>${C.esc(C.t('seg.placas_detalle', { hechas, total: Number(r.placas_total) }))}</span>`);
    }
    let f;
    if (pago === 'pendiente') f = C.t('seg.fecha_pendiente');
    else if (r.fecha_envio_estimada && !(fechaPasada(r.fecha_envio_estimada) && !['enviado', 'entregado'].includes(estado))) {
      f = fecha(r.fecha_envio_estimada);
    } else f = C.t('seg.fecha_sin'); // sin fecha, o ya pasada y aún sin salir
    fila('seg.fecha', C.esc(f));
    if (r.servicio) fila('seg.servicio', C.esc(r.servicio));
    if (r.tracking) fila('seg.tracking', `<span class="mono">${C.esc(r.tracking)}</span>`);
  }
  $('r-datos').innerHTML = aviso + filas.join('') +
    (r.actualizado ? `<p class="help">${C.esc(C.t('seg.actualizado', { fecha: fecha(r.actualizado) }))}</p>` : '');
  $('seg-resultado').hidden = false;
}

main();
