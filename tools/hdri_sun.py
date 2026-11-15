"""Находит солнце на HDRI-панорамах и пишет web/textures/hdri/<name>.json: {"u", "v", "elevation"}.
u, v — координаты самого яркого пятна на равнопромежуточной карте (0..1, v=1 — зенит).

    blender -b -P tools/hdri_sun.py
"""
import json
import pathlib

import bpy
import numpy as np

HDRI = pathlib.Path(__file__).resolve().parent.parent / "web" / "textures" / "hdri"
for f in sorted(HDRI.glob("*.hdr")):
    img = bpy.data.images.load(str(f))
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    lum = px.reshape(h, w, 4)[..., :3].mean(-1)   # строки снизу вверх
    y, x = np.unravel_index(np.argmax(lum), lum.shape)
    u, v = (x + 0.5) / w, (y + 0.5) / h
    out = {"u": round(float(u), 4), "v": round(float(v), 4), "elevation": round(float((v - 0.5) * 180), 1)}
    (HDRI / f"{f.stem}.json").write_text(json.dumps(out))
    print(f.stem, out)
