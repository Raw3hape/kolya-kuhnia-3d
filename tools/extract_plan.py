"""Векторный план из PDF -> web/spec/plan.generated.json (метры).

Запуск из корня проекта:
    uv run --with pymupdf tools/extract_plan.py

Стены в PDF нарисованы залитыми прямоугольниками:
  тёмно-серые (0.47) — несущие и наружные стены, плюс тонкие слои штукатурки;
  светло-серые (0.86) — перегородки.
Проёмы окон и дверей в наружных стенах закрыты белыми заливками поверх стен,
поэтому они заданы ниже вручную по замерам растра (см. OPENINGS) и номиналам с плана.
Межкомнатные двери в PDF не вырезаны из перегородок: они заданы в метрах (INTERIOR_DOORS)
по замеру растра (±1 см), толщина проёма берётся из самой перегородки.

Стены в PDF лежат слоями (наружный слой, кладка, штукатурка) и с дублями контура, а у балконных
дверей кладка обрывается шире самого проёма. Поэтому прямоугольники из PDF не идут в модель как есть:
solidify() склеивает их в непересекающиеся коробки на всю толщину стены, заделывает слой над проёмом
и замкнутые пустоты (шахты). Объединение остаётся тем же, что нарисовано в PDF.

Система координат (общая для всего проекта):
  начало — внутренний угол кухни-гостиной: стена с мойкой (X=0) × оконная стена (Z=0);
  X вправо вдоль оконной стены, Z от окон вглубь квартиры, Y вверх. Единицы — метры.
"""
import json
import pathlib

import pymupdf

ROOT = pathlib.Path(__file__).resolve().parent.parent
PDF = ROOT / "source" / "plan-AA0304.pdf"
OUT = ROOT / "web" / "spec" / "plan.generated.json"

PT_PER_CM = 0.51490          # из размера 557 см на плане (286.8 pt)
ORIGIN_PT = (401.73, 231.12)  # внутренний угол кухни, в повёрнутых координатах страницы
CEILING = 2.64                # «Wysokość pom. ok. 2,64 m»


def to_m(x_pt, y_pt):
    return (round((x_pt - ORIGIN_PT[0]) / PT_PER_CM / 100, 4),
            round((y_pt - ORIGIN_PT[1]) / PT_PER_CM / 100, 4))


# Проёмы: центр/границы в pt по замеру растра, ширина и высота — номиналы с плана.
# along: 'x' — проём в стене, идущей вдоль X; 'z' — вдоль Z.
OPENINGS = [
    {"id": "room3_balcony_door", "room": "Комната 3", "type": "door", "along": "x",
     "center_pt": 345.88, "wall_pt": (211.8, 231.12), "width": 1.20, "sill": 0.0, "head": 2.21},
    {"id": "kitchen_window", "room": "Кухня", "type": "window", "along": "x",
     "center_pt": 467.92, "wall_pt": (211.8, 231.12), "width": 1.20, "sill": 0.90, "head": 2.21},
    {"id": "kitchen_balcony_door", "room": "Кухня", "type": "door", "along": "x",
     "center_pt": 623.44, "wall_pt": (211.8, 231.12), "width": 2.50, "sill": 0.0, "head": 2.21,
     "fixed_left": 1.55},
    {"id": "room2_balcony_door", "room": "Комната 2", "type": "door", "along": "z",
     "center_pt": 464.75, "wall_pt": (719.49, 738.81), "width": 1.50, "sill": 0.0, "head": 2.21,
     "fixed_left": 0.50},   # по PDF: глухая часть 0.5 м у меньшего z, створка 1.0 м
    # wall_pt от внутренней штукатурки холла (z 6.4463), иначе в проёме остаётся её полоска
    {"id": "entry_door", "room": "Холл", "type": "entry", "along": "x",
     "center_pt": 296.8, "wall_pt": (562.9, 573.12), "width": 0.97, "sill": 0.0, "head": 2.05},
]

