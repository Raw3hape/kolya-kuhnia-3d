# Раскладка зоны «Стена с ТВ» -> web/spec/decor/tvwall.json и миниатюры опций web/models/decor/tvwall/thumbs/.
# python3 tools/decor/tvwall/compose.py [--no-thumbs]
# Источники чисел (ничего не дублируем): стена ТВ и тумба по умолчанию — web/spec/furniture.json (defaults, consoles,
# tvWall) и web/spec/plan.generated.json; габариты моделей — tools/decor/tvwall/sizes.json (пишет build.py) и
# web/models/decor/props/index.json (книги). Части на тумбе — "anchor": "console", картины у ТВ — "anchor": "tv":
# pos/rot абсолютные для расстановки по умолчанию, decor.js сдвигает их вслед за тумбой и ТВ.
# Порядок слотов и опций — код варианта: только дописывать в конец (web/models/decor/README.md).
import json, math, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
WEB = os.path.join(ROOT, "web")
load = lambda *p: json.load(open(os.path.join(*p)))
FURN = load(WEB, "spec", "furniture.json")
PLAN = load(WEB, "spec", "plan.generated.json")
SIZES = load(HERE, "sizes.json")
PROPS = load(WEB, "models", "decor", "props", "index.json")["props"]
r3 = lambda v: round(v, 3)

# ---------- стена и тумба по умолчанию ----------
D0 = FURN["defaults"]
rects = PLAN["rooms"][FURN["room"]]["rects"]
assert FURN["tvWall"]["edge"] == "x1", "раскладка написана для стены ТВ x1 (грань смотрит в −X)"
WALL_X = max(r["x1"] for r in rects)
CON = FURN["consoles"][D0["console"]]
CON_TOP = CON["mountY"] + CON["h"] if CON["base"] == "wall" else CON["h"]
CON_BACK = WALL_X - CON["wallGap"]                  # задняя кромка крышки
CON_FRONT = CON_BACK - CON["d"]
CON_Z0, CON_Z1 = D0["consoleAlong"] - D0["consoleW"] / 2, D0["consoleAlong"] + D0["consoleW"] / 2
FACE = -90                                          # перед вещи смотрит в комнату (−X)
# Под серединой ТВ вещи ниже нижнего края экрана: у самого большого ТВ (85″) при центре по умолчанию край на 12 см
# выше крышки — такие вещи не закрывают экран ни из какой точки выше них. По краям тумбы можно до 15 см.
TV_CORE = 0.35                                      # полуширина «середины» вдоль стены от оси ТВ, м
CORE_MAX_H = D0["tvY"] - (85 * 0.0254 * 9 / math.hypot(16, 9)) / 2 - CON_TOP
GAP = 0.001                                         # рамка на стене: зазор, чтобы не мерцала со стеной


def size(model_id):
    """(W, H, D) модели: свои — из sizes.json, общий реквизит гостиной — из props/index.json."""
    if model_id in SIZES:
        s = SIZES[model_id]
        return s["W"], s["H"], s["D"]
    w, h, d = PROPS[model_id]["size"]
    return w, h, d


def model_path(model_id):
    kind = SIZES.get(model_id, {}).get("kind", "props")
    return f"models/decor/{kind}/{model_id}/model.glb"


def on_console(model_id, z, back=0.03, turn=0, y=None):
    """Вещь на крышке тумбы: z — центр вдоль стены, back — отступ задней грани следа от задней кромки,
    turn — доворот от «лицом в комнату» (+ — к дальнему концу тумбы, − — к окну), y — своя высота основания."""
    w, h, d = size(model_id)
    a = math.radians(turn)
    deep = abs(w * math.sin(a)) + abs(d * math.cos(a))      # глубина следа поперёк тумбы после доворота
    along = abs(w * math.cos(a)) + abs(d * math.sin(a))
    x = CON_BACK - back - deep / 2
    assert x - deep / 2 >= CON_FRONT - 1e-6, f"{model_id}: не помещается по глубине тумбы"
    assert CON_Z0 <= z - along / 2 and z + along / 2 <= CON_Z1, f"{model_id}: выходит за торец тумбы"
    top = (CON_TOP if y is None else y) + h - CON_TOP
    assert abs(z - D0["tvAlong"]) > TV_CORE or top <= CORE_MAX_H + 1e-3, f"{model_id}: выше {CORE_MAX_H:.3f} под серединой ТВ"
    return {"model": model_path(model_id), "pos": [r3(x), r3(CON_TOP if y is None else y), r3(z)],
            "rot": FACE + turn, "anchor": "console"}


def on_wall(model_id, z, bottom):
    """Рамка вплотную к стене ТВ: z — центр вдоль стены, bottom — высота нижнего края."""
    w, h, d = size(model_id)
    return {"model": model_path(model_id), "pos": [r3(WALL_X - d / 2 - GAP), r3(bottom), r3(z)], "rot": FACE,
            "anchor": "tv"}


