# Сборка моделей кухонной обстановки в Blender (headless). Вход — <tmp> после fetch.py и make_art.py.
#   blender -b --python tools/decor/kitchen/build.py -- <tmp> [id …]
# Каждый исходник (products.json) приводится к контракту (метры, низ Y = 0, центр следа в 0, перед +Z, ≤ maxTris,
# текстуры ≤ maxTex), затем рецепты ниже собирают из них готовые модели:
#   kitchen/<id>.glb — полки, табуреты, рейлинги, полочка с картинами (web/models/decor/kitchen/<id>/);
#   props/<id>.glb   — наборы реквизита: тарелки, банки, доски, ваза, фрукты, рамки с картинами (web/models/decor/props/<id>/).
# Выход: <tmp>/out/{kitchen,props}/<id>.glb и tools/decor/kitchen/assets.json (габарит, у полок высоты полок `tops`,
# у мебели центры опор `legs`, у рейлингов высота перекладины `bar`, исходники `sources`).
# Дальше pack.py (meshopt + миниатюры) и compose.py (раскладка в web/spec/decor/kitchen.json).
# Внутри всё считается в осях glTF (X вправо, Y вверх, Z вперёд), в Blender переводится матрицей C.
import bpy, json, math, os, sys
from collections import Counter
import numpy as np
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:]
TMP, ONLY = os.path.abspath(ARGS[0]), set(ARGS[1:])
HERE = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(HERE, "products.json")))
IKEA = {x["key"]: x for x in P["ikea"]}
PH = {x["key"]: x for x in P["polyhaven"]}
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # glTF -> Blender
CI = C.inverted()

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
TPL = bpy.data.collections.new("tpl")            # шаблоны: не в сцене, на экспорт не попадают
EXP = bpy.data.collections.new("exp")
SC.collection.children.link(EXP)


# ---------- исходники ----------

def gl_verts(me):
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)   # Blender -> glTF


def clean_materials(objs):
    # без KHR_materials_ior/specular: иначе three берёт MeshPhysicalMaterial и лишнюю шейдерную программу
    for o in objs:
        for m in o.data.materials:
            if not m or not m.use_nodes:
                continue
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    n.inputs["IOR"].default_value = 1.5
                    n.inputs["Specular IOR Level"].default_value = 0.5
                    n.inputs["Specular Tint"].default_value = (1, 1, 1, 1)


def import_joined(path):
    before = {o.as_pointer() for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o.as_pointer() not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes, selected_objects=meshes):
        if len(meshes) > 1:
            bpy.ops.object.join()
    obj = meshes[0]
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    keep = obj.as_pointer()
    for o in [o for o in bpy.data.objects if o.as_pointer() not in before and o.as_pointer() != keep]:
        bpy.data.objects.remove(o)       # пустышки и узлы импорта (меши уже слиты в obj)
    return obj


def finish_template(obj, key, fix=(0, 0, 0), max_tris=40000, max_tex=1024):
    me = obj.data
    me.transform(CI)                                   # дальше вершины в осях glTF
    for ax, deg in zip("XYZ", fix):
        if deg:
            me.transform(Matrix.Rotation(math.radians(deg), 4, ax))
    v = gl_verts_raw(me)
    mn, mx = v.min(0), v.max(0)
    me.transform(Matrix.Translation((-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2)))
    me.transform(C)
    me.update()
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris > max_tris:
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.ratio = max_tris / tris
        mod.use_collapse_triangulate = True
        with bpy.context.temp_override(object=obj, active_object=obj):
            bpy.ops.object.modifier_apply(modifier="dec")
    for m in me.materials:
        for n in (m.node_tree.nodes if m and m.use_nodes else []):
            img = getattr(n, "image", None)
            if img and max(img.size) > max_tex:
                k = max_tex / max(img.size)
                img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
    clean_materials([obj])
    obj.name = key
    for c in obj.users_collection:
        c.objects.unlink(obj)
    TPL.objects.link(obj)
    return obj


def gl_verts_raw(me):   # вершины меша как есть (уже в осях glTF во время finish_template)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


_T = {}


