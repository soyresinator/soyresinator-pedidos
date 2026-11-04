// Soy Resinator · catálogo (index.html). Arranca también la vista de pedido.
import * as C from './core.js';
import * as P from './carrito.js';

const state = {
  cfg: null, cat: null, ship: null, serie: [],
  remote: { ok: false },
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
  state.remote = await C.loadRemote(state.cfg);
  if (state.remote.ok) {
    state.abiertos = !(state.remote.pedidos_abiertos === false || state.remote.pedidos_abiertos === 'no');
    render();
    P.onRemote();
  }
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
  fillCountries();
  document.getElementById('pais').addEventListener('change', e => P.setPais(e.target.value));
  paintPriceNote();
}

function fillCountries() {
  C.fillCountrySelect(document.getElementById('pais'), state.ship.paises, C.loadCart().pais);
}

function paisActual() {
  const code = C.loadCart().pais;
  return state.ship.paises.find(p => p.code === code) || null;
}

function paintPriceNote() {
  const code = C.loadCart().pais;
  const p = paisActual();
  const note = document.getElementById('precio-nota');
  document.getElementById('otro-pais').hidden = code !== 'OTRO';
  if (!p) note.textContent = code === 'OTRO' ? '' : C.t('precio.sin_pais');
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
  document.getElementById('cerrado').hidden = state.abiertos;

  const tax = taxLabel();
  box.innerHTML = state.cat.colecciones.map(col => {
    const prods = state.cat.productos.filter(p => p.coleccion === col.id);
    if (!prods.length) return '';
    return `
      <section class="collection" aria-labelledby="col-${col.id}">
        <h3 class="collection-title" id="col-${col.id}">${C.esc(col.nombre)}</h3>
        <div class="grid">${prods.map(p => card(p, tax)).join('')}</div>
      </section>`;
  }).join('');

  box.querySelectorAll('img[data-ph]').forEach(img => {
    img.addEventListener('error', () => img.remove(), { once: true });
  });
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
  const action = state.abiertos
    ? `<button class="btn btn-primary btn-block" type="button" data-add="${p.id}" aria-label="${C.esc(C.t('cat.anadir') + ': ' + p.nombre)}">${C.esc(C.t('cat.anadir'))}</button>`
    : `<p class="closed-inline">${C.esc(C.t('cerrado.texto'))}</p>`;

  return `
    <article class="card">
      <div class="media">
        ${p.especial ? `<span class="badge">${C.esc(C.t('cat.especial'))}</span>` : ''}
        <span class="ph-name" aria-hidden="true">${C.esc(p.nombre)}</span>
        <img data-ph src="img/${p.id}-1.webp" alt="${C.esc(p.nombre)}" loading="lazy" decoding="async" width="1200" height="675">
      </div>
      <div class="card-body">
        <h4>${C.esc(p.nombre)}</h4>
        <div class="price-row">
          <span class="price">${C.esc(C.money(p.pvp))}</span>
          ${tax ? `<span class="tax">${C.esc(tax)}</span>` : ''}
        </div>
        <div>
          <p class="sr-only">${C.esc(C.t('cat.incluye'))}</p>
          <ul class="includes">${includes}</ul>
        </div>
        ${colors}
        <div class="card-actions">${action}</div>
      </div>
    </article>`;
}

function add(pid) {
  if (!state.abiertos) return;
  const prod = state.cat.productos.find(p => p.id === pid);
  if (!prod) return;
  const cart = C.loadCart();
  cart.items.push(C.newItem(prod));
  C.saveCart(cart);
  C.toast(C.t('cat.anadido', { nombre: prod.nombre }));
}

main();
