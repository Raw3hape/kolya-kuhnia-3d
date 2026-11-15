# Каталог зоны «Кухня» -> web/spec/decor/kitchen.json (+ миниатюры опций web/models/decor/kitchen/thumbs/).
#   python3 tools/decor/kitchen/compose.py [--no-thumbs]
# Раскладки — здесь, а не в JSON. Габариты моделей и состав (что из каких товаров собрано) — assets.json
# (пишет build.py), цены и артикулы — products.json. Порядок слотов и опций = код варианта: новое только в конец.
#
# Геометрия кухни (web/spec/kitchen.json, web/js/model.js): ряд вдоль стены X = 0 от шахты (Z 2.769) к окну (Z 0),
# столешница 0.90, глубина 0.62; фартук 12 мм до высоты 1.5 (state.backsplash = none — полки ниже 1.5 «висят» в 12 мм).
# Модули от шахты: холодильник Z 2.169–2.769, мойка 1.569–2.169 (вырез 1.619–2.119, смеситель Z 1.869 до 1.32),
# 0.45 Z 1.119–1.569, варочная 0.519–1.119 (на ней ничего), торцевой 0–0.519. Окно на стене Z 0: X 0.69–1.89.
# Шахта X 0–0.6013, Z 2.769–3.68: её грань X 0.6013 смотрит в гостиную. Остров X 1.78–2.38, Z 0.24–2.04, верх 0.90
# (по умолчанию; двигается ползунками — части с "anchor": "island" едут следом). Светильники над островом — низ 1.62.
import json, math, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
WEB = os.path.join(ROOT, "web")
A = json.load(open(os.path.join(HERE, "assets.json")))
P = json.load(open(os.path.join(HERE, "products.json")))
IKEA = {p["key"]: p for p in P["ikea"]}

TOP = 0.90                    # столешница ряда и острова
SPLASH, SPLASH_TOP = 0.012, 1.5
SHAFT_X = 0.6013              # грань шахты, смотрит в +X
ISL_X, ISL_Z1 = 2.08, 2.04    # ось острова и его торец к прихожей (по умолчанию)
# Чужой общий реквизит (web/models/decor/props, не наш): габарит [Ш, В, Г] и смещение следа от начала модели.
EXT = {
    "plant-pothos-terracotta": [0.258, 0.205, 0.262],   # начало — центр горшка; плети свисают вперёд (+Z) и вниз до −0.28
    "books-row-s": [0.21, 0.229, 0.174],
    "books-stack-l": [0.342, 0.11, 0.258],
}


def size_of(mid):
    return A[mid]["size"] if mid in A else EXT[mid]


def model(mid):
    dest = A[mid]["dest"] if mid in A else "props"
    return f"models/decor/{dest}/{mid}/model.glb"


def part(mid, x, y, z, rot, **extra):
    return {"model": model(mid), "pos": [round(x, 4), round(y, 4), round(z, 4)], "rot": rot, **extra}


def wall_x(y):
    """Плоскость стены X = 0 на высоте y: ниже верха фартука — его лицо."""
    return SPLASH if y < SPLASH_TOP else 0.0


def on_wall(mid, z, y, back=0.0):
    """Вещь у стены X = 0 лицом в +X: z — центр вдоль стены, y — низ, back — зазор до стены."""
    return part(mid, wall_x(y) + back + size_of(mid)[2] / 2, y, z, 90)


def on_shelf(shelf_y, mid, z, y, back=0.01):
    """Вещь на полке у стены X = 0 (shelf_y — низ полки: по нему видно, есть ли за ней фартук)."""
    return part(mid, wall_x(shelf_y) + back + size_of(mid)[2] / 2, y, z, 90)


def plant_on(shelf_y, shelf_depth, z, y):
    """Потос на краю полки: горшок в 7.5 см от переднего края, плети свешиваются."""
    return part("plant-pothos-terracotta", wall_x(shelf_y) + shelf_depth - 0.075, y, z, 90)


# ---------- цена, состав, размер опции ----------
def bill(parts):
    cnt = {}
    for p in parts:
        mid = p["model"].split("/")[-2]
        for k, n in (A[mid]["sources"] if mid in A else {}).items():
            if k in IKEA:
                cnt[k] = cnt.get(k, 0) + n
    lines, total = [], 0.0
    for k, n in cnt.items():
        it = IKEA[k]
        packs = math.ceil(n / it.get("pack", 1))
        total += packs * it["price_pln"]
        q = f" ×{packs} уп. по {it['pack']}" if it.get("pack") else (f" ×{n}" if n > 1 else "")
        lines.append(f"{it['name']} {it['type']}{', ' + it['measure'] if it['measure'] else ''}, {it['finish']}{q} — "
                     f"{it['price_pln']:g} zł")
    return round(total, 2), lines


