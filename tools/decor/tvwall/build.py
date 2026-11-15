# Стена с ТВ (зона tvwall): фигурки и мелочи на тумбу, рамки IKEA с картинами, полка MOSSLANDA.
# blender -b --python tools/decor/tvwall/build.py -- <src> <out> [id …]
#   src: ph/<id>/*.gltf (Poly Haven CC0, tools/decor/living/fetch_polyhaven.py <src>/ph 1k …),
#        raw/<артикул>.glb (IKEA, tools/decor/fetch_ikea.py get), artc/<id>.jpg (prep_art.py)
#   out: out/props/<id>.glb (реквизит, общий для зон), out/tvwall/<id>.glb (рамки и полка);
#   габариты и высота полки MOSSLANDA пишутся в tools/decor/tvwall/sizes.json (по ним раскладывает compose.py)
# Дальше: python3 tools/decor/living/pack.py <out>/props web/models/decor/props  (webp + meshopt + thumb.jpg)
#         python3 tools/decor/living/pack.py <out>/tvwall web/models/decor/tvwall
# Контракт GLB: метры, низ Y = 0, центр следа в 0, перед +Z (glTF) = −Y в Blender. Свои фигурки — процедурные,
# без отсылок к чужим персонажам.
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT, ONLY = args[0], args[1], set(args[2:])
REPORT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sizes.json")
REPORT = json.load(open(REPORT_PATH)) if os.path.exists(REPORT_PATH) else {}


# ---------- общее ----------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def join_all(name, objs=None):
    """Склеить меши в один объект (по умолчанию все в сцене), трансформации применены."""
    objs = objs or meshes()
    keep = set(meshes()) - set(objs)
    for o in bpy.context.scene.objects:
        o.select_set(False)
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
    for o in list(bpy.context.scene.objects):
        if o != ob and o not in keep:
            bpy.data.objects.remove(o)
    ob.name = ob.data.name = name
    if ob.data.shape_keys:              # с ключами формы экспорт берёт ключи, а не правленые вершины
        bpy.context.view_layer.objects.active = ob
        ob.shape_key_clear()
    return ob


def bbox(ob):
    co = np.array([v.co[:] for v in ob.data.vertices])
    return co.min(0), co.max(0)


def settle(ob, yaw=0.0, height=None, scale=None, tilt=0.0):
    """Поворот (yaw — вокруг вертикали, град.; tilt — наклон вокруг X), масштаб, низ на 0, центр следа в 0."""
    me = ob.data
    if yaw:
        me.transform(Matrix.Rotation(math.radians(yaw), 4, "Z"))
    if tilt:
        me.transform(Matrix.Rotation(math.radians(tilt), 4, "X"))
    mn, mx = bbox(ob)
    s = scale or (height / (mx[2] - mn[2]) if height else 1.0)
    me.transform(Matrix.Scale(s, 4))
    mn, mx = bbox(ob)
    me.transform(Matrix.Translation(Vector((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]))))
    me.update()
    return s


TEX_MAX = {"props": 512, "tvwall": 1024}   # фигурки 5–20 см: 512 хватает; картинам — до 1024


def export(ob, kind, pid, extra=None):
    os.makedirs(os.path.join(OUT, kind), exist_ok=True)
    cap = TEX_MAX[kind]
    for img in bpy.data.images:
        if img.size[0] > cap or img.size[1] > cap:
            k = cap / max(img.size[:])
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
    path = os.path.join(OUT, kind, pid + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_image_format="JPEG", export_image_quality=88,
                              export_yup=True, export_apply=True, export_animations=False, export_extras=False,
                              export_cameras=False, export_lights=False)
    mn, mx = bbox(ob)
    rec = {"kind": kind, "W": round(float(mx[0] - mn[0]), 4), "H": round(float(mx[2] - mn[2]), 4),
           "D": round(float(mx[1] - mn[1]), 4), "tris": sum(len(p.vertices) - 2 for p in ob.data.polygons)}
    rec.update(extra or {})
    REPORT[pid] = rec
    print("BUILT", pid, json.dumps(rec), flush=True)