def tpl(key):
    """Шаблон исходника по ключу products.json (IKEA или Poly Haven): объект в осях Blender, вершины в glTF-кеше."""
    if key in _T:
        return _T[key]
    if key in IKEA:
        it = IKEA[key]
        obj = finish_template(import_joined(os.path.join(TMP, "raw", it["article"].replace(".", "") + ".glb")), key,
                              it["fix"], it["maxTris"], it["maxTex"])
    elif key in PH:
        it = PH[key]
        d = os.path.join(TMP, "ph", it["id"])
        obj = finish_template(import_joined(os.path.join(d, next(f for f in os.listdir(d) if f.endswith(".gltf")))),
                              key, (0, 0, 0), it["maxTris"], 512)
    else:
        raise KeyError(key)
    _T[key] = (obj, gl_verts(obj.data))
    return _T[key]


# ---------- расстановка внутри модели ----------

def gl_rot(rots):
    R = Matrix.Identity(4)
    for ax, deg in rots:
        R = Matrix.Rotation(math.radians(deg), 4, ax.upper()) @ R
    return R


def put(src, rots=(), pivot=None, at=None, **align):
    """Экземпляр шаблона (общий меш). rots — [(ось glTF, градусы)] по порядку. Положение: либо pivot (точка шаблона)
    -> at, либо по габариту после поворота: x/z — центр, y — низ по умолчанию; x0/x1, y0/y1, z0/z1 — края."""
    obj, V = tpl(src)
    USED[src] += 1
    R = gl_rot(rots)
    R3 = np.array(R.to_3x3())
    if pivot is not None:
        p = np.array(pivot, float)
        t = np.array(at, float) - R3 @ p
    else:
        Vr = V @ R3.T
        mn, mx = Vr.min(0), Vr.max(0)
        t = np.zeros(3)
        for i, a in enumerate("xyz"):
            if a + "0" in align:
                t[i] = align[a + "0"] - mn[i]
            elif a + "1" in align:
                t[i] = align[a + "1"] - mx[i]
            elif a in align:
                t[i] = align[a] - ((mn[i] + mx[i]) / 2 if a != "y" else mn[i])
            else:
                t[i] = -((mn[i] + mx[i]) / 2) if a != "y" else -mn[i]
    M = Matrix.Translation(t.tolist()) @ R
    inst = obj.copy()
    EXP.objects.link(inst)
    inst.matrix_world = C @ M @ CI
    return inst


def inst_verts(o):
    """Вершины экземпляра в осях glTF модели."""
    M = np.array((CI @ o.matrix_world @ C).to_4x4())
    return gl_verts(o.data) @ M[:3, :3].T + M[:3, 3]


def move(o, d):
    o.matrix_world = C @ Matrix.Translation(d) @ CI @ o.matrix_world


def world_bbox(objs):
    pts = []
    for o in objs:
        V = gl_verts(o.data)
        M = np.array((CI @ o.matrix_world @ C).to_4x4())
        pts.append(V @ M[:3, :3].T + M[:3, 3])
    pts = np.concatenate(pts)
    return pts.min(0), pts.max(0)


def bbox_of(src, rots=()):
    _, V = tpl(src)
    Vr = V @ np.array(gl_rot(rots).to_3x3()).T
    return Vr.min(0), Vr.max(0)


def head_sign(src, axis):
    """С какой стороны оси (+1/−1) у кухонной утвари рабочая часть: там она шире."""
    _, V = tpl(src)
    a = V[:, axis]
    lo, hi = a.min(), a.max()
    other = [i for i in range(3) if i != axis]

    def width(mask):
        s = V[mask][:, other]
        return float((s.max(0) - s.min(0)).max()) if mask.any() else 0.0
    return 1 if width(a > hi - 0.3 * (hi - lo)) > width(a < lo + 0.3 * (hi - lo)) else -1


def tops(objs, min_area=0.01):
    """Высоты горизонтальных поверхностей, смотрящих вверх (полки): [(y, площадь)] по убыванию площади."""
    acc = {}
    for o in objs:
        R = o.matrix_world.to_3x3()
        for poly in o.data.polygons:
            if (R @ poly.normal).normalized()[2] > 0.97:     # Blender Z = glTF Y
                y = (CI @ (o.matrix_world @ poly.center))[1]
                k = round(y / 0.004) * 0.004
                acc[k] = acc.get(k, 0) + poly.area
    return sorted(((round(k, 3), round(a, 4)) for k, a in acc.items() if a >= min_area), key=lambda t: -t[1])


# ---------- процедурное: наполнение банок, отпечаток в рамке ----------

