# Общие вещи для полок (web/models/decor/props/<id>/model.glb): книги, растения, вазы, рамки.
# blender -b --python make_props.py -- <ph_dir> <out_dir> [id ...]
#   ph_dir  — скачанные модели Poly Haven (fetch_polyhaven.py, 1k): растения, вазы, рамки (CC0);
#   out_dir — куда класть <id>/model.glb (несжатый; потом meshopt), без id — все.
# Книги и плющ (эпипремнум) рисуются здесь процедурно, сид фиксирован — результат повторяется.
# Контракт: метры, пол Y=0 (у висящих плетей геометрия ниже нуля), центр следа в 0, перед (корешки, лицо рамки) в +Z.
import bpy, bmesh, sys, os, json, math, random
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
PH, OUT, ONLY = args[0], args[1], set(args[2:])

# ---------- палитра (sRGB) ----------
# Тёплая, «лондонская»: земляные тона, пыльные акценты, немного тёмно-синего и чёрного для глубины.
PAL = {
    "oxblood": "#6e2a26", "terracotta": "#b5603f", "rust": "#94492b", "ochre": "#c49a3e", "olive": "#6b6a3a",
    "sage": "#8f9a7a", "forest": "#2f4a3a", "navy": "#283447", "slate": "#566676", "charcoal": "#2e2d2b",
    "tan": "#b89a74", "oat": "#d9cdb5", "cream": "#ebe2cd", "blush": "#c99a8e", "black": "#1d1c1b",
    "bone": "#efeae0", "cocoa": "#4a3326", "mustard": "#c8a24a", "teal": "#2f5656",
}
PAGES = "#eee4cc"
GOLD = "#b8954a"


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


_mats = {}


def mat(key, hexc, rough=0.7, metal=0.0):
    k = (key, hexc, rough, metal)
    if k in _mats:
        return _mats[k]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lin(hexc), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    _mats[k] = m
    return m


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


