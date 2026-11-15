"""Плитка пола ванной: Equipe 20×20, чёрно-белые треугольники. УЖЕ УЛОЖЕНА, это не вариант.

    uv run --with numpy --with pillow tools/make_bath_tile.py           # как на фото
    uv run --with numpy --with pillow tools/make_bath_tile.py --rot90   # если на полу повёрнута на 90°

Источник: source/refs/bath-floor-tile-20x20-laid.webp (плитка в коробке, повёрнута на 45°).
Рисунок восстановлен векторно по фото, выпрямленному гомографией:
сетка 4×4 клетки по 5 см, линии сетки совпадают с краями плитки (полуклеток нет),
каждая клетка разрезана диагональю на чёрный и белый треугольник.
Чёрная половина клетки (◤ верх-лево, ◣ низ-лево, ◥ верх-право, ◢ низ-право):

    ◤ ◣ ◤ ◣
    ◥ ◢ ◥ ◢
    ◤ ◣ ◤ ◣
    ◥ ◢ ◥ ◢

То есть плитка = 2×2 повтор мотива 10 см; узор симметричен при повороте на 180°.
Раскладка (допущение): все плитки в одной ориентации, шаг 0.20 м, шов 2 мм светло-серый.
Период текстуры 2×2 плитки = 0.40 м, 2048 px (≈5.1 px/мм), бесшовно.
Выход: web/textures/bath_equipe_triangles_20/{color,normal,rough,thumb}.jpg + meta.json.
Normal — OpenGL (зелёный = вверх).
"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "textures" / "bath_equipe_triangles_20"

N = 2048                 # px на период
PERIOD = 400.0           # мм (2×2 плитки)
TILE = 200.0             # шаг плитки, мм
CELL = 50.0              # клетка рисунка, мм
GROUT = 2.0              # шов, мм (по 1 мм с каждой плитки)
MMPX = PERIOD / N
SS = 4                   # суперсэмплинг краёв (SS×SS на пиксель)

BLACK = np.array([0x23, 0x23, 0x23]) / 255
WHITE = np.array([0xEE, 0xEE, 0xEC]) / 255
GROUT_C = np.array([0xC9, 0xC9, 0xC6]) / 255
TILE_JITTER = [1.006, 0.992, 0.998, 1.009]   # тон каждой из 4 плиток периода (±1%)

# Чёрная половина клетки в мотиве 10 см: [ряд % 2][столбец % 2]
MOTIF = [["NW", "SW"],
         ["NE", "SE"]]

rng = np.random.default_rng(20)


def periodic_noise(sigma_px, seed):
    """Бесшовный шум: белый шум, сглаженный гауссом через FFT (периодичен по построению)."""
    w = np.random.default_rng(seed).standard_normal((N, N))
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.rfftfreq(N)[None, :]
    g = np.exp(-2 * (np.pi * sigma_px) ** 2 * (fx ** 2 + fy ** 2))
    n = np.fft.irfft2(np.fft.rfft2(w) * g, s=(N, N))
    return (n - n.mean()) / n.std()


def black_mask(x, y, rot90):
    """1 там, где чёрный треугольник. x, y — мм в пределах периода (y вниз)."""
    if rot90:                                  # поворот рисунка внутри плитки на 90° по часовой
        x, y = y, (TILE - np.mod(x, TILE)) + np.floor_divide(x, TILE) * TILE
    tx, ty = np.mod(x, TILE), np.mod(y, TILE)
    c = np.floor_divide(tx, CELL).astype(int) % 2
    r = np.floor_divide(ty, CELL).astype(int) % 2
    lx, ly = np.mod(tx, CELL), np.mod(ty, CELL)
    nw = lx + ly < CELL            # «/» диагональ, чёрный верх-лево
    se = lx + ly > CELL            # «/» диагональ, чёрный низ-право
    sw = ly > lx                   # «\» диагональ, чёрный низ-лево
    ne = lx > ly                   # «\» диагональ, чёрный верх-право
    m = np.where(r == 0, np.where(c == 0, nw, sw), np.where(c == 0, ne, se))
    return m.astype(np.float32)


def grout_mask(x, y):
    tx, ty = np.mod(x + GROUT / 2, TILE), np.mod(y + GROUT / 2, TILE)
    return ((tx < GROUT) | (ty < GROUT)).astype(np.float32)


def coverage(rot90):
    """Доли чёрного и шва в каждом пикселе (суперсэмплинг SS×SS, по полосам)."""
    blk = np.zeros((N, N), np.float32)
    grt = np.zeros((N, N), np.float32)
    off = (np.arange(SS) + 0.5) / SS
    xs = (np.arange(N)[:, None] + off[None, :]).ravel() * MMPX       # N*SS
    band = 128
    for y0 in range(0, N, band):
        ys = (np.arange(y0, y0 + band)[:, None] + off[None, :]).ravel() * MMPX
        X, Y = np.meshgrid(xs, ys)
        b = black_mask(X, Y, rot90).reshape(band, SS, N, SS).mean((1, 3))
        g = grout_mask(X, Y).reshape(band, SS, N, SS).mean((1, 3))
        blk[y0:y0 + band] = b
        grt[y0:y0 + band] = g
    return blk, grt


def main():
    rot90 = "--rot90" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    blk, grt = coverage(rot90)

    px = (np.arange(N) + 0.5) * MMPX
    X, Y = np.meshgrid(px, px)
    tile_id = (np.floor_divide(Y, TILE).astype(int) % 2) * 2 + np.floor_divide(X, TILE).astype(int) % 2
    jit = np.array(TILE_JITTER)[tile_id][..., None]

    # белый: мягкая облачность ±~1%
    cloud = periodic_noise(70, 1) * 0.6 + periodic_noise(220, 2) * 0.4
    white = WHITE * (1 + cloud[..., None] * 0.009 + periodic_noise(1.0, 3)[..., None] * 0.003)

    # чёрный: мелкое зерно + редкие светлые крупинки
    fine = periodic_noise(0.7, 4)
    grains = np.clip(periodic_noise(0.6, 5) - 2.3, 0, None)
    black = BLACK + (fine * 0.011 + grains * 0.035)[..., None] + cloud[..., None] * 0.003

    tile_col = (white * (1 - blk[..., None]) + black * blk[..., None]) * jit
    grout = GROUT_C * (1 + periodic_noise(0.9, 6)[..., None] * 0.02 + cloud[..., None] * 0.01)
    col = tile_col * (1 - grt[..., None]) + grout * grt[..., None]
    col = np.clip(col, 0, 1)
    Image.fromarray((col * 255 + 0.5).astype(np.uint8)).save(OUT / "color.jpg", quality=90, optimize=True)

    rough = 0.75 * (1 - blk) + 0.70 * blk + cloud * 0.01
    rough = rough * (1 - grt) + (0.90 + periodic_noise(2.0, 7) * 0.015) * grt
    rough = np.clip(rough, 0, 1)
    Image.fromarray((rough * 255 + 0.5).astype(np.uint8)).convert("RGB").save(OUT / "rough.jpg", quality=88)

    # высота (мм): шов утоплен на 0.8 мм, кромка плитки слегка скруглена
    dx = np.abs(np.mod(X + TILE / 2, TILE) - TILE / 2)
    dy = np.abs(np.mod(Y + TILE / 2, TILE) - TILE / 2)
    d = np.minimum(dx, dy)                                 # расстояние до оси шва
    t = np.clip((d - 0.8) / 0.7, 0, 1)
    hgt = -0.8 * (1 - t * t * (3 - 2 * t))
    hgt += periodic_noise(0.8, 8) * 0.0015 * (1 - grt)     # микрорельеф матовой поверхности
    hgt += periodic_noise(0.8, 9) * 0.01 * grt             # песок в шве
    gx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) / (2 * MMPX)
    gy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) / (2 * MMPX)
    k = 0.6
    nrm = np.stack([-gx * k, gy * k, np.ones_like(gx)], -1)   # OpenGL: +Y вверх по картинке
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    Image.fromarray(((nrm * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(OUT / "normal.jpg", quality=92)

    Image.fromarray((col * 255 + 0.5).astype(np.uint8)).resize((160, 160), Image.LANCZOS).save(
        OUT / "thumb.jpg", quality=86)
    (OUT / "meta.json").write_text(json.dumps({"size": PERIOD / 1000, "sizeV": PERIOD / 1000, "rough": 1}))
    print("bath_equipe_triangles_20 ->", OUT.relative_to(ROOT), "(rot90)" if rot90 else "")


if __name__ == "__main__":
    main()
