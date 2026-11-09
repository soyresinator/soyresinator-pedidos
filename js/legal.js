// Soy Resinator · privacidad.html, condiciones.html y aviso-legal.html
// Los textos salen de legal/<idioma>.json; los datos de la titular, de data/config.json ("legal").
import * as C from './core.js?v=20261110';

let cfg = null;
const doc = document.body.dataset.legal; // "privacidad" | "condiciones" | "aviso"

async function main() {
  const [c] = await Promise.all([C.loadJSON('data/config.json'), C.initI18n()]);
  cfg = c;
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
    email: cfg.email, instagram: '@' + cfg.instagram
  };
  const sub = s => C.esc(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? C.esc(vars[k]) : m));

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
    return `<section>
      <h2>${sub(s.h)}</h2>
      ${p0 ? par(p0) : ''}
      ${s.ul ? `<ul>${s.ul.map(li => `<li>${sub(li)}</li>`).join('')}</ul>` : ''}
      ${resto.map(par).join('')}
    </section>`;
  }).join('');
}

main();
