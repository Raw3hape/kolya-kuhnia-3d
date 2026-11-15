# Гостиная: стеллажи у пустой стены. Собирает web/spec/decor/living.json из мебели IKEA и общего реквизита
# (книги, растения, вазы) по раскладкам ниже, проверяет вместимость полок и проходы, рисует план сверху.
#   python3 tools/decor/living/compose.py [--boxes furn.json] [--plot plan.png]
#     furn.json — следы мебели гостиной по умолчанию [{name, x0, x1, z0, z1}] (снять в браузере), для проверок и плана.
# Источники: план — web/spec/plan.generated.json; полки мебели — anatomy.json (anatomy.py); размеры реквизита —
# web/models/decor/props/index.json (make_props.py). Цены и артикулы IKEA сняты 2026-11-15 (см. SOURCE.md моделей).
#
# Стена: дальняя стена кухни-гостиной z = 3.68 (перегородка с комнатой 2), x 2.00–6.17, глухая, 4.17 м.
# Телевизор — на правой стене x = 6.17; кухня, остров и диван — ближе к окнам (z ≤ 2.04).
# Мебель стоит спиной к стене (rot 180: перед смотрит в −Z, в комнату). Проход от холла к гостиной — полоса
# между торцом острова/дивана (z 2.04) и фронтом стеллажа: держим ≥ 0.90.
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
WEB = os.path.join(ROOT, "web")
HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
opt = lambda k: args[args.index(k) + 1] if k in args else None

plan = json.load(open(os.path.join(WEB, "spec", "plan.generated.json")))
room = plan["rooms"]["kitchen_living"]
WALL_Z = max(r["z1"] for r in room["rects"])                 # 3.68: дальняя стена
WALL_X0 = 2.0019                                              # левый край глухой стены (проём в холл до него)
WALL_X1 = room["x1"]                                          # 6.171: стена ТВ
for w in plan["walls"]:                                       # уточнить по перегородке с комнатой 2
    if abs(w["z0"] - WALL_Z) < 0.01 and w["x1"] > 6:
        WALL_X0 = w["x0"]
GAP = 0.01                                                    # зазор мебели до стены
ANAT = json.load(open(os.path.join(HERE, "anatomy.json")))["models"]
PROPS = json.load(open(os.path.join(WEB, "models", "decor", "props", "index.json")))["props"]
MID = (WALL_X0 + WALL_X1) / 2                                 # середина стены

# ---------- товары (ikea.com/pl, 2026-11-15) ----------
P = {
    "billy-80-oak": dict(name="BILLY Regał, imit. dębu, 80x28x202 cm", article="105.089.32", price=349.0, size=[0.80, 2.02, 0.28],
                         url="https://www.ikea.com/pl/pl/p/billy-regal-imit-debu-10508932/"),
    "billy-40-oak": dict(name="BILLY Regał, imit. dębu, 40x28x202 cm", article="604.773.82", price=249.0, size=[0.40, 2.02, 0.28],
                         url="https://www.ikea.com/pl/pl/p/billy-regal-imit-debu-60477382/"),
    "ivar-3": dict(name="IVAR 3 sekcje/półki, sosna, 219x30x226 cm", article="894.039.46", price=1205.0, size=[2.19, 2.26, 0.30],
                   url="https://www.ikea.com/pl/pl/p/ivar-3-sekcje-polki-sosna-s89403946/"),
    "kallax-5x5": dict(name="KALLAX Regał, imitacja dębu bejcowanego na biało, 182x182 cm", article="903.245.09", price=799.0,
                       size=[1.82, 1.82, 0.39], url="https://www.ikea.com/pl/pl/p/kallax-regal-imitacja-debu-bejcowanego-na-bialo-90324509/"),
    "eket-walnut": dict(name="EKET Kombinacja szafek ściennych, brązowy orzech, 175x35x70 cm", article="995.688.33", price=800.0,
                        size=[1.75, 0.70, 0.35], url="https://www.ikea.com/pl/pl/p/eket-kombinacja-szafek-sciennych-brazowy-orzech-s99568833/"),
    "mosslanda-115-walnut": dict(name="MOSSLANDA Półka na zdjęcia, orzech, 115 cm", article="606.366.49", price=39.99,
                                 size=[1.15, 0.07, 0.12], url="https://www.ikea.com/pl/pl/p/mosslanda-polka-na-zdjecia-orzech-60636649/"),
    "strandmon-grann": dict(name="STRANDMON Fotel uszak, Grann/Bomstad ciemnobrązowy", article="004.946.38", price=1499.0,
                            size=[0.82, 1.01, 0.96], url="https://www.ikea.com/pl/pl/p/strandmon-fotel-uszak-grann-bomstad-ciemnobrazowy-00494638/"),
    "arstid-lamp": dict(name="ÅRSTID Lampa podłogowa, mosiądz/biały", article="003.213.17", price=179.0, size=[0.36, 1.55, 0.36],
                        url="https://www.ikea.com/pl/pl/p/arstid-lampa-podlogowa-mosiadz-bialy-00321317/"),
}
MODEL = lambda i: f"models/decor/living/{i}/model.glb"
PROP = lambda i: f"models/decor/props/{i}/model.glb"