# Межкомнатные двери: span — границы проёма вдоль стены (м), wall_at — точка внутри толщины перегородки.
# hinge: 'start'|'end' — у какого конца проёма петли (start = меньшая координата);
# swing: +1/-1 — в какую сторону от стены открывается полотно (по +z или +x).
INTERIOR = {"type": "interior", "width": 0.90, "leaf": 0.80, "sill": 0.0, "head": 2.05}
INTERIOR_DOORS = [
    {"id": "room3_door", "room": "Комната 3", "room_id": "room3", "along": "x",
     "span": (-2.47, -1.57), "wall_at": 3.70, "hinge": "start", "swing": -1},
    {"id": "room2_door", "room": "Комната 2", "room_id": "room2", "along": "z",
     "span": (3.915, 4.815), "wall_at": 2.04, "hinge": "start", "swing": 1},
    {"id": "bath_door", "room": "Ванная", "room_id": "bath", "along": "x",
     "span": (0.21, 1.11), "wall_at": 5.03, "hinge": "end", "swing": -1},
]

# Комнаты прямоугольниками (м) для привязки полов и граней стен к зонам.
# Границы совпадают с гранями стен из PDF (сверяет check_rooms).
ROOMS = {
    "kitchen_living": {"name": "Кухня-гостиная", "area_m2": 22.21,
                       "x0": 0.0, "x1": 6.171, "z0": 0.0, "z1": 3.68,
                       "rects": [(0.0, 6.1713, 0.0, 2.7687), (0.6013, 6.1713, 2.7687, 3.6799)]},
    "hall": {"name": "Холл",
             "rects": [(-2.6265, 2.0019, 3.7382, 4.9804),       # от комнаты 3 до ванной
                       (-2.6265, -0.7598, 4.9804, 6.4463),      # у входа, левее ванной
                       (-0.8996, -0.7598, 6.4463, 6.4556),      # ниша у стояка
                       (0.6013, 2.0019, 3.6799, 3.7382)]},      # проход в кухню-гостиную
    "room2": {"name": "Комната 2", "rects": [(2.0835, 6.1713, 3.7592, 6.8775)]},
    "room3": {"name": "Комната 3", "rects": [(-2.6265, -0.1002, 0.0, 3.659)]},
    "bath": {"name": "Ванная", "rects": [(-0.6595, 1.9833, 5.0806, 6.4556),
                                         (-0.3146, 1.9833, 6.4556, 6.8775)]},
    "shaft": {"name": "Вентшахта (ko/kw)", "x0": 0.0, "x1": 0.601, "z0": 2.769, "z1": 3.738,
              "rects": [(0.0, 0.6013, 2.7687, 3.7382)]},
}

# Обрезки рисунка за пределами квартиры (порог входной двери, линии рамы).
def is_noise(b):
    x0, y0, x1, y1 = b
    return y0 >= 573.0 and x1 <= 346.1


DUP_TOL = 0.006   # дубль контура: прямоугольник того же вида внутри другого с точностью до 6 мм
BAND = 0.03       # насколько слой над наружным проёмом заходит за его края (кладка в PDF обрывается шире)
PRIORITY = {"structural": 3, "partition": 2, "plaster": 1, "shaft": 0}


def drop_duplicates(walls):
    """Убирает дубли контура (в PDF наружный слой нарисован дважды со сдвигом 5–9 мм)."""
    area = lambda w: (w["x1"] - w["x0"]) * (w["z1"] - w["z0"])
    def inside(w, v):
        return (v["kind"] == w["kind"] and v["x0"] - DUP_TOL <= w["x0"] and w["x1"] <= v["x1"] + DUP_TOL
                and v["z0"] - DUP_TOL <= w["z0"] and w["z1"] <= v["z1"] + DUP_TOL)
    out = []
    for i, w in enumerate(walls):
        if not any(j != i and inside(w, v) and (area(v) > area(w) or (area(v) == area(w) and j < i))
                   for j, v in enumerate(walls)):
            out.append(w)
    return out