def option_size(parts):
    """Ш × В × Г всей опции в осях первой части (перед в +Z)."""
    r0 = math.radians(parts[0]["rot"])
    xs, ys, zs = [], [], []
    for p in parts:
        w, h, d = size_of(p["model"].split("/")[-2])
        r = math.radians(p["rot"])
        hx = abs(math.cos(r)) * w / 2 + abs(math.sin(r)) * d / 2   # полуразмеры следа в мировых осях
        hz = abs(math.sin(r)) * w / 2 + abs(math.cos(r)) * d / 2
        for sx in (-1, 1):
            for sz in (-1, 1):
                x, z = p["pos"][0] + sx * hx, p["pos"][2] + sz * hz
                # в оси первой части: повернуть на −rot0
                xs.append(x * math.cos(r0) - z * math.sin(r0))
                zs.append(x * math.sin(r0) + z * math.cos(r0))
        ys += [p["pos"][1], p["pos"][1] + h]
    return [round(max(xs) - min(xs), 3), round(max(ys) - min(ys), 3), round(max(zs) - min(zs), 3)]


def option(oid, name, main, parts, note, **extra):
    total, lines = bill(parts)
    it = IKEA[main]
    o = {"id": oid, "name": name, "brand": "IKEA", "article": it["article"], "url": it["url"],
         "price_pln": total, "finish": it["finish"],
         "note": " · ".join(lines) + ". " + note + " Модели IKEA (rotera) — только для личной визуализации.",
         "size": option_size(parts)}
    o.update(extra)
    o["parts"] = parts
    return o


NONE = {"id": "none", "name": "Нет"}
slots = []

# ---------- 1. Открытые полки над мойкой и холодильником (стена X = 0, Z 1.569–2.769) ----------
# Две полки: нижняя — верх 1.47 (57 см над столешницей), верхняя — верх 1.89. Под кронштейнами верхней полки
# у нижней остаётся 17 см: высокое (тарелки на ребре) — только между кронштейнами (legs в assets.json).
def two_shelves(sid, zc, items_lo, items_hi):
    top = A[sid]["tops"][0][0]
    d = A[sid]["size"][2]
    lo, hi = 1.47 - top, 1.89 - top
    parts = [on_wall(sid, zc, lo), on_wall(sid, zc, hi)]
    for mid, z in items_lo:
        parts.append(on_shelf(lo, mid, z, 1.47, back=0.004 if mid == "plates-lean-silversida" else 0.03))
    for mid, z in items_hi:
        parts.append(plant_on(hi, d, z, 1.89) if mid == "plant-pothos-terracotta" else
                     on_shelf(hi, mid, z, 1.89, back=0.004 if mid == "books-row-s" else 0.03))
    return parts


LO = [("jars-korken-pantry", 1.80), ("bowls-stack-godmiddag", 2.10), ("plates-lean-silversida", 2.45)]
HI = [("plant-pothos-terracotta", 1.72), ("plates-stack-godmiddag", 2.00), ("mugs-daggaster-fargklar", 2.29),
      ("books-row-s", 2.60)]
SHELF_NOTE = ("Две полки 120 см над мойкой и холодильником, от шахты: верх 1.47 и 1.89 м. На полках — тарелки, "
              "миски, кружки и банки KORKEN с крупами (товары IKEA, в цене), потос и книги — условный реквизит (CC0).")
lack_parts = [on_wall("lack-110", 2.219, 1.47 - 0.052), on_wall("lack-110", 2.219, 1.89 - 0.052)]
for mid, z in [("jars-korken-pantry", 1.89), ("bowls-stack-godmiddag", 2.20), ("plates-lean-silversida", 2.55)]:
    lack_parts.append(on_shelf(1.418, mid, z, 1.47, back=0.004 if mid == "plates-lean-silversida" else 0.03))
lack_parts += [plant_on(1.838, 0.263, 1.80, 1.89), on_shelf(1.838, "plates-stack-godmiddag", 2.07, 1.89, 0.0),
               on_shelf(1.838, "mugs-daggaster-fargklar", 2.36, 1.89, 0.03), on_shelf(1.838, "books-row-s", 2.64, 1.89, 0.004)]