# ---------- раскладки ----------
# По полке: список "prop:место". Место: L / R / C (у левой/правой стойки или по центру, если смотреть на стеллаж)
# или число — доля ширины пролёта для центра вещи. Порядок полок снизу вверх, последняя — крышка (верх).
# Принцип: ряды книг чередуются слева/справа, между ними — объект и воздух; внизу тяжёлое (альбомы, стопки),
# наверху — растения и вазы; плети эпипремнума спускаются по фасаду.
BILLY3 = [
    [["books-row-tall:L", "books-stack-l:R"], ["books-row-l:L", "frame-photo-white:R"], ["books-row-m:L", "plant-aloe:R"],
     ["books-row-l2:L", "frame-photo-black:R"], ["books-stack-l:L", "books-row-paper:R"],
     ["plant-pothos-terracotta:0.17", "books-row-s:R"], ["vase-white-tall:0.25", "books-stack-s:R"]],
    [["books-row-l:L", "books-stack-s:R"], ["frame-photo-black:L", "books-row-s2:R"], ["books-row-m2:L"],
     ["books-stack-l:L", "books-row-tall:R"], ["books-row-paper:L", "frame-photo-white:R"], ["books-row-s:L", "plant-aloe:R"],
     ["books-stack-l:L", "vase-stone-slim:0.78"]],
    [["books-row-l2:L", "books-stack-s:R"], ["books-row-m:L"], ["frame-photo-black:L", "books-row-s2:R"],
     ["books-row-l:L", "plant-aloe:R"], ["books-row-tall:L", "books-stack-s:R"], ["books-row-paper:R"],
     ["vase-jug-white:0.25", "plant-pothos:0.8"]],
]
IVAR = [
    [["books-row-tall:L", "vase-white-tall:R"], ["books-row-l:L", "books-stack-s:R"], ["books-stack-l:L", "vase-jug-white:R"],
     ["books-row-paper:L", "books-row-s2:R"], ["books-row-m:L", "plant-aloe:R"], ["bowl-wood:L", "books-row-paper:R"],
     ["books-stack-s:C"], ["plant-pothos:0.2"]],
    [["books-stack-l:C"], ["books-row-s:C"], ["frame-photo-white:C"], ["books-stack-s:C"], ["plant-aloe:C"],
     ["vase-stone-slim:C"], []],
    [["books-row-l2:L", "books-stack-s:R"], ["books-row-m2:L"], ["books-stack-s:L", "books-row-tall:R"],
     ["books-row-s:L", "books-stack-s:R"], ["frame-photo-black:L", "books-row-l2:R"], ["books-row-s2:L"],
     ["books-row-paper:R"], ["vase-jug-white:0.25", "plant-calathea:0.75"]],
]
# KALLAX: 5 × 5 ячеек, строки снизу вверх, в ячейке одна вещь по центру; верх — отдельным списком (доли ширины).
KALLAX = [
    ["books-row-tall", "books-stack-s", "books-row-s2", "bowl-wood", "books-row-paper"],
    ["books-row-s", "frame-photo-white", "books-row-tall", "books-row-s2", "plant-aloe"],
    ["books-stack-s", "books-row-paper", "plant-pothos", "books-row-s", "books-row-tall"],
    ["frame-photo-black", "books-row-s2", "books-stack-s", "books-row-paper", "books-row-s"],
    ["vase-jug-white", "books-row-tall", "books-row-s", "plant-aloe", "books-stack-s"],
]
KALLAX_TOP = ["vase-white-tall:0.12", "books-stack-l:0.42", "vase-stone-slim:0.62", "plant-calathea:0.86"]
BILLY40 = [["books-row-s:C"], ["books-stack-s:C"], ["plant-aloe:C"], ["books-row-tall:C"], ["frame-photo-white:C"],
           ["books-row-s2:C"], ["vase-jug-white:C"]]