def opening_bands(walls, openings):
    """Полоса на всю толщину стены у каждого наружного проёма: над ним выходит перемычка без канавки,
    по бокам нет щелей между рамой и обрывом кладки. Проём потом вырезает model.js."""
    out = []
    for o in openings:
        if o["type"] == "interior":
            continue
        al = o["along"]; th = "z" if al == "x" else "x"
        hit = [w for w in walls if w["x0"] < o["x1"] and w["x1"] > o["x0"] and w["z0"] < o["z1"] and w["z1"] > o["z0"]]
        a0 = max(o[al + "0"] - BAND, min(w[al + "0"] for w in hit))
        a1 = min(o[al + "1"] + BAND, max(w[al + "1"] for w in hit))
        out.append({al + "0": round(a0, 4), al + "1": round(a1, 4),
                    th + "0": min(w[th + "0"] for w in hit), th + "1": max(w[th + "1"] for w in hit),
                    "kind": "structural"})
    return out


def solidify(walls, openings):
    """Объединение прямоугольников -> непересекающиеся коробки на всю толщину стены.

    Сетка по всем координатам; ячейка-стена относится к стене вдоль X, если сплошной ряд стены через неё
    по X длиннее, чем по Z (угол достаётся более длинной стене). Ячейки вдоль X склеиваются сначала
    поперёк (по Z, получается полный срез стены), потом соседние одинаковые срезы — вдоль. Для стен вдоль Z
    наоборот. Замкнутые пустоты, которые не комнаты и не проёмы (шахты, щели), заполняются ('shaft')."""
    xs = sorted({w[k] for w in walls for k in ("x0", "x1")})
    zs = sorted({w[k] for w in walls for k in ("z0", "z1")})
    nx, nz = len(xs) - 1, len(zs) - 1
    ix = {v: i for i, v in enumerate(xs)}; iz = {v: i for i, v in enumerate(zs)}
    kind = [[None] * nz for _ in range(nx)]
    for w in walls:
        for i in range(ix[w["x0"]], ix[w["x1"]]):
            for k in range(iz[w["z0"]], iz[w["z1"]]):
                if kind[i][k] is None or PRIORITY[w["kind"]] > PRIORITY[kind[i][k]]:
                    kind[i][k] = w["kind"]
    # пустоты: не комната, не проём и не связаны с краем сетки
    rooms = [r for rid, v in ROOMS.items() if rid != "shaft" for r in v["rects"]]
    holes = [(o["x0"], o["x1"], o["z0"], o["z1"]) for o in openings]
    def free(i, k):
        if kind[i][k] is not None:
            return False
        x, z = (xs[i] + xs[i + 1]) / 2, (zs[k] + zs[k + 1]) / 2
        return not any(r[0] < x < r[1] and r[2] < z < r[3] for r in rooms + holes)
    outside, stack = set(), [(i, k) for i in range(nx) for k in range(nz)
                             if (i in (0, nx - 1) or k in (0, nz - 1)) and kind[i][k] is None]
    outside.update(stack)
    while stack:
        i, k = stack.pop()
        for a, b in ((i + 1, k), (i - 1, k), (i, k + 1), (i, k - 1)):
            if 0 <= a < nx and 0 <= b < nz and kind[a][b] is None and (a, b) not in outside:
                outside.add((a, b)); stack.append((a, b))
    filled = [(i, k) for i in range(nx) for k in range(nz) if free(i, k) and (i, k) not in outside]
    for i, k in filled:
        kind[i][k] = "shaft"

    def run(i, k, di, dk):
        a, b = (i, k), (i, k)
        while 0 <= a[0] - di < nx and 0 <= a[1] - dk < nz and kind[a[0] - di][a[1] - dk]:
            a = (a[0] - di, a[1] - dk)
        while 0 <= b[0] + di < nx and 0 <= b[1] + dk < nz and kind[b[0] + di][b[1] + dk]:
            b = (b[0] + di, b[1] + dk)
        return (xs[b[0] + 1] - xs[a[0]]) if di else (zs[b[1] + 1] - zs[a[1]])
    orient = [[None] * nz for _ in range(nx)]
    for i in range(nx):
        for k in range(nz):
            if kind[i][k]:
                orient[i][k] = "x" if run(i, k, 1, 0) >= run(i, k, 0, 1) else "z"

    def strips(ax):
        """Срезы поперёк стены: для 'x' — столбец i, отрезок по k; для 'z' — строка k, отрезок по i."""
        out = []
        outer, inner = (nx, nz) if ax == "x" else (nz, nx)
        cell = (lambda o, n: (o, n)) if ax == "x" else (lambda o, n: (n, o))
        coord = zs if ax == "x" else xs
        for o in range(outer):
            n = 0
            while n < inner:
                if orient[cell(o, n)[0]][cell(o, n)[1]] != ax:
                    n += 1; continue
                m, weight = n, {}
                while m < inner and orient[cell(o, m)[0]][cell(o, m)[1]] == ax:
                    kd = kind[cell(o, m)[0]][cell(o, m)[1]]
                    weight[kd] = weight.get(kd, 0) + coord[m + 1] - coord[m]
                    m += 1
                out.append((o, n, m, max(weight, key=weight.get)))
                n = m
        return out
    boxes = []
    for ax in ("x", "z"):
        along, across = (xs, zs) if ax == "x" else (zs, xs)
        th = "z" if ax == "x" else "x"
        by_o = {}
        for o, n0, n1, kd in strips(ax):
            by_o.setdefault(o, []).append((n0, n1, kd))
        cur = {}   # одинаковый срез (n0, n1, kind) в соседних столбцах -> одна коробка; значение — где начался
        for o in range(len(along)):   # последний проход пустой: закрывает всё, что осталось
            row = set(by_o.get(o, []))
            for key in list(cur):
                if key not in row:
                    o0 = cur.pop(key); n0, n1, kd = key
                    b = {ax + "0": along[o0], ax + "1": along[o], th + "0": across[n0], th + "1": across[n1], "kind": kd}
                    boxes.append(b)
            for key in row:
                cur.setdefault(key, o)
    boxes = [{"x0": b["x0"], "z0": b["z0"], "x1": b["x1"], "z1": b["z1"], "kind": b["kind"]} for b in boxes]
    boxes.sort(key=lambda b: (b["z0"], b["x0"]))
    return boxes, len(filled)


