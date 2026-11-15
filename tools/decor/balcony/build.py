# Модели балкона в Blender (headless). Вход — <tmp> после fetch.py (AR-модели IKEA в <tmp>/raw) и make_tex.py (<tmp>/tex).
#   blender -b --python tools/decor/balcony/build.py -- <tmp> [id …]
# Выход: <tmp>/out/{balcony,props}/<id>.glb и tools/decor/balcony/assets.json: габарит [Ш, В, Г] (оси glTF, перед +Z),
# треугольники, у мест для сидения seat = высота сиденья, seatFront/backFront — где кромка сиденья и лицо спинки
# (glTF z от центра следа), у шкуры — edge (где у неё кромка сиденья), у гирлянды на поручне — axisY (ось поручня),
# чтобы compose.py ставил текстиль и свет точно на мебель и ограждение.
# Порядок всего конвейера: fetch.py → make_tex.py → build.py → pack.py → compose.py (каталог и миниатюры опций) → sources.py.
#
# Каждая модель собирается в чистой сцене: сырьё IKEA приводится к контракту (метры, низ 0, центр следа 0, перед +Z),
# лишние карты (металл/шероховатость/нормали/AO) снимаются — остаётся только цвет (≤ 512, крупное ≤ 1024):
# меньше памяти GPU и те же варианты шейдеров, что у остальной обстановки. Своё (настил RUNNEN, гирлянды, ёлки, лаванда,
# ветки, подушки, плед, свечи) — процедурное по размерам с карточек товаров (products.json → made).
# Внутри Blender: X вправо, Y назад (перед модели = −Y = glTF +Z), Z вверх.
import bpy, bmesh, json, math, os, random, sys
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:]
TMP, ONLY = os.path.abspath(ARGS[0]), set(ARGS[1:])
HERE = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(HERE, "products.json")))
IK = {x["key"]: x for x in P["ikea"]}
ASSETS_PATH = os.path.join(HERE, "assets.json")
ASSETS = json.load(open(ASSETS_PATH)) if os.path.exists(ASSETS_PATH) else {}
WARM = (1.0, 0.68, 0.36)          # тёплый свет лампочек и свечей (2200–2700 K)


# ---------- сцена и сырьё ----------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.name = name
    return ob


def bbox(objs):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    return (Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)]))


def to_origin(objs):
    """Центр следа в 0, низ в 0 (всё вместе)."""
    mn, mx = bbox(objs)
    d = Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))
    for o in objs:
        o.location += d
    bpy.context.view_layer.update()
    return d


def tris(objs):
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)


def simplify(ob, max_tex=512, rough=0.8, metal=0.0):
    """Оставить только цвет (и альфу стекла): снять металл/шероховатость/нормали/AO, ужать текстуры."""
    for slot in ob.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        nt = m.node_tree
        for n in nt.nodes:
            if n.type == "GROUP":                       # glTF Material Output (occlusion)
                for i in n.inputs:
                    for l in list(i.links):
                        nt.links.remove(l)
        b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not b:
            continue
        for name in ("Metallic", "Roughness", "Normal"):
            for l in list(b.inputs[name].links):
                nt.links.remove(l)
        glass = b.inputs["Alpha"].is_linked or b.inputs["Alpha"].default_value < 0.5
        b.inputs["Metallic"].default_value = 0.0 if glass else metal
        b.inputs["Roughness"].default_value = 0.08 if glass else rough
    for img in bpy.data.images:
        if img.size[0] > max_tex or img.size[1] > max_tex:
            k = max_tex / max(img.size[0], img.size[1])
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))


