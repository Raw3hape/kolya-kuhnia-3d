# Процедурные вьюмодели без чужих ассетов: винтовка с продольно-скользящим затвором времён Первой мировой
# (обобщённый класс Маузер/Мосин, не копия конкретной модели или игры) и охотничья двустволка-горизонталка.
# blender -b --python procedural.py -- <out> <preview>
# Помощники (материалы, бокс, труба, кулак, рука, экспорт, превью) — из build.py.
# Оси Blender: X вправо, Y вперёд (ствол), Z вверх; начало координат — центр правого кулака на шейке приклада.
# Узлы (их двигает viewmodel.js): gun, hand_r, hand_l, muzzle;
#   винтовка: bolt (ось вращения = ось затвора), clip (обойма на 5 патронов, видна только при зарядке);
#   двустволка: barrels (шарнир; дети — hand_l, shells, muzzle), shells (два патрона за казёнником).
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import build as B
R = math.radians

WOOD_K = '#5a3a22'     # орех винтовки
WOOD_S = '#6e4527'     # светлее, двустволка
STEEL = '#2c2e33'      # воронёная сталь
ACTION = '#8d8b86'     # колодка двустволки: светлая сталь
BRASS = '#b08a3e'
SHELL = '#8e2a22'      # пластиковая гильза дробового патрона

def tbox(name, y0, y1, s0, s1, m, bevel=0.005):
    """Сужающийся брус вдоль Y. s = (полуширина по X, низ Z, верх Z) на торцах y0 и y1."""
    bm = bmesh.new()
    v = []
    for y, (hx, zl, zh) in ((y0, s0), (y1, s1)):
        v += [bm.verts.new((x, y, z)) for x, z in ((-hx, zl), (hx, zl), (hx, zh), (-hx, zh))]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([v[i] for i in f])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    if bevel:
        md = o.modifiers.new('b', 'BEVEL'); md.width = bevel; md.segments = 2; md.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier='b')
    o.data.materials.append(m)
    return o

def sphere(name, c, r, m):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=r, location=c)
    o = bpy.context.active_object; o.name = name; o.data.materials.append(m)
    return o

def box(name, lo, hi, m, bevel=0.002):
    lo, hi = Vector(lo), Vector(hi)
    return B.rbox(name, tuple(hi - lo), (lo + hi) / 2, m=m, bevel=bevel, seg=1)

def pivot(o, p):
    """Начало координат объекта в точку p (мир), геометрия на месте."""
    p = Vector(p)
    o.data.transform(Matrix.Translation(-p)); o.location = p
    return o

def parent(child, par):
    w = child.matrix_world.copy()
    child.parent = par; child.matrix_world = w

def empty(name, p):
    e = bpy.data.objects.new(name, None); e.location = p; bpy.context.scene.collection.objects.link(e)
    return e

def right_hand(slant, index_at, thumb_at, dir_r):
    G = Matrix.Rotation(R(-slant), 4, 'X')
    parts = B.fist(+1, G)
    parts.append(B.rbox('index_r', (0.016, 0.058, 0.016), index_at, rot=(0, 0, -3), m=B.GLOVE, bevel=0.007))
    parts.append(B.rbox('thumb_r', (0.017, 0.050, 0.017), thumb_at, rot=(0, 0, 8), m=B.GLOVE, bevel=0.007))
    parts += B.arm('arm_r', G @ Vector((0.012, -0.03, -0.05)), dir_r)
    return B.join(parts, 'hand_r')

def left_hand(H):
    """Левая ладонь под цевьём; H — точка на низу цевья (как у автомата в build.py)."""
    Lm = Matrix.Translation(H)
    parts = [B.rbox('palm_l', (0.050, 0.080, 0.026), (-0.004, 0, -0.016), m=B.GLOVE, bevel=0.010, parent_mtx=Lm)]
    for y in (0.026, 0.004, -0.018, -0.038):
        parts.append(B.rbox('finger_l', (0.018, 0.020, 0.050), (-0.025, y + 0.006, 0.012), rot=(0, -12, 0), m=B.GLOVE, bevel=0.008, parent_mtx=Lm))
    parts.append(B.rbox('thumb_l', (0.016, 0.056, 0.017), (0.026, 0.012, 0.010), m=B.GLOVE, bevel=0.007, parent_mtx=Lm))
    parts += B.arm('arm_l', Vector(H) + Vector((-0.012, -0.045, -0.035)), (-0.30, -0.75, -0.80))
    return B.join(parts, 'hand_l')

