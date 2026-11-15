# Каталог зоны «Балкон» -> web/spec/decor/balcony.json (+ миниатюры опций web/models/decor/balcony/thumbs/).
#   python3 tools/decor/balcony/compose.py <tmp> [--no-thumbs]
# Раскладки — здесь, а не в JSON. Габариты, высоты сидений и кромки — assets.json (пишет build.py), товары и цены —
# products.json. Порядок слотов и опций = код варианта: новое только в конец, ничего не переставлять.
#
# Балкон (web/spec/plan.generated.json → balcony, проёмы): плита x −2.49…5.83, z −2.32…−0.38, верх плиты y −0.02
# (model.js), настил RUNNEN 2 см кладёт пол балкона вровень с квартирой (y 0). Зона прогулки — до внутренних граней
# ограждения (walk.js OUTDOOR.rail от края плиты), поручень 1,08 м. Потолок балкона — низ балкона сверху (потолок + 0,25).
# Двери на балкон открываются внутрь квартиры (model.js): снаружи их дуги нет, но перед каждой — проход ≥ 70 см:
#   комната 3 — x −1.68…−0.48 (без вещей x −1.78…−0.38 до z −1.10);
#   гостиная — x 3.06…5.56, открывается створка x 4.64–5.49 (без вещей x ≥ 4.45: проход и место у перил 1,2 м для охоты).
# Всё стоит одной полосой у фасада (глубина ≤ 0,76, крона бамбука в левом углу 0,9): вдоль перил сквозной
# променад ≥ 1,08 м (в углу 0,93), у перил нет ничего выше поручня — поле за балконом (hunt.js) видно с любой точки на высоте глаз 1,68.
# Сезоны: части с "season" видны только летом или только зимой (decor.js, sceneSeason: выбор «Сезон» или по дате сцены).
# Конец файла — слоты-поля (field): места полей сцены в коде ссылки, см. блок перед spec.
import json, math, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
WEB = os.path.join(ROOT, "web")
TMP = os.path.abspath(sys.argv[1])
A = json.load(open(os.path.join(HERE, "assets.json")))
P = json.load(open(os.path.join(HERE, "products.json")))
PR = {p["key"]: p for p in P["ikea"] + P["made"] + P["reuse"]}
PLAN = json.load(open(os.path.join(WEB, "spec", "plan.generated.json")))
RAIL = float(re.search(r"rail:\s*([\d.]+)", open(os.path.join(WEB, "js", "walk.js")).read()).group(1))

BAL = PLAN["balcony"]
OPEN = {o["id"]: o for o in PLAN["openings"]}
FLOOR = -0.02                                   # верх плиты балкона (model.js)
DECK = 0.0                                      # верх настила RUNNEN (2 см)
ZW = min(o["z0"] for o in PLAN["openings"] if o.get("z0", 0) < 0 and o["along"] == "x")   # наружная грань фасада
X0, X1, Z0 = BAL["x0"] + RAIL, BAL["x1"] - RAIL, BAL["z0"] + RAIL                            # зона прогулки
RAIL_Z = Z0 - 0.025                              # ось поручня (model.js buildRailing)
RAIL_AXIS_Y = 1.06                               # середина поручня 1,04…1,08
CEIL = PLAN["ceiling"] + 0.25                    # низ балкона сверху (model.js)
BACK = ZW - 0.02                                 # спинки и донья — в 2 см от фасада
WIN = OPEN["kitchen_window"]
SOFA_X = (WIN["x0"] + WIN["x1"]) / 2             # диван — по оси кухонного окна (подоконник 0,9 выше спинки)

M = lambda aid: f"models/decor/{A[aid]['dest']}/{aid}/model.glb"
SIZE = {"fejka-bamboo": [0.901, 1.70, 0.725]}           # чужой реквизит (props/fejka-bamboo/SOURCE.md)
S = lambda aid: A[aid]["size"] if aid in A else SIZE[aid]
R2 = lambda v: [round(x, 3) for x in v]