def mat(name, color, rough=0.6, metal=0.0, img=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if img is not None:
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        t.image = img
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
    return m


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def noise_image(name, base, var, n=256, seed=1, blobs=6):
    """Шумовая текстура камня/воска: несколько октав value-noise вокруг цвета base (hex), разброс var."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((n, n))
    t = np.linspace(0, 1, n, endpoint=False)
    for o in range(blobs):
        g = 2 ** (o + 2)
        small = rng.random((g + 1, g + 1))
        small[-1], small[:, -1] = small[0], small[:, 0]          # бесшовно по краям
        i = t * g
        i0 = np.floor(i).astype(int); f = (i - i0)[None, :]
        rows = small[:, i0] * (1 - f) + small[:, i0 + 1] * f   # билинейно: сначала по X
        fz = (i - i0)[:, None]
        big = rows[i0, :] * (1 - fz) + rows[i0 + 1, :] * fz
        acc += big * 0.5 ** o
    acc = (acc - acc.min()) / (acc.max() - acc.min()) - 0.5
    rgb = np.array([int(base[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    px = np.clip(rgb[None, None, :] + acc[..., None] * var, 0, 1)
    img = bpy.data.images.new(name, n, n)
    img.pixels = np.concatenate([px, np.ones((n, n, 1))], axis=2).reshape(-1).tolist()
    img.pack()
    return img


def prim(kind, m, loc=(0, 0, 0), size=(1, 1, 1), rot=(0, 0, 0), seg=32, bevel=0.0):
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=0.5, depth=1)
    elif kind == "sph":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=0.5)
    ob = bpy.context.active_object
    ob.scale = size
    ob.rotation_euler = [math.radians(a) for a in rot]
    ob.location = loc
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if kind in ("cyl", "sph"):
        bpy.ops.object.shade_smooth()
    if bevel:
        md = ob.modifiers.new("b", "BEVEL")
        md.width, md.segments, md.limit_method = bevel, 3, "ANGLE"
        bpy.ops.object.modifier_apply(modifier="b")
    ob.data.materials.append(m)
    uv_box(ob)
    return ob


def taper(ob, top_scale):
    """Сужение по высоте (для горшков): верх ×top_scale относительно низа."""
    mn, mx = bbox(ob)
    for v in ob.data.vertices:
        t = (v.co.z - mn[2]) / (mx[2] - mn[2])
        k = 1 + (top_scale - 1) * t
        v.co.x *= k
        v.co.y *= k
    return ob


def uv_box(ob):
    """Кубическая развёртка в метрах ×4 (шум ложится без швов-растяжек)."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new()
    uv = me.uv_layers.active.data
    for p in me.polygons:
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            a, b = [(1, 2), (0, 2), (0, 1)][ax]
            uv[li].uv = (co[a] * 4, co[b] * 4)


# ---------- реквизит Poly Haven (CC0) ----------
# id: (папка Poly Haven, yaw град. (перед модели -> -Y Blender = +Z glTF), высота м или None — масштаб файла)
PH = {
    "fig-rubber-duck":      ("rubber_duck_toy", 0, 0.085),
    "fig-wooden-elephant":  ("carved_wooden_elephant", 0, None),
    "fig-concrete-cat":     ("concrete_cat_statue", 0, 0.13),
    "fig-garden-gnome":     ("garden_gnome", 0, 0.14),
    "fig-porcelain-horse":  ("horse_statue_01", 0, 0.15),
    "camera-vintage":       ("Camera_01", 0, None),
    "fig-bronze-whale":     ("bronze_whale_statue", 90, 0.12),
    "plant-haworthia-mini": ("potted_plant_04", 0, 0.15),
    "clock-alarm-retro":    ("alarm_clock_01", 0, 0.12),
    "shell-lambis":         ("lambis_shell", 0, None),
    "bust-marble-mini":     ("marble_bust_01", 0, 0.15),
}


def web_safe(ob):
    """Простые материалы для веба: без стекла, пропускания и спекуляр/IOR-расширений (иначе в three
    MeshPhysicalMaterial, лишний проход рендера и свои шейдеры). Стекло (имя *glass* или прозрачный BLEND —
    купол будильника, стекло рамки под картиной) убирается гранями."""
    me = ob.data
    glass = {i for i, m in enumerate(me.materials)
             if m and ("glass" in m.name.lower() or getattr(m, "surface_render_method", "") == "BLENDED")}
    if glass:
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in glass], context="FACES")
        bm.to_mesh(me); bm.free()
    for m in me.materials:
        b = m.node_tree.nodes.get("Principled BSDF") if m and m.use_nodes else None
        if not b:
            continue
        if b.inputs["Transmission Weight"].default_value > 0:
            b.inputs["Transmission Weight"].default_value = 0.0
            b.inputs["Roughness"].default_value = min(b.inputs["Roughness"].default_value, 0.15)
        b.inputs["IOR"].default_value = 1.5
        b.inputs["Specular IOR Level"].default_value = 0.5
        b.inputs["Specular Tint"].default_value = (1, 1, 1, 1)
        for k in ("Specular IOR Level", "Specular Tint", "IOR"):
            for l in list(b.inputs[k].links):
                m.node_tree.links.remove(l)


