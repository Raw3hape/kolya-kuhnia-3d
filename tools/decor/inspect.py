# blender -b --python tools/decor/inspect.py -- a.glb b.glb …
# Печатает для каждого GLB: габариты в осях glTF (X ширина, Y высота, Z глубина), где перед (по смещению массы по Z),
# треугольники, материалы и размеры текстур. Нужен перед normalize.py, чтобы выбрать поворот.
import bpy, sys, json
import numpy as np

for path in sys.argv[sys.argv.index("--") + 1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    pts, tris = [], 0
    for o in objs:
        m = o.matrix_world
        pts += [(m @ v.co)[:] for v in o.data.vertices]
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    p = np.array(pts)
    # Blender (x, y, z) -> glTF (x, z, -y)
    g = np.stack([p[:, 0], p[:, 2], -p[:, 1]], 1)
    mn, mx = g.min(0), g.max(0)
    mats = sorted({s.material.name for o in objs for s in o.material_slots if s.material})
    imgs = [f"{i.name}:{i.size[0]}x{i.size[1]}" for i in bpy.data.images]
    print("INSPECT", json.dumps({"file": path.split("/")[-1], "size_xyz": np.round(mx - mn, 3).tolist(),
          "min": np.round(mn, 3).tolist(), "max": np.round(mx, 3).tolist(),
          "zMeanMinusMid": round(float(g[:, 2].mean() - (mn[2] + mx[2]) / 2), 3),
          "tris": tris, "objects": len(objs), "materials": mats, "images": imgs}, ensure_ascii=False), flush=True)
