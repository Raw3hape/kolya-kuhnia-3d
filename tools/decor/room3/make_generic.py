# blender -b --python make_generic.py -- outdir
# Own CC0 models (made here, no third-party source): monitor 27", keyboard+mouse, laptop 14", book rows/stacks.
# Contract: metres, floor Y=0 (glTF), footprint centred, front +Z (glTF) = Blender -Y. Books use vertex colours
# (one material per file, one draw call).
import bpy, bmesh, sys, os, math, random
from mathutils import Vector, Matrix
out = sys.argv[sys.argv.index("--") + 1]

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, rgb, rough=0.5, metal=0.0, vcol=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if vcol:
        n = m.node_tree.nodes.new("ShaderNodeVertexColor"); n.layer_name = "Col"
        m.node_tree.links.new(n.outputs["Color"], b.inputs["Base Color"])
    return m

def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def box(bm, x0, x1, y0, y1, z0, z1, mi=0, col=None, top_col=None, layer=None):
    """Blender coords: x right, y back(-front), z up."""
    vs = [bm.verts.new(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                     (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    out = []
    for k, f in enumerate(faces):
        fc = bm.faces.new([vs[i] for i in f]); fc.material_index = mi; out.append(fc)
        if layer is not None:
            c = top_col if (k == 1 and top_col) else col
            for l in fc.loops: l[layer] = (*c, 1)
    return out

def finish(name, bm, mats, bevel=0.0, smooth=False):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    for m in mats: me.materials.append(m)
    if "Col" in me.color_attributes:
        for a in [a for a in me.color_attributes if a.name != "Col"]:
            me.color_attributes.remove(a)
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = 0
    if bevel:
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        md = ob.modifiers.new("b", "BEVEL"); md.width = bevel; md.segments = 2; md.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier="b")
    for p in me.polygons: p.use_smooth = smooth
    return ob

def export(name):
    d = os.path.join(out, name); os.makedirs(d, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(d, "raw.glb"), export_format="GLB", export_yup=True,
                              export_apply=True, export_vertex_color="ACTIVE" if "books" in name else "MATERIAL",
                              export_extras=False, export_cameras=False, export_lights=False)

def rot_obj(ob, axis, deg, pivot):
    ob.data.transform(Matrix.Translation(-Vector(pivot)))
    ob.data.transform(Matrix.Rotation(math.radians(deg), 4, axis))
    ob.data.transform(Matrix.Translation(Vector(pivot)))

# ---------- monitor 27" 16:9 ----------
reset()
plastic = mat("plastic_black", srgb("#1e1f21"), 0.45)
screen = mat("screen", srgb("#0d0f12"), 0.12)
alu = mat("aluminium", srgb("#9a9ca0"), 0.35, 0.9)
bm = bmesh.new()
W, H, T = 0.614, 0.366, 0.012           # panel incl. bezel
yb = 0.0                                # panel front plane (Blender y; front = -y)
z0 = 0.105                              # panel bottom above desk
box(bm, -W / 2, W / 2, 0.0, T, z0, z0 + H, 0)                       # panel body
box(bm, -W / 2 + 0.008, W / 2 - 0.008, -0.0008, 0.0, z0 + 0.022, z0 + H - 0.008, 1)  # glass (front)
box(bm, -0.16, 0.16, T, T + 0.03, z0 + 0.08, z0 + 0.30, 0)           # rear housing bulge
m1 = finish("monitor", bm, [plastic, screen], bevel=0.003)
bm = bmesh.new()
box(bm, -0.035, 0.035, T + 0.03, T + 0.05, 0.008, z0 + 0.26, 0)      # neck
box(bm, -0.12, 0.12, -0.06, T + 0.12, 0.0, 0.008, 0)                  # base plate
m2 = finish("stand", bm, [alu], bevel=0.003)
export("monitor-27")

# ---------- keyboard + mouse ----------
reset()
body = mat("aluminium", srgb("#b8babd"), 0.35, 0.85)
keys = mat("keys", srgb("#2a2b2e"), 0.55)
bm = bmesh.new()
KW, KD = 0.43, 0.13
box(bm, -KW / 2, KW / 2, -KD / 2, KD / 2, 0.0, 0.012, 0)
rows = [(15, 1.0), (14, 1.0), (13, 1.0), (12, 1.0), (11, 1.0)]
p = 0.0275
for r in range(5):
    n = 15 if r < 4 else 9
    y = -KD / 2 + 0.015 + r * 0.0215
    for c in range(n):
        x = -KW / 2 + 0.016 + c * p
        w = 0.022 if not (r == 4 and c == 4) else 0.13
        if r == 4 and c > 4:
            x += 0.105
        if x + w > KW / 2 - 0.01:
            continue
        box(bm, x, x + w, y, y + 0.019, 0.012, 0.0185, 1)
# mouse, to the right of the keyboard
cx, cy = KW / 2 + 0.09, 0.0
bm2 = bmesh.new()
bmesh.ops.create_uvsphere(bm2, u_segments=20, v_segments=10, radius=1.0)
for v in bm2.verts:
    v.co = Vector((v.co.x * 0.031 + cx, v.co.y * 0.055 + cy, max(v.co.z, 0) * 0.033))
me = bpy.data.meshes.new("tmp"); bm2.to_mesh(me); bm2.free()
for v in me.vertices:
    bm.verts.new(v.co)
fin = finish("keyboard", bm, [body, keys], bevel=0.0008)
mo = bpy.data.objects.new("mouse", me); bpy.context.collection.objects.link(mo); me.materials.append(body)
for pl in me.polygons: pl.use_smooth = True
export("keyboard-mouse")

# ---------- laptop 14" open ----------
reset()
shell = mat("aluminium", srgb("#a7a9ad"), 0.32, 0.9)
keys = mat("keys", srgb("#232427"), 0.6)
screen = mat("screen", srgb("#0d0f12"), 0.12)
LW, LD, LT = 0.313, 0.221, 0.008
bm = bmesh.new()
box(bm, -LW / 2, LW / 2, -LD / 2, LD / 2, 0.0, LT, 0)
box(bm, -0.135, 0.135, -0.005, 0.095, LT, LT + 0.0008, 1)       # keyboard field
box(bm, -0.06, 0.06, -0.10, -0.02, LT, LT + 0.0003, 1)           # trackpad (dark)
base = finish("base", bm, [shell, keys], bevel=0.002)
bm = bmesh.new()
SH = 0.215
box(bm, -LW / 2, LW / 2, 0.0, 0.006, 0.0, SH, 0)                 # lid, hinge at y=0 z=0
box(bm, -LW / 2 + 0.008, LW / 2 - 0.008, -0.0006, 0.0, 0.008, SH - 0.008, 1)
lid = finish("lid", bm, [shell, screen], bevel=0.0015)
lid.data.transform(Matrix.Rotation(math.radians(-20), 4, "X"))   # open ~110 deg (leans back)
lid.data.transform(Matrix.Translation(Vector((0, LD / 2 - 0.004, LT))))
export("laptop-14")

# ---------- books ----------
PAL = ["#e8dfcb", "#d4c4a4", "#a65a3c", "#6b6b3a", "#2f4a3a", "#2c3a52", "#c49a45", "#6d2a2e", "#35322f",
       "#f1ede4", "#b08b5b", "#8a9a8c", "#7b4b3a", "#c9b79c", "#4d5a6b"]
PAGES = srgb("#ece4cf")
GOLD = srgb("#b8955a")

def books_row(name, length, seed, stack=0, lean=False):
    random.seed(seed)
    reset()
    m = mat("books", (1, 1, 1), 0.7, vcol=True)
    bm = bmesh.new(); layer = bm.loops.layers.color.new("Col")
    x = -length / 2
    end = length / 2 - (0.0 if not stack else 0.25)
    while True:
        t = random.uniform(0.014, 0.042); h = random.uniform(0.17, 0.25)
        d = min(h * 0.72, random.uniform(0.14, 0.21))
        if x + t > end:
            break
        col = srgb(random.choice(PAL))
        y0 = -0.10                                    # spines flush at the front (y = -0.10)
        box(bm, x, x + t, y0, y0 + d, 0.0, h, 0, col, PAGES, layer)
        if random.random() < 0.45:                    # title band on spine
            zb = h * random.uniform(0.62, 0.8)
            box(bm, x + 0.002, x + t - 0.002, y0 - 0.0006, y0, zb, zb + 0.012, 0, GOLD, None, layer)
        x += t + random.uniform(0.0, 0.0025)
    if stack:
        z = 0.0
        sx = length / 2 - 0.125
        for i in range(stack):
            w, d, t = random.uniform(0.19, 0.24), random.uniform(0.14, 0.17), random.uniform(0.02, 0.04)
            dx = random.uniform(-0.01, 0.01)
            box(bm, sx - w / 2 + dx, sx + w / 2 + dx, -0.10, -0.10 + d, z, z + t, 0, srgb(random.choice(PAL)), srgb(random.choice(PAL)), layer)
            z += t
    ob = finish(name, bm, [m])
    # centre footprint
    me = ob.data
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
    me.transform(Matrix.Translation(Vector((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0))))
    export(name)

books_row("books-row-70", 0.70, 1)
books_row("books-row-45", 0.45, 2)
books_row("books-row-30", 0.30, 3)
books_row("books-mix-60", 0.60, 4, stack=4)
books_row("books-stack", 0.25, 5, stack=5)