def build_ph(pid):
    src, yaw, h = PH[pid]
    reset()
    d = os.path.join(SRC, "ph", src)
    bpy.ops.import_scene.gltf(filepath=os.path.join(d, next(f for f in os.listdir(d) if f.endswith(".gltf"))))
    ob = join_all(pid)
    web_safe(ob)
    s = settle(ob, yaw=yaw, height=h)
    export(ob, "props", pid, {"source": "polyhaven:" + src, "scale": round(s, 4)})


# ---------- свои процедурные фигурки ----------

def build_moai():
    """Каменная голова-истукан в духе острова Пасхи (обобщённый архетип), h 0.15, туф с шумом."""
    reset()
    stone = mat("moai_tuff", "#6f6a62", rough=0.95, img=noise_image("moai_tuff", "#6f6a62", 0.22, seed=3))
    shade = mat("moai_socket", "#3d3a35", rough=1.0)
    parts = [
        prim("box", stone, (0, 0, 0.015), (0.070, 0.055, 0.030), bevel=0.004),            # плечи-постамент
        prim("box", stone, (0, 0.003, 0.090), (0.054, 0.046, 0.120), bevel=0.006),       # вытянутая голова
        prim("box", stone, (0, -0.0215, 0.127), (0.058, 0.014, 0.013), bevel=0.004),      # тяжёлые надбровья
        prim("box", stone, (0, -0.0225, 0.062), (0.030, 0.010, 0.006), bevel=0.002),      # сжатые губы
        prim("box", stone, (0, -0.0205, 0.046), (0.040, 0.012, 0.020), bevel=0.004),      # выступающий подбородок
    ]
    for sx in (-1, 1):
        parts.append(prim("box", stone, (sx * 0.029, 0.005, 0.100), (0.006, 0.014, 0.062), bevel=0.002))  # длинные уши
        parts.append(prim("box", shade, (sx * 0.0135, -0.0201, 0.1135), (0.019, 0.002, 0.009)))          # глазницы в тени
    # нос — клин: узкий у бровей, широкий и выступающий внизу
    bm = bmesh.new()
    top, bot, fy = 0.121, 0.070, -0.0195
    vs = [bm.verts.new(v) for v in [(-0.004, fy, top), (0.004, fy, top), (-0.012, fy, bot), (0.012, fy, bot),
                                    (0, fy - 0.007, top - 0.004), (0, fy - 0.019, bot)]]
    for f in [(0, 1, 4), (2, 5, 3), (0, 4, 5, 2), (1, 3, 5, 4), (0, 2, 3, 1)]:
        bm.faces.new([vs[i] for i in f])
    me = bpy.data.meshes.new("nose")
    bm.to_mesh(me)
    nose = bpy.data.objects.new("nose", me)
    bpy.context.collection.objects.link(nose)
    me.materials.append(stone)
    uv_box(nose)
    ob = join_all("fig-moai")
    settle(ob)
    export(ob, "props", "fig-moai", {"source": "procedural"})


