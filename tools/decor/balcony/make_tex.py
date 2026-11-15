# Процедурные текстуры балкона → <tmp>/tex/*.jpg (их берёт build.py и запекает в GLB):
#   runnen-akacja.jpg — 2×2 плиты RUNNEN akacja (0,6 × 0,6 м): плита 30 × 30 = 4 квадрата 15 × 15 по 3 планки,
#                       направление планок чередуется («плетёнка», как на фото товара), щели 3 мм, морилка бренд-коричневая;
#   runnen-trawa.jpg  — 2×2 плиты RUNNEN sztuczna trawa: ворс 2 см, едва заметные швы плит;
#   knit-tofto.jpg    — ромбическая сетка наволочки TOFTÖ (ciemny szarozielony), повтор 10 см;
#   knit-klippoxel.jpg— крупная вязка пледа KLIPPOXEL (ciemnozielony), повтор 12 см.
#   uv run --with numpy --with pillow tools/decor/balcony/make_tex.py <tmp>
import os, sys
import numpy as np
from PIL import Image, ImageFilter

tmp = os.path.abspath(sys.argv[1])
out = os.path.join(tmp, "tex")
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(7)


def save(a, name, q=88):
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(os.path.join(out, name), quality=q)
    print("tex", name)


def noise(n, scale, octaves=4):
    """Гладкий шум n×n (сумма октав, билинейно растянутых)."""
    acc, amp = np.zeros((n, n)), 1.0
    for o in range(octaves):
        k = max(2, int(scale * 2 ** o))
        g = Image.fromarray((rng.random((k, k)) * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)
        acc += (np.asarray(g) / 255.0 - 0.5) * amp
        amp *= 0.5
    return acc


# ---------- RUNNEN akacja ----------
N = 1024                       # 0,6 м -> 1024 px, 1 px ≈ 0,59 мм
px = N / 0.6
img = np.zeros((N, N, 3))
base = np.array([106, 74, 50], float)          # бейца коричневая (фото товара), без рыжины
yy, xx = np.mgrid[0:N, 0:N] / px               # метры
for ty in range(2):
    for tx in range(2):
        for qy in range(2):
            for qx in range(2):
                x0, y0 = tx * 0.3 + qx * 0.15, ty * 0.3 + qy * 0.15
                horiz = (qx + qy + tx + ty) % 2 == 0
                for s in range(3):
                    tone = base * rng.uniform(0.86, 1.12) + rng.uniform(-3, 3, 3)
                    if horiz:
                        a, b = (x0, y0 + s * 0.05), (x0 + 0.15, y0 + (s + 1) * 0.05)
                    else:
                        a, b = (x0 + s * 0.05, y0), (x0 + (s + 1) * 0.05, y0 + 0.15)
                    i0, i1 = int(a[1] * px), int(b[1] * px)
                    j0, j1 = int(a[0] * px), int(b[0] * px)
                    h, w = i1 - i0, j1 - j0
                    # волокна вдоль планки + сучки
                    along = (np.arange(w if horiz else h)[None, :] if horiz else np.arange(h)[:, None])
                    g = noise(max(h, w), 3, 3)[:h, :w]
                    fib = np.sin((np.arange(h)[:, None] if horiz else np.arange(w)[None, :]) * rng.uniform(0.6, 1.1)
                                 + g * 9 + rng.uniform(0, 6)) * 0.07
                    shade = 1 + g * 0.18 + fib
                    img[i0:i1, j0:j1] = tone[None, None, :] * shade[..., None]
                    # щель 3 мм (тёмная) по краю планки и фаска
                    gap = max(1, int(0.003 * px / 2))
                    if horiz:
                        img[i0:i0 + gap, j0:j1] *= 0.25
                        img[i1 - gap:i1, j0:j1] *= 0.35
                    else:
                        img[i0:i1, j0:j0 + gap] *= 0.25
                        img[i0:i1, j1 - gap:j1] *= 0.35
        # кромка плиты потемнее
        e = max(2, int(0.004 * px))
        i0, j0 = int(ty * 0.3 * px), int(tx * 0.3 * px)
        i1, j1 = int((ty + 1) * 0.3 * px), int((tx + 1) * 0.3 * px)
        for sl in (np.s_[i0:i0 + e, j0:j1], np.s_[i1 - e:i1, j0:j1], np.s_[i0:i1, j0:j0 + e], np.s_[i0:i1, j1 - e:j1]):
            img[sl] *= 0.3
img *= (1 + noise(N, 4, 3) * 0.12)[..., None]
save(img, "runnen-akacja.jpg")

# ---------- RUNNEN sztuczna trawa ----------
g = rng.random((N, N))
blades = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))) / 255.0
patch = noise(N, 6, 4)
grass = np.stack([58 + blades * 45 + patch * 20, 92 + blades * 55 + patch * 28, 36 + blades * 26 + patch * 10], -1)
tips = rng.random((N, N)) > 0.985
grass[tips] = [150, 168, 92]
for k in (0, N // 2):                          # швы плит 30 см
    grass[k:k + 2, :] *= 0.75
    grass[:, k:k + 2] *= 0.75
save(grass, "runnen-trawa.jpg")

# ---------- трикотаж: TOFTÖ (ромбическая сетка) и KLIPPOXEL (крупная вязка) ----------
M = 256
u, v = np.mgrid[0:M, 0:M] / M
lat = np.minimum(np.abs(((u + v) * 8) % 1 - 0.5), np.abs(((u - v) * 8) % 1 - 0.5))
cord = np.clip(1 - lat / 0.13, 0, 1)
tofto = np.array([62, 78, 64], float)[None, None, :] * (0.75 + 0.4 * cord[..., None]) + noise(M, 16, 2)[..., None] * 18
save(tofto, "knit-tofto.jpg")
row = np.abs(((v * 10) % 1) - 0.5)
st = np.abs(((u * 10 + (np.floor(v * 10) % 2) * 0.5) % 1) - 0.5)
knit = np.clip(1 - (row * 1.4 + st * 0.9), 0, 1)
klip = np.array([36, 60, 44], float)[None, None, :] * (0.6 + 0.6 * knit[..., None]) + noise(M, 12, 2)[..., None] * 14
save(klip, "knit-klippoxel.jpg")