def bolt_rifle():
    wood = B.mat('wood', B.srgb(WOOD_K), 0.55); steel = B.mat('steel', B.srgb(STEEL), 0.4, 0.7)
    brass = B.mat('brass', B.srgb(BRASS), 0.35, 0.8); black = B.mat('bore', (0.01, 0.01, 0.01), 0.9)
    A = 0.055                                   # высота оси канала ствола над кулаком
    g = [
        tbox('butt', -0.36, -0.07, (0.022, -0.12, 0.032), (0.018, -0.028, 0.026), wood, 0.008),
        tbox('wrist', -0.07, 0.06, (0.018, -0.028, 0.026), (0.021, -0.032, 0.045), wood, 0.007),
        tbox('body', 0.06, 0.22, (0.023, -0.036, 0.056), (0.023, -0.03, 0.056), wood, 0.006),
        tbox('forend', 0.22, 0.66, (0.023, 0.018, 0.058), (0.018, 0.03, 0.058), wood, 0.006),
        tbox('guard', 0.30, 0.62, (0.016, 0.058, 0.071), (0.013, 0.058, 0.068), wood, 0.004),
        box('buttplate', (-0.023, -0.363, -0.122), (0.023, -0.356, 0.034), steel, 0.002),
        B.tube('barrel', (0, 0.20, A), (0, 0.80, A), 0.0095, 0.0076, steel, sides=16),
        B.tube('receiver', (0, 0.0, A), (0, 0.22, A), 0.0155, 0.0155, steel, sides=16),
        B.tube('ring', (0, 0.17, A), (0, 0.22, A), 0.0172, 0.0172, steel, sides=16),
        B.tube('band1', (0, 0.40, 0.042), (0, 0.415, 0.042), 0.0255, 0.0255, steel, sides=16),
        B.tube('nosecap', (0, 0.635, 0.044), (0, 0.66, 0.044), 0.022, 0.021, steel, sides=16),
        B.tube('bore', (0, 0.799, A), (0, 0.8008, A), 0.0052, 0.0052, black, sides=12),
        # прицел: колодка с прорезью на стволе (низ прорези z 0.091) и мушка на основании у дула (вершина 0.091) —
        # линия прицела 3,6 см над осью канала: глаз над затвором, а не в нём
        box('rs_base', (-0.012, 0.245, 0.062), (0.012, 0.29, 0.071), steel),
        box('rs_l', (-0.012, 0.272, 0.071), (-0.0028, 0.288, 0.095), steel, 0.001),
        box('rs_r', (0.0028, 0.272, 0.071), (0.012, 0.288, 0.095), steel, 0.001),
        box('rs_notch', (-0.0028, 0.272, 0.071), (0.0028, 0.288, 0.091), steel, 0.0005),
        box('fs_base', (-0.006, 0.772, 0.060), (0.006, 0.795, 0.08), steel),
        box('fs_post', (-0.0015, 0.780, 0.078), (0.0015, 0.788, 0.091), steel, 0.0004),
        # спуск и скоба, магазинная крышка
        box('floorplate', (-0.016, 0.085, -0.042), (0.016, 0.195, -0.035), steel),
        box('tg_bottom', (-0.006, 0.0, -0.058), (0.006, 0.085, -0.053), steel, 0.0015),
        box('tg_front', (-0.006, 0.08, -0.058), (0.006, 0.086, -0.03), steel, 0.0015),
        box('tg_back', (-0.006, -0.002, -0.058), (0.006, 0.004, -0.028), steel, 0.0015),
        box('trigger', (-0.003, 0.042, -0.05), (0.003, 0.05, -0.03), steel, 0.0012),
    ]
    gun = B.join(g, 'gun', smooth=False)
    for p in gun.data.polygons:   # круглое — гладко, бруски — плоско
        if gun.data.materials[p.material_index].name != 'wood' and len(p.vertices) > 4: p.use_smooth = True
    # затвор: тело, курок сзади, рукоять вниз-вправо с шаром. Ось вращения — ось канала.
    bo = [B.tube('bolt_body', (0, -0.055, A), (0, 0.17, A), 0.0088, 0.0088, steel, sides=14),
          B.tube('cocking', (0, -0.085, A + 0.002), (0, -0.055, A + 0.002), 0.0075, 0.0095, steel, sides=10),
          box('safety', (-0.0025, -0.07, A + 0.009), (0.0025, -0.06, A + 0.022), steel, 0.001),
          B.tube('handle', (0.006, -0.004, A), (0.046, -0.012, A - 0.024), 0.0042, 0.0038, steel, sides=10),
          sphere('knob', (0.05, -0.014, A - 0.028), 0.0105, steel)]
    bolt = pivot(B.join(bo, 'bolt'), (0, 0, A))
    # обойма: пять патронов друг над другом над открытым затвором (Y — гильза назад, пуля вперёд)
    cl = [box('clip_spine', (-0.0075, 0.085, 0.0), (0.0075, 0.092, 0.06), steel, 0.001)]
    for i in range(5):
        z = 0.006 + i * 0.0115
        cl.append(B.tube(f'case{i}', (0, 0.09, z), (0, 0.147, z), 0.0058, 0.0052, brass, sides=10))
        cl.append(B.tube(f'bullet{i}', (0, 0.147, z), (0, 0.172, z), 0.0042, 0.0012, brass, sides=10))
    clip = B.join(cl, 'clip')
    clip.location = (0, 0, A + 0.022)           # нижний патрон — над окном ствольной коробки
    hr = right_hand(36, (0.024, 0.030, -0.022), (-0.012, 0.018, 0.034), (0.40, -0.55, -0.85))
    hl = left_hand(Vector((0, 0.43, 0.03)))
    empty('muzzle', (0, 0.80, A))
    return dict(nodes=[gun, bolt, clip, hr, hl], length=1.16, sight=((0, 0.091, -0.28), (0, 0.091, -0.784)))