# ---------- примитивы (Blender: Z вверх, перед = −Y) ----------
def box_bm(bm, x0, x1, y0, y1, z0, z1, mi):
    vs = [bm.verts.new((x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    idx = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for f in idx:
        face = bm.faces.new([vs[i] for i in f])
        face.material_index = mi


def obj_from_bm(bm, name, mats):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


# ---------- книги ----------
def book(t, d, h, color, kind, band=None):
    """Книга стоя в своих координатах: x — толщина [0,t], y — глубина [0,d] (корешок при y=0, смотрит в −Y),
    z — высота [0,h]. kind: hard (твёрдый переплёт со свесом) | soft (обложка)."""
    bm = bmesh.new()
    cov = mat("cover_" + color, PAL[color], 0.62 if kind == "hard" else 0.55)
    pg = mat("pages", PAGES, 0.9)
    mats = [cov, pg]
    b, ov = (0.0028, 0.003) if kind == "hard" else (0.0009, 0.0)
    box_bm(bm, 0, t, 0, b, 0, h, 0)                          # корешок
    box_bm(bm, 0, b, 0, d, 0, h, 0)                          # крышки
    box_bm(bm, t - b, t, 0, d, 0, h, 0)
    box_bm(bm, b, t - b, b, d - ov, ov, h - ov, 1)           # блок страниц
    if band:
        gm = mat("foil_" + band, PAL.get(band, GOLD), 0.35, 0.8 if band == "gold" else 0.0)
        mats.append(gm)
        for zc in (h * 0.86, h * 0.14):
            box_bm(bm, t * 0.12, t * 0.88, -0.0007, 0.0003, zc - 0.004, zc + 0.004, 2)
    return obj_from_bm(bm, "book", mats)


def place(o, x=0.0, y=0.0, z=0.0, ry=0.0, rz=0.0, lie=False):
    m = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y")
    if lie:
        # положить на бок: высота книги уходит в +X, толщина — в +Z
        m = m @ Matrix.Rotation(math.radians(-90), 4, "Y")
    o.matrix_world = m


def row(seed, n_or_w, hmin, hmax, colors, lean=None, d_ratio=(0.66, 0.78), soft=0.25, band=0.45):
    """Ряд книг стоя вплотную, корешки на одной линии спереди. lean: 'right' — последняя книга прислонена."""
    rnd = random.Random(seed)
    objs, x, prev_h = [], 0.0, None
    target_w = n_or_w
    i = 0
    while x < target_w:
        h = rnd.uniform(hmin, hmax)
        # соседние книги одной серии иногда одной высоты — так полка выглядит собранной, а не случайной
        if prev_h and rnd.random() < 0.35:
            h = prev_h
        t = rnd.choice([0.014, 0.018, 0.022, 0.026, 0.03, 0.036, 0.042])
        d = h * rnd.uniform(*d_ratio)
        kind = "soft" if rnd.random() < soft else "hard"
        c = colors[i % len(colors)] if rnd.random() < 0.7 else rnd.choice(colors)
        bd = rnd.choice(["gold", "cream", "bone"]) if (kind == "hard" and rnd.random() < band) else None
        o = book(t, d, h, c, kind, bd)
        place(o, x=x)
        objs.append((o, x, t, h, d))
        x += t + rnd.uniform(0.0, 0.0015)
        prev_h = h
        i += 1
    if lean:
        h = rnd.uniform(hmin, hmax)
        t = 0.024
        d = h * 0.72
        th = math.radians(rnd.uniform(14, 20))
        hc = min(h, prev_h) * 0.92
        o = book(t, d, h, rnd.choice(colors), "hard", "gold")
        base = x + hc * math.sin(th)
        place(o, x=base, ry=-th)
        objs.append((o, base, t, h, d))
    return [o for o, *_ in objs]


def stack(seed, sizes, colors, jitter=3.0):
    """Стопка лёжа: sizes — [(h, d, t)], снизу вверх, корешки спереди."""
    rnd = random.Random(seed)
    objs, z = [], 0.0
    for i, (h, d, t) in enumerate(sizes):
        o = book(t, d, h, colors[i % len(colors)], "hard", "gold" if rnd.random() < 0.4 else None)
        place(o, x=-h / 2, z=z, lie=True)
        # повернуть вокруг вертикали через центр книги
        c = Vector((0, d / 2, 0))
        rz = math.radians(rnd.uniform(-jitter, jitter))
        o.matrix_world = Matrix.Translation(c) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Translation(-c) @ o.matrix_world
        objs.append(o)
        z += t
    return objs


# ---------- горшки и плющ ----------
def pot(r_top, r_bot, h, color, rough=0.85, rim=0.008, soil=True, seg=32):
    bm = bmesh.new()
    pm = mat("pot_" + color.strip("#"), color, rough)
    sm = mat("soil", "#3b2c22", 0.95)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r_bot, radius2=r_top, depth=h - rim,
                          matrix=Matrix.Translation((0, 0, (h - rim) / 2)))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r_top + 0.004, radius2=r_top + 0.004, depth=rim,
                          matrix=Matrix.Translation((0, 0, h - rim / 2)))
    for f in bm.faces:
        f.material_index = 0
    if soil:
        n = len(bm.faces)
        bmesh.ops.create_circle(bm, cap_ends=True, segments=seg, radius=r_top - 0.004,
                                matrix=Matrix.Translation((0, 0, h - 0.012)))
        bm.faces.ensure_lookup_table()
        for f in list(bm.faces)[n:]:
            f.material_index = 1
    return obj_from_bm(bm, "pot", [pm, sm])


def leaf_bm(bm, base, axis, normal, size, mi):
    """Лист-сердечко: base — точка черешка, axis — направление к кончику, normal — лицо листа."""
    axis = axis.normalized()
    side = axis.cross(normal).normalized()
    normal = side.cross(axis).normalized()
    outline = [(0.0, 0.0), (0.32, 0.08), (0.48, 0.3), (0.44, 0.55), (0.28, 0.8), (0.0, 1.0),
               (-0.28, 0.8), (-0.44, 0.55), (-0.48, 0.3), (-0.32, 0.08)]
    w = size * 0.75
    c = bm.verts.new(base + axis * (size * 0.45) + normal * (size * 0.06))
    vs = []
    for u, v in outline:
        p = base + axis * (v * size) + side * (u * w) - normal * (abs(u) * size * 0.12)
        vs.append(bm.verts.new(p))
    for i in range(len(vs)):
        f = bm.faces.new([c, vs[i], vs[(i + 1) % len(vs)]])
        f.material_index = mi


def catmull(pts, step=0.012):
    out = []
    P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        n = max(2, int((p2 - p1).length / step))
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


def pothos(seed, pot_r=0.07, pot_h=0.12, pot_color="#e6dfd2", vines=7, length=(0.22, 0.55), front_arc=150):
    """Эпипремнум в горшке: шапка листьев и плети, свисающие вперёд (+Z glTF = −Y Blender) и в стороны."""
    rnd = random.Random(seed)
    objs = [pot(pot_r, pot_r * 0.82, pot_h, pot_color)]
    bm = bmesh.new()
    greens = [mat("leaf_a", "#3d6a2f", 0.55), mat("leaf_b", "#557d36", 0.55), mat("leaf_c", "#2f5526", 0.6)]
    stem = mat("stem", "#4d6b33", 0.7)
    top = Vector((0, 0, pot_h - 0.01))
    # шапка
    for k in range(26):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0.0, pot_r * 0.9)
        base = top + Vector((math.cos(a) * r, math.sin(a) * r, rnd.uniform(0.01, 0.07)))
        out = Vector((math.cos(a), math.sin(a), 0))
        axis = (out * rnd.uniform(0.5, 1.0) + Vector((0, 0, rnd.uniform(0.3, 0.9)))).normalized()
        nrm = (Vector((0, 0, 1)) + out * 0.3).normalized()
        leaf_bm(bm, base, axis, nrm, rnd.uniform(0.045, 0.07), rnd.randrange(3))
    curves = []
    for v in range(vines):
        # угол по кругу: перед = −Y; дуга front_arc градусов
        ang = math.radians(-90 + rnd.uniform(-front_arc / 2, front_arc / 2))
        o = Vector((math.cos(ang), math.sin(ang), 0))
        sd = Vector((-o.y, o.x, 0))
        L = rnd.uniform(*length)
        rim = Vector((o.x * pot_r * 0.85, o.y * pot_r * 0.85, pot_h))
        pts = [rim + Vector((0, 0, 0.01)),
               rim + o * 0.03 + Vector((0, 0, 0.02)),
               rim + o * 0.055 - Vector((0, 0, 0.02)),
               rim + o * 0.065 + sd * rnd.uniform(-0.02, 0.02) - Vector((0, 0, L * 0.45)),
               rim + o * 0.06 + sd * rnd.uniform(-0.05, 0.05) - Vector((0, 0, L))]
        path = catmull(pts)
        cu = bpy.data.curves.new("vine", "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = 0.0016
        cu.bevel_resolution = 0
        sp = cu.splines.new("POLY")
        sp.points.add(len(path) - 1)
        for i, p in enumerate(path):
            sp.points[i].co = (*p, 1)
        co = bpy.data.objects.new("vine", cu)
        bpy.context.scene.collection.objects.link(co)
        co.data.materials.append(stem)
        curves.append(co)
        # листья вдоль плети, через 3–4 см, поочерёдно в стороны, к концу мельче
        s, alt = 0.0, 1
        for i in range(1, len(path)):
            s += (path[i] - path[i - 1]).length
            if s < 0.035:
                continue
            s = 0.0
            alt = -alt
            frac = i / len(path)
            tang = (path[min(i + 1, len(path) - 1)] - path[i - 1]).normalized()
            axis = (o * 0.7 + sd * alt * 0.8 + Vector((0, 0, -0.35)) + Vector((rnd.uniform(-.2, .2), rnd.uniform(-.2, .2), rnd.uniform(-.2, .2)))).normalized()
            nrm = (o + Vector((0, 0, 0.25))).normalized()
            leaf_bm(bm, path[i], axis, nrm, rnd.uniform(0.04, 0.065) * (1.0 - 0.35 * frac), rnd.randrange(3))
    objs.append(obj_from_bm(bm, "leaves", greens))
    # плети в сетку
    dg = bpy.context.evaluated_depsgraph_get()
    for co in curves:
        me = bpy.data.meshes.new_from_object(co.evaluated_get(dg))
        mo = bpy.data.objects.new("vine_m", me)
        bpy.context.scene.collection.objects.link(mo)
        bpy.data.objects.remove(co)
        objs.append(mo)
    return objs


# ---------- Poly Haven ----------
def import_ph(pid, keep=None):
    f = os.path.join(PH, pid, pid + "_1k.gltf")
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    new = [o for o in bpy.context.scene.objects if o not in before]
    if keep:
        for o in list(new):
            if o.type == "MESH" and not any(o.name.startswith(k) for k in keep):
                bpy.data.objects.remove(o)
        new = [o for o in bpy.context.scene.objects if o not in before]
    return [o for o in new if o.type == "MESH"]


def decimate(objs, max_tris):
    for o in objs:
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        if tris > max_tris:
            bpy.context.view_layer.objects.active = o
            md = o.modifiers.new("dec", "DECIMATE")
            md.ratio = max_tris / tris
            dg = bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
            o.modifiers.clear()
            o.data = me


def xform(objs, m):
    for o in objs:
        o.matrix_world = m @ o.matrix_world


def bbox(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        if o.type != "MESH":
            continue
        pts += [o.matrix_world @ v.co for v in o.data.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def face_dir(objs, mat_sub):
    """Средняя нормаль граней с материалом, в имени которого mat_sub (лицо картины)."""
    acc = Vector()
    for o in objs:
        nm = o.matrix_world.to_3x3()
        for p in o.data.polygons:
            m = o.data.materials[p.material_index] if o.data.materials else None
            if m and mat_sub in m.name:
                acc += (nm @ p.normal) * p.area
    return acc.normalized()


def drop_faces(objs, mat_sub):
    """Убрать грани с материалом mat_sub (стекло рамок: прозрачность BLEND даёт тёмное пятно и лишнюю сортировку)."""
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        names = [m.name if m else "" for m in o.data.materials]
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if mat_sub in names[f.material_index]], context="FACES")
        bm.to_mesh(o.data)
        bm.free()


def face_front(objs, mat_sub):
    """Повернуть вокруг вертикали так, чтобы лицо смотрело в −Y Blender (+Z glTF)."""
    d = face_dir(objs, mat_sub)
    a = math.atan2(d.y, d.x)
    xform(objs, Matrix.Rotation(-math.pi / 2 - a, 4, "Z"))


FOOT = [0, 0]   # след опоры последней вещи (горшок), Ш × Г — для проверок проходов


def ground(objs, foot=None):
    """Центр следа в 0, низ на 0. foot — объекты, по которым считать след и низ (горшок, а не листья и плети)."""
    mn, mx = bbox(foot or objs)
    c = (mn + mx) / 2
    xform(objs, Matrix.Translation((-c.x, -c.y, -mn.z)))
    FOOT[:] = [round(mx.x - mn.x, 3), round(mx.y - mn.y, 3)]


def resize_textures(px):
    for img in bpy.data.images:
        if img.size[0] > px or img.size[1] > px:
            k = px / max(img.size[0], img.size[1])
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))