BILLY80_NOOK = [["books-row-l:L", "books-stack-s:R"], ["books-row-tall:L", "plant-aloe:R"], ["books-row-m2:L"],
                ["books-stack-l:L", "books-row-s:R"], ["books-row-l2:L"], ["books-row-paper:L", "plant-aloe:R"],
                ["books-stack-l:0.3", "plant-pothos:0.8"]]

problems, notes = [], []


def model_levels(mid):
    """Пролёты с полками; у BILLY/IVAR последний уровень — крышка (кронштейны выше игнорируем)."""
    bays = []
    for b in ANAT[mid]["bays"]:
        lv = []
        for l in b["levels"]:
            if l["clear"] is None or l["clear"] <= 0.05:   # крышка: над ней свободно
                lv.append({"y": l["y"], "clear": None})
                break
            lv.append(l)
        bays.append({"x0": b["x0"], "x1": b["x1"], "levels": lv})
    return bays


def put(parts, prop, slot_x0, slot_x1, y, clear, depth, cx, cz, where, tag, used):
    """Поставить вещь на полку. Локальные координаты мебели: x вдоль ширины, перед +Z на depth/2.
    Мебель повёрнута на 180°, поэтому мир = (cx − x, y, cz − z)."""
    w, h, d = PROPS[prop]["size"]
    h += min(0.0, PROPS[prop]["minY"])          # у плюща высота над полкой без свисающих плетей
    margin = 0.015
    if where == "L":
        x = slot_x0 + margin + w / 2
    elif where == "R":
        x = slot_x1 - margin - w / 2
    elif where == "C":
        x = (slot_x0 + slot_x1) / 2
    else:
        x = slot_x0 + float(where) * (slot_x1 - slot_x0)
    if clear is not None and h > clear - 0.002:
        problems.append(f"{tag}: {prop} высотой {h:.3f} не входит в просвет {clear:.3f}")
    if clear is not None and d > depth + 0.01:
        problems.append(f"{tag}: {prop} глубиной {d:.3f} не входит в полку {depth:.3f}")
    lo, hi = x - w / 2, x + w / 2
    hanging = PROPS[prop]["minY"] < 0
    if not hanging and (lo < slot_x0 - 0.001 or hi > slot_x1 + 0.001) and clear is not None:
        problems.append(f"{tag}: {prop} шире пролёта ({lo:.3f}..{hi:.3f} при {slot_x0:.3f}..{slot_x1:.3f})")
    for a, b, other in used:
        if lo < b - 0.003 and hi > a + 0.003:
            problems.append(f"{tag}: {prop} налезает на {other}")
    used.append((lo, hi, prop))
    # глубина: корешки/лицо в 1.5 см от переднего края; плющ — центр горшка в 7 см от края, плети уходят вперёд
    if prop.startswith("plant-pothos"):
        z = depth / 2 - 0.075
    else:
        z = depth / 2 - 0.015 - d / 2
        if d > depth - 0.03:                          # глубже полки: задом к стене, свес вперёд
            z = -depth / 2 + 0.005 + d / 2
    parts.append({"model": PROP(prop), "pos": [round(cx - x, 3), round(y, 3), round(cz - z, 3)], "rot": 180})