def interior_door(d, walls):
    """Проём в перегородке на всю её толщину; сторона комнаты определяется по прямоугольникам."""
    a, b = d["span"]
    ax, th = ("x", "z") if d["along"] == "x" else ("z", "x")
    host = [w for w in walls if w["kind"] == "partition"
            and w[th + "0"] <= d["wall_at"] <= w[th + "1"] and w[ax + "0"] <= a and b <= w[ax + "1"]]
    assert len(host) == 1, f"{d['id']}: перегородка не найдена ({len(host)})"
    w = host[0]
    item = {k: v for k, v in d.items() if k not in ("span", "wall_at")}
    item.update(INTERIOR)
    item.update({ax + "0": a, ax + "1": b, th + "0": w[th + "0"], th + "1": w[th + "1"]})
    # room_side: +1/-1 — с какой стороны от перегородки комната (по +z или +x)
    room = ROOMS[d["room_id"]]["rects"]
    c = (a + b) / 2
    for side, t in ((1, w[th + "1"] + 0.02), (-1, w[th + "0"] - 0.02)):
        x, z = (c, t) if d["along"] == "x" else (t, c)
        if any(r[0] <= x <= r[1] and r[2] <= z <= r[3] for r in room):
            item["room_side"] = side
    assert "room_side" in item, f"{d['id']}: комната {d['room_id']} не примыкает к проёму"
    return item


def check_rooms(walls):
    """Каждая сторона прямоугольника комнаты должна лежать на грани какой-нибудь стены (±2 мм)."""
    faces_x = {v for w in walls for v in (w["x0"], w["x1"])}
    faces_z = {v for w in walls for v in (w["z0"], w["z1"])}
    bad = []
    for k, v in ROOMS.items():
        for r in v["rects"]:
            bad += [f"{k} x={e}" for e in r[:2] if min(abs(e - f) for f in faces_x) > 0.002]
            bad += [f"{k} z={e}" for e in r[2:] if min(abs(e - f) for f in faces_z) > 0.002]
    print("rooms vs walls:", "ok" if not bad else "НЕ СХОДИТСЯ " + ", ".join(bad))


