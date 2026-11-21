// Soy Resinator · catálogo (index.html). Arranca también la vista de pedido.
import * as C from './core.js?v=20261121b';
import * as P from './carrito.js?v=20261121b';
import { plazoDias } from './calc.js?v=20261121b';

const state = {
  cfg: null, cat: null, ship: null, serie: [],
  remote: { ok: false },
  resenas: null,
  abiertos: true
};

async function main() {
  try {
    const [cfg, cat, ship, serie] = await Promise.all([
      C.loadJSON('data/config.json'),
      C.loadJSON('data/catalog.json'),
      C.loadJSON('data/shipping.json'),
      C.loadJSON('data/colores-serie.json').catch(() => ({ colores: [] })),
      C.initI18n()
    ]);
    // "oculto": true en catalog.json = aún no presentado; no se muestra ni se puede pedir.
    cat.productos = cat.productos.filter(p => !p.oculto);
    Object.assign(state, { cfg, cat, ship, serie: serie.colores || [] });
  } catch (e) {
    await C.initI18n().catch(() => {});
    C.applyI18n();
    const box = document.getElementById('colecciones');
    box.removeAttribute('aria-busy');
    box.innerHTML = `<p class="notice">${C.esc(C.t('cat.error_carga'))}</p>`;
    return;
  }

  C.applyI18n();
  C.setupChrome(state.cfg);
  setupCountry();
  render();
  P.initPedido(state);
  paintFloat();

  document.addEventListener('sr:lang', () => { fillCountries(); paintPriceNote(); render(); });
  document.addEventListener('sr:pais', () => { fillCountries(); paintPriceNote(); render(); });
  document.addEventListener('sr:cart', paintFloat);
  document.addEventListener('sr:view', paintFloat);

  // Colores y estado de la forja desde el Apps Script. Si falla, seguimos abiertos y con colores de serie.
  const resenasP = cargarResenas();
  state.remote = await C.loadRemote(state.cfg);
  if (state.remote.ok) {
    state.abiertos = !(state.remote.pedidos_abiertos === false || state.remote.pedidos_abiertos === 'no');
    render();
    P.onRemote();
  }
  await resenasP;
}

/* ---------- Reseñas aprobadas ---------- */
async function cargarResenas() {
  if (!state.cfg.api_url) return;
  try {
    const r = await fetch(state.cfg.api_url + '?accion=resenas').then(x => x.json());
    if (!r || !r.ok) return;
    state.resenas = r;
    render();
    pintarResenas();
    document.addEventListener('sr:lang', pintarResenas);
  } catch (e) { /* sin reseñas: no se enseña nada */ }
}

const estrellasTxt = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

function pintarResenas() {
  const r = state.resenas;
  const box = document.getElementById('resenas');
  if (!r || !r.resenas || !r.resenas.length) { box.hidden = true; return; }
  const media = String(r.total.media).replace('.', C.locale().startsWith('en') ? '.' : ',');
  document.getElementById('rev-media').innerHTML =
    `<span class="stars-ro" aria-hidden="true">${estrellasTxt(Math.round(r.total.media))}</span> ` +
    C.esc(C.t(r.total.n === 1 ? 'rev.media_total_1' : 'rev.media_total', { media, n: r.total.n }));
  const nombreProd = pid => (state.cat.productos.find(p => p.id === pid) || {}).nombre || '';
  document.getElementById('rev-lista').innerHTML = r.resenas.slice(0, 12).map(x => `
    <article class="review">
      <p class="stars-ro" role="img" aria-label="${C.esc(C.t('rev.estrellas_aria', { n: x.estrellas }))}">${estrellasTxt(x.estrellas)}</p>
      <p class="review-text">${C.esc(x.texto)}</p>
      ${(x.fotos || []).length ? `<div class="review-fotos">${x.fotos.map((f, i) => `
        <button type="button" class="review-foto" data-grande="${C.esc(f.grande)}" aria-label="${C.esc(C.t('rev.foto_ver', { n: i + 1, nombre: x.nombre }))}">
          <img src="${C.esc(f.mini)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
        </button>`).join('')}</div>` : ''}
      <p class="review-who">${C.esc(x.nombre)}${x.pais ? ' · ' + C.esc(x.pais) : ''}${x.pids.length ? ' · ' + C.esc(x.pids.map(nombreProd).filter(Boolean).join(', ')) : ''}</p>
    </article>`).join('');
  box.hidden = false;
  if (!box.dataset.fotos) {
    box.dataset.fotos = '1';
    box.addEventListener('click', e => {
      const b = e.target.closest('.review-foto');
      if (b) verFoto(b.dataset.grande, b);
    });
  }
}