def shotgun():
    wood = B.mat('wood', B.srgb(WOOD_S), 0.5); steel = B.mat('steel', B.srgb(STEEL), 0.4, 0.7)
    action = B.mat('action', B.srgb(ACTION), 0.38, 0.8); black = B.mat('bore', (0.01, 0.01, 0.01), 0.9)
    brass = B.mat('brass', B.srgb(BRASS), 0.35, 0.8); red = B.mat('shell', B.srgb(SHELL), 0.6)
    Z = 0.022                                    # оси стволов над кулаком
    g = [
        tbox('butt', -0.37, -0.07, (0.021, -0.115, 0.03), (0.017, -0.025, 0.025), wood, 0.008),
        tbox('wrist', -0.07, 0.05, (0.017, -0.025, 0.025), (0.02, -0.03, 0.04), wood, 0.007),
        box('action', (-0.021, 0.05, -0.032), (0.021, 0.128, 0.034), action, 0.006),
        box('tang', (-0.006, 0.0, 0.034), (0.006, 0.07, 0.039), action, 0.002),
        box('lever', (-0.004, 0.03, 0.039), (0.012, 0.06, 0.045), steel, 0.002),
        box('tg_bottom', (-0.006, 0.0, -0.058), (0.006, 0.07, -0.053), steel, 0.0015),
        box('tg_front', (-0.006, 0.065, -0.058), (0.006, 0.071, -0.03), steel, 0.0015),
        box('trig1', (-0.003, 0.045, -0.05), (0.003, 0.052, -0.032), steel, 0.0012),
        box('trig2', (-0.003, 0.028, -0.05), (0.003, 0.035, -0.032), steel, 0.0012),
        box('buttplate', (-0.022, -0.373, -0.117), (0.022, -0.366, 0.032), steel, 0.002),
    ]
    gun = B.join(g, 'gun', smooth=False)
    ba = [B.tube('barrel_l', (-0.0105, 0.128, Z), (-0.0105, 0.84, Z), 0.0108, 0.0098, steel, sides=16),
          B.tube('barrel_r', (0.0105, 0.128, Z), (0.0105, 0.84, Z), 0.0108, 0.0098, steel, sides=16),
          B.tube('bore_l', (-0.0105, 0.8395, Z), (-0.0105, 0.8412, Z), 0.0088, 0.0088, black, sides=12),
          B.tube('bore_r', (0.0105, 0.8395, Z), (0.0105, 0.8412, Z), 0.0088, 0.0088, black, sides=12),
          box('rib', (-0.004, 0.13, Z + 0.006), (0.004, 0.838, Z + 0.0135), steel, 0.001),
          box('rib_low', (-0.004, 0.13, Z - 0.013), (0.004, 0.838, Z - 0.007), steel, 0.001),
          sphere('bead', (0, 0.832, Z + 0.016), 0.0022, brass),
          box('lump', (-0.014, 0.128, -0.026), (0.014, 0.2, Z - 0.004), action, 0.003),
          tbox('forend', 0.17, 0.40, (0.024, -0.02, Z), (0.021, -0.012, Z), wood, 0.007)]
    barrels = pivot(B.join(ba, 'barrels', smooth=False), (0, 0.125, -0.028))
    for p in barrels.data.polygons:
        if barrels.data.materials[p.material_index].name != 'wood' and len(p.vertices) > 4: p.use_smooth = True
    sh = []
    for x in (-0.0105, 0.0105):
        sh.append(B.tube('shell', (x, 0.068, Z), (x, 0.124, Z), 0.0093, 0.0093, red, sides=12))
        sh.append(B.tube('head', (x, 0.056, Z), (x, 0.068, Z), 0.0102, 0.0102, brass, sides=12))
    shells = B.join(sh, 'shells')
    shells.location = (0, 0, 0)
    hr = right_hand(30, (0.024, 0.02, -0.022), (-0.012, 0.012, 0.03), (0.40, -0.55, -0.85))
    hl = left_hand(Vector((0, 0.30, -0.016)))
    mz = empty('muzzle', (0, 0.845, Z))
    for c in (hl, shells, mz): parent(c, barrels)
    return dict(nodes=[gun, barrels, shells, hr, hl], length=1.21, sight=((0, 0.036, -0.14), (0, 0.040, -0.832)))

MODELS = {'bolt': (bolt_rifle, (0.13, -0.16, -0.42)), 'shotgun': (shotgun, (0.13, -0.15, -0.42))}

if __name__ == '__main__':
    A_ = sys.argv[sys.argv.index('--')+1:]
    OUT, PREV = A_[0], A_[1]
    for key, (fn, view) in MODELS.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        B.hand_materials()
        info = fn()
        B.export(os.path.join(OUT, key + '.raw.glb'))
        B.preview(key, view, info['length'], PREV)
        print('BUILT', key, 'sight (glTF)', info['sight'])
