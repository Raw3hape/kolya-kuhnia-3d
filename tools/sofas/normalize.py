# blender -b --python normalize.py -- jobs.json report.json
# Each job: {"in": raw.glb, "out": out.glb, "W": m, "D": m, "H": m}
# Contract: metres, origin floor centre, width X, depth Z, front +Z (glTF), up +Y,
# upholstery material "fabric", legs "legs", textures <= 1024.
import bpy, bmesh, sys, json, math
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
jobs = json.load(open(args[0]))
report = []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objs():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def world_verts(objs):
    pts = []
    for o in objs:
        m = o.matrix_world
        pts += [m @ v.co for v in o.data.vertices]
    return np.array([[p.x, p.y, p.z] for p in pts])


def leg_islands(obj, H):
    """Face indices of loose parts that look like legs: touch the floor, low, narrow."""
    me = obj.data
    nv = len(me.vertices)
    parent = np.arange(nv)
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for e in me.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            parent[a] = b
    # merge vertices at identical positions (split normals/uv seams duplicate verts)
    co = np.array([v.co[:] for v in me.vertices])
    key = {}
    for i, k in enumerate(map(tuple, np.round(co, 5))):
        if k in key:
            a, b = find(i), find(key[k])
            if a != b:
                parent[a] = b
        else:
            key[k] = i
    roots = np.array([find(i) for i in range(nv)])
    out, tops = [], []
    for r in np.unique(roots):
        idx = np.where(roots == r)[0]
        c = co[idx]
        mn, mx = c.min(0), c.max(0)
        if mn[2] < 0.02 and mx[2] < 0.35 * H and (mx[0] - mn[0]) < 0.30 and (mx[1] - mn[1]) < 0.30:
            out.append(set(idx.tolist()))
            tops.append(float(mx[2]))
    legv = set().union(*out) if out else set()
    faces = [p.index for p in me.polygons if p.vertices[0] in legv]
    return faces, len(out), (max(tops) if tops else 0.0)