/** Foto de reseña a pantalla completa (dialog nativo: Esc o clic fuera la cierran). */
function verFoto(url, origen) {
  let d = document.getElementById('foto-dialog');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'foto-dialog';
    d.className = 'foto-dialog';
    d.innerHTML = `<img alt="" referrerpolicy="no-referrer"><button type="button" class="btn btn-ghost btn-sm foto-cerrar"></button>`;
    document.body.appendChild(d);
    // Al cerrar, el foco vuelve a la miniatura (si la lista se ha vuelto a pintar, a la equivalente).
    const volver = () => {
      const o = d._origen && d._origen.isConnected ? d._origen
        : document.querySelector(`.review-foto[data-grande="${CSS.escape(d._url || '')}"]`);
      if (o) o.focus();
    };
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('.foto-cerrar')) { d.close(); volver(); }
    });
    d.addEventListener('close', volver); // Esc
  }
  d._url = url;
  d.querySelector('.foto-cerrar').textContent = C.t('rev.cerrar');
  d.querySelector('img').src = url;
  d._origen = origen;
  d.showModal();
}

/* ---------- País de envío (para el texto de precios) ---------- */
function setupCountry() {
  const cart = C.loadCart();
  if (!cart.pais) {
    // Primera visita: intentamos deducir el país de la región del navegador.
    const region = String(navigator.language || '').split('-')[1];
    if (region && state.ship.paises.some(p => p.code === region.toUpperCase())) {
      cart.pais = region.toUpperCase();
      C.saveCart(cart);
    }
  }
  picker = C.countryPicker(document.getElementById('pais'), state.ship.paises, () => C.loadCart().pais,
    code => { C.ev('pais', { pais: code, donde: 'catalogo' }); P.setPais(code); });
  paintPriceNote();
}

let picker = null;
function fillCountries() {
  if (picker) picker.paint();
}

function paisActual() {
  const code = C.loadCart().pais;
  return state.ship.paises.find(p => p.code === code) || null;
}

function paintPriceNote() {
  const p = paisActual();
  const note = document.getElementById('precio-nota');
  if (!p) note.textContent = C.t('precio.sin_pais');
  else if (p.ue) note.textContent = '';
  else note.textContent = C.t('precio.aduanas');
}

function taxLabel() {
  const p = paisActual();
  if (!p) return '';
  return p.ue ? C.t('precio.ue') : C.t('precio.fuera_ue');
}

/* ---------- Barra flotante "Ver pedido" (móvil) ---------- */
function paintFloat() {
  const n = C.loadCart().items.length;
  const enCatalogo = document.getElementById('pedido').hidden;
  const bar = document.getElementById('cart-float');
  bar.hidden = !(n > 0 && enCatalogo);
  document.getElementById('cart-float-count').textContent = String(n);
  document.body.classList.toggle('has-float', !bar.hidden);
}

/* ---------- Render ---------- */
function render() {
  const box = document.getElementById('colecciones');
  box.removeAttribute('aria-busy');
  C.avisoForja('cerrado', !state.abiertos);

  const tax = taxLabel();
  box.innerHTML = state.cat.colecciones.map(col => {
    const prods = state.cat.productos.filter(p => p.coleccion === col.id);
    if (!prods.length) return '';
    return `
      <section class="collection" aria-labelledby="col-${col.id}">
        <h3 class="collection-title" id="col-${col.id}">${C.esc(col.etiqueta ? C.t(col.etiqueta) : col.nombre)}</h3>
        <div class="grid">${prods.map(p => card(p, tax)).join('')}</div>
      </section>`;
  }).join('');

  box.querySelectorAll('img[data-ph]').forEach(img => {
    img.addEventListener('error', () => img.remove(), { once: true });
  });
  box.querySelectorAll('.media').forEach(carrusel);
  box.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => add(b.dataset.add)));
}

