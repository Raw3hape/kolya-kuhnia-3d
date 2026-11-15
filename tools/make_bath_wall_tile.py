"""Плитка стен ванной: белый «кабанчик» 15 × 7,5 см, сатин. УЖЕ КУПЛЕНА, это не вариант.

    uv run --with numpy --with pillow tools/make_bath_wall_tile.py

Раскладка (как у хозяина): горизонтально, вразбежку на полплитки, тонкий белый шов ~1,75 мм.
Период текстуры 4 плитки × 8 рядов = 0.60 × 0.60 м, 2048 px (≈3.4 px/мм), бесшовно.
UV в метрах: v = 0 у пола (ряды начинаются от пола), u = 0 во внутреннем углу,
поэтому в чётных рядах (0, 2, 4 …) в углу целая плитка, в нечётных — половинка.
Каждая из 32 плиток периода чуть отличается тоном (±1 %) и лёгкой «подушкой» глазури.
Normal — OpenGL (зелёный = вверх), кромка плитки скруглена ~2 мм, шов утоплен на 0.7 мм.
Rough: глазурь ~0.25, шов ~0.7 (meta.rough = 1, в материале roughness = 1).
Выход: web/textures/bath_subway_15x7_white/{color,normal,rough,thumb}.jpg + meta.json.
"""
import json
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "textures" / "bath_subway_15x7_white"

N = 2048                 # px на период
TW, TH = 150.0, 75.0     # плитка, мм
COLS, ROWS = 4, 8        # плиток в периоде по горизонтали и рядов по вертикали
PW, PH = TW * COLS, TH * ROWS   # 600 × 600 мм
GROUT = 1.75             # шов, мм
BEVEL = 2.2              # ширина скругления кромки, мм
MMPX = PW / N
SS = 3                   # суперсэмплинг маски шва

WHITE = np.array([0xF3, 0xF3, 0xF0]) / 255
GROUT_C = np.array([0xE4, 0xE3, 0xDE]) / 255

rng = np.random.default_rng(1575)
TONE = 1 + rng.normal(0, 0.006, (ROWS, COLS)).clip(-0.012, 0.012)     # яркость плитки
TINT = rng.normal(0, 0.0025, (ROWS, COLS, 3)).clip(-0.005, 0.005)     # лёгкий тёплый/холодный сдвиг
PILLOW = rng.uniform(0.6, 1.0, (ROWS, COLS))                          # высота «подушки» глазури
ROUGH_T = 0.25 + rng.normal(0, 0.012, (ROWS, COLS)).clip(-0.025, 0.025)


def periodic_noise(sigma_px, seed):
    """Бесшовный шум: белый шум, сглаженный гауссом через FFT (периодичен по построению)."""
    w = np.random.default_rng(seed).standard_normal((N, N))
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.rfftfreq(N)[None, :]
    g = np.exp(-2 * (np.pi * sigma_px) ** 2 * (fx ** 2 + fy ** 2))
    n = np.fft.irfft2(np.fft.rfft2(w) * g, s=(N, N))
    return ((n - n.mean()) / n.std()).astype(np.float32)


def layout(x, yb):
    """x — мм слева, yb — мм от НИЗА периода (от пола). -> ряд, столбец, локальные lx, ly внутри шага."""
    r = np.floor_divide(yb, TH).astype(int)
    xs = x - np.mod(r, 2) * (TW / 2)              # нечётные ряды сдвинуты на полплитки
    c = np.floor_divide(xs, TW).astype(int)
    return np.mod(r, ROWS), np.mod(c, COLS), np.mod(xs, TW), np.mod(yb, TH)


def edge_dist(lx, ly):
    """Расстояние (мм) от точки до кромки глазури; < 0 — в шве."""
    return np.minimum(np.minimum(lx, TW - lx), np.minimum(ly, TH - ly)) - GROUT / 2


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    px = (np.arange(N, dtype=np.float32) + 0.5) * MMPX
    X, Yimg = np.meshgrid(px, px)
    YB = PH - Yimg                                   # картинка: y вниз; v = 0 (пол) внизу картинки
    r, c, lx, ly = layout(X, YB)
    d = edge_dist(lx, ly)

    # доля шва в пикселе (суперсэмплинг)
    grt = np.zeros((N, N), np.float32)
    for oy in range(SS):
        for ox in range(SS):
            dx, dy = ((ox + 0.5) / SS - 0.5) * MMPX, ((oy + 0.5) / SS - 0.5) * MMPX
            _, _, slx, sly = layout(X + dx, YB - dy)
            grt += (edge_dist(slx, sly) < 0).astype(np.float32)
    grt /= SS * SS

    # цвет: тон плитки + мягкая облачность глазури; к кромке чуть светлее (глазурь тоньше на скруглении)
    cloud = periodic_noise(60, 1) * 0.6 + periodic_noise(200, 2) * 0.4
    tone = TONE[r, c][..., None]
    tint = TINT[r, c]
    edge = np.clip(d / BEVEL, 0, 1)[..., None]
    tile = WHITE * tone + tint + cloud[..., None] * 0.004 + (1 - edge) * 0.006
    grout = GROUT_C * (1 + periodic_noise(0.9, 3)[..., None] * 0.02 + cloud[..., None] * 0.006)
    col = np.clip(tile * (1 - grt[..., None]) + grout * grt[..., None], 0, 1)
    img = (col * 255 + 0.5).astype(np.uint8)
    Image.fromarray(img).save(OUT / "color.jpg", quality=90, optimize=True)

    # шероховатость: глазурь 0.25 (сатин), на скруглении чуть глаже, шов 0.7
    rough_tile = ROUGH_T[r, c] + cloud * 0.006 - (1 - edge[..., 0]) * 0.02
    rough_grout = 0.70 + periodic_noise(1.5, 4) * 0.02
    rough = np.clip(rough_tile * (1 - grt) + rough_grout * grt, 0, 1)
    Image.fromarray((rough * 255 + 0.5).astype(np.uint8)).convert("RGB").save(OUT / "rough.jpg", quality=88)

    # высота (мм): шов −0.7, скругление кромки (четверть окружности), «подушка» глазури, волна глазури
    t = np.clip(d / BEVEL, 0, 1)
    bevel = np.sqrt(1 - (1 - t) ** 2)                # 0 на кромке -> 1 на плоскости
    hgt = -0.7 + 0.7 * bevel
    u = (lx - TW / 2) / (TW / 2)
    w = (ly - TH / 2) / (TH / 2)
    hgt += PILLOW[r, c] * 0.06 * (1 - u * u) * (1 - w * w) * (d > 0)
    hgt += periodic_noise(25, 5) * 0.008 * (d > 0)                      # волна глазури
    hgt = hgt * (1 - grt) + (-0.7 + periodic_noise(0.8, 6) * 0.01) * grt  # песок в шве
    gx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) / (2 * MMPX)
    gy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) / (2 * MMPX)
    k = 0.6
    nrm = np.stack([-gx * k, gy * k, np.ones_like(gx)], -1)            # OpenGL: +Y вверх по картинке
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    Image.fromarray(((nrm * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(OUT / "normal.jpg", quality=92)

    Image.fromarray(img).resize((160, 160), Image.LANCZOS).save(OUT / "thumb.jpg", quality=86)
    (OUT / "meta.json").write_text(json.dumps({"size": PW / 1000, "sizeV": PH / 1000, "rough": 1}))
    print("bath_subway_15x7_white ->", OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
