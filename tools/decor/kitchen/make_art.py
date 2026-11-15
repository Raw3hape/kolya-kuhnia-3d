# Отпечатки для рамок кухни: картина общественного достояния (fetch.py -> <tmp>/art/<key>.jpg) на бумаге цвета
# слоновой кости, с паспарту и подписью курсивом, как страница старой книги. Пропорции — под стекло рамок IKEA:
# 21x30 и 30x40. Результат <tmp>/prints/<key>-<формат>.jpg, их берёт build.py.
# uv run --with pillow python tools/decor/kitchen/make_art.py <tmp>
import json, os, sys
from PIL import Image, ImageChops, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
tmp = os.path.abspath(sys.argv[1])
P = json.load(open(os.path.join(HERE, "products.json")))
os.makedirs(os.path.join(tmp, "prints"), exist_ok=True)

FORMATS = {"21x30": (210, 300), "30x40": (300, 400)}   # мм, внутренняя часть рамки под стеклом
PX_PER_MM = 3.2                                         # 30x40 -> 960×1280: чётко и вблизи в прогулке
PAPER, INK = (243, 238, 226), (60, 52, 44)
FONT = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"

for a in P["art"]:
    src = Image.open(os.path.join(tmp, "art", a["key"] + ".jpg")).convert("RGB")
    # тёмный фон сканера вокруг листа (акварели USDA) обрезать по светлой бумаге
    l, t, r, b = src.convert("L").point(lambda v: 255 if v > 90 else 0).getbbox()
    src = src.crop((l + 8, t + 8, r - 8, b - 8))
    for fmt, (wmm, hmm) in FORMATS.items():
        W, H = int(wmm * PX_PER_MM), int(hmm * PX_PER_MM)
        page = Image.new("RGB", (W, H), PAPER)
        m = int(min(W, H) * (0.13 if a["caption"] else 0.07))    # поле паспарту
        cap_h = int(H * 0.09) if a["caption"] else 0
        box_w, box_h = W - 2 * m, H - 2 * m - cap_h
        k = min(box_w / src.width, box_h / src.height)
        art = src.resize((max(1, int(src.width * k)), max(1, int(src.height * k))), Image.LANCZOS)
        x, y = (W - art.width) // 2, m + (box_h - art.height) // 2
        # белый фон скана ложится на бумагу как печать (умножение), цветная акварель — как есть
        region = page.crop((x, y, x + art.width, y + art.height))
        page.paste(ImageChops.multiply(region, art), (x, y))
        if a["caption"]:
            d = ImageDraw.Draw(page)
            f = ImageFont.truetype(FONT, int(H * 0.034))
            tw = d.textlength(a["caption"], font=f)
            d.text(((W - tw) / 2, H - m - cap_h * 0.75), a["caption"], font=f, fill=INK)
        out = os.path.join(tmp, "prints", f"{a['key']}-{fmt}.jpg")
        page.save(out, quality=88)
        print(out)
