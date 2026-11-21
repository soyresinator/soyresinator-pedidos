// Soy Resinator · analítica propia (anónima, sin cookies y sin guardar nada en el navegador)
// Cada carga de página es una visita con un identificador aleatorio que vive solo en memoria. Catálogo, carrito y
// pedido están en index.html, así que el recorrido completo queda en la misma visita.
// Se anotan: página (sin parámetros: pedido.html y manual.html llevan códigos en la URL), de dónde viene la visita
// (dominio de origen y utm_*), idioma, tipo de dispositivo, zona horaria, secciones y réplicas vistas, carrito, pedido y
// salida (tiempo visible, hasta dónde bajó y qué había en el carrito). Nada de datos de contacto ni de IP.
// No cuenta: localhost (salvo ?analitica=prueba), navegadores con «No rastrear» o GPC, y quien abra la web con
// ?analitica=off (lo recuerda en este navegador; ?analitica=on lo deshace).
let api = '', sesion = '', cola = [], t0 = 0, enviada = false, prueba = false, activo = false;
let visibleMs = 0, desde = 0, maxScroll = 0, pedidoHecho = false, helpers = {}, salidaHecha = false;
const MAX_COLA = 20;

function rnd() { const a = new Uint8Array(9); crypto.getRandomValues(a); return [...a].map(x => (x % 36).toString(36)).join(''); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }

function dispositivo() {
  const w = Math.min(screen.width || innerWidth, innerWidth || screen.width);
  return w < 640 ? 'movil' : w < 1024 ? 'tablet' : 'pc';
}
function origen() {
  try {
    if (!document.referrer) return '';
    const u = new URL(document.referrer);
    return u.hostname === location.hostname ? '' : u.hostname.replace(/^www\./, '').slice(0, 60);
  } catch (e) { return ''; }
}
function utm() {
  const q = new URLSearchParams(location.search), o = {};
  ['source', 'medium', 'campaign', 'content'].forEach(k => { const v = q.get('utm_' + k); if (v) o[k] = v.slice(0, 40); });
  if (q.get('c')) o.source = o.source || 'correo';   // botón «Ver novedades» de los correos de reseña
  return o;
}
function pagina() { return (location.pathname.replace(/^\/+/, '') || 'index.html') + (location.hash === '#pedido' ? '#pedido' : ''); }

/** Arranca el registro. helpers: { lang(), cart() → { items:[{pid}], total } }. */
export function initAnalitica(cfg, h) {
  const q = new URLSearchParams(location.search);
  if (q.get('analitica') === 'off') lsSet('sr_no_analitica', '1');
  if (q.get('analitica') === 'on') lsSet('sr_no_analitica', null);
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  prueba = q.get('analitica') === 'prueba';
  if (!cfg || !cfg.api_url || /^tools\//.test(cfg.api_url)) return;
  if (lsGet('sr_no_analitica') === '1') return;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1') return;
  if (local && !prueba) return;
  api = cfg.api_url; helpers = h || {}; sesion = rnd(); t0 = Date.now(); activo = true;
  desde = document.visibilityState === 'visible' ? Date.now() : 0;
  ev('vista', { pag: pagina() });
  observarSecciones();
  addEventListener('scroll', medirScroll, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { pausar(); salida(); }
    else { desde = Date.now(); salidaHecha = false; }
  });
  addEventListener('pagehide', () => { pausar(); salida(); });
  addEventListener('hashchange', () => ev('vista', { pag: pagina() }));
  // Enlaces que salen de la web (Instagram, correo…)
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^mailto:/i.test(href)) ev('enlace', { a: 'email' });
    else if (/^https?:/i.test(href)) {
      try { const u = new URL(href); if (u.hostname !== location.hostname) ev('enlace', { a: u.hostname.replace(/^www\./, '').slice(0, 40) }); } catch (err) { /* nada */ }
    }
  }, true);
}

/** Anota un evento. tipo: palabra corta; datos: objeto pequeño con textos o números. */
export function ev(tipo, datos) {
  if (!activo) return;
  if (tipo === 'pedido') pedidoHecho = true;
  cola.push([String(tipo).slice(0, 20), Math.round((Date.now() - t0) / 1000), datos || {}]);
  if (cola.length >= MAX_COLA || tipo === 'pedido') enviar(false);
}