def noise_image(name, base, dots, n_dots=900, size=256, r=(2, 5), seed=1):
    rng = np.random.default_rng(seed)
    img = np.ones((size, size, 4)) * np.array([*base, 1.0])
    yy, xx = np.mgrid[0:size, 0:size]
    for _ in range(n_dots):
        cx, cy = rng.integers(0, size, 2)
        rx, ry = rng.uniform(*r, 2)
        col = np.array(dots[rng.integers(len(dots))])
        dx = np.minimum(abs(xx - cx), size - abs(xx - cx))
        dy = np.minimum(abs(yy - cy), size - abs(yy - cy))
        m = (dx / rx) ** 2 + (dy / ry) ** 2 < 1
        img[m, :3] = col * rng.uniform(0.85, 1.1)
    im = bpy.data.images.new(name, size, size)
    im.pixels.foreach_set(np.clip(img, 0, 1).astype(np.float32).ravel())
    im.pack()
    return im


def mat_tex(name, image, rough=0.8, color=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    if image is not None:
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        t.image = image
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
    else:
        b.inputs["Base Color"].default_value = (*color, 1)
    return m


FILLS = {}


def fill_mat(kind):
    if kind not in FILLS:
        spec = {
            "pasta":   ((0.80, 0.62, 0.32), [(0.93, 0.76, 0.42), (0.70, 0.52, 0.25)], 700, (3, 9)),
            "lentils": ((0.55, 0.22, 0.10), [(0.78, 0.36, 0.16), (0.62, 0.28, 0.12)], 1500, (2, 3)),
            "rice":    ((0.86, 0.83, 0.76), [(0.96, 0.94, 0.88), (0.80, 0.77, 0.70)], 1600, (1.5, 3.5)),
            "coffee":  ((0.16, 0.08, 0.04), [(0.30, 0.16, 0.08), (0.22, 0.11, 0.05)], 900, (3, 5)),
        }
        if kind in spec:
            base, dots, n, r = spec[kind]
            FILLS[kind] = mat_tex("fill_" + kind, noise_image("fill_" + kind, base, dots, n, r=r, seed=len(FILLS) + 3), 0.75)
        else:   # жидкости — гладкий цвет
            FILLS[kind] = mat_tex("fill_" + kind, None, 0.15, {"oil": (0.30, 0.22, 0.02), "vinegar": (0.12, 0.03, 0.02)}[kind])
    return FILLS[kind]


def cylinder(name, r, h, mat, x=0.0, y0=0.0, z=0.0, seg=28):
    """Цилиндр в осях glTF (ось по Y) с UV по развёртке: наполнение стеклянной банки."""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h, calc_uvs=True)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    EXP.objects.link(o)
    o.matrix_world = C @ Matrix.Translation((x, y0 + h / 2, z)) @ Matrix.Rotation(math.radians(-90), 4, "X")
    return o


def jar_with_fill(src, kind, frac, x=0.0, z=0.0, ry=0.0):
    """Банка KORKEN с наполнением: цилиндр внутри стекла (радиус по меньшей стороне корпуса, высота frac)."""
    inst = put(src, [("y", ry)], x=x, z=z)
    W = inst_verts(inst)
    H = W[:, 1].max()
    band = W[(W[:, 1] > 0.3 * H) & (W[:, 1] < 0.6 * H)]       # корпус без крышки и застёжки
    bmn, bmx = band.min(0), band.max(0)
    r = min(bmx[0] - bmn[0], bmx[2] - bmn[2]) / 2 - 0.007
    return [inst, cylinder(f"{src}_{kind}", r, H * frac, fill_mat(kind), (bmn[0] + bmx[0]) / 2, 0.007, (bmn[2] + bmx[2]) / 2)]


ART_MATS, CLEARED = {}, set()