def dress(parts, mid, arrangement, cx, cz, base_y=0.0):
    depth = P[mid]["size"][2]
    bays = model_levels(mid)
    if len(arrangement) != len(bays):
        problems.append(f"{mid}: раскладок {len(arrangement)}, пролётов {len(bays)}")
    for bi, (bay, shelves) in enumerate(zip(bays, arrangement)):
        if len(shelves) != len(bay["levels"]):
            problems.append(f"{mid} пролёт {bi}: полок {len(bay['levels'])}, в раскладке {len(shelves)}")
        for li, (lv, items) in enumerate(zip(bay["levels"], shelves)):
            used = []
            top = lv["clear"] is None
            x0, x1 = (bay["x0"], bay["x1"])
            for it in items:
                prop, where = it.split(":")
                put(parts, prop, x0, x1, base_y + lv["y"], None if top else lv["clear"], depth, cx, cz, where,
                    f"{mid}[{bi}].{li}", used)


def dress_top(parts, mid, items, cx, cz, base_y=0.0):
    W, H, D = P[mid]["size"]
    top = ANAT[mid]["top"] if mid in ANAT else H
    used = []
    for it in items:
        prop, where = it.split(":")
        put(parts, prop, -W / 2, W / 2, base_y + top, None, D, cx, cz, where, f"{mid}.top", used)


def floor_z(prop):
    """Напольное растение у стены: листья не касаются стены (2 см)."""
    return WALL_Z - 0.02 - max(PROPS[prop]["size"][0], PROPS[prop]["size"][2]) / 2


def against_wall(mid, x, y=0.0):
    """Центр следа мебели спиной к дальней стене; перед в комнату (rot 180)."""
    d = P[mid]["size"][2]
    return {"model": MODEL(mid), "pos": [round(x, 3), round(y, 3), round(WALL_Z - GAP - d / 2, 3)], "rot": 180}


def option(oid, name, items, parts, finish, note, extra=None):
    total = round(sum(P[i]["price"] * n for i, n in items), 2)
    main = items[0][0]
    arts = ", ".join(f"{P[i]['article']}{' ×%d' % n if n > 1 else ''}" for i, n in items)
    lines = "; ".join(f"{P[i]['name']}{' ×%d' % n if n > 1 else ''} — {P[i]['price']:g} zł" for i, n in items)
    o = {"id": oid, "name": name, "brand": "IKEA", "article": arts, "url": P[main]["url"], "price_pln": total,
         "finish": finish, "note": f"{lines}. {note} Книги, растения, вазы и рамки — условный реквизит (CC0), не товар.",
         "size": None, "thumb": f"models/decor/living/thumbs/{oid}.jpg", "collide": True, "parts": parts}
    o.update(extra or {})
    return o


opts = [{"id": "none", "name": "Нет"}]

# 1. Библиотека: три BILLY 80 «под дуб» по центру стены.
parts, W = [], 0.80
xs = [MID + W, MID, MID - W]          # слева направо, если смотреть на стену (смотрящий видит +x слева)
for i, x in enumerate(xs):
    parts.append(against_wall("billy-80-oak", x))
for i, x in enumerate(xs):
    dress(parts, "billy-80-oak", [BILLY3[i]], x, WALL_Z - GAP - 0.14)
o = option("billy-3", "BILLY ×3, imit. dębu — библиотека во всю стену", [("billy-80-oak", 3)], parts, "imit. dębu",
           "Три стеллажа 80 см вплотную, 240 см по центру стены; по 88 см до углов.")
# коллайдер прогулки — весь блок из трёх (size вокруг первой части): первая часть — средний стеллаж
parts.insert(0, parts.pop(1))
o["size"] = [2.40, 2.02, 0.28]
opts.append(o)

