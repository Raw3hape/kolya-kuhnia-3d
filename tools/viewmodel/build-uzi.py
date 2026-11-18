"""Create the stylized Uzi game prop, hands and clips, then export a GLB.

Run with blender -b -t 2 -P tools/viewmodel/build-uzi.py.
Geometry is authored in viewmodel space. It represents decorative surfaces only.
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "web/models/viewmodel/uzi.glb"
SOURCE = Path(__file__).with_name("uzi.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0


def color(name, rgba, metallic=0, roughness=.6):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*rgba, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*rgba, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return result


steel = color("Graphite enamel", (.12, .145, .16), .5)
edge = color("Burnished grey", (.22, .25, .26), .6)
dark = color("Black polymer", (.024, .027, .03))
ridge = color("Moulded polymer", (.047, .053, .057))
inset = color("Painted shadow", (.009, .011, .013))
mark = color("Inspection paint", (.49, .25, .09))
skin = color("Skin", (.46, .25, .16))
finger = color("Skin warm", (.49, .275, .179))
sleeve = color("Shirt canvas", (.16, .23, .20))
cuff = color("Shirt ribbed cuff", (.077, .112, .085))
parts = {}


def group(name, parent=None, loc=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    return obj


def finish(obj, parent, mat, bevel=0):
    obj.parent = parent
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("Soft edges", "BEVEL")
        mod.width, mod.segments = bevel, 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    normals = obj.modifiers.new("Face normals", "WEIGHTED_NORMAL")
    bpy.ops.object.modifier_apply(modifier=normals.name)
    parts.setdefault((parent, mat), []).append(obj)
    return obj


def box(parent, mat, at, size, bevel=.003, tilt=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.object
    obj.scale = size
    obj.rotation_euler.x = tilt
    return finish(obj, parent, mat, bevel)


def link(parent, mat, start, end, width, depth=None, segments=12):
    a, b = Vector(start), Vector(end)
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=1, depth=1, location=(a + b) / 2)
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = (b - a).to_track_quat("Z", "Y")
    obj.scale = (width, depth or width, (b - a).length)
    return finish(obj, parent, mat, min(.003, width * .18))


body = group("Uzi")
mag = group("Magazine", body, (0, -.018, -.045))
support = group("Support hand", body)
box(body, steel, (0, .091, .041), (.078, .306, .066), .007)
box(body, edge, (0, .087, .073), (.079, .288, .014), .005)
box(body, steel, (0, -.068, .043), (.082, .027, .068), .005)
box(body, steel, (0, .241, .043), (.079, .035, .06), .004)
box(body, dark, (0, .174, .004), (.083, .119, .045), .009)
for i in range(8):
    box(body, ridge, (0, .124 + i * .014, .001), (.087, .005, .038), .003)
box(body, ridge, (0, -.019, -.039), (.047, .065, .102), .008, -.17)
box(body, dark, (0, -.018, -.082), (.050, .067, .017), .004, -.17)
for s in (-1, 1):
    for i in range(4):
        box(body, dark, (s * .023, -.025, -.044 - i * .01), (.004, .046, .003), .001)
    box(body, edge, (s * .04, .034, .018), (.008, .154, .013), .003)
    box(body, steel, (s * .046, -.046, .02), (.013, .038, .033), .005)
    for y, length in ((-.046, .033), (.223, .025)):
        box(body, steel, (s * .022, y, .094), (.014, length, .032), .003)
    for y in (-.036, .102, .22):
        link(body, edge, (s * .039, y, .045), (s * .042, y, .045), .006, segments=10)
box(body, inset, (.0405, .094, .052), (.005, .112, .018), .002)
box(body, mark, (.045, .029, .041), (.003, .017, .006), .001)
box(body, dark, (0, .055, .084), (.041, .027, .013), .003)
box(body, edge, (0, .222, .096), (.009, .012, .03), .002)
box(body, dark, (0, -.045, .09), (.026, .011, .018), .002)
link(body, dark, (0, .255, .049), (0, .283, .049), .023)
link(body, edge, (0, .276, .049), (0, .337, .049), .014)
link(body, inset, (0, .337, .049), (0, .338, .049), .009)
box(mag, steel, (0, -.013, -.057), (.032, .043, .123), .004, -.17)
box(mag, edge, (0, -.024, -.117), (.037, .049, .011), .003, -.17)
muzzle = group("muzzle", body, (0, .34, .049))
muzzle.rotation_euler.z = math.pi / 2
group("sight_rear", body, (0, -.05, .104))
group("sight_front", body, (0, .223, .104))

# Two separate grip silhouettes. The support hand can leave the grip on reload.
def arm(parent, end, wrist, palm, wraps, thumb):
    link(parent, sleeve, end, wrist, .047, .039)
    link(parent, cuff, wrist.lerp(end, .18), wrist.lerp(palm, .4), .043, .035)
    link(parent, skin, wrist, palm, .031, .024)
    for start, mid, finish_at in wraps:
        link(parent, finger, start, mid, .009, segments=8)
        link(parent, finger, mid, finish_at, .008, segments=8)
    link(parent, skin, thumb[0], thumb[1], .011, segments=10)


arm(body, Vector((.114, -.32, -.105)), Vector((.026, -.094, -.064)), Vector((.022, -.027, -.044)),
    [((.02, -.028, z), (.005, .009, z + .006), (-.019, .002, z + .008)) for z in (-.044, -.06, -.075)],
    ((.023, -.069, -.033), (-.007, -.048, -.016)))
arm(support, Vector((-.151, -.174, -.118)), Vector((-.033, .124, -.069)), Vector((-.025, .16, -.031)),
    [((-.024, y, -.034), (.007, y, -.031), (.034, y + .009, -.013)) for y in (.14, .157, .174, .191)],
    ((-.03, .13, -.029), (-.038, .171, .009)))


for (parent, material), objects in parts.items():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    objects[0].name = f"{parent.name} · {material.name}"


def clip(name, poses):
    tracks = []
    for obj, prop, frames in poses:
        original = getattr(obj, prop).copy()
        for at, value in frames:
            setattr(obj, prop, value)
            obj.keyframe_insert(prop, frame=at)
        action = obj.animation_data.action
        action.name = f"{name} · {obj.name}"
        slot = obj.animation_data.action_slot
        obj.animation_data.action = None
        track = obj.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 1, action)
        strip.action_slot = slot
        track.mute = True
        tracks.append(track)
        setattr(obj, prop, original)
    return tracks


tracks = []
tracks += clip("idle", [(body, "rotation_euler", [(1, (0, 0, 0)), (11, (.001, 0, 0)), (22, (0, 0, 0))])])
tracks += clip("shoot", [(body, "rotation_euler", [(1, (0, 0, 0)), (2, (.025, 0, 0)), (5, (0, 0, 0))])])
tracks += clip("reload", [
    (body, "rotation_euler", [(1, (0, 0, 0)), (11, (-.20, .08, -.12)), (28, (-.20, .08, -.12)), (45, (0, 0, 0))]),
    (mag, "location", [(1, mag.location.copy()), (10, mag.location.copy()), (19, (-.048, -.043, -.27)), (24, (-.048, -.043, -.27)), (32, mag.location.copy()), (45, mag.location.copy())]),
    (support, "location", [(1, (0, 0, 0)), (14, (-.012, -.16, -.074)), (24, (-.012, -.16, -.12)), (32, (-.005, -.15, -.045)), (45, (0, 0, 0))]),
])
bpy.context.scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
for track in tracks:
    track.mute = False
bpy.ops.export_scene.gltf(
    filepath=str(TARGET), export_format="GLB", export_animation_mode="NLA_TRACKS",
    export_frame_range=False, export_force_sampling=True, export_normals=True, export_texcoords=False,
)