def framed(frame, art, fmt, rots=(), **align):
    """Рамка IKEA + отпечаток (make_art.py) за её стеклом. Стекло — материал с прозрачностью; отпечаток — плоскость
    на 1 мм глубже стекла, по его габариту. Возвращает [рамка, отпечаток]."""
    obj, V = tpl(frame)
    me = obj.data
    glass = [i for i, m in enumerate(me.materials) if m and m.use_nodes and
             m.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value < 0.5]
    idx = sorted({v for p in me.polygons if p.material_index in glass for v in p.vertices})
    G = V[idx]
    gmn, gmx = G.min(0), G.max(0)
    if frame not in CLEARED:
        # убрать картинку-заглушку IKEA и её паспарту: непрозрачные грани за стеклом в его прямоугольнике
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(me)
        doomed = []
        for f in bm.faces:
            c = CI @ f.calc_center_median()
            if (f.material_index not in glass and c[2] < gmn[2] + 1e-4 and gmn[0] + 0.004 < c[0] < gmx[0] - 0.004
                    and gmn[1] + 0.004 < c[1] < gmx[1] - 0.004):
                doomed.append(f)
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(me)
        bm.free()
        _T[frame] = (obj, gl_verts(me))
        CLEARED.add(frame)
    key = f"{art}-{fmt}"
    USED[art] += 1
    if key not in ART_MATS:
        im = bpy.data.images.load(os.path.join(TMP, "prints", key + ".jpg"))
        if max(im.size) > 1024:
            k = 1024 / max(im.size)
            im.scale(int(im.size[0] * k), int(im.size[1] * k))
        ART_MATS[key] = mat_tex("print_" + key, im, 0.85)
    w, h = gmx[0] - gmn[0] - 0.002, gmx[1] - gmn[1] - 0.002
    me2 = bpy.data.meshes.new("print_" + key)
    zc = gmn[2] - 0.001
    cx, cy = (gmn[0] + gmx[0]) / 2, (gmn[1] + gmx[1]) / 2
    verts = [(cx - w / 2, cy - h / 2, zc), (cx + w / 2, cy - h / 2, zc), (cx + w / 2, cy + h / 2, zc), (cx - w / 2, cy + h / 2, zc)]
    me2.from_pydata([C.to_3x3() @ Vector(v) for v in verts], [], [(0, 1, 2, 3)])
    uv = me2.uv_layers.new()
    for i, (u, vv) in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = (u, vv)
    me2.materials.append(ART_MATS[key])
    me2.update()
    paper = bpy.data.objects.new("print_" + key, me2)
    TPL.objects.link(paper)
    _T[key + "_plane"] = (paper, gl_verts(me2))
    # рамка и отпечаток двигаются вместе: тот же поворот, сдвиг по габариту рамки
    fr = put(frame, rots, **align)
    pl = paper.copy()
    EXP.objects.link(pl)
    pl.matrix_world = fr.matrix_world.copy()
    return [fr, pl]


# ---------- рецепты ----------

def lean(src, deg=12, **align):
    """Плоская вещь (тарелка, доска), поставленная на ребро и прислонённая к стене сзади (−Z)."""
    return put(src, [("x", 90 - deg)], **align)


def utensil_up(src, ry=0, tilt=(0, 0), x=0.0, z=0.0, y0=0.02, down=False):
    """Кухонная утварь вертикально: рабочей частью вверх (в держателе) или вниз (down — висит на крючке)."""
    mn, mx = bbox_of(src)
    lying = (mx[1] - mn[1]) < 0.5 * max(mx[0] - mn[0], mx[2] - mn[2])
    if lying:   # лежит длиной по X: развернуть торцом вверх
        s = head_sign(src, 0) * (-1 if down else 1)
        rots = [("z", 90 * s), ("y", 90)]
    else:       # уже стоит длиной по Y
        s = head_sign(src, 1)
        rots = [] if (s > 0) != down else [("x", 180)]
    rots = rots + [("y", ry), ("x", tilt[0]), ("z", tilt[1])]
    return put(src, rots, x=x, y0=y0, z=z)


def r_plates_lean():
    return [lean("silversida-plate", 12, x=-0.035, z0=0.0),
            lean("krustistel-plate", 13, x=0.045, z0=0.03),
            lean("daggaster-plate", 14, x=-0.005, z0=0.058)]


def r_plates_stack():
    out = [put("godmiddag-plate", [("y", i * 37)], y0=i * 0.011) for i in range(4)]
    return out + [put("krustistel-plate", [("y", 20)], y0=0.046)]


def r_bowls_stack():
    return [put("godmiddag-bowl", y0=0.0), put("godmiddag-bowl", [("y", 50)], y0=0.021),
            put("fargklar-bowl", y0=0.043)]


def r_mugs():
    return [put("daggaster-mug", [("y", 35)], x=-0.07), put("fargklar-mug", [("y", -25)], x=0.068, z=0.01)]