def place(host, hrot, lx, ly, lz, lrot=0):
    """Точка в осях вещи-носителя (перед +Z, поворот hrot°) -> координаты квартиры (как toFrame в decor.js)."""
    a = math.radians(hrot)
    return [host[0] + lx * math.cos(a) + lz * math.sin(a), host[1] + ly, host[2] - lx * math.sin(a) + lz * math.cos(a)], hrot + lrot


def part(aid, pos, rot, **kw):
    return {"model": M(aid), "pos": R2(pos), "rot": round(rot, 1), **kw}


def money(keys):
    """[(key, штук)] -> сумма и строка состава для note."""
    tot, txt = 0.0, []
    for k, n in keys:
        p = PR[k]
        tot += p["price_pln"] * n
        txt.append(f"{p['name']} {p['type']}, {p['measure']}{', ' + p['finish'] if p.get('finish') else ''}"
                   f"{f' ×{n}' if n > 1 else ''} — {p['price_pln']:g} zł")
    return round(tot, 2), " · ".join(txt)


def option(oid, name, keys, parts, note, main=None, **kw):
    price, comp = money(keys)
    m = PR[main or keys[0][0]]
    lo, hi = [9e9] * 3, [-9e9] * 3                   # габарит опции: летний состав (как в миниатюре)
    for p in parts:
        aid = p["model"].split("/")[-2]
        if p.get("season") == "winter":
            continue
        w, h, d = S(aid)
        c, s_ = abs(math.cos(math.radians(p["rot"]))), abs(math.sin(math.radians(p["rot"])))
        ext = [(w * c + d * s_) / 2, h, (w * s_ + d * c) / 2]
        for k in (0, 2):
            lo[k], hi[k] = min(lo[k], p["pos"][k] - ext[k]), max(hi[k], p["pos"][k] + ext[k])
        lo[1], hi[1] = min(lo[1], p["pos"][1]), max(hi[1], p["pos"][1] + h)
    shown = [p for p in parts if p.get("season") != "winter"]
    one = len(shown) == 1 and shown[0]["model"].startswith("models/decor/balcony/") and SLOT != "deck"
    return {"id": oid, "name": name, "brand": "IKEA", "article": m["article"], "url": m["url"], "price_pln": price,
            "finish": m.get("finish"), "note": f"{note} Состав: {comp}.", "size": R2([b - a for a, b in zip(lo, hi)]),
            "thumb": shown[0]["model"].replace("model.glb", "thumb.jpg") if one else f"models/decor/balcony/thumbs/{SLOT}-{oid}.jpg",
            **kw, "parts": parts}


NONE = {"id": "none", "name": "Нет"}
slots = []

# ---------- пол: настил RUNNEN на всю зону прогулки ----------
SLOT = "deck"
W, D = X1 - X0, ZW - Z0
packs = math.ceil(W * D / 0.81 - 1e-6)
deck_pos = [(X0 + X1) / 2, FLOOR, (Z0 + ZW) / 2]
slots.append({"id": "deck", "label": "Пол: настил", "default": "runnen-akacja", "options": [NONE] + [
    option(k, f"RUNNEN {f} — настил на весь балкон, {W:.2f} × {D:.2f} м", [(k, packs)],
           [part(k, deck_pos, 0)],
           f"Плиты 30 × 30 × 2 см на всю площадь ({W * D:.1f} м², {packs} упаковок по 0,81 м²): пол балкона встаёт "
           f"вровень с квартирой. Края у ограждения подрезаются по месту.", collide=False)
    for k, f in (("runnen-akacja", "akacja"), ("runnen-trawa", "sztuczna trawa"))]})

# ---------- диван у стены под кухонным окном ----------
SLOT = "sofa"
mod, mw = A["nammaro-module"], S("nammaro-module")
mz = BACK - mw[2] / 2
sk, cu = A["sheepskin-toftlund-drape"], S("cushion-tofto-50")


