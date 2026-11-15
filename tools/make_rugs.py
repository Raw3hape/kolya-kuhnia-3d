"""Ковры: наборы текстур из фото IKEA сверху (каталог — web/spec/rugs.json, источники — SOURCE.md у каждой текстуры).
usage: uv run --with numpy --with pillow tools/make_rugs.py <temp dir for photos> [id ...]
Фото качаются во временную папку (src = путь после ikea.com/pl/pl/images/products/), после сборки её удалить.
Tile mode: interior crop -> lighting flatten -> phase-matched overlap blend (no mirroring) -> maps.
Whole mode: whole rug top view, stretched once over the rug by the app.
"""
import sys, json, pathlib, io, urllib.request
import numpy as np
from PIL import Image

RAW = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(__file__).resolve().parent.parent / "web" / "textures" / "rugs"
ONLY = set(sys.argv[2:])
IMG = "https://www.ikea.com/pl/pl/images/products/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# id, photo (item dir, image prefix), physical size of the rug in that photo (w, d in m), mode, options
RUGS = [
    dict(id="stoense_cream",   src="stoense-dywan-z-krotkim-wlosiem-kremowy__0624373_pe691791_s5.jpg", rug=(1.33, 1.95), pile="low",  keep=0.35),
    dict(id="stoense_grey",    src="stoense-dywan-z-krotkim-wlosiem-srednioszary__0624371_pe691789_s5.jpg", rug=(1.33, 1.95), pile="low",  keep=0.35),
    dict(id="tversted_beige",  src="tversted-dywan-z-krotkim-wlosiem-bezowy__1179213_pe895885_s5.jpg", rug=(1.70, 2.40), pile="low",  whole=True, edge=7),
    dict(id="bronden_beige",   src="broenden-dywan-z-krotkim-wlosiem-wykonano-recznie-bezowy__0804523_pe769465_s5.jpg", rug=(1.70, 2.40), pile="low",  whole=True, edge=9),
    dict(id="aerende_cream",   src="aerende-dywan-z-dlugim-wlosiem-kremowy__1416048_pe975419_s5.jpg", rug=(1.20, 1.80), pile="high", keep=0.35),
    dict(id="vollerslev_white", src="vollerslev-dywan-z-dlugim-wlosiem-bialy__0933663_pe792171_s5.jpg", rug=(1.60, 2.30), pile="high", keep=0.35),
    dict(id="vollerslev_beige", src="vollerslev-dywan-z-dlugim-wlosiem-bezowy__1416364_pe975530_s5.jpg", rug=(1.33, 1.95), pile="high", keep=0.2, rowflat=0.4),
    dict(id="tidtabell_beige", src="tidtabell-dywan-tkany-na-plasko-bezowy__1185180_pe898299_s5.jpg", rug=(1.70, 2.40), pile="flat", keep=0.85, aniso=True),
    dict(id="lohals_jute",     src="lohals-dywan-tkany-na-plasko-naturalny__0280221_pe419173_s5.jpg", rug=(1.60, 2.30), pile="flat", keep=0.2, rowflat=0.3),
    dict(id="morum_beige",     src="morum-dywan-tkany-na-plasko-wewn-zewn-bezowy__1482762_pe1001127_s5.jpg", rug=(1.20, 1.80), pile="flat", keep=0.5, border=True),
    dict(id="tidtabell_green", src="tidtabell-dywan-tkany-na-plasko-zielony__1205724_pe907222_s5.jpg", rug=(1.70, 2.40), pile="flat", keep=0.85, aniso=True),
    dict(id="stockholm_stripe", src="stockholm-dywan-tkany-na-plasko-wykonano-recznie-w-paski-czarny-zlamana-biel__56123_pe161531_s5.jpg", rug=(1.70, 2.40), pile="flat", whole=True, edge=6),
]
PILE = {"flat": dict(sig=1.2, k=2.2, rough=0.88), "low": dict(sig=1.6, k=2.6, rough=0.92), "high": dict(sig=2.2, k=3.4, rough=0.94)}


def to_lin(a8):
    c = a8.astype(np.float32) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb8(c):
    c = np.clip(c, 0, 1)
    s = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return (s * 255 + 0.5).clip(0, 255).astype(np.uint8)


def lum(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def blur(a, sx, sy=None):
    """Gaussian via FFT (wraps). a: HxW or HxWxC."""
    sy = sx if sy is None else sy
    fy, fx = np.fft.fftfreq(a.shape[0])[:, None], np.fft.fftfreq(a.shape[1])[None, :]
    k = np.exp(-2 * np.pi ** 2 * ((sx * fx) ** 2 + (sy * fy) ** 2))
    if a.ndim == 3:
        k = k[..., None]
        return np.real(np.fft.ifft2(np.fft.fft2(a, axes=(0, 1)) * k, axes=(0, 1))).astype(np.float32)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k)).astype(np.float32)


