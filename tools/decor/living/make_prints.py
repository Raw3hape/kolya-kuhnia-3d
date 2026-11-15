# Абстрактные принты для рамок art-print-* (свои, CC0): тёплая палитра гостиной на бумаге цвета слоновой кости.
# uv run --with pillow python make_prints.py <out_dir>   -> art-print-arch.png, art-print-sun.png (600×848, 1:√2)
import sys, os, math, random
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
W, H = 600, 848
PAPER, TERRA, OCHRE, SAGE, INK, BLUSH = "#efe8da", "#b45f3e", "#c99a45", "#8d977a", "#2b2a27", "#d7a99a"


def paper(seed):
    rnd = random.Random(seed)
    im = Image.new("RGB", (W, H), PAPER)
    px = im.load()
    for _ in range(9000):  # зерно бумаги
        x, y = rnd.randrange(W), rnd.randrange(H)
        r, g, b = px[x, y]
        d = rnd.randint(-6, 4)
        px[x, y] = (r + d, g + d, b + d)
    return im


def arch():
    im = paper(1)
    d = ImageDraw.Draw(im)
    m = 70  # поле паспарту
    # большая терракотовая арка
    d.rectangle([m + 40, 360, m + 280, H - m - 40], fill=TERRA)
    d.pieslice([m + 40, 240, m + 280, 480], 180, 360, fill=TERRA)
    # охристый круг-солнце
    d.ellipse([m + 230, 170, m + 400, 340], fill=OCHRE)
    # шалфейный камень
    d.chord([m + 250, 520, m + 470, 740], 180, 360, fill=SAGE)
    d.rectangle([m + 250, 630, m + 470, H - m - 40], fill=SAGE)
    # тонкая линия горизонта
    d.line([m, H - m - 40, W - m, H - m - 40], fill=INK, width=3)
    return im.filter(ImageFilter.SMOOTH)


def sun():
    im = paper(2)
    d = ImageDraw.Draw(im)
    m = 80
    d.ellipse([150, 150, 450, 450], fill=BLUSH)
    d.ellipse([230, 230, 370, 370], fill=TERRA)
    for k in range(7):  # волны
        y = 540 + k * 28
        pts = [(m + i * 4, y + 9 * math.sin(i * 0.11 + k)) for i in range((W - 2 * m) // 4 + 1)]
        d.line(pts, fill=INK if k % 3 == 0 else SAGE, width=3)
    return im.filter(ImageFilter.SMOOTH)


arch().save(os.path.join(out, "art-print-arch.png"))
sun().save(os.path.join(out, "art-print-sun.png"))
print("prints ->", out)
