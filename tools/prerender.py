"""Soy Resinator · prerender para SEO.

La web pinta los textos con JavaScript. Este script deja escrito en el HTML el contenido
en inglés (idioma por defecto), para que Google y las redes sociales lo vean sin ejecutar JS:
  - <title>, description, canonical, Open Graph y Twitter Card de cada página
  - los textos data-i18n de cada página
  - el catálogo de index.html (tarjetas estáticas) y los datos estructurados JSON-LD
  - sitemap.xml con la fecha de hoy
Al cargar, el JavaScript sustituye todo esto por la versión en el idioma del visitante.

Uso (desde la carpeta del proyecto), SIEMPRE antes de subir cambios de textos o del catálogo:
    python -I tools/prerender.py
Se puede repetir las veces que haga falta: el resultado es el mismo.
"""
import datetime, html, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://soyresinator.com/"
LANG = "en"
IG = "https://www.instagram.com/soyresinator/"
EMAIL = "soyresinator@gmail.com"

en = json.loads((ROOT / "i18n" / f"{LANG}.json").read_text(encoding="utf-8"))
legal = json.loads((ROOT / "legal" / f"{LANG}.json").read_text(encoding="utf-8"))
cat = json.loads((ROOT / "data" / "catalog.json").read_text(encoding="utf-8"))
ship = json.loads((ROOT / "data" / "shipping.json").read_text(encoding="utf-8"))
# Países con tarifa fija (los "a consultar" no se anuncian a Google)
PAISES_ENVIO = [p for p in ship["paises"] if not p.get("envio_a_consultar")]
# Plazo de fabricación por encargo (días desde el pago) y de transporte (días)
PREPARACION = (21, 35)
TRANSITO_UE, TRANSITO_FUERA = (2, 7), (5, 15)
productos = [p for p in cat["productos"] if not p.get("oculto")]
esc = lambda s: html.escape(str(s), quote=True)

LEGAL_DESC = {
    "privacidad": "How Soy Resinator handles the personal data you share when you place an order.",
    "condiciones": "Terms of sale for Soy Resinator replicas: orders, payment, production times, shipping and returns.",
    "aviso": "Legal notice and owner details of soyresinator.com.",
}
PAGINAS = {
    "index.html": dict(url=SITE, titulo=en["meta.index.titulo"], desc=en["meta.index.desc"], indexar=True),
    "pedido.html": dict(url=SITE + "pedido.html", titulo=en["meta.pedido.titulo"], desc=en["meta.pedido.desc"], indexar=False),
    "condiciones.html": dict(url=SITE + "condiciones.html", titulo=legal["condiciones"]["titulo"] + " · Soy Resinator",
                             desc=LEGAL_DESC["condiciones"], indexar=True),
    "privacidad.html": dict(url=SITE + "privacidad.html", titulo=legal["privacidad"]["titulo"] + " · Soy Resinator",
                            desc=LEGAL_DESC["privacidad"], indexar=True),
    "aviso-legal.html": dict(url=SITE + "aviso-legal.html", titulo=legal["aviso"]["titulo"] + " · Soy Resinator",
                             desc=LEGAL_DESC["aviso"], indexar=True),
}
IMG_COMPARTIR = SITE + "img/logo/logo-dorado-compartir.png"


def money(n):
    n = float(n)
    return "€" + (f"{n:.0f}" if n == int(n) else f"{n:.2f}")


def bloque(texto, nombre, contenido, indent="  "):
    """Sustituye lo que haya entre <!-- nombre --> y <!-- /nombre -->."""
    patron = re.compile(rf"<!-- {nombre} -->.*?<!-- /{nombre} -->", re.S)
    nuevo = f"<!-- {nombre} -->\n{contenido}\n{indent}<!-- /{nombre} -->"
    if not patron.search(texto):
        raise SystemExit(f"Falta el marcador <!-- {nombre} --> en el HTML")
    return patron.sub(lambda m: nuevo, texto, count=1)


def cabecera(pag):
    i = "  "
    lineas = [
        f'<title>{esc(pag["titulo"])}</title>',
        f'<meta name="description" content="{esc(pag["desc"])}">',
    ]
    if pag["indexar"]:
        lineas.append(f'<link rel="canonical" href="{pag["url"]}">')
    else:
        lineas.append('<meta name="robots" content="noindex">')
    lineas += [
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Soy Resinator">',
        f'<meta property="og:title" content="{esc(pag["titulo"])}">',
        f'<meta property="og:description" content="{esc(pag["desc"])}">',
        f'<meta property="og:url" content="{pag["url"]}">',
        f'<meta property="og:image" content="{IMG_COMPARTIR}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{esc(pag["titulo"])}">',
        f'<meta name="twitter:description" content="{esc(pag["desc"])}">',
        f'<meta name="twitter:image" content="{IMG_COMPARTIR}">',
    ]
    return "\n".join(i + l for l in lineas)


def textos(texto):
    """Rellena los elementos vacíos o ya rellenados con data-i18n="clave" (sin etiquetas dentro)."""
    def rep(m):
        clave = m.group(3)
        v = en.get(clave)
        if v is None or "{" in v:
            return m.group(0)
        return m.group(1) + esc(v) + m.group(5)
    return re.sub(r'(<(\w+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([^<]*)(</\2>)', rep, texto)


