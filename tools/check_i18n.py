"""Comprueba que los cinco idiomas tienen las mismas claves, sin huecos,
que todas las claves usadas en HTML, JS y catalog.json existen,
y que no hay rayas largas en los textos.

Uso:  python -I tools/check_i18n.py   (desde la raiz del repositorio)
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANGS = ["en", "es", "de", "fr", "it"]
errors = []

dicts = {}
for l in LANGS:
    dicts[l] = json.loads((ROOT / "i18n" / f"{l}.json").read_text(encoding="utf-8"))

base = set(dicts["en"])
for l in LANGS:
    keys = set(dicts[l])
    for k in sorted(base - keys):
        errors.append(f"{l}: falta la clave {k}")
    for k in sorted(keys - base):
        errors.append(f"{l}: clave de mas {k} (no esta en en.json)")
    for k, v in dicts[l].items():
        if not isinstance(v, str) or not v.strip():
            errors.append(f"{l}: {k} esta vacia")
        elif "—" in v or "–" in v:
            errors.append(f"{l}: {k} lleva raya larga")
    # Las variables {x} deben coincidir con las de en.json
    for k in base & keys:
        a = set(re.findall(r"\{(\w+)\}", dicts["en"][k]))
        b = set(re.findall(r"\{(\w+)\}", dicts[l][k]))
        if a != b:
            errors.append(f"{l}: {k} usa variables {sorted(b)} y en.json {sorted(a)}")

used = set()
for f in list(ROOT.glob("*.html")) + list((ROOT / "js").glob("*.js")):
    txt = f.read_text(encoding="utf-8")
    if f.suffix == ".js":
        # quitamos comentarios para no contar ejemplos
        txt = re.sub(r"/\*.*?\*/", "", txt, flags=re.S)
        txt = re.sub(r"^\s*//.*$", "", txt, flags=re.M)
    used |= set(re.findall(r'data-i18n="([\w.]+)"', txt))
    for attr in re.findall(r'data-i18n-attr="([^"]+)"', txt):
        used |= {p.split(":")[1].strip() for p in attr.split(";") if ":" in p}
    used |= set(re.findall(r"\bt\('([\w.]+)'\s*[,)]", txt))

cat = json.loads((ROOT / "data" / "catalog.json").read_text(encoding="utf-8"))
for p in cat["productos"]:
    used |= set(p["incluye"])
    used |= {pt["etiqueta"] for pt in p["partes"]}
used |= {f"lang.{l}" for l in LANGS}

# Textos legales: misma estructura en los cinco idiomas, sin rayas largas y mismas variables
def forma(doc):
    return [(len(s.get("p", [])), len(s.get("ul", []))) for s in doc["secciones"]]

def textos(doc):
    for s in doc["secciones"]:
        yield s["h"]
        yield from s.get("p", [])
        yield from s.get("ul", [])

legal = {l: json.loads((ROOT / "legal" / f"{l}.json").read_text(encoding="utf-8")) for l in LANGS}
for nombre in ("privacidad", "condiciones", "aviso"):
    ref = legal["es"][nombre]
    vars_ref = sorted(set(re.findall(r"\{(\w+)\}", " ".join(textos(ref)))))
    for l in LANGS:
        doc = legal[l][nombre]
        if forma(doc) != forma(ref):
            errors.append(f"legal/{l}.json: {nombre} no tiene la misma estructura que es.json")
        todo = " ".join(textos(doc))
        if "—" in todo or "–" in todo:
            errors.append(f"legal/{l}.json: {nombre} lleva raya larga")
        if sorted(set(re.findall(r"\{(\w+)\}", todo))) != vars_ref:
            errors.append(f"legal/{l}.json: {nombre} usa variables distintas de es.json")

for k in sorted(used - base):
    errors.append(f"clave usada y no definida: {k}")
unused = sorted(base - used)

if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"OK: {len(base)} claves en {len(LANGS)} idiomas, {len(used)} usadas.")
if unused:
    print("Definidas y aun sin usar:", ", ".join(unused))