# ---------- слот 1: фигурки и мелочи на тумбе ----------
JOKE_Z = 0.53          # место шуточной фигурки (слот joke): в наборах ниже оно свободно

SETS = [
    ("curios", "Диковины: моаи, утка на книгах, плёночная камера, гном, свеча, хавортия",
     "Каменный истукан-моаи, резиновая утка на стопке книг, старая плёночная камера, садовый гном размером с ладонь, "
     "свеча на латунном блюдце, хавортия в белом горшке",
     lambda: [on_console("fig-moai", 0.36, turn=15),
              on_console("books-stack-s", 0.72, back=0.02),
              on_console("fig-rubber-duck", 0.72, back=0.06, turn=25, y=CON_TOP + size("books-stack-s")[1]),
              on_console("camera-vintage", 1.12, back=0.05, turn=-20),
              on_console("candle-pillar", 1.60, back=0.05),
              on_console("fig-garden-gnome", 1.74, back=0.03, turn=-15),
              on_console("plant-haworthia-mini", 1.93)]),
    ("zoo", "Зверинец: кот, слон, ракушка, кит, утка, конь",
     "Бетонный кот, резной деревянный слон, раковина-лямбис, бронзовый кит на подставке, резиновая утка, "
     "фарфоровый вздыбленный конь",
     lambda: [on_console("fig-concrete-cat", 0.36, turn=20),
              on_console("fig-wooden-elephant", 0.72, back=0.05),
              on_console("shell-lambis", 1.02, back=0.14, turn=-30),
              on_console("fig-bronze-whale", 1.22),
              on_console("fig-rubber-duck", 1.70, back=0.10, turn=-35),
              on_console("fig-porcelain-horse", 1.92)]),
    ("retro", "Ретро: бюст, альбомы, будильник, жестяной робот, камера, хавортия",
     "Мраморный бюст размером с ладонь, стопка альбомов, будильник с колокольчиками, заводной жестяной робот, "
     "плёночная камера, хавортия",
     lambda: [on_console("bust-marble-mini", 0.36, turn=15),
              on_console("books-stack-l", 0.78, back=0.02),
              on_console("clock-alarm-retro", 1.08, back=0.05, turn=-10),
              on_console("fig-tin-robot", 1.22, back=0.08, turn=10),
              on_console("camera-vintage", 1.70, back=0.06, turn=25),
              on_console("plant-haworthia-mini", 1.93)]),
]
CC0 = "Фигурки: Poly Haven (CC0) и свои процедурные модели; источники — SOURCE.md в папках реквизита."


def console_slot():
    opts = [{"id": "none", "name": "Нет"}]
    for oid, name, note, parts in SETS:
        p = parts()
        opts.append({"id": oid, "name": name, "note": f"{note}. {CC0}", "size": [r3(CON["d"]), 0.15, r3(CON_Z1 - CON_Z0)],
                     "thumb": f"models/decor/tvwall/thumbs/{oid}.jpg", "collide": False, "parts": p})
    return {"id": "console", "label": "На тумбе", "default": "curios", "options": opts}


def joke_slot():
    return {"id": "joke", "label": "Фигурка с юмором", "default": "cactus", "options": [
        {"id": "none", "name": "Нет"},
        {"id": "cactus", "name": "Кактус «с намёком», глазурь, h 13 см",
         "note": "Сувенир-шутка: керамический кактус в терракотовом горшке, столбик и два круглых отростка. "
                 "Своя процедурная модель (tools/decor/tvwall/build.py).",
         "size": list(map(r3, size("fig-cheeky-cactus"))), "thumb": "models/decor/props/fig-cheeky-cactus/thumb.jpg",
         "collide": False, "parts": [on_console("fig-cheeky-cactus", JOKE_Z, back=0.13, turn=10)]}]}


# ---------- слот 3: картины справа от ТВ ----------
# Левее ТВ места нет (угол с окном), поэтому всё справа: от правого края ТВ 85″ при положении по умолчанию + 11 см.
tv = FURN["tv"]


def tv_half_w(inch):
    diag = inch * 0.0254
    return diag * 16 / math.hypot(16, 9) / 2 + tv["bezel"]


