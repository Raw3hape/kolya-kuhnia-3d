"""Окружение дома из OpenStreetMap -> web/spec/site.json (координаты квартиры, метры) + ассеты окружения.

Запуск из корня проекта:
    python3 tools/fetch_site.py                     # Overpass API -> site.json
    python3 tools/fetch_site.py --raw <файл.json>   # то же и сохранить сырой ответ (вне репозитория)
    python3 tools/fetch_site.py --from <файл.json>  # пересобрать без сети (тот же результат, детерминированно)
    python3 tools/fetch_site.py --assets            # скачать текстуры и машины окружения (нужны pillow, blender, npx)

Что известно и откуда (проверено 2026-11-15):
  • Дом — Avenir (Bouygues Immobilier), ul. Wschodu Słońca 6, Raków, Włochy, Warszawa.
    Корпус A, лестница A, piętro 03 (четвёртый уровень, считая партер). 7 надземных этажей + паркинг.
    В OSM: way 1491911406 (building=construction) внутри landuse=construction «Avenir» (way 451815457).
  • Ключ-план в source/plan-AA0304.pdf (север вверх): квартира — южный торец западного крыла,
    балкон на южном фасаде, западная стена тоже наружная (там дверь комнаты 2). Улица — на северо-востоке.
    План квартиры в PDF повёрнут на 180° к ключ-плану (его роза ветров смотрит вниз).
  • К югу — поле (landuse=farmland), на горизонте гостиницы у ul. Krakowska (~1.7 км, азимут 120–145°):
    это и видно на source/refs/photo-from-right.webp.

Что берётся из OSM как есть: дома (этажность, высота, крыша), дороги (ширина), тротуары-footway, парковки,
заборы и стены, фонари (highway=street_lamp), отдельные деревья и ряды, леса, кустарник, газоны, площадки.
Что достраивается правилами (OSM этого не знает; всё детерминированно, генератор random.Random(SEED)):
  • деревья: в лесу и кустарнике — сетка с разбросом; на газонах у дорог — шаг 11 м; на газонах и в парках — редко;
  • бордюры — по краям проезжих дорог, с разрывами на перекрёстках и съездах;
  • фонари — вдоль проезжих дорог шагом 32 м там, где в OSM их нет;
  • машины — на открытых парковках, ~65 % мест занято.
Подробности «в лицо» строятся только в радиусе R_DETAIL от квартиры; дальше — простые объёмы (site.js).

Оси квартиры: X вдоль оконной стены (вправо, если смотреть наружу), Z от окон вглубь, Y вверх.
Окна смотрят в −Z, его компасный азимут — windowBearingDeg. Пол квартиры y=0, земля y=−floorY.
"""
import argparse
import datetime
import http.cookiejar
import io
import json
import math
import pathlib
import random
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLAN = ROOT / "web" / "spec" / "plan.generated.json"
OUT = ROOT / "web" / "spec" / "site.json"
TEX_OUT = ROOT / "web" / "textures" / "site"
MODEL_OUT = ROOT / "web" / "models" / "site"
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = {"User-Agent": "apartment-visualizer/1.0"}

CENTER = (52.20028, 20.93945)   # центр запроса: дом Avenir
OWN_WAY = 1491911406            # контур своего дома в OSM
OWN_SITE = 451815457            # стройплощадка вокруг дома
FACADE_HINT_DEG = 180           # ключ-план: балкон на южном фасаде; точный азимут берётся из контура OSM
CORNER = ("x1", "z0")           # угол квартиры, совпадающий с углом дома: +X (запад) и −Z (юг) наружные
R_NEAR, R_ROAD, R_FAR = 400, 600, 2000   # м: все дома / дороги и площадки / только высокие дома перед окнами
R_DETAIL = 150                  # м: деревья у дорог, бордюры, фонари, машины, балконы соседей
R_GREEN = 300                   # м: деревья OSM, леса, кустарник
SEED = 20261115
# Где OSM устарел. Лес way 451815456 (natural=wood, нанесён вместе со стройплощадкой) стоит в 5–30 м перед окнами,
# но на source/refs/photo-from-right.webp из квартиры за балконом сразу поле, высоких деревьев нет: вырублен под
# стройку. Рисуем его лугом без деревьев.
AREA_OVERRIDE = {451815456: "meadow"}

# Высоты: этаж 3.1 м = потолок 2.64 + плита 0.25 + стяжка ~0.2; партер приподнят над землёй (паркинг под домом)
LEVEL = 3                # piętro 03
LEVELS = 7               # надземных этажей, rynekpierwotny.pl
STOREY_H = 3.1
GROUND_RISE = 0.5        # пол партера над уровнем земли (оценка)
PARAPET = 0.6
OWN_BALCONY_LEVELS = [1, 2, 5, 6]   # такие же балконы над и под нашим; 4-й строит model.js, 0 — сад

ROAD_W = {"motorway": 14, "trunk": 12, "primary": 10, "secondary": 8, "tertiary": 7,
          "motorway_link": 6, "trunk_link": 6, "primary_link": 6, "secondary_link": 6, "tertiary_link": 6,
          "unclassified": 6, "residential": 6, "living_street": 5, "service": 4, "pedestrian": 4,
          "footway": 2, "cycleway": 2, "path": 1.5}
CARRIAGE = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link",
            "secondary_link", "tertiary_link", "unclassified", "residential", "living_street"}   # бордюры и фонари
# Площадки: (ключ, значение) -> вид. Порядок видов в AREA_ORDER = порядок рисования (позже — сверху)
AREA_KIND = {("landuse", "farmland"): "field", ("landuse", "grass"): "grass", ("landuse", "meadow"): "meadow",
             ("landuse", "greenfield"): "meadow", ("landuse", "village_green"): "grass",
             ("landuse", "recreation_ground"): "grass", ("landuse", "allotments"): "garden",
             ("landuse", "orchard"): "garden", ("landuse", "forest"): "wood", ("landuse", "cemetery"): "grass",
             ("natural", "wood"): "wood", ("natural", "scrub"): "scrub", ("natural", "grassland"): "meadow",
             ("natural", "heath"): "meadow",
             ("leisure", "park"): "grass", ("leisure", "garden"): "garden", ("leisure", "pitch"): "pitch",
             ("leisure", "playground"): "playground",
             ("landuse", "construction"): "dirt", ("landuse", "brownfield"): "dirt",
             ("amenity", "parking"): "parking", ("highway", "pedestrian"): "paved"}