# 2. IVAR: три секции сосны, открытые полки до 226 см.
parts = [against_wall("ivar-3", MID)]
dress(parts, "ivar-3", IVAR, MID, WALL_Z - GAP - 0.15)
o = option("ivar-3", "IVAR 3 sekcje/półki, sosna — открытый стеллаж", [("ivar-3", 1)], parts, "sosna, nielakierowana",
           "219 см по центру стены, высота 226 см.")
o["size"] = [2.19, 2.26, 0.30]
opts.append(o)

# 3. KALLAX 5×5, беленый дуб; пахира справа (в углу у ТВ-стены).
parts = [against_wall("kallax-5x5", MID)]
D = P["kallax-5x5"]["size"][2]
bays = model_levels("kallax-5x5")
cz = WALL_Z - GAP - D / 2
for r in range(5):
    for c in range(5):
        bay, lv = bays[c], bays[c]["levels"][r]
        put(parts, KALLAX[r][c], bay["x0"], bay["x1"], lv["y"], lv["clear"], D, MID, cz, "C", f"kallax[{r},{c}]", [])
dress_top(parts, "kallax-5x5", KALLAX_TOP, MID, cz)
px = MID + P["kallax-5x5"]["size"][0] / 2 + 0.45      # слева от стеллажа (если смотреть на стену) — к ТВ-стене
parts.append({"model": PROP("plant-pachira"), "pos": [round(px, 3), 0, round(floor_z("plant-pachira"), 3)], "rot": 180})
o = option("kallax-5x5", "KALLAX Regał 182×182, dąb bejcowany na biało — 25 ячеек", [("kallax-5x5", 1)], parts,
           "imitacja dębu bejcowanego na biało", "По центру стены; слева, в сторону ТВ-стены, напольная пахира.")
o["size"] = [1.82, 1.82, 0.39]
opts.append(o)

# 4. EKET орех низко на стене + две полки MOSSLANDA уступом, галерея принтов и фото; сингониум у края.
EKET_Y = 0.25                         # низ подвесного корпуса: верх на 0.95
parts = [against_wall("eket-walnut", MID, EKET_Y)]
D = P["eket-walnut"]["size"][2]
cz = WALL_Z - GAP - D / 2
eb = model_levels("eket-walnut")
# открытая секция (последний пролёт): две полки
open_bay = eb[-1]
put(parts, "books-row-s2", open_bay["x0"], open_bay["x1"], EKET_Y + open_bay["levels"][0]["y"], open_bay["levels"][0]["clear"], D, MID, cz, "C", "eket.open0", [])
put(parts, "plant-aloe", open_bay["x0"], open_bay["x1"], EKET_Y + open_bay["levels"][1]["y"], open_bay["levels"][1]["clear"], D, MID, cz, "C", "eket.open1", [])
EKET_TOP = ["books-stack-l:0.12", "bowl-wood:0.4", "vase-white-tall:0.765", "plant-pothos:0.915"]
dress_top(parts, "eket-walnut", EKET_TOP, MID, cz, EKET_Y)
# полки: u — от левого края EKET (как видит смотрящий), мир x = левый край − u
left = MID + P["eket-walnut"]["size"][0] / 2
LW, LD = P["mosslanda-115-walnut"]["size"][0], P["mosslanda-115-walnut"]["size"][2]
ledges = [(0.08, 1.30, ["art-print-arch:0.29", "frame-photo-black:0.70", "vase-stone-slim:0.9"]),
          (0.78, 1.80, ["art-print-sun:0.22", "frame-photo-white:0.62"])]
