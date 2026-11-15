# SOURCE.md во все папки моделей балкона (web/models/decor/balcony/<id>/ и наш реквизит web/models/decor/props/<id>/)
# по assets.json (габарит, треугольники — пишет build.py) и products.json (товары, цены, ссылки).
#   python3 tools/decor/balcony/sources.py
# Пометка «tools/decor/balcony» в тексте — по ней pack.py узнаёт свои папки в общем props/.
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "web")
A = json.load(open(os.path.join(HERE, "assets.json")))
P = json.load(open(os.path.join(HERE, "products.json")))
IKEA = {p["key"]: p for p in P["ikea"]}
MADE = {p["key"]: p for p in P["made"]}
DATE = "2026-11-15"

# модель -> (товары с 3D IKEA, товары, смоделированные по карточке, как сделано)
SRC = {
    "nammaro-module": (["nammaro-seat-63", "nammaro-back-60", "kuddarna-seat-62", "kuddarna-back-62"], [],
                       "секция сиденья + спинка + подушки KUDDARNA собраны в один модуль дивана (2 модуля = диван 126 см)"),
    "nammaro-bench": (["nammaro-bench", "kuddarna-chair-44"], [], "скамья + 2 подушки KUDDARNA 44 на сиденье"),
    "nammaro-armchair": (["nammaro-armchair", "kuddarna-chair-44"], [], "кресло + подушка KUDDARNA 44 на сиденье"),
    "nammaro-stool": (["nammaro-stool"], [], ""),
    "nammaro-table-75": (["nammaro-table-75"], [], ""),
    "tarno-table": (["tarno-table"], [], ""),
    "tarno-chair": (["tarno-chair"], [], ""),
    "asparen": (["asparen"], [], ""),
    "nypon-32": (["nypon-32"], [], ""),
    "morum-160": (["morum-160"], [], "сплющен до 5 мм (AR-модель с мятой геометрией)"),
    "lydersholm-160": (["lydersholm-160"], [], "сплющен до 5 мм"),
    "lattbetong-160": (["lattbetong-160"], [], "сплющен до 5 мм"),
    "lantern-borrby-28": (["borrby-28"], ["smalom-14"], "внутри — свеча SMÅLOM 14 см (цилиндр, светящийся огонёк)"),
    "lantern-borrby-20": (["borrby-20"], ["smalom-9"], "внутри — свеча SMÅLOM 9 см"),
    "lantern-berggran-34": (["berggran-34"], ["smalom-19"], "внутри — свеча SMÅLOM 19 см"),
    "runnen-akacja": ([], ["runnen-akacja"], "плоскость на всю зону прогулки, толщина 2 см, текстура «плетёнка» 30 × 30 "
                      "(tools/decor/balcony/make_tex.py)"),
    "runnen-trawa": ([], ["runnen-trawa"], "то же, текстура искусственной травы"),
    "svartra-festoon": ([], ["svartra"], "12 ламп-шаров на провисающем проводе, лампы светятся (emissive), без источника света"),
    "getkal-railing": ([], ["getkal"], "провод спиралью вокруг поручня, огоньки каждые 10 см (emissive)"),
    "vinterfint-fir-150": ([], ["vinterfint-150", "strala-mikro"], "процедурная ёлка Ø 51 см, 56 тёплых огоньков (emissive)"),
    "vinterfint-fir-84": ([], ["vinterfint-84"], "процедурная ёлочка в горшке 15 см"),
    "vinterfint-pine-bunch": ([], ["vinterfint-galazka"], "пучок сосновых веток"),
    "fejka-lavender": ([], ["fejka-lawenda"], "процедурная лаванда в белом прямоугольном горшке"),
    "cushion-tofto-50": ([], ["tofto", "inner-50"], "подушка 50 × 50 в наволочке TOFTÖ (текстура make_tex.py)"),
    "throw-klippoxel": ([], ["klippoxel"], "сложенный плед 42 × 30 см (текстура make_tex.py)"),
    "sheepskin-toftlund-drape": (["toftlund"], [], "AR-модель изогнута: лежит на сиденье и свисает за переднюю кромку"),
}
LIC = ("Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры "
       "владельца; модель отдельно не распространять и не публиковать.")


def line(it):
    return (f"- {it['name']} {it['type']}, {it['measure']}{', ' + it['finish'] if it.get('finish') else ''}, "
            f"арт. {it['article']}, {it['price_pln']:g} zł.\n  {it['url']}")


for aid, a in A.items():
    d = os.path.join(WEB, "models", "decor", a["dest"], aid)
    if not os.path.isdir(d):
        continue
    ik, made, how = SRC[aid]
    w, h, dp = (round(v * 100, 1) for v in a["size"])
    kb = os.path.getsize(os.path.join(d, "model.glb")) // 1024
    L = [f"# {aid} — балкон ({'модель зоны balcony' if a['dest'] == 'balcony' else 'реквизит'}), источники 3D", ""]
    if ik:
        L += [f"Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты {DATE}):", ""]
        for k in ik:
            L.append(line(IKEA[k]))
            L.append(f"  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/"
                     f"{IKEA[k]['article'].replace('.', '')}-mini.glb`, скачана {DATE}.")
        L += ["", LIC, ""]
    if made:
        L += [f"Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты {DATE}):", ""]
        L += [line(MADE[k]) for k in made]
        L += ["", "Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.", ""]
    L += [f"- Габарит (Ш × В × Г): {w} × {h} × {dp} см — реальный масштаб, {a['tris']} треугольников, {kb} КБ.",
          f"- Сборка: tools/decor/balcony/build.py ({how + '; ' if how else ''}метры, низ 0, центр следа 0, перед +Z; "
          "остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).",
          "- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.", ""]
    open(os.path.join(d, "SOURCE.md"), "w").write("\n".join(L))
    print("SOURCE.md", a["dest"], aid)
# миниатюры опций зоны
open(os.path.join(WEB, "models", "decor", "balcony", "thumbs", "SOURCE.md"), "w").write(
    "# Миниатюры опций балкона\n\nРисует tools/decor/balcony/compose.py (летний состав опции, Blender: "
    "tools/decor/living/preview.py, режим thumb); настил — кусок текстуры из tools/decor/balcony/make_tex.py. "
    "Свои, без лицензионных ограничений, кроме видимых в них моделей IKEA (только личная визуализация).\n")