def load(key, max_tex=512, rough=0.8, metal=0.0, rot=None):
    """Сырая модель IKEA -> один объект в контракте (перед −Y Blender), прорежена до maxTris."""
    it = IK[key]
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(TMP, "raw", it["article"].replace(".", "") + ".glb"))
    new = [o for o in bpy.context.scene.objects if o not in before]
    extra = [o.name for o in new if o.type != "MESH"]
    ob = join([o for o in new if o.type == "MESH"], key)
    for n in extra:                                               # пустышки и узлы иерархии из файла
        if n in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[n])
    if rot:
        ob.data.transform(Matrix.Rotation(math.radians(rot), 4, "Z"))
    to_origin([ob])
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    n = tris([ob])
    if n > it.get("maxTris", 8000):
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.ratio = it["maxTris"] / n
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier="dec")
    simplify(ob, max_tex, rough, metal)
    return ob


def hit(x, y, z0=3.0, objs=None):
    """Высота поверхности под точкой (x, y) — луч сверху вниз; objs — только по этим объектам."""
    dg = bpy.context.evaluated_depsgraph_get()
    o = Vector((x, y, z0))
    while True:
        ok, loc, _n, _i, ob, _m = bpy.context.scene.ray_cast(dg, o, Vector((0, 0, -1)))
        if not ok:
            return None
        if objs is None or ob in objs:
            return loc.z
        o = loc - Vector((0, 0, 1e-4))


def surface(objs, x, y, r=0.04):
    """Верх сиденья у точки: максимум по сетке лучей ±r (сиденья из реек пропускают отдельный луч)."""
    hs = [hit(x + dx * r / 2, y + dy * r / 2, objs=objs) for dx in range(-2, 3) for dy in range(-2, 3)]
    hs = [h for h in hs if h is not None]
    return max(hs) if hs else None


def sit_on(c, top, x, y):
    """Подушку c — телом на высоту top в (x, y): низ тела ищется лучом снизу (завязки свисают ниже тела)."""
    dg = bpy.context.evaluated_depsgraph_get()
    c.location = (0, 0, 0)
    bpy.context.view_layer.update()
    ok, loc, *_ = bpy.context.scene.ray_cast(dg, Vector((0, 0, -1)), Vector((0, 0, 1)))
    c.location = (x, y, top - (loc.z if ok else 0.0) - 0.004)
    bpy.context.view_layer.update()


def front_y(objs, x, z, y0=-2.0):
    """Где перед (наименьший Blender Y) у объектов на высоте z — луч спереди назад."""
    dg = bpy.context.evaluated_depsgraph_get()
    ok, loc, *_ = bpy.context.scene.ray_cast(dg, Vector((x, y0, z)), Vector((0, 1, 0)))
    return loc.y if ok else None


# ---------- свои материалы и геометрия ----------