def r_jars():
    return (jar_with_fill("korken-jar-1l", "pasta", 0.62, x=-0.09, ry=15)
            + jar_with_fill("korken-jar-05l", "lentils", 0.55, x=0.05, z=-0.02, ry=-10)
            + jar_with_fill("korken-jar-05l", "rice", 0.6, x=0.17, z=0.01, ry=25))


def r_bottles():
    return (jar_with_fill("korken-bottle-1l", "oil", 0.62, x=-0.03, ry=10)
            + jar_with_fill("korken-bottle-04l", "vinegar", 0.55, x=0.07, z=0.02, ry=-20))


def r_boards():
    # длинная доска с ручкой стоит ручкой вверх: узкий конец по X уходит вверх
    turn = -90 if head_sign("artistisk-board", 0) > 0 else 90
    return [put("artistisk-board", [("y", turn), ("x", 81)], x=0.03, z0=0.0),
            lean("norrsjon-board", 13, x=-0.03, z0=0.02),
            lean("smaata-board", 16, x=0.09, z0=0.05)]


def r_crock():
    out = [put("brugdhaj-crock")]
    for src, ry, tilt, x, z in (("knorrhane-turner", 20, (-9, 6), -0.018, 0.015),
                                ("knorrhane-spoon", -40, (8, 7), 0.02, -0.012),
                                ("knorrhane-slotted", 70, (-6, -9), 0.015, 0.02),
                                ("hjalte-ladle", 160, (10, -5), -0.02, -0.018)):
        out.append(utensil_up(src, ry, tilt, x, z, y0=0.012))
    return out


def r_coffee():
    return ([put("press-365", [("y", 20)], x=-0.085, z=-0.03), put("daggaster-mug", [("y", -50)], x=0.07, z=0.075)]
            + jar_with_fill("korken-jar-05l", "coffee", 0.6, x=0.08, z=-0.05, ry=10))


def r_fruit():
    bowl = put("stockholm-bowl-34")
    B = inst_verts(bowl)
    rad = np.hypot(B[:, 0], B[:, 2])

    def surface(r):   # высота внутренней поверхности чаши на радиусе r (верх стенки там же)
        m = abs(rad - r) < 0.008
        return float(B[m, 1].max()) if m.any() else 0.01

    def fruit(src, x, z, ry=0):
        mn, mx = bbox_of(src)
        rots = [("x", 90)] if (mx[1] - mn[1]) > 1.15 * max(mx[0] - mn[0], mx[2] - mn[2]) else []
        return put(src, rots + [("y", ry)], x=x, y0=surface(math.hypot(x, z)) - 0.002, z=z)
    out = [bowl, fruit("pomegranate", -0.005, 0.0, 30)]
    for i, src in enumerate(["apple", "lemon", "apple", "lime", "lemon", "apple"]):
        a = math.radians(15 + i * 60)
        out.append(fruit(src, 0.106 * math.cos(a), 0.106 * math.sin(a), i * 47))
    return out


def r_eucalyptus():
    out = [put("parlhagg-vase-22")]
    _, V = tpl("smycka-eucalyptus")
    low = V[V[:, 1] < V[:, 1].min() + 0.01]
    base = [float(low[:, 0].mean()), float(V[:, 1].min()), float(low[:, 2].mean())]
    neck = 0.17      # стебель проходит через центр горлышка вазы: поворот вокруг точки на этой высоте
    for i, (ry, tilt) in enumerate(((0, 11), (125, 14), (245, 9))):
        out.append(put("smycka-eucalyptus", [("y", ry * 0.5 + 30), ("x", -tilt), ("y", ry)],
                       pivot=[base[0], base[1] + neck, base[2]], at=(0.0, 0.03 + neck, 0.0)))
    return out


def r_single(key):
    return lambda: [put(key)]


def r_frame(frame, art, fmt):
    return lambda: framed(frame, art, fmt)


USED = Counter()  # ключи products.json -> сколько штук в текущей модели (SOURCE.md, цена опции)
EXTRA = {}   # дополнительные поля отчёта для compose.py (высота перекладины рейлинга)


