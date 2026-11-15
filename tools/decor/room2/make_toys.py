# Игрушки на кровать спальни (room2): свои CC0-модели, сделаны здесь, без чужих исходников.
#   blender -b --python tools/decor/room2/make_toys.py -- <tmp>      -> <tmp>/raw/<id>.glb
# Дальше tools/decor/room2/toys.py (meshopt, миниатюры, части в room2.json) — он и зовёт этот скрипт.
#
# Что внутри (Ш × В × Г примерно):
#   laptop-gaming   игровой ноутбук 15″, открыт; материал экрана "screen" (на нём tv.js играет стрим Dota 2)
#   cat-cloudy      плюшевый «облачный» серый кот, сидит; на макушке белые облачка
#   camper-toy      игрушечный автодом (двухцветный, крыша-палатка)
#   bicycle-toy     игрушечный велосипед на подножке
#   figs-wow        три фигурки фэнтези-героев в духе WoW: орк с топором, паладин с молотом и щитом, эльфийка с посохом
#   figs-dota       три фигурки в духе Dota 2: мясник с крюком, самурай в маске с мечом, ледяная волшебница
# Фигурки — собирательные образы (свои формы и цвета), без логотипов и копий чужих моделей.
#
# Контракт как у обстановки (web/models/decor/README.md): метры, пол Y = 0 (glTF), центр следа в 0, перед +Z.
# Строим прямо в осях glTF (Y вверх, Z вперёд), в конце поворачиваем в оси Blender. Цвета — по вершинам,
# один материал на модель (один вызов отрисовки), у ноутбука второй материал — экран.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

OUT = os.path.join(sys.argv[sys.argv.index("--") + 1], "raw")
os.makedirs(OUT, exist_ok=True)
TAU = math.tau


def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


class Mesh:
    """bmesh в осях glTF; каждая деталь — свой цвет вершин, гладкая или гранёная."""
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new("Col")
        self.F = Matrix.Identity(4)          # текущая система координат (фигурка, колесо…)

    def _paint(self, before, hexcol, smooth, mi=0):
        h = hexcol.lstrip('#')
        c = (*(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)), 1.0)   # байтовый слой цвета хранит sRGB как есть
        for f in self.bm.faces:
            if f in before:
                continue
            f.smooth = smooth; f.material_index = mi
            for l in f.loops:
                l[self.col] = c

    def _go(self, fn, hexcol, smooth, mi=0):
        before = set(self.bm.faces)
        fn()
        self._paint(before, hexcol, smooth, mi)

    def ell(self, c, r, hexcol, seg=14, rings=9, rot=None, smooth=True):
        m = self.F @ Matrix.Translation(Vector(c)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*r, 1))
        self._go(lambda: bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1, matrix=m), hexcol, smooth)

    def box(self, c, s, hexcol, rot=None, mi=0):
        m = self.F @ Matrix.Translation(Vector(c)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*s, 1))
        self._go(lambda: bmesh.ops.create_cube(self.bm, size=1, matrix=m), hexcol, False, mi)

    def cyl(self, p0, p1, r0, hexcol, r1=None, seg=12, smooth=True, caps=True):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        m = self.F @ Matrix.Translation((p0 + p1) / 2) @ q
        self._go(lambda: bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r0,
                                               radius2=r0 if r1 is None else r1, depth=d.length, matrix=m), hexcol, smooth)

    def torus(self, c, R, r, hexcol, rot=None, seg=20, rseg=8, arc=TAU):
        """тор в плоскости XY (ось +Z), повёрнутый rot"""
        m = self.F @ Matrix.Translation(Vector(c)) @ (rot or Matrix.Identity(4))
        def mk():
            n = seg + (0 if arc >= TAU - 1e-6 else 1)
            rings = []
            for i in range(n):
                a = arc * i / seg
                ctr = Vector((math.cos(a) * R, math.sin(a) * R, 0))
                out = Vector((math.cos(a), math.sin(a), 0))
                rings.append([self.bm.verts.new(m @ (ctr + out * (r * math.cos(b)) + Vector((0, 0, r * math.sin(b)))))
                              for b in [TAU * j / rseg for j in range(rseg)]])
            for i in range(seg if arc >= TAU - 1e-6 else seg):
                A, B = rings[i], rings[(i + 1) % n]
                for j in range(rseg):
                    self.bm.faces.new([A[j], A[(j + 1) % rseg], B[(j + 1) % rseg], B[j]])
        self._go(mk, hexcol, True)

    def at(self, x=0, y=0, z=0, yaw=0, s=1.0):
        self.F = Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.radians(yaw), 4, 'Y') @ Matrix.Scale(s, 4)
        return self