def main():
    page = pymupdf.open(PDF)[0]
    M = page.rotation_matrix
    walls, seen = [], set()
    for d in page.get_drawings():
        fill = d.get("fill")
        if not fill:
            continue
        f = round(fill[0], 2)
        if f not in (0.47, 0.86):
            continue
        r = d["rect"] * M
        b = (round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2))
        if b[0] > 745 or b[3] > 600 or b[2] < 250 or b[1] < 200:  # легенда и прочее вне плана
            continue
        if is_noise(b) or b in seen:
            continue
        seen.add(b)
        x0, z0 = to_m(b[0], b[1])
        x1, z1 = to_m(b[2], b[3])
        thick = min(x1 - x0, z1 - z0)
        kind = "partition" if f == 0.86 else ("plaster" if thick < 0.02 else "structural")
        walls.append({"x0": x0, "z0": z0, "x1": x1, "z1": z1, "kind": kind})

    raw = walls
    openings = []
    for o in OPENINGS:
        c = o["center_pt"]
        w_pt = o["width"] * 100 * PT_PER_CM
        a, b = o["wall_pt"]
        if o["along"] == "x":
            x0, z0 = to_m(c - w_pt / 2, a - 0.5)
            x1, z1 = to_m(c + w_pt / 2, b + 0.5)
        else:
            x0, z0 = to_m(a - 0.5, c - w_pt / 2)
            x1, z1 = to_m(b + 0.5, c + w_pt / 2)
        item = {k: v for k, v in o.items() if k not in ("center_pt", "wall_pt")}
        item.update({"x0": x0, "z0": z0, "x1": x1, "z1": z1})
        openings.append(item)
    clean = drop_duplicates(raw)
    walls, n_filled = solidify(clean + opening_bands(clean, openings), openings)
    openings += [interior_door(d, walls) for d in INTERIOR_DOORS]

    xs = [w["x0"] for w in walls] + [w["x1"] for w in walls]
    zs = [w["z0"] for w in walls] + [w["z1"] for w in walls]
    bx0, bz0 = to_m(273.6, 111.6)   # контур балкона по растру
    bx1, _ = to_m(702.0, 111.6)
    out = {
        "_generated_by": "tools/extract_plan.py — не править руками",
        "source": "source/plan-AA0304.pdf",
        "units": "m",
        "axes": "X вдоль оконной стены вправо, Z от окон вглубь, Y вверх; 0 = угол кухни у мойки и окна",
        "ceiling": CEILING,
        "bounds": {"x0": min(xs), "z0": min(zs), "x1": max(xs), "z1": max(zs)},
        "walls": walls,
        "openings": openings,
        "balcony": {"x0": bx0, "x1": bx1, "z0": bz0, "z1": to_m(0, 211.8)[1]},
        "rooms": {k: {**v, "rects": [dict(zip(("x0", "x1", "z0", "z1"), r)) for r in v["rects"]]}
                  for k, v in ROOMS.items()},
        "ceiling_lights": [
            {"id": "h", "x": 1.24, "z": 1.64, "note": "выпуск света над кухней"},
            {"id": "fg", "x": 3.58, "z": 1.85, "note": "выпуск света в гостиной"},
        ],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"walls {len(walls)} (из {len(raw)} прямоугольников PDF, ячеек пустот залито {n_filled}), "
          f"openings {len(openings)} -> {OUT.relative_to(ROOT)}")
    k = [w for w in walls if w["kind"] == "partition"]
    print("partitions", len(k), "bounds", out["bounds"])
    check_rooms(walls)
    for o in openings:
        if o["type"] == "interior":
            print(f"  {o['id']}: x {o['x0']}…{o['x1']}  z {o['z0']}…{o['z1']}  комната с {o['room_side']:+d}")


if __name__ == "__main__":
    main()
