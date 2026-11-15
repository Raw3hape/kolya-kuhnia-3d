# SOURCE.md во все папки моделей кухни (web/models/decor/kitchen/<id>/ и наш реквизит web/models/decor/props/<id>/)
# по assets.json (состав, габарит, треугольники — пишет build.py) и products.json (товары, цены, лицензии).
#   python3 tools/decor/kitchen/sources.py
# Пометка «tools/decor/kitchen» в тексте — по ней pack.py узнаёт свои папки в общем props/.
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "web")
A = json.load(open(os.path.join(HERE, "assets.json")))
P = json.load(open(os.path.join(HERE, "products.json")))
IKEA = {p["key"]: p for p in P["ikea"]}
PH = {p["key"]: p for p in P["polyhaven"]}
ART = {p["key"]: p for p in P["art"]}
DATE = "2026-11-15"
FILLED = {"jars-korken-pantry", "bottles-korken-oil", "coffee-press-set"}   # банки с условным содержимым

for aid, a in A.items():
    d = os.path.join(WEB, "models", "decor", a["dest"], aid)
    if not os.path.isdir(d):
        continue
    w, h, dp = (round(v * 100, 1) for v in a["size"])
    kb = os.path.getsize(os.path.join(d, "model.glb")) / 1024
    L = [f"# {aid} — кухня ({'модель зоны kitchen' if a['dest'] == 'kitchen' else 'реквизит'}), источники 3D", ""]
    ik = [k for k in a["sources"] if k in IKEA]
    if ik:
        L.append(f"Товары IKEA (ikea.com/pl, имя, артикул и цена сняты {DATE}):")
        L.append("")
        for k in ik:
            it, n = IKEA[k], a["sources"][k]
            q = f" — {n} шт. в модели" if n > 1 else ""
            pack = f" за упаковку {it['pack']} шт." if it.get("pack") else ""
            L.append(f"- {it['name']} {it['type']}{', ' + it['measure'] if it['measure'] else ''}, {it['finish']}, "
                     f"арт. {it['article']}, {it['price_pln']:g} zł{pack}{q}.")
            L.append(f"  {it['url']}")
            L.append(f"  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/"
                     f"{it['article'].replace('.', '')}-mini.glb`, скачана {DATE}.")
        L += ["", "Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация "
              "квартиры владельца; модель отдельно не распространять и не публиковать.", ""]
    for k in (k for k in a["sources"] if k in PH):
        p = PH[k]
        L.append(f"- {k} ×{a['sources'][k]}: Poly Haven `{p['id']}`, автор {p['author']}, CC0, "
                 f"https://polyhaven.com/a/{p['id']} (glTF 1k, скачана {DATE}).")
    for k in (k for k in a["sources"] if k in ART):
        p = ART[k]
        L.append(f"- Картина: {p['author']}, «{p['title'].rsplit('.', 1)[0]}», {p['date']}. {p['licence']}, "
                 f"Wikimedia Commons: {p['page']} — отпечаток на бумаге с паспарту"
                 f"{' и подписью «' + p['caption'] + '»' if p['caption'] else ''} (`make_art.py`).")
    if aid in FILLED:
        L.append("- Наполнение (крупы, кофе, масло, уксус) — процедурные материалы build.py, CC0, не товар.")
    if aid in FILLED or any(k in PH or k in ART for k in a["sources"]):
        L.append("")
    L += [f"Обработка: `tools/decor/kitchen/build.py` (рецепт `{aid}`) — сырые модели без масштабирования (реальный "
          "размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; "
          "`tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).",
          f"Итог: {w} × {h} × {dp} см (Ш × В × Г), {a['tris']} треугольников, {kb:.0f} КБ; метры, пол Y = 0, "
          "центр следа в 0, перед +Z.", ""]
    open(os.path.join(d, "SOURCE.md"), "w").write("\n".join(L))
    print(a["dest"], aid)