def build_robot():
    """Заводной жестяной робот-игрушка (обобщённый ретро-образ), h 0.12."""
    reset()
    red = mat("robot_red", "#b3362b", rough=0.35, metal=0.4)
    tin = mat("robot_tin", "#c9c9c4", rough=0.28, metal=1.0)
    dark = mat("robot_dark", "#2a2a2c", rough=0.5, metal=0.3)
    eye = mat("robot_eye", "#f2c230", rough=0.2)
    blue = mat("robot_blue", "#3b6fb6", rough=0.3)
    for sx in (-1, 1):
        prim("box", dark, (sx * 0.013, -0.003, 0.004), (0.020, 0.030, 0.008), bevel=0.002)      # ботинки
        prim("box", tin, (sx * 0.013, 0, 0.022), (0.016, 0.018, 0.030), bevel=0.002)           # ноги
        prim("cyl", tin, (sx * 0.034, 0, 0.066), (0.012, 0.012, 0.040), rot=(0, 18 * sx, 0))   # руки
        prim("cyl", dark, (sx * 0.0405, -0.000, 0.045), (0.013, 0.013, 0.008), rot=(0, 18 * sx, 0))  # кисти
        prim("cyl", eye, (sx * 0.011, -0.0195, 0.110), (0.012, 0.012, 0.004), rot=(90, 0, 0))  # глаза
        prim("cyl", tin, (sx * 0.0235, 0, 0.110), (0.008, 0.008, 0.004), rot=(0, 90, 0))      # «уши»
    prim("box", red, (0, 0, 0.061), (0.054, 0.040, 0.052), bevel=0.004)                        # корпус
    prim("box", tin, (0, -0.0205, 0.064), (0.034, 0.002, 0.030), bevel=0.001)                  # панель на груди
    for i, c in enumerate((eye, blue, red)):
        prim("cyl", c, (-0.010 + i * 0.010, -0.0225, 0.068), (0.006, 0.006, 0.003), rot=(90, 0, 0), seg=16)
    prim("cyl", dark, (0, 0, 0.090), (0.014, 0.014, 0.008))                                   # шея
    prim("box", tin, (0, 0, 0.107), (0.044, 0.036, 0.030), bevel=0.004)                        # голова
    prim("box", dark, (0, -0.018, 0.098), (0.020, 0.002, 0.005), bevel=0.0005)                 # решётка-рот
    prim("cyl", tin, (0, 0, 0.128), (0.003, 0.003, 0.016), seg=12)                             # антенна
    prim("sph", red, (0, 0, 0.137), (0.008, 0.008, 0.008), seg=16)
    ob = join_all("fig-tin-robot")
    settle(ob, height=0.12)                 # собран в масштабе 14 см; под ТВ — не выше 12 см (compose.py)
    export(ob, "props", "fig-tin-robot", {"source": "procedural"})


def build_cactus():
    """Сувенир-шутка: глазурованный керамический кактус «с намёком» в терракотовом горшке, h ~0.13.
    Обобщённая форма (столбик и два круглых отростка у основания), без анатомических деталей."""
    reset()
    terra = mat("cactus_pot", "#b4643f", rough=0.85, img=noise_image("terra", "#b4643f", 0.10, seed=5))
    soil = mat("cactus_soil", "#3b2d24", rough=1.0)
    glaze = mat("cactus_glaze", "#4d8a4f", rough=0.22)
    bloom = mat("cactus_bloom", "#e8789a", rough=0.4)
    taper(prim("cyl", terra, (0, 0, 0.0215), (0.054, 0.054, 0.043), seg=40), 1.22)      # горшок, расширяется вверх
    prim("cyl", terra, (0, 0, 0.0445), (0.070, 0.070, 0.009), seg=40, bevel=0.002)      # бортик
    prim("cyl", soil, (0, 0, 0.0475), (0.062, 0.062, 0.002), seg=40)                    # земля
    prim("cyl", glaze, (0, 0, 0.083), (0.032, 0.032, 0.070), seg=32)                    # столбик
    prim("sph", glaze, (0, 0, 0.118), (0.032, 0.032, 0.026), seg=32)                    # скруглённая верхушка
    for sx in (-1, 1):
        prim("sph", glaze, (sx * 0.0175, -0.004, 0.0635), (0.033, 0.031, 0.032), seg=32)   # круглые отростки
    for i in range(5):                                                                     # цветочек сверху
        a = i * 2 * math.pi / 5
        prim("sph", bloom, (0.006 * math.cos(a), 0.006 * math.sin(a), 0.1315), (0.010, 0.010, 0.005), seg=12)
    prim("sph", mat("cactus_eye", "#f3d36b", rough=0.4), (0, 0, 0.1335), (0.005, 0.005, 0.004), seg=12)
    # рёбра-бороздки глазури: тонкие светлые штрихи по столбику
    spine = mat("cactus_spine", "#e9efe0", rough=0.5)
    for i in range(8):
        a = i * 2 * math.pi / 8
        prim("box", spine, (0.0162 * math.cos(a), 0.0162 * math.sin(a), 0.090), (0.0012, 0.0012, 0.040),
             rot=(0, 0, math.degrees(a)))
    ob = join_all("fig-cheeky-cactus")
    settle(ob)
    export(ob, "props", "fig-cheeky-cactus", {"source": "procedural"})