lz = WALL_Z - LD / 2
for u0, y, items in ledges:
    cx = left - u0 - LW / 2
    parts.append({"model": MODEL("mosslanda-115-walnut"), "pos": [round(cx, 3), y, round(lz, 3)], "rot": 180})
    used = []
    for it in items:
        prop, where = it.split(":")
        w, h, d = PROPS[prop]["size"]
        x = -LW / 2 + float(where) * LW
        lo, hi = x - w / 2, x + w / 2
        if lo < -LW / 2 or hi > LW / 2:
            problems.append(f"полка {y}: {prop} за краем")
        for a, b, other in used:
            if lo < b and hi > a:
                problems.append(f"полка {y}: {prop} налезает на {other}")
        used.append((lo, hi, prop))
        # прислонить к задней планке: центр вещи на d/2 от стены + 1 см
        parts.append({"model": PROP(prop), "pos": [round(cx - x, 3), round(y + 0.01, 3), round(WALL_Z - 0.012 - d / 2, 3)], "rot": 180})
# вещи на крышке EKET не должны упираться в полку над ними
for it in EKET_TOP:
    prop, where = it.split(":")
    w, h, d = PROPS[prop]["size"]
    uc = float(where) * P["eket-walnut"]["size"][0]
    for u0, y, _ in ledges:
        if EKET_Y + ANAT["eket-walnut"]["top"] + h > y and uc - w / 2 < u0 + LW and uc + w / 2 > u0:
            problems.append(f"{prop} на EKET упирается в полку {y}")
# верх нижнего ряда принтов не должен задевать верхнюю полку
for (u0, y, items), (u1, y1, _) in zip(ledges, ledges[1:]):
    for it in items:
        prop, where = it.split(":")
        w, h, d = PROPS[prop]["size"]
        uc = u0 + float(where) * LW
        if y + 0.01 + h > y1 and uc + w / 2 > u1:
            problems.append(f"{prop} на полке {y} упирается в полку {y1}")
syn_x = left - P["eket-walnut"]["size"][0] - 0.40
parts.append({"model": PROP("plant-syngonium"), "pos": [round(syn_x, 3), 0, round(floor_z("plant-syngonium"), 3)], "rot": 180})
o = option("eket-gallery", "EKET orzech + 2 × MOSSLANDA — комод и галерея", [("eket-walnut", 1), ("mosslanda-115-walnut", 2)],
           parts, "brązowy orzech", f"EKET подвешен на {EKET_Y:g} м от пола (верх 0.95), полки уступом на 1.30 и 1.80 м; справа сингониум.")
o["size"] = [1.75, 0.70, 0.35]
o["collide"] = True
opts.append(o)

# 5. Уголок для чтения: STRANDMON в углу у ТВ-стены, лампа ÅRSTID, BILLY 80 + 40, сингониум.
CH = (5.50, 3.00, 220)                # кресло: центр, поворот (лицом к столику и дивану)
LAMP = (5.03, 3.43)
b80 = 4.38 - 0.40
b40 = 4.38 + 0.20
# первая часть — кресло: его след (size) — коллайдер прогулки, у него же место «сесть»
parts = [{"model": MODEL("strandmon-grann"), "pos": [CH[0], 0, CH[1]], "rot": CH[2],
          "seat": {"h": 0.45, "depth": 0.12, "label": "Сесть в кресло"}},
         against_wall("billy-80-oak", b80), against_wall("billy-40-oak", b40)]
dress(parts, "billy-80-oak", [BILLY80_NOOK], b80, WALL_Z - GAP - 0.14)
dress(parts, "billy-40-oak", [BILLY40], b40, WALL_Z - GAP - 0.14)
parts.append({"model": MODEL("arstid-lamp"), "pos": [LAMP[0], 0, LAMP[1]], "rot": 180})
parts.append({"model": PROP("plant-syngonium"), "pos": [round(b80 - 0.40 - 0.36, 3), 0, round(floor_z("plant-syngonium"), 3)], "rot": 180})
o = option("reading-nook", "Уголок для чтения: STRANDMON + ÅRSTID + BILLY 80/40",
           [("strandmon-grann", 1), ("arstid-lamp", 1), ("billy-80-oak", 1), ("billy-40-oak", 1)], parts,
           "Grann/Bomstad ciemnobrązowy, mosiądz, imit. dębu",
           "Кресло в углу у ТВ-стены развёрнуто к столику; лампа слева от кресла; стеллажи 120 см левее.")
