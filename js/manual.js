// Soy Resinator · manual de montaje (manual.html)
// Se llega desde "Mi pedido" con un enlace firmado: ?id=SR-XXXXXX&m=heavy-bolt&e=<caducidad>&k=<firma>.
// El manual (plantilla con fotos + textos de los 6 idiomas) lo sirve el Apps Script desde Drive; aquí no se guarda nada.
import * as C from './core.js?v=20261121';

const $ = id => document.getElementById(id);
const RE_ID = /^SR-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

let manual = null; // { plantilla, textos: { es: {…}, en: {…}, … } }

async function main() {
  const [cfg] = await Promise.all([C.loadJSON('data/config.json'), C.initI18n()]);
  C.applyI18n();
  C.setupChrome(cfg);

  const q = new URLSearchParams(location.search);
  const id = String(q.get('id') || '').trim().toUpperCase();
  const m = String(q.get('m') || ''), e = String(q.get('e') || ''), k = String(q.get('k') || '');
  if (RE_ID.test(id)) $('m-volver').href = 'pedido.html?id=' + encodeURIComponent(id);
  $('m-imprimir').addEventListener('click', () => window.print());
  document.addEventListener('sr:lang', () => { if (manual) pintarTextos(); else repintarEstado(); });

  if (!RE_ID.test(id) || !/^[a-z0-9-]{1,40}$/.test(m) || !/^\d{9,11}$/.test(e) || !/^[0-9a-f]{32}$/.test(k)) {
    estado('manual.caducado', id); return;
  }
  // Caducado en el reloj del cliente: ni lo pedimos (el servidor también lo comprueba).
  if (Number(e) * 1000 < Date.now()) { estado('manual.caducado', id); return; }
  if (!cfg.api_url) { estado('manual.error', id); return; }

  let res = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000); // ~2 MB con las fotos
    try {
      const url = `${cfg.api_url}?accion=manual&id=${encodeURIComponent(id)}&m=${encodeURIComponent(m)}&e=${e}&k=${k}`;
      res = await (await fetch(url, { signal: ctl.signal })).json();
    } finally { clearTimeout(timer); }
  } catch (err) { res = null; }

  if (res && res.ok && res.manual && typeof res.manual.plantilla === 'string' && res.manual.textos) {
    manual = res.manual;
    $('m-manual').innerHTML = manual.plantilla;
    pintarTextos();
    $('m-estado').hidden = true;
    $('m-barra').hidden = false;
  } else {
    const err = res && res.error;
    estado(err === 'enlace_caducado' ? 'manual.caducado' : err === 'no_disponible' ? 'manual.no_disponible' : 'manual.error', id);
  }
}

/** Textos del manual en el idioma de la web (si faltara alguno: inglés y, si no, español). */
function pintarTextos() {
  const L = C.getLang(), T = manual.textos;
  const d = Object.assign({}, T.es || {}, T.en || {}, T[L] || {});
  const art = $('m-manual').querySelector('.manual');
  if (art) art.setAttribute('lang', T[L] ? L : (T.en ? 'en' : 'es'));
  $('m-manual').querySelectorAll('[data-t]').forEach(el => {
    const v = d[el.dataset.t];
    if (v == null) return;
    // Con hijos (p. ej. el h3 con la etiqueta "Opcional"): solo cambia el primer texto, no los hijos.
    if (el.children.length) {
      const n = [...el.childNodes].find(x => x.nodeType === 3 && x.textContent.trim());
      if (n) n.textContent = v;
    } else el.textContent = v;
  });
  $('m-manual').querySelectorAll('[data-t-alt]').forEach(el => {
    const v = d[el.dataset.tAlt];
    if (v != null) el.setAttribute('alt', v);
  });
  if (d.titulo) document.title = d.titulo + ' · Soy Resinator';
}

let ultimoEstado = null;
function estado(key, id) {
  ultimoEstado = { key, id };
  repintarEstado();
}
function repintarEstado() {
  if (!ultimoEstado) return;
  const { key, id } = ultimoEstado;
  const volver = RE_ID.test(id) ? 'pedido.html?id=' + encodeURIComponent(id) : 'pedido.html';
  $('m-estado').innerHTML = `<p class="notice${key === 'manual.cargando' ? '' : ' notice-error'}">${C.esc(C.t(key))}</p>
    <p><a class="btn btn-primary" href="${volver}">${C.esc(C.t('manual.volver'))}</a></p>`;
}

main();