def catalogo():
    out = []
    for col in cat["colecciones"]:
        prods = [p for p in productos if p["coleccion"] == col["id"]]
        if not prods:
            continue
        cards = []
        for p in prods:
            img = ""
            if (ROOT / "img" / f'{p["id"]}-1.webp').exists():
                img = (f'<div class="media"><img src="img/{p["id"]}-1.webp" alt="{esc(p["nombre"])}" '
                       f'loading="lazy" decoding="async" width="1200" height="675"></div>')
            inc = "".join(f"<li>{esc(en.get(k, k))}</li>" for k in p["incluye"])
            cards.append(
                f'          <article class="card" id="p-{p["id"]}">{img}<div class="card-body">'
                f'<h4>{esc(p["nombre"])}</h4>'
                + (f'<p class="card-desc">{esc(en["desc." + p["id"]])}</p>' if "desc." + p["id"] in en else "") +
                f'<div class="price-row"><span class="price">{money(p["pvp"])}</span></div>'
                f'<ul class="includes">{inc}</ul></div></article>')
        out.append(
            f'        <section class="collection" aria-labelledby="col-{col["id"]}">\n'
            f'          <h3 class="collection-title" id="col-{col["id"]}">{esc(col["nombre"])}</h3>\n'
            f'          <div class="grid">\n' + "\n".join(cards) + "\n          </div>\n        </section>")
    return "\n".join(out)


def jsonld():
    org = {"@type": "Organization", "@id": SITE + "#org", "name": "Soy Resinator", "url": SITE,
           "logo": SITE + "img/logo/icono-512.png", "email": EMAIL, "sameAs": [IG]}
    web = {"@type": "WebSite", "@id": SITE + "#web", "name": "Soy Resinator", "url": SITE,
           "publisher": {"@id": SITE + "#org"}, "inLanguage": ["en", "es", "pt", "de", "fr", "it"]}
    # Envío de UNA réplica por país (precio_1 de shipping.json), compartido por todas las ofertas vía @id.
    dias = lambda a, b: {"@type": "QuantitativeValue", "minValue": a, "maxValue": b, "unitCode": "DAY"}
    envios = [{
        "@type": "OfferShippingDetails", "@id": SITE + f'#envio-{p["code"]}',
        "shippingRate": {"@type": "MonetaryAmount", "value": f'{float(p["precio_1"]):.2f}', "currency": "EUR"},
        "shippingDestination": {"@type": "DefinedRegion", "addressCountry": p["code"]},
        "deliveryTime": {"@type": "ShippingDeliveryTime", "handlingTime": dias(*PREPARACION),
                         "transitTime": dias(*(TRANSITO_UE if p["ue"] else TRANSITO_FUERA))},
    } for p in PAISES_ENVIO]
    # Devoluciones (condiciones de venta): 14 días desde la entrega con los colores de serie,
    # por correo, gastos de devolución a cargo del cliente. Los colores personalizados no admiten desistimiento.
    devol = {"@type": "MerchantReturnPolicy", "@id": SITE + "#devoluciones",
             "applicableCountry": [p["code"] for p in PAISES_ENVIO],
             "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
             "merchantReturnDays": 14, "returnMethod": "https://schema.org/ReturnByMail",
             "returnFees": "https://schema.org/ReturnFeesCustomerResponsibility",
             "refundType": "https://schema.org/FullRefund",
             "itemCondition": "https://schema.org/NewCondition",
             "merchantReturnLink": SITE + "condiciones.html"}
    org["hasMerchantReturnPolicy"] = {"@id": devol["@id"]}
    prods = []
    for p in productos:
        inc = ", ".join(en.get(k, k) for k in p["incluye"])
        prod = {
            "@type": "Product", "@id": SITE + f'#p-{p["id"]}', "name": p["nombre"], "sku": p["id_replica"],
            "brand": {"@type": "Brand", "name": "Soy Resinator"},
            "description": (en.get("desc." + p["id"], "") +
                f" Life-size display replica, 3D printed to order in Spain and shipped as a kit. Includes: {inc}.").strip(),
            "offers": {"@type": "Offer", "price": f'{float(p["pvp"]):.2f}', "priceCurrency": "EUR",
                       # Google no acepta MadeToOrder: se puede pedir ya; el plazo va en handlingTime.
                       "availability": "https://schema.org/InStock",
                       "itemCondition": "https://schema.org/NewCondition",
                       "url": SITE + f'#p-{p["id"]}', "seller": {"@id": SITE + "#org"},
                       "shippingDetails": [{"@id": e["@id"]} for e in envios],
                       "hasMerchantReturnPolicy": {"@id": devol["@id"]}},
        }
        if (ROOT / "img" / f'{p["id"]}-1.webp').exists():
            prod["image"] = SITE + f'img/{p["id"]}-1.webp'
        prods.append(prod)
    data = {"@context": "https://schema.org", "@graph": [org, web, devol] + envios + prods}
    txt = json.dumps(data, ensure_ascii=False, indent=1).replace("</", "<\\/")
    return f'  <script type="application/ld+json">\n{txt}\n  </script>'


hoy = datetime.date.today().isoformat()
for nombre, pag in PAGINAS.items():
    ruta = ROOT / nombre
    t = ruta.read_text(encoding="utf-8")
    t = bloque(t, "seo", cabecera(pag))
    t = textos(t)
    if nombre == "index.html":
        t = bloque(t, "prerender:catalogo", catalogo(), indent="        ")
        t = bloque(t, "jsonld", jsonld())
    ruta.write_text(t, encoding="utf-8", newline="\n")

urls = [p["url"] for p in PAGINAS.values() if p["indexar"]]
(ROOT / "sitemap.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    "".join(f"  <url><loc>{u}</loc><lastmod>{hoy}</lastmod></url>\n" for u in urls) +
    "</urlset>\n", encoding="utf-8", newline="\n")
print(f"OK: {len(PAGINAS)} páginas, {len(productos)} productos, sitemap con {len(urls)} URLs ({hoy})")
