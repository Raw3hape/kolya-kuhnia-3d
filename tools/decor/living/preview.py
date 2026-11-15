# Проверка моделей со всех сторон и миниатюры.
# blender -b --python preview.py -- jobs.json
# job: {"glb": путь | "glbs": [{"glb", "pos": [x,y,z] glTF, "rot": град}], "out": .png/.jpg,
#       "mode": "sheet" (спереди, сзади, сбоку, сверху, 3/4 — сетка 3×2) | "thumb" (256×256, 3/4 спереди)}
import bpy, sys, json, math
import numpy as np
from mathutils import Vector, Euler

args = sys.argv[sys.argv.index("--") + 1:]
jobs = json.load(open(args[0]))


def setup(w, h):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    sc.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.92, 0.91, 0.89, 1)
    bg.inputs[1].default_value = 0.9
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = Euler((math.radians(50), math.radians(10), math.radians(30)))
    sc.collection.objects.link(sun)
    return sc


def load(job):
    items = job.get("glbs") or [{"glb": job["glb"]}]
    for it in items:
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=it["glb"])
        new = [o for o in bpy.context.scene.objects if o not in before and o.parent is None]
        p = it.get("pos", [0, 0, 0])
        for o in new:
            # glTF (x, y, z) -> Blender (x, -z, y); поворот вокруг вертикали
            o.rotation_mode = "XYZ"
            o.rotation_euler.z += math.radians(it.get("rot", 0))
            o.location = Vector((p[0], -p[2], p[1])) + o.location
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in bpy.context.scene.objects if o.type == "MESH" for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def cam(sc, loc, target, ortho=None, lens=50):
    c = bpy.data.objects.get("cam") or bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    if c.name not in sc.collection.objects:
        sc.collection.objects.link(c)
    c.location = Vector(loc)
    c.rotation_euler = (Vector(target) - c.location).to_track_quat("-Z", "Y").to_euler()
    if ortho:
        c.data.type = "ORTHO"
        c.data.ortho_scale = ortho
    else:
        c.data.type = "PERSP"
        c.data.lens = lens
    c.data.clip_end = 100
    sc.camera = c


def shot(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    a = np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return a


for job in jobs:
    mode = job.get("mode", "sheet")
    if mode == "thumb":
        sc = setup(256, 256)
        sc.render.image_settings.file_format = "JPEG"
    else:
        sc = setup(420, 420)
        sc.render.image_settings.file_format = "PNG"
    mn, mx = load(job)
    c = (mn + mx) / 2
    size = mx - mn
    r = max(size) * 0.5
    tmp = job["out"] + ".tmp.png" if mode != "thumb" else job["out"]
    if mode == "thumb":
        d = r * 3.2 + 0.3
        cam(sc, c + Vector((d * 0.55, -d * 0.85, d * 0.35)), c, lens=50)
        sc.render.filepath = job["out"]
        bpy.ops.render.render(write_still=True)
        continue
    ext = max(size) * 1.15
    views = [
        (c + Vector((0, -10, 0)), "front"), (c + Vector((0, 10, 0)), "back"),
        (c + Vector((10, 0, 0)), "right"), (c + Vector((0, -0.001, 10)), "top"),
        (c + Vector((-10, 0, 0)), "left"),
    ]
    tiles = []
    for loc, name in views:
        cam(sc, loc, c, ortho=ext)
        tiles.append(shot(sc, tmp))
    d = r * 3.2 + 0.3
    cam(sc, c + Vector((d * 0.55, -d * 0.85, d * 0.35)), c, lens=50)
    tiles.append(shot(sc, tmp))
    row1 = np.concatenate(tiles[0:3], axis=1)
    row2 = np.concatenate(tiles[3:6], axis=1)
    sheet = np.concatenate([row2, row1], axis=0)  # pixels идут снизу вверх
    img = bpy.data.images.new("sheet", sheet.shape[1], sheet.shape[0], alpha=True)
    img.pixels = sheet.ravel().tolist()
    img.filepath_raw = job["out"]
    img.file_format = "PNG"
    img.save()
    import os
    os.remove(tmp)
    print("SHEET", job["out"], [round(x, 3) for x in size], flush=True)