AREA_ORDER = ["field", "meadow", "grass", "garden", "wood", "scrub", "dirt", "pitch", "paved", "parking", "playground"]
DEFAULT_LEVELS = {"retail": 1, "supermarket": 1, "service": 1, "garage": 1, "garages": 1, "shed": 1,
                  "outbuilding": 1, "kiosk": 1, "carport": 1, "house": 2, "detached": 2, "semidetached_house": 2,
                  "construction": 4}
HALLS = {"retail", "supermarket", "commercial", "industrial", "warehouse"}   # одноэтажные залы ~6 м
SHEDS = {"garage", "garages", "shed", "service", "outbuilding", "kiosk", "carport"}
HOUSES = {"house", "detached", "semidetached_house", "terrace", "bungalow"}
# Фасады (их рисует site.js): жилые — четыре палитры польских новостроек, остальное по назначению
RESIDENTIAL_STYLES = ["white", "grey", "sand", "brick"]
STYLE_BY_KIND = {**{k: "panel" for k in HALLS | {"service", "garage", "garages"}},
                 **{k: "glass" for k in ("office", "university", "hotel")},
                 **{k: "house" for k in HOUSES},
                 **{k: "plain" for k in ("shed", "outbuilding", "kiosk", "carport")}}
# Цвета дальних силуэтов (sRGB): приглушённые штукатурка, бетон, кирпич. Дымку по расстоянию добавляет site.js
PALETTE = ["b7b2a9", "a8a49e", "c2baac", "9ea2a5", "b5aa98", "8e9399", "c8c3ba", "a39686"]
FENCE_H = {"fence": 1.6, "wall": 2.0, "hedge": 1.4, "guard_rail": 0.75, "retaining_wall": 1.0, "city_wall": 2.5}

# Деревья: виды (индекс в site.json), высота по умолчанию (м, от–до). Варшава: липа, клён, берёза, тополь, сосна
SPECIES = ["linden", "maple", "birch", "poplar", "pine", "shrub"]
SP_H = {"linden": (11, 17), "maple": (9, 14), "birch": (11, 17), "poplar": (17, 24), "pine": (14, 21), "shrub": (1.4, 3)}
STREET_SP = ["linden", "linden", "maple", "maple", "birch"]
LAWN_SP = ["maple", "linden", "birch", "birch", "pine"]
WOOD_SP = ["pine", "pine", "birch", "birch", "maple", "linden", "poplar"]
BROAD_SP = ["linden", "maple", "birch"]
# Машины: модели в web/models/site/cars.glb (порядок = индекс) и цвета, как на польских парковках
CAR_MODELS = ["sedan", "hatchback", "suv", "van"]
CAR_WEIGHTS = [0.4, 0.3, 0.22, 0.08]
CAR_COLOURS = ["c9ccd0", "8d9196", "2b2d31", "f2f2ef", "1d2a44", "6e1d22", "4a5560", "bfb4a2"]
CAR_COLOUR_W = [0.24, 0.18, 0.18, 0.18, 0.08, 0.05, 0.06, 0.03]


def query():
    lat, lon = CENTER
    a = lambda r: f"(around:{r},{lat},{lon})"
    q = f"""[out:json][timeout:180];
(
  way{a(R_NEAR)}[building];
  relation{a(R_NEAR)}[building];
  way{a(R_FAR)}[building]["building:levels"~"^([5-9]|[1-9][0-9])"];
  way{a(R_FAR)}[building][height];
  way{a(R_ROAD)}[highway~"^({'|'.join(ROAD_W)})$"];
  way{a(R_ROAD)}[amenity=parking];
  way{a(R_NEAR)}[landuse~"^(farmland|grass|meadow|greenfield|village_green|recreation_ground|allotments|orchard|forest|cemetery|construction|brownfield)$"];
  relation{a(R_NEAR)}[landuse~"^(farmland|grass|meadow|forest)$"];
  way{a(R_NEAR)}[natural~"^(wood|scrub|grassland|heath)$"];
  relation{a(R_NEAR)}[natural~"^(wood|scrub)$"];
  way{a(R_NEAR)}[leisure~"^(park|garden|pitch|playground)$"];
  node{a(R_GREEN)}[natural=tree];
  way{a(R_GREEN)}[natural=tree_row];
  way{a(R_GREEN)}[barrier~"^({'|'.join(FENCE_H)})$"];
  node{a(R_GREEN)}[highway=street_lamp];
);
out geom tags;"""
    body = urllib.parse.urlencode({"data": q}).encode()
    with urllib.request.urlopen(urllib.request.Request(OVERPASS, body, UA), timeout=240) as r:
        return json.loads(r.read())


# ---------- геометрия ----------

KX = 111320 * math.cos(math.radians(CENTER[0]))
KY = 110574


def en(p):   # lat/lon -> метры на восток/север от CENTER
    return ((p["lon"] - CENTER[1]) * KX, (p["lat"] - CENTER[0]) * KY)


def bearing(dx, dy):
    return math.degrees(math.atan2(dx, dy)) % 360


def ang_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


def area(poly):
    return 0.5 * sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(poly, poly[1:] + poly[:1]))


def inside(pt, poly):
    x, y, c = pt[0], pt[1], False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def line_dist(p, line):
    return min(seg_dist(p, a, b) for a, b in zip(line, line[1:]))


