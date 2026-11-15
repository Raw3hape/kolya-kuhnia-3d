"""Реальные деревянные полы из фото товаров: доска, массив, ламинат, винил, ёлочка, французская ёлочка.

    uv run --with numpy --with pillow tools/make_wood.py                  # только новые (без meta.json)
    uv run --with numpy --with pillow tools/make_wood.py --force          # всё заново
    uv run --with numpy --with pillow tools/make_wood.py w_barlinek_advance --force --debug <папка>

Вход: tools/real_wood.json → floors[] — товары польских магазинов (название, бренд, артикул, размер,
класс, покрытие, цена PLN/m², ссылка, дата) и фото лица товара сверху (faces: source/refs/wood/<id>/*.jpg).
Выход: web/textures/<id>/ color, normal (OpenGL, зелёный = +V), rough, thumb .jpg и meta.json {size, sizeV, rough};
рядом SOURCE.md; плюс tools/wood.catalog.json — готовые записи для группы floor в catalog.js (временный файл:
интегратор дописывает записи в КОНЕЦ группы и удаляет его).

Как строится текстура:
1. На фото находятся настоящие доски/плашки: у прямой доски — ряды по тёмным фугам и торцевые стыки
   (длина доски известна, это проверка), у ёлочки и французской ёлочки — решётка укладки подбирается
   по фугам (масштаб, угол, сдвиг, зеркало) через корреляцию в FFT. Масштаб фото берётся из ширины доски.
2. Пол раскладывается заново из реальных размеров: прямая доска — ряды со случайным сдвигом стыков
   (или случайной длиной, если у товара диапазон длин), ёлочка — по осям (на пол её поворачивает
   приложение на 45°), французская ёлочка — колонны вдоль V, острия в +V. Каждая доска берёт целую
   доску с фото (с поворотом на 180° или зеркалом); если на фото нет доски нужной длины, доска
   склеивается из кусков разных досок с мягким переходом по волокну.
3. Фуга (4V/2V/микрофаска) рисуется в normal и затемнением, рельеф волокна — из яркости фото,
   шероховатость — из покрытия (лак мат/ультрамат/полумат, масло) с вариацией по порам.
Повтор: прямая доска ≈ 4.4 × 3.7 м, ёлочка — квадрат 2L·k ≈ 2.9–4.4 м (при нечётном 2L/w k чётное), фр. ёлочка ≈ 4 м.
Текстуры не больше 2048 px по стороне (бюджет Vercel).
"""
import json
import pathlib
import sys
import zlib

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from make_floors import to_lin, to_srgb8, lum, bilinear, gauss_blur  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEX = ROOT / "web" / "textures"
MANIFEST = ROOT / "tools" / "real_wood.json"
CATALOG_OUT = ROOT / "tools" / "wood.catalog.json"
OUTPX = 2048                 # предел стороны текстуры
PLANK_PERIOD = (4.4, 3.7)    # желаемый повтор прямой доски, м (U вдоль доски, V поперёк)
HERRING_PERIOD = 4.4         # предел повтора ёлочки, м
MARGIN = 0.0025              # отступ внутрь доски на фото, м (не брать фугу с фото)
SEAM = 0.12                  # длина мягкого перехода при склейке доски из кусков, м
C45 = np.sqrt(0.5)

# Покрытие → шероховатость (абсолютная). Ключи ищутся в поле finish по порядку.
FINISH_ROUGH = [("ultramat", 0.62), ("półmat", 0.42), ("polmat", 0.42), ("olej", 0.58), ("oil", 0.58),
                ("lakier mat", 0.5), ("mat", 0.52), ("lakier", 0.38)]
# Фаска → (ширина, мм; глубина, мм)
BEVEL = {"4v": (2.0, 1.2), "2v": (2.0, 1.2), "v-fug": (2.0, 1.2), "design": (1.0, 0.5), "brak": (0.5, 0.25),
         "bez": (0.5, 0.25), "prasowan": (1.5, 0.6), "fazowan": (1.5, 0.8)}
TYPE_RU = {"engineered": "доска", "solid": "массив", "laminate": "ламинат", "vinyl": "винил"}
PATTERN_RU = {"herringbone": "ёлочка", "chevron": "фр. ёлочка"}


# ---------- фото ----------
def load_face(face):
    """Фото лица → линейный RGB float32 (y вниз), обрезка белого фона, поворот."""
    im = Image.open(ROOT / face["file"]).convert("RGB")
    if face.get("rotate"):
        im = im.rotate(face["rotate"], expand=True)
    a = np.asarray(im).astype(np.float32)
    if face.get("crop"):                               # [x0, y0, x1, y1] в долях
        h, w = a.shape[:2]
        x0, y0, x1, y1 = face["crop"]
        a = a[round(y0 * h):round(y1 * h), round(x0 * w):round(x1 * w)]
    rows = np.where((a.min(-1) <= 238).mean(1) > 0.6)[0]    # белый фон вокруг товара: сначала строки,
    a = a[rows[0] + 2:rows[-1] - 1]
    cols = np.where((a.min(-1) <= 238).mean(0) > 0.6)[0]    # потом столбцы (одна доска на белом)
    a = a[:, cols[0] + 2:cols[-1] - 1]
    return to_lin(a.astype(np.uint8))