def build_candle():
    """Свеча-столбик Ø7 × 9 см с подтаявшим верхом на латунном блюдце."""
    reset()
    wax = mat("candle_wax", "#efe5cf", rough=0.45, img=noise_image("wax", "#efe5cf", 0.05, seed=9, blobs=3))
    brass = mat("candle_brass", "#b48a45", rough=0.3, metal=1.0)
    prim("cyl", brass, (0, 0, 0.003), (0.092, 0.092, 0.006), seg=48, bevel=0.002)
    prim("cyl", brass, (0, 0, 0.0075), (0.096, 0.096, 0.003), seg=48)
    prim("cyl", wax, (0, 0, 0.051), (0.070, 0.070, 0.084), seg=48)
    prim("cyl", wax, (0, 0, 0.0935), (0.056, 0.056, 0.002), seg=48)
    prim("cyl", mat("candle_wick", "#1d1a17", rough=0.9), (0, 0, 0.0985), (0.002, 0.002, 0.010), seg=8)
    ob = join_all("candle-pillar")
    settle(ob)
    export(ob, "props", "candle-pillar", {"source": "procedural"})


# ---------- рамки IKEA + картины ----------
# id: (артикул сырого GLB, файл картины, окно паспарту (w, h) м — пропорция как в prep_art.py, альбомная?)
FRAMES = {
    "rodalm-30x40-vertumnus": ("20548918", "vertumnus", (0.210, 0.280), False),
    "rodalm-40x50-poker":     ("10548914", "poker", (0.400, 0.300), True),
    "lomviken-21x30-hare":    ("20419389", "hare", (0.150, 0.200), False),
    "lomviken-50x70-tiger":   ("70286773", "tiger", (0.585, 0.450), True),
}
MAT_COLOR = "#f1ede4"


def frame_parts(article, art, window, landscape):
    """Сырой GLB рамки IKEA (лежит лицом вверх, +Z Blender) + паспарту и картина в проёме. Возвращает объект
    в той же ориентации (лицом вверх), центр в 0. Остальные объекты сцены не трогает."""
    before = set(meshes())
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, "raw", article + ".glb"))
    fr = join_all("frame_" + article, [o for o in meshes() if o not in before])
    if landscape:
        fr.data.transform(Matrix.Rotation(math.radians(90), 4, "Z"))
    mn, mx = bbox(fr)
    fr.data.transform(Matrix.Translation(Vector((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]))))
    fr.data.update()
    # проём: лучи сверху вдоль осей, вкладыш — самая низкая поверхность у центра
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(fr, dg)
    z0 = tree.ray_cast(Vector((0, 0, 1)), Vector((0, 0, -1)))[0].z

    def edge(ax, sgn):
        t = 0.0
        while t < 0.6:
            p = Vector((0, 0, 1)); p[ax] = sgn * t
            h = tree.ray_cast(p, Vector((0, 0, -1)))[0]
            if h is None or h.z > z0 + 0.001:
                return t
            t += 0.0005
        return t
    aw, ah = edge(0, 1) + edge(0, -1), edge(1, 1) + edge(1, -1)   # меряется по стеклу — оно во весь проём
    web_safe(fr)                              # дальше стекло не нужно: паспарту и картина лежат поверх
    # паспарту на весь проём, картина в окне по центру
    m_mat = mat("passe_partout", MAT_COLOR, rough=0.9)
    prim("box", m_mat, (0, 0, z0 + 0.0006), (aw + 0.002, ah + 0.002, 0.0012))
    img = bpy.data.images.load(os.path.join(SRC, "artc", art + ".jpg"))
    a_mat = mat("art_" + art, "#ffffff", rough=0.75, img=img)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, z0 + 0.0014))
    pl = bpy.context.active_object
    pl.scale = (window[0], window[1], 1)
    bpy.ops.object.transform_apply(scale=True)
    pl.data.materials.append(a_mat)            # развёртка плоскости по умолчанию: (0..1) на весь квадрат
    ob = join_all("frame", [o for o in meshes() if o not in before])
    return ob, {"aperture": [round(aw, 4), round(ah, 4)], "window": list(window)}