def mat(name, color, rough=0.8, metal=0.0, emit=None, strength=0.0, tex=None, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    if tex:
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(os.path.join(TMP, "tex", tex))
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    return m


def new_obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def box(name, sx, sy, sz, material, loc=(0, 0, 0), bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    ob = new_obj(name, bm, material)
    if bevel:
        mod = ob.modifiers.new("bev", "BEVEL")
        mod.width, mod.segments = bevel, 2
        apply_mods(ob)
    return ob


def cyl(name, r, h, material, loc=(0, 0, 0), seg=12, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=Vector(loc) + Vector((0, 0, h / 2)), verts=bm.verts)
    return new_obj(name, bm, material)


def sphere(name, r, material, loc, seg=8, ring=6, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return new_obj(name, bm, material)


def tube(name, pts, r, material, seg=5):
    """Тонкая трубка по точкам (кабель, стебель, ствол ветки)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (*q, 1)
    cu.bevel_depth, cu.bevel_resolution = r, max(0, (seg - 4) // 2)
    cu.use_fill_caps = True
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(material)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


def blade(name, p0, p1, w0, w1, th, material, up=Vector((0, 0, 1))):
    """Сужающаяся плоская лопасть от p0 к p1 (ветка ели, лист, иголка): 8 вершин, 12 треугольников."""
    d = (p1 - p0).normalized()
    s = d.cross(up)
    if s.length < 1e-4:
        s = d.cross(Vector((1, 0, 0)))
    s.normalize()
    n = s.cross(d).normalized()
    bm = bmesh.new()
    vs = [bm.verts.new(p + s * w * a + n * th * b) for p, w in ((p0, w0), (p1, w1)) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    q = lambda *i: bm.faces.new([vs[k] for k in i])
    q(0, 1, 2, 3); q(7, 6, 5, 4); q(0, 4, 5, 1); q(1, 5, 6, 2); q(2, 6, 7, 3); q(3, 7, 4, 0)
    return new_obj(name, bm, material)


def apply_mods(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def uv_planar(ob, scale, axis="Z"):
    """UV = координаты в метрах / scale (повтор текстуры), проекция вдоль оси."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new()
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if axis == "Z":
                uv[li].uv = (co.x / scale, co.y / scale)
            elif axis == "Y":
                uv[li].uv = (co.x / scale, co.z / scale)
            else:
                uv[li].uv = (co.y / scale, co.z / scale)


# ---------- экспорт ----------

def merge(objs):
    """Свои мелкие детали одного материала — в один меш (один вызов отрисовки на материал)."""
    groups = {}
    for o in objs:
        k = o.data.materials[0].name if len(o.data.materials) == 1 else o.name
        groups.setdefault(k, []).append(o)
    return [join(g, g[0].name) if len(g) > 1 else g[0] for g in groups.values()]


def export(dest, aid, extra=None, objs=None):
    objs = merge(objs or meshes())
    to_origin(objs)
    for o in objs:
        o.select_set(True)
    out = os.path.join(TMP, "out", dest, aid + ".glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_image_format="WEBP",
                              export_image_quality=85, export_yup=True, export_apply=True, export_animations=False,
                              export_extras=False, export_cameras=False, export_lights=False)
    mn, mx = bbox(objs)
    rec = {"dest": dest, "size": [round(mx.x - mn.x, 3), round(mx.z - mn.z, 3), round(mx.y - mn.y, 3)], "tris": tris(objs)}
    rec.update(extra or {})
    ASSETS[aid] = rec
    print("BUILT", aid, json.dumps(rec), flush=True)


# ---------- рецепты: мебель IKEA ----------
# Кромки (glTF z): перед модели = −Blender Y, поэтому glTF z = −y.

def seat_info(objs, x=0.0):
    """Высота сиденья, его передняя кромка и лицо спинки (glTF z) по центральной линии x."""
    mn, mx = bbox(objs)
    top = surface(objs, x, (mn.y + mx.y) / 2 - 0.05)
    fy = min(f for f in (front_y(objs, x + dx, top - 0.02) for dx in (-0.05, 0, 0.05)) if f is not None)
    bys = [front_y(objs, x + dx, top + dz) for dx in (-0.08, -0.04, 0, 0.04, 0.08) for dz in (0.1, 0.14, 0.18)]
    bys = [b for b in bys if b is not None and b > fy + 0.2]
    by = min(bys) if bys else None
    return {"seat": round(top, 3), "seatFront": round(-fy, 3), "backFront": round(-by, 3) if by is not None else None}


def r_nammaro_module():
    """Модуль дивана NÄMMARÖ: секция 63×63 + спинка 60×56 + подушки KUDDARNA (сиденье 62×62, спинка 62×44).
    По карточке дивана s19579307: Ш 126 (2 модуля), Г 74, В 70, сиденье без подушки 30 см."""
    seat = load("nammaro-seat-63", 512)
    back = load("nammaro-back-60", 512)
    cs = load("kuddarna-seat-62", 512, rough=0.95)
    cb = load("kuddarna-back-62", 512, rough=0.95)
    D, H = 0.74, 0.70
    back.location = (0, -0.315 + D - 0.062, H - back.dimensions.z)       # спинка за сиденьем: общая глубина 0,74
    bpy.context.view_layer.update()
    top = hit(0, 0, objs=[seat])
    cs.location = (0, -0.005, top)
    bpy.context.view_layer.update()
    ctop = hit(0, -0.1, objs=[cs])
    cb.rotation_euler = (math.radians(-13), 0, 0)
    bpy.context.view_layer.update()
    mn, mx = bbox([cb])
    bfront = back.location.y - 0.124 / 2
    cb.location = (0, bfront - mx.y - 0.005, ctop - 0.03 - mn.z)
    objs = [seat, back, cs, cb]
    to_origin(objs)
    export("balcony", "nammaro-module", seat_info(objs))


def r_nammaro_bench():
    """Ławka NÄMMARÖ z oparciem + 2 poduszki KUDDARNA 44×44."""
    b = load("nammaro-bench", 512)
    objs = [b]
    for x in (-0.25, 0.25):
        top = surface([b], x, -0.05)
        c = load("kuddarna-chair-44", 512, rough=0.95)
        sit_on(c, top, x, -0.03)
        objs.append(c)
    to_origin(objs)
    export("balcony", "nammaro-bench", seat_info(objs, 0.25))


def r_nammaro_armchair():
    a = load("nammaro-armchair", 512)
    top = surface([a], 0, -0.05)
    c = load("kuddarna-chair-44", 512, rough=0.95)
    sit_on(c, top, 0, -0.03)
    objs = [a, c]
    to_origin(objs)
    export("balcony", "nammaro-armchair", seat_info(objs))


def r_simple(key, aid, dest="balcony", max_tex=512, rough=0.8, metal=0.0, seat=False, rot=None, flat=None):
    ob = load(key, max_tex, rough, metal, rot)
    if flat:                                   # ковёр: AR-модель IKEA мятая, кладём ровно толщиной flat
        h = ob.dimensions.z
        if h > flat:
            ob.data.transform(Matrix.Diagonal(Vector((1, 1, flat / h, 1))))
    export(dest, aid, seat_info([ob]) if seat else {"top": round(hit(0, 0, objs=[ob]) or 0, 3)})


def candle(h, r, loc):
    """SMÅLOM — столбик LED: воск сливочный, «пламя» светится (emissive, без источника света)."""
    wax = mat("wax", (0.93, 0.89, 0.8), 0.6)
    fl = mat("flame", (1.0, 0.8, 0.5), 0.5, emit=WARM, strength=6.0)
    a = cyl("candle", r, h, wax, loc, seg=16)
    b = sphere("flame", r * 0.32, fl, (loc[0], loc[1], loc[2] + h + r * 0.35), seg=8, ring=6, scale=(1, 1, 1.9))
    return [a, b]


def r_lantern(key, aid, h, r):
    ob = load(key, 512, rough=0.45, metal=0.4)
    floor = hit(0, 0, z0=0.06, objs=[ob]) or 0.005
    export("props", aid, {"candle": [h, r]}, [ob, *candle(h, r, (0, 0, floor))])


# ---------- рецепты: свои модели ----------

def r_deck(aid, tex, rough, W, D):
    """RUNNEN: плиты 30×30 толщиной 2 см на всю площадь балкона (одна коробка, UV в метрах / 0,6 м)."""
    m = mat(aid, (1, 1, 1), rough, tex=tex)
    ob = box(aid, W, D, 0.02, m, (W / 2, D / 2, 0.01))
    uv_planar(ob, 0.6, "Z")
    export("balcony", aid, {"tile": 0.3})


def catenary(x0, x1, z, sag, n=16):
    return [(x0 + (x1 - x0) * t, 0.0, z - 4 * sag * t * (1 - t)) for t in (i / n for i in range(n + 1))]


def r_svartra():
    """SVARTRÅ: 12 матовых шаров на чёрных патронах через 40 см (4,4 м), провод провисает между крючками через 1,1 м."""
    black = mat("cable", (0.02, 0.02, 0.02), 0.5)
    glob = mat("bulb", (1.0, 0.93, 0.82), 0.3, emit=WARM, strength=5.0)
    L, top, sag = 4.4, 0.30, 0.10
    hooks = [-L / 2 + i * 1.1 for i in range(5)]
    pts = []
    for a, b in zip(hooks, hooks[1:]):
        pts += catenary(a, b, top, sag)[:-1]
    pts.append((hooks[-1], 0.0, top))
    objs = [tube("svartra-cable", pts, 0.003, black)]
    zat = lambda x: next(top - 4 * sag * t * (1 - t) for a, b in zip(hooks, hooks[1:]) if a - 1e-6 <= x <= b + 1e-6 for t in [(x - a) / (b - a)])
    for i in range(12):
        x = -L / 2 + 0.2 + i * 0.4 * (L - 0.4) / 4.4
        z = zat(x)
        objs.append(cyl(f"sock{i}", 0.017, 0.05, black, (x, 0, z - 0.055), seg=10))
        objs.append(sphere(f"bulb{i}", 0.03, glob, (x, 0, z - 0.085), seg=10, ring=8))
    for x in hooks:
        objs.append(cyl("hook", 0.006, 0.03, black, (x, 0, top), seg=6))
    export("balcony", "svartra-festoon", {"span": L}, objs)


def r_getkal(L=8.18):
    """GETKÅL: светодиоды через 10 см на тонком проводе, провод спиралью обвивает поручень (шаг 30 см)."""
    wire = mat("wire", (0.06, 0.06, 0.05), 0.5)
    led = mat("led", (1.0, 0.9, 0.7), 0.4, emit=WARM, strength=6.0)
    R = 0.032
    pts = []
    n = int(L / 0.02)
    for i in range(n + 1):
        x = -L / 2 + i * L / n
        a = x / 0.3 * 2 * math.pi
        pts.append((x, R * math.cos(a), R * math.sin(a)))
    objs = [tube("getkal-wire", pts, 0.0015, wire, seg=4)]
    for i in range(int(L / 0.1)):
        x = -L / 2 + 0.05 + i * 0.1
        a = x / 0.3 * 2 * math.pi
        objs.append(sphere(f"led{i}", 0.006, led, (x, (R + 0.004) * math.cos(a), (R + 0.004) * math.sin(a)), seg=6, ring=4))
    d = to_origin(objs)
    export("balcony", "getkal-railing", {"wrap": R, "axisY": round(d.z, 3)}, objs)


def fir(H, Rmax, base, seed, lights=0):
    """Ель VINTERFINT: ствол, ярусы плоских сужающихся ветвей с боковыми веточками (2 оттенка), огоньки STRÅLA."""
    rnd = random.Random(seed)
    trunk = mat("trunk", (0.25, 0.17, 0.1), 0.9)
    greens = [mat("fir-a", (0.06, 0.16, 0.08), 0.85), mat("fir-b", (0.09, 0.22, 0.11), 0.85)]
    objs = [cyl("trunk", 0.018 * H / 1.5 + 0.006, H - 0.04, trunk, (0, 0, 0), seg=8, r2=0.004)]
    tiers = int(10 + H * 4)
    for k in range(tiers):
        t = k / (tiers - 1)
        z = base + (H - base - 0.12) * t
        R = Rmax * (1 - t) ** 0.95 + 0.03
        nb = max(5, int(9 * (1 - t) + 4))
        for j in range(nb):
            az = 2 * math.pi * (j + rnd.random() * 0.6) / nb + k * 0.7
            d = Vector((math.cos(az), math.sin(az), 0))
            droop = -0.25 * R + rnd.uniform(-0.03, 0.03)
            p0 = Vector((0, 0, z))
            p1 = p0 + d * R + Vector((0, 0, droop + 0.06 * R))
            g = greens[rnd.random() < 0.5]
            objs.append(blade("br", p0, p1, 0.045 * (0.6 + R), 0.012, 0.01, g))
            for s in range(3):                                  # боковые веточки
                q = p0.lerp(p1, 0.35 + 0.2 * s)
                side = d.cross(Vector((0, 0, 1))) * (1 if s % 2 else -1)
                objs.append(blade("tw", q, q + (side * 0.6 + d * 0.5).normalized() * R * 0.35, 0.02, 0.006, 0.006, g))
    objs.append(blade("top", Vector((0, 0, H - 0.16)), Vector((0, 0, H)), 0.02, 0.003, 0.012, greens[1], up=Vector((1, 0, 0))))
    if lights:
        led = mat("strala", (1.0, 0.9, 0.7), 0.4, emit=WARM, strength=6.0)
        for i in range(lights):
            t = i / lights
            z = base + 0.05 + (H - base - 0.2) * t
            R = (Rmax * (1 - t) ** 0.95 + 0.03) * 0.85
            a = t * 2 * math.pi * 6.5
            objs.append(sphere(f"l{i}", 0.007, led, (R * math.cos(a), R * math.sin(a), z - 0.04 * R), seg=6, ring=4))
    return objs


def r_fir150():
    """VINTERFINT choinka 150 cm, Ø 51 (ствол без подставки: ставится в NYPON), огоньки STRÅLA mikro."""
    export("balcony", "vinterfint-fir-150", {}, fir(1.5, 0.25, 0.28, 150, lights=56))


def r_fir84():
    """VINTERFINT в горшке 15 см, растение 84 см: чёрный горшок + ель."""
    pot = mat("pot", (0.05, 0.05, 0.05), 0.6)
    objs = [cyl("pot", 0.075, 0.13, pot, (0, 0, 0), seg=16, r2=0.065)]
    for o in fir(0.84, 0.16, 0.18, 84):
        o.location.z += 0.1
        objs.append(o)
    export("props", "vinterfint-fir-84", {}, objs)


def r_pine():
    """VINTERFINT gałązka sosna 70 cm ×3 веером: коричневый стебель, пучки длинных хвоинок."""
    rnd = random.Random(3)
    stem = mat("stem", (0.32, 0.22, 0.13), 0.85)
    ndl = mat("needle", (0.12, 0.27, 0.15), 0.8)
    objs = []
    for s, ang in enumerate((-22, 0, 24)):
        a = math.radians(ang)
        top = Vector((math.sin(a) * 0.32, rnd.uniform(-0.05, 0.05), 0.62))
        pts = [Vector((0, 0, 0)).lerp(top, t) + Vector((0, 0, 0.03 * math.sin(t * 3))) for t in (i / 6 for i in range(7))]
        objs.append(tube(f"st{s}", [tuple(p) for p in pts], 0.004, stem))
        for k in range(10):
            c = pts[2].lerp(top, k / 9)
            br = c + Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.1, 0.1), rnd.uniform(0.0, 0.08)))
            objs.append(blade("tw", c, br, 0.004, 0.003, 0.003, stem))
            for n in range(26):                                 # пучок хвоинок 7–9 см
                d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.2, 1))).normalized()
                objs.append(blade("n", br, br + d * rnd.uniform(0.07, 0.09), 0.0018, 0.0008, 0.0012, ndl))
    export("props", "vinterfint-pine-bunch", {}, objs)


