// Soy Resinator · reseña de un pedido entregado (resena.html?id=SR-XXXXXX&k=…&lang=xx).
// El enlace llega en el correo que manda la tarea unos días después de la entrega. El servidor comprueba
// que id + k son de ese pedido y que está Entregado; una reseña por pedido. Se publica cuando la aprobamos.
import * as C from './core.js?v=20261115c';

const $ = id => document.getElementById(id);
const RE_ID = /^SR-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const MIN = 10, MAX = 1000;

const q = new URLSearchParams(location.search);
const id = String(q.get('id') || '').trim().toUpperCase();
const k = String(q.get('k') || '').trim();
let cfg = null;
let info = null;
let enviando = false;

async function main() {
  // El idioma del correo manda la primera vez (el cliente puede cambiarlo luego en el selector).
  const l = q.get('lang');
  if (l && !C.lsGet('sr_lang')) C.lsSet('sr_lang', l);
  const [c] = await Promise.all([C.loadJSON('data/config.json'), C.initI18n()]);
  cfg = c;
  C.applyI18n();
  C.setupChrome(cfg);
  pintarTextos();
  document.addEventListener('sr:lang', () => { pintarTextos(); if (info) pintarInfo(); });

  if (!RE_ID.test(id) || k.length !== 24 || !cfg.api_url) return aviso('resena.invalido');
  const r = await llamar({ accion: 'resena_info', id, k });
  $('r-cargando').hidden = true;
  if (!r.ok) return aviso(r.error === 'no_entregado' ? 'resena.no_entregado' : r.error === 'enlace_invalido' ? 'resena.invalido' : 'resena.error');
  info = r;
  if (r.ya) return aviso('resena.ya', true);
  pintarInfo();
  if (r.nombre && !$('r-nombre').value) $('r-nombre').value = r.nombre;
  if (r.pais && !$('r-pais').value) $('r-pais').value = C.countryName({ code: r.pais });
  $('r-form').hidden = false;
  $('r-form').addEventListener('submit', enviar);
  $('r-texto').addEventListener('input', () => { contador(); limpiarErr('r-texto'); });
  $('r-nombre').addEventListener('input', () => limpiarErr('r-nombre'));
  $('r-consent').addEventListener('change', () => limpiarErr('r-consent'));
  $('r-estrellas').addEventListener('change', () => limpiarErr('r-estrellas'));
}

/** Estrellas (radios), contador y texto del permiso: cambian con el idioma. */
function pintarTextos() {
  const sel = Number((document.querySelector('input[name="r-estrella"]:checked') || {}).value || 0);
  $('r-estrellas').innerHTML = [1, 2, 3, 4, 5].map(n => `
    <label class="star" title="${C.esc(C.t('rev.estrellas_aria', { n }))}">
      <input type="radio" name="r-estrella" value="${n}" ${n === sel ? 'checked' : ''}>
      <span aria-hidden="true">★</span>
      <span class="sr-only">${C.esc(C.t('rev.estrellas_aria', { n }))}</span>
    </label>`).join('');
  $('r-consent-txt').innerHTML = C.tHtml('resena.consent', {
    privacidad: `<a href="privacidad.html">${C.esc(C.t('resena.privacidad_enlace'))}</a>`
  });
  contador();
}

function pintarInfo() {
  const nombres = (info.productos || []).map(p => p.nombre).filter(Boolean);
  $('r-productos').textContent = nombres.length ? `${id} · ${nombres.join(', ')}` : id;
}

function contador() {
  const n = $('r-texto').value.trim().length;
  $('r-texto-ayuda').textContent = C.t('resena.texto_ayuda', { min: MIN, n: MAX - $('r-texto').value.length });
  return n;
}

function aviso(key, bueno) {
  $('r-cargando').hidden = true;
  $('r-form').hidden = true;
  $('r-aviso-txt').textContent = C.t(key);
  $('r-aviso').className = 'notice' + (bueno ? '' : ' notice-error');
  $('r-aviso').hidden = false;
}

function setErr(campo, key) {
  $(`e-${campo}`).textContent = C.t(key);
  const el = campo === 'r-estrellas' ? document.querySelector('input[name="r-estrella"]') : $(campo);
  if (el) el.setAttribute('aria-invalid', 'true');
  return campo;
}
function limpiarErr(campo) {
  $(`e-${campo}`).textContent = '';
  const el = campo === 'r-estrellas' ? document.querySelector('input[name="r-estrella"]') : $(campo);
  if (el) el.removeAttribute('aria-invalid');
}

async function llamar(body) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(cfg.api_url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body), signal: ctl.signal
      });
      return await r.json();
    } finally { clearTimeout(timer); }
  } catch (e) {
    return { ok: false, error: 'envio_fallido' };
  }
}

async function enviar(e) {
  e.preventDefault();
  if (enviando) return;
  const estrellas = Number((document.querySelector('input[name="r-estrella"]:checked') || {}).value || 0);
  const texto = $('r-texto').value.trim();
  const nombre = $('r-nombre').value.trim();
  const errs = [];
  if (!estrellas) errs.push(setErr('r-estrellas', 'resena.err_estrellas'));
  if (texto.length < MIN) errs.push(setErr('r-texto', 'resena.err_texto'));
  if (nombre.length < 2) errs.push(setErr('r-nombre', 'err.requerido'));
  if (!$('r-consent').checked) errs.push(setErr('r-consent', 'resena.err_consent'));
  if (errs.length) {
    const first = errs[0] === 'r-estrellas' ? document.querySelector('input[name="r-estrella"]') : $(errs[0]);
    if (first) first.focus();
    return;
  }

  enviando = true;
  const btn = $('r-btn');
  btn.disabled = true;
  btn.textContent = C.t('resena.enviando');
  const r = await llamar({
    accion: 'resena', id, k, estrellas, texto, nombre, pais: $('r-pais').value.trim(),
    idioma: C.getLang(), consentimiento: true, web: $('r-web').value
  });
  enviando = false;
  btn.disabled = false;
  btn.textContent = C.t('resena.enviar');
  if (r.ok) {
    $('r-form').hidden = true;
    $('r-gracias').hidden = false;
    $('r-gracias-tit').focus();
  } else if (r.error === 'ya_enviada') {
    aviso('resena.ya', true);
  } else {
    C.toast(C.t(r.error === 'datos_invalidos' ? 'resena.err_datos' : 'resena.error'));
  }
}

main();