def seat_of(info, label):
    """depth — от центра следа к середине сиденья (между передней кромкой и спинкой), назад — плюс."""
    return {"h": info["seat"], "depth": -round((info["seatFront"] + info["backFront"]) / 2, 3), "label": label}


def cushion(host, info, lx, tilt):
    """Летом: подушка TOFTÖ стоит на сиденье, прислонена к спинке."""
    p, r = place(host, 180, lx, info["seat"] - 0.02, info["backFront"] + cu[2] / 2 + 0.005, tilt)
    return part("cushion-tofto-50", p, r, season="summer")


def skin(host, info, lx):
    """Зимой: шкура TOFTLUND лежит на сиденье и свисает за переднюю кромку (edge — кромка в осях модели)."""
    p, r = place(host, 180, lx, info["seat"] + 0.004 - sk["edge"][1], info["seatFront"] - sk["edge"][0])
    return part("sheepskin-toftlund-drape", p, r, season="winter")


def throw(host, info, lx):
    """Зимой: сложенный плед KLIPPOXEL на сиденье."""
    p, r = place(host, 180, lx, info["seat"] + 0.02, info["seatFront"] - 0.2, 12)
    return part("throw-klippoxel", p, r, season="winter")


hosts = [[SOFA_X + (i - 0.5) * mw[0], FLOOR, mz] for i in range(2)]      # левый и правый модуль (лицом к полю, −Z)
sofa_parts = [part("nammaro-module", h, 180, seat=seat_of(mod, "Сесть на диван")) for h in hosts]
sofa_parts += [cushion(hosts[0], mod, 0.1, 7), cushion(hosts[1], mod, -0.1, -7),
               skin(hosts[0], mod, 0), skin(hosts[1], mod, 0), throw(hosts[1], mod, -0.05)]
bench, bw = A["nammaro-bench"], S("nammaro-bench")
bh = [SOFA_X, FLOOR, BACK - bw[2] / 2]
bench_parts = [part("nammaro-bench", bh, 180, seat=seat_of(bench, "Сесть на скамью")),
               cushion(bh, bench, 0.3, 7), skin(bh, bench, -0.24), throw(bh, bench, 0.24)]
SEASON_TEXT = ("Меняется само по дате сцены: летом (апрель–октябрь) — подушки TOFTÖ, зимой (ноябрь–март) — "
               "шкуры TOFTLUND и плед KLIPPOXEL.")
slots.append({"id": "sofa", "label": "Диван у стены", "default": "nammaro-sofa2", "options": [NONE,
    option("nammaro-sofa2", "NÄMMARÖ диван 2-местный 126 см + подушки KUDDARNA, сезонный текстиль",
           [("nammaro-seat-63", 2), ("nammaro-back-60", 2), ("kuddarna-seat-62", 2), ("kuddarna-back-62", 2),
            ("tofto", 2), ("inner-50", 2), ("toftlund", 2), ("klippoxel", 1)], sofa_parts,
           f"Модульный диван из акации под кухонным окном, спиной к фасаду, лицом к полю; 2 места. {SEASON_TEXT}",
           main="nammaro-seat-63"),
    option("nammaro-bench", "NÄMMARÖ скамья со спинкой 106 см + подушки KUDDARNA, сезонный текстиль",
           [("nammaro-bench", 1), ("kuddarna-chair-44", 2), ("tofto", 1), ("inner-50", 1), ("toftlund", 1), ("klippoxel", 1)],
           bench_parts, f"Скамья вместо дивана — легче и уже. {SEASON_TEXT}")]})

# ---------- табурет-столик у дивана ----------
SLOT = "side"
st = S("nammaro-stool")
STOOL = [SOFA_X + mw[0] + 0.06 + st[0] / 2, FLOOR, BACK - st[2] / 2 - 0.15]
slots.append({"id": "side", "label": "Столик у дивана", "default": "nammaro-stool", "options": [NONE,
    option("nammaro-stool", "NÄMMARÖ складной табурет как столик у дивана", [("nammaro-stool", 1)],
           [part("nammaro-stool", STOOL, 0)], "Под чашку и фонарь справа от дивана; складывается на зиму, если нужно место.")]})