def Rx(d): return Matrix.Rotation(math.radians(d), 4, 'X')
def Ry(d): return Matrix.Rotation(math.radians(d), 4, 'Y')
def Rz(d): return Matrix.Rotation(math.radians(d), 4, 'Z')


def export(name, mesh, rough=0.5, metal=0.0, extra=None):
    """extra — [(имя материала, цвет, шероховатость)] для material_index 1.."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bm = mesh.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.transform(Matrix.Rotation(math.radians(90), 4, 'X'))   # оси glTF -> Blender (экспорт вернёт обратно)
    # пол в 0 и центр следа в 0
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    me.transform(Matrix.Translation((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs))))
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    n = m.node_tree.nodes.new("ShaderNodeVertexColor"); n.layer_name = "Col"
    m.node_tree.links.new(n.outputs["Color"], b.inputs["Base Color"])
    me.materials.append(m)
    for mn, hexcol, r in (extra or []):
        e = bpy.data.materials.new(mn); e.use_nodes = True
        eb = e.node_tree.nodes["Principled BSDF"]
        eb.inputs["Base Color"].default_value = (*srgb(hexcol), 1)
        eb.inputs["Roughness"].default_value = r
        me.materials.append(e)
    me.color_attributes.active_color = me.color_attributes["Col"]
    me.color_attributes.render_color_index = 0
    dims = [max(a) - min(a) for a in ([v.co.x for v in me.vertices], [v.co.z for v in me.vertices], [v.co.y for v in me.vertices])]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB", export_yup=True,
                              export_apply=True, export_vertex_color="ACTIVE", export_extras=False,
                              export_cameras=False, export_lights=False)
    print("MODEL %s tris=%d size(WxHxD)=%s" % (name, sum(len(p.vertices) - 2 for p in me.polygons), [round(d, 3) for d in dims]), flush=True)


# ====================== игровой ноутбук 15″ ======================
# База 0,36 × 0,25, крышка откинута на 20° от вертикали; экран 16:9 0,330 × 0,186.
# Плоскость экрана для spec/tv.json (оси модели после выравнивания: центр следа в 0, пол 0) печатается ниже.
def laptop():
    M = Mesh()
    W, D, T = 0.36, 0.25, 0.022
    blk, dark, red = '#16171a', '#26282d', '#d0242c'
    M.box((0, T / 2, 0), (W, T, D), blk)
    M.box((0, T + 0.0006, -0.035), (W - 0.04, 0.0012, 0.105), dark)            # клавиатура
    for i in range(7):                                                         # ряды клавиш (полосы)
        M.box((0, T + 0.0016, -0.08 + i * 0.0145), (W - 0.06, 0.001, 0.009), '#3a3d44')
    for (x, z) in [(-0.105, -0.035), (-0.12, -0.0205), (-0.105, -0.0205), (-0.09, -0.0205)]:   # WASD подсвечены
        M.box((x, T + 0.0022, z), (0.012, 0.0012, 0.0105), red)
    M.box((0, T + 0.0004, 0.068), (0.11, 0.0009, 0.065), '#2f3238')            # тачпад
    M.box((0, T * 0.55, D / 2 + 0.0004), (W * 0.7, 0.0025, 0.001), red)        # красная полоса спереди
    for s in (-1, 1):                                                          # решётки охлаждения сзади
        M.box((s * 0.12, T * 0.5, -D / 2 - 0.0004), (0.08, 0.012, 0.001), '#0b0b0c')
    # крышка
    tilt = 20
    hinge = Vector((0, T + 0.004, -D / 2 + 0.01))
    v = Vector((0, math.cos(math.radians(tilt)), -math.sin(math.radians(tilt))))
    w = Vector((0, math.sin(math.radians(tilt)), math.cos(math.radians(tilt))))
    L, LT = 0.235, 0.008
    R = Rx(-tilt)
    M.box(hinge + v * (L / 2) - w * (LT / 2), (W, L, LT), blk, rot=R)
    M.box(hinge + v * (L / 2) - w * (LT + 0.0004), (0.05, 0.04, 0.001), red, rot=R)   # логотип-ромб сзади (абстрактный)
    M.cyl(hinge - Vector((W / 2 - 0.02, 0, 0)), hinge + Vector((W / 2 - 0.02, 0, 0)), 0.006, blk, seg=10)
    sw, sh, s_up = 0.330, 0.186, 0.124
    ctr = hinge + v * s_up + w * 0.0005
    M.box(ctr - w * 0.0003, (sw, sh, 0.0008), '#000000', rot=R, mi=1)        # экран — материал "screen"
    # куда встал центр экрана после выравнивания (пол 0, центр следа 0) — для spec/tv.json
    bb = [v_.co for v_ in M.bm.verts]
    minx, maxx = min(p.x for p in bb), max(p.x for p in bb)
    miny = min(p.y for p in bb)
    minz, maxz = min(p.z for p in bb), max(p.z for p in bb)
    c2 = (ctr.x - (minx + maxx) / 2, ctr.y - miny, ctr.z - (minz + maxz) / 2)
    print("SCREEN_RECT center=%s size=%s rot=[%d,0,0]" % ([round(x, 4) for x in c2], [sw, sh], -tilt), flush=True)
    export("laptop-gaming", M, rough=0.38, extra=[("screen", "#05070a", 0.12)])


# ====================== «облачный» кот-плюшка ======================
def cat():
    M = Mesh()
    g, gl, wh, pink, ink = '#8f97a3', '#a7aeb8', '#f4f3ef', '#e59aa6', '#15161a'
    M.ell((0, 0.075, -0.01), (0.095, 0.08, 0.085), g)                          # тело-груша
    M.ell((0, 0.07, 0.05), (0.06, 0.06, 0.04), wh)                             # белое пузико-облако
    M.ell((0, 0.185, 0.015), (0.105, 0.088, 0.085), gl)                        # большая голова
    for s in (-1, 1):
        M.ell((s * 0.062, 0.255, 0.0), (0.03, 0.04, 0.018), g, rot=Rz(-s * 25))           # уши
        M.ell((s * 0.062, 0.252, 0.012), (0.017, 0.026, 0.006), pink, rot=Rz(-s * 25))
        M.ell((s * 0.04, 0.025, 0.065), (0.03, 0.022, 0.035), wh)                         # лапки спереди
        M.ell((s * 0.08, 0.03, -0.01), (0.035, 0.03, 0.05), g)                            # задние лапы
        M.ell((s * 0.038, 0.195, 0.087), (0.017, 0.02, 0.008), ink)                       # глаза-бусины
        M.ell((s * 0.033, 0.202, 0.094), (0.005, 0.005, 0.003), '#ffffff')                # блики
        M.ell((s * 0.062, 0.17, 0.078), (0.016, 0.009, 0.005), '#efb3bd')                 # румянец
        for k in (-1, 1):                                                                  # усы
            M.cyl((s * 0.03, 0.165 + k * 0.006, 0.096), (s * 0.085, 0.17 + k * 0.016, 0.085), 0.0012, ink, seg=4, smooth=False)
    M.ell((0, 0.165, 0.093), (0.032, 0.022, 0.012), wh)                        # мордочка
    M.ell((0, 0.174, 0.104), (0.008, 0.006, 0.004), pink)                      # нос
    # хвост колечком вокруг бока
    M.torus((0.03, 0.03, -0.02), 0.08, 0.018, g, rot=Rx(90), seg=14, arc=TAU * 0.42)
    M.ell((0.03 + 0.08 * math.cos(TAU * 0.42), 0.03, -0.02 - 0.08 * math.sin(TAU * 0.42)), (0.022, 0.022, 0.022), wh)
    # облачка на макушке
    for (x, y, z, r) in [(-0.03, 0.27, 0.0, 0.026), (0.0, 0.282, 0.005, 0.03), (0.032, 0.27, -0.004, 0.024)]:
        M.ell((x, y, z), (r, r * 0.8, r), wh)
    # полоски-тучки на спине
    for i, y in enumerate((0.1, 0.13)):
        M.ell((0, y, -0.085), (0.05 - i * 0.01, 0.009, 0.01), '#7a818c')
    export("cat-cloudy", M, rough=0.92)


# ====================== игрушечный автодом ======================
def camper():
    M = Mesh()
    L, Wd = 0.22, 0.095
    teal, white, orange, glass, tyre = '#3fa79a', '#f1efe8', '#f08a2c', '#2b4b66', '#1b1b1d'
    M.box((0, 0.045, 0), (Wd, 0.04, L), teal)                                  # низ кузова
    M.box((0, 0.083, -0.005), (Wd, 0.036, L - 0.01), white)                    # верх
    M.box((0, 0.065, 0.0), (Wd + 0.001, 0.005, L + 0.001), white)              # полоса
    M.box((0, 0.106, -0.01), (Wd - 0.006, 0.012, L - 0.05), orange)            # крыша-палатка
    M.box((0, 0.113, -0.01), (Wd - 0.03, 0.004, L - 0.08), '#d9731c')
    M.box((0, 0.084, L / 2 - 0.004), (Wd - 0.012, 0.026, 0.003), glass, rot=Rx(-8))   # лобовое
    for s in (-1, 1):
        for z in (-0.06, -0.015, 0.03):
            M.box((s * (Wd / 2 + 0.0005), 0.085, z), (0.002, 0.02, 0.032), glass)       # окна
        M.ell((s * 0.03, 0.05, L / 2 + 0.001), (0.009, 0.009, 0.004), '#ffe9a6')          # фары
        for z in (-0.07, 0.068):
            M.cyl((s * (Wd / 2 - 0.012), 0.017, z), (s * (Wd / 2 + 0.006), 0.017, z), 0.017, tyre, seg=16)
            M.cyl((s * (Wd / 2 + 0.005), 0.017, z), (s * (Wd / 2 + 0.008), 0.017, z), 0.009, '#c9ccd0', seg=12)
    M.box((0, 0.024, L / 2 + 0.004), (Wd + 0.004, 0.01, 0.008), '#c9ccd0')    # бамперы
    M.box((0, 0.024, -L / 2 - 0.004), (Wd + 0.004, 0.01, 0.008), '#c9ccd0')
    M.ell((0, 0.055, L / 2 + 0.002), (0.012, 0.012, 0.003), white)             # эмблема-кружок (без марки)
    M.box((0, 0.07, -L / 2 - 0.002), (0.05, 0.03, 0.004), '#7a4a2a')           # запаска/лесенка сзади
    export("camper-toy", M, rough=0.4)


# ====================== игрушечный велосипед ======================
def bicycle():
    M = Mesh()
    red, tyre, chrome, blk = '#e23b3b', '#1b1b1d', '#c9ccd0', '#222326'
    R = 0.042
    fz, rz, y = 0.07, -0.07, R + 0.004
    for z in (fz, rz):
        M.torus((0, y, z), R, 0.006, tyre, rot=Ry(90), seg=24, rseg=8)
        M.cyl((-0.006, y, z), (0.006, y, z), 0.008, chrome, seg=10)
        for k in range(6):                                                     # спицы
            a = k * math.pi / 6
            M.cyl((0, y + math.sin(a) * (R - 0.004), z + math.cos(a) * (R - 0.004)),
                  (0, y - math.sin(a) * (R - 0.004), z - math.cos(a) * (R - 0.004)), 0.0009, chrome, seg=4, smooth=False)
    bb = Vector((0, y, -0.005)); seat = Vector((0, y + 0.06, -0.03)); head = Vector((0, y + 0.065, 0.048))
    for a, b in [(bb, seat), (bb, head), (seat, head), (Vector((0, y, rz)), bb), (Vector((0, y, rz)), seat), (head, Vector((0, y, fz)))]:
        M.cyl(a, b, 0.0045, red, seg=8)
    M.cyl(seat, seat + Vector((0, 0.012, -0.004)), 0.003, chrome, seg=8)
    M.ell(seat + Vector((0, 0.016, -0.006)), (0.008, 0.005, 0.017), blk)        # седло
    M.cyl(head, head + Vector((0, 0.016, -0.004)), 0.003, chrome, seg=8)
    hb = head + Vector((0, 0.016, -0.004))
    M.cyl(hb + Vector((-0.028, 0, -0.004)), hb + Vector((0.028, 0, -0.004)), 0.0028, chrome, seg=8)
    for s in (-1, 1):
        M.cyl(hb + Vector((s * 0.02, 0, -0.004)), hb + Vector((s * 0.032, 0, -0.006)), 0.0042, blk, seg=8)   # грипсы
        M.cyl(bb, bb + Vector((s * 0.012, -s * 0.012, s * 0.008)), 0.002, chrome, seg=6)                     # шатуны
        M.box(bb + Vector((s * 0.016, -s * 0.012, s * 0.008)), (0.01, 0.003, 0.006), blk)                   # педали
    M.torus(bb, 0.011, 0.0018, chrome, rot=Ry(90), seg=14, rseg=5)              # звезда
    M.cyl(bb + Vector((0.004, 0, 0)), Vector((0.025, 0.001, -0.02)), 0.0018, chrome, seg=6)   # подножка
    M.ell((0, y + 0.07, 0.056), (0.007, 0.007, 0.004), '#ffe9a6')               # фара
    export("bicycle-toy", M, rough=0.38)


# ====================== фигурки ======================
def body(M, skin, top, legs, boots, fat=1.0, robe=None, head_r=0.016):
    M.cyl((0, 0, 0), (0, 0.007, 0), 0.023, '#1f2024', seg=20, smooth=False)           # подставка
    M.cyl((0, 0.007, 0), (0, 0.0085, 0), 0.021, '#3a3c42', seg=20, smooth=False)
    if robe:
        M.cyl((0, 0.0085, 0), (0, 0.05, 0), 0.02 * fat, robe, r1=0.012 * fat, seg=14)
    else:
        for s in (-1, 1):
            M.cyl((s * 0.008 * fat, 0.012, 0), (s * 0.008 * fat, 0.034, 0), 0.0062 * fat, legs, seg=8)
            M.ell((s * 0.008 * fat, 0.012, 0.003), (0.0072 * fat, 0.005, 0.009), boots)
    M.ell((0, 0.047, 0), (0.0165 * fat, 0.019, 0.013 * fat), top)
    M.ell((0, 0.077 + (fat - 1) * 0.01, 0), (head_r, head_r * 0.98, head_r * 0.95), skin)
    return 0.077 + (fat - 1) * 0.01


def arms(M, col, skin, fat=1.0, rh=(0.006, 0.034, 0.008), lh=(-0.006, 0.034, 0.008)):
    for s, hand in ((1, rh), (-1, lh)):
        sh = (s * 0.018 * fat, 0.057, 0)
        h = (s * 0.018 * fat + hand[0] * s, hand[1], hand[2])
        M.cyl(sh, h, 0.0055 * fat, col, seg=8)
        M.ell(h, (0.0055, 0.0055, 0.0055), skin)
    return (0.018 * fat + rh[0], rh[1], rh[2]), (-0.018 * fat + lh[0] * -1, lh[1], lh[2])


def eyes(M, hy, r, col='#141416', z=None):
    for s in (-1, 1):
        M.ell((s * r * 0.4, hy + r * 0.05, (z if z is not None else r * 0.88)), (0.0026, 0.0034, 0.0015), col)


def orc(M):
    skin, leather = '#5f8b3b', '#6b4a2b'
    hy = body(M, skin, leather, '#4a3320', '#2a1d12', fat=1.18)
    rh, lh = arms(M, skin, skin, fat=1.18, rh=(0.006, 0.04, 0.012))
    for s in (-1, 1):
        M.ell((s * 0.022, 0.062, 0), (0.011, 0.008, 0.011), '#8d9096')                   # наплечники
        M.cyl((s * 0.024, 0.067, 0), (s * 0.03, 0.08, 0), 0.0035, '#d8d2c0', r1=0.0002, seg=6)
        M.cyl((s * 0.006, hy - 0.008, 0.013), (s * 0.008, hy - 0.001, 0.016), 0.0018, '#f2ecd8', r1=0.0002, seg=6)   # клыки
    M.cyl((0, hy + 0.012, -0.004), (0, hy + 0.03, -0.01), 0.005, '#121212', r1=0.0012, seg=8)   # хвост на макушке
    M.box((0, 0.04, 0.012), (0.03, 0.006, 0.004), '#3b2414')                                  # пояс
    eyes(M, hy, 0.0185, '#c81e1e')
    M.cyl((rh[0], rh[1] - 0.025, rh[2]), (rh[0], rh[1] + 0.045, rh[2]), 0.0022, '#5a3a20', seg=6)
    for s in (-1, 1):                                                                         # двойной топор
        M.ell((rh[0] + s * 0.011, rh[1] + 0.036, rh[2]), (0.011, 0.012, 0.002), '#a9adb4', seg=10, rings=6)


def paladin(M):
    steel, gold, blue = '#b9c0c8', '#d6aa3a', '#2e5aa8'
    hy = body(M, '#f0c9a4', steel, steel, '#8f969e')
    rh, lh = arms(M, steel, '#f0c9a4', rh=(0.006, 0.04, 0.012), lh=(-0.004, 0.04, 0.012))
    M.box((0, 0.042, 0.013), (0.02, 0.026, 0.003), blue)                                      # накидка спереди
    M.box((0, 0.043, 0.0148), (0.006, 0.012, 0.001), gold)
    M.box((0, 0.045, -0.014), (0.03, 0.05, 0.003), blue, rot=Rx(-6))                          # плащ
    M.ell((0, hy + 0.004, -0.001), (0.0172, 0.014, 0.0165), steel)                            # шлем
    M.box((0, hy + 0.018, 0), (0.003, 0.008, 0.026), gold)                                    # гребень
    for s in (-1, 1):
        M.ell((s * 0.02, 0.061, 0), (0.01, 0.007, 0.01), gold)
    eyes(M, hy - 0.002, 0.016)
    M.cyl((lh[0] - 0.006, lh[1], lh[2] + 0.002), (lh[0] - 0.009, lh[1], lh[2] + 0.002), 0.014, blue, seg=16, smooth=False)   # щит
    M.cyl((lh[0] - 0.0095, lh[1], lh[2] + 0.002), (lh[0] - 0.011, lh[1], lh[2] + 0.002), 0.005, gold, seg=12)
    M.cyl((rh[0], rh[1] - 0.012, rh[2]), (rh[0], rh[1] + 0.04, rh[2]), 0.0022, '#6b4a2b', seg=6)
    M.box((rh[0], rh[1] + 0.042, rh[2]), (0.02, 0.011, 0.011), gold)                         # молот


def elf(M):
    skin, robe, hair = '#9a7cc6', '#4b2f7a', '#d9f2f0'
    hy = body(M, skin, robe, None, None, robe=robe)
    rh, lh = arms(M, robe, skin, rh=(0.004, 0.038, 0.01))
    for s in (-1, 1):
        M.cyl((s * 0.013, hy + 0.003, 0), (s * 0.03, hy + 0.014, -0.004), 0.003, skin, r1=0.0004, seg=6)   # длинные уши
    M.ell((0, hy + 0.002, -0.008), (0.0175, 0.02, 0.014), hair)                               # волосы
    M.ell((0, hy - 0.02, -0.012), (0.012, 0.022, 0.006), hair)
    M.box((0, 0.04, 0.012), (0.026, 0.004, 0.003), '#c9a43a')                                 # пояс
    eyes(M, hy, 0.016, '#e8fff4')
    M.cyl((rh[0], 0.009, rh[2]), (rh[0], 0.11, rh[2]), 0.0018, '#5a3a20', seg=6)              # посох
    M.ell((rh[0], 0.116, rh[2]), (0.006, 0.009, 0.006), '#5df08a', seg=4, rings=2, smooth=False)


def butcher(M):
    skin = '#c7a08e'
    M.cyl((0, 0, 0), (0, 0.007, 0), 0.025, '#1f2024', seg=20, smooth=False)
    M.cyl((0, 0.007, 0), (0, 0.0085, 0), 0.023, '#3a3c42', seg=20, smooth=False)
    for s in (-1, 1):
        M.cyl((s * 0.011, 0.01, 0), (s * 0.011, 0.024, 0), 0.008, '#5d4a3a', seg=8)
    M.ell((0, 0.045, 0.002), (0.028, 0.03, 0.025), skin)                                       # пузо
    M.ell((0, 0.041, 0.016), (0.019, 0.022, 0.012), '#8a3b2e')                                 # фартук
    for y in (0.036, 0.05):
        M.box((0.01, y, 0.0255), (0.012, 0.0014, 0.001), '#4a2a22')                            # швы
    hy = 0.083
    M.ell((0, hy, 0.006), (0.013, 0.012, 0.012), skin)                                         # маленькая голова
    eyes(M, hy, 0.0125)
    M.box((0, hy - 0.006, 0.0175), (0.01, 0.002, 0.001), '#4a2a22')
    for s in (-1, 1):
        M.cyl((s * 0.026, 0.06, 0), (s * 0.034, 0.036, 0.01), 0.0075, skin, seg=8)
        M.ell((s * 0.034, 0.034, 0.011), (0.007, 0.007, 0.007), skin)
    # крюк на цепи в правой руке
    M.cyl((0.034, 0.034, 0.011), (0.037, 0.012, 0.03), 0.0014, '#7c8086', seg=5)
    M.torus((0.037, 0.02, 0.036), 0.009, 0.0022, '#a9adb4', rot=Ry(90), seg=12, rseg=6, arc=TAU * 0.7)
    M.cyl((0.037, 0.026, 0.03), (0.037, 0.031, 0.027), 0.0016, '#a9adb4', r1=0.0002, seg=6)


def samurai(M):
    skin, pants, sash = '#d8a27a', '#e0662a', '#b4232a'
    hy = body(M, skin, skin, pants, '#3b2a1e')
    for s in (-1, 1):
        M.ell((s * 0.009, 0.03, 0), (0.009, 0.012, 0.009), pants)                             # широкие штаны
    rh, lh = arms(M, skin, skin, rh=(0.004, 0.036, 0.012), lh=(-0.002, 0.04, 0.012))
    M.box((0, 0.039, 0.0), (0.035, 0.007, 0.028), sash)                                        # пояс
    M.ell((0, hy, 0.006), (0.015, 0.016, 0.012), '#f4f1ea')                                    # маска
    for s in (-1, 1):
        M.box((s * 0.006, hy + 0.002, 0.0172), (0.006, 0.0022, 0.001), '#141416', rot=Rz(s * 12))
        M.box((s * 0.009, hy - 0.006, 0.0165), (0.0016, 0.01, 0.001), '#2a7b5d')               # полосы маски
    for i in range(5):                                                                          # рыжий хохол
        a = (i - 2) * 22
        M.cyl((0, hy + 0.012, -0.002), (math.sin(math.radians(a)) * 0.012, hy + 0.026, -0.008), 0.0035, '#ff8a2a', r1=0.0005, seg=6)
    M.cyl((rh[0], rh[1] - 0.004, rh[2]), (rh[0] + 0.002, rh[1] + 0.012, rh[2] + 0.004), 0.0022, '#2a2a2a', seg=6)   # рукоять
    M.box((rh[0] + 0.006, rh[1] + 0.045, rh[2] + 0.012), (0.002, 0.065, 0.006), '#d6dadf', rot=Rx(-18) @ Rz(-6))   # меч


def maiden(M):
    skin, cloak, fur = '#f3d9cc', '#4f8fd6', '#f7f8fb'
    hy = body(M, skin, cloak, None, None, robe=cloak)
    rh, lh = arms(M, cloak, skin, rh=(0.004, 0.038, 0.01))
    M.ell((0, hy + 0.002, -0.004), (0.0185, 0.019, 0.016), fur)                               # меховой капюшон
    M.ell((0, hy - 0.0005, 0.004), (0.0152, 0.015, 0.013), skin)
    M.torus((0, 0.06, 0), 0.016, 0.005, fur, rot=Rx(90), seg=16, rseg=6)                      # меховой воротник
    eyes(M, hy, 0.0152, '#2b6fd0', z=0.0172)
    M.cyl((rh[0], 0.009, rh[2]), (rh[0], 0.105, rh[2]), 0.0017, '#cfe7ff', seg=6)              # посох
    for k, (dx, dy) in enumerate([(0, 0.112), (0.004, 0.108), (-0.004, 0.108)]):
        M.cyl((rh[0] + dx, 0.103, rh[2]), (rh[0] + dx * 1.6, dy + 0.004, rh[2]), 0.0035, '#9fdcff', r1=0.0004, seg=5, smooth=False)


def figs(name, makers):
    M = Mesh()
    spots = [(-0.052, -0.01, 18), (0.0, 0.012, 0), (0.052, -0.01, -18)]   # дугой, лицом вперёд
    for (x, z, yaw), mk in zip(spots, makers):
        M.at(x, 0, z, yaw)
        mk(M)
    M.at()
    export(name, M, rough=0.45)


laptop()
cat()
camper()
bicycle()
figs("figs-wow", [orc, paladin, elf])
figs("figs-dota", [butcher, samurai, maiden])