def hook_on(hook, x, yb, rb, zb):
    """Крючок на перекладину (центр yb, zb, радиус rb): верхняя дуга обнимает её. Возвращает (крючок, точка подвеса)."""
    h = put(hook, x=x, y1=yb + rb + 0.004, z=zb)
    H = inst_verts(h)
    hh = H[:, 1].max() - H[:, 1].min()
    move(h, (0, 0, zb - float(H[H[:, 1] > H[:, 1].max() - 0.18 * hh][:, 2].mean())))
    H = inst_verts(h)
    bot = H[H[:, 1] < H[:, 1].min() + 0.18 * hh]
    return h, (x, float(H[:, 1].min()) + 0.012, float(bot[:, 2].mean()))


def rail_on_wall(rail):
    """Рейлинг стеной в −Z, поднят на 0.6 (под ним висит утварь). -> (объект, y и z центра перекладины, радиус)."""
    from mathutils.bvhtree import BVHTree
    o = put(rail, y0=0.6, z0=0.0)
    W = inst_verts(o)
    bvh = BVHTree.FromPolygons([Vector(v) for v in W], [tuple(p.vertices) for p in o.data.polygons])
    # сечение посередине длины (там только перекладина): лучи сверху и снизу по сетке Z
    hits = []
    for z in np.linspace(W[:, 2].min(), W[:, 2].max(), 60):
        for y0, d in ((2.0, (0, -1, 0)), (-1.0, (0, 1, 0))):
            loc = bvh.ray_cast(Vector((0.0, y0, z)), Vector(d))[0]
            if loc is not None:
                hits.append((loc[1], z))
    hy, hz = np.array([h[0] for h in hits]), np.array([h[1] for h in hits])
    rb = float(hy.max() - hy.min()) / 2
    return o, float(hy.min()) + rb, float((hz.min() + hz.max()) / 2), rb


def r_rail(rail, hook, items):
    def build():
        r, yb, zb, rb = rail_on_wall(rail)
        out, wall = [r], float(inst_verts(r)[:, 2].min())
        for x, src, ry in items:
            h, (hx, hy, hz) = hook_on(hook, x, yb, rb, zb)
            o = utensil_up(src, ry, (0, 0), hx, hz, y0=0.0, down=True)
            W = inst_verts(o)
            # не глубже основания рейлинга: висящая вещь упирается в стену и отходит вперёд
            move(o, (0, hy - float(W[:, 1].max()), max(0.0, wall - float(W[:, 2].min()))))
            out += [h, o]
        EXTRA["bar"] = yb
        return out
    return build


def r_grunka_rail():
    r, yb, zb, rb = rail_on_wall("hultarp-rail-60")
    out = [r]
    _, V = tpl("grunka-4")
    xs = np.sort(V[V[:, 1] > V[:, 1].max() - 0.04][:, 0])
    cx = [float(g.mean()) for g in np.split(xs, np.where(np.diff(xs) > 0.02)[0] + 1)]
    hang = None
    for x in cx:
        h, hang = hook_on("hultarp-hook", x, yb, rb, zb)
        out.append(h)
    g = put("grunka-4", x=0.0, z=hang[2], y0=0.0)
    move(g, (0, hang[1] - float(inst_verts(g)[:, 1].max()), 0))
    EXTRA["bar"] = yb
    return out + [g]


def r_ledge():
    out = [put("mosslanda-55-oak")]
    y = tops(out, 0.005)[0][0]          # самая большая горизонталь — дно полочки
    mn, mx = bbox_of("mosslanda-55-oak")
    wall = mn[2]
    out += framed("hackhagtorn-30x40-pine", "pomological-lemon", "30x40", [("x", -7)], x=-0.12, y0=y, z0=wall + 0.004)
    out += framed("rodalm-21x30-white", "lear-minspysia", "21x30", [("x", -6)], x=0.06, y0=y, z0=wall + 0.03)
    out += framed("lomviken-21x30-black", "lear-dinnerbell", "21x30", [("x", -7)], x=0.19, y0=y, z0=wall + 0.006)
    return out