# ---------- столик на двоих перед глухой частью двери гостиной ----------
SLOT = "bistro"
DOOR_FREE = OPEN["kitchen_balcony_door"]["x0"] + OPEN["kitchen_balcony_door"]["fixed_left"] - 0.15   # 4.46: дальше — проход


def bistro(table, chair, tuck, keys, oid, name, note):
    tw, cw = S(table), S(chair)
    xt = DOOR_FREE - 0.03 - tw[0] / 2 - cw[2] + tuck
    zt = BACK - tw[2] / 2
    c = A[chair]
    sx = {"h": c["seat"], "depth": -round((c["seatFront"] + (c["backFront"] if c.get("backFront") is not None else -0.1)) / 2, 3),
          "label": "Сесть за столик"}
    parts = [part(table, [xt, FLOOR, zt], 0),
             part(chair, [xt - tw[0] / 2 - cw[2] / 2 + tuck, FLOOR, zt - 0.03], 90, seat=sx),
             part(chair, [xt + tw[0] / 2 + cw[2] / 2 - tuck, FLOOR, zt - 0.03], -90, seat=sx)]
    return option(oid, name, keys, parts, note)


slots.append({"id": "bistro", "label": "Столик на двоих", "default": "nammaro-75", "options": [NONE,
    bistro("nammaro-table-75", "nammaro-armchair", 0.07, [("nammaro-table-75", 1), ("nammaro-armchair", 2), ("kuddarna-chair-44", 2)],
           "nammaro-75", "NÄMMARÖ стол 75×63 + 2 кресла с подлокотниками и подушками KUDDARNA",
           "Завтрак на двоих у глухой части двери гостиной; правое кресло кончается за 15 см до открывающейся створки."),
    bistro("tarno-table", "tarno-chair", 0.05, [("tarno-table", 1), ("tarno-chair", 2)],
           "tarno", "TÄRNÖ стол 55×54 + 2 складных стула",
           "Лёгкий складной комплект: акация и чёрная сталь, на зиму убирается.")]})

# ---------- зелень в длинной донице между дверью комнаты 3 и диваном ----------
SLOT = "planter"
ap = S("asparen")
PL = [SOFA_X - mw[0] - 0.08 - ap[0] / 2, FLOOR, BACK - ap[2] / 2]
pp = [part("asparen", PL, 180)]
for lx in (-0.2, 0.2):
    p, r = place(PL, 180, lx, 0.21, 0)
    pp.append(part("fejka-lavender", p, r, season="summer"))
p, r = place(PL, 180, 0, 0.27, 0)
pp.append(part("vinterfint-fir-84", p, r, season="winter"))
for lx, lr in ((-0.24, 0), (0.24, 180)):
    p, r = place(PL, 180, lx, 0.12, 0, lr)
    pp.append(part("vinterfint-pine-bunch", p, r, season="winter"))
slots.append({"id": "planter", "label": "Зелень у стены", "default": "asparen-seasonal", "options": [NONE,
    option("asparen-seasonal", "ASPAREN длинная доница 89 см: летом лаванда, зимой ёлочка и сосновые ветки",
           [("asparen", 1), ("fejka-lawenda", 2), ("vinterfint-84", 1), ("vinterfint-galazka", 6)], pp,
           "Между дверью комнаты 3 и диваном. Меняется само по дате сцены: летом — две лаванды FEJKA в белых горшках, "
           "зимой — ёлочка VINTERFINT 84 см и шесть сосновых веток. Всё искусственное, для улицы.")]})

# ---------- угол слева (у фасада, за дверью комнаты 3) ----------
SLOT = "corner"
ny = S("nypon-32")
CORNER = [X0 + 0.33, FLOOR, BACK - 0.45]           # крона бамбука 73 × 90 см (rot 90): между боковым ограждением и дверью
cp = [part("nypon-32", CORNER, 0),
      {"model": PR["fejka-bamboo"]["model"], "pos": R2([CORNER[0], FLOOR + 0.14, CORNER[2]]), "rot": 90, "season": "summer"}]
