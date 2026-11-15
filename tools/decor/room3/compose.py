# blender -b --python compose.py -- jobs.json ; job: {"out": glb, "parts": [{"glb", "pos", "rot"}]} (world coords, first = reference)
import bpy, sys, json, math
for job in json.load(open(sys.argv[sys.argv.index("--") + 1])):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    p0 = job["parts"][0]; r0 = math.radians(p0["rot"])
    for p in job["parts"]:
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=p["glb"])
        new = [o for o in bpy.context.scene.objects if o not in before]
        e = bpy.data.objects.new("grp", None); bpy.context.collection.objects.link(e)
        for o in new:
            if o.parent is None: o.parent = e
        dx, dz = p["pos"][0] - p0["pos"][0], p["pos"][2] - p0["pos"][2]
        t = -r0
        lx = dx * math.cos(t) + dz * math.sin(t); lz = -dx * math.sin(t) + dz * math.cos(t)
        e.location = (lx, -lz, p["pos"][1] - p0["pos"][1])
        e.rotation_euler = (0, 0, math.radians(p["rot"] - p0["rot"]))
    bpy.ops.export_scene.gltf(filepath=job["out"], export_format="GLB", export_yup=True, export_apply=True)
