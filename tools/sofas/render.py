# blender -b --python render.py -- jobs.json
# job: {"glb": path, "out": png/jpg, "mode": "island"|"thumb"|"debug", "size": [w,h]}
import bpy, sys, json, math
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
jobs = json.load(open(args[0]))


def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def mat(name, rgb, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m


for job in jobs:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    w, h = job.get("size", [480, 360])
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.93, 0.93, 0.92, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.45
    sc.world = world
    bpy.ops.import_scene.gltf(filepath=job["glb"])
    objs = [o for o in sc.objects if o.type == "MESH"]
    mn = Vector((min((o.matrix_world @ Vector(c)).x for o in objs for c in o.bound_box),
                 min((o.matrix_world @ Vector(c)).y for o in objs for c in o.bound_box), 0))
    mx = Vector((max((o.matrix_world @ Vector(c)).x for o in objs for c in o.bound_box),
                 max((o.matrix_world @ Vector(c)).y for o in objs for c in o.bound_box),
                 max((o.matrix_world @ Vector(c)).z for o in objs for c in o.bound_box)))
    if job.get("mode") == "debug":
        for o in objs:
            for i, m in enumerate(o.data.materials):
                if m and m.name.startswith("legs"):
                    o.data.materials[i] = mat("dbg_legs", (1, 0, 0))
                elif m and m.name.startswith("detail"):
                    o.data.materials[i] = mat("dbg_det", (0, 0.9, 0.1))
                elif m and m.name.startswith("fabric_fringe"):
                    o.data.materials[i] = mat("dbg_fr", (0, 0.2, 1))
    # floor
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    bpy.context.active_object.data.materials.append(mat("floor", (0.8, 0.79, 0.77), 0.9))
    if job.get("mode") in ("island", "debug"):
        # island 1.80 x 0.60 x 0.90 behind the sofa back (Blender +Y = glTF -Z = back)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, mx.y + 0.30, 0.45))
        isl = bpy.context.active_object
        isl.scale = (1.80, 0.60, 0.90)
        isl.data.materials.append(mat("island", (0.45, 0.45, 0.46), 0.6))
        cam_loc, target, lens = (2.6, -3.6, 1.55), (0, 0.25, 0.45), 42
    else:
        cam_loc, target, lens = (1.9, -2.9, 1.25), (0, 0, (mx.z) * 0.45), 46
    bpy.ops.object.camera_add(location=cam_loc)
    cam = bpy.context.active_object
    cam.data.lens = lens
    look_at(cam, target)
    sc.camera = cam
    bpy.ops.object.light_add(type="SUN", location=(2, -3, 5))
    sun = bpy.context.active_object
    sun.data.energy = 1.6
    sun.rotation_euler = (math.radians(40), math.radians(10), math.radians(30))
    bpy.ops.object.light_add(type="AREA", location=(-2, -2.5, 2.5))
    a = bpy.context.active_object
    a.data.energy = 90
    a.data.size = 3
    look_at(a, (0, 0, 0.4))
    if job["out"].endswith(".jpg"):
        sc.render.image_settings.file_format = "JPEG"
        sc.render.image_settings.quality = 88
    else:
        sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = job["out"]
    bpy.ops.render.render(write_still=True)
    print("RENDERED", job["out"])