cp.append(part("vinterfint-fir-150", [CORNER[0], FLOOR + 0.045, CORNER[2]], 0, season="winter"))   # ствол в кашпо: NYPON — носитель
slots.append({"id": "corner", "label": "Угол у фасада", "default": "seasonal", "options": [NONE,
    option("seasonal", "NYPON кашпо 32: летом бамбук FEJKA, зимой ёлка VINTERFINT 150 с огоньками STRÅLA",
           [("nypon-32", 1), ("fejka-bamboo", 1), ("vinterfint-150", 1), ("strala-mikro", 1)], cp,
           "Высокая зелень — только в углу у фасада, далеко от перил и прохода. Меняется само по дате сцены: "
           "летом бамбук 170 см, зимой ёлка 150 см (Ø 51) с тёплыми микро-огоньками на батарейках.",
           main="nypon-32")]})

# ---------- гирлянда ----------
SLOT = "lights"
sv = S("svartra-festoon")
gk = A["getkal-railing"]
slots.append({"id": "lights", "label": "Гирлянда", "default": "svartra", "options": [NONE,
    option("svartra", "SVARTRÅ 12 ламп-шаров под потолком балкона", [("svartra", 1)],
           [part("svartra-festoon", [(SOFA_X - mw[0] - 0.2 + DOOR_FREE) / 2, CEIL - 0.02 - sv[1], BACK - 0.3], 0)],
           "Провисает между крючками под балконом сверху над диваном и столиком (низ ламп ~2,6 м — над головой). "
           "В кадре светится всегда; источника света не добавляет (без лишних теней и шейдеров).", collide=False),
    option("getkal", "GETKÅL 15 м микро-огоньков вокруг поручня", [("getkal", 1)],
           [part("getkal-railing", [(X0 + X1) / 2, RAIL_AXIS_Y - gk["axisY"], RAIL_Z], 0)],
           "Обвивает поручень по всей длине: на высоте перил, вид на поле не заслоняет.", collide=False)]})

# ---------- фонари со свечами LED ----------
SLOT = "lanterns"
LZ = PL[2] - ap[2] / 2 - 0.12
lp = [part("lantern-borrby-28", [STOOL[0], FLOOR + st[1], STOOL[2]], 15, on="side"),   # на сиденье табурета
      part("lantern-berggran-34", [PL[0] + 0.26, FLOOR, LZ], 20, season="winter"),
      part("lantern-borrby-20", [PL[0] + 0.42, FLOOR, LZ + 0.02], -10, season="winter")]
slots.append({"id": "lanterns", "label": "Фонари со свечами", "default": "lanterns", "options": [NONE,
    option("lanterns", "BORRBY и BERGGRAN со свечами SMÅLOM LED: весь год на столике, зимой ещё два у доницы",
           [("borrby-28", 1), ("smalom-14", 1), ("berggran-34", 1), ("smalom-19", 1), ("borrby-20", 1), ("smalom-9", 1)], lp,
           "Свечи на батарейках — безопасно на улице. Фонарь на табурете — круглый год (нет табурета — нет и фонаря); "
           "зимой (ноябрь–март) к нему добавляются BERGGRAN 34 см и BORRBY 20 см на полу у доницы.", collide=False)]})

# ---------- уличный ковёр перед диваном ----------
SLOT = "rug"
rug_pos = [PL[0] + ap[0] / 2 + 0.02 + 1.15, DECK, ZW - 0.02 - 0.8]   # от доницы вправо: под диваном, табуретом и креслом
slots.append({"id": "rug", "label": "Уличный ковёр", "default": "morum", "options": [NONE] + [
    option(oid, f"{PR[k]['name']} {PR[k]['measure']}, {PR[k]['finish']} — безворсовый, для улицы", [(k, 1)],
           [part(k, rug_pos, 90)], "Лежит на настиле под передними ножками дивана, 230 см вдоль фасада. Без настила — на 2 см выше плиты.",
           collide=False)
    for oid, k in (("morum", "morum-160"), ("lydersholm", "lydersholm-160"), ("lattbetong", "lattbetong-160"))]})

