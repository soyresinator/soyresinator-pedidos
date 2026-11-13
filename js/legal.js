// Soy Resinator · páginas de texto: privacidad, condiciones, aviso legal, preguntas frecuentes, envíos,
// devoluciones y contacto. Los textos salen de legal/<idioma>.json; los datos de la titular, de
// data/config.json ("legal"), y la lista de países con tarifa, de data/shipping.json.
import * as C from './core.js?v=20261113';

let cfg = null;
let ship = null;
// "privacidad" | "condiciones" | "aviso" | "faq" | "envios" | "devoluciones" | "contacto"
const doc = document.body.dataset.legal;

async function main() {
  const [c, s] = await Promise.all([C.loadJSON('data/config.json'), C.loadJSON('data/shipping.json').catch(() => null), C.initI18n()]);
  cfg = c;
  ship = s;
  C.applyI18n();
  C.setupChrome(cfg);
  await pintar();
  document.addEventListener('sr:lang', pintar);
}

async function pintar() {
  const lang = C.getLang();
  const data = await C.loadJSON(`legal/${lang}.json`).catch(() => C.loadJSON('legal/en.json'));
  const d = data[doc];
  const L = cfg.legal || {};
  const vars = {
    titular: L.titular, nif: L.nif, domicilio: L.domicilio,
    dias_pago: L.dias_pago, dias_incidencias: L.dias_incidencias,
    email: cfg.email, instagram: '@' + cfg.instagram,
    paises: paisesConTarifa()
  };
  // Correo y teléfono salen como enlaces (en el móvil, tocar el número abre la llamada).
  const tel = String(cfg.telefono || '');
  const enlaces = {
    email: cfg.email ? `<a href="mailto:${C.esc(cfg.email)}">${C.esc(cfg.email)}</a>` : undefined,
    telefono: tel ? `<a href="tel:${C.esc(tel.replace(/[^\d+]/g, ''))}">${C.esc(tel)}</a>` : undefined
  };
  const sub = s => C.esc(s).replace(/\{(\w+)\}/g, (m, k) =>
    (enlaces[k] !== undefined ? enlaces[k] : vars[k] !== undefined ? C.esc(vars[k]) : m));

  document.title = `${d.titulo} · Soy Resinator`;
  document.getElementById('legal-titulo').textContent = d.titulo;
  const fechaTxt = L.actualizado
    ? new Date(L.actualizado + 'T12:00:00').toLocaleDateString(C.locale(), { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  document.getElementById('legal-fecha').textContent = fechaTxt ? C.t('legal.actualizado', { fecha: fechaTxt }) : '';

  // Orden de cada sección: primer párrafo, lista (si hay) y el resto de párrafos.
  // Un párrafo que empieza por "## " es un subtítulo (h3).
  const par = p => (p.startsWith('## ') ? `<h3>${sub(p.slice(3))}</h3>` : `<p>${sub(p)}</p>`);
  document.getElementById('legal-cuerpo').innerHTML = d.secciones.map(s => {
    const [p0, ...resto] = s.p || [];
    return `<section${s.id ? ` id="${C.esc(s.id)}"` : ''}>
      <h2>${sub(s.h)}</h2>
      ${p0 ? par(p0) : ''}
      ${s.ul ? `<ul>${s.ul.map(li => `<li>${sub(li)}</li>`).join('')}</ul>` : ''}
      ${resto.map(par).join('')}
    </section>`;
  }).join('');
  // Enlaces con ancla (p. ej. faq.html#no-funcional): el destino no existía al cargar la página.
  if (location.hash) {
    const t = document.getElementById(location.hash.slice(1));
    if (t) t.scrollIntoView();
  }
}

/** Países con tarifa fija, en el idioma de la página y en orden alfabético. */
function paisesConTarifa() {
  if (!ship) return '';
  const nombres = ship.paises.filter(p => !p.envio_a_consultar).map(p => C.countryName(p));
  return nombres.sort((a, b) => a.localeCompare(b, C.locale())).join(', ');
}

main();
