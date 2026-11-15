# Сборка вьюмоделей: ствол Quaternius (CC0) + процедурные перчатки и рукава. blender -b --python build.py -- <dl> <out> <preview>
# Помощники (mat, rbox, tube, fist, arm, hand_materials, export, preview) берёт и procedural.py — процедурные винтовка и двустволка.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix, Euler
R = math.radians

GUNS = {
  # orig: исходные единицы (ствол +X, верх +Z); grip — центр рукояти; muzzle — дуло; slant — наклон рукояти, °
  'pistol': dict(src='Jyn9qex4ba', length=0.20, grip=(-0.08, -0.06), muzzle=(1.48, 0.62), slant=16,
                 view=(0.115, -0.125, -0.30)),
  'rifle':  dict(src='Bgvuu4CUMV', length=0.86, grip=(-0.13, -0.08), muzzle=(3.61, 0.64), slant=20,
                 guard=(2.05, 0.46), view=(0.14, -0.20, -0.56), cut=-0.62),   # cut: приклад у плеча вне кадра — срезан
}

def mat(name, rgb, rough, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    return m

def srgb(h):
    c = [int(h[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def rbox(name, size, loc, rot=(0, 0, 0), bevel=0.006, m=None, parent_mtx=Matrix(), seg=3):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object; o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        md = o.modifiers.new('b', 'BEVEL'); md.width = min(bevel, min(size) * 0.48); md.segments = seg
        bpy.ops.object.modifier_apply(modifier='b')
    o.matrix_world = parent_mtx @ Matrix.Translation(loc) @ Euler(tuple(R(a) for a in rot)).to_matrix().to_4x4()
    o.data.materials.append(m)
    return o

def tube(name, a, b, r0, r1, m, sides=10):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r0, radius2=r1, depth=d.length, end_fill_type='NGON')
    o = bpy.context.active_object; o.name = name
    md = o.modifiers.new('b', 'BEVEL'); md.width = min(r0, r1) * 0.25; md.segments = 1
    bpy.ops.object.modifier_apply(modifier='b')
    o.matrix_world = Matrix.Translation((a + b) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    o.data.materials.append(m)
    return o

GLOVE = None; SLEEVE = None; CUFF = None

def fist(side, G, fingers_front=True):
    """Кулак вокруг рукояти. G — матрица рамки рукояти (ось Z вдоль рукояти). side = +1 правая."""
    parts = []
    parts.append(rbox('fist', (0.044, 0.054, 0.082), (0.005 * side, -0.004, -0.004), m=GLOVE, bevel=0.016, parent_mtx=G))
    for i, z in enumerate((0.024, 0.004, -0.016, -0.034)):   # четыре пальца спереди рукояти
        if i == 0 and not fingers_front: continue
        parts.append(rbox('finger', (0.042, 0.020, 0.019), (0.003 * side, 0.030, z), m=GLOVE, bevel=0.0095, parent_mtx=G))
    return parts

def arm(name, wrist, direction, r_wrist=0.025, length=0.45):
    d = Vector(direction).normalized(); w = Vector(wrist)
    parts = [tube(name + '_wrist', w + d * -0.01, w + d * 0.035, r_wrist, r_wrist * 1.05, GLOVE),
             tube(name + '_cuff', w + d * 0.03, w + d * 0.065, r_wrist * 1.4, r_wrist * 1.44, CUFF, sides=16),
             tube(name + '_sleeve', w + d * 0.06, w + d * length, r_wrist * 1.36, r_wrist * 1.8, SLEEVE, sides=16)]
    return parts

def hand_materials():
    global GLOVE, SLEEVE, CUFF
    GLOVE = mat('glove', srgb('#4a4640'), 0.7)
    SLEEVE = mat('sleeve', srgb('#5c5f62'), 0.92)
    CUFF = mat('cuff', srgb('#45484b'), 0.88)

def join(parts, name, smooth=True):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object; o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for p in o.data.polygons: p.use_smooth = smooth
    return o

def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)

def preview(key, view, length, prev):
    """Превью «из глаз» (камера там, где её поставит viewmodel.js, view = WEAPONS[*].pos) и вид сбоку справа."""
    vx, vy, vz = view
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.sensor_fit = 'VERTICAL'; cam.data.angle = R(50); cam.data.clip_start = 0.01
    cam.location = (-vx, vz, -vy)           # glTF (x, y, z) -> Blender (x, -z, y), камера = минус смещение
    cam.rotation_euler = (R(90), 0, 0)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 3; sun.rotation_euler = (R(50), R(-20), R(30))
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.72, 0.68, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1280, 800
    sc.render.filepath = os.path.join(prev, key + '_fpv.png')
    bpy.ops.render.render(write_still=True)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = length * 1.6
    cam.location = (1.0, length * 0.25, 0); cam.rotation_euler = (R(90), 0, R(90))
    sc.render.filepath = os.path.join(prev, key + '_side.png')
    bpy.ops.render.render(write_still=True)

def build(key, cfg, DL, OUT, PREV):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    hand_materials()
    bpy.ops.import_scene.gltf(filepath=os.path.join(DL, cfg['src'] + '.glb'))
    gun = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
    mw = gun.matrix_world.copy()
    gun.parent = None; gun.matrix_world = mw
    for o in [o for o in bpy.context.scene.objects if o.type == 'EMPTY']: bpy.data.objects.remove(o)
    bpy.context.view_layer.objects.active = gun; gun.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    xs = [v.co.x for v in gun.data.vertices]
    s = cfg['length'] / (max(xs) - min(xs))
    if 'cut' in cfg:
        bm = bmesh.new(); bm.from_mesh(gun.data)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(cfg['cut'], 0, 0), plane_no=(1, 0, 0), clear_inner=True)
        cut_edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)   # срез закрыт крышкой
        bm.to_mesh(gun.data); bm.free()
    gx, gz = cfg['grip']
    # исходный ствол +X -> Blender +Y (в glTF это −Z, «вперёд»); начало координат — центр рукояти
    T = Matrix.Rotation(R(90), 4, 'Z') @ Matrix.Scale(s, 4) @ Matrix.Translation((-gx, 0, -gz))
    gun.data.transform(T); gun.name = 'gun'
    mz = T @ Vector((cfg['muzzle'][0], 0, cfg['muzzle'][1]))
    muzzle = bpy.data.objects.new('muzzle', None); muzzle.location = mz; bpy.context.scene.collection.objects.link(muzzle)
    G = Matrix.Rotation(R(-cfg['slant']), 4, 'X')    # рамка рукояти: низ уходит назад
    parts = fist(+1, G)
    # указательный палец вдоль рамки над спусковой скобой (палец вне спуска), большой — слева
    top = 0.034 if key == 'pistol' else 0.040
    parts.append(rbox('index_r', (0.016, 0.062, 0.016), (0.024, 0.040, top), rot=(0, 0, -3), m=GLOVE, bevel=0.007))
    parts.append(rbox('thumb_r', (0.017, 0.050, 0.017), (-0.024, 0.016, top + 0.006), rot=(0, 0, 4), m=GLOVE, bevel=0.007))
    wrist_r = G @ Vector((0.012, -0.03, -0.05))
    if key == 'pistol':
        dir_r = (0.32, -1.0, -0.42)
        # опорная левая рука охватывает правую слева-снизу, большой палец вперёд вдоль рамки
        L = G @ Matrix.Translation((-0.030, 0.012, -0.012))
        parts.append(rbox('palm_l', (0.026, 0.064, 0.076), (0, 0, 0), m=GLOVE, bevel=0.012, parent_mtx=L))
        for z in (0.016, -0.006, -0.028):
            parts.append(rbox('finger_l', (0.054, 0.020, 0.019), (0.016, 0.042, z), m=GLOVE, bevel=0.0095, parent_mtx=L))
        parts.append(rbox('thumb_l', (0.017, 0.058, 0.017), (-0.026, 0.040, top - 0.012), rot=(0, 0, 2), m=GLOVE, bevel=0.007))
        wrist_l = G @ Vector((-0.045, -0.026, -0.05))
        dir_l = (-0.42, -1.0, -0.40)
    else:
        hx, hz = cfg['guard']
        H = T @ Vector((hx, 0, hz))       # низ цевья
        Lm = Matrix.Translation(H)
        parts.append(rbox('palm_l', (0.050, 0.080, 0.026), (-0.004, 0, -0.016), m=GLOVE, bevel=0.010, parent_mtx=Lm))
        for y in (0.026, 0.004, -0.018, -0.038):    # пальцы охватывают цевьё слева
            parts.append(rbox('finger_l', (0.018, 0.020, 0.050), (-0.025, y + 0.006, 0.012), rot=(0, -12, 0), m=GLOVE, bevel=0.008, parent_mtx=Lm))
        parts.append(rbox('thumb_l', (0.016, 0.056, 0.017), (0.024, 0.012, 0.006), m=GLOVE, bevel=0.007, parent_mtx=Lm))
        wrist_l = H + Vector((-0.012, -0.045, -0.035))
        dir_l = (-0.30, -0.75, -0.80)
        dir_r = (0.40, -0.55, -0.85)
    parts += arm('arm_r', wrist_r, dir_r)
    parts += arm('arm_l', wrist_l, dir_l)
    # руки — один меш (два материала), ствол — свой меш
    join(parts, 'hands')
    for p in gun.data.polygons: p.use_smooth = False
    for s_ in gun.material_slots:   # почти чёрный Quaternius в комнате читается пятном: чуть приподнять
        b = s_.material.node_tree.nodes['Principled BSDF'].inputs['Base Color']
        b.default_value = tuple(c * 0.85 + 0.03 for c in b.default_value[:3]) + (1,)
    export(os.path.join(OUT, key + '.raw.glb'))
    preview(key, cfg['view'], cfg['length'], PREV)
    print('BUILT', key, 'muzzle', tuple(round(v, 4) for v in mz), 'scale', round(s, 4))

if __name__ == '__main__':
    A = sys.argv[sys.argv.index('--')+1:]
    for k, c in GUNS.items(): build(k, c, *A[:3])
