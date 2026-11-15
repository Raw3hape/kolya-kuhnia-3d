# Сборка вьюмоделей (руки + оружие) для web/js/viewmodel.js. Источники и лицензии: web/models/viewmodel/SOURCE.md.
#   blender -b --python tools/viewmodel/build.py -- <папка со скачанными GLB (<id>.glb)> <out> [pistol rifle bolt shotgun]
#   затем для каждого: npx -y @gltf-transform/cli@4 meshopt <out>/<id>.raw.glb web/models/viewmodel/<id>.glb
# Пистолет и автомат — готовые риги J-Toastie (руки + оружие, клипы Idle/Shoot/Reload): только нормализация.
# Винтовка и двустволка — те же руки (риг автомата, без автомата) + чужой ствол; клипы idle/shoot/reload (у двустволки
# без shoot) собираются здесь: части ствола висят на новых костях, руки ведутся IK к пустышкам, результат запекается в кости.
# Кости импортируются «по детям» (bone_heuristic FORTUNE): хвост предплечья = запястье, иначе IK тянет локоть.
# Контракт GLB (читает viewmodel.js):
#   метры, ствол смотрит в −Z (glTF), верх +Y, начало координат — спусковой крючок;
#   клипы idle (поза держания: кадр 0), shoot, reload; пустышки muzzle (дуло), sight_rear и sight_front (линия прицела,
#   висят на кости оружия). Скелет и меши — как у источника.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
R = math.radians

SRC = {
    'akm': 'U6l6wjxFhC',      # J-Toastie «Fps Rig AKM», CC-BY 3.0
    'glock': 'uxko5LkGia',    # J-Toastie «Fps Rig», CC-BY 3.0
    'kar': 'ntijptIGIw',      # AdamKokrito «Kar98k», CC-BY 3.0
    'sawn': '29FXKu7G91',     # Quaternius «Shotgun Sawed Off», CC0
}
# длина ствола в жизни, м (по ней масштаб); rear — где искать целик: доля длины от казны (min, max)
GUNS = {
    'pistol': dict(rig='glock', mesh='Glock19', length=0.187, rear=(0.0, 0.25), clips={'Idle': 'idle', 'Shoot': 'shoot', 'Reload': 'reload'}),
    'rifle': dict(rig='akm', mesh='AKM_model', length=0.88, rear=(0.35, 0.55), clips={'Idle': 'idle', 'Shoot': 'shoot', 'Reload': 'reload'}),
    'bolt': dict(rig='akm', gun='kar', length=1.11, rear=(0.30, 0.45)),
    'shotgun': dict(rig='akm', gun='sawn', length=0.60, rear=(0.0, 0.3)),
}
FPS = 24


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def imp(path):
    before = set(bpy.data.objects)
    # без «угадывания» исходной позы: иначе FBX-риги собираются не так, как их видит three.js
    bpy.ops.import_scene.gltf(filepath=path, guess_original_bind_pose=False, bone_heuristic='FORTUNE')
    return [o for o in bpy.data.objects if o not in before]


def armature():
    return next(o for o in bpy.data.objects if o.type == 'ARMATURE')


