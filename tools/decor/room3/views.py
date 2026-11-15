# blender -b --python views.py -- jobs.json
# job: {"glb": path, "out": prefix, "size": 320, "views": ["front","right","back","top","persp"]}
# Renders orthographic-ish views (persp camera far away) in glTF terms: front = looking from +Z (glTF) toward -Z.
import bpy, sys, json, math
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
jobs = json.load(open(args[0]))
def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
for job in jobs:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    s = job.get("size", 320)
    sc.render.resolution_x = sc.render.resolution_y = s
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w"); w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.9, 0.88, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    sc.world = w
    bpy.ops.import_scene.gltf(filepath=job["glb"])
    objs = [o for o in sc.objects if o.type == "MESH"]
    for o in objs:   # show vertex colours like three.js does (COLOR_0 multiplies base colour)
        if o.data.color_attributes:
            for m in o.data.materials:
                if m and m.use_nodes and not any(n.type == "TEX_IMAGE" for n in m.node_tree.nodes):
                    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                    vc = m.node_tree.nodes.new("ShaderNodeVertexColor"); vc.layer_name = o.data.color_attributes[0].name
                    m.node_tree.links.new(vc.outputs["Color"], b.inputs["Base Color"])
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (mn + mx) / 2; r = (mx - mn).length / 2 + 0.01
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 5)); sun = bpy.context.active_object
    sun.data.energy = 2.5; sun.rotation_euler = (math.radians(35), math.radians(15), math.radians(25))
    bpy.ops.object.camera_add(); cam = bpy.context.active_object; sc.camera = cam
    cam.data.type = "ORTHO"; cam.data.ortho_scale = 2 * r * 1.05
    D = r * 6
    # glTF +Z == Blender -Y
    dirs = {"front": (0, -1, 0), "back": (0, 1, 0), "right": (1, 0, 0), "left": (-1, 0, 0), "top": (0, 0, 1),
            "persp": (0.7, -1, 0.6)}
    for v in job.get("views", ["front", "right", "back", "top", "persp"]):
        d = Vector(dirs[v]).normalized()
        cam.location = c + d * D
        if v == "top":
            cam.location = c + Vector((0, -0.0001, D))
        look_at(cam, c)
        cam.data.clip_end = D * 3
        sc.render.filepath = "%s_%s.png" % (job["out"], v)
        bpy.ops.render.render(write_still=True)
    print("BBOX", job["glb"], "gltf W(x)=%.3f H(y)=%.3f D(z)=%.3f  min_y=%.3f" % (mx.x - mn.x, mx.z - mn.z, mx.y - mn.y, mn.z), flush=True)