def replace_artwork(objs, png):
    img = bpy.data.images.load(png)
    for o in objs:
        for m in o.data.materials:
            if m and "artwork" in m.name and m.use_nodes:
                for n in m.node_tree.nodes:
                    if n.type == "TEX_IMAGE" and n.image and "diff" in n.image.name:
                        n.image = img


def export(pid, tex=1024):
    resize_textures(tex)
    d = os.path.join(OUT, pid)
    os.makedirs(d, exist_ok=True)
    mn, mx = bbox([o for o in bpy.context.scene.objects if o.type == "MESH"])
    # серые карты шероховатости Blender не пишет в WEBP — тогда JPEG/PNG (AUTO)
    fmt = "AUTO" if any(i.depth == 8 for i in bpy.data.images if i.size[0] > 0) else "WEBP"
    bpy.ops.export_scene.gltf(filepath=os.path.join(d, "model.glb"), export_format="GLB", export_image_format=fmt,
                              export_image_quality=82, export_yup=True, export_apply=True, export_animations=False,
                              export_extras=False, export_cameras=False, export_lights=False)
    tris = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == "MESH" for p in o.data.polygons)
    # Blender (x, y, z) -> glTF (x, z, -y): размер W×H×D
    size = [round(mx.x - mn.x, 3), round(mx.z - mn.z, 3), round(mx.y - mn.y, 3)]
    rec = {"id": pid, "size": size, "foot": list(FOOT), "minY": round(mn.z, 3), "tris": tris}
    print("PROP", json.dumps(rec), flush=True)
    return rec


