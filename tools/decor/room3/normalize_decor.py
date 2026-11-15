# blender -b --python normalize_decor.py -- jobs.json report.json
# Decor GLB contract: metres, floor Y=0, footprint centred at origin, front +Z (glTF), textures <= 1024.
# Unlike tools/sofas/normalize.py: no automatic rotation and no material renaming (IKEA files are already
# front +Z, metres). Per job: in, out, rotY (deg about glTF +Y), standUp (true: picture lying face-up -> face +Z),
# lift {"above": m, "dy": m} (move geometry above a height, e.g. set a height-adjustable desk), maxTris.
import bpy, sys, json, math
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
jobs = json.load(open(args[0]))
report = []
for job in jobs:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=job["in"])
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw; o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o != obj:
            bpy.data.objects.remove(o)
    me = obj.data
    notes = []
    # Blender axes: X = glTF X, Y = glTF -Z, Z = glTF Y
    if job.get("standUp"):
        me.transform(Matrix.Rotation(math.pi / 2, 4, "X"))   # face +Z(Blender up) -> -Y (Blender) = +Z glTF
        notes.append("stood up")
    if job.get("rotY"):
        me.transform(Matrix.Rotation(math.radians(job["rotY"]), 4, "Z"))
        notes.append("rotY %s" % job["rotY"])
    co = np.array([v.co[:] for v in me.vertices])
    if job.get("lift"):
        a, dy = job["lift"]["above"], job["lift"]["dy"]
        mn0 = co[:, 2].min()
        for v in me.vertices:
            if v.co.z - mn0 > a:
                v.co.z += dy
        notes.append("lifted geometry above %.2f by %.3f" % (a, dy))
        co = np.array([v.co[:] for v in me.vertices])
    mn, mx = co.min(0), co.max(0)
    c = (mn + mx) / 2
    me.transform(Matrix.Translation(Vector((-c[0], -c[1], -mn[2]))))
    if job.get("scale"):
        s = job["scale"]; me.transform(Matrix.Diagonal(Vector((s[0], s[2], s[1], 1.0))))
        notes.append("scale %s" % s)
    me.update()
    co = np.array([v.co[:] for v in me.vertices])
    size = (co.max(0) - co.min(0))
    tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
    mt = job.get("maxTris", 40000)
    if tris0 > mt:
        mod = obj.modifiers.new("dec", "DECIMATE"); mod.ratio = mt / tris0; mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier="dec")
        notes.append("decimated %d -> %d" % (tris0, sum(len(p.vertices) - 2 for p in me.polygons)))
    for img in bpy.data.images:
        if img.size[0] > 1024 or img.size[1] > 1024:
            k = 1024 / max(img.size[0], img.size[1])
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
            notes.append("texture %s -> <=1024" % img.name)
    fmt = "WEBP" if all(i.channels >= 3 for i in bpy.data.images if i.size[0] > 0) else "AUTO"
    bpy.ops.export_scene.gltf(filepath=job["out"], export_format="GLB", export_image_format=fmt,
                              export_image_quality=85, export_draco_mesh_compression_enable=False,
                              export_yup=True, export_apply=True, export_animations=False,
                              export_extras=False, export_cameras=False, export_lights=False)
    rec = {"in": job["in"], "out": job["out"], "W": round(float(size[0]), 4), "D": round(float(size[1]), 4),
           "H": round(float(size[2]), 4), "tris": sum(len(p.vertices) - 2 for p in me.polygons),
           "materials": [m.name for m in me.materials if m], "notes": notes}
    report.append(rec)
    print("NORM", json.dumps(rec), flush=True)
json.dump(report, open(args[1], "w"), indent=1)