ART_Z0 = D0["tvAlong"] + tv_half_w(85) + 0.11      # левый край картин: дальше любого ТВ из списка
ART_MID = 1.33                                     # средняя линия развески (центр ТВ 1.10 + 23 см)
IKEA = {
    "205.489.18": ("RÖDALM Ramka, 30x40 cm, czarny", 29.99, "https://www.ikea.com/pl/pl/p/roedalm-ramka-czarny-20548918/"),
    "105.489.14": ("RÖDALM Ramka, 40x50 cm, orzech", 39.99, "https://www.ikea.com/pl/pl/p/roedalm-ramka-orzech-10548914/"),
    "204.193.89": ("LOMVIKEN Ramka, 21x30 cm, złoty kolor", 19.99, "https://www.ikea.com/pl/pl/p/lomviken-ramka-zloty-kolor-20419389/"),
    "702.867.73": ("LOMVIKEN Ramka, 50x70 cm, czarny", 69.99, "https://www.ikea.com/pl/pl/p/lomviken-ramka-czarny-70286773/"),
    "805.898.35": ("MOSSLANDA Półka na zdjęcia, 55 cm, imit. dębu", 19.99, "https://www.ikea.com/pl/pl/p/mosslanda-polka-na-zdjecia-imit-debu-80589835/"),
    "505.663.93": ("RÖDALM Ramka, 21x30 cm, imit. dębu", 14.99, "https://www.ikea.com/pl/pl/p/roedalm-ramka-imit-debu-50566393/"),
}
PD = "Картины — общественное достояние (Wikimedia Commons), печать на бумаге; источники — SOURCE.md рамок."


def ikea_option(oid, name, arts, note, parts, size_):
    price = round(sum(IKEA[a][1] for a in arts), 2)
    links = f" Ссылки: {'; '.join(IKEA[a][2] for a in arts[1:])}" if len(arts) > 1 else ""
    return {"id": oid, "name": name, "brand": "IKEA", "article": " + ".join(arts), "url": IKEA[arts[0]][2],
            "price_pln": price, "finish": " + ".join(IKEA[a][0] for a in arts),
            "note": f"{note} {PD}{links}",
            "size": list(map(r3, size_)), "thumb": f"models/decor/tvwall/thumbs/{oid}.jpg", "collide": False, "parts": parts}


def art_slot():
    wv, hv, _ = size("rodalm-30x40-vertumnus")
    wp, hp, _ = size("rodalm-40x50-poker")
    wh, hh, _ = size("lomviken-21x30-hare")
    col2 = ART_Z0 + wv + 0.07 + wp / 2                       # правая колонка: собаки над зайцем
    stack = hp + 0.06 + hh
    trio = [on_wall("rodalm-30x40-vertumnus", ART_Z0 + wv / 2, ART_MID - hv / 2),
            on_wall("rodalm-40x50-poker", col2, ART_MID + stack / 2 - hp),
            on_wall("lomviken-21x30-hare", col2, ART_MID - stack / 2)]
    wt, ht, _ = size("lomviken-50x70-tiger")
    wl, hl, dl = size("mosslanda-55-gallery")
    ledge_y, ledge_z = 1.10, ART_Z0 + wl / 2
    led = SIZES["mosslanda-55-gallery"]
    ew, eh, ed = size("fig-wooden-elephant")
    # слон на свободном правом конце полки: перед следа у переднего края полки минус бортик ~1 см
    ele_front = dl / 2 - 0.012
    ledge = [on_wall("mosslanda-55-gallery", ledge_z, ledge_y),
             {"model": model_path("fig-wooden-elephant"),
              "pos": [r3(WALL_X - dl / 2 - GAP - (ele_front - ed / 2)), r3(ledge_y + led["shelfTop"]), r3(ledge_z + wl / 2 - 0.01 - ew / 2)],
              "rot": FACE, "anchor": "tv"}]
    return {"id": "art", "label": "Картины у ТВ", "default": "trio", "options": [
        {"id": "none", "name": "Нет"},
        ikea_option("trio", "Три картины: Арчимбольдо, «Собаки играют в покер», «Заяц» Дюрера",
                    ["205.489.18", "105.489.14", "204.193.89"],
                    "Развеска справа от ТВ: «Вертумн» Арчимбольдо (1591) в чёрной RÖDALM 30×40, «A Friend in Need» "
                    "К. М. Кулиджа (1903) в ореховой RÖDALM 40×50, «Молодой заяц» Дюрера (1502) в золотой LOMVIKEN 21×30.",
                    trio, [ART_Z0 + wv + 0.07 + wp - ART_Z0, stack, 0.032]),
        ikea_option("tiger", "Большая картина: Руссо «Тигр в тропической грозе»", ["702.867.73"],
                    "«Surprised!» Анри Руссо (1891) в чёрной LOMVIKEN 50×70, горизонтально справа от ТВ.",
                    [on_wall("lomviken-50x70-tiger", ART_Z0 + wt / 2, ART_MID - ht / 2)], [wt, ht, 0.018]),
        ikea_option("ledge", "Полка MOSSLANDA 55: коты Куниёси, заяц Дюрера и слон",
                    ["805.898.35", "505.663.93", "204.193.89"],
                    "Полка для картин справа от ТВ, на ней прислонены «Коты, складывающиеся в иероглифы» Утагавы Куниёси "
                    "(ок. 1842) в RÖDALM 21×30 и «Молодой заяц» Дюрера в LOMVIKEN 21×30; резной слон (Poly Haven, CC0).",
                    ledge, [wl, hl, dl]),
    ]}


