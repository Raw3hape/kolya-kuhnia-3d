"""Процедурные полы: доски, ёлочка, французская ёлочка, плитка, микроцемент, фото-плитка.

    uv run --with numpy --with pillow tools/make_floors.py                    # только новые (без meta.json)
    uv run --with numpy --with pillow tools/make_floors.py --force            # всё заново
    uv run --with numpy --with pillow tools/make_floors.py g_plank_ash --force   # выбранные id

Рецепты: tools/textures.json → "generated" и (если есть) tools/real_tiles.json — фото реальной
плитки, каждая запись рендерится как pattern "photo" (flat — снять градиент света скана; shape "hex" — шестигранник с плоским верхом,
size_m = ширина по углам × высота по граням). maxpx в рецепте — потолок стороны текстуры. Результат: web/textures/<id>/ с color, normal
(OpenGL, зелёный = +V), rough, thumb .jpg и meta.json {size, sizeV, rough}. UV в метрах: текстура
повторяется каждые size × sizeV м; rough.jpg хранит абсолютную шероховатость.

Ёлочка (herringbone) рендерится по осям: на пол её поворачивает приложение (45°).
Французская ёлочка (chevron): колонны идут вдоль V, острия «^» смотрят в +V.
Исходники CC0 уже лежат в web/textures/ (их скачивает fetch_textures.py); их физический размер — BASE_SIZE.
"""
import json
import pathlib
import sys
import zlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEX = ROOT / "web" / "textures"
PPM = 650            # пикселей на метр для узоров
PHOTO_PPM = 1024     # потолок для фото-плитки (детали крапа)
MAXPX = 4096

# Физическая ширина исходника, м. Без записи: *veneer* (Poly Haven) = 1.0, остальное (ambientCG) = 2.0.
BASE_SIZE = {"oak_veneer_01": 1.83, "white_oak_veneer": 0.5, "Concrete046": 2.4, "grey_plaster": 1.0,
             "Travertine004": 1.5, "Terrazzo013": 1.2, "marble_01": 1.5,
             "Marble012": 1.5, "Marble017": 1.5, "Marble019": 1.5}
GRAIN_VERTICAL = {"oak_veneer_01", "white_oak_veneer"}   # волокно вертикально — поворачиваем на 90°

FINISH_ROUGH = [("lapp", 0.35), ("półpol", 0.35), ("polpol", 0.35), ("semi", 0.35), ("satyn", 0.5),
                ("satin", 0.5), ("pol", 0.15), ("gloss", 0.15), ("poł", 0.15), ("struk", 0.75),
                ("mat", 0.7)]
DIRECTIONAL = ("wood", "drew", "marb", "marm", "vein", "trav", "stone", "kamie", "onyx")


# ---------- цвет ----------
def to_lin(a8):
    c = a8.astype(np.float32) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def to_srgb8(c):
    c = np.clip(c, 0, 1)
    s = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return (s * 255 + 0.5).astype(np.uint8)


def hex_lin(h):
    h = h.lstrip("#")
    return to_lin(np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)]))


