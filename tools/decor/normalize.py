# blender -b --python tools/decor/normalize.py -- jobs.json report.json
# Приводит сырой GLB (обычно AR-модель IKEA) к контракту обстановки (web/models/decor/README.md):
# метры, пол Y = 0, центр следа в 0, перед в +Z (оси glTF), реальные габариты, текстуры <= 1024, без анимаций.
# В отличие от tools/sofas/normalize.py материалы не переименовываются: модель остаётся как у производителя.
# job: {"in": raw.glb, "out": out.glb,
#       "rot": [rx, ry, rz]   — градусы вокруг осей glTF, применяются по порядку X, Y, Z до центровки
#                               (настенные вещи IKEA лежат «стеной вниз»: rot [90, 0, 0] ставит их перед в +Z),
#       "W"/"H"/"D": м        — если заданы, модель масштабируется по осям точно под них (иначе масштаб файла),
#       "maxTris": 40000      — тяжелее — прореживается}
import bpy, sys, json, math
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
jobs = json.load(open(args[0]))
report = []

# glTF (x, y, z) = Blender (x, -z, y): поворот вокруг оси glTF — это поворот вокруг соответствующей оси Blender
AXIS = {0: (1, "X"), 1: (1, "Z"), 2: (-1, "Y")}

for job in jobs:
    print("JOB", job["in"], flush=True)
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
    for i, deg in enumerate(job.get("rot", [0, 0, 0])):
        if deg:
            sgn, ax = AXIS[i]
            me.transform(Matrix.Rotation(math.radians(deg) * sgn, 4, ax))
    co = np.array([v.co[:] for v in me.vertices])
    mn, mx = co.min(0), co.max(0)
    c = (mn + mx) / 2
    me.transform(Matrix.Translation(Vector((-c[0], -c[1], -mn[2]))))
    raw = mx - mn   # Blender X, Y, Z = glTF W, D, H
    s = np.ones(3)
    for i, k in ((0, "W"), (1, "D"), (2, "H")):
        if job.get(k):
            s[i] = job[k] / raw[i]
    me.transform(Matrix.Diagonal(Vector((*s, 1.0))))
    me.update()
    tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
    notes = []
    if tris0 > job.get("maxTris", 40000):
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.ratio = job.get("maxTris", 40000) / tris0
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier="dec")
        notes.append("decimated %d -> %d tris" % (tris0, sum(len(p.vertices) - 2 for p in me.polygons)))
    for img in bpy.data.images:
        if img.size[0] > 1024 or img.size[1] > 1024:
            k = 1024 / max(img.size[0], img.size[1])
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
    fmt = "WEBP" if all(i.channels >= 3 for i in bpy.data.images if i.size[0] > 0) else "AUTO"
    bpy.ops.export_scene.gltf(
        filepath=job["out"], export_format="GLB", use_selection=False,
        export_image_format=fmt, export_image_quality=85,
        export_draco_mesh_compression_enable=False, export_yup=True,
        export_apply=True, export_animations=False, export_extras=False,
        export_cameras=False, export_lights=False,
    )
    co = np.array([v.co[:] for v in me.vertices])
    final = co.max(0) - co.min(0)
    rec = {"in": job["in"].split("/")[-1], "out": job["out"], "WHD": [round(float(final[0]), 3), round(float(final[2]), 3), round(float(final[1]), 3)],
           "scale": [round(float(x), 4) for x in (s[0], s[2], s[1])], "tris": sum(len(p.vertices) - 2 for p in me.polygons),
           "materials": [m.name for m in me.materials if m], "notes": notes}
    report.append(rec)
    print("NORMALIZED", json.dumps(rec, ensure_ascii=False), flush=True)

json.dump(report, open(args[1], "w"), indent=1, ensure_ascii=False)
