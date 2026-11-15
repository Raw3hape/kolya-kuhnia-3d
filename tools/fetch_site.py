"""Окружение дома из OpenStreetMap -> web/spec/site.json (координаты квартиры, метры).

Запуск из корня проекта:
    python3 tools/fetch_site.py                 # Overpass API, сырой ответ остаётся в памяти
    python3 tools/fetch_site.py --raw /tmp/x.json   # сохранить сырой ответ (не в репозиторий)
    python3 tools/fetch_site.py --from /tmp/x.json  # пересобрать без сети

Что известно и откуда (проверено 2026-11-15):
  • Дом — Avenir (Bouygues Immobilier), ul. Wschodu Słońca 6, Raków, Włochy, Warszawa.
    Корпус A, лестница A, piętro 03 (четвёртый уровень, считая партер). 7 надземных этажей + паркинг.
    В OSM: way 1491911406 (building=construction) внутри landuse=construction «Avenir» (way 451815457).
  • Ключ-план в source/plan-AA0304.pdf (север вверх): квартира — южный торец западного крыла,
    балкон на южном фасаде, западная стена тоже наружная (там дверь комнаты 2). Улица — на северо-востоке.
    План квартиры в PDF повёрнут на 180° к ключ-плану (его роза ветров смотрит вниз).
  • К югу — поле (landuse=farmland), на горизонте гостиницы у ul. Krakowska (~1.7 км, азимут 120–145°):
    это и видно на source/refs/photo-from-right.webp.

Оси квартиры: X вдоль оконной стены (вправо, если смотреть наружу), Z от окон вглубь, Y вверх.
Окна смотрят в −Z, его компасный азимут — windowBearingDeg. Пол квартиры y=0, земля y=−floorY.
"""
import argparse
import datetime
import json
import math
import pathlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLAN = ROOT / "web" / "spec" / "plan.generated.json"
OUT = ROOT / "web" / "spec" / "site.json"
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = {"User-Agent": "apartment-visualizer/1.0"}

CENTER = (52.20028, 20.93945)   # центр запроса: дом Avenir
OWN_WAY = 1491911406            # контур своего дома в OSM
FACADE_HINT_DEG = 180           # ключ-план: балкон на южном фасаде; точный азимут берётся из контура OSM
CORNER = ("x1", "z0")           # угол квартиры, совпадающий с углом дома: +X (запад) и −Z (юг) наружные
R_NEAR, R_ROAD, R_FAR = 400, 600, 2000   # м: все дома / дороги и площадки / только высокие дома перед окнами

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
AREA_KIND = {("landuse", "farmland"): "field", ("landuse", "grass"): "grass", ("landuse", "meadow"): "grass",
             ("landuse", "greenfield"): "grass", ("landuse", "village_green"): "grass",
             ("leisure", "park"): "grass", ("leisure", "pitch"): "grass", ("leisure", "playground"): "grass",
             ("landuse", "construction"): "dirt", ("landuse", "brownfield"): "dirt",
             ("amenity", "parking"): "paved", ("highway", "pedestrian"): "paved"}
DEFAULT_LEVELS = {"retail": 1, "supermarket": 1, "service": 1, "garage": 1, "garages": 1, "shed": 1,
                  "outbuilding": 1, "kiosk": 1, "house": 2, "detached": 2, "semidetached_house": 2,
                  "construction": 4}
HALLS = {"retail", "supermarket", "commercial", "industrial", "warehouse"}   # одноэтажные залы ~6 м
# Цвета соседей (sRGB): приглушённые штукатурка, бетон, кирпич; дальние тонут в дымке (как в ноябре)
PALETTE = ["b7b2a9", "a8a49e", "c2baac", "9ea2a5", "b5aa98", "8e9399", "c8c3ba", "a39686"]
HAZE, HAZE_M = "b4bec8", 2500   # цвет дымки и расстояние, на котором она берёт 1 − 1/e


def tint(key, dist):
    base = PALETTE[key % len(PALETTE)]
    f = 1 - math.exp(-dist / HAZE_M)
    mix = [round(int(base[i:i + 2], 16) * (1 - f) + int(HAZE[i:i + 2], 16) * f) for i in (0, 2, 4)]
    return "".join(f"{v:02x}" for v in mix)