o["url"] = P["strandmon-grann"]["url"]
o["size"] = P["strandmon-grann"]["size"]
opts.append(o)

# ---------- растение у балконного окна (второй слот) ----------
PLANT_POS = (3.68, 0.44)              # перед глухой створкой балконной двери, между диваном и столиком
plants = [{"id": "none", "name": "Нет"}]
for pid, name, nm in [("plant-pachira", "Пахира в кашпо, h 176", "пахира"), ("plant-syngonium", "Сингониум в терракоте, h 84", "сингониум")]:
    w, h, d = PROPS[pid]["size"]
    plants.append({"id": pid.replace("plant-", ""), "name": name, "brand": "реквизит (CC0)",
                   "note": f"Условное растение ({nm}, модель Poly Haven CC0), не товар. Стоит у глухой створки балконной двери, "
                           "вне дуги открывающейся створки (x 4.61–5.56).",
                   "size": [round(w, 2), round(h, 2), round(d, 2)], "thumb": f"models/decor/props/{pid}/thumb.jpg",
                   "collide": True, "parts": [{"model": PROP(pid), "pos": [PLANT_POS[0], 0, PLANT_POS[1]], "rot": 0}]})

# Порядок опций и слотов = код варианта: только дописывать в конец.
spec = {"zone": "living", "title": "Гостиная: стеллажи", "room": "kitchen_living",
        "_note": "Генерирует tools/decor/living/compose.py — править раскладки там. Дальняя стена z 3.68, x 2.00–6.17 "
                 "(ТВ на стене x 6.17). Порядок слотов и опций = код варианта: новое только в конец.",
        "slots": [
            {"id": "shelves", "label": "Стеллаж у стены", "default": "billy-3", "options": opts},
            {"id": "plant", "label": "Растение у окна", "default": "pachira", "options": plants},
        ]}

# ---------- проверки ----------
def footprint(part):
    m = part["model"]
    if "/props/" in m:
        w, h, d = PROPS[m.split("/")[-2]]["size"]
        if m.split("/")[-2].startswith("plant-") and part["pos"][1] < 0.05:
            w, d = PROPS[m.split("/")[-2]]["foot"]      # на полу мешает горшок, листья выше мебели
    else:
        w, h, d = P[m.split("/")[-2]]["size"]
        if m.split("/")[-2] == "mosslanda-115-walnut":
            d = 0.12
    a = math.radians(part["rot"])
    c, s = abs(math.cos(a)), abs(math.sin(a))
    hx, hz = (w * c + d * s) / 2, (w * s + d * c) / 2
    x, y, z = part["pos"]
    return x - hx, x + hx, z - hz, z + hz, y, y + h


def obb_corners(part):
    m = part["model"].split("/")[-2]
    w, _, d = P[m]["size"] if m in P else PROPS[m]["size"]
    a = math.radians(part["rot"])
    x, _, z = part["pos"]
    pts = []
    for sx, sz in [(1, 1), (-1, 1), (-1, -1), (1, -1)]:
        lx, lz = sx * w / 2, sz * d / 2
        pts.append((x + lx * math.cos(a) + lz * math.sin(a), z - lx * math.sin(a) + lz * math.cos(a)))
    return pts


