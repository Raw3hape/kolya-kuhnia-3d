# Анатомия стеллажа для раскладки вещей: пролёты (x от–до между стойками) и полки в каждом пролёте.
# blender -b --python anatomy.py -- out.json model.glb [model.glb ...]
# Координаты glTF после normalize.py: x вдоль ширины, y вверх, z к зрителю. levels — верх полки (м от пола),
# clear — свободная высота до следующей полки (у верхней крышки null).
import bpy, sys, json
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
out, files = args[0], args[1:]
res = {}


def cluster(vals, tol):
    vals = sorted(vals)
    groups = []
    for v in vals:
        if groups and v - groups[-1][-1] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    return groups


for f in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    side, up = [], []
    zmax = 0
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        mw = o.matrix_world
        nm = mw.to_3x3()
        for p in o.data.polygons:
            n = (nm @ p.normal).normalized()
            c = mw @ p.center
            vs = [mw @ o.data.vertices[i].co for i in p.vertices]
            zmax = max(zmax, max(v.z for v in vs))
            if abs(n.x) > 0.95 and (max(v.z for v in vs) - min(v.z for v in vs)) > 0.15:
                side.append(c.x)
            if n.z > 0.95:
                up.append((c.x, c.z, p.area, min(v.x for v in vs), max(v.x for v in vs)))
    boards = [(min(g), max(g)) for g in cluster(side, 0.045)]
    bays = []
    for (a0, a1), (b0, b1) in zip(boards, boards[1:]):
        if b0 - a1 < 0.12:
            continue
        x0, x1 = a1, b0
        zs = [z for (x, z, ar, lx, rx) in up if x0 + 0.02 < x < x1 - 0.02 and (rx - lx) > 0.5 * (x1 - x0)]
        lv = [round(max(g), 3) for g in cluster(zs, 0.03)]
        lv = [z for z in lv if z < zmax - 0.004] + [round(zmax, 3)]
        # толщина полки ~ 0.018: свободная высота = следующий уровень − толщина − текущий
        levels = [{"y": z, "clear": (round(lv[i + 1] - 0.018 - z, 3) if i + 1 < len(lv) else None)} for i, z in enumerate(lv)]
        # glTF: x Blender = x; глубина — Blender y (перед в −y)
        bays.append({"x0": round(x0, 3), "x1": round(x1, 3), "w": round(x1 - x0, 3), "levels": levels})
    res[f] = {"boards": [[round(a, 3), round(b, 3)] for a, b in boards], "bays": bays, "top": round(zmax, 3)}
    print("ANATOMY", f, json.dumps(res[f]), flush=True)
json.dump(res, open(out, "w"), indent=1)
