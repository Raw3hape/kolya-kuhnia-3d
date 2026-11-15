# blender -b --python tools/decor/thumb.py -- jobs.json
# Миниатюра для панели (256×256 jpg) и проверочные виды. job: {"glb": path, "out": .jpg|.png, "size": 256,
#   "view": "front3q" (по умолчанию, перед +Z glTF чуть сверху и сбоку) | "front" | "side" | "top"}.
# Кадр строится по габаритам модели, фон светлый нейтральный, как у миниатюр диванов.
import bpy, sys, json, math
from mathutils import Vector

VIEWS = {"front3q": (0.55, -1.0, 0.42), "front": (0.0, -1.0, 0.08), "side": (1.0, 0.0, 0.1), "top": (0.0, -0.05, 1.0)}

for job in json.load(open(sys.argv[sys.argv.index("--") + 1])):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    n = job.get("size", 256)
    sc.render.resolution_x = sc.render.resolution_y = n
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.93, 0.92, 0.9, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    sc.world = world
    bpy.ops.import_scene.gltf(filepath=job["glb"])
    objs = [o for o in sc.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    ctr, r = (mn + mx) / 2, (mx - mn).length / 2
    d = Vector(VIEWS[job.get("view", "front3q")]).normalized()
    bpy.ops.object.camera_add(location=ctr + d * (r / math.tan(math.radians(17)) * 1.02))
    cam = sc.camera = bpy.context.active_object
    cam.data.lens = 58
    cam.data.clip_end = 100
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.light_add(type="SUN", location=(2, -3, 5))
    sun = bpy.context.active_object
    sun.data.energy = 2.2
    sun.rotation_euler = (math.radians(42), math.radians(8), math.radians(28))
    bpy.ops.object.light_add(type="AREA", location=tuple(ctr + Vector((-1.5, -2.5, 1.5)) * max(r, 0.3)))
    a = bpy.context.active_object
    a.data.energy = 120 * max(r, 0.3) ** 2
    a.data.size = 3 * max(r, 0.3)
    a.rotation_euler = (ctr - a.location).to_track_quat("-Z", "Y").to_euler()
    jpg = job["out"].endswith(".jpg")
    sc.render.image_settings.file_format = "JPEG" if jpg else "PNG"
    if jpg:
        sc.render.image_settings.quality = 85
    sc.render.filepath = job["out"]
    bpy.ops.render.render(write_still=True)
    print("RENDERED", job["out"], flush=True)