# ---------- рецепты ----------
WARM = ["terracotta", "oat", "cream", "rust", "tan", "ochre", "bone"]
DEEP = ["navy", "oxblood", "forest", "charcoal", "cocoa", "slate"]
SOFT = ["sage", "blush", "oat", "bone", "cream", "olive"]


def r_books(pid):
    p = {
        # ряды: ширина, высоты (под свободную высоту полок BILLY/IVAR/KALLAX), палитра
        "books-row-s":     lambda: row(11, 0.20, 0.205, 0.235, WARM),
        "books-row-s2":    lambda: row(12, 0.18, 0.200, 0.235, DEEP + ["oat"]),
        "books-row-m":     lambda: row(21, 0.30, 0.210, 0.255, SOFT + ["terracotta"], lean="right"),
        "books-row-m2":    lambda: row(22, 0.30, 0.215, 0.255, DEEP + ["tan", "cream"], lean="right"),
        "books-row-l":     lambda: row(31, 0.46, 0.205, 0.255, WARM + ["navy", "forest"]),
        "books-row-l2":    lambda: row(32, 0.46, 0.200, 0.250, SOFT + DEEP[:2]),
        "books-row-tall":  lambda: row(41, 0.24, 0.265, 0.300, ["bone", "charcoal", "oat", "terracotta", "black"], d_ratio=(0.75, 0.85), soft=0.0),
        "books-row-paper": lambda: row(51, 0.28, 0.170, 0.198, ["cream", "terracotta", "ochre", "bone", "sage", "rust"], soft=0.9, band=0.1),
        "books-stack-l":   lambda: stack(61, [(0.31, 0.25, 0.032), (0.30, 0.235, 0.026), (0.28, 0.22, 0.03), (0.25, 0.19, 0.022)],
                                         ["bone", "charcoal", "terracotta", "oat"]),
        "books-stack-s":   lambda: stack(62, [(0.235, 0.16, 0.028), (0.22, 0.15, 0.022), (0.2, 0.13, 0.018)],
                                         ["sage", "cream", "oxblood"]),
    }
    if pid not in p:
        return None
    objs = p[pid]()
    ground(objs)
    return export(pid)