def simplify(pts, tol):
    """Дуглас–Пекер для ломаной."""
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    L = math.hypot(x1 - x0, y1 - y0) or 1e-9
    d = [abs((x1 - x0) * (y0 - p[1]) - (x0 - p[0]) * (y1 - y0)) / L for p in pts[1:-1]]
    i = max(range(len(d)), key=d.__getitem__)
    if d[i] <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:i + 2], tol)[:-1] + simplify(pts[i + 1:], tol)


def ring(pts, tol):
    pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return []
    # замкнутый контур упрощаем двумя половинами, чтобы концы не залипли
    h = len(pts) // 2
    s = simplify(pts[:h + 1], tol)[:-1] + simplify(pts[h:] + [pts[0]], tol)[:-1]
    return s if len(s) >= 3 and abs(area(s)) > 1 else []


def clip(poly, a, b, c):
    """Сазерленд–Ходжман: оставляет часть с a·x + b·z <= c."""
    out = []
    for p, q in zip(poly, poly[1:] + poly[:1]):
        fp, fq = a * p[0] + b * p[1] - c, a * q[0] + b * q[1] - c
        if fp <= 0:
            out.append(p)
        if (fp < 0 < fq) or (fq < 0 < fp):
            t = fp / (fp - fq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return out


def outer_rings(rel):
    """Внешние кольца мультиполигона: склеиваем пути по концам."""
    segs = [[en(p) for p in m["geometry"]] for m in rel.get("members", [])
            if m.get("role") == "outer" and m.get("geometry")]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        rings.append(cur)
    return rings


def num(v):
    try:
        return float(str(v).split(";")[0].replace(",", ".").replace("m", "").strip())
    except ValueError:
        return None


def offset_line(line, d):
    """Параллельная ломаная на расстоянии d (влево от направления, если d > 0); стыки «в ус», ус ограничен."""
    n = len(line)
    nor = []
    for i in range(n - 1):
        dx, dy = line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]
        L = math.hypot(dx, dy) or 1
        nor.append((-dy / L, dx / L))
    out = []
    for i, p in enumerate(line):
        a, c = nor[max(0, i - 1)], nor[min(n - 2, i)]
        mx, my = a[0] + c[0], a[1] + c[1]
        ml = math.hypot(mx, my) or 1
        mx, my = mx / ml, my / ml
        k = d / max(0.5, mx * c[0] + my * c[1])
        out.append((p[0] + mx * k, p[1] + my * k))
    return out