def r_lavender():
    """FEJKA lawenda: белый прямоугольный горшок 35 × 12 × 17 см, кустики листьев и колосья — всего 42 см."""
    rnd = random.Random(11)
    pot = mat("pot", (0.92, 0.92, 0.9), 0.5)
    leaf = mat("leaf", (0.36, 0.45, 0.36), 0.85)
    flw = mat("flower", (0.42, 0.33, 0.62), 0.8)
    objs = [box("pot", 0.35, 0.12, 0.17, pot, (0, 0, 0.085), bevel=0.006)]
    lv, st, fl = [], [], []
    for i in range(46):
        x, y = rnd.uniform(-0.15, 0.15), rnd.uniform(-0.04, 0.04)
        b = Vector((x, y, 0.16))
        tip = b + Vector((rnd.uniform(-0.06, 0.06), rnd.uniform(-0.04, 0.04), rnd.uniform(0.18, 0.24)))
        st.append(blade("st", b, tip, 0.0015, 0.0012, 0.0015, leaf))
        for k in range(5):                                       # колос: бусины по верхней трети
            q = b.lerp(tip, 0.72 + 0.06 * k)
            fl.append(sphere("f", 0.006, flw, tuple(q), seg=5, ring=4, scale=(1, 1, 1.8)))
        for k in range(3):                                       # узкие листья у основания
            d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 1.4)).normalized()
            lv.append(blade("lf", b, b + d * rnd.uniform(0.07, 0.11), 0.004, 0.001, 0.0015, leaf))
    export("props", "fejka-lavender", {}, objs + lv + st + fl)