# KUNGSFORS: рейка на стене, три полки (низ 1.314: верха 1.47 / 1.71 / 1.95). Сдвинута к шахте: стойка не над смесителем.
K0, KZ = 1.47 - min(t[0] for t in A["kungsfors-shelves-60"]["tops"]), 2.40
kung_parts = [on_wall("kungsfors-shelves-60", KZ, K0),
              on_shelf(K0, "jars-korken-pantry", KZ, 1.47, 0.03),
              on_shelf(K0, "plates-stack-godmiddag", KZ - 0.14, 1.71, 0.03),
              on_shelf(K0, "bowls-stack-godmiddag", KZ + 0.18, 1.71, 0.05),
              plant_on(K0, 0.32, KZ - 0.15, 1.95),
              on_shelf(K0, "mugs-daggaster-fargklar", KZ + 0.16, 1.95, 0.05)]
slots.append({"id": "shelves", "label": "Открытые полки", "default": "tranhult", "options": [
    NONE,
    option("tranhult", "TRANHULT / SANDSHULT ×2, osika — тёплые деревянные полки", "tranhult-sandshult-120",
           two_shelves("tranhult-sandshult-120", 2.169, LO, HI), SHELF_NOTE),
    option("bergshult", "BERGSHULT / SANDSHULT ×2, biały/osika — белые полки", "bergshult-sandshult-120",
           two_shelves("bergshult-sandshult-120", 2.169, LO, HI), SHELF_NOTE),
    option("lack", "LACK ×2, biały — парящие полки без кронштейнов", "lack-110", lack_parts,
           "Две полки 110 см без видимого крепежа, верх 1.47 и 1.89 м. На полках посуда и банки (в цене), "
           "потос и книги — условный реквизит (CC0)."),
    option("kungsfors", "KUNGSFORS 60, stal nierdz/jesion — рейка с полками", "kungsfors-shelves-60", kung_parts,
           "Рейка с тремя полками над холодильником (стойки не над смесителем), верх полок 1.47 / 1.71 / 1.95 м. "
           "Посуда и банки в цене, потос — условный реквизит (CC0)."),
]})

# ---------- 2. Столешница: то, что живёт на ней каждый день ----------
# Ни на варочной (Z 0.519–1.119), ни у мойки (Z 1.619–2.119). Высокое — вне кронштейнов полок (низ 1.222).
def on_top(mid, z, back=0.01, front=None):
    d = size_of(mid)[2]
    x = (front - d / 2) if front is not None else SPLASH + back + d / 2
    return part(mid, x, TOP, z, 90)


kettle_end = on_top("kettle-vattentat", 0.27, front=0.50)     # торцевой модуль у окна, к краю: под рейлингом свободно
slots.append({"id": "counter", "label": "На столешнице", "default": "everyday", "options": [
    NONE,
    option("everyday", "Каждый день: доски, масло, кофе, чайник", "norrsjon-board", [
        on_top("boards-lean-oak-acacia", 1.34, back=0.004),
        on_top("bottles-korken-oil", 2.30),
        on_top("coffee-press-set", 2.56),
        kettle_end,
    ], "Доски у фартука между варочной и мойкой, масло и кофейный набор у холодильника, чайник у окна. "
       "Масло, уксус, кофе — условное наполнение."),
    option("cook", "Для готовки: доски, лопатки в кувшине, масло", "brugdhaj-crock", [
        on_top("boards-lean-oak-acacia", 1.34, back=0.004),
        on_top("crock-brugdhaj-utensils", 2.30),
        on_top("bottles-korken-oil", 2.52),
        kettle_end,
    ], "Кувшин с лопатками и масло у мойки, доски у фартука, чайник у окна."),
    option("coffee", "Кофейный угол: френч-пресс, кружки, чайник", "press-365", [
        on_top("kettle-vattentat", 2.26),
        on_top("coffee-press-set", 2.56),
    ], "Чайник и френч-пресс с кружкой на модуле у холодильника; остальная столешница свободна."),
]})

# ---------- 3. На острове (едет вместе с островом) ----------
# Светильники над островом (Z 0.54 / 0.69 / 1.14 / 1.59 / 1.74, низ 1.62): высокий букет — у торца к окну, где их нет.
def on_island(mid, z, rot=90, dx=0.0, y=TOP):
    return part(mid, ISL_X + dx, y, z, rot, anchor="island")