def resample(line, step):
    """Точки вдоль ломаной через step метров: (точка, единичное направление)."""
    out, carry = [], 0.0
    for a, b in zip(line, line[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1e-6:
            continue
        ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        t = carry
        while t <= L:
            out.append(((a[0] + ux * t, a[1] + uy * t), (ux, uy)))
            t += step
        carry = t - L
    return out


class Grid:
    """Пространственный индекс отрезков и многоугольников: быстрые «внутри дома?» и «на дороге?»."""

    def __init__(self, cell=25):
        self.cell, self.cells = cell, {}

    def _keys(self, x0, y0, x1, y1):
        c = self.cell
        for i in range(math.floor(x0 / c), math.floor(x1 / c) + 1):
            for j in range(math.floor(y0 / c), math.floor(y1 / c) + 1):
                yield i, j

    def add(self, bbox, item):
        for k in self._keys(*bbox):
            self.cells.setdefault(k, []).append(item)

    def near(self, p, r=0):
        seen = set()
        for k in self._keys(p[0] - r, p[1] - r, p[0] + r, p[1] + r):
            for it in self.cells.get(k, ()):
                if id(it) not in seen:
                    seen.add(id(it))
                    yield it


def bbox(pts, pad=0):
    return (min(p[0] for p in pts) - pad, min(p[1] for p in pts) - pad,
            max(p[0] for p in pts) + pad, max(p[1] for p in pts) + pad)


def stable_rng(*keys):
    return random.Random(hash_keys(SEED, *keys))


def hash_keys(*keys):
    h = 2166136261
    for k in keys:
        for ch in str(k).encode():
            h = ((h ^ ch) * 16777619) & 0xffffffff
    return h


# ---------- сборка ----------

def build(raw):
    plan = json.loads(PLAN.read_text())
    H, bb = plan["ceiling"], plan["bounds"]
    els = raw["elements"]
    own = next(e for e in els if e["type"] == "way" and e["id"] == OWN_WAY)
    own_en = [en(p) for p in own["geometry"]][:-1]

    # Угол дома, где стоит квартира: дальше всех в сторону окон и вправо (FACADE_HINT и +90°)
    h = math.radians(FACADE_HINT_DEG)
    out_u, right_u = (math.sin(h), math.cos(h)), (math.cos(h), -math.sin(h))
    k = max(range(len(own_en)), key=lambda i: own_en[i][0] * (out_u[0] + right_u[0]) + own_en[i][1] * (out_u[1] + right_u[1]))
    A = own_en[k]
    # Фасад — соседнее ребро, чья внешняя нормаль ближе всего к подсказке; азимут окон = её азимут
    best = None
    for j in (k - 1, k + 1):
        q = own_en[j % len(own_en)]
        dx, dy = q[0] - A[0], q[1] - A[1]
        for nx, ny in ((dy, -dx), (-dy, dx)):
            m = (A[0] + q[0]) / 2 + nx * 0.01, (A[1] + q[1]) / 2 + ny * 0.01
            if inside(m, own_en):
                continue
            b = bearing(nx, ny)
            if best is None or ang_diff(b, FACADE_HINT_DEG) < ang_diff(best, FACADE_HINT_DEG):
                best = b
    B = round(best, 1)
    sB, cB = math.sin(math.radians(B)), math.cos(math.radians(B))
    ax, az = bb[CORNER[0]], bb[CORNER[1]]

    def to_app(p):   # (восток, север) -> (X, Z) квартиры
        dx, dy = p[0] - A[0], p[1] - A[1]
        return (round(ax + dx * cB - dy * sB, 2), round(az - dx * sB - dy * cB, 2))

    def from_app(x, z):   # обратно в lat/lon
        X, Z = x - ax, z - az
        e, n = X * cB - Z * sB, -X * sB - Z * cB
        return (round(CENTER[0] + (n + A[1]) / KY, 7), round(CENTER[1] + (e + A[0]) / KX, 7))

    def r2(pts, nd=2):
        return [[round(x, nd), round(z, nd)] for x, z in pts]

    def app_angle(ux, uy):   # направление (восток, север) -> угол поворота вокруг +Y в осях квартиры, градусы
        X, Z = ux * cB - uy * sB, -ux * sB - uy * cB
        return round(math.degrees(math.atan2(X, Z)), 1)   # 0 = смотрит в +Z

    dist = lambda p: math.hypot(p[0] - A[0], p[1] - A[1])

    floor_y = round(GROUND_RISE + LEVEL * STOREY_H, 2)
    height = round(GROUND_RISE + LEVELS * STOREY_H + PARAPET, 2)
    foot = [to_app(p) for p in own_en]

    # Свой дом: под квартирой, на её этаже (без квартиры), над ней. Вырез — габарит квартиры,
    # продлённый наружу со сторон фасадов (CORNER), чтобы не осталось тонких полосок от неточности контура.
    g = 0.02
    cx0 = bb["x0"] - g if CORNER[0] != "x0" else -1e4
    cx1 = bb["x1"] + g if CORNER[0] != "x1" else 1e4
    cz0 = bb["z0"] - g if CORNER[1] != "z0" else -1e4
    cz1 = bb["z1"] + g if CORNER[1] != "z1" else 1e4
    pieces = [clip(foot, 1, 0, cx0), clip(foot, -1, 0, -cx1),
              clip(clip(clip(foot, -1, 0, -cx0), 1, 0, cx1), 0, 1, cz0),
              clip(clip(clip(foot, -1, 0, -cx0), 1, 0, cx1), 0, -1, -cz1)]
    own_mass = [{"part": "below", "y0": round(-floor_y, 2), "y1": -0.01, "poly": r2(foot)}]
    own_mass += [{"part": "storey", "y0": -0.01, "y1": round(H + 0.01, 2), "poly": r2(p)}
                 for p in pieces if len(p) >= 3 and abs(area(p)) > 1.5]
    own_mass.append({"part": "above", "y0": round(H + 0.01, 2), "y1": round(height - floor_y, 2), "poly": r2(foot)})
    bal = plan["balcony"]
    balconies = [{"x0": bal["x0"], "x1": bal["x1"], "z0": bal["z0"], "z1": bal["z1"],
                  "y0": round((lv - LEVEL) * STOREY_H - 0.22, 2), "y1": round((lv - LEVEL) * STOREY_H - 0.02, 2)}
                 for lv in OWN_BALCONY_LEVELS]

    skip = {OWN_WAY, OWN_SITE}
    near, far, roads, areas, seen = [], [], [], [], set()
    road_en, area_en, house_en, osm_trees, rows, fences_en, lamps_en = [], [], [], [], [], [], []
    for e in els:
        if e["id"] in skip or (e["type"], e["id"]) in seen:
            continue
        seen.add((e["type"], e["id"]))
        t = e.get("tags", {})
        if e["type"] == "node":
            p = en(e)
            if t.get("natural") == "tree":
                osm_trees.append((p, t, e["id"]))
            elif t.get("highway") == "street_lamp":
                lamps_en.append(p)
            continue
        if "building" in t:
            if t["building"] == "roof" or t.get("location") == "underground":
                continue
            rings = outer_rings(e) if e["type"] == "relation" else [[en(p) for p in e.get("geometry", [])]]
            hgt, lv = num(t.get("height")), num(t.get("building:levels"))
            kind = t["building"]
            for rg in rings:
                if not rg:
                    continue
                cx = sum(p[0] for p in rg) / len(rg); cy = sum(p[1] for p in rg) / len(rg)
                d = dist((cx, cy))
                is_far = d > R_NEAR
                if is_far and (cx - A[0]) * sB + (cy - A[1]) * cB < -50:   # далёкие — только перед окнами
                    continue
                poly = ring(rg, 1.0 if is_far else 0.15)
                if not poly or (is_far and abs(area(poly)) < 100):
                    continue
                if not is_far:
                    house_en.append(poly)
                n_lv = lv if lv is not None else DEFAULT_LEVELS.get(kind, 3)
                h_ = hgt or max(n_lv * 3.0, 6.0 if kind in HALLS else 3.0)
                rng = stable_rng("b", e["id"])
                style = STYLE_BY_KIND.get(kind) or (RESIDENTIAL_STYLES[rng.randrange(4)] if n_lv >= 2 else "plain")
                item = {"poly": r2([to_app(p) for p in poly], 1 if is_far else 2), "h": round(h_, 1),
                        "c": PALETTE[(e["id"] * 7 + len(rg)) % len(PALETTE)], "style": style}
                if kind in HALLS | SHEDS or (lv or 2) <= 1:
                    item["plain"] = True   # залы, гаражи, подстанции: фасад без рядов окон
                if not is_far:
                    item.update({"osm": e["id"], "kind": kind, "d": round(d)})
                    if lv is not None:
                        item["levels"] = lv
                    if t.get("name"):
                        item["name"] = t["name"]
                    roof = t.get("roof:shape") or ("gabled" if kind in HOUSES else "flat")
                    if roof != "flat":
                        item["roof"] = roof
                    if t.get("building:colour"):
                        item["colour"] = t["building:colour"]
                (far if is_far else near).append(item)
            continue
        geom = e.get("geometry") or []
        kind = AREA_OVERRIDE.get(e["id"]) or next((v for (kk, vv), v in AREA_KIND.items() if t.get(kk) == vv), None)
        if e["type"] == "relation":
            if kind:
                for rg in outer_rings(e):
                    poly = ring(rg, 0.3)
                    if poly:
                        area_en.append((kind, poly, e["id"]))
            continue
        if not geom:
            continue
        pts = [en(p) for p in geom]
        closed = len(pts) > 3 and pts[0] == pts[-1]
        hw = t.get("highway")
        if t.get("natural") == "tree_row":
            rows.append((pts, e["id"], t))
        elif t.get("barrier") in FENCE_H:
            fences_en.append((t["barrier"], num(t.get("height")) or FENCE_H[t["barrier"]], pts))
        elif hw and not (closed and t.get("area") == "yes"):
            if t.get("tunnel") in ("yes", "building_passage") or t.get("layer", "0").startswith("-"):
                continue
            if hw in ("footway", "cycleway", "path") and min(dist(p) for p in pts) > R_NEAR:
                continue
            w = num(t.get("width")) or ROAD_W[hw]
            line = simplify(pts, 0.3)
            nd = 2 if min(dist(p) for p in pts) < 100 else 1
            roads.append({"kind": hw, "w": w, "line": r2([to_app(p) for p in line], nd)})
            road_en.append((hw, w, line))
        elif kind and closed:
            if kind == "parking" and (t.get("parking") in ("underground", "multi-storey", "rooftop")):
                continue
            poly = ring(pts, 0.3)
            if poly:
                area_en.append((kind, poly, e["id"]))

    for kind, poly, _ in area_en:
        areas.append({"kind": kind, "poly": r2([to_app(p) for p in poly], 1)})
    areas.sort(key=lambda a_: AREA_ORDER.index(a_["kind"]))

    # ---------- индексы для правил ----------
    houses = Grid()
    for poly in house_en + [own_en]:
        houses.add(bbox(poly), poly)
    roadg = Grid()
    for r in road_en:
        roadg.add(bbox(r[2], r[1]), r)
    greens = Grid(50)
    for kind, poly, oid in area_en:
        if kind in ("grass", "garden", "meadow"):
            greens.add(bbox(poly), poly)
    own_site = next((e for e in els if e["id"] == OWN_SITE), None)
    own_site_poly = [en(p) for p in own_site["geometry"]] if own_site and own_site.get("geometry") else []

    def in_house(p, pad=0.0):
        for poly in houses.near(p, pad + 1):
            if inside(p, poly):
                return True
            if pad and any(seg_dist(p, a, b) < pad for a, b in zip(poly, poly[1:] + poly[:1])):
                return True
        return False

    def on_road(p, pad=0.0):
        for r in roadg.near(p, 20):
            if line_dist(p, r[2]) < r[1] / 2 + pad:
                return True
        return False

    def in_green(p):
        return any(inside(p, poly) for poly in greens.near(p))

    def free(p, house_pad=2.5, road_pad=1.2):
        return not in_house(p, house_pad) and not on_road(p, road_pad) and not (own_site_poly and inside(p, own_site_poly))

    # ---------- деревья ----------
    trees = []

    def add_tree(p, sp, src, rng, h=None):
        lo, hi = SP_H[sp]
        h = h or lo + (hi - lo) * rng.random()
        x, z = to_app(p)
        trees.append([x, z, round(h, 1), SPECIES.index(sp), src])

    for p, t, oid in osm_trees:
        if dist(p) > R_GREEN:
            continue
        rng = stable_rng("t", oid)
        sp = "pine" if t.get("leaf_type") == "needleleaved" else BROAD_SP[rng.randrange(3)]
        add_tree(p, sp, "osm", rng, num(t.get("height")))
    for pts, oid, t in rows:
        rng = stable_rng("row", oid)
        sp = "pine" if t.get("leaf_type") == "needleleaved" else STREET_SP[rng.randrange(len(STREET_SP))]
        for p, _ in resample(pts, 7):
            if dist(p) < R_GREEN and free(p, 1.5, 0.5):
                add_tree(p, sp, "row", rng)

    def scatter(poly, step, keep, rng):
        x0, y0, x1, y1 = bbox(poly)
        y = y0
        while y < y1:
            x = x0
            while x < x1:
                p = (x + step * (rng.random() - 0.5) * 0.9, y + step * (rng.random() - 0.5) * 0.9)
                if rng.random() < keep and inside(p, poly) and dist(p) < R_GREEN:
                    yield p
                x += step
            y += step

    for kind, poly, oid in area_en:
        if min(dist(p) for p in poly) > R_GREEN:
            continue
        rng = stable_rng("a", oid)
        if kind == "wood":
            for p in scatter(poly, 5.0, 0.9, rng):
                if free(p, 2, 1):
                    add_tree(p, WOOD_SP[rng.randrange(len(WOOD_SP))], "wood", rng)
        elif kind == "scrub":
            for p in scatter(poly, 3.5, 0.65, rng):
                if free(p, 1, 0.5):
                    add_tree(p, "shrub", "scrub", rng)
        elif kind in ("grass", "garden") and min(dist(p) for p in poly) < R_DETAIL:
            for p in scatter(poly, 24.0 if kind == "grass" else 14.0, 0.45, rng):
                if dist(p) < R_DETAIL and free(p, 4, 2.5):
                    add_tree(p, LAWN_SP[rng.randrange(len(LAWN_SP))], "lawn", rng)
                    if rng.random() < 0.5:   # кусты рядом с деревом
                        q = (p[0] + rng.uniform(-4, 4), p[1] + rng.uniform(-4, 4))
                        if free(q, 2, 1.5):
                            add_tree(q, "shrub", "lawn", rng)

    # Аллеи: газон вдоль проезжей дороги -> дерево каждые 11 м (если место свободно)
    for i, (hw, w, line) in enumerate(road_en):
        if hw not in CARRIAGE or min(dist(p) for p in line) > R_DETAIL:
            continue
        rng = stable_rng("street", i, hw)
        sp = STREET_SP[rng.randrange(len(STREET_SP))]
        for side in (1, -1):
            for p, _ in resample(offset_line(line, side * (w / 2 + 2.6)), 11):
                if dist(p) < R_DETAIL and in_green(p) and free(p, 3, 1.5):
                    add_tree(p, sp, "street", rng, 6 + 6 * rng.random())

    # слишком близкие друг к другу (лес у дороги и аллея) — прорежаем
    trees.sort(key=lambda t_: (t_[4] != "osm", t_[0], t_[1]))
    kept, tg = [], Grid(10)
    for t_ in trees:
        p = (t_[0], t_[1])
        r = 1.2 if t_[3] == SPECIES.index("shrub") else 3.0
        if any(math.hypot(p[0] - q[0], p[1] - q[1]) < r for q in tg.near(p, 4)):
            continue
        tg.add((p[0], p[1], p[0], p[1]), p)
        kept.append(t_)
    trees = kept

    # ---------- бордюры: края проезжих дорог, без перекрёстков и съездов ----------
    kerbs = []
    for hw, w, line in road_en:
        if hw not in CARRIAGE or min(dist(p) for p in line) > R_DETAIL + 50:
            continue
        for side in (1, -1):
            run = []
            for p, _ in resample(offset_line(line, side * w / 2), 1.0):
                # точка бордюра лежит на краю своей дороги: «на дороге» считаем только чужие
                ok = dist(p) < R_DETAIL + 50 and not any(
                    r[2] is not line and line_dist(p, r[2]) < r[1] / 2 + 0.4 for r in roadg.near(p, 20)) \
                    and not in_house(p)
                if ok:
                    run.append(p)
                elif run:
                    if len(run) >= 3:
                        kerbs.append(run)
                    run = []
            if len(run) >= 3:
                kerbs.append(run)
    kerbs = [r2([to_app(p) for p in simplify(k_, 0.1)]) for k_ in kerbs]

    # ---------- фонари: из OSM + вдоль проезжих дорог, где в OSM пусто ----------
    def road_dir(p):
        best_ = None
        for hw, w, line in road_en:
            if hw not in CARRIAGE and hw != "service":
                continue
            for a, b in zip(line, line[1:]):
                d_ = seg_dist(p, a, b)
                if best_ is None or d_ < best_[0]:
                    best_ = (d_, a, b)
        return best_

    lamps = []
    for p in lamps_en:
        if dist(p) > R_GREEN:
            continue
        rd = road_dir(p)
        ang = 0
        if rd:   # кронштейн к дороге
            _, a, b = rd
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy) or 1
            nx, ny = -dy / L, dx / L
            if (p[0] - a[0]) * nx + (p[1] - a[1]) * ny > 0:
                nx, ny = -nx, -ny
            ang = app_angle(nx, ny)
        x, z = to_app(p)
        lamps.append([x, z, ang, "osm"])
    have = list(lamps_en)
    for i, (hw, w, line) in enumerate(road_en):
        if hw not in CARRIAGE or min(dist(p) for p in line) > R_DETAIL:
            continue
        sides = (1, -1) if hw.startswith(("primary", "secondary", "trunk")) else (1,)
        for side in sides:
            for p, (ux, uy) in resample(offset_line(line, side * (w / 2 + 0.9)), 32):
                if dist(p) > R_DETAIL or any(math.hypot(p[0] - q[0], p[1] - q[1]) < 22 for q in have):
                    continue
                if not free(p, 1.0, 0.3):
                    continue
                nx, ny = -uy * side, ux * side   # от фонаря к оси дороги
                have.append(p)
                x, z = to_app(p)
                lamps.append([x, z, app_angle(-nx, -ny), "rule"])

    # ---------- заборы ----------
    fences = []
    for kind, hh, pts in fences_en:
        if min(dist(p) for p in pts) > R_GREEN:
            continue
        fences.append({"kind": kind, "h": round(hh, 2), "line": r2([to_app(p) for p in simplify(pts, 0.2)])})

    # ---------- машины на открытых парковках ----------
    cars = []
    for kind, poly, oid in area_en:
        if kind != "parking" or min(dist(p) for p in poly) > R_DETAIL:
            continue
        rng = stable_rng("park", oid)
        # ось парковки — самое длинное ребро
        ea, eb = max(zip(poly, poly[1:] + poly[:1]), key=lambda s: math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]))
        L = math.hypot(eb[0] - ea[0], eb[1] - ea[1]) or 1
        ux, uy = (eb[0] - ea[0]) / L, (eb[1] - ea[1]) / L
        vx, vy = -uy, ux
        if not inside(((ea[0] + eb[0]) / 2 + vx, (ea[1] + eb[1]) / 2 + vy), poly):   # v — внутрь парковки
            vx, vy = -vx, -vy
        loc = [((p[0] - ea[0]) * ux + (p[1] - ea[1]) * uy, (p[0] - ea[0]) * vx + (p[1] - ea[1]) * vy) for p in poly]
        u0, u1 = min(q[0] for q in loc), max(q[0] for q in loc)
        v0, v1 = min(q[1] for q in loc), max(q[1] for q in loc)
        # ряды: место 5 м, место 5 м, проезд 6 м (ёлочкой не ставим)
        v, row = v0 + 2.5, 0
        while v + 2.5 <= v1:
            facing = 1 if row % 2 == 0 else -1
            u = u0 + 1.25
            while u + 1.25 <= u1:
                corners = [(u + du, v + dv) for du in (-1.25, 1.25) for dv in (-2.5, 2.5)]
                pts_ = [(ea[0] + cu * ux + cv * vx, ea[1] + cu * uy + cv * vy) for cu, cv in corners]
                c = (ea[0] + u * ux + v * vx, ea[1] + u * uy + v * vy)
                if all(inside(q, poly) for q in pts_) and not in_house(c, 1.0) and dist(c) < R_DETAIL + 30:
                    if rng.random() < 0.65:
                        m = rng.choices(range(len(CAR_MODELS)), CAR_WEIGHTS)[0]
                        col = rng.choices(range(len(CAR_COLOURS)), CAR_COLOUR_W)[0]
                        x, z = to_app(c)
                        ang = app_angle(vx * facing, vy * facing) + rng.uniform(-3, 3)
                        cars.append([x, z, round(ang, 1), m, col])
                u += 2.5
            v += 5 if row % 2 == 0 else 11
            row += 1

    lat, lon = from_app((bb["x0"] + bb["x1"]) / 2, (bb["z0"] + bb["z1"]) / 2)
    return {
        "_generated_by": "tools/fetch_site.py — не править руками, править скрипт и перезапустить",
        "_about": "Окружение квартиры AA0304. Координаты квартиры (как plan.generated.json): X вдоль окон "
                  "вправо (если смотреть наружу), Z от окон вглубь, метры; пол квартиры y=0, земля y=-floorY. "
                  "Высоты h, y0, y1: h — от земли, y0/y1 — от пола квартиры. Дома: c — цвет силуэта (sRGB), "
                  "style — фасад (site.js), plain — без рядов окон, roof — форма крыши, если не плоская, d — "
                  "расстояние от квартиры. trees: [x, z, высота, вид (индекс в treeSpecies), источник: osm | row | "
                  "wood | scrub | lawn | street]. lamps: [x, z, угол кронштейна (0 = +Z), osm | rule]. "
                  "cars: [x, z, угол (0 = перед в +Z), модель (carModels), цвет (carColours)]. kerbs — ломаные "
                  "бордюров. Всё с источником rule/lawn/street/wood/scrub достроено правилами, а не взято из OSM.",
        "source": {
            "osm": "© OpenStreetMap contributors, ODbL 1.0 (Overpass API)",
            "fetched": datetime.date.today().isoformat(),
            "ownWay": OWN_WAY,
            "address": "Warszawa, Włochy (Raków), ul. Wschodu Słońca 6 — Avenir, Bouygues Immobilier; budynek A, klatka A, piętro 03",
            "facade": "source/plan-AA0304.pdf, ключ-план (север вверх): балкон на южном фасаде западного крыла; "
                      "азимут уточнён по контуру OSM",
            "heights": "7 надземных этажей (rynekpierwotny.pl); этаж 3.1 м и подъём партера 0.5 м — оценка",
            "rules": f"seed {SEED}; детали в радиусе {R_DETAIL} м, зелень OSM в радиусе {R_GREEN} м",
        },
        "city": "Варшава", "lat": lat, "lon": lon, "timezone": "Europe/Warsaw",
        "windowBearingDeg": B, "keyPlanBearingDeg": FACADE_HINT_DEG,
        "floorY": floor_y, "level": LEVEL, "levels": LEVELS, "storeyH": STOREY_H, "groundRise": GROUND_RISE,
        "detailRadius": R_DETAIL,
        "anchor": {"plan": [ax, az], "latlon": list(from_app(ax, az)),
                   "note": "юго-западный угол дома в OSM = наружный угол квартиры (+X, −Z)"},
        "own": {"footprint": r2(foot), "levels": LEVELS, "h": height},
        "ownMass": own_mass,
        "ownBalconies": balconies,
        "neighbours": near,
        "far": far,
        "roads": roads,
        "areas": areas,
        "treeSpecies": SPECIES,
        "trees": trees,
        "lamps": lamps,
        "kerbs": kerbs,
        "fences": fences,
        "carModels": CAR_MODELS,
        "carColours": CAR_COLOURS,
        "cars": cars,
    }