def flatten_light(img, sigma_px):
    """Убирает крупный перепад освещения на фото (виньетка, свет из окна), оставляя разницу досок."""
    L = lum(img)
    s = max(4.0, sigma_px)
    small = max(1, int(s / 8))
    Ls = L[::small, ::small]
    blur = gauss_blur(np.pad(Ls, [(int(2 * s / small),) * 2] * 2, mode="reflect"), s / small)
    p = int(2 * s / small)
    blur = blur[p:p + Ls.shape[0], p:p + Ls.shape[1]]
    blur = np.asarray(Image.fromarray(blur.astype(np.float32), "F").resize(L.shape[::-1], Image.BILINEAR))
    return img * (blur.mean() / np.maximum(blur, 1e-4))[..., None]


def box1d(a, r, axis):
    c = np.cumsum(np.pad(a, [(r + 1, r) if i == axis else (0, 0) for i in range(a.ndim)], mode="edge"), axis=axis)
    n = a.shape[axis]
    return (np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(c, range(0, n), axis=axis)) / (2 * r + 1)


# ---------- прямая доска: ряды и стыки ----------
def detect_planks(img, f, dbg=None):
    """Ряды — по тёмным продольным фугам (их шаг = ширина доски), стыки — по тёмным поперечным линиям
    на всю высоту ряда. Возвращает (масштаб px/м, список кусков)."""
    L = np.log(lum(img) + 1e-3)
    H, W = L.shape
    w = f["size_mm"][1] / 1000
    if f.get("single"):                                    # фото одной целой доски на белом фоне
        s = W / (f["size_mm"][0] / 1000)
        pieces = [dict(O=np.zeros(2), A=np.array([s, 0.0]), B=np.array([0.0, s]),
                       len=W / s, wid=H / s, full=True, par=0)]
        if dbg is not None:
            dbg.append(("rows", [0, H - 1], H, s, pieces))
        return s, pieces
    prof = L.mean(1)
    g = np.maximum(box1d(prof, max(3, H // 150), 0) - prof, 0)
    g = g - box1d(g, max(8, H // 30), 0)
    lo, hi = max(6, int(H / 40)), int(H / 1.6)
    if f.get("rows_px"):
        pitch = f["rows_px"]
    else:
        ac = np.array([np.dot(g[:-k], g[k:]) / (H - k) for k in range(lo, hi)])
        # первый заметный пик (а не кратный ему)
        best = int(np.argmax(ac))
        for k in range(len(ac)):
            if ac[k] > 0.7 * ac[best] and (k == 0 or ac[k] >= ac[k - 1]) and (k + 1 >= len(ac) or ac[k] >= ac[k + 1]):
                best = k
                break
        pitch = lo + best
        # уточнение: дробный шаг по сумме тёмного на всех фугах
        cand = np.linspace(pitch * 0.97, pitch * 1.03, 31)
        sc = []
        for p_ in cand:
            phases = np.arange(0, p_, 0.5)
            ys = (phases[:, None] + np.arange(0, H / p_ + 1)[None, :] * p_)
            v = np.where(ys < H - 1, np.interp(ys, np.arange(H), g), 0).sum(1)
            sc.append(v.max())
        pitch = float(cand[int(np.argmax(sc))])

    def groove_phase(p_):
        ph = np.arange(0, p_, 0.5)
        ys = ph[:, None] + np.arange(0, H / p_ + 1)[None, :] * p_
        v = np.where(ys < H - 1, np.interp(ys, np.arange(H), g), 0).mean(1)
        return ph[int(np.argmax(v))], v.max()

    y0, v0 = groove_phase(pitch)
    def has_mid(n):                                       # есть ли фуги на 1/n, 2/n … шага
        mids = [y0 + pitch * k / n + j * pitch for k in range(1, n) for j in range(int(H / pitch) + 1)]
        mids = [m for m in mids if m < H - 1]
        a = [g[max(0, int(m - pitch * 0.03 / n)):int(m + pitch * 0.03 / n) + 1].max() for m in mids]
        return len(a) > 0 and np.median(a) >= 0.3 * v0

    while not f.get("rows_px"):                           # слабая фуга между рядами: шаг мог удвоиться/утроиться
        n = next((n for n in (2, 3) if pitch / n >= lo and has_mid(n)), None)
        if not n:
            break
        pitch /= n
        y0, v0 = groove_phase(pitch)
    grooves = []
    y = y0
    while y < H:
        a, b = int(max(0, y - pitch * 0.06)), int(min(H, y + pitch * 0.06 + 1))
        grooves.append(a + int(np.argmax(g[a:b])) if b > a else int(y))
        y += pitch
    s = pitch / w
    pieces = []
    Lr = f.get("L_range_mm") or [f["size_mm"][0]] * 2
    Lmin, Lmax = Lr[0] / 1000, Lr[1] / 1000
    for ga, gb in zip(grooves[:-1], grooves[1:]):
        if gb - ga < 0.9 * pitch:
            continue
        inset = max(2, int(0.2 * pitch))
        strip = L[ga + inset:gb - inset]
        hp = box1d(strip, max(3, int(0.006 * s)), 1) - strip      # тёмная узкая линия → плюс
        c = np.median(hp, 0)
        cov = (hp > 0.5 * np.maximum(c, 1e-6)[None, :]).mean(0)   # линия на всю высоту ряда
        noise = np.median(np.abs(c - np.median(c))) * 1.4826 + 1e-6
        score = np.where(cov > 0.8, c / noise, 0)
        joints = []
        order = np.argsort(-score)
        for x in order:
            if score[x] < f.get("joint_snr", 6):
                break
            if all(abs(x - j) > Lmin * s * 0.85 for j in joints):
                joints.append(int(x))
        joints.sort()
        ends = [0] + joints + [W - 1]
        for i in range(len(ends) - 1):
            xa, xb = ends[i], ends[i + 1]
            full = i > 0 and i < len(ends) - 2
            length = (xb - xa) / s
            if full and not (Lmin * 0.9 <= length <= Lmax * 1.1):
                full = False                                       # ложный стык — кусок как открытый
            if length < 0.12:
                continue
            pieces.append(dict(O=np.array([xa, ga], float), A=np.array([s, 0.0]), B=np.array([0.0, s]),
                               len=length, wid=(gb - ga) / s, full=full, par=0))
    if dbg is not None:
        dbg.append(("rows", grooves, pitch, s, pieces))
    return s, pieces


# ---------- ёлочка и французская ёлочка: геометрия ----------
def herring_lattice(L, w):
    """Периоды ёлочки: H-плашки в углах a·(w, w) + b·(L, −L); V-плашка — угол H + (L, w − L)."""
    return np.array([w, w]), np.array([L, -L])


def herring_locate(X, Y, L, w):
    """Ёлочка общего вида (L/w любое): H-плашка (вдоль X) в углу a·(w,w)+b·(L,−L), V-плашка (вдоль Y)
    в углу H + (L, w−L). Возвращает i=a, j=b, vert, угол куска, along, across, d (м до края)."""
    a0 = np.floor((X + Y) / (2 * w))
    b0 = np.floor((X - Y) / (2 * L))
    z = np.zeros_like(X)
    I, J, CX, CY, along, across = z.copy(), z.copy(), z.copy(), z.copy(), z.copy(), z.copy()
    vert, found = np.zeros(X.shape, bool), np.zeros(X.shape, bool)
    na = int(np.ceil((L + 2 * w) / (2 * w))) + 1
    for da in range(-na, 2):
        for db in (-1, 0, 1):
            a, b = a0 + da, b0 + db
            cx, cy = a * w + b * L, a * w - b * L
            for v, (x0, y0, ex, ey) in ((False, (cx, cy, L, w)), (True, (cx + L, cy + w - L, w, L))):
                inside = (~found) & (X >= x0) & (X < x0 + ex) & (Y >= y0) & (Y < y0 + ey)
                if inside.any():
                    I = np.where(inside, a, I); J = np.where(inside, b, J)
                    CX = np.where(inside, x0, CX); CY = np.where(inside, y0, CY)
                    along = np.where(inside, (Y - y0) if v else (X - x0), along)
                    across = np.where(inside, (X - x0) if v else (Y - y0), across)
                    vert |= inside & v
                    found |= inside
    d = np.minimum.reduce([along, L - along, across, w - across])
    return dict(i=I, j=J, vert=vert, cx=CX, cy=CY, along=along, across=across, d=d, ok=found)


def chevron_locate(X, Y, L, w):
    """Французская ёлочка 45°: L — длина плашки от острия до острия, кромка Le = L − w,
    колонны шириной Le·cos45 вдоль V. along ∈ [0, L] у обеих чётностей."""
    Wc, dd = (L - w) * C45, w / C45
    j = np.floor(X / Wc)
    xp = X - j * Wc
    odd = (np.mod(j, 2) == 1)
    t = np.where(odd, Y + xp - Wc, Y - xp)
    k = np.floor(t / dd)
    across = (t - k * dd) * C45
    along = np.where(odd, (xp - (Y - Wc - k * dd)) * C45 + w, (xp + (Y - k * dd)) * C45)
    d = np.minimum.reduce([across, w - across, xp, Wc - xp])
    cx = np.where(odd, j * Wc - w * C45, j * Wc)
    cy = np.where(odd, Wc + k * dd + w * C45, k * dd)
    return dict(i=k, j=j, vert=odd, cx=cx, cy=cy, along=along, across=across, d=d, ok=np.ones_like(X, bool))


def axes_of(kind, vert):
    """Куда в пространстве узора смотрят оси along и across куска."""
    one, zero = np.ones_like(vert, float), np.zeros_like(vert, float)
    if kind == "herringbone":
        return (np.where(vert, zero, one), np.where(vert, one, zero)), (np.where(vert, one, zero), np.where(vert, zero, one))
    c = C45 * one
    return (c, np.where(vert, -c, c)), (np.where(vert, c, -c), c)


# ---------- подбор решётки укладки по фото ----------
def edge_map(img, scale):
    L = np.log(lum(img) + 1e-3)
    im = Image.fromarray(L.astype(np.float32), "F")
    sm = im.resize((max(8, int(L.shape[1] * scale)), max(8, int(L.shape[0] * scale))), Image.BOX)
    a = np.asarray(sm)
    blur = box1d(box1d(a, 2, 0), 2, 1)
    G = np.maximum(blur - a, 0)
    return G, a


def dominant_angle(a):
    gy, gx = np.gradient(box1d(box1d(a, 1, 0), 1, 1))
    ang = np.mod(np.degrees(np.arctan2(gy, gx)), 90)
    wgt = gx ** 2 + gy ** 2
    hist, _ = np.histogram(ang, bins=90, range=(0, 90), weights=wgt)
    hist = hist + np.roll(hist, 1) + np.roll(hist, -1)
    return float(np.argmax(hist)) + 0.5


def lattice_basis(kind, L, w):
    """Короткий базис периодов узора (м) — для окна поиска сдвига."""
    if kind == "herringbone":
        return herring_lattice(L, w)
    return np.array([2 * (L - w) * C45, 0.0]), np.array([0.0, w / C45])


def corr_score(Gz, M, kind, L, w):
    """Лучший сдвиг узора с преобразованием M (px = M·P + O) по карте фуг Gz."""
    H, W = Gz.shape
    b1, b2 = (M @ b for b in lattice_basis(kind, L, w))
    px_, py_ = int(abs(b1[0]) + abs(b2[0])) + 2, int(abs(b1[1]) + abs(b2[1])) + 2
    Hc, Wc = H + py_, W + px_
    yy, xx = np.mgrid[0:Hc, 0:Wc].astype(np.float64)
    P = np.einsum("ij,jhw->ihw", np.linalg.inv(M), np.stack([xx + 0.5, yy + 0.5]))
    q = (herring_locate if kind == "herringbone" else chevron_locate)(P[0], P[1], L, w)
    s = np.sqrt(abs(np.linalg.det(M)))
    E = np.exp(-(q["d"] * s) ** 2)
    E -= E.mean()
    corr = np.fft.irfft2(np.conj(np.fft.rfft2(Gz, s=(Hc, Wc))) * np.fft.rfft2(E), s=(Hc, Wc))[:py_, :px_]
    k = int(np.argmax(corr))
    ty, tx = divmod(k, px_)
    sc = corr.flat[k] / (np.sqrt((E[:H, :W] ** 2).sum() * (Gz ** 2).sum()) + 1e-9)
    return sc, np.array([-tx, -ty], float)


def fit_lattice(img, f, kind, dbg=None):
    """Масштаб, поворот, зеркало и сдвиг узора по фуге на фото: грубо на 320 px, точнее на 640 px.
    Возвращает (M, O, score): px = O + M·P (P — метры в пространстве узора)."""
    L, w = f["size_mm"][0] / 1000, f["size_mm"][1] / 1000
    H0, W0 = img.shape[:2]

    def transform(rot, mir, s):
        th = np.radians(rot)
        R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
        return s * R @ np.diag([1.0, mir])

    an1 = 320 / max(H0, W0)
    G1, a1 = edge_map(img, an1)
    alpha = f.get("angle", dominant_angle(a1))
    rots = [alpha, alpha + 90] if kind == "herringbone" else [alpha + 45 * k for k in range(8)]   # у шеврона фуги и 0°, и 45°
    mirs = (1, -1) if kind == "herringbone" else (1,)
    wpx = [f["w_px"] * an1] if "w_px" in f else np.geomspace(3, 36, 26)
    cands = []
    for rot in rots:
        for mir in mirs:
            for wp in wpx:
                sc, O = corr_score(G1 - G1.mean(), transform(rot, mir, wp / w), kind, L, w)
                cands.append((sc, rot, mir, wp / an1))
    cands.sort(key=lambda c: -c[0])
    an2 = 640 / max(H0, W0)
    G2, _ = edge_map(img, an2)
    G2 = G2 - G2.mean()
    best = None
    for sc0, rot, mir, wfull in cands[:3]:
        for k in np.linspace(0.94, 1.06, 13):
            for dr in (-1.0, 0.0, 1.0):
                M = transform(rot + dr, mir, wfull * an2 * k / w)
                sc, O = corr_score(G2, M, kind, L, w)
                if best is None or sc > best[0]:
                    best = (sc, M, O, rot + dr, mir, wfull * k)
    sc, M, O, rot, mir, wfull = best
    if dbg is not None:
        dbg.append(("fit", dict(score=round(float(sc), 3), rot=round(rot, 1), mir=mir, w_px=round(wfull, 1))))
    return M / an2, O / an2, float(sc)


def lattice_pieces(img, f, kind, M, O, dbg=None):
    """Целые плашки, которые полностью видны на фото."""
    L, w = f["size_mm"][0] / 1000, f["size_mm"][1] / 1000
    H, W = img.shape[:2]
    Minv = np.linalg.inv(M)
    # центры кандидатов: проходим сеткой точек фото с шагом w/3
    step = w / 3 * np.linalg.norm(M[:, 0])
    yy, xx = np.mgrid[0:H:step, 0:W:step]
    P = Minv @ (np.stack([xx.ravel(), yy.ravel()]) - O[:, None])
    q = (herring_locate if kind == "herringbone" else chevron_locate)(P[0], P[1], L, w)
    seen, pieces = set(), []
    for n in range(P.shape[1]):
        key = (int(q["i"][n]), int(q["j"][n]), bool(q["vert"][n]))
        if key in seen:
            continue
        seen.add(key)
        vert = np.array([key[2]])
        (ax, ay), (bx, by) = axes_of(kind, vert)
        a_ = np.array([ax[0], ay[0]]); b_ = np.array([bx[0], by[0]])
        c_ = np.array([q["cx"][n], q["cy"][n]])
        corners = [c_ + u * a_ + v * b_ for u in (0, L) for v in (0, w)]
        if kind == "chevron":                                  # реальные углы параллелограмма
            uv = ((w, 0), (L, 0), (0, w), (L - w, w)) if key[2] else ((0, 0), (L - w, 0), (w, w), (L, w))
            corners = [c_ + u * a_ + v * b_ for u, v in uv]
        px = np.array([O + M @ c for c in corners])
        mg = 3
        if px[:, 0].min() < mg or px[:, 1].min() < mg or px[:, 0].max() > W - mg or px[:, 1].max() > H - mg:
            continue
        pieces.append(dict(O=O + M @ c_, A=M @ a_, B=M @ b_, len=L, wid=w, full=True, par=int(key[2]),
                           poly=px))
    if dbg is not None:
        dbg.append(("lattice", pieces))
    return pieces


# ---------- раскладка пола ----------
def plank_layout(f, rng, ppm_cap):
    """Ряды досок с реальной длиной. Период U = n·L (или сумма случайных длин), V = rows·w."""
    L, w = f["size_mm"][0] / 1000, f["size_mm"][1] / 1000
    Lr = f.get("L_range_mm")
    rows = max(4, round(PLANK_PERIOD[1] / w))
    if Lr:
        PU = PLANK_PERIOD[0]
    else:
        n = max(2, round(PLANK_PERIOD[0] / L))
        PU = n * L
    PV = rows * w
    ppm = min(OUTPX / PU, OUTPX / PV, ppm_cap)
    boards = []                        # (row, x0, length)
    prev = []
    for r in range(rows):
        if Lr:
            lo, hi = Lr[0] / 1000, Lr[1] / 1000
            while True:                # случайные длины, сумма = PU, стыки не ближе 15 см к стыкам ряда ниже
                ls, tot = [], 0.0
                while PU - tot > hi:
                    x = rng.uniform(lo, hi); ls.append(x); tot += x
                rest = PU - tot
                if rest < lo:
                    continue
                ls.append(rest)
                off = rng.uniform(0, PU)
                xs = np.mod(off + np.concatenate([[0], np.cumsum(ls)[:-1]]), PU)
                if all(min(abs(a - b), PU - abs(a - b)) > 0.15 for a in xs for b in prev):
                    break
            prev = list(xs)
            boards += [(r, x, l) for x, l in zip(xs, ls)]
        else:
            n = round(PU / L)
            while True:                # смещение стыков соседних рядов не меньше 0.3·L
                off = rng.uniform(0, L)
                if not prev or min(abs(((off - p) + L / 2) % L - L / 2) for p in prev) > 0.3 * L:
                    break
            prev = [off]
            boards += [(r, off + k * L, L) for k in range(n)]
    return PU, PV, ppm, boards


def locate_planks(X, Y, w, PU, boards, rows):
    r = np.clip(np.floor(Y / w).astype(int), 0, rows - 1)
    bid = np.full(X.shape, -1)
    along = np.zeros_like(X)
    by_row = {}
    for n, (row, x0, l) in enumerate(boards):
        by_row.setdefault(row, []).append((n, x0, l))
    for row, lst in by_row.items():
        m = r == row
        if not m.any():
            continue
        xr = X[m]
        bi = np.full(xr.shape, -1); al = np.zeros_like(xr)
        for n, x0, l in lst:
            u = np.mod(xr - x0, PU)
            ins = u < l
            bi = np.where(ins, n, bi); al = np.where(ins, u, al)
        bid[m] = bi; along[m] = al
    across = Y - r * w
    lens = np.array([b[2] for b in boards])
    d = np.minimum.reduce([along, lens[bid] - along, across, w - across])
    return bid, along, across, d


# ---------- сборка доски из кусков фото ----------
def assign(rng, pieces, n_out, need_len, parity=None, edge_prof=None):
    """Для каждой выходной доски — список сегментов (кусок, окно на куске, флипы, начало/конец)."""
    plan = []
    full = [p for p in pieces if p["full"]]
    for o in range(n_out):
        Lb = need_len[o]
        par = None if parity is None else parity[o]
        cand = [i for i, p in enumerate(pieces) if p["full"] and abs(p["len"] - Lb) < 0.1 * Lb
                and (par is None or p["par"] == par)]
        if cand:
            i = int(rng.choice(cand))
            plan.append([dict(p=i, st=0.0, en=Lb, o=0.0, ln=pieces[i]["len"], fa=rng.random() < 0.5,
                              fb=rng.random() < 0.5)])
            continue
        pool = [i for i, p in enumerate(pieces) if par is None or p["par"] == par]
        longest = max(pieces[i]["len"] for i in pool)
        if longest >= Lb * 0.97:
            ok = [i for i in pool if pieces[i]["len"] >= Lb * 0.97]
            i = int(rng.choice(ok)); p = pieces[i]
            o = rng.uniform(0, max(0.0, p["len"] - Lb))
            plan.append([dict(p=i, st=0.0, en=Lb, o=o, ln=min(Lb, p["len"]), fa=rng.random() < 0.5,
                              fb=rng.random() < 0.5)])
            continue
        # склейка: K кусков длиной ℓ с перекрытием SEAM
        usable = [i for i in pool if pieces[i]["len"] > 0.3]
        lmax = np.percentile([pieces[i]["len"] for i in usable], 75)
        K = int(np.ceil((Lb - SEAM) / (lmax - SEAM)))
        ell = (Lb + (K - 1) * SEAM) / K
        ok = [i for i in usable if pieces[i]["len"] >= ell] or usable
        segs, st = [], 0.0
        for k in range(K):
            i = int(rng.choice(ok)); p = pieces[i]
            ln = min(ell, p["len"])
            o = rng.uniform(0, max(0.0, p["len"] - ln))
            segs.append(dict(p=i, st=st, en=st + ell, o=o, ln=ln, fa=rng.random() < 0.5, fb=rng.random() < 0.5))
            st += ell - SEAM
        segs[-1]["en"] = Lb
        base = pieces[segs[0]["p"]]["mean"]           # куски одной доски — к яркости первого
        for sg in segs:
            sg["gain"] = float(np.clip(base / pieces[sg["p"]]["mean"], 0.8, 1.25))
        plan.append(segs)
    return plan


def render(f, kind, srcs, pieces, rng, dbg=None):
    """Раскладка → линейный цвет, высота фуги/рельефа, шероховатость (массивы y-вверх)."""
    L, w = f["size_mm"][0] / 1000, f["size_mm"][1] / 1000
    src_ppm = min(np.linalg.norm(p["A"]) for p in pieces)
    ppm_cap = src_ppm * 1.0
    if kind == "planks":
        PU, PV, ppm, boards = plank_layout(f, rng, ppm_cap)
        rows = round(PV / w)
        n_out = len(boards)
        need = [b[2] for b in boards]
        parity = None
    else:
        if kind == "herringbone":
            N = round(2 * L / w)
            k = max(1, int(HERRING_PERIOD // (2 * L)))
            if N * k % 2:                       # квадратный период 2L·k есть в решётке только при чётном N·k
                k = k - 1 if k > 1 else 2
            PU = PV = 2 * L * k
        else:
            Wc, dd = (L - w) * C45, w / C45
            cols = max(2, 2 * int(HERRING_PERIOD // (2 * Wc)))
            rows_c = max(4, int(HERRING_PERIOD // dd))
            PU, PV = cols * Wc, rows_c * dd
        ppm = min(OUTPX / PU, OUTPX / PV, ppm_cap)
    W, H = round(PU * ppm), round(PV * ppm)
    ppx, ppy = W / PU, H / PV
    color = np.zeros((H, W, 3), np.float32)
    relief = np.zeros((H, W), np.float32)
    dist = np.zeros((H, W), np.float32)
    keymap = {}
    plan = None
    if kind == "planks":
        plan = assign(rng, pieces, n_out, need, None)
    jit = None
    for y0 in range(0, H, 256):
        y1 = min(H, y0 + 256)
        Yg, Xg = np.mgrid[y0:y1, 0:W].astype(np.float64)
        X, Y = (Xg + 0.5) / ppx, (Yg + 0.5) / ppy
        if kind == "planks":
            oid, along, across, d = locate_planks(X, Y, w, PU, boards, rows)
            vert = np.zeros(X.shape, bool)
            ax_ = ((np.ones_like(X), np.zeros_like(X)), (np.zeros_like(X), np.ones_like(X)))
        else:
            q = (herring_locate if kind == "herringbone" else chevron_locate)(X, Y, L, w)
            along, across, d, vert = q["along"], q["across"], q["d"], q["vert"]
            if kind == "herringbone":         # канонический id внутри периода
                Q = 2 * N * k                                   # период в единицах w/2
                cxm = np.mod(np.round(q["cx"] / (w / 2)).astype(int), Q)
                cym = np.mod(np.round(q["cy"] / (w / 2)).astype(int), Q)
                key = (cxm * Q + cym) * 2 + vert
            else:
                kk, jj = q["i"].astype(int), q["j"].astype(int)
                key = np.mod(jj, cols) * rows_c + np.mod(kk, rows_c)
            uk, inv = np.unique(key, return_inverse=True)
            for kv in uk.tolist():
                keymap.setdefault(kv, len(keymap))
            oid = np.array([keymap[kv] for kv in uk.tolist()])[inv.reshape(key.shape)]
        # план для новых кусков (ёлочка: по мере появления id)
        if kind != "planks":
            nk = len(keymap)
            if plan is None or len(plan) < nk:
                old = 0 if plan is None else len(plan)
                par = [None] * (nk - old)
                if kind == "chevron":                # чётность колонны = форма параллелограмма
                    inv = {v: kk_ for kk_, v in keymap.items()}
                    par = [int((inv[o] // rows_c) % 2) for o in range(old, nk)]
                need_l = L
                add = assign(rng, pieces, nk - old, [need_l] * (nk - old), par if kind == "chevron" else None)
                plan = (plan or []) + add
        nmax = len(plan)
        if jit is None or len(jit) < nmax:
            jit = np.concatenate([jit if jit is not None else np.zeros((0, 3)),
                                  rng.normal(0, [0.025, 0.006, 0.006], (nmax - (0 if jit is None else len(jit)), 3))])
        acc = np.zeros(X.shape + (3,), np.float32)
        accr = np.zeros(X.shape, np.float32)
        wsum = np.zeros(X.shape, np.float32)
        kmax = max(len(p) for p in plan)
        for sidx in range(kmax):
            P_i = np.array([p[sidx]["p"] if sidx < len(p) else -1 for p in plan])
            pi = P_i[oid]
            valid = pi >= 0
            if not valid.any():
                continue
            def g(name, dflt=0.0):
                return np.array([p[sidx].get(name, dflt) if sidx < len(p) else dflt for p in plan], float)[oid]
            st, en, o, ln = g("st"), g("en"), g("o"), g("ln", 1.0)
            fa, fb = g("fa") > 0.5, g("fb") > 0.5
            gain = g("gain", 1.0)
            first = sidx == 0
            last = np.array([sidx == len(p) - 1 for p in plan])[oid]
            wgt = np.ones(X.shape, np.float32)
            if not first:
                wgt *= np.clip((along - st) / SEAM, 0, 1)
            wgt *= np.where(last, 1.0, np.clip((en - along) / SEAM, 0, 1))
            wgt *= (along >= st - 1e-6) & (along <= en + 1e-6) & valid
            span = np.maximum(en - st, 1e-6)
            t = np.clip((along - st) / span, 0, 1)
            # окно на куске: [o, o+ln], отступ от торцов только у целых досок
            plen = np.array([pieces[i]["len"] for i in range(len(pieces))])[np.maximum(pi, 0)]
            pwid = np.array([pieces[i]["wid"] for i in range(len(pieces))])[np.maximum(pi, 0)]
            pfull = np.array([pieces[i]["full"] for i in range(len(pieces))])[np.maximum(pi, 0)]
            mA = np.where(pfull & (ln >= plen * 0.97), MARGIN, 0.0)
            a_src = o + mA + np.where(fa, 1 - t, t) * (ln - 2 * mA)
            a_src = np.clip(a_src, 0.0005, plen - 0.0005)
            tb = np.clip(across / w, 0, 1)
            b_src = MARGIN + np.where(fb, 1 - tb, tb) * (pwid - 2 * MARGIN)
            for si in np.unique(pi[valid]):
                m = (pi == si) & (wgt > 0)
                if not m.any():
                    continue
                pc = pieces[si]
                px = pc["O"][0] + a_src[m] * pc["A"][0] + b_src[m] * pc["B"][0]
                py = pc["O"][1] + a_src[m] * pc["A"][1] + b_src[m] * pc["B"][1]
                s_img = srcs[pc["img"]]
                smp = bilinear(s_img["data"], px - 0.5, py - 0.5)
                acc[m] += smp[:, :3] * (wgt[m] * gain[m])[:, None]
                accr[m] += smp[:, 3] * wgt[m]
                wsum[m] += wgt[m]
        c = acc / np.maximum(wsum, 1e-6)[..., None]
        jj_ = jit[oid]
        c = c * (1 + jj_[..., 0:1])
        c[..., 0] *= 1 + jj_[..., 1]
        c[..., 2] *= 1 - jj_[..., 1]
        # строки y0..y1 считаются от низа (y-вверх)
        color[y0:y1] = c
        relief[y0:y1] = accr / np.maximum(wsum, 1e-6)
        dist[y0:y1] = d
    return dict(color=color, relief=relief, dist=dist, PU=PU, PV=PV, ppx=ppx, ppy=ppy, n=len(plan))


# ---------- карты ----------
def rough_of(finish):
    f = (finish or "").lower()
    for k, v in FINISH_ROUGH:
        if k in f:
            return v
    return 0.5


def bevel_of(bevel):
    b = (bevel or "").lower()
    for k, v in BEVEL.items():
        if k in b:
            return v
    return BEVEL["bez"]


def save_maps(out, R, f):
    color, relief, d = R["color"], R["relief"], R["dist"]
    bw, bd = bevel_of(f.get("bevel"))
    bw, bd = f.get("tex", {}).get("bevel_mm", bw) / 1000, bd / 1000
    px = 1 / min(R["ppx"], R["ppy"])
    e = np.clip(1 - (d - px * 0.25) / max(bw, px * 0.6), 0, 1)
    color = color * (1 - 0.45 * e ** 1.3)[..., None]
    h = -bd * e ** 1.2 + relief * f.get("tex", {}).get("relief_mm", 0.05) / 1000
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * R["ppx"] / 2
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * R["ppy"] / 2
    n = np.stack([-gx, -gy, np.ones_like(gx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    r0 = f.get("tex", {}).get("rough", rough_of(f.get("finish")))
    rough = r0 + 0.08 * np.clip(-relief, -1.5, 1.5) + 0.25 * e
    out.mkdir(parents=True, exist_ok=True)
    col8 = np.flipud(to_srgb8(color))
    Image.fromarray(col8).save(out / "color.jpg", quality=85, optimize=True, progressive=True)
    Image.fromarray(np.flipud(((n * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8))).save(
        out / "normal.jpg", quality=82, optimize=True, progressive=True)
    Image.fromarray(np.flipud((np.clip(rough, 0.05, 1) * 255 + 0.5).astype(np.uint8)), "L").save(
        out / "rough.jpg", quality=82, optimize=True, progressive=True)
    s = min(col8.shape[:2], key=int)
    side = min(s, int(1.2 * R["ppx"]))            # миниатюра: 1.2 м пола
    Image.fromarray(col8[:side, :side]).resize((160, 160), Image.LANCZOS).save(out / "thumb.jpg", quality=84)
    (out / "meta.json").write_text(json.dumps({"size": round(R["PU"], 4), "sizeV": round(R["PV"], 4), "rough": 1}) + "\n")


# ---------- записи ----------
def catalog_entry(f):
    L, w = f["size_mm"][0], f["size_mm"][1]
    kind = PATTERN_RU.get(f["pattern"]) or TYPE_RU[f["type"]]
    if f["pattern"] != "planks" and f["type"] != "engineered":
        kind = f"{TYPE_RU[f['type']]}, {kind}"
    size = f"{w / 10:g}×{L / 10:g} см" if not f.get("L_range_mm") else \
        f"{w / 10:g}×{f['L_range_mm'][0] / 10:g}–{f['L_range_mm'][1] / 10:g} см"
    size = size.replace(".", ",")
    price = f"{f['price_pln_m2']:g} zł/m²".replace(".", ",") if f.get("price_pln_m2") else "цена по запросу"
    e = {"id": f["id"], "name": f"{f['brand']} {f['model']} · {kind} {size}", "tex": f["id"], "gen": True, "cat": "wood",
         "note": f"{f['brand']} · {price} · {f['shop']}"}
    if f["pattern"] == "herringbone":
        e["rotation"] = np.pi / 4
    return e


def source_md(f, R):
    L, w, t = f["size_mm"]
    lines = [f"# {f['brand']} {f['model']}", "",
             f"- Товар: {f['name']}",
             f"- Бренд: {f['brand']}; тип: {f['type']}; укладка: {f['pattern']}",
             f"- Артикул: {f.get('article', '—')}",
             f"- Размер: {L:g} × {w:g} × {t:g} мм" + (f" (длины {f['L_range_mm'][0]}–{f['L_range_mm'][1]} мм)" if f.get('L_range_mm') else ""),
             f"- Класс: {f.get('class') or '—'}",
             f"- Покрытие: {f.get('finish') or '—'}; фаска: {f.get('bevel') or '—'}",
             f"- Цена: {str(f['price_pln_m2']).replace('.', ',') + ' zł/m²' if f.get('price_pln_m2') else 'цена по запросу'}"
             + (f" ({f['pack']})" if f.get('pack') else ""),
             f"- Магазин: {f['shop']}, {f['url']}",
             f"- Дата: {f['date']}",
             f"- Фото лица (сверху): " + ", ".join(fc["file"] for fc in f["faces"]),
             f"- Источник фото: " + ", ".join(fc.get("src", "") for fc in f["faces"]),
             "- Лицензия фото: фото товара с сайта магазина/производителя, только для личной визуализации.",
             f"- Текстура: tools/make_wood.py; повтор {R['PU']:.3f} × {R['PV']:.3f} м, досок/плашек в повторе: {R['n']}."
             + (f" Ширина плашки в узоре подогнана до {2 * L / round(2 * L / w):.1f} мм (2L/w целое)."
                if f["pattern"] == "herringbone" and abs(2 * L / round(2 * L / w) - w) > 0.05 else ""),
             ""]
    if f.get("notes"):
        lines.insert(-1, f"- Заметки: {f['notes']}")
    return "\n".join(lines)


def debug_draw(path, img, dbg, f):
    im = Image.fromarray(to_srgb8(np.clip(img, 0, 1)))
    dr = ImageDraw.Draw(im)
    for kind, *rest in dbg:
        if kind == "rows":
            grooves, pitch, s, pieces = rest
            for gy in grooves:
                dr.line([(0, gy), (im.width, gy)], fill=(0, 255, 255), width=3)
            for p in pieces:
                x0, y0 = p["O"]; x1 = x0 + p["len"] * s; y1 = y0 + p["wid"] * s
                dr.rectangle([x0 + 4, y0 + 4, x1 - 4, y1 - 4], outline=(255, 0, 0) if p["full"] else (255, 200, 0), width=4)
        if kind == "lattice":
            for p in rest[0]:
                pts = [tuple(x) for x in p["poly"]]
                pts = [pts[0], pts[1], pts[3], pts[2]]
                dr.polygon(pts, outline=(255, 0, 0), width=3)
    im.thumbnail((1000, 1000))
    im.save(path, quality=80)


def build(f, debug_dir=None):
    rng = np.random.default_rng(zlib.crc32(f["id"].encode()))
    kind = f["pattern"]
    rec = f                            # запись товара как есть (для SOURCE.md)
    if kind == "herringbone":          # 2L/w должно быть целым: ширину подгоняем (≤ 4 %)
        L, w = f["size_mm"][0], f["size_mm"][1]
        N = round(2 * L / w)
        f = dict(f, size_mm=[L, 2 * L / N, f["size_mm"][2]])
    srcs, pieces, info = [], [], []
    for k, face in enumerate(f["faces"]):
        img = load_face(face)
        dbg = []
        if kind == "planks":
            s, ps = detect_planks(img, {**f, **face}, dbg)
        else:
            M, O, sc = fit_lattice(img, {**f, **face}, kind, dbg)
            s = float(np.sqrt(abs(np.linalg.det(M))))
            ps = lattice_pieces(img, f, kind, M, O, dbg)
        if face.get("flatten", True):
            img = flatten_light(img, 0.6 * s)
        Lm = lum(img)
        for p in ps:                                      # средняя яркость куска (для склейки)
            a_, b_ = np.meshgrid(np.linspace(0.05, 0.95, 12) * p["len"], np.linspace(0.2, 0.8, 4) * p["wid"])
            xs = np.clip(p["O"][0] + a_ * p["A"][0] + b_ * p["B"][0], 0, Lm.shape[1] - 1).astype(int)
            ys = np.clip(p["O"][1] + a_ * p["A"][1] + b_ * p["B"][1], 0, Lm.shape[0] - 1).astype(int)
            p["mean"] = float(Lm[ys, xs].mean()) + 1e-4
        rel = Lm - gauss_blur(Lm, max(1.0, 0.003 * s))
        rel = rel / (rel.std() + 1e-6)
        srcs.append(dict(data=np.concatenate([img, rel[..., None]], -1).astype(np.float32)))
        for p in ps:
            p["img"] = len(srcs) - 1
        pieces += ps
        info.append(dict(face=face["file"], ppm=round(s), pieces=len(ps), full=sum(p["full"] for p in ps),
                         **({k_: v for k_, v in dbg[0][1].items()} if dbg and dbg[0][0] == "fit" else {})))
        if debug_dir:
            debug_draw(pathlib.Path(debug_dir) / f"{f['id']}-{k}.jpg", img, dbg, f)
    if not pieces:
        raise RuntimeError("на фото не нашлось досок")
    R = render(f, kind, srcs, pieces, rng)
    out = TEX / f["id"]
    save_maps(out, R, f)
    (out / "SOURCE.md").write_text(source_md(rec, R))
    return R, info


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    debug_dir = None
    if "--debug" in sys.argv:
        debug_dir = sys.argv[sys.argv.index("--debug") + 1]
        args = [a for a in args if a != debug_dir]
        pathlib.Path(debug_dir).mkdir(parents=True, exist_ok=True)
    m = json.loads(MANIFEST.read_text())
    for f in m["floors"]:
        if args and f["id"] not in args:
            continue
        if (TEX / f["id"] / "meta.json").exists() and not force:
            continue
        try:
            R, info = build(f, debug_dir)
            print(f"{f['id']:36s} {R['PU']:.2f} x {R['PV']:.2f} m  {R['n']} pcs  {info}")
        except Exception as e:          # одна сломанная запись не роняет остальные
            print(f"{f['id']:36s} ОШИБКА: {e}")
            if args:
                raise
    entries = [catalog_entry(f) for f in m["floors"] if (TEX / f["id"] / "meta.json").exists()]
    CATALOG_OUT.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