slots.append({"id": "island", "label": "На острове", "default": "fruit-eucalyptus", "options": [
    NONE,
    option("fruit-eucalyptus", "Фрукты в STOCKHOLM 2025 и эвкалипт SMYCKA в PÄRLHÄGG", "stockholm-bowl-34", [
        on_island("fruit-bowl-stockholm", 1.30),
        on_island("vase-parlhagg-eucalyptus", 0.40),
    ], "Чаша с фруктами по центру, ваза с тремя ветками эвкалипта у торца к окну (вне светильников). "
       "Фрукты — модели Poly Haven (CC0), не товар."),
    option("fruit", "Только фрукты в STOCKHOLM 2025", "stockholm-bowl-34", [
        on_island("fruit-bowl-stockholm", 1.14),
    ], "Чаша с фруктами по центру острова. Фрукты — модели Poly Haven (CC0), не товар."),
    option("books-vase", "Книги, ваза KÄLLARHALS и фрукты", "kallarhals-vase-26", [
        on_island("books-stack-l", 0.70),
        on_island("vase-kallarhals", 0.70, y=TOP + 0.11),
        on_island("fruit-bowl-stockholm", 1.45),
    ], "Стопка книг (условный реквизит) с оранжевой вазой и чаша с фруктами (Poly Haven, CC0)."),
    option("pelarbjork", "Ваза PELARBJÖRK и фрукты", "pelarbjork-vase-14", [
        on_island("vase-pelarbjork-white", 0.62),
        on_island("fruit-bowl-stockholm", 1.30),
    ], "Белая ваза-скульптура и чаша с фруктами (Poly Haven, CC0)."),
]})

# ---------- 4. Барные стулья у торца острова (к прихожей), лицом к острову ----------
STOOLS = [("ravsten", "ravsten-stool", 0.62, 0.0, "RÄVSTEN ×2, drewno kauczukowe — табуреты без спинки"),
          ("rosentorp", "rosentorp-stool", 0.63, 0.03, "ROSENTORP ×2, biały — со спинкой"),
          ("bergmund", "bergmund-stool", 0.62, 0.03, "BERGMUND ×2, imit. dębu/Gunnared — мягкие со спинкой"),
          ("skogsta", "skogsta-stool", 0.62, 0.03, "SKOGSTA ×2, czarny — со спинкой")]
stool_opts = [NONE]
for oid, key, h, depth, name in STOOLS:
    mid = oid
    w, _, d = size_of(mid)
    z = ISL_Z1 + 0.06 + d / 2
    dx = w / 2 + 0.02
    seat = {"h": h, "depth": depth, "label": "Сесть на барный стул"}
    stool_opts.append(option(oid, name, key, [
        part(mid, ISL_X - dx, 0.0, z, 180, anchor="island", seat=seat),
        part(mid, ISL_X + dx, 0.0, z, 180, anchor="island", seat=seat),
    ], f"Два стула у торца острова, лицом к нему; высота сиденья {round(h * 100)} см под столешницу 90 см. "
       "Проход в кухню из прихожей остаётся ≥ 1 м."))
slots.append({"id": "stools", "label": "Барные стулья", "default": "ravsten", "options": stool_opts})

# ---------- 5. Картины: грань шахты (видна из гостиной) и угол у окна над торцевым модулем ----------
def on_shaft(mid, z, y):
    return part(mid, SHAFT_X + size_of(mid)[2] / 2, y, z, 90)


def by_window(mid="frame-rodalm-black-lear-lobster"):
    return part(mid, 0.345, 1.40, size_of(mid)[2] / 2, 0)


ART_NOTE = ("Картины — общественное достояние: Эдвард Лир, «More Nonsense» (1872), и акварель Эллен Шутт "
            "из USDA Pomological Watercolor Collection (1911), печать на бумаге цвета слоновой кости.")
slots.append({"id": "art", "label": "Картины", "default": "gallery", "options": [
    NONE,
    option("gallery", "Галерея: RÖDALM и LOMVIKEN, Лир и лимон", "rodalm-30x40-walnut", [
        on_shaft("frame-rodalm-walnut-lemon", 3.366, 1.35),
        on_shaft("frame-rodalm-oak-lear-minspysia", 3.033, 1.60),
        on_shaft("frame-lomviken-lear-dinnerbell", 3.033, 1.24),
        by_window(),
    ], "Три рамки на шахте (видны из гостиной), омар Лира — в углу у окна над торцевым модулем. " + ART_NOTE),
    option("ledge", "Полка MOSSLANDA с картинами и омар у окна", "mosslanda-55-oak", [
        on_shaft("ledge-mosslanda-prints", 3.22, 1.30),
        by_window(),
    ], "Три рамки стоят на полке 55 см на шахте, омар — в углу у окна. " + ART_NOTE),
    option("lobster", "Только омар Лира у окна, RÖDALM czarny", "rodalm-30x40-black", [
        by_window(),
    ], "Одна рамка 30×40 в углу у окна над торцевым модулем. " + ART_NOTE),
]})

