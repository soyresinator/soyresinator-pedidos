// Soy Resinator · utilidades compartidas por todas las páginas.
// Sin framework ni compilación: módulos ES servidos tal cual por GitHub Pages.

export const LANGS = ['en', 'es', 'pt', 'de', 'fr', 'it'];
const LS_LANG = 'sr_lang';
const LS_CART = 'sr_cart';
// Locale para formatear importes por idioma (en-IE: "€160", formato europeo).
const LOCALES = { en: 'en-IE', es: 'es-ES', pt: 'pt-PT', de: 'de-DE', fr: 'fr-FR', it: 'it-IT' };

/* ---------- localStorage seguro (solo carrito e idioma) ---------- */
export function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento: seguimos */ } }

/* ---------- JSON ---------- */
const jsonCache = {};
export function loadJSON(path) {
  if (!jsonCache[path]) {
    jsonCache[path] = fetch(path, { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(path + ' ' + r.status);
      return r.json();
    });
    jsonCache[path].catch(() => { delete jsonCache[path]; });
  }
  return jsonCache[path];
}

/* ---------- i18n ---------- */
let lang = 'en';
let dict = {};
let dictEn = {};

export function detectLang() {
  const saved = lsGet(LS_LANG);
  if (LANGS.includes(saved)) return saved;
  const prefs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
  for (const l of prefs) {
    const base = String(l || '').slice(0, 2).toLowerCase();
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

async function loadLang(l) {
  dictEn = await loadJSON('i18n/en.json');
  dict = l === 'en' ? dictEn : await loadJSON(`i18n/${l}.json`).catch(() => dictEn);
  lang = l;
  document.documentElement.lang = l;
}

export async function initI18n() { await loadLang(detectLang()); }
export function getLang() { return lang; }
export function locale() { return LOCALES[lang] || 'en-IE'; }

export function hasKey(key) { return key in dict || key in dictEn; }

/** Como t(), pero devuelve HTML: escapa el texto y mete los fragmentos HTML de `html` en sus marcadores. */
export function tHtml(key, html) {
  const marks = {};
  Object.keys(html).forEach(k => { marks[k] = `\u0000${k}\u0000`; });
  let s = esc(t(key, marks));
  Object.keys(html).forEach(k => { s = s.replace(`\u0000${k}\u0000`, html[k]); });
  return s;
}

export function t(key, vars) {
  let s = dict[key] ?? dictEn[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] !== undefined ? vars[n] : m));
  return s;
}

/** Pinta los textos: data-i18n="clave" (texto) y data-i18n-attr="aria-label:clave;title:clave2". */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.dataset.i18nAttr.split(';').forEach(pair => {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    });
  });
  if (root === document) {
    // <body data-meta="index">: título y descripción propios de la página; si no, los generales.
    const m = document.body && document.body.dataset.meta;
    const k = m && hasKey(`meta.${m}.titulo`) ? `meta.${m}.` : null;
    document.title = t(k ? k + 'titulo' : 'meta.title');
    const md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute('content', t(k ? k + 'desc' : 'meta.description'));
  }
}

export async function setLang(l) {
  if (!LANGS.includes(l)) return;
  await loadLang(l);
  lsSet(LS_LANG, l);
  applyI18n();
  document.dispatchEvent(new CustomEvent('sr:lang', { detail: l }));
}

/* ---------- Formatos ---------- */
export function money(n) {
  const whole = Math.round(n * 100) % 100 === 0;
  return new Intl.NumberFormat(locale(), {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2
  }).format(n);
}

export function countryName(pais) {
  try {
    const dn = new Intl.DisplayNames([locale()], { type: 'region' });
    return dn.of(pais.code) || pais.nombre_es;
  } catch (e) { return pais.nombre_es; }
}

/** Texto para comparar al buscar: minúsculas y sin tildes. */
export function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Buscador de país (combobox accesible): un <input> donde se escribe y una lista que se filtra.
 * Busca en el nombre del idioma actual, en el nombre en español y en el código (ES, DE…).
 * `getCode()` da el país guardado; `onPick(code)` se llama al elegir uno ('' si se borra).
 * Devuelve { paint() } para repintar el nombre al cambiar de idioma o de país.
 */
