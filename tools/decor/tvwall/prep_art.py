# Картины для рамок стены с ТВ: обрезка общественного достояния (Wikimedia Commons, PD) под окно паспарту.
# uv run --with pillow python tools/decor/tvwall/prep_art.py <src_dir> <out_dir>
#   src_dir/<src>.jpg (скачаны вручную по ссылкам из ART ниже) -> out_dir/<id>.jpg, длинная сторона 768 px.
# Пропорция окна (w/h) должна совпадать с "window" рамки в build.py (FRAMES).
import os, sys
from PIL import Image, ImageOps

ART = {
    # id: (файл, w/h окна, обрезка краёв до кадрирования: доли l, t, r, b)
    "vertumnus": ("vertumnus.jpg", 0.75, (0.0, 0.0, 0.0, 0.0)),   # Arcimboldo, Vertumnus, 1591
    "poker":     ("poker.jpg", 4 / 3, (0.035, 0.03, 0.035, 0.05)),  # C. M. Coolidge, A Friend in Need, 1903 (снимок с полями)
    "hare":      ("hare.jpg", 0.75, (0.04, 0.03, 0.04, 0.03)),      # A. Dürer, Feldhase, 1502
    "tiger":     ("tiger.jpg", 1.30, (0.0, 0.0, 0.0, 0.0)),         # H. Rousseau, Surprised!, 1891
    "catfish":   ("catfish.jpg", 0.684, (0.0, 0.0, 0.0, 0.0)),      # Utagawa Kuniyoshi, коты-иероглифы «намадзу», ок. 1842
}

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for k, (f, aspect, (l, t, r, b)) in ART.items():
    im = Image.open(os.path.join(src, f)).convert("RGB")
    W, H = im.size
    im = im.crop((int(W * l), int(H * t), int(W * (1 - r)), int(H * (1 - b))))
    im = ImageOps.fit(im, (round(768 * min(aspect, 1)), round(768 / max(aspect, 1))), Image.LANCZOS, centering=(0.5, 0.45))
    im.save(os.path.join(out, k + ".jpg"), quality=86)
    print(k, im.size)