function pausar() { if (desde) { visibleMs += Date.now() - desde; desde = 0; } }
function medirScroll() {
  const h = document.documentElement.scrollHeight - innerHeight;
  const p = h > 0 ? Math.min(100, Math.round(scrollY / h * 100)) : 100;
  if (p > maxScroll) maxScroll = p;
}
/** Al irse (o al pasar a otra pestaña): tiempo visible, scroll y lo que había en el carrito. Una vez por cambio de visibilidad. */
function salida() {
  if (!activo || salidaHecha) return;   // visibilitychange y pagehide llegan juntos al cerrar
  salidaHecha = true;
  const d = { seg: Math.round(visibleMs / 1000), scroll: maxScroll };
  try {
    const c = helpers.cart ? helpers.cart() : null;
    if (c && c.items && c.items.length && !pedidoHecho) { d.carrito = c.items.length; d.pids = c.items.map(i => i.pid).join(',').slice(0, 200); if (c.total) d.total = c.total; }
  } catch (e) { /* nada */ }
  cola.push(['salida', Math.round((Date.now() - t0) / 1000), d]);
  enviar(true);
}

function enviar(alSalir) {
  if (!cola.length || !api) return;
  const cuerpo = { accion: 'ev', s: sesion, e: cola.splice(0, 40) };
  if (!enviada) {
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* nada */ }
    cuerpo.m = { ref: origen(), utm: utm(), lang: helpers.lang ? helpers.lang() : '', dev: dispositivo(), w: innerWidth, tz, pr: prueba ? 1 : 0 };
    enviada = true;
  }
  const txt = JSON.stringify(cuerpo);
  try {
    if (alSalir && navigator.sendBeacon && navigator.sendBeacon(api, new Blob([txt], { type: 'text/plain;charset=utf-8' }))) return;
  } catch (e) { /* probamos con fetch */ }
  fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: txt, keepalive: true }).catch(() => {});
}

/* Secciones y réplicas vistas (una vez cada una por visita) */
function observarSecciones() {
  if (!('IntersectionObserver' in window)) return;
  const vistos = new Set();
  // réplica: cuenta si se ve al menos la mitad de la tarjeta durante 1 s
  const ioProd = new IntersectionObserver(entradas => entradas.forEach(en => {
    const el = en.target, k = 'prod:' + el.dataset.anProd;
    clearTimeout(el._anT);
    if (!en.isIntersecting || vistos.has(k)) return;
    el._anT = setTimeout(() => { if (!vistos.has(k)) { vistos.add(k); ev('prod', { pid: el.dataset.anProd }); } }, 1000);
  }), { threshold: 0.5 });
  // sección: cuenta cuando su parte de arriba llega a la mitad superior de la pantalla (las hay más altas que la pantalla)
  const ioSec = new IntersectionObserver(entradas => entradas.forEach(en => {
    const k = 'sec:' + en.target.dataset.anSec;
    if (!en.isIntersecting || vistos.has(k)) return;
    vistos.add(k); ev('seccion', { id: en.target.dataset.anSec });
  }), { rootMargin: '0px 0px -50% 0px', threshold: 0 });
  const io = { observe: el => (el.dataset.anProd ? ioProd : ioSec).observe(el) };
  const marcar = () => {
    document.querySelectorAll('main section[id], main section[aria-labelledby], section.collection').forEach(s => {
      if (s.dataset.anObs) return;
      s.dataset.anSec = s.id || s.getAttribute('aria-labelledby') || '';
      if (!s.dataset.anSec) return;
      s.dataset.anObs = '1'; io.observe(s);
    });
    document.querySelectorAll('article.card[id^="p-"]').forEach(c => {
      if (c.dataset.anObs) return;
      c.dataset.anProd = c.id.slice(2); c.dataset.anObs = '1'; io.observe(c);
    });
  };
  marcar();
  // el catálogo se pinta después de cargar los datos: volvemos a mirar cuando cambia el DOM
  new MutationObserver(() => { clearTimeout(marcar._t); marcar._t = setTimeout(marcar, 300); }).observe(document.body, { childList: true, subtree: true });
}
