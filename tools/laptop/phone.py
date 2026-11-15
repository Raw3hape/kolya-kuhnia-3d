# blender -b --python tools/laptop/phone.py -- out.glb
# Процедурный смартфон без бренда (пропорции «как у iPhone»), лежит экраном вверх: web/models/decor/props/phone-iphone/.
# Габарит 7.2 × 0.8 × 14.7 см (Ш × В × Г glTF): метры, низ на Y = 0, центр следа в 0, длинная сторона вдоль Z,
# верх телефона (динамик) к −Z. Материалы: frame — боковая рамка, glass — стекло вокруг экрана, back — задняя крышка,
# screen — сам экран (tv.js вырезает по нему «дыру» под видео, прямоугольник экрана — spec/tv.json → screens.phone.rect).
# После экспорта: npx -y @gltf-transform/cli@4 meshopt out.glb model.glb; миниатюра — tools/decor/thumb.py.
import bpy, bmesh, sys, math

OUT = sys.argv[sys.argv.index("--") + 1]
W, L, T = 0.0716, 0.1470, 0.0078      # ширина, длина, толщина, м
R = 0.0115                            # радиус углов корпуса
INSET, RS = 0.0026, 0.0092            # поле стекла вокруг экрана и радиус углов экрана
SEG = 10                              # отрезков на четверть скругления


def rounded_rect(w, l, r):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, l / 2 - r, 0), (-w / 2 + r, l / 2 - r, 90), (-w / 2 + r, -l / 2 + r, 180), (w / 2 - r, -l / 2 + r, 270)):
        for i in range(SEG + 1):
            a = math.radians(a0 + 90 * i / SEG)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def mat(name, rgb, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
M = {n: mat(n, *a) for n, a in {
    "frame": ((0.16, 0.16, 0.17), 0.32, 0.9),
    "glass": ((0.008, 0.008, 0.01), 0.05),
    "back": ((0.045, 0.045, 0.05), 0.55),
    "screen": ((0.004, 0.004, 0.006), 0.08),
}.items()}

# корпус: скруглённый прямоугольник, выдавленный на толщину; кромки сверху и снизу — фаской-скруглением
me = bpy.data.meshes.new("phone")
bm = bmesh.new()
bot = bm.faces.new([bm.verts.new((x, y, 0)) for x, y in rounded_rect(W, L, R)])
ext = bmesh.ops.extrude_face_region(bm, geom=[bot])
top_verts = [v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)]
bmesh.ops.translate(bm, verts=top_verts, vec=(0, 0, T))
bmesh.ops.reverse_faces(bm, faces=[bot])
bm.normal_update()
for f in bm.faces:
    f.material_index = 1 if f.normal.z > 0.9 else 2 if f.normal.z < -0.9 else 0
bm.to_mesh(me)
bm.free()
for m in (M["frame"], M["glass"], M["back"]):
    me.materials.append(m)
body = bpy.data.objects.new("phone", me)
bpy.context.collection.objects.link(body)
bev = body.modifiers.new("round", "BEVEL")
bev.limit_method = "ANGLE"
bev.angle_limit = math.radians(40)
bev.width = 0.0016
bev.segments = 4
bev.harden_normals = True

# экран: отдельная грань чуть над стеклом
sm = bpy.data.meshes.new("screen")
bm = bmesh.new()
bm.faces.new([bm.verts.new((x, y, T + 0.00012)) for x, y in rounded_rect(W - 2 * INSET, L - 2 * INSET, RS)])
bm.to_mesh(sm)
bm.free()
sm.materials.append(M["screen"])
scr = bpy.data.objects.new("screen", sm)
bpy.context.collection.objects.link(scr)

for o in (body, scr):
    o.data.polygons.foreach_set("use_smooth", [True] * len(o.data.polygons))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True)
print("phone:", OUT, "screen", W - 2 * INSET, L - 2 * INSET, "top", T + 0.00012)