def blur_pad(a, s):
    """Non-wrapping blur: reflect-pad, blur, crop."""
    p = int(3 * s) + 1
    pad = ((p, p), (p, p)) + (((0, 0),) if a.ndim == 3 else ())
    return blur(np.pad(a, pad, mode="reflect"), s)[p:-p, p:-p]


def bbox(a8, thr=12):
    a = a8.astype(np.int16)
    m = np.abs(a - 255).max(-1) > thr
    rows = np.where(m.mean(1) > 0.3)[0]; cols = np.where(m.mean(0) > 0.3)[0]
    return cols[0], rows[0], cols[-1] + 1, rows[-1] + 1


def flatten_quadratic(c):
    """Divide out a 2nd-order luminance trend (studio light falloff)."""
    H, W = c.shape[:2]
    L = lum(c)
    ys, xs = np.mgrid[0:H:8, 0:W:8]
    v = L[::8, ::8]
    X, Y = xs / W - 0.5, ys / H - 0.5
    A = np.stack([np.ones_like(X), X, Y, X * X, Y * Y, X * Y], -1).reshape(-1, 6)
    coef, *_ = np.linalg.lstsq(A, v.reshape(-1), rcond=None)
    Yf, Xf = np.mgrid[0:H, 0:W]
    Xf, Yf = Xf / W - 0.5, Yf / H - 0.5
    trend = coef[0] + coef[1] * Xf + coef[2] * Yf + coef[3] * Xf * Xf + coef[4] * Yf * Yf + coef[5] * Xf * Yf
    return c * (coef[0] / trend)[..., None]


def wrap_axis(c, frac=0.16, search=0.08):
    """Make columns periodic: pick period N whose overlap best matches the start (weave phase), then
    blend the strip right after N into the start. Low-pass blends linearly, high-pass variance-preserving."""
    H, W = c.shape[:2]
    o = max(8, int(W * frac))
    hp = lum(c) - lum(blur_pad(c, 6))
    best, bestN = -9, W - o
    for N in range(int(W - o - W * search), W - o + 1):
        a, b = hp[:, N:N + o].ravel(), hp[:, :o].ravel()
        r = np.dot(a - a.mean(), b - b.mean()) / (a.std() * b.std() * a.size + 1e-9)
        if r > best:
            best, bestN = r, N
    N = bestN
    A, B = c[:, N:N + o], c[:, :o]
    t = ((np.arange(o) + 0.5) / o)[None, :, None]
    t = t * t * (3 - 2 * t)
    lpA, lpB = blur_pad(A, 4), blur_pad(B, 4)
    w1, w2 = 1 - t, t
    hpm = ((A - lpA) * w1 + (B - lpB) * w2) / np.sqrt(w1 ** 2 + w2 ** 2)
    out = c[:, :N].copy()
    out[:, :o] = lpA * w1 + lpB * w2 + hpm
    return out, best


def maps(c, pile, out, meta, thumb_frac=0.6):
    P = PILE[pile]
    H, W = c.shape[:2]
    L = lum(c)
    h = L - blur(L, P["sig"] * 3)          # wraps: tile is periodic
    h = blur(h, 0.7)
    h = h / (h.std() + 1e-6)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / 2
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / 2
    k = P["k"] / 10
    n = np.stack([-gx * k, gy * k, np.ones_like(gx)], -1)    # rows go down, texture v goes up
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    rough = np.clip(P["rough"] - 0.02 * np.clip(h, -1.5, 1.5), 0.85, 0.96)
    out.mkdir(parents=True, exist_ok=True)
    save_jpg(Image.fromarray(to_srgb8(c)), out / "color.jpg", 88)
    save_jpg(Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8)), out / "normal.jpg", 88)
    save_jpg(Image.fromarray((rough * 255 + 0.5).astype(np.uint8), "L"), out / "rough.jpg", 85)
    s = int(min(H, W) * thumb_frac)
    y0, x0 = (H - s) // 2, (W - s) // 2
    Image.fromarray(to_srgb8(c[y0:y0 + s, x0:x0 + s])).resize((160, 160), Image.LANCZOS).save(out / "thumb.jpg", quality=84)
    (out / "meta.json").write_text(json.dumps(meta) + "\n")
    m = c.reshape(-1, 3).mean(0)
    return "#" + "".join(f"{v:02x}" for v in to_srgb8(m))