export function countryPicker(input, paises, getCode, onPick) {
  const list = document.createElement('ul');
  list.id = input.id + '-lista';
  list.className = 'combo-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.insertAdjacentElement('afterend', list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.spellcheck = false;

  let shown = [];
  let active = -1;
  const nombre = code => { const p = paises.find(x => x.code === code); return p ? countryName(p) : ''; };
  const ordenados = () => [...paises].sort((a, b) => countryName(a).localeCompare(countryName(b), locale()));

  function filtrar(q) {
    const n = norm(q);
    if (!n) return ordenados();
    const empieza = [], contiene = [];
    for (const p of ordenados()) {
      const nm = norm(countryName(p)), es = norm(p.nombre_es);
      if (nm.startsWith(n) || es.startsWith(n) || p.code.toLowerCase() === n) empieza.push(p);
      else if (nm.includes(n) || es.includes(n)) contiene.push(p);
    }
    return empieza.concat(contiene);
  }
  function open(q) {
    shown = filtrar(q);
    active = shown.length ? 0 : -1;
    list.innerHTML = shown.length
      ? shown.map((p, i) => `<li id="${list.id}-${p.code}" role="option" data-code="${p.code}"${i === active ? ' class="active" aria-selected="true"' : ''}>${esc(countryName(p))}</li>`).join('')
      : `<li class="combo-empty" aria-disabled="true">${esc(t('envio.sin_resultados'))}</li>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    mark();
  }
  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function mark() {
    list.querySelectorAll('li[role="option"]').forEach((li, i) => {
      li.classList.toggle('active', i === active);
      li.setAttribute('aria-selected', String(i === active));
      if (i === active) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    });
  }
  function pick(code) {
    close();
    input.value = nombre(code);
    if (code !== getCode()) onPick(code);
  }
  /** Al salir: si el texto es exactamente un país, ese; si está vacío, ninguno; si no, volvemos al guardado. */
  function resolver() {
    const n = norm(input.value);
    if (!n) { if (getCode()) onPick(''); return; }
    const p = paises.find(x => norm(countryName(x)) === n || norm(x.nombre_es) === n);
    if (p) pick(p.code); else input.value = nombre(getCode());
  }

  input.addEventListener('focus', () => { input.select(); open(''); });
  input.addEventListener('click', () => { if (list.hidden) open(''); });
  input.addEventListener('input', () => open(input.value));
  input.addEventListener('change', () => { if (list.hidden) resolver(); }); // autorrelleno del navegador
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { open(input.value); return; }
      if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      mark();
    } else if (e.key === 'Enter') {
      if (!list.hidden && active >= 0) { e.preventDefault(); pick(shown[active].code); }
    } else if (e.key === 'Escape') {
      if (!list.hidden) { e.preventDefault(); close(); input.value = nombre(getCode()); }
    }
  });
  // mousedown (no click) para elegir antes de que el input pierda el foco.
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-code]');
    e.preventDefault();
    if (li) pick(li.dataset.code);
  });
  input.addEventListener('blur', () => { if (!list.hidden) { close(); resolver(); } });

  const paint = () => {
    input.value = nombre(getCode());
    input.placeholder = t('envio.buscar');
    if (!list.hidden) close();
  };
  paint();
  return { paint };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Carrito ---------- */
// { v:1, pais:"ES", items:[{ uid, pid, colores:{grupo: color_id}, extras:{tipo: cantidad}, montaje:false, nota:"" }] }
export function loadCart() {
  try {
    const c = JSON.parse(lsGet(LS_CART) || 'null');
    if (c && c.v === 1 && Array.isArray(c.items)) return c;
  } catch (e) { /* carrito corrupto: empezamos de cero */ }
  return { v: 1, pais: '', items: [] };
}
export function saveCart(cart) {
  lsSet(LS_CART, JSON.stringify(cart));
  document.dispatchEvent(new CustomEvent('sr:cart'));
}
export function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
export function newItem(prod) {
  const colores = {};
  (prod.partes || []).forEach(p => { colores[p.grupo] = p.de_serie; });
  return { uid: uid(), pid: prod.id, colores, extras: {}, montaje: false, nota: '' };
}

/* ---------- Configuración remota (Apps Script ?accion=config) ---------- */
// Devuelve { ok:true, horas_cola, horas_dia, dias_preparacion, pedidos_abiertos, colores:[{id,hex,disponible_g,nombres:{...}}] }
// o { ok:false } si no hay URL o el script no responde.
let remotePromise = null;
export function loadRemote(cfg, force = false) {
  if (force) remotePromise = null;
  if (!remotePromise) {
    remotePromise = (async () => {
      if (!cfg || !cfg.api_url) return { ok: false };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), cfg.timeout_ms || 8000);
      try {
        const r = await fetch(cfg.api_url + '?accion=config', { signal: ctl.signal });
        const j = await r.json();
        if (!j || j.ok !== true || !Array.isArray(j.colores)) return { ok: false };
        return j;
      } catch (e) {
        return { ok: false };
      } finally {
        clearTimeout(timer);
      }
    })();
  }
  return remotePromise;
}

/* ---------- Colores ---------- */
/**
 * Colores que se pueden elegir para una parte (sección 3 del encargo):
 *  · el de serie siempre, primero;
 *  · los demás solo si vienen de COLORES (ya filtrados por ELEGIBLE = sí),
 *    con DISPONIBLE_G >= gramos de la parte y >= stock mínimo (config.stock_minimo_g),
 *    y, si la parte tiene lista cerrada, dentro de ella.
 * Si no hay datos remotos, solo el de serie (con nombre del respaldo colores-serie.json).
 */
export function coloresParaParte(parte, remote, serie, minimo = 0) {
  const remotos = (remote && remote.ok) ? remote.colores : [];
  const porId = new Map(remotos.map(c => [c.id, c]));
  const respaldo = (serie || []).find(c => c.id === parte.de_serie);
  const def = porId.get(parte.de_serie) || respaldo || { id: parte.de_serie, hex: '#777777', nombres: {} };
  const out = [{ ...def, de_serie: true }];
  for (const c of remotos) {
    if (c.id === parte.de_serie) continue;
    if (Array.isArray(parte.opciones) && !parte.opciones.includes(c.id)) continue;
    if ((Number(c.disponible_g) || 0) < Math.max(parte.gramos, Number(minimo) || 0)) continue;
    out.push({ ...c, de_serie: false });
  }
  return out;
}

/** Nombre del color en el idioma actual. COLORES no tiene columna de portugués: va en i18n como "color.<id>". */
export function colorName(c) {
  if (!c) return '';
  const n = c.nombres || {};
  return n[lang] || dict['color.' + c.id] || n.es || c.id;
}

/* ---------- Cabecera y pie comunes ---------- */
export function setupChrome(cfg) {
  // Selector de idioma
  const sel = document.getElementById('lang');
  if (sel) {
    sel.innerHTML = LANGS.map(l => `<option value="${l}">${esc(t('lang.' + l))}</option>`).join('');
    sel.value = lang;
    sel.addEventListener('change', () => setLang(sel.value));
  }

  // Tema: oscuro por defecto; el cambio no se guarda (localStorage solo para carrito e idioma).
  const btn = document.getElementById('theme');
  const label = document.getElementById('theme-label');
  const paintTheme = () => {
    const dark = document.documentElement.dataset.theme !== 'light';
    if (label) label.textContent = t(dark ? 'nav.tema_claro' : 'nav.tema_oscuro');
    if (btn) btn.setAttribute('aria-pressed', String(!dark));
  };
  if (btn) {
    btn.addEventListener('click', () => {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
      paintTheme();
    });
  }
  paintTheme();
  document.addEventListener('sr:lang', paintTheme);

  // Contacto
  const ig = cfg.instagram;
  document.querySelectorAll('.contact-email').forEach(a => {
    a.href = 'mailto:' + cfg.email;
    a.textContent = cfg.email;
  });
  const paintIg = () => {
    document.querySelectorAll('.contact-ig').forEach(a => {
      a.href = 'https://www.instagram.com/' + encodeURIComponent(ig) + '/';
      a.textContent = '@' + ig;
    });
    document.querySelectorAll('.contact-ig-btn').forEach(a => {
      a.href = 'https://www.instagram.com/' + encodeURIComponent(ig) + '/';
      a.textContent = t('cerrado.instagram', { ig });
    });
  };
  paintIg();
  document.addEventListener('sr:lang', paintIg);

  // Contador del carrito
  const paintCount = () => {
    const n = loadCart().items.length;
    const el = document.getElementById('cart-count');
    const link = document.getElementById('cart-link');
    if (el) el.textContent = String(n);
    if (link) link.setAttribute('aria-label', t('nav.pedido_aria', { n }));
  };
  paintCount();
  document.addEventListener('sr:cart', paintCount);
  document.addEventListener('sr:lang', paintCount);
  window.addEventListener('storage', paintCount);
}

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