# ---------- ассеты окружения (--assets) ----------

# CC0 ambientCG, 1K JPG: (id, имя в web/textures/site, сторона, насыщенность 0..1)
TEXTURES = [("Grass004", "grass", 1024, 1.0), ("Ground037", "meadow", 1024, 1.0), ("Ground106", "soil", 1024, 1.0),
            ("Asphalt031", "asphalt", 1024, 1.0), ("PavingStones146", "paving", 1024, 0.25), ("Bark014", "bark", 512, 0.8)]
KENNEY_CARKIT = "https://kenney.nl/assets/car-kit"
KENNEY_ID = "6173736574732f6361722d6b6974"   # data-download-id на странице набора
# Kenney car kit -> реальные габариты (длина, ширина, высота, м): Škoda Octavia, VW Golf, Toyota RAV4, VW Transporter
CAR_SRC = {"sedan": ("sedan.glb", 4.69, 1.83, 1.47), "hatchback": ("hatchback-sports.glb", 4.28, 1.79, 1.46),
           "suv": ("suv.glb", 4.60, 1.86, 1.69), "van": ("van.glb", 4.90, 1.90, 1.97)}

BLENDER_CARS = r'''
import bpy, json, sys
from mathutils import Vector
jobs = json.loads(sys.argv[sys.argv.index("--") + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
img = bpy.data.images.load(jobs["colormap"])
W, H = img.size; px = list(img.pixels)
def sample(u, v):
    x = min(W - 1, max(0, int(u % 1 * W))); y = min(H - 1, max(0, int(v % 1 * H)))
    i = (y * W + x) * 4
    return px[i:i + 4]
for name, (src, L, Wd, Ht) in jobs["cars"].items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=src)
    objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    for o in objs:
        me = o.data
        uv = me.uv_layers.active.data
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        for li in range(len(me.loops)):
            ca.data[li].color = sample(*uv[li].uv)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    car = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in [o for o in bpy.data.objects if o not in before and o is not car]: bpy.data.objects.remove(o)
    car.name = name; car.data.name = name
    me = car.data
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    # Blender: Z вверх, длина машины вдоль Y (перед +Y у Kenney -> +Z в three после экспорта)
    sx, sy, sz = Wd / (max(xs) - min(xs)), L / (max(ys) - min(ys)), Ht / (max(zs) - min(zs))
    cx, cy, z0 = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
    for v in me.vertices:
        v.co = Vector(((v.co.x - cx) * sx, (v.co.y - cy) * sy, (v.co.z - z0) * sz))
    me.materials.clear()
    mat = bpy.data.materials.get("car") or bpy.data.materials.new("car")
    me.materials.append(mat)
bpy.ops.export_scene.gltf(filepath=jobs["out"], export_format="GLB", export_texcoords=False, export_normals=True,
                          export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_materials="PLACEHOLDER",
                          export_yup=True, export_apply=True)
'''


