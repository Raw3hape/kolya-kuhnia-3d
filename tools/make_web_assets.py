# Лёгкие веб-версии ассетов для быстрой первой загрузки (оригиналы не трогаются, кроме текстур внутри GLB, см. ниже).
#
#   uv run --with numpy --with pillow tools/make_web_assets.py            # всё, готовое пропускает
#   uv run --with numpy --with pillow tools/make_web_assets.py textures   # только текстуры (или hdri, glb)
#   ... --force                                                            # пересобрать заново
#
# 1. Текстуры материалов: web/textures/<dir>/<map>.jpg -> <dir>/512/<map>.jpg и <dir>/1k/<map>.jpg
#    (длинная сторона ≤ 512 / 1024, пропорции те же). Карта меньше уровня копируется как есть (git хранит одинаковое
#    один раз). Список папок с уровнями — web/textures/sizes.json, его читает materials.js: 512 — первый кадр,
#    1k — «Эконом» и «Быстрое», оригинал (2k) — «Высокое» и «Ультра». thumb.jpg, hdri/ и tv/ не трогаются.
#    Земля вокруг дома (site/) всегда грузится из site/512 (site.js): её видно только издали, из окон.
#    Новая текстура без прогона скрипта тоже работает: её папки нет в sizes.json — грузится оригинал.
# 2. Панорамы: web/textures/hdri/<name>.hdr шире 1024 -> hdri/1k/<name>.hdr (ImageMagick, усреднение, RGBE).
#    lighting.js: 1k для «Эконома» и «Быстрого», оригинал для «Высокого» и «Ультра».
# 3. GLB обстановки и диванов (web/models/decor, web/models/sofas): у мелочи (наибольший габарит < SMALL_M)
#    текстуры ужимаются до 512 и лишние треугольники (> TRI_SMALL) упрощаются (gltf-transform resize, simplify,
#    затем meshopt заново; WEBP остаётся). Перезаписывает файл на месте: исходник — конвейеры tools/decor/ и
#    tools/sofas/ (после них прогнать этот скрипт). Обработанные помнит tools/web_assets_glb.json (путь -> хеш).
import hashlib, io, json, shutil, struct, subprocess, sys, tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TEX = ROOT / 'web' / 'textures'
TIERS = {'512': 512, '1k': 1024}
QUALITY = {'color': 84, 'normal': 90, 'rough': 80}   # JPEG; нормали 4:4:4 (без потери разрешения цвета)
SKIP_DIRS = {'hdri', 'tv'} | set(TIERS)   # постер ТВ грузит tv.js сам, целиком
SMALL_M = 0.8   # до 0,8 м хватает 512 px (≈ 640 px на метр)
GLB_DIRS = [ROOT / 'web' / 'models' / 'decor', ROOT / 'web' / 'models' / 'sofas']
TRI_SMALL = 8000          # треугольников у мелочи: больше — упростить (meshopt simplify, без заметной ошибки)
SIMPLIFY_ERROR = 0.002    # предел ошибки упрощения: доля радиуса модели (0,2 %, у 30-см вазы ~0,3 мм)
DONE = ROOT / 'tools' / 'web_assets_glb.json'   # обработанные GLB: путь -> хеш; изменился файл (конвейер) — обработать снова
CLI = ['npx', '-y', '@gltf-transform/cli@4']


def texture_dirs():
    for d in sorted(p for p in TEX.rglob('*') if p.is_dir()):
        if SKIP_DIRS & set(d.relative_to(TEX).parts):
            continue
        maps = [f for f in sorted(d.glob('*.jpg')) if f.name != 'thumb.jpg']
        if maps:
            yield d, maps


def save_jpg(img, out, kind):
    q = QUALITY.get(kind, 84)
    out.parent.mkdir(exist_ok=True)
    img.save(out, 'JPEG', quality=q, optimize=True, progressive=True, subsampling=0 if kind == 'normal' else 2)


def textures(force):
    sizes = {}
    made = 0
    for d, maps in texture_dirs():
        rel = d.relative_to(TEX).as_posix()
        longest = max(max(Image.open(f).size) for f in maps)
        tiers = [t for t, px in TIERS.items() if longest > px]
        if not tiers:
            continue
        sizes[rel] = tiers
        for t in tiers:
            px = TIERS[t]
            for f in maps:
                out = d / t / f.name
                if not force and out.exists() and out.stat().st_mtime >= f.stat().st_mtime:
                    continue
                src = Image.open(f)
                if max(src.size) <= px:
                    out.parent.mkdir(exist_ok=True)
                    shutil.copyfile(f, out)
                else:
                    k = px / max(src.size)
                    img = src.convert('RGB').resize((max(1, round(src.width * k)), max(1, round(src.height * k))), Image.LANCZOS)
                    save_jpg(img, out, f.stem)
                made += 1
    # папки уровней, которых больше нет в sizes.json (оригинал уменьшили или удалили) — убрать
    for d in TEX.rglob('*'):
        if d.is_dir() and d.name in TIERS and 'hdri' not in d.relative_to(TEX).parts:
            rel = d.parent.relative_to(TEX).as_posix()
            if d.name not in sizes.get(rel, []):
                shutil.rmtree(d)
    (TEX / 'sizes.json').write_text(json.dumps(dict(sorted(sizes.items())), separators=(',', ':')) + '\n')
    print(f'textures: {len(sizes)} папок с уровнями, записано {made} карт')


