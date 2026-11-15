"""Процедурные текстуры, которых нет в CC0-библиотеках.

    uv run --with numpy --with pillow tools/make_procedural.py            # мрамор + миниатюры
    uv run --with numpy --with pillow tools/make_procedural.py --thumbs   # только миниатюры

calacatta_rust — белый мрамор/керамогранит с рыже-коричневыми прожилками,
как столешница в эскизе SketchUp (тип Calacatta Macchia Vecchia).
Текстура — одна «слэб-плита» 3072×1536 на 2.8×1.4 м, без повтора.
"""
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
W, H = 3072, 1536
rng = np.random.default_rng(7)


def value_noise(w, h, cell, seed):
    r = np.random.default_rng(seed)
    gw, gh = w // cell + 3, h // cell + 3
    g = r.random((gh, gw)).astype(np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    fx, fy = xs / cell, ys / cell
    x0, y0 = fx.astype(int), fy.astype(int)
    tx, ty = fx - x0, fy - y0
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    a = g[y0, x0]; b = g[y0, x0 + 1]; c = g[y0 + 1, x0]; d = g[y0 + 1, x0 + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm(w, h, cell, octaves, seed, gain=0.5):
    s, amp, tot = np.zeros((h, w), np.float32), 1.0, 0.0
    for o in range(octaves):
        s += amp * value_noise(w, h, max(2, cell >> o), seed + o * 17)
        tot += amp
        amp *= gain
    return s / tot


def warp_sample(field, dx, dy):
    h, w = field.shape
    ys, xs = np.mgrid[0:h, 0:w]
    xi = np.clip((xs + dx).astype(int), 0, w - 1)
    yi = np.clip((ys + dy).astype(int), 0, h - 1)
    return field[yi, xi]


def ridged(seed, cell, octaves, warp):
    """Сеть трещин: 1-|2n-1| у искривлённого шума даёт ветвящиеся прожилки."""
    n = fbm(W, H, cell, octaves, seed, gain=0.45)
    wx = (fbm(W, H, cell * 2, 3, seed + 101) - 0.5) * warp
    wy = (fbm(W, H, cell * 2, 3, seed + 202) - 0.5) * warp
    n = warp_sample(n, wx, wy)
    return 1 - np.abs(n * 2 - 1)


def main():
    out = ROOT / "web" / "textures" / "calacatta_rust"
    out.mkdir(parents=True, exist_ok=True)

    clouds = fbm(W, H, 512, 6, 1)
    base = np.stack([0.955 - clouds * 0.06, 0.948 - clouds * 0.065, 0.935 - clouds * 0.07], -1)

    r1 = ridged(11, 760, 6, 380)                       # крупные рыжие прожилки
    r2 = ridged(23, 300, 6, 260)                       # тонкая сетка трещин
    r3 = ridged(37, 520, 3, 600)                       # серые «тени»
    mask = fbm(W, H, 1100, 3, 51)
    m1 = np.clip((mask - 0.30) * 3.0, 0, 1)
    m2 = np.clip((mask - 0.22) * 2.2, 0, 1)
    major = (r1 ** 70) * m1
    halo_major = (r1 ** 22) * m1
    minor = (r2 ** 120) * m2 * 0.7
    grey = (r3 ** 14) * 0.30

    core = np.clip(major * 1.6 + minor, 0, 1)
    halo = np.clip(halo_major * 0.55 + (r2 ** 40) * m2 * 0.2, 0, 1)
    rust_core = np.array([0.36, 0.17, 0.08])
    rust_halo = np.array([0.80, 0.52, 0.32])
    grey_c = np.array([0.66, 0.65, 0.64])

    col = base.copy()
    col = col * (1 - grey[..., None]) + grey_c * grey[..., None]
    col = col * (1 - halo[..., None] * 0.65) + rust_halo * (halo[..., None] * 0.65)
    col = col * (1 - core[..., None]) + rust_core * core[..., None]
    col = np.clip(col, 0, 1) ** (1 / 1.0)
    Image.fromarray((col * 255).astype(np.uint8)).save(out / "color.jpg", quality=88, optimize=True)

    rough = np.clip(0.10 + core * 0.10 + clouds * 0.03, 0, 1)
    Image.fromarray((rough * 255).astype(np.uint8)).convert("RGB").save(out / "rough.jpg", quality=86)

    hgt = core * 0.6 + clouds * 0.1
    gy, gx = np.gradient(hgt)
    nrm = np.stack([-gx * 2.0, -gy * 2.0, np.ones_like(gx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8)).save(out / "normal.jpg", quality=92)
    print("calacatta_rust ->", out.relative_to(ROOT))





def thumbs():
    """Миниатюры 160 px для панели (web/textures/<id>/thumb.jpg)."""
    for d in sorted((ROOT / "web" / "textures").iterdir()):
        src = d / "color.jpg"
        if not src.exists():
            continue
        im = Image.open(src).convert("RGB")
        s = min(im.size)
        im = im.crop((0, 0, s, s)).resize((160, 160), Image.LANCZOS)
        im.save(d / "thumb.jpg", quality=84)


if __name__ == "__main__":
    import sys
    if "--thumbs" not in sys.argv:
        main()
    thumbs()