def fetch_textures(tmp):
    from PIL import Image, ImageEnhance
    TEX_OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for aid, name, size, sat in TEXTURES:
        url = f"https://ambientcg.com/get?file={aid}_1K-JPG.zip"
        data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            col = next(n for n in z.namelist() if n.endswith("_Color.jpg"))
            im = Image.open(io.BytesIO(z.read(col))).convert("RGB")
        if sat != 1.0:
            im = ImageEnhance.Color(im).enhance(sat)
        im.resize((size, size), Image.LANCZOS).save(TEX_OUT / f"{name}.jpg", quality=85, optimize=True)
        rows.append(f"| `{name}.jpg` | [{aid}](https://ambientcg.com/view?id={aid}) | {size} px"
                    f"{'' if sat == 1 else f', насыщенность ×{sat}'} |")
    return rows


def fetch_cars(tmp):
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    op.addheaders = [("User-Agent", "Mozilla/5.0"), ("Referer", KENNEY_CARKIT)]
    op.open(KENNEY_CARKIT, timeout=60).read()
    link = json.loads(op.open(f"https://kenney.nl/download-link/{KENNEY_ID}", timeout=60).read())["url"]
    with zipfile.ZipFile(io.BytesIO(op.open(link, timeout=120).read())) as z:
        z.extractall(tmp / "carkit")
    glb = tmp / "carkit" / "Models" / "GLB format"
    jobs = {"colormap": str(glb / "Textures" / "colormap.png"), "out": str(tmp / "cars_raw.glb"),
            "cars": {k: [str(glb / v[0]), *v[1:]] for k, v in CAR_SRC.items()}}
    script = tmp / "cars.py"
    script.write_text(BLENDER_CARS)
    subprocess.run(["blender", "-b", "--factory-startup", "--python", str(script), "--", json.dumps(jobs)],
                   check=True, stdout=subprocess.DEVNULL)
    MODEL_OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(["npx", "-y", "@gltf-transform/cli@4", "meshopt", str(tmp / "cars_raw.glb"),
                    str(MODEL_OUT / "cars.glb")], check=True, stdout=subprocess.DEVNULL)