RECIPES = {
    # dest, id: рецепт
    ("kitchen", "tranhult-sandshult-120"): r_single("tranhult-sandshult-120"),
    ("kitchen", "bergshult-sandshult-120"): r_single("bergshult-sandshult-120"),
    ("kitchen", "lack-110"): r_single("lack-110"),
    ("kitchen", "kungsfors-shelves-60"): r_single("kungsfors-shelves-60"),
    ("kitchen", "ravsten"): r_single("ravsten-stool"),
    ("kitchen", "rosentorp"): r_single("rosentorp-stool"),
    ("kitchen", "bergmund"): r_single("bergmund-stool"),
    ("kitchen", "skogsta"): r_single("skogsta-stool"),
    ("kitchen", "rail-kungsfors-utensils"): r_rail("kungsfors-rail-56", "kungsfors-s-hook",
                                                  [(-0.2, "knorrhane-slotted", 0), (-0.07, "hjalte-ladle", 90),
                                                   (0.06, "knorrhane-turner", 0), (0.19, "knorrhane-spoon", 0)]),
    ("kitchen", "rail-hultarp-grunka"): r_grunka_rail,
    ("kitchen", "ledge-mosslanda-prints"): r_ledge,
    ("props", "plates-lean-silversida"): r_plates_lean,
    ("props", "plates-stack-godmiddag"): r_plates_stack,
    ("props", "bowls-stack-godmiddag"): r_bowls_stack,
    ("props", "mugs-daggaster-fargklar"): r_mugs,
    ("props", "jars-korken-pantry"): r_jars,
    ("props", "bottles-korken-oil"): r_bottles,
    ("props", "boards-lean-oak-acacia"): r_boards,
    ("props", "crock-brugdhaj-utensils"): r_crock,
    ("props", "kettle-vattentat"): r_single("vattentat-kettle"),
    ("props", "coffee-press-set"): r_coffee,
    ("props", "fruit-bowl-stockholm"): r_fruit,
    ("props", "vase-parlhagg-eucalyptus"): r_eucalyptus,
    ("props", "vase-kallarhals"): r_single("kallarhals-vase-26"),
    ("props", "vase-pelarbjork-white"): r_single("pelarbjork-vase-14"),
    ("props", "frame-rodalm-oak-lear-minspysia"): r_frame("rodalm-21x30-oak", "lear-minspysia", "21x30"),
    ("props", "frame-lomviken-lear-dinnerbell"): r_frame("lomviken-21x30-black", "lear-dinnerbell", "21x30"),
    ("props", "frame-rodalm-walnut-lemon"): r_frame("rodalm-30x40-walnut", "pomological-lemon", "30x40"),
    ("props", "frame-rodalm-black-lear-lobster"): r_frame("rodalm-30x40-black", "lear-lobster", "30x40"),
}

# ---------- сборка и экспорт ----------

report_path = os.path.join(HERE, "assets.json")     # габариты для compose.py (маленький, хранится в репозитории)
report = json.load(open(report_path)) if os.path.exists(report_path) else {}
for (dest, aid), recipe in RECIPES.items():
    if ONLY and aid not in ONLY:
        continue
    for o in list(EXP.objects):
        bpy.data.objects.remove(o)
    EXTRA.clear()
    USED.clear()
    objs = recipe()
    mn, mx = world_bbox(objs)
    y_low = float(mn[1])
    shift = Matrix.Translation((-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2))
    for o in objs:
        o.matrix_world = C @ shift @ CI @ o.matrix_world
    mn, mx = world_bbox(objs)
    os.makedirs(os.path.join(TMP, "out", dest), exist_ok=True)
    out = os.path.join(TMP, "out", dest, aid + ".glb")
    for o in SC.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_image_format="WEBP",
                              export_image_quality=85, export_apply=True, export_animations=False, export_extras=False,
                              export_cameras=False, export_lights=False, export_yup=True)
    rec = {"dest": dest, "size": [round(float(v), 3) for v in mx - mn],
           "tris": sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs), "sources": dict(sorted(USED.items()))}
    rec["tops"] = [t for t in tops(objs, 0.02)][:4]
    if dest == "kitchen":
        # опоры у самого низа модели (кронштейны полок, ножки): центры по X — чтобы не ставить под них высокое
        W = np.concatenate([inst_verts(o) for o in objs])
        xs = np.sort(W[W[:, 1] < 0.02][:, 0])
        rec["legs"] = [round(float(g.mean()), 3) for g in np.split(xs, np.where(np.diff(xs) > 0.03)[0] + 1) if len(g)]
    if "bar" in EXTRA:
        rec["bar"] = round(EXTRA["bar"] - y_low, 3)      # высота перекладины над низом модели
    report[aid] = rec
    print("BUILT", aid, json.dumps(rec), flush=True)
json.dump(report, open(report_path, "w"), indent=1)