boxes = json.load(open(opt("--boxes"))) if opt("--boxes") else []
for slot in spec["slots"]:
    for o in slot["options"]:
        for p in o.get("parts", []):
            if "/props/" in p["model"] and PROPS[p["model"].split("/")[-2]]["minY"] < 0:
                continue
            x0, x1, z0, z1, y0, y1 = footprint(p)
            if p["rot"] % 90:
                cs = obb_corners(p)
                x0, x1 = min(c[0] for c in cs), max(c[0] for c in cs)
                z0, z1 = min(c[1] for c in cs), max(c[1] for c in cs)
            if x0 < WALL_X0 - 0.001 or x1 > WALL_X1 + 0.001 or z1 > WALL_Z + 0.001 or z0 < 0:
                problems.append(f"{o['id']}: {p['model']} вне комнаты ({x0:.2f}..{x1:.2f}, {z0:.2f}..{z1:.2f})")
            if y0 < 0.5:     # стоит на полу или низко — сверяем с мебелью гостиной
                for b in boxes:
                    if b.get("ground", True) and x0 < b["x1"] and x1 > b["x0"] and z0 < b["z1"] and z1 > b["z0"]:
                        problems.append(f"{o['id']}: {p['model'].split('/')[-2]} пересекает {b['name']}")
        # проход от холла: фронт стеллажа (первая часть) до торца острова/дивана
        if slot["id"] == "shelves" and o.get("parts"):
            front = min(footprint(p)[2] for p in o["parts"] if p["pos"][1] < 0.5 and "/props/" not in p["model"]
                        and p["rot"] == 180)
            ends = [b["z1"] for b in boxes if b["name"] in ("sofa", "island")]
            if ends:
                gap = front - max(ends)
                notes.append(f"{o['id']}: проход между стеллажом и диваном/островом {gap:.2f} м")
                if gap < 0.90:
                    problems.append(f"{o['id']}: проход {gap:.2f} < 0.90")

json.dump(spec, open(os.path.join(WEB, "spec", "decor", "living.json"), "w"), ensure_ascii=False, indent=1)
print(f"living.json: {sum(len(s['options']) for s in spec['slots'])} опций, "
      f"{sum(len(o.get('parts', [])) for s in spec['slots'] for o in s['options'])} частей")
for n in notes:
    print(" ", n)
print("ПРОБЛЕМЫ:" if problems else "проблем нет")
for p in problems:
    print("  -", p)

# ---------- план сверху ----------
if opt("--plot"):
    from PIL import Image, ImageDraw
    S, ox, oz = 160, 1.6, 1.6         # пикселей на метр, отступ: x 1.6..6.4, z 1.6..3.9 (+ окно внизу)
    Wpx, Hpx = int((6.5 - 0.0) * S), int((4.0 - 0.0) * S)
    imgs = []
    for slot in spec["slots"]:
        for o in slot["options"][1:]:
            im = Image.new("RGB", (Wpx, Hpx), "white")
            d = ImageDraw.Draw(im)
            P2 = lambda x, z: (x * S, z * S)
            d.rectangle([P2(0, 0), P2(WALL_X1, WALL_Z)], outline="black", width=3)
            d.line([P2(WALL_X0, WALL_Z), P2(WALL_X1, WALL_Z)], fill="black", width=6)
            for b in boxes:
                d.rectangle([P2(b["x0"], b["z0"]), P2(b["x1"], b["z1"])], outline="#888", fill="#eee" if b.get("ground", True) else None)
                d.text(P2(b["x0"] + 0.02, b["z0"] + 0.02), b["name"], fill="#555")
            d.pieslice([P2(4.61 - 0.95, -0.95), P2(4.61 + 0.95, 0.95)], 0, 90, outline="#c66")  # створка балкона
            for p in o["parts"]:
                if "/props/" in p["model"]:
                    x0, x1, z0, z1, *_ = footprint(p)
                    d.rectangle([P2(x0, z0), P2(x1, z1)], outline="#3a7", width=1)
                elif p["rot"] % 90:
                    d.polygon([P2(*c) for c in obb_corners(p)], outline="#a50", width=3)
                else:
                    x0, x1, z0, z1, *_ = footprint(p)
                    d.rectangle([P2(x0, z0), P2(x1, z1)], outline="#a50", width=3)
            d.text((10, 10), f"{slot['id']} / {o['id']}", fill="black")
            imgs.append(im)
    cols = 2
    sheet = Image.new("RGB", (Wpx * cols, Hpx * ((len(imgs) + 1) // 2)), "white")
    for i, im in enumerate(imgs):
        sheet.paste(im, ((i % cols) * Wpx, (i // cols) * Hpx))
    sheet.save(opt("--plot"))
    print("план:", opt("--plot"))