def use_action(arm, act, frame=0):
    ad = arm.animation_data or arm.animation_data_create()
    for t in ad.nla_tracks: t.mute = True
    ad.action = act
    if act and act.slots: ad.action_slot = act.slots[0]
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def world_verts(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        e = o.evaluated_get(dg); m = e.to_mesh()
        pts += [e.matrix_world @ v.co for v in m.vertices]
        e.to_mesh_clear()
    return pts


def world_bvh(objs):
    """Дерево треугольников в мире (поза кадра) — чтобы мерить поверхность ствола лучом, а не по редким вершинам."""
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for o in objs:
        e = o.evaluated_get(dg); m = e.to_mesh(); n = len(verts)
        verts += [e.matrix_world @ v.co for v in m.vertices]
        polys += [[n + i for i in p.vertices] for p in m.polygons]
        e.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


def under(bvh, x, y):
    """Низ ствола в точке (x, y): первое попадание луча снизу вверх."""
    hit = bvh.ray_cast(Vector((x, y, -100)), Vector((0, 0, 1)))[0]
    return hit.z


def bone_world(arm, name):
    return arm.matrix_world @ arm.pose.bones[name].head


def add_empty(name, loc, arm, bone):
    """Пустышка в точке loc (мир), висит на кости bone — едет вместе с оружием в клипах."""
    e = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(e)
    e.empty_display_size = 0.5
    e.parent = arm; e.parent_type = 'BONE'; e.parent_bone = bone
    bpy.context.view_layer.update()
    e.matrix_world = Matrix.Translation(loc)
    return e


def sights(pts, length, rear):
    """Мушка — самая высокая точка в передних 12 % длины; целик — самая высокая в доле rear. Ствол вдоль +X, верх +Z."""
    x0 = min(p.x for p in pts); L = max(p.x for p in pts) - x0
    def top(a, b):
        sel = [p for p in pts if x0 + a * L <= p.x <= x0 + b * L]
        z = max(p.z for p in sel); near = [p for p in sel if p.z > z - 0.02 * L]
        return Vector((sum(p.x for p in near) / len(near), sum(p.y for p in near) / len(near), z))
    return top(*rear), top(0.88, 1.0)


def muzzle_point(pts):
    xm = max(p.x for p in pts); L = xm - min(p.x for p in pts)
    front = [p for p in pts if p.x > xm - 0.01 * L]
    return Vector((xm, sum(p.y for p in front) / len(front), (min(p.z for p in front) + max(p.z for p in front)) / 2))


def normalize(arm, trigger, scale):
    """Корень сцены: спуск в начало координат, +X ствола -> +Y Blender (−Z glTF), метры."""
    root = arm.parent
    root.name = 'gun'
    root.matrix_world = Matrix.Scale(scale, 4) @ Matrix.Rotation(R(90), 4, 'Z') @ Matrix.Translation(-trigger)


def export(path):
    for o in list(bpy.data.objects):
        if o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
    arm = armature()
    ad = arm.animation_data
    ad.action = None
    for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
    for a in bpy.data.actions:     # каждый клип — дорожка NLA: экспорт берёт их по имени
        tr = ad.nla_tracks.new(); tr.name = a.name
        st = tr.strips.new(a.name, int(a.frame_range[0]), a)
        if a.slots: st.action_slot = a.slots[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_skins=True, export_apply=False,
                              export_force_sampling=True, export_frame_range=False)


def build_rig(key, cfg, DL, OUT):
    reset()
    imp(os.path.join(DL, SRC[cfg['rig']] + '.glb'))
    arm = armature()
    for a in list(bpy.data.actions):
        short = a.name.split('|')[-1]
        if short in cfg['clips']: a.name = cfg['clips'][short]
        else: bpy.data.actions.remove(a)
    use_action(arm, bpy.data.actions['idle'])
    gun = bpy.data.objects[cfg['mesh']]
    pts = world_verts([gun])
    span = max(p.x for p in pts) - min(p.x for p in pts)
    s = cfg['length'] / span
    rear, front = sights(pts, span, cfg['rear'])
    add_empty('muzzle', muzzle_point(pts), arm, 'Root')
    add_empty('sight_rear', rear, arm, 'Root')
    add_empty('sight_front', front, arm, 'Root')
    normalize(arm, bone_world(arm, 'Trigger'), s)
    export(os.path.join(OUT, key + '.raw.glb'))
    print('BUILT', key, 'scale', round(s, 5), 'span', round(span, 3))



# ---------- сборка из рук автомата и чужого ствола ----------

def rig_hands(DL):
    """Риг автомата без автомата: руки в позе держания (кадр 0 Idle). -> arm, hold, s (м на единицу рига), спуск,
    дерево треугольников автомата (по нему левая рука переезжает на цевьё нового ствола)."""
    reset()
    imp(os.path.join(DL, SRC['akm'] + '.glb'))
    arm = armature()
    base = next(a for a in bpy.data.actions if a.name.endswith('Idle'))
    for a in list(bpy.data.actions):
        if a is not base: bpy.data.actions.remove(a)
    use_action(arm, base)
    akm = bpy.data.objects['AKM_model']
    pts = world_verts([akm])
    s = GUNS['rifle']['length'] / (max(p.x for p in pts) - min(p.x for p in pts))
    trig = bone_world(arm, 'Trigger').copy()
    bvh = world_bvh([akm])
    bpy.data.objects.remove(akm)
    hold = bpy.data.actions.new('idle')
    arm.animation_data.action = hold
    for pb in arm.pose.bones:     # поза кадра 0 — ключом на кадре 0 (дыхание Idle не нужно: покачивание делает код)
        pb.rotation_mode = 'QUATERNION'
        for path in ('location', 'rotation_quaternion', 'scale'): pb.keyframe_insert(path, frame=0, group=pb.name)
    bpy.data.actions.remove(base)
    use_action(arm, hold)
    return arm, hold, s, trig, bvh


def place_gun(path, trig_src, trig_dst, length, s):
    """Ствол из файла (ось +X, верх +Z): длина length м, спуск trig_src (единицы источника) -> trig_dst (мир рига)."""
    objs = [o for o in imp(path) if o.type == 'MESH']
    xs = [(o.matrix_world @ v.co).x for o in objs for v in o.data.vertices]
    k = length / s / (max(xs) - min(xs))
    M = Matrix.Translation(trig_dst) @ Matrix.Scale(k, 4) @ Matrix.Translation(-trig_src)
    for o in objs:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = M @ mw
    for o in [o for o in bpy.data.objects if o.type == 'EMPTY' and o.name.startswith('RootNode.')]: bpy.data.objects.remove(o)
    return {o.name: o for o in objs}, M, k


def pose_space(arm, bone, p):
    """Точка мира в позе кадра -> точка в покое кости-родителя bone (для головы новой кости)."""
    pb = arm.pose.bones[bone]
    a = arm.matrix_world.inverted() @ p
    return arm.matrix_world @ (pb.bone.matrix_local @ pb.matrix.inverted() @ a)


def add_bones(arm, specs):
    """specs: [(имя, родитель, голова, хвост)] в мире (поза кадра 0)."""
    old = {n: par for n, par, h, t in specs}
    base = lambda b: base(old[b]) if b in old else b     # новая кость в покое = в позе: считаем от старого предка
    conv = [(n, par, pose_space(arm, base(par), h), pose_space(arm, base(par), t)) for n, par, h, t in specs]
    bpy.context.view_layer.objects.active = arm; arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    inv = arm.matrix_world.inverted()
    for n, par, h, t in conv:
        b = arm.data.edit_bones.new(n); b.head = inv @ h; b.tail = inv @ t; b.roll = 0
        b.parent = arm.data.edit_bones[par]
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()


def hang(obj, arm, bone):
    mw = obj.matrix_world.copy()
    obj.parent = arm; obj.parent_type = 'BONE'; obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = mw


def empty(name, loc):
    e = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(e)
    e.location = loc
    return e


def ik_arm(arm, side, lower, upper_hint):
    """IK на предплечье (цепь 2) к пустышке ik_<side>, локоть смотрит на pole_<side>; угол полюса подбирается так,
    чтобы поза держания совпала с исходной."""
    pb = arm.pose.bones[lower]
    tail = arm.matrix_world @ pb.tail
    elbow = arm.matrix_world @ pb.head
    shoulder = arm.matrix_world @ arm.pose.bones[upper_hint].head
    mid = (shoulder + tail) / 2
    tgt = empty('ik_' + side, tail.copy())
    pole = empty('pole_' + side, elbow + (elbow - mid).normalized() * 6)
    before = {b.name: (arm.matrix_world @ b.matrix).copy() for b in arm.pose.bones}
    c = pb.constraints.new('IK'); c.target = tgt; c.pole_target = pole; c.chain_count = 2
    best = None
    for ang in range(-180, 180, 5):
        c.pole_angle = R(ang); bpy.context.view_layer.update()
        err = sum(abs(a - b) for n in (lower, upper_hint)
                  for ra, rb in zip(arm.matrix_world @ arm.pose.bones[n].matrix, before[n]) for a, b in zip(ra, rb))
        if best is None or err < best[0]: best = (err, ang)
    c.pole_angle = R(best[1]); bpy.context.view_layer.update()
    print('IK', side, 'pole', best[1], 'err', round(best[0], 4))
    return tgt


def anchor(arm, hand, index):
    """Середина кисти: между запястьем и указательным пальцем."""
    return (arm.matrix_world @ arm.pose.bones[hand].head + arm.matrix_world @ arm.pose.bones[index].head) / 2


def key_matrix(arm, bone, M, frame):
    """Поза кости по матрице в мире; ключ на кадре."""
    bpy.context.scene.frame_set(frame)     # родитель кости — в позе этого кадра
    pb = arm.pose.bones[bone]
    pb.matrix = arm.matrix_world.inverted() @ M
    bpy.context.view_layer.update()
    for path in ('location', 'rotation_quaternion', 'scale'): pb.keyframe_insert(path, frame=frame, group=bone)


def key_loc(obj, loc, frame):
    obj.location = loc; obj.keyframe_insert('location', frame=frame)


def clip(arm, hold, name, end, author):
    """Новый клип: копия позы держания, author(frame-функции) расставляет ключи, IK запекается в кости."""
    act = hold.copy(); act.name = name
    arm.animation_data.action = act
    if act.slots: arm.animation_data.action_slot = act.slots[0]
    targets = [o for o in bpy.data.objects if o.name.startswith('ik_')]
    for o in targets:
        o.animation_data_clear()
        o.animation_data_create(); o.animation_data.action = bpy.data.actions.new(name + '_' + o.name)
    author()
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.objects.active = arm; arm.select_set(True)
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        pb.select = True
    bpy.ops.nla.bake(frame_start=0, frame_end=end, only_selected=True, visual_keying=True, clear_constraints=False,
                     use_current_action=True, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in targets:
        a = o.animation_data.action; o.animation_data_clear(); bpy.data.actions.remove(a)
    return act


def finish_compose(arm, hold, pts, s, trig, cfg, key, OUT):
    """Хвост сборки: idle (поза), снять IK, пустышки прицела и дула, нормализация, экспорт."""
    for pb in arm.pose.bones:
        for c in list(pb.constraints): pb.constraints.remove(c)
    for o in [o for o in bpy.data.objects if o.name.startswith(('ik_', 'pole_'))]: bpy.data.objects.remove(o)
    use_action(arm, hold)
    span = max(p.x for p in pts) - min(p.x for p in pts)
    rear, front = sights(pts, span, cfg['rear'])
    add_empty('muzzle', muzzle_point(pts), arm, 'Root')
    add_empty('sight_rear', rear, arm, 'Root')
    add_empty('sight_front', front, arm, 'Root')
    normalize(arm, trig, s)
    export(os.path.join(OUT, key + '.raw.glb'))
    print('BUILT', key, 'scale', round(s, 5))


def build_bolt(key, cfg, DL, OUT):
    """Kar98k (AdamKokrito) в руках рига: затвор на кости kar_bolt, обойма kar_clip, патроны kar_rounds.
    Клипы: shoot — передёрнуть затвор (поднять, назад, вперёд, опустить); reload — затвор открыть, обойму в паз,
    патроны вниз большим пальцем, затвор закрыть (обойма слетает)."""
    arm, hold, s, trig, akm = rig_hands(DL)
    # точки Kar98k в его единицах: верх спуска, ось затвора (z), зад затвора (x), шар рукояти
    T_SRC, AXIS_Z, BOLT_X, KNOB = Vector((-0.045, 0, 0.096)), 0.583, -0.318, Vector((0.185, -0.326, 0.278))
    parts, M, k = place_gun(os.path.join(DL, SRC['kar'] + '.glb'), T_SRC, trig, cfg['length'], s)
    rounds = [parts[n] for n in parts if n.startswith('Bullet')]
    # обойма в исходнике лежит сбоку — переносим её в паз над открытым затвором (зад патронов у оси затвора)
    rp = [(o.matrix_world @ v.co) for o in rounds + [parts['Clip']] for v in o.data.vertices]
    seat = M @ Vector((0.15, 0, AXIS_Z)) - Vector((min(p.x for p in rp), (min(p.y for p in rp) + max(p.y for p in rp)) / 2, min(p.z for p in rp)))
    for o in rounds + [parts['Clip']]: o.matrix_world = Matrix.Translation(seat) @ o.matrix_world
    axis0 = M @ Vector((BOLT_X, 0, AXIS_Z)); fwd = Vector((1, 0, 0))
    clip0 = M @ Vector((0.45, 0, AXIS_Z + 0.25))
    add_bones(arm, [('kar_bolt', 'Root', axis0, axis0 + fwd * 3), ('kar_clip', 'Root', clip0, clip0 + fwd * 2),
                    ('kar_rounds', 'Root', clip0, clip0 + fwd * 2)])
    use_action(arm, hold)
    for n in ('Body', 'Trigger'): hang(parts[n], arm, 'Root')
    hang(parts['Bolt'], arm, 'kar_bolt'); hang(parts['Clip'], arm, 'kar_clip')
    for o in rounds: hang(o, arm, 'kar_rounds')
    pts = world_verts([parts['Body'], parts['Bolt']])
    W = arm.matrix_world
    B0 = W @ arm.pose.bones['kar_bolt'].matrix; C0 = W @ arm.pose.bones['kar_clip'].matrix; P0 = W @ arm.pose.bones['kar_rounds'].matrix
    hidden = Matrix.Scale(0.001, 4)
    # поза держания: затвор закрыт, обоймы нет
    key_matrix(arm, 'kar_bolt', B0, 0); key_matrix(arm, 'kar_clip', C0 @ hidden, 0); key_matrix(arm, 'kar_rounds', P0 @ hidden, 0)

    knob0 = M @ KNOB
    travel = 0.10 / s
    def bolt_m(lift, back):
        """Затвор: поворот вокруг своей оси на lift (0–1 = 0–90°, рукоять вверх), отвод назад на back (0–1)."""
        return Matrix.Translation(-fwd * travel * back) @ Matrix.Translation(axis0) @ Matrix.Rotation(R(-90 * lift), 4, 'X') @ Matrix.Translation(-axis0) @ B0
    def knob(lift, back):
        return (Matrix.Translation(-fwd * travel * back) @ Matrix.Translation(axis0) @ Matrix.Rotation(R(-90 * lift), 4, 'X') @ Matrix.Translation(-axis0)) @ knob0

    # левая рука: на цевьё Kar98k — чуть дальше вперёд (ствол длиннее) и на высоту его цевья
    aL = anchor(arm, 'Hand.L', 'Index.L')
    dx = 1.0
    kar = world_bvh([parts['Body']])
    dz = under(kar, aL.x + dx + 1, trig.y) - under(akm, aL.x + 1, trig.y)
    ikL = ik_arm(arm, 'L', 'LowerArm.L', 'UpperArm.L'); holdL = ikL.location + Vector((dx, 0, dz))
    ikR = ik_arm(arm, 'R', 'LowerArm.R.001', 'UpperArm.R.001'); holdR = ikR.location.copy()
    # точка в кулаке: шейка приклада под серединой кисти; хват за шар = кулак переносится на шар как есть
    hit, nrm = kar.find_nearest(anchor(arm, 'Hand.R.001', 'Index.R.001'))[:2]
    offR = holdR - (hit - nrm * 0.4)
    grab = lambda p: p + offR
    side = Vector((0, -2.5, -4.5))                                  # рука уходит вниз-вправо за обоймой

    def cycle():
        key_loc(ikL, holdL, 0)
        for f, h in ((0, holdR), (4, grab(knob(0, 0))), (7, grab(knob(1, 0))), (10, grab(knob(1, 1))), (12, grab(knob(1, 1))),
                     (14, grab(knob(1, 0))), (16, grab(knob(0, 0))), (20, holdR)):
            key_loc(ikR, h, f)
        for f, l, b in ((0, 0, 0), (4, 0, 0), (7, 1, 0), (10, 1, 1), (12, 1, 1), (14, 1, 0), (16, 0, 0), (20, 0, 0)):
            key_matrix(arm, 'kar_bolt', bolt_m(l, b), f)
    clip(arm, hold, 'shoot', 20, cycle)

    up = Matrix.Translation(Vector((0, -1.2, 3.2)))
    def load():
        key_loc(ikL, holdL, 0)
        top = lambda C: (C @ Vector((0, 0, 0))) + Vector((0, 0, 1.0))
        seatH = grab(top(C0)) + Vector((0.3, 0.2, 0.3))
        for f, h in ((0, holdR), (5, grab(knob(0, 0))), (9, grab(knob(1, 0))), (13, grab(knob(1, 1))), (17, holdR + side),
                     (22, grab(top(up @ C0))), (28, seatH), (34, seatH + Vector((0, 0, -0.8))), (40, seatH + Vector((0, 0, -1.6))),
                     (44, grab(knob(1, 1))), (47, grab(knob(1, 0))), (50, grab(knob(0, 0))), (56, holdR), (62, holdR)):
            key_loc(ikR, h, f)
        for f, l, b in ((0, 0, 0), (5, 0, 0), (9, 1, 0), (13, 1, 1), (44, 1, 1), (47, 1, 0), (50, 0, 0), (62, 0, 0)):
            key_matrix(arm, 'kar_bolt', bolt_m(l, b), f)
        fly = Matrix.Translation(Vector((0, -3, 4))) @ Matrix.Translation(C0.translation) @ Matrix.Rotation(R(-40), 4, 'X') @ Matrix.Translation(-C0.translation)
        for f, C in ((0, C0 @ hidden), (20, C0 @ hidden), (21, up @ C0), (22, up @ C0), (28, C0), (46, C0), (50, fly @ C0), (51, fly @ C0 @ hidden), (62, C0 @ hidden)):
            key_matrix(arm, 'kar_clip', C, f)
        drop = Matrix.Translation(Vector((0, 0, -0.62 * k)))
        for f, P in ((0, P0 @ hidden), (20, P0 @ hidden), (21, up @ P0), (22, up @ P0), (28, P0), (30, P0), (40, drop @ P0),
                     (41, drop @ P0 @ hidden), (62, P0 @ hidden)):
            key_matrix(arm, 'kar_rounds', P, f)
    clip(arm, hold, 'reload', 62, load)

    def idle():
        key_loc(ikL, holdL, 0); key_loc(ikR, holdR, 0)
    idle_act = clip(arm, hold, 'idle_baked', 1, idle)
    bpy.data.actions.remove(hold); idle_act.name = 'idle'
    finish_compose(arm, idle_act, pts, s, trig, cfg, key, OUT)


def split(obj, take):
    """Грани, для которых take(материал, центр в мире) истинно, уходят в отдельный объект (меш источника не сварен)."""
    part = obj.copy(); part.data = obj.data.copy(); bpy.context.scene.collection.objects.link(part)
    for o, keep in ((obj, False), (part, True)):
        bm = bmesh.new(); bm.from_mesh(o.data)
        names = [sl.material.name for sl in o.material_slots]; W = o.matrix_world
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if take(names[f.material_index], W @ f.calc_center_median()) != keep],
                         context='FACES')
        bm.to_mesh(o.data); bm.free()
    return part