def save_jpg(im, path, q):
    while True:
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=q, optimize=True)
        if buf.tell() <= 400_000 or q <= 60:
            path.write_bytes(buf.getvalue()); return
        q -= 4


def build(r):
    fn = RAW / r["src"].split("__")[1]
    if not fn.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(IMG + r["src"], headers={"User-Agent": UA})
        fn.write_bytes(urllib.request.urlopen(req, timeout=40).read())
    fn = str(fn)
    a8 = np.asarray(Image.open(fn).convert("RGB"))
    x0, y0, x1, y1 = bbox(a8)
    ppm = ((x1 - x0) / r["rug"][0] + (y1 - y0) / r["rug"][1]) / 2
    info = dict(src=fn.split("/")[-1], bbox=[int(x0), int(y0), int(x1), int(y1)], ppm=round(ppm, 1))
    out = OUT / r["id"]
    if r.get("border"):     # bound edge: colour and width from the side strips of the photo
        c = to_lin(a8[y0:y1, x0:x1])
        prof = lum(c[int(0.2 * c.shape[0]):int(0.8 * c.shape[0])]).mean(0)
        inner = np.median(prof[60:-60])
        edge = prof[2:60]
        # width: first index where the side profile drops back to the field level
        d = np.abs(edge - inner) / inner
        wpx = int(np.argmax(d < 0.04)) if (d < 0.04).any() else 8
        bcol = c[int(0.2 * c.shape[0]):int(0.8 * c.shape[0]), 3:max(4, wpx - 1)].reshape(-1, 3).mean(0)
        info["border"] = dict(color="#" + "".join(f"{v:02x}" for v in to_srgb8(bcol)), w=round(max(wpx, 4) / ppm, 3))
    if r.get("whole"):
        e = r.get("edge", 3)
        c = to_lin(a8[y0 + e:y1 - e, x0 + e:x1 - e])
        H, W = c.shape[:2]
        s = min(1.0, 1024 / max(H, W))
        if s < 1:
            c = to_lin(np.asarray(Image.fromarray(to_srgb8(c)).resize((round(W * s), round(H * s)), Image.LANCZOS)))
        info["color"] = maps(c, r["pile"], out, {"whole": True, "rough": 1}, thumb_frac=1.0)
        info["tile"] = None
        return info
    ins = int(0.06 * min(x1 - x0, y1 - y0))
    c = to_lin(a8[y0 + ins:y1 - ins, x0 + ins:x1 - ins])
    c = flatten_quadratic(c)
    H, W = c.shape[:2]
    keep = r.get("keep", 0.4)
    if keep < 1:            # soften low-frequency blotches that would read as repeats
        sig = 0.06 * min(H, W)
        lp = lum(blur_pad(c, sig)) if not r.get("aniso") else None
        if r.get("aniso"):   # banded weave: only flatten along the bands (x), keep the bands (y)
            p = int(3 * sig) + 1
            lp = lum(blur(np.pad(c, ((p, p), (p, p), (0, 0)), mode="reflect"), sig, 1.0)[p:-p, p:-p])
        c = c * ((lp.mean() / lp) ** (1 - keep))[..., None]
    if r.get("rowflat") is not None:   # even out weft-density bands (row brightness), keep a share
        rm = lum(c).mean(1)
        rm = np.convolve(np.pad(rm, 40, mode="reflect"), np.exp(-np.linspace(-3, 3, 41) ** 2 / 2) / np.exp(-np.linspace(-3, 3, 41) ** 2 / 2).sum(), "same")[40:-40]
        c = c * ((rm.mean() / rm) ** (1 - r["rowflat"]))[:, None, None]
    c, sx = wrap_axis(c)
    c, sy = wrap_axis(c.transpose(1, 0, 2))
    c = c.transpose(1, 0, 2)
    H, W = c.shape[:2]
    tile_u, tile_v = W / ppm, H / ppm
    s = min(1.0, 1024 / max(H, W))
    if s < 1:
        c = to_lin(np.asarray(Image.fromarray(to_srgb8(c)).resize((round(W * s), round(H * s)), Image.LANCZOS)))
    info["color"] = maps(c, r["pile"], out, {"size": round(tile_u, 3), "sizeV": round(tile_v, 3), "rough": 1})
    info.update(tile=round(tile_u, 3), tileV=round(tile_v, 3), px=[int(c.shape[1]), int(c.shape[0])], match=[round(sx, 2), round(sy, 2)])
    return info


if __name__ == "__main__":
    res = {}
    for r in RUGS:
        if ONLY and r["id"] not in ONLY:
            continue
        res[r["id"]] = build(r)
        print(r["id"], res[r["id"]])
    (RAW / "build_info.json").write_text(json.dumps(res, indent=1, default=float))