for job in jobs:
    print("JOB", job["in"], flush=True)
    reset()
    bpy.ops.import_scene.gltf(filepath=job["in"])
    objs = mesh_objs()
    # flatten hierarchy, bake transforms, join into one mesh
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
    notes = []
    # width must be along X
    if raw[1] > raw[0]:
        me.transform(Matrix.Rotation(math.pi / 2, 4, "Z"))
        notes.append("rotated 90deg")
        co = np.array([v.co[:] for v in me.vertices])
    # back must be at Blender +Y (= glTF -Z); front at Blender -Y (= glTF +Z)
    zmin, zmax = co[:, 2].min(), co[:, 2].max()
    top = co[co[:, 2] > zmin + 0.8 * (zmax - zmin)]
    ymid = (co[:, 1].min() + co[:, 1].max()) / 2
    back_side = float(top[:, 1].mean() - ymid)
    if back_side < 0:
        me.transform(Matrix.Rotation(math.pi, 4, "Z"))
        notes.append("rotated 180deg (front to +Z)")
        co = np.array([v.co[:] for v in me.vertices])
    # scale per axis to IKEA W/D/H, origin at floor centre
    mn, mx = co.min(0), co.max(0)
    size = mx - mn
    s = np.array([job["W"], job["D"], job["H"]]) / size
    c = (mn + mx) / 2
    me.transform(Matrix.Translation(Vector((-c[0], -c[1], -mn[2]))))
    me.transform(Matrix.Diagonal(Vector((s[0], s[1], s[2], 1.0))))
    me.update()
    co = np.array([v.co[:] for v in me.vertices])
    final = (co.max(0) - co.min(0)).tolist()
    # back height: top of geometry in the rear third
    rear = co[co[:, 1] > co[:, 1].max() - (final[1] / 3)]
    backH = float(rear[:, 2].max())
    # materials: opaque main -> fabric (+ legs split), others keep (renamed for clarity)
    mats = [m for m in me.materials]
    area = [0.0] * len(mats)
    for p in me.polygons:
        area[p.material_index] += p.area
    blend = [bool(m) and (m.name.endswith("_1") and "fringe" not in m.name) and m.get("dummy") is None for m in mats]
    # the transparent BLEND material in IKEA files is the fringe; never pick it as main
    opaque = [i for i, m in enumerate(mats) if m and getattr(m, "surface_render_method", "DITHERED") != "BLENDED" and m.blend_method != "BLEND"]
    cand = opaque or list(range(len(mats)))
    main = mats[max(cand, key=lambda i: area[i])]
    renamed = {}
    for i, m in enumerate(mats):
        if m is None:
            continue
        old = m.name
        if m == main:
            m.name = "fabric"
        else:
            m.name = "fabric_fringe" if (m.blend_method == "BLEND" or getattr(m, "surface_render_method", "") == "BLENDED") else "detail_%d" % i
        renamed[old] = m.name
    legf, nisl, lt = leg_islands(obj, job["H"])
    if not legf and job.get("clear"):
        thr = job["clear"] + 0.004
        legf = [p.index for p in me.polygons if max(me.vertices[v].co.z for v in p.vertices) <= thr]
        nisl, lt = -1, thr
    nlegs = 0
    legset = set(legf)
    # a separate material used only on leg parts becomes "legs" as is
    for mi, m in enumerate(me.materials):
        if m is None or m == main:
            continue
        fs = [p.index for p in me.polygons if p.material_index == mi]
        if fs and legset and all(f in legset for f in fs):
            m.name = "legs"
            renamed = {k: ("legs" if v == m.name or k == m.name else v) for k, v in renamed.items()}
            notes.append("material %d is legs" % mi)
    legf = [f for f in legf if me.polygons[f].material_index == list(me.materials).index(main)]
    if legf:
        legs = main.copy()
        legs.name = "legs"
        me.materials.append(legs)
        li = len(me.materials) - 1
        fi = list(me.materials).index(main)
        for i in legf:
            p = me.polygons[i]
            if p.material_index == fi:
                p.material_index = li
                nlegs += 1
    # decimate heavy scans
    tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris0 > job.get("maxTris", 45000):
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.ratio = job.get("maxTris", 45000) / tris0
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier="dec")
        notes.append("decimated %d -> %d tris" % (tris0, sum(len(p.vertices) - 2 for p in me.polygons)))
    # textures <= 1024
    for img in bpy.data.images:
        if img.size[0] > 1024 or img.size[1] > 1024:
            k = 1024 / max(img.size[0], img.size[1])
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
    fmt = job.get("fmt") or ("WEBP" if all(i.channels >= 3 for i in bpy.data.images if i.size[0] > 0) else "AUTO")
    if fmt == "AUTO":
        notes.append("textures kept jpeg/png (1-channel map)")
    bpy.ops.export_scene.gltf(
        filepath=job["out"], export_format="GLB", use_selection=False,
        export_image_format=fmt, export_image_quality=85,
        export_draco_mesh_compression_enable=False, export_yup=True,
        export_apply=True, export_animations=False, export_extras=False,
        export_cameras=False, export_lights=False,
    )
    rec = {"in": job["in"], "out": job["out"], "rawSize": [round(x, 4) for x in raw],
           "final": [round(x, 4) for x in final], "scale": [round(float(x), 4) for x in s],
           "backH": round(backH, 4), "legTop": round(lt, 3), "legFaces": nlegs, "legParts": nisl,
           "backSide": round(back_side, 3), "materials": [m.name for m in me.materials], "notes": notes,
           "tris": sum(len(p.vertices) - 2 for p in me.polygons)}
    report.append(rec)
    print("NORMALIZED", json.dumps(rec), flush=True)
    print("MATS", [m.name for m in me.materials], flush=True)

json.dump(report, open(args[1], "w"), indent=1)