def r_plants(pid):
    if pid == "plant-pothos":
        objs = pothos(7)
        ground(objs, foot=objs[:1])
        return export(pid)
    if pid == "plant-pothos-terracotta":
        objs = pothos(8, pot_r=0.065, pot_h=0.11, pot_color="#b26a48", vines=5, length=(0.15, 0.38))
        ground(objs, foot=objs[:1])
        return export(pid)
    if pid == "plant-calathea":
        pl = import_ph("calathea_orbifolia_01", keep=["calathea_orbifolia_01_b"])
        mn, mx = bbox(pl)
        c = (mn + mx) / 2
        xform(pl, Matrix.Translation((-c.x, -c.y, -mn.z)))
        xform(pl, Matrix.Scale(0.85, 4))
        pt = pot(0.085, 0.07, 0.15, "#b26a48")
        xform(pl, Matrix.Translation((0, 0, 0.15 - 0.02)))
        objs = [pt] + pl
        ground(objs, foot=[pt])
        return export(pid)
    if pid == "plant-pachira":
        pl = import_ph("pachira_aquatica_01", keep=["pachira_aquatica_01_bark_d", "pachira_aquatica_01_leaves_d"])
        decimate([o for o in pl if "leaves" in o.name], 14000)
        bark = [o for o in pl if "bark" in o.name]
        mn, mx = bbox(bark)
        c = (mn + mx) / 2
        xform(pl, Matrix.Translation((-c.x, -c.y, -mn.z)))
        xform(pl, Matrix.Scale(0.75, 4))
        H = 0.36
        pt = pot(0.18, 0.15, H, "#cbbfa9", rim=0.012)
        xform(pl, Matrix.Translation((0, 0, H - 0.03)))
        objs = [pt] + pl
        ground(objs, foot=[pt])
        return export(pid)
    if pid == "plant-syngonium":
        objs = import_ph("potted_plant_02")
        decimate([o for o in objs if "dirt" in o.name], 2500)
        ground(objs, foot=[o for o in objs if o.name.endswith("_pot")])
        return export(pid)
    if pid == "plant-aloe":
        objs = import_ph("potted_plant_04")
        ground(objs, foot=[o for o in objs if o.name.endswith("_pot")])
        return export(pid, 512)
    return None


def r_objects(pid):
    simple = {"vase-white-tall": "ceramic_vase_01", "vase-stone-slim": "ceramic_vase_03",
              "vase-jug-white": "ceramic_vase_04", "bowl-wood": "wooden_bowl_01"}
    if pid in simple:
        objs = import_ph(simple[pid])
        decimate(objs, 4000)
        ground(objs)
        return export(pid, 512)
    if pid in ("frame-photo-black", "frame-photo-white"):
        objs = import_ph("standing_picture_frame_01" if pid.endswith("black") else "standing_picture_frame_02")
        drop_faces(objs, "glass")
        face_front(objs, "artwork")
        ground(objs)
        return export(pid, 512)
    if pid in ("art-print-arch", "art-print-sun"):
        # большая рамка Poly Haven с нашим абстрактным принтом (make_prints.py), прислонена к стене на 4°
        objs = import_ph("hanging_picture_frame_01")
        replace_artwork(objs, os.path.join(PH, "_prints", pid + ".png"))
        drop_faces(objs, "glass")
        face_front(objs, "artwork")
        mn, mx = bbox(objs)
        xform(objs, Matrix.Translation((0, 0, -mn.z)))
        if pid == "art-print-sun":
            xform(objs, Matrix.Scale(0.7, 4))
        # наклон: верх к стене (+Y Blender), низ на полке
        xform(objs, Matrix.Rotation(math.radians(-4), 4, "X"))
        ground(objs)
        return export(pid, 1024)
    return None