def pillow(name, w, h, th, material, tilt=0.0, rep=0.1):
    """Подушка w×h: сетка, раздутая к центру, края прошиты; стоит на нижней кромке, наклон назад tilt°."""
    bm = bmesh.new()
    n = 12
    grid = {}
    for side in (-1, 1):
        for i in range(n + 1):
            for j in range(n + 1):
                u, v = i / n * 2 - 1, j / n * 2 - 1
                puff = th / 2 * (1 - abs(u) ** 3) * (1 - abs(v) ** 3)
                grid[side, i, j] = bm.verts.new((u * w / 2 * (1 - 0.04 * (1 - v * v)), side * (puff + 0.004), (v + 1) * h / 2))
    for side in (-1, 1):
        for i in range(n):
            for j in range(n):
                f = [grid[side, i, j], grid[side, i + 1, j], grid[side, i + 1, j + 1], grid[side, i, j + 1]]
                bm.faces.new(f if side > 0 else f[::-1])
    for i in range(n):                                            # шов по контуру
        for a, b in (((i, 0), (i + 1, 0)), ((n, i), (n, i + 1)), ((i + 1, n), (i, n)), ((0, i + 1), (0, i))):
            bm.faces.new([grid[-1, a[0], a[1]], grid[-1, b[0], b[1]], grid[1, b[0], b[1]], grid[1, a[0], a[1]]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_obj(name, bm, material)
    uv_planar(ob, rep, "Y")
    ob.data.transform(Matrix.Rotation(math.radians(-tilt), 4, "X"))
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def r_cushion():
    """TOFTÖ 50×50 ciemny szarozielony (с вкладышем INNER), прислонена к спинке под 16°."""
    m = mat("tofto", (1, 1, 1), 0.95, tex="knit-tofto.jpg")
    ob = pillow("tofto", 0.48, 0.46, 0.15, m, tilt=16)
    export("props", "cushion-tofto-50", {}, [ob])


def r_throw():
    """KLIPPOXEL 130×170, сложен вчетверо и ещё пополам: стопка 42 × 30 × 6 см с мягкими кромками."""
    m = mat("klippoxel", (1, 1, 1), 0.95, tex="knit-klippoxel.jpg")
    objs = []
    for k in range(3):
        o = box(f"l{k}", 0.42 - 0.01 * k, 0.30 - 0.006 * k, 0.02, m, (0.004 * k, 0.003 * k, 0.01 + 0.02 * k), bevel=0.008)
        uv_planar(o, 0.12, "Z")
        objs.append(o)
    export("props", "throw-klippoxel", {}, objs)


def r_sheepskin():
    """TOFTLUND 55×85 (imitacja skóry owczej, модель IKEA) накинут на сиденье и спинку: 6 см свисает с передней кромки,
    по сиденью — глубина сиденья модуля NÄMMARÖ (seatFront − backFront), остальное вверх по подушке спинки под 76°.
    edge — где передняя кромка сиденья (glTF z от центра следа, высота над низом модели): по ней compose.py ставит шкуру."""
    ob = load("toftlund", 512, rough=1.0)
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    y0, y1 = min(v.co.y for v in bm.verts), max(v.co.y for v in bm.verts)
    for k in range(1, int((y1 - y0) / 0.03)):                   # разрезы поперёк через 3 см — чтобы гнулась
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, y0 + 0.03 * k, 0), plane_no=(0, 1, 0))
    bm.to_mesh(me)
    bm.free()
    m = ASSETS.get("nammaro-module", {})
    over, ang = 0.06, math.radians(76)
    flat = (m["seatFront"] - m["backFront"]) if m.get("backFront") is not None else 0.44
    for v in me.vertices:
        s, th = v.co.y - y0, v.co.z
        if s < over:                                              # свес по передней кромке
            v.co.y, v.co.z = -0.012 * (1 - s / over) - th, -(over - s)
        elif s < over + flat:
            v.co.y, v.co.z = s - over, th
        else:
            r = s - over - flat
            v.co.y, v.co.z = flat + r * math.cos(ang) - th * math.sin(ang), r * math.sin(ang) + th * math.cos(ang)
    me.update()
    bpy.context.view_layer.update()
    d = to_origin([ob])                                           # кромка была в (y 0, z 0)
    export("props", "sheepskin-toftlund-drape", {"edge": [round(-d.y, 3), round(d.z, 3)], "flat": round(flat, 3)}, [ob])