# ---------- 6. Рейлинг с утварью над торцевым модулем (стена X = 0, Z 0–0.58) ----------
def rail(mid, z=0.30, bar_y=1.38):
    return on_wall(mid, z, bar_y - A[mid]["bar"])


slots.append({"id": "rail", "label": "Рейлинг с утварью", "default": "kungsfors", "options": [
    NONE,
    option("kungsfors", "KUNGSFORS 56 с крючками и лопатками KNORRHANE", "kungsfors-rail-56", [
        rail("rail-kungsfors-utensils")],
        "Рейлинг на высоте 1.38 м над торцевым модулем у окна, на крючках — шумовка, половник, лопатка, ложка."),
    option("hultarp", "HULTARP 60, czarny, с набором GRUNKA", "hultarp-rail-60", [
        rail("rail-hultarp-grunka")],
        "Чёрный рейлинг на высоте 1.38 м над торцевым модулем, на крючках — набор GRUNKA."),
]})

# миниатюра опции: thumbs/<слот>-<опция>.jpg (id опций повторяются в разных слотах)
for s in slots:
    for o in s["options"][1:]:
        o["thumb"] = f"models/decor/kitchen/thumbs/{s['id']}-{o['id']}.jpg"
        o["parts"] = o.pop("parts")          # parts — последним полем, как в других зонах

spec = {"zone": "kitchen", "title": "Кухня", "room": "kitchen_living",
        "_note": "Генерирует tools/decor/kitchen/compose.py — править раскладки там. Ряд вдоль стены X = 0, остров "
                 "X 1.78–2.38 (части острова с anchor island). Порядок слотов и опций = код варианта: новое только в конец.",
        "slots": slots}
out = os.path.join(WEB, "spec", "decor", "kitchen.json")
json.dump(spec, open(out, "w"), ensure_ascii=False, indent=1)
open(out, "a").write("\n")
print(out, sum(len(s["options"]) - 1 for s in slots), "опций")

# ---------- миниатюры опций: вся сборка, повёрнутая лицом в +Z (tools/decor/living/preview.py, режим thumb) ----------
if "--no-thumbs" not in sys.argv:
    tdir = os.path.join(WEB, "models", "decor", "kitchen", "thumbs")
    os.makedirs(tdir, exist_ok=True)
    jobs = []
    for s in slots:
        for o in s["options"][1:]:
            # в осях первой части; вещи на другой стене (омар у окна) — не в миниатюру, у неё своя опция;
            # разбросанное вдоль стены (чайник у окна, доски у мойки) сдвинуть друг к другу, чтобы было крупно
            r0 = math.radians(o["parts"][0]["rot"])
            loc = []
            for p in o["parts"]:
                if p["rot"] != o["parts"][0]["rot"]:
                    continue
                x, z = p["pos"][0], p["pos"][2]
                w, _, d = size_of(p["model"].split("/")[-2])
                u = x * math.cos(r0) - z * math.sin(r0)
                loc.append([u - w / 2, u + w / 2, x * math.sin(r0) + z * math.cos(r0), p])
            loc.sort(key=lambda t: t[0])
            shift, reach = 0.0, None
            for t in loc:
                if reach is not None and t[0] - shift > reach + 0.12:
                    shift += t[0] - shift - reach - 0.08
                t[0] -= shift; t[1] -= shift
                reach = max(reach if reach is not None else t[1], t[1])
            cu = (min(t[0] for t in loc) + max(t[1] for t in loc)) / 2
            cv = (min(t[2] for t in loc) + max(t[2] for t in loc)) / 2
            glbs = [{"glb": os.path.join(WEB, t[3]["model"]), "rot": 0,
                     "pos": [(t[0] + t[1]) / 2 - cu, t[3]["pos"][1], t[2] - cv]} for t in loc]
            jobs.append({"glbs": glbs, "out": os.path.join(WEB, o["thumb"]), "mode": "thumb"})
    with tempfile.TemporaryDirectory() as tmp:
        jf = os.path.join(tmp, "jobs.json")
        json.dump(jobs, open(jf, "w"))
        subprocess.run(["blender", "-b", "--python", os.path.join(os.path.dirname(HERE), "living", "preview.py"), "--", jf],
                       check=True, stdout=subprocess.DEVNULL)
    print(len(jobs), "миниатюр ->", tdir)