def assets():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="site-assets-"))
    try:
        rows = fetch_textures(tmp)
        (TEX_OUT / "SOURCE.md").write_text(
            "# Текстуры окружения (земля, дороги, кора)\n\n"
            "Пишет `tools/fetch_site.py --assets`. Источник — ambientCG, лицензия CC0 1.0, скачано "
            f"{datetime.date.today().isoformat()}. Оставлена только карта цвета (Color), JPEG q85.\n"
            "Масштаб в site.js (`TEX_M`): трава и луг — 3 м на повтор, почва 4 м, асфальт 4 м, плитка 2 м, кора 1.5 м.\n"
            "Тротуарная плитка обесцвечена до серой «kostka brukowa».\n\n"
            "| файл | источник | размер |\n|---|---|---|\n" + "\n".join(rows) + "\n\n"
            "Листва, ветки, фасады и решётки балконов рисуются кодом в site.js (canvas), файлов у них нет.\n")
        fetch_cars(tmp)
        (MODEL_OUT / "SOURCE.md").write_text(
            "# Машины на парковках\n\n"
            "`cars.glb` пишет `tools/fetch_site.py --assets`: Kenney «Car Kit» 3.1 "
            f"({KENNEY_CARKIT}), автор Kenney, лицензия CC0 1.0, скачано {datetime.date.today().isoformat()}.\n"
            "Модели sedan, hatchback-sports, suv, van: части склеены в один меш, цвет палитры запечён в цвет вершин, "
            "материалы убраны (site.js задаёт один материал и перекрашивает кузов).\n"
            "Масштаб: габариты растянуты до реальных (длина × ширина × высота, м): sedan 4.69 × 1.83 × 1.47 "
            "(Škoda Octavia), hatchback 4.28 × 1.79 × 1.46 (VW Golf), suv 4.60 × 1.86 × 1.69 (Toyota RAV4), "
            "van 4.90 × 1.90 × 1.97 (VW Transporter).\n"
            "Контракт: метры, пол Y = 0, центр следа в 0, перед смотрит в +Z. Сжатие meshopt "
            "(`npx -y @gltf-transform/cli@4 meshopt`).\n")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("ассеты окружения:", ", ".join(p.name for p in sorted(TEX_OUT.iterdir())), "+ models/site/cars.glb")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", help="сохранить сырой ответ Overpass в этот файл (вне репозитория)")
    ap.add_argument("--from", dest="src", help="взять сырой ответ из файла вместо сети")
    ap.add_argument("--assets", action="store_true", help="скачать текстуры и машины окружения")
    a = ap.parse_args()
    if a.assets:
        assets()
        return
    raw = json.loads(pathlib.Path(a.src).read_text()) if a.src else query()
    if a.raw:
        pathlib.Path(a.raw).write_text(json.dumps(raw))
    site = build(raw)
    OUT.write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")))
    print(f"site.json: окна {site['windowBearingDeg']}°, пол {site['floorY']} м, "
          f"соседей {len(site['neighbours'])}, дальних {len(site['far'])}, дорог {len(site['roads'])}, "
          f"площадок {len(site['areas'])}, деревьев {len(site['trees'])}, фонарей {len(site['lamps'])}, "
          f"машин {len(site['cars'])}, бордюров {len(site['kerbs'])}, заборов {len(site['fences'])}, "
          f"{OUT.stat().st_size / 1e3:.0f} КБ")


if __name__ == "__main__":
    main()