def build_frame(pid):
    article, art, window, landscape = FRAMES[pid]
    reset()
    ob, info = frame_parts(article, art, window, landscape)
    ob.data.transform(Matrix.Rotation(math.radians(90), 4, "X"))    # встаёт: лицо в −Y Blender (= +Z glTF)
    ob.name = pid
    settle(ob)
    export(ob, "tvwall", pid, {"source": "ikea:" + article, **info})


def build_ledge():
    """MOSSLANDA 55 (дуб) и две прислонённые рамки: RÖDALM 21×30 с котами Куниёси, LOMVIKEN 21×30 с зайцем Дюрера."""
    pid = "mosslanda-55-gallery"
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, "raw", "80589835.glb"))
    led = join_all("ledge")
    led.data.transform(Matrix.Rotation(math.radians(90), 4, "X"))   # лежала стеной вниз: полка внизу, перед −Y
    mn, mx = bbox(led)
    led.data.transform(Matrix.Translation(Vector((-(mn[0] + mx[0]) / 2, -mx[1], -mn[2]))))  # стена — плоскость y = 0
    led.data.update()
    D = float(mx[1] - mn[1])
    tree = BVHTree.FromObject(led, bpy.context.evaluated_depsgraph_get())
    shelf = tree.ray_cast(Vector((0, -D * 0.5, 1)), Vector((0, 0, -1)))[0].z    # верх полки посередине глубины
    lip = tree.ray_cast(Vector((0, -D + 0.004, 1)), Vector((0, 0, -1)))[0].z     # передний бортик
    tilt = 4.0
    placed = []
    for art_id, (article, art, window, x, front) in {
        "catfish": ("50566393", "catfish", (0.130, 0.190), -0.160, 0.0),
        "hare": ("20419389", "hare", (0.150, 0.200), 0.040, 0.024),
    }.items():
        keep, _ = frame_parts(article, art, window, False)
        keep.data.transform(Matrix.Rotation(math.radians(90), 4, "X"))   # лицо в −Y, зад y = 0
        fmn, fmx = bbox(keep)
        d, H = float(fmx[1] - fmn[1]), float(fmx[2] - fmn[2])
        keep.data.transform(Matrix.Translation(Vector((-(fmn[0] + fmx[0]) / 2, -fmx[1], -fmn[2]))))
        # прислонить: поворот вокруг нижнего заднего ребра, верх уходит к стене
        keep.data.transform(Matrix.Rotation(math.radians(-tilt), 4, "X"))
        top_back = H * math.sin(math.radians(tilt))
        keep.data.transform(Matrix.Translation(Vector((x, -top_back - front, shelf))))
        keep.name = "lean_" + art_id
        placed.append({"art": art_id, "x": x, "W": round(float(fmx[0] - fmn[0]), 4)})
    ob = join_all(pid)
    mn, mx = bbox(ob)
    # центр следа: по X полка симметрична; по глубине — центр габарита (стена на +D/2)
    ob.data.transform(Matrix.Translation(Vector((0, -(mn[1] + mx[1]) / 2, -mn[2]))))
    ob.data.update()
    mn2, mx2 = bbox(ob)
    export(ob, "tvwall", pid, {"source": "ikea:80589835+50566393+20419389", "shelfTop": round(shelf - float(mn[2]), 4),
                               "lipTop": round(lip - float(mn[2]), 4), "wallY": round(float(mx2[1]), 4),
                               "frames": placed})


# ---------- запуск ----------
JOBS = {**{k: (lambda k=k: build_ph(k)) for k in PH}, **{k: (lambda k=k: build_frame(k)) for k in FRAMES},
        "fig-moai": build_moai, "fig-tin-robot": build_robot, "fig-cheeky-cactus": build_cactus,
        "candle-pillar": build_candle, "mosslanda-55-gallery": build_ledge}
for k, fn in JOBS.items():
    if not ONLY or k in ONLY:
        fn()
json.dump(REPORT, open(REPORT_PATH, "w"), indent=1, ensure_ascii=False)