function card(p, tax) {
  const includes = p.incluye.map(k => `<li>${C.esc(C.t(k))}</li>`).join('');
  let colors;
  if (p.partes.length) {
    const dots = p.partes.map(pt => {
      const c = C.coloresParaParte(pt, state.remote, state.serie)[0];
      return `<span class="dot" style="background:${C.esc(c.hex)}" aria-hidden="true"></span>`;
    }).join('');
    const names = p.partes.map(pt => C.t(pt.etiqueta)).join(', ');
    colors = `<p class="colors-line"><span class="dots">${dots}</span>${C.esc(C.t('cat.colores_elegir'))}: <strong>${C.esc(names)}</strong></p>`;
  } else {
    colors = `<p class="colors-line">${C.esc(C.t('cat.colores_serie'))}</p>`;
  }
  // Fecha estimada si paga hoy: cola real de la app + horas de esta réplica (misma regla que el carrito).
  // Sin datos de la cola o con la forja cerrada, no se muestra.
  const dias = state.abiertos ? plazoDias(p.horas, state.remote, state.cfg) : null;
  const plazo = dias === null ? '' : `<p class="eta-line">${C.esc(C.t('cat.plazo', {
    fecha: new Date(Date.now() + dias * 86400000).toLocaleDateString(C.locale(), { day: 'numeric', month: 'long' })
  }))}</p>`;
  const extras = (p.extras || []).length
    ? `<p class="extras-line">${C.esc(C.t('cat.extras', { precio: C.money(Math.min(...p.extras.map(e => e.pvp))) }))}</p>` : '';
  const action = state.abiertos
    ? `<button class="btn btn-primary btn-block" type="button" data-add="${p.id}" aria-label="${C.esc(C.t('cat.anadir') + ': ' + p.nombre)}">${C.esc(C.t('cat.anadir'))}</button>`
    : `<p class="closed-inline">${C.esc(C.t('cerrado.texto'))}</p>`;

  return `
    <article class="card" id="p-${p.id}">
      <div class="media">
        ${p.especial ? `<span class="badge">${C.esc(C.t('cat.especial'))}</span>` : ''}
        <span class="ph-name" aria-hidden="true">${C.esc(p.nombre)}</span>
        <div class="slides" tabindex="-1">
          <img data-ph src="img/${p.id}-1.webp" alt="${C.esc(p.nombre)}" loading="lazy" decoding="async" width="1200" height="675">
          <a class="slide-ficha" href="img/${p.id}-2.webp" target="_blank" rel="noopener" aria-label="${C.esc(C.t('cat.ficha') + ': ' + p.nombre)}">
            <img data-ficha src="img/${p.id}-2.webp" alt="${C.esc(C.t('cat.ficha') + ': ' + p.nombre)}" loading="lazy" decoding="async" width="1600" height="1257">
          </a>
        </div>
        <button class="slide-btn prev" type="button" data-dir="-1" aria-label="${C.esc(C.t('cat.foto_ant'))}" hidden>‹</button>
        <button class="slide-btn next" type="button" data-dir="1" aria-label="${C.esc(C.t('cat.foto_sig'))}" hidden>›</button>
        <div class="slide-dots" aria-hidden="true" hidden><span class="on"></span><span></span></div>
      </div>
      <div class="card-body">
        <h4>${C.esc(p.nombre)}</h4>
        ${notaProducto(p.id)}
        ${p.compatible ? `<p class="compat-line">${C.esc(C.t(p.compatible))}</p>` : ''}
        ${C.hasKey('desc.' + p.id) ? `<p class="card-desc">${C.esc(C.t('desc.' + p.id))}</p>` : ''}
        <div class="price-row">
          <span class="price">${C.esc(C.money(p.pvp))}</span>
          ${tax ? `<span class="tax">${C.esc(tax)}</span>` : ''}
        </div>
        <div>
          <p class="sr-only">${C.esc(C.t('cat.incluye'))}</p>
          <ul class="includes">${includes}</ul>
        </div>
        ${p.accesorio ? '' : `<p class="nf-line">${C.esc(C.t('aviso.nf_corto'))} · <a href="faq.html#no-funcional">${C.esc(C.t('aviso.mas'))}</a></p>`}
        ${plazo}
        ${colors}
        ${extras}
        <div class="card-actions">${action}</div>
      </div>
    </article>`;
}

/** Carrusel de la tarjeta: foto (-1) y ficha de medidas (-2). Sin ficha, se queda la foto sola y sin controles. */
function carrusel(media) {
  const track = media.querySelector('.slides');
  const ficha = media.querySelector('img[data-ficha]');
  const btns = media.querySelectorAll('.slide-btn');
  const dots = media.querySelector('.slide-dots');
  if (!track || !ficha) return;
  btns.forEach(b => { b.hidden = false; }); dots.hidden = false;
  ficha.addEventListener('error', () => {
    ficha.closest('.slide-ficha').remove(); btns.forEach(b => { b.hidden = true; }); dots.hidden = true;
  }, { once: true });
  const ir = i => track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  const actual = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const pid = (media.closest('article.card') || { id: 'p-' }).id.slice(2);
  let fichaVista = false;
  btns.forEach(b => b.addEventListener('click', () => {
    const n = track.children.length;
    ir((actual() + Number(b.dataset.dir) + n) % n);
  }));
  track.addEventListener('scroll', () => {
    const i = actual();
    dots.querySelectorAll('span').forEach((d, k) => d.classList.toggle('on', k === i));
    if (i === 1 && !fichaVista) { fichaVista = true; C.ev('ficha', { pid }); }
  }, { passive: true });
  ficha.closest('.slide-ficha').addEventListener('click', () => C.ev('ficha_abrir', { pid }));
}

/** "★ 4,9 (12)" bajo el nombre, si el producto tiene reseñas publicadas; enlaza a la sección de reseñas. */
function notaProducto(pid) {
  const m = state.resenas && state.resenas.medias && state.resenas.medias[pid];
  if (!m || !m.n) return '';
  const media = String(m.media).replace('.', C.locale().startsWith('en') ? '.' : ',');
  return `<p class="rating-line"><a href="#resenas" aria-label="${C.esc(C.t(m.n === 1 ? 'rev.media_aria_1' : 'rev.media_aria', { media, n: m.n }))}"><span aria-hidden="true">★ ${C.esc(media)} (${m.n})</span></a></p>`;
}

function add(pid) {
  if (!state.abiertos) return;
  const prod = state.cat.productos.find(p => p.id === pid);
  if (!prod) return;
  const cart = C.loadCart();
  cart.items.push(C.newItem(prod));
  C.saveCart(cart);
  C.ev('carrito', { pid, pvp: prod.pvp, n: cart.items.length });
  C.toast(C.t('cat.anadido', { nombre: prod.nombre }));
}

main();
