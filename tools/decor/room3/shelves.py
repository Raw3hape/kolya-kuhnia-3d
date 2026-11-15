# blender -b --python shelves.py -- a.glb b.glb ...  -> per model: vertical ray hits (glTF y) at x columns, mid depth
import bpy, sys, json
from mathutils import Vector
from mathutils.bvhtree import BVHTree
for f in sys.argv[sys.argv.index("--") + 1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    dg = bpy.context.evaluated_depsgraph_get()
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    import bmesh
    bm = bmesh.new()
    for o in objs:
        t = bmesh.new(); t.from_mesh(o.data); t.transform(o.matrix_world); 
        me = bpy.data.meshes.new("t"); t.to_mesh(me); bm.from_mesh(me); t.free()
    tree = BVHTree.FromBMesh(bm)
    xs = [v.co.x for v in bm.verts]; W0, W1 = min(xs), max(xs)
    zs = [v.co.z for v in bm.verts]; H = max(zs)
    print("MODEL", f, "x %.3f..%.3f H %.3f" % (W0, W1, H))
    # side panels: horizontal ray along +x at heights
    for hz in [0.5, 1.2, 1.9]:
        hits, o = [], Vector((W0 - 0.1, 0.0, hz))
        while True:
            r = tree.ray_cast(o, Vector((1, 0, 0)), 5)
            if r[0] is None: break
            hits.append(round(r[0].x, 3)); o = r[0] + Vector((0.002, 0, 0))
        print("  panels at y=%.1f:" % hz, hits)
    for x in [W0 + 0.2 + i * 0.4 for i in range(int((W1 - W0) / 0.4) + 1)]:
        if x > W1 - 0.05: x = W1 - 0.2
        hits, o = [], Vector((x, 0.0, H + 0.1))
        while True:
            r = tree.ray_cast(o, Vector((0, 0, -1)), 5)
            if r[0] is None: break
            if r[1].z > 0.5: hits.append(round(r[0].z, 3))
            o = r[0] - Vector((0, 0, 0.002))
        print("  col x=%.2f up-surfaces:" % x, hits)