RECIPES = {
    "nammaro-module": r_nammaro_module,
    "nammaro-bench": r_nammaro_bench,
    "nammaro-armchair": r_nammaro_armchair,
    "nammaro-stool": lambda: r_simple("nammaro-stool", "nammaro-stool"),
    "nammaro-table-75": lambda: r_simple("nammaro-table-75", "nammaro-table-75"),
    "tarno-table": lambda: r_simple("tarno-table", "tarno-table", rough=0.6),
    "tarno-chair": lambda: r_simple("tarno-chair", "tarno-chair", rough=0.6, seat=True),
    "asparen": lambda: r_simple("asparen", "asparen", rough=0.7),
    "nypon-32": lambda: r_simple("nypon-32", "nypon-32", rough=0.7),
    "morum-160": lambda: r_simple("morum-160", "morum-160", max_tex=1024, rough=0.95, flat=0.005),
    "lydersholm-160": lambda: r_simple("lydersholm-160", "lydersholm-160", max_tex=1024, rough=0.95, flat=0.005),
    "lattbetong-160": lambda: r_simple("lattbetong-160", "lattbetong-160", max_tex=1024, rough=0.95, flat=0.005),
    "lantern-borrby-28": lambda: r_lantern("borrby-28", "lantern-borrby-28", 0.14, 0.037),
    "lantern-borrby-20": lambda: r_lantern("borrby-20", "lantern-borrby-20", 0.09, 0.03),
    "lantern-berggran-34": lambda: r_lantern("berggran-34", "lantern-berggran-34", 0.19, 0.037),
    "runnen-akacja": lambda: r_deck("runnen-akacja", "runnen-akacja.jpg", 0.75, 8.149, 1.851),
    "runnen-trawa": lambda: r_deck("runnen-trawa", "runnen-trawa.jpg", 0.95, 8.149, 1.851),
    "svartra-festoon": r_svartra,
    "getkal-railing": r_getkal,
    "vinterfint-fir-150": r_fir150,
    "vinterfint-fir-84": r_fir84,
    "vinterfint-pine-bunch": r_pine,
    "fejka-lavender": r_lavender,
    "cushion-tofto-50": r_cushion,
    "throw-klippoxel": r_throw,
    "sheepskin-toftlund-drape": r_sheepskin,
}

for aid, fn in RECIPES.items():
    if ONLY and aid not in ONLY:
        continue
    reset()
    fn()
json.dump(dict(sorted(ASSETS.items())), open(ASSETS_PATH, "w"), indent=1)
print("ASSETS", ASSETS_PATH)