def hdri(force):
    src_dir = TEX / 'hdri'
    out_dir = src_dir / '1k'
    out_dir.mkdir(exist_ok=True)
    for f in sorted(src_dir.glob('*.hdr')):
        out = out_dir / f.name
        w = int(subprocess.run(['magick', 'identify', '-format', '%w', str(f)], capture_output=True, text=True, check=True).stdout)
        if w <= 1024:
            shutil.copyfile(f, out)   # уже 1k: тот же файл (git хранит один раз), путь у всех панорам одинаковый
            continue
        if not force and out.exists() and out.stat().st_mtime >= f.stat().st_mtime:
            continue
        subprocess.run(['magick', str(f), '-filter', 'Box', '-resize', '1024x512!', str(out)], check=True)
        print(f'hdri: {f.name} {f.stat().st_size // 1024} КБ -> {out.stat().st_size // 1024} КБ')


# ---------- GLB: габарит сцены по JSON (accessor min/max + матрицы узлов) ----------

def glb_json(path):
    with open(path, 'rb') as fh:
        head = fh.read(20)
        _, _, _, clen, _ = struct.unpack('<4sII I4s', head)
        return json.loads(fh.read(clen))


def trs(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=float).reshape(4, 4).T
    t = np.array(n.get('translation', [0, 0, 0]), dtype=float)
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    s = np.array(n.get('scale', [1, 1, 1]), dtype=float)
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


NORM = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}


def glb_extent(g):
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    def walk(i, parent):
        n = g['nodes'][i]
        m = parent @ trs(n)
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                a = g['accessors'][p['attributes']['POSITION']]
                mn, mx = np.array(a['min'], float), np.array(a['max'], float)
                if a.get('normalized'):
                    mn, mx = mn / NORM[a['componentType']], mx / NORM[a['componentType']]
                for c in range(8):
                    v = np.array([mx[k] if c >> k & 1 else mn[k] for k in range(3)] + [1.0])
                    w = (m @ v)[:3]
                    lo[:] = np.minimum(lo, w); hi[:] = np.maximum(hi, w)
        for ch in n.get('children', []):
            walk(ch, m)
    scene = g['scenes'][g.get('scene', 0)]
    for i in scene['nodes']:
        walk(i, np.eye(4))
    return float(np.max(hi - lo)) if np.all(np.isfinite(lo)) else 0.0


def glb_max_texture(path, g):
    # размер картинки читается из буфера GLB (WEBP/JPEG/PNG) через Pillow
    with open(path, 'rb') as fh:
        data = fh.read()
    clen = struct.unpack('<I', data[12:16])[0]
    bin_start = 20 + clen + 8
    best = 0
    for im in g.get('images', []):
        if 'bufferView' not in im:
            continue
        bv = g['bufferViews'][im['bufferView']]
        off = bin_start + bv.get('byteOffset', 0)
        try:
            best = max(best, max(Image.open(io.BytesIO(data[off:off + bv['byteLength']])).size))
        except Exception:
            pass
    return best


def glb_triangles(g):
    count = {}
    def walk(i):
        n = g['nodes'][i]
        if 'mesh' in n:
            count[n['mesh']] = count.get(n['mesh'], 0) + 1
        for ch in n.get('children', []):
            walk(ch)
    for i in g['scenes'][g.get('scene', 0)]['nodes']:
        walk(i)
    tris = 0
    for m, k in count.items():
        for p in g['meshes'][m]['primitives']:
            if p.get('mode', 4) == 4:
                a = p.get('indices')
                tris += k * (g['accessors'][a]['count'] if a is not None else g['accessors'][p['attributes']['POSITION']]['count']) // 3
    return tris


def sha(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:16]


def glbs(force):
    done = {} if force or not DONE.exists() else json.loads(DONE.read_text())
    tmp = Path(tempfile.mkdtemp())
    saved = 0
    for base in GLB_DIRS:
        for f in sorted(base.rglob('*.glb')):
            rel = f.relative_to(ROOT).as_posix()
            if done.get(rel) == sha(f):
                continue
            g = glb_json(f)
            size = glb_extent(g)
            steps = []
            if size < SMALL_M:
                if g.get('images') and glb_max_texture(f, g) > 512:
                    steps.append(['resize', '--width', '512', '--height', '512'])
                tris = glb_triangles(g)
                if tris > TRI_SMALL:
                    steps.append(['simplify', '--ratio', f'{TRI_SMALL / tris:.3f}', '--error', str(SIMPLIFY_ERROR)])
            if steps:
                before = f.stat().st_size
                src = f
                # каждый шаг снимает сжатие геометрии: в конце meshopt заново (как в конвейерах tools/decor/*/pack.py)
                for k, st in enumerate(steps + [['meshopt']]):
                    out = tmp / f'{k}.glb'
                    subprocess.run(CLI + [st[0], str(src), str(out), *st[1:]], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    src = out
                if src.stat().st_size < before:
                    shutil.move(src, f)
                    saved += before - f.stat().st_size
                    print(f'glb: {rel} {size:.2f} м, {"+".join(s[0] for s in steps)}, {before // 1024} -> {f.stat().st_size // 1024} КБ')
            done[rel] = sha(f)
    shutil.rmtree(tmp, ignore_errors=True)
    DONE.write_text(json.dumps(dict(sorted(done.items())), indent=0) + '\n')
    print(f'glb: сэкономлено {saved / 1e6:.1f} МБ')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    for step, fn in (('textures', textures), ('hdri', hdri), ('glb', glbs)):
        if not args or step in args:
            fn(force)
