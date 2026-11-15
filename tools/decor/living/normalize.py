# Нормализация мебели IKEA для обстановки гостиной (вариант tools/sofas/normalize.py без логики диванов).
# blender -b --python normalize.py -- jobs.json report.json
# job: {"in": raw.glb, "out": out.glb, "W": м, "D": м, "H": м,
#       "rotX": градусы (настенные модели IKEA лежат спиной на полу: 90 ставит их вертикально),
#       "rotZ": градусы (если перед не в +Z), "keepScale": true (модель уже в метрах — W/D/H только для отчёта),
#       "uniform": true (масштаб по ширине W), "maxTris": 60000}
# Контракт GLB: метры, пол Y=0, центр следа в 0, ширина по X, перед в +Z (glTF), текстуры <= 1024.
# В отчёте "levels" — высоты верхних граней горизонтальных полок внутри корпуса (для раскладки книг).
import bpy, sys, json, math
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
jobs = json.load(open(args[0]))
report = []


def shelf_levels(me, W, D, H):
    """Верхние грани полок: горизонтальные грани, смотрящие вверх, шириной > 40% корпуса, сгруппированные по высоте."""
    zs = {}
    for p in me.polygons:
        if p.normal.z < 0.95:
            continue
        z = round(p.center.z, 3)
        xs = [me.vertices[v].co.x for v in p.vertices]
        zs.setdefault(z, []).append((min(xs), max(xs), p.area))
    out = []
    for z, spans in sorted(zs.items()):
        area = sum(a for _, _, a in spans)
        if area > 0.25 * W * D * 0.3 and 0.01 < z < H - 0.005:
            out.append(round(z, 3))
    # слить близкие (толщина кромки)
    merged = []
    for z in out:
        if merged and z - merged[-1] < 0.03:
            merged[-1] = z
        else:
            merged.append(z)
    return merged


for job in jobs:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=job["in"])
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
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
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o != obj:
            bpy.data.objects.remove(o)
    me = obj.data
    co = np.array([v.co[:] for v in me.vertices])
    raw = (co.max(0) - co.min(0)).tolist()
    # glTF +Z (перед) = Blender -Y; rotZ поворачивает вокруг вертикали
    if job.get("rotX"):
        me.transform(Matrix.Rotation(math.radians(job["rotX"]), 4, "X"))
    if job.get("rotZ"):
        me.transform(Matrix.Rotation(math.radians(job["rotZ"]), 4, "Z"))
    co = np.array([v.co[:] for v in me.vertices])
    mn, mx = co.min(0), co.max(0)
    size = mx - mn
    target = np.array([job["W"], job["D"], job["H"]])
    s = target / size
    if job.get("keepScale"):
        s = np.ones(3)
    elif job.get("uniform"):
        s = np.full(3, float(target[0] / size[0]))
    c = (mn + mx) / 2
    me.transform(Matrix.Translation(Vector((-c[0], -c[1], -mn[2]))))
    me.transform(Matrix.Diagonal(Vector((s[0], s[1], s[2], 1.0))))
    me.update()
    co = np.array([v.co[:] for v in me.vertices])
    final = (co.max(0) - co.min(0)).tolist()
    tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
    notes = []
    if tris0 > job.get("maxTris", 60000):
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.ratio = job.get("maxTris", 60000) / tris0
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier="dec")
        notes.append("decimated %d" % tris0)
    for img in bpy.data.images:
        if img.size[0] > 1024 or img.size[1] > 1024:
            k = 1024 / max(img.size[0], img.size[1])
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
    levels = shelf_levels(me, *final)
    bpy.ops.export_scene.gltf(
        filepath=job["out"], export_format="GLB", use_selection=False,
        export_image_format=job.get("fmt", "WEBP"), export_image_quality=85,
        export_draco_mesh_compression_enable=False, export_yup=True,
        export_apply=True, export_animations=False, export_extras=False,
        export_cameras=False, export_lights=False)
    rec = {"in": job["in"], "out": job["out"], "rawSize": [round(x, 4) for x in raw],
           "final": [round(x, 4) for x in final], "scale": [round(float(x), 4) for x in s],
           "levels": levels, "materials": [m.name for m in me.materials if m],
           "tris": sum(len(p.vertices) - 2 for p in me.polygons), "notes": notes}
    report.append(rec)
    print("NORMALIZED", json.dumps(rec), flush=True)

json.dump(report, open(args[1], "w"), indent=1)