# ---------- слот 4: растение у тумбы ----------
def plant_slot():
    w, h, d = 0.578, 0.918, 0.649            # габарит STRELITZIA 19 (props/strelitzia-19/SOURCE.md)
    z = CON_Z1 + 0.04 + w / 2
    x = WALL_X - 0.005 - d / 2
    return {"id": "plant", "label": "Растение у тумбы", "default": "strelitzia", "options": [
        {"id": "none", "name": "Нет"},
        {"id": "strelitzia", "name": "STRELITZIA roślina doniczkowa, 19 cm + HASSELBUKETT osłonka 19 cm", "brand": "IKEA",
         "article": "104.267.19 + 406.218.23", "url": "https://www.ikea.com/pl/pl/p/strelitzia-roslina-doniczkowa-rajski-ptak-10426719/",
         "price_pln": 139.98, "finish": "Rajski ptak; osłonka beżowa",
         "note": "Справа от тумбы, вдоль стены ТВ. Модели — общий реквизит props/strelitzia-19 и props/hasselbukett-19.",
         "size": [w, h, d], "thumb": "models/decor/props/strelitzia-19/thumb.jpg",
         "parts": [{"model": "models/decor/props/hasselbukett-19/model.glb", "pos": [r3(x), 0, r3(z)], "rot": FACE, "anchor": "console"},
                   {"model": "models/decor/props/strelitzia-19/model.glb", "pos": [r3(x), 0.025, r3(z)], "rot": FACE, "anchor": "console"}]}]}


def main():
    zone = {"zone": "tvwall", "title": "Стена с ТВ", "room": FURN["room"],
            "_about": "Генерирует tools/decor/tvwall/compose.py — руками не править. Слоты и опции только дописывать в конец.",
            "slots": [console_slot(), joke_slot(), art_slot(), plant_slot()]}
    out = os.path.join(WEB, "spec", "decor", "tvwall.json")
    with open(out, "w") as f:
        json.dump(zone, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("written", out)
    if "--no-thumbs" not in sys.argv:
        thumbs(zone)


def collage(o, out):
    """Набор на тумбе длиной 1,8 м в одном кадре мелок: миниатюра — сетка 2×2 из миниатюр первых четырёх вещей."""
    from PIL import Image
    seen = []
    for p in o["parts"]:
        t = os.path.join(WEB, os.path.dirname(p["model"]), "thumb.jpg")
        if t not in seen and "books-" not in t:
            seen.append(t)
    im = Image.new("RGB", (256, 256), (236, 234, 230))
    for i, t in enumerate(seen[:4]):
        im.paste(Image.open(t).convert("RGB").resize((128, 128), Image.LANCZOS), ((i % 2) * 128, (i // 2) * 128))
    im.save(out, quality=85)


def thumbs(zone):
    """Миниатюры опций-сборок: картины и полка — сборка в Blender (tools/decor/living/preview.py), перед к зрителю;
    наборы на тумбе — сетка из миниатюр вещей (collage)."""
    out_dir = os.path.join(WEB, "models", "decor", "tvwall", "thumbs")
    os.makedirs(out_dir, exist_ok=True)
    jobs = []
    for s in zone["slots"]:
        for o in s["options"]:
            if not o.get("thumb", "").startswith("models/decor/tvwall/thumbs/"):
                continue
            if s["id"] == "console":
                collage(o, os.path.join(WEB, o["thumb"]))
                continue
            xs, zs = [p["pos"][0] for p in o["parts"]], [p["pos"][2] for p in o["parts"]]
            cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
            base = min(p["pos"][1] for p in o["parts"])
            # поворот сборки на +90° вокруг Y: стена ТВ уходит назад, перед смотрит в +Z
            glbs = [{"glb": os.path.join(WEB, p["model"]), "pos": [p["pos"][2] - cz, p["pos"][1] - base, -(p["pos"][0] - cx)],
                     "rot": p["rot"] + 90} for p in o["parts"]]
            jobs.append({"glbs": glbs, "out": os.path.join(WEB, o["thumb"]), "mode": "thumb"})
    with tempfile.TemporaryDirectory() as tmp:
        jf = os.path.join(tmp, "jobs.json")
        json.dump(jobs, open(jf, "w"))
        subprocess.run(["blender", "-b", "--python", os.path.join(ROOT, "tools", "decor", "living", "preview.py"), "--", jf],
                       check=True, stdout=subprocess.DEVNULL)
    print("thumbs:", out_dir)


main()