def lum(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


# ---------- исходник ----------
def resize_wrap(a, nw, nh):
    """Ресемпл бесшовного 2D-массива LANCZOS с учётом заворота краёв."""
    h, w = a.shape
    sx, sy = nw / w, nh / h
    q = 4
    p = int(np.ceil((q + 6) / min(sx, sy))) + 2
    pad = np.pad(a, p, mode="wrap")
    box = (p - q / sx, p - q / sy, p + w + q / sx, p + h + q / sy)
    im = Image.fromarray(pad.astype(np.float32), "F").resize((nw + 2 * q, nh + 2 * q), Image.LANCZOS, box=box)
    return np.asarray(im)[q:q + nh, q:q + nw]


class Base:
    """Исходник при заданном ppm: массивы y-вверх, волокно вдоль x. data[..., 0:3] цвет (линейный),
    3:5 наклоны dh/dx, dh/dy, 5 шероховатость."""

    def __init__(self, name, ppm):
        size = BASE_SIZE.get(name, 1.0 if "veneer" in name else 2.0)
        col = np.asarray(Image.open(TEX / name / "color.jpg").convert("RGB"))
        nor = np.asarray(Image.open(TEX / name / "normal.jpg").convert("RGB")).astype(np.float32) / 127.5 - 1
        rgh = np.asarray(Image.open(TEX / name / "rough.jpg").convert("L")).astype(np.float32) / 255
        h, w = rgh.shape
        wm, hm = size, size * h / w
        col = to_lin(col)
        if name in GRAIN_VERTICAL:      # поворот картинки против часовой: вектор (x, y) -> (-y, x)
            col, rgh = np.rot90(col), np.rot90(rgh)
            nor = np.rot90(nor)
            nor = np.stack([-nor[..., 1], nor[..., 0], nor[..., 2]], -1)
            wm, hm = hm, wm
        nw, nh = round(wm * ppm), round(hm * ppm)
        ch = [col[..., i] for i in range(3)] + [nor[..., i] for i in range(3)] + [rgh]
        ch = [resize_wrap(np.ascontiguousarray(c), nw, nh) for c in ch]
        n = np.stack(ch[3:6], -1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
        nz = np.maximum(n[..., 2], 0.2)
        d = np.stack(ch[0:3] + [-n[..., 0] / nz, -n[..., 1] / nz, ch[6]], -1)
        self.data = np.flipud(d).astype(np.float32).copy()       # y-вверх
        self.ppm, self.wm, self.hm = ppm, nw / ppm, nh / ppm
        c = self.data[..., :3]
        L = lum(c)
        self.meanL = float(L.mean())
        self.stdL = float((L / self.meanL).std())
        ratio = c / np.maximum(L, 1e-4)[..., None]
        self.mean_ratio = ratio.reshape(-1, 3).mean(0)
        self.mean_rough = float(self.data[..., 5].mean())


def bilinear(arr, sx, sy):
    h, w = arr.shape[:2]
    x0, y0 = np.floor(sx), np.floor(sy)
    fx, fy = (sx - x0)[..., None], (sy - y0)[..., None]
    x0, y0 = x0.astype(np.int64) % w, y0.astype(np.int64) % h
    x1, y1 = (x0 + 1) % w, (y0 + 1) % h
    return ((arr[y0, x0] * (1 - fx) + arr[y0, x1] * fx) * (1 - fy)
            + (arr[y1, x0] * (1 - fx) + arr[y1, x1] * fx) * fy)


# ---------- узоры: (X, Y) в метрах -> куски ----------
# Каждый возвращает dict: id, sx, sy (м в системе куска), a, b (куда в выходе смотрят оси x, y исходника),
# d (м до ближайшего края куска).
def pat_planks(X, Y, r):
    L, w, rows, off = r["L"], r["w"], r["rows"], r["_off"]
    row = np.floor(Y / w).astype(int) % rows
    u = np.mod(X - off[row], 2 * L)
    i = np.floor(u / L).astype(int)
    along, across = u - i * L, Y - row * w
    d = np.minimum.reduce([along, L - along, across, w - across])
    one, zero = np.ones_like(X), np.zeros_like(X)
    return dict(id=row * 2 + i, sx=along, sy=across, a=(one, zero), b=(zero, one), d=d)


def pat_herringbone(X, Y, r):
    L, w, k = r["L"], r["w"], r["k"]
    n = round(L / w)
    ax, by = np.floor(X / w).astype(int), np.floor(Y / w).astype(int)
    m = np.mod(ax - by, 2 * n)
    isH = m < n
    A = np.where(isH, ax - m, ax - n)
    B = np.where(isH, by, by + np.mod(ax - n - by, 2 * n))
    # H: [Aw, Aw+L] x [Bw, Bw+w];  V: [Aw+L, Aw+L+w] x [Bw+w-L, Bw+w]
    along = np.where(isH, X - A * w, Y - (B * w + w - L))
    across = np.where(isH, Y - B * w, X - (A * w + L))
    d = np.minimum.reduce([along, L - along, across, w - across])
    one, zero = np.ones_like(X), np.zeros_like(X)
    a = (np.where(isH, one, zero), np.where(isH, zero, one))
    b = (np.where(isH, zero, one), np.where(isH, one, zero))
    q = 2 * k * n
    pid = (np.mod(A, q) * q + np.mod(B, q)) * 2 + (~isH)
    return dict(id=pid, sx=along, sy=across, a=a, b=b, d=d)


def pat_chevron(X, Y, r):
    L, w, rows = r["L"], r["w"], r["rows"]
    c = np.sqrt(0.5)
    Wc, dd = L * c, w / c
    j = np.floor(X / Wc).astype(int)
    xp = X - j * Wc
    odd = (j % 2) == 1
    t = np.where(odd, Y + xp - Wc, Y - xp)
    k = np.floor(t / dd)
    across = (t - k * dd) * c
    along = np.where(odd, (xp - (Y - Wc - k * dd)) * c, (xp + (Y - k * dd)) * c)
    d = np.minimum.reduce([across, w - across, xp, Wc - xp])
    cc = np.full_like(X, c)
    a = (cc, np.where(odd, -cc, cc))
    b = (np.where(odd, cc, -cc), cc)
    return dict(id=(j % r["cols"]) * rows + k.astype(int) % rows, sx=along, sy=across, a=a, b=b, d=d)


def pat_tiles(X, Y, r):
    tw, th, nx, ny, bond = r["tw"], r["th"], r["nx"], r["ny"], r.get("bond", 0)
    row = np.floor(Y / th).astype(int)
    u = X - row * bond * tw
    i = np.floor(u / tw).astype(int)
    lx, ly = u - i * tw, Y - row * th
    pid = (row % ny) * nx + i % nx
    rot = r["_rot"][pid]
    ca, sa = np.cos(rot), np.sin(rot)
    cx, cy = lx - tw / 2, ly - th / 2
    d = np.minimum.reduce([lx, tw - lx, ly, th - ly])
    return dict(id=pid, sx=cx * ca + cy * sa, sy=-cx * sa + cy * ca, a=(ca, sa), b=(-sa, ca), d=d)


def pat_solid(X, Y, r):
    one, zero = np.ones_like(X), np.zeros_like(X)
    return dict(id=np.zeros(X.shape, int), sx=X, sy=Y, a=(one, zero), b=(zero, one), d=np.full_like(X, 9.0))


PATTERNS = {"planks": pat_planks, "herringbone": pat_herringbone, "chevron": pat_chevron,
            "tiles": pat_tiles, "solid": pat_solid}


def setup(r, rng, base):
    """Период (м) и случайные параметры узора."""
    p = r["pattern"]
    if p == "planks":
        r.setdefault("rows", 6)
        L, rows = r["L"], r["rows"]
        off = [0.0]
        for _ in range(rows - 1):           # стыки соседних рядов не ближе 0.3·L
            while True:
                o = rng.uniform(0, L)
                dist = abs(((o - off[-1]) + L / 2) % L - L / 2)
                if dist > 0.3 * L:
                    off.append(o)
                    break
        r["_off"] = np.array(off)
        return 2 * L, rows * r["w"], rows * 2
    if p == "herringbone":
        r.setdefault("k", 2)
        P = 2 * r["k"] * r["L"]
        q = 2 * r["k"] * round(r["L"] / r["w"])
        return P, P, q * q * 2
    if p == "chevron":
        r.setdefault("rows", 12); r.setdefault("cols", 4)
        c = np.sqrt(0.5)
        return r["cols"] * r["L"] * c, r["rows"] * r["w"] / c, r["cols"] * r["rows"]
    if p == "tiles":
        n = r["nx"] * r["ny"]
        square = abs(r["tw"] - r["th"]) < 1e-6      # прямоугольную плитку не крутим на 90°
        rots = np.array(r.get("rot", [0, 90, 180, 270] if square else [0, 180])) * np.pi / 180
        r["_rot"] = rng.choice(rots, n)
        return r["nx"] * r["tw"], r["ny"] * r["th"], n
    if p == "solid":
        return base.wm, base.hm, 1
    raise ValueError(p)


# ---------- сборка ----------
def finish(out, r, color, slope, rough, height, ppm_x, ppm_y, size, size_v):
    """Карты y-вверх -> jpg. slope — наклоны исходника (dh/dx, dh/dy), height — рельеф стыков, м."""
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * ppm_x / 2
    gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * ppm_y / 2
    sx, sy = slope[..., 0] + gx, slope[..., 1] + gy
    n = np.stack([-sx, -sy, np.ones_like(sx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    out.mkdir(parents=True, exist_ok=True)
    col8 = np.flipud(to_srgb8(color))
    Image.fromarray(col8).save(out / "color.jpg", quality=86, optimize=True)
    Image.fromarray(np.flipud(((n * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8))).save(
        out / "normal.jpg", quality=92, optimize=True)
    Image.fromarray(np.flipud((np.clip(rough, 0.02, 1) * 255 + 0.5).astype(np.uint8)), "L").save(
        out / "rough.jpg", quality=88, optimize=True)
    s = min(col8.shape[:2])
    Image.fromarray(col8[:s, :s]).resize((160, 160), Image.LANCZOS).save(out / "thumb.jpg", quality=84)
    (out / "meta.json").write_text(json.dumps({"size": round(size, 4), "sizeV": round(size_v, 4), "rough": 1}) + "\n")


def render_pattern(r, out):
    rng = np.random.default_rng(zlib.crc32(r["id"].encode()))
    ppm = r.get("ppm", PPM)
    base = Base(r["base"], ppm)
    PU, PV, nid = setup(r, rng, base)
    if max(PU, PV) * ppm > MAXPX:
        ppm = MAXPX / max(PU, PV)
        base = Base(r["base"], ppm)
    W, H = round(PU * ppm), round(PV * ppm)
    ppm_x, ppm_y = W / PU, H / PV

    wood = r["pattern"] in ("planks", "herringbone", "chevron")
    stretch = r.get("stretch", 1.5 if r["pattern"] == "planks" else 1.0)
    grade = r.get("grade", True)
    target = hex_lin(r["color"]) if grade else None
    contrast, chroma = r.get("contrast", 0.85 if wood else 0.7), r.get("chroma", 0.3)
    if "grain" in r:     # «grain» = желаемый разброс яркости (σ/среднее), контраст подбирается под исходник
        contrast = r["grain"] / base.stdL
    rough_t, rvar = r.get("rough", 0.5), r.get("rough_var", 0.5)
    tile = r["pattern"] == "tiles"
    g = r.get("grout_w", 0.0025) / 2
    grout = hex_lin(r["grout"]) if tile and "grout" in r else None

    flip = r["pattern"] != "tiles" and r["pattern"] != "solid"
    P = dict(cx=rng.uniform(0, base.wm, nid), cy=rng.uniform(0, base.hm, nid),
             fa=np.where(rng.random(nid) < 0.5, -1, 1) if flip else np.ones(nid),
             fb=np.where(rng.random(nid) < 0.5, -1, 1) if flip else np.ones(nid),
             lj=1 + rng.normal(0, r.get("jitter", 0.045 if wood else 0.02), nid),
             wj=rng.normal(0, 0.02 if wood else 0.0, nid),
             rj=rng.normal(0, 0.03 if wood else 0.01, nid))
    if r["pattern"] == "solid":
        P.update(cx=np.zeros(1), cy=np.zeros(1), lj=np.ones(1), wj=np.zeros(1), rj=np.zeros(1))

    color = np.zeros((H, W, 3), np.float32)
    slope = np.zeros((H, W, 2), np.float32)
    rough = np.zeros((H, W), np.float32)
    height = np.zeros((H, W), np.float32)
    px = 1 / min(ppm_x, ppm_y)
    for y0 in range(0, H, 256):
        y1 = min(H, y0 + 256)
        Y, X = np.mgrid[y0:y1, 0:W].astype(np.float64)
        X, Y = (X + 0.5) / ppm_x, (Y + 0.5) / ppm_y
        q = PATTERNS[r["pattern"]](X, Y, r)
        i = q["id"]
        fa, fb = P["fa"][i], P["fb"][i]
        sxp = (P["cx"][i] + fa * q["sx"] / stretch) * base.ppm
        syp = (P["cy"][i] + fb * q["sy"]) * base.ppm
        s = bilinear(base.data, sxp, syp)
        c = s[..., :3]
        if grade:
            L = lum(c)
            ratio = (c / np.maximum(L, 1e-4)[..., None]) / base.mean_ratio
            c = target * (np.maximum(L, 1e-5) / base.meanL)[..., None] ** contrast * np.clip(ratio, 0.2, 5) ** chroma
        else:
            c = c * r.get("gain", 1.0)
        c = c * P["lj"][i][..., None]
        c[..., 0] *= 1 + P["wj"][i]
        c[..., 2] *= 1 - P["wj"][i]
        # наклоны исходника -> в ориентацию куска
        gs_a, gs_b = s[..., 3] * fa / stretch, s[..., 4] * fb
        (ax, ay), (bx, by) = q["a"], q["b"]
        sl = np.stack([gs_a * ax + gs_b * bx, gs_a * ay + gs_b * by], -1)
        rg = rough_t + (s[..., 5] - base.mean_rough) * rvar + P["rj"][i]
        d = q["d"]
        if tile:          # шов: затирка утоплена на 1.5 мм, фаска 1 мм
            gm = np.clip((g - d) / px + 0.5, 0, 1)
            e = np.clip(1 - (d - g) / 0.001, 0, 1) * (1 - gm)
            gc = grout if grout is not None else c.mean((0, 1)) * 0.75
            gtex = gc * (np.maximum(lum(s[..., :3]), 1e-5) / base.meanL)[..., None] ** 0.15
            c = c * (1 - 0.06 * e)[..., None] * (1 - gm[..., None]) + gtex * gm[..., None]
            rg = rg * (1 - gm) + 0.9 * gm
            h = -0.0004 * e - 0.0015 * gm
        elif wood:        # микрофаска 2 мм
            bw = r.get("bevel", 0.002)
            e = np.clip(1 - d / bw, 0, 1)
            c = c * (1 - 0.35 * e ** 1.5)[..., None]
            h = -0.0012 * e
        else:
            h = np.zeros_like(d)
        color[y0:y1], slope[y0:y1], rough[y0:y1], height[y0:y1] = c, sl, rg, h
    finish(out, r, color, slope, rough, height, ppm_x, ppm_y, PU, PV)
    return PU, PV


# ---------- фото-плитка ----------
def face_path(p):
    p = pathlib.Path(p)
    return p if p.is_absolute() else ROOT / p


def render_photo(r, out):
    """Каждая плитка = целое фото лица (без случайных кропов), повороты 0/90/180/270 или 0/180."""
    rng = np.random.default_rng(zlib.crc32(r["id"].encode()))
    tw, th = r["size_m"]
    faces = [Image.open(face_path(f)).convert("RGB") for f in r["faces"]]
    portrait = th > tw
    if portrait:                         # длинная сторона — вдоль U
        tw, th = th, tw
    imgs = []
    for im in faces:
        if tw != th and im.height > im.width:      # портретное фото под лежачую плитку
            im = im.transpose(Image.ROTATE_90)
        a = tw / th                      # кроп по центру под пропорцию плитки
        if abs(im.width / im.height - a) > 0.02:
            if im.width / im.height > a:
                nw = round(im.height * a); x0 = (im.width - nw) // 2; im = im.crop((x0, 0, x0 + nw, im.height))
            else:
                nh = round(im.width / a); y0 = (im.height - nh) // 2; im = im.crop((0, y0, im.width, y0 + nh))
        imgs.append(im)
    native = min(im.width / tw for im in imgs)
    ppm = min(native, r.get("ppm", PHOTO_PPM))
    bond = r.get("bond", 0.5 if tw >= 2 * th else 0)
    nx = r.get("n", [None, None])[0] or max(2, round(1.8 / tw))
    ny = r.get("n", [None, None])[1] or max(2, round(1.8 / th))
    while nx * ny < len(imgs) and max((nx + 1) * tw, (ny + 1) * th) <= 2.4 + 1e-6:
        if nx * tw <= ny * th:          # больше лиц, чем плиток: растим период до 2.4 м
            nx += 1
        else:
            ny += 1
    if bond and (ny * bond) % 1:
        ny += 1
    PU, PV = nx * tw, ny * th
    ppm = min(ppm, r.get("maxpx", MAXPX) / max(PU, PV))
    tpx, tpy = round(tw * ppm), round(th * ppm)
    ppm_x, ppm_y = tpx / tw, tpy / th
    W, H = nx * tpx, ny * tpy

    lin = [to_lin(np.asarray(im.resize((tpx, tpy), Image.LANCZOS))) * r.get("gain", 1.0) for im in imgs]
    if r.get("flat"):
        lin = [flatten(c, r["flat"]) for c in lin]
    rel = [relief_of(r, c, ppm_x) for c in lin]
    gcol = grout_of(r, lin)
    square = tpx == tpy
    rots = r.get("rot") or ([0, 90, 180, 270] if square and not directional(r) else [0, 180])
    rots = [k for k in rots if square or k % 180 == 0]

    color = np.zeros((H, W, 3), np.float32)
    height = np.zeros((H, W), np.float32)
    order = list(rng.permutation(np.resize(np.arange(len(lin)), nx * ny)))
    for ty in range(ny):                     # y вниз (как картинка); бесшовность — через заворот
        off = round(ty * bond * tpx)
        for tx in range(nx):
            f = order[ty * nx + tx]
            k = int(rng.choice(rots)) // 90
            c, hh = np.rot90(lin[f], k), np.rot90(rel[f], k)
            cols = (np.arange(tpx) + tx * tpx + off) % W
            color[ty * tpy:(ty + 1) * tpy][:, cols] = c * (1 + rng.normal(0, 0.01))
            height[ty * tpy:(ty + 1) * tpy][:, cols] = hh
    # шов 2 мм: расстояние до края плитки
    yy = (np.arange(H) % tpy + 0.5) / ppm_y
    dy = np.minimum(yy, th - yy)[:, None]
    xx = (np.arange(W)[None, :] - (np.arange(H)[:, None] // tpy) * round(bond * tpx)) % tpx
    xx = (xx + 0.5) / ppm_x
    d = np.minimum(np.minimum(xx, tw - xx), dy)
    finish_tiles(out, r, color, height, d, gcol, ppm_x, ppm_y, PU, PV)
    return PU, PV


def render_hex(r, out):
    """Шестигранник с плоским верхом: лицо = габарит плитки, повороты кратны 60°, шов по нормали к граням."""
    rng = np.random.default_rng(zlib.crc32(r["id"].encode()))
    tw, th = r["size_m"]                     # ширина по углам, высота по граням
    g = r.get("grout_w", 0.002) / 2
    a = th / 2 + g                           # апофема ячейки (плитка + полшва)
    dx, dy = 1.5 * a / np.cos(np.pi / 6), 2 * a
    nx = max(2, 2 * round(1.8 / dx / 2))     # чётное число колонн — нечётные сдвинуты на dy/2
    ny = max(2, round(1.8 / dy))
    PU, PV = nx * dx, ny * dy
    faces = [Image.open(face_path(f)).convert("RGB") for f in r["faces"]]
    ppm = min(min(im.width / tw for im in faces), r.get("ppm", PHOTO_PPM), r.get("maxpx", MAXPX) / max(PU, PV))
    W, H = round(PU * ppm), round(PV * ppm)
    ppm_x, ppm_y = W / PU, H / PV
    fw, fh = round(tw * ppm_x), round(th * ppm_y)
    lin = [to_lin(np.asarray(im.resize((fw, fh), Image.LANCZOS))) * r.get("gain", 1.0) for im in faces]
    rel = [relief_of(r, c, ppm_x) for c in lin]
    gcol = grout_of(r, lin)

    X = ((np.arange(W) + 0.5) / ppm_x)[None, :].repeat(H, 0)
    Y = ((np.arange(H) + 0.5) / ppm_y)[:, None].repeat(W, 1)
    best = None
    for c in (np.floor(X / dx), np.floor(X / dx) + 1):   # центр ячейки — в одной из двух ближайших колонн
        off = (c % 2) * dy / 2
        row = np.round((Y - off) / dy)
        lx, ly = X - c * dx, Y - (row * dy + off)
        hh = np.maximum(np.abs(ly), np.abs(lx) * np.cos(np.pi / 6) + np.abs(ly) * 0.5)
        if best is None:
            best = [hh, lx, ly, c, row]
        else:
            m = hh < best[0]
            for i, v in enumerate((hh, lx, ly, c, row)):
                best[i] = np.where(m, v, best[i])
    hh, lx, ly, c, row = best
    cell = (c.astype(int) % nx) * ny + row.astype(int) % ny
    face = rng.integers(0, len(lin), nx * ny)[cell]
    ang = rng.integers(0, 6, nx * ny)[cell] * np.pi / 3
    tint = (1 + rng.normal(0, 0.01, nx * ny))[cell]
    ca, sa = np.cos(ang), np.sin(ang)
    sx = np.clip((lx * ca + ly * sa) / tw + 0.5, 0, 1) * (fw - 1.001)
    sy = np.clip((-lx * sa + ly * ca) / th + 0.5, 0, 1) * (fh - 1.001)
    color = np.zeros((H, W, 3), np.float32)
    height = np.zeros((H, W), np.float32)
    for f in range(len(lin)):
        m = face == f
        color[m] = bilinear(lin[f], sx[m], sy[m]) * tint[m][:, None]
        height[m] = bilinear(rel[f][..., None], sx[m], sy[m])[:, 0]
    finish_tiles(out, r, color, height, a - hh, gcol, ppm_x, ppm_y, PU, PV)
    return PU, PV


def flatten(c, k):
    """Снять плавный градиент освещения скана (квадратичная поверхность яркости), k — доля снятия."""
    h, w = c.shape[:2]
    L = lum(c)
    g = 32
    Ls = L[:h // g * g, :w // g * g].reshape(g, h // g, g, w // g).mean((1, 3))
    v, u = np.mgrid[0:1:g * 1j, 0:1:g * 1j]
    A = np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], -1).reshape(-1, 6)
    q = np.linalg.lstsq(A, Ls.reshape(-1), rcond=None)[0]
    v, u = np.mgrid[0:1:h * 1j, 0:1:w * 1j]
    S = q[0] + q[1] * u + q[2] * v + q[3] * u * u + q[4] * u * v + q[5] * v * v
    return c * ((L.mean() / np.maximum(S, 1e-4)) ** k)[..., None].astype(np.float32)


def relief_of(r, c, ppm):
    """Рельеф: high-pass яркости (крап заполнителя), нормирован на σ рельефа (м)."""
    L = lum(c)
    hp = L - gauss_blur(L, 0.004 * ppm)
    return hp / (hp.std() + 1e-6) * r.get("relief", 0.00008)


def grout_of(r, lin):
    """Цвет шва: из рецепта или цвет краёв лиц, чуть темнее."""
    if "grout" in r:
        return hex_lin(r["grout"])
    edge = np.concatenate([np.concatenate([c[:8].reshape(-1, 3), c[-8:].reshape(-1, 3),
                                           c[:, :8].reshape(-1, 3), c[:, -8:].reshape(-1, 3)]) for c in lin])
    return np.median(edge, 0) * 0.78


def finish_tiles(out, r, color, height, d, gcol, ppm_x, ppm_y, PU, PV):
    """Шов по расстоянию d (м) до края ячейки, шероховатость по отделке; запись карт (вход y-вниз)."""
    g = r.get("grout_w", 0.002) / 2
    gm = np.clip((g - d) * ppm_x + 0.5, 0, 1)
    e = np.clip(1 - (d - g) / 0.001, 0, 1) * (1 - gm)
    color = color * (1 - 0.05 * e)[..., None] * (1 - gm[..., None]) + gcol * gm[..., None]
    height = height * (1 - gm) - 0.0004 * e - 0.0015 * gm
    L = lum(color)
    rough = r.get("rough", rough_of(r.get("finish", ""))) + (L - L.mean()) * -0.15
    rough = rough * (1 - gm) + 0.9 * gm
    color, height, rough = np.flipud(color), np.flipud(height), np.flipud(rough)
    finish(out, r, color, np.zeros(color.shape[:2] + (2,), np.float32), rough, height, ppm_x, ppm_y, PU, PV)


def gauss_blur(a, sigma):
    """Гаусс через FFT (с заворотом краёв)."""
    fy, fx = np.fft.fftfreq(a.shape[0])[:, None], np.fft.fftfreq(a.shape[1])[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k)).astype(np.float32)


def rough_of(finish_name):
    f = (finish_name or "").lower()
    for key, v in FINISH_ROUGH:
        if key in f:
            return v
    return 0.65


def directional(r):
    s = " ".join(str(r.get(k, "")) for k in ("cat", "name", "id")).lower()
    return any(k in s for k in DIRECTIONAL)


def recipes():
    cfg = json.loads((ROOT / "tools" / "textures.json").read_text())
    out = list(cfg.get("generated", []))
    manifest = ROOT / "tools" / "real_tiles.json"
    if manifest.exists():
        m = json.loads(manifest.read_text())
        items = m if isinstance(m, list) else m.get("tiles", m.get("items", []))
        for t in items:
            if not t.get("faces"):
                continue
            t = dict(t)
            t["pattern"] = "photo"
            out.append(t)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    for r in recipes():
        if args and r["id"] not in args:
            continue
        out = TEX / r["id"]
        if (out / "meta.json").exists() and not force:
            continue
        try:
            fn = render_pattern if r["pattern"] != "photo" else render_hex if r.get("shape") == "hex" else render_photo
            u, v = fn(dict(r), out)
            print(f"{r['id']:32s} {u:.3f} x {v:.3f} m")
        except Exception as e:          # одна сломанная запись не роняет остальные
            print(f"{r['id']:32s} ОШИБКА: {e}")
            if args:
                raise


if __name__ == "__main__":
    main()