def query():
    lat, lon = CENTER
    a = lambda r: f"(around:{r},{lat},{lon})"
    q = f"""[out:json][timeout:120];
(
  way{a(R_NEAR)}[building];
  relation{a(R_NEAR)}[building];
  way{a(R_FAR)}[building]["building:levels"~"^([5-9]|[1-9][0-9])"];
  way{a(R_FAR)}[building][height];
  way{a(R_ROAD)}[highway~"^({'|'.join(ROAD_W)})$"];
  way{a(R_ROAD)}[amenity=parking];
  way{a(R_NEAR)}[landuse~"^(farmland|grass|meadow|greenfield|village_green|construction|brownfield)$"];
  way{a(R_NEAR)}[leisure~"^(park|pitch|playground)$"];
);
out geom tags;"""
    body = urllib.parse.urlencode({"data": q}).encode()
    with urllib.request.urlopen(urllib.request.Request(OVERPASS, body, UA), timeout=180) as r:
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

    skip = {OWN_WAY, 451815457}
    near, far, roads, areas, seen = [], [], [], [], set()
    for e in els:
        if e["id"] in skip or (e["type"], e["id"]) in seen:
            continue
        seen.add((e["type"], e["id"]))
        t = e.get("tags", {})
        if "building" in t:
            if t["building"] == "roof" or t.get("location") == "underground":
                continue
            rings = outer_rings(e) if e["type"] == "relation" else [[en(p) for p in e.get("geometry", [])]]
            hgt, lv = num(t.get("height")), num(t.get("building:levels"))
            for rg in rings:
                if not rg:
                    continue
                cx = sum(p[0] for p in rg) / len(rg); cy = sum(p[1] for p in rg) / len(rg)
                dist = math.hypot(cx - A[0], cy - A[1])
                is_far = dist > R_NEAR
                if is_far and (cx - A[0]) * sB + (cy - A[1]) * cB < -50:   # далёкие — только перед окнами
                    continue
                poly = ring(rg, 1.0 if is_far else 0.15)
                if not poly or (is_far and abs(area(poly)) < 100):
                    continue
                n_lv = lv if lv is not None else DEFAULT_LEVELS.get(t["building"], 3)
                h_ = hgt or max(n_lv * 3.0, 6.0 if t["building"] in HALLS else 3.0)
                item = {"poly": r2([to_app(p) for p in poly], 1 if is_far else 2), "h": round(h_, 1),
                        "c": tint(e["id"] * 7 + len(rg), dist)}
                if t["building"] in HALLS | {"garage", "garages", "shed", "service", "outbuilding", "kiosk"} or (lv or 2) <= 1:
                    item["plain"] = True   # залы, гаражи, подстанции: фасад без рядов окон
                if not is_far:
                    item.update({"osm": e["id"], "kind": t["building"]})
                    if lv is not None:
                        item["levels"] = lv
                    if t.get("name"):
                        item["name"] = t["name"]
                (far if is_far else near).append(item)
            continue
        geom = e.get("geometry") or []
        if not geom:
            continue
        pts = [en(p) for p in geom]
        closed = len(pts) > 3 and pts[0] == pts[-1]
        kind = next((v for (kk, vv), v in AREA_KIND.items() if t.get(kk) == vv), None)
        hw = t.get("highway")
        if hw and not (closed and t.get("area") == "yes"):
            if t.get("tunnel") in ("yes", "building_passage") or t.get("layer", "0").startswith("-"):
                continue
            if hw in ("footway", "cycleway", "path") and min(math.hypot(p[0] - A[0], p[1] - A[1]) for p in pts) > R_NEAR:
                continue
            w = num(t.get("width")) or ROAD_W[hw]
            line = simplify(pts, 0.3)
            nd = 2 if min(math.hypot(p[0] - A[0], p[1] - A[1]) for p in pts) < 100 else 1
            roads.append({"kind": hw, "w": w, "line": r2([to_app(p) for p in line], nd)})
        elif kind and closed:
            poly = ring(pts, 0.3)
            if poly:
                areas.append({"kind": kind, "poly": r2([to_app(p) for p in poly], 1)})

    order = {"field": 0, "grass": 1, "dirt": 2, "paved": 3}
    areas.sort(key=lambda a_: order[a_["kind"]])
    lat, lon = from_app((bb["x0"] + bb["x1"]) / 2, (bb["z0"] + bb["z1"]) / 2)
    return {
        "_generated_by": "tools/fetch_site.py — не править руками, править скрипт и перезапустить",
        "_about": "Окружение квартиры AA0304. Координаты квартиры (как plan.generated.json): X вдоль окон "
                  "вправо (если смотреть наружу), Z от окон вглубь, метры; пол квартиры y=0, земля y=-floorY. "
                  "Высоты h, y0, y1: h — от земли, y0/y1 — от пола квартиры. c — цвет фасада (sRGB, с дымкой по расстоянию), plain — без рядов окон.",
        "source": {
            "osm": "© OpenStreetMap contributors, ODbL 1.0 (Overpass API)",
            "fetched": datetime.date.today().isoformat(),
            "ownWay": OWN_WAY,
            "address": "Warszawa, Włochy (Raków), ul. Wschodu Słońca 6 — Avenir, Bouygues Immobilier; budynek A, klatka A, piętro 03",
            "facade": "source/plan-AA0304.pdf, ключ-план (север вверх): балкон на южном фасаде западного крыла; "
                      "азимут уточнён по контуру OSM",
            "heights": "7 надземных этажей (rynekpierwotny.pl); этаж 3.1 м и подъём партера 0.5 м — оценка",
        },
        "city": "Варшава", "lat": lat, "lon": lon, "timezone": "Europe/Warsaw",
        "windowBearingDeg": B, "keyPlanBearingDeg": FACADE_HINT_DEG,
        "floorY": floor_y, "level": LEVEL, "levels": LEVELS, "storeyH": STOREY_H, "groundRise": GROUND_RISE,
        "anchor": {"plan": [ax, az], "latlon": list(from_app(ax, az)),
                   "note": "юго-западный угол дома в OSM = наружный угол квартиры (+X, −Z)"},
        "own": {"footprint": r2(foot), "levels": LEVELS, "h": height},
        "ownMass": own_mass,
        "ownBalconies": balconies,
        "neighbours": near,
        "far": far,
        "roads": roads,
        "areas": areas,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", help="сохранить сырой ответ Overpass в этот файл (вне репозитория)")
    ap.add_argument("--from", dest="src", help="взять сырой ответ из файла вместо сети")
    a = ap.parse_args()
    raw = json.loads(pathlib.Path(a.src).read_text()) if a.src else query()
    if a.raw:
        pathlib.Path(a.raw).write_text(json.dumps(raw))
    site = build(raw)
    OUT.write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")))
    print(f"site.json: окна {site['windowBearingDeg']}°, пол {site['floorY']} м, "
          f"соседей {len(site['neighbours'])}, дальних {len(site['far'])}, дорог {len(site['roads'])}, "
          f"площадок {len(site['areas'])}, {OUT.stat().st_size / 1e3:.0f} КБ")


if __name__ == "__main__":
    main()