# ---------- поля-настройки (не товары): только держат место поля в коде варианта ----------
# Балкон — последняя зона index.json, поэтому его хвост — хвост всего кода ссылки (SCHEMA_V3 в main.js). Новое поле
# сцены (не товар) дописывается сюда слотом {"id", "field"} в самый конец; варианты поля — у владельца (FIELDS в
# web/js/decor.js). Новые слоты-товары балкона — тоже только после них. Ничего не переставлять.
slots.append({"id": "season", "field": "balconySeason", "label": "Сезон",
              "_note": "По дате / Лето / Зима: какие части с season видны (decor.js, SEASON_OPTIONS)."})
slots.append({"id": "hallglow", "field": "hallGlow", "label": "Подсветка прихожей",
              "_note": "Поле светильников прихожей (lamps.js, LAMP_OPTIONS.hallGlow); место — здесь, в конце кода."})

spec = {"zone": "balcony", "title": "Балкон", "room": "balcony",
        "_note": "Генерирует tools/decor/balcony/compose.py — править раскладки там. Части с season видны только летом или "
                 "зимой (decor.js). Порядок слотов и опций = код варианта: новое только в конец. Слоты с field — "
                 "не товары, а места полей сцены в коде ссылки (decor.js, FIELDS).",
        "slots": slots}
out = os.path.join(WEB, "spec", "decor", "balcony.json")
json.dump(spec, open(out, "w"), ensure_ascii=False, indent=1)
open(out, "a").write("\n")
print("spec", out, sum(len(s["options"]) - 1 for s in slots), "опций")

# ---------- миниатюры опций: летний состав (без частей season = winter), повёрнутый лицом в +Z ----------
# Одна часть — миниатюра самой модели (pack.py); настил — кусок текстуры плиток (make_tex.py, <tmp>/tex).
if "--no-thumbs" not in sys.argv:
    tdir = os.path.join(WEB, "models", "decor", "balcony", "thumbs")
    os.makedirs(tdir, exist_ok=True)
    jobs = []
    for s in slots:
        for o in s["options"][1:]:
            if "/thumbs/" not in o["thumb"]:
                continue
            outp = os.path.join(WEB, o["thumb"])
            if s["id"] == "deck":
                subprocess.run(["sips", "-s", "format", "jpeg", "-Z", "256", os.path.join(TMP, "tex", o["id"] + ".jpg"),
                                "--out", outp], check=True, stdout=subprocess.DEVNULL)
                continue
            ps = [p for p in o["parts"] if p.get("season") != "winter"]
            xs, zs = [p["pos"][0] for p in ps], [p["pos"][2] for p in ps]
            cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
            flip = 180 if ps[0]["rot"] == 180 else 0       # у стены лицом к полю: повернуть к камере
            glbs = [{"glb": os.path.join(WEB, p["model"]), "rot": p["rot"] - flip,
                     "pos": ([-(p["pos"][0] - cx), p["pos"][1] - FLOOR, -(p["pos"][2] - cz)] if flip else
                             [p["pos"][0] - cx, p["pos"][1] - FLOOR, p["pos"][2] - cz])} for p in ps]
            jobs.append({"glbs": glbs, "out": outp, "mode": "thumb"})
    jf = os.path.join(TMP, "option-thumbs.json")
    json.dump(jobs, open(jf, "w"))
    subprocess.run(["blender", "-b", "--python", os.path.join(os.path.dirname(HERE), "living", "preview.py"), "--", jf],
                   check=True, stdout=subprocess.DEVNULL)
    print(len(jobs), "миниатюр ->", tdir)