def shells(centres, radius, length, M):
    """Два патрона 12-го калибра: красная гильза и латунное донце; centres — центры донцев (единицы источника)."""
    def mat(name, rgb, metal):
        m = bpy.data.materials.new(name); m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1)
        b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = 0.5
        return m
    me = bpy.data.meshes.new('shells')
    me.materials.append(mat('ShellRed', (0.5, 0.05, 0.035), 0)); me.materials.append(mat('Brass', (0.6, 0.42, 0.14), 1))
    bm = bmesh.new()
    for c in centres:
        for mi, x0, x1, r in ((1, 0, 0.12, radius * 1.12), (0, 0.12, 1, radius)):
            g = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r, radius2=r, depth=length * (x1 - x0))
            vs = g['verts']
            bmesh.ops.rotate(bm, verts=vs, matrix=Matrix.Rotation(R(90), 3, 'Y'))
            bmesh.ops.translate(bm, verts=vs, vec=c + Vector((length * (x0 + x1) / 2, 0, 0)))
            for f in {f for v in vs for f in v.link_faces}: f.material_index = mi
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('Shells', me); bpy.context.scene.collection.objects.link(o)
    o.matrix_world = M
    return o


def build_shotgun(key, cfg, DL, OUT):
    """Обрез-двустволка (Quaternius) в руках рига: стволы с цевьём на кости sg_barrels (шарнир внизу перед колодкой),
    патроны sg_shells на стволах. Клип reload: переломить, гильзы вылетают, правая рука приносит два патрона,
    досылает, возвращается на рукоять, стволы закрываются. Выстрел — только процедурная отдача в коде."""
    arm, hold, s, trig, akm = rig_hands(DL)
    # точки обреза в его единицах (+X вперёд): верх спуска, шарнир, центры каналов у казны; стволы — металл от казны
    # (x > 0.65: курок и ключ сзади остаются на колодке), цевьё — тёмное дерево перед колодкой (x > 1)
    T_SRC, HINGE, BORE = Vector((0.45, 0, 0.069)), Vector((1.0, 0, 0.28)), (Vector((0.86, -0.1, 0.405)), Vector((0.86, 0.1, 0.405)))
    BREAK = {'DarkMetal': 0.65, 'DarkWood': 1.0}
    parts, M, k = place_gun(os.path.join(DL, SRC['sawn'] + '.glb'), T_SRC, trig, cfg['length'], s)
    body = next(iter(parts.values()))
    barrels = split(body, lambda m, c: m in BREAK and c.x > (M @ Vector((BREAK[m], 0, 0))).x)
    sh = shells(BORE, 0.061, 0.43, M)
    hinge = M @ HINGE; seat = M @ BORE[0]; fwd = Vector((1, 0, 0))
    add_bones(arm, [('sg_barrels', 'Root', hinge, hinge + fwd * 3), ('sg_shells', 'sg_barrels', seat, seat + fwd * 2)])
    use_action(arm, hold)
    hang(body, arm, 'Root'); hang(barrels, arm, 'sg_barrels'); hang(sh, arm, 'sg_shells')
    pts = world_verts([body, barrels])
    W = arm.matrix_world
    G0 = W @ arm.pose.bones['sg_barrels'].matrix; S0 = W @ arm.pose.bones['sg_shells'].matrix
    hidden = Matrix.Scale(0.001, 4)
    key_matrix(arm, 'sg_barrels', G0, 0); key_matrix(arm, 'sg_shells', S0, 0)
    brk = lambda a: Matrix.Translation(hinge) @ Matrix.Rotation(R(a), 4, 'Y') @ Matrix.Translation(-hinge)   # нос вниз

    gun = world_bvh([body, barrels])
    aL = anchor(arm, 'Hand.L', 'Index.L')
    dz = under(gun, aL.x + 1, trig.y) - under(akm, aL.x + 1, trig.y)
    ikL = ik_arm(arm, 'L', 'LowerArm.L', 'UpperArm.L'); holdL = ikL.location + Vector((0, 0, dz))
    ikR = ik_arm(arm, 'R', 'LowerArm.R.001', 'UpperArm.R.001'); holdR = ikR.location.copy()
    hit, nrm = gun.find_nearest(anchor(arm, 'Hand.R.001', 'Index.R.001'))[:2]
    offR = holdR - (hit - nrm * 0.4)          # от точки в кулаке (рукоять) до цели IK: патроны несём так же
    side = Vector((-1.5, -3, -5))             # рука уходит вниз-вправо за патронами
    OPEN = 38

    def load():
        for f, a in ((0, 0), (3, 0), (9, OPEN), (34, OPEN), (39, 0), (48, 0)):
            key_matrix(arm, 'sg_barrels', G0 if a == 0 else brk(a) @ G0, f)
            key_loc(ikL, brk(a) @ holdL, f)
        out = lambda d: Matrix.Translation(Vector((-d * 3, 0, d * 2.5)))     # гильзы назад-вверх (стволы открыты)
        for f, S in ((0, S0), (9, brk(OPEN) @ S0), (10, out(0.15) @ brk(OPEN) @ S0), (13, out(1) @ brk(OPEN) @ S0),
                     (14, out(1) @ brk(OPEN) @ S0 @ hidden), (21, brk(OPEN) @ S0 @ hidden)):
            key_matrix(arm, 'sg_shells', S, f)
        # патроны в руке: на 4 см позади открытой казны, вдоль оси каналов
        in_hand = Matrix.Translation(brk(OPEN).to_3x3() @ -fwd * (0.04 / s)) @ brk(OPEN) @ S0
        for f, S in ((22, in_hand), (25, in_hand), (29, brk(OPEN) @ S0), (34, brk(OPEN) @ S0), (39, S0), (48, S0)):
            key_matrix(arm, 'sg_shells', S, f)
        hand = lambda S: S.translation + offR
        for f, h in ((0, holdR), (8, holdR), (14, holdR + side), (19, holdR + side), (22, hand(in_hand)),
                     (25, hand(in_hand)), (29, hand(brk(OPEN) @ S0)), (35, holdR), (48, holdR)):
            key_loc(ikR, h, f)
    clip(arm, hold, 'reload', 48, load)

    def idle():
        key_loc(ikL, holdL, 0); key_loc(ikR, holdR, 0)
    idle_act = clip(arm, hold, 'idle_baked', 1, idle)
    bpy.data.actions.remove(hold); idle_act.name = 'idle'
    finish_compose(arm, idle_act, pts, s, trig, cfg, key, OUT)


if __name__ == '__main__':
    A = sys.argv[sys.argv.index('--') + 1:]
    DL, OUT = A[:2]
    only = A[2:] or list(GUNS)
    os.makedirs(OUT, exist_ok=True)
    for k in only:
        c = GUNS[k]
        if 'mesh' in c: build_rig(k, c, DL, OUT)
        else: globals()['build_' + k](k, c, DL, OUT)