ALL = ["books-row-s", "books-row-s2", "books-row-m", "books-row-m2", "books-row-l", "books-row-l2", "books-row-tall",
       "books-row-paper", "books-stack-l", "books-stack-s",
       "plant-pothos", "plant-pothos-terracotta", "plant-calathea", "plant-pachira", "plant-syngonium", "plant-aloe",
       "vase-white-tall", "vase-stone-slim", "vase-jug-white", "bowl-wood", "frame-photo-black", "frame-photo-white",
       "art-print-arch", "art-print-sun"]
# Описания для web/models/decor/props/index.json (читают агенты, раскладывающие полки).
NOTES = {
    "books-row-s": "ряд книг ~21 см, тёплые тона, h ≤ 0.23", "books-row-s2": "ряд ~20 см, глубокие тона (синий, бордо, лес)",
    "books-row-m": "ряд ~42 см с прислонённой книгой справа, мягкие тона",
    "books-row-m2": "ряд ~40 см с прислонённой книгой справа, глубокие тона",
    "books-row-l": "ряд ~46 см, тёплые + синий и зелёный", "books-row-l2": "ряд ~48 см, мягкие + глубокие",
    "books-row-tall": "альбомы 27–30 см, ряд ~24 см (нужна полка ≥ 0.30)",
    "books-row-paper": "мягкие обложки 17–20 см, ряд ~29 см",
    "books-stack-l": "стопка из 4 больших альбомов лёжа, h 0.11", "books-stack-s": "стопка из 3 книг лёжа, h 0.07",
    "plant-pothos": "эпипремнум в белом горшке Ø14: плети висят вперёд до 40 см НИЖЕ основания; "
                    "центр горшка ~7 см от переднего края полки",
    "plant-pothos-terracotta": "эпипремнум в терракоте Ø13, плети до 28 см ниже основания",
    "plant-calathea": "калатея в терракоте Ø17 (листья Poly Haven), h 0.39",
    "plant-pachira": "пахира в напольном кашпо Ø36, h 1.76", "plant-syngonium": "сингониум в терракоте Ø47, h 0.84, напольный",
    "plant-aloe": "алоэ в белом горшке, h 0.27", "vase-white-tall": "белая ваза h 0.40",
    "vase-stone-slim": "узкая каменная ваза h 0.41", "vase-jug-white": "белый кувшин h 0.34", "bowl-wood": "деревянная чаша Ø31",
    "frame-photo-black": "чёрная рамка с фото 20×25 на ножке", "frame-photo-white": "белая рамка с фото 22×27 на ножке",
    "art-print-arch": "принт 59×84 в чёрной раме, прислонён к стене (4°), для полок-уступов",
    "art-print-sun": "принт 42×59 в чёрной раме, прислонён к стене (4°)",
}
report = []
for pid in ALL:
    if ONLY and pid not in ONLY:
        continue
    reset()
    rec = r_books(pid) or r_plants(pid) or r_objects(pid)
    report.append(rec)
json.dump(report, open(os.path.join(OUT, "_report.json"), "w"), indent=1)
if not ONLY:
    idx = {"_about": "Общий реквизит: id -> size [Ш, В, Г] м (оси glTF, перед +Z), minY — низ геометрии "
                     "(у плетей < 0), foot — след опоры [Ш, Г] (горшок без листьев), tris. Генерирует tools/decor/living/make_props.py, копирует pack.py. См. README.md.",
           "props": {r["id"]: {"size": r["size"], "foot": r["foot"], "minY": r["minY"], "tris": r["tris"],
                               "note": NOTES[r["id"]]} for r in report}}
    json.dump(idx, open(os.path.join(OUT, "index.json"), "w"), ensure_ascii=False, indent=1)
