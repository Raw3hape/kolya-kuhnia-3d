"""Скачивает CC0-текстуры из tools/textures.json в web/textures/.

Запуск из корня проекта:
    uv run --with pillow tools/fetch_textures.py

Для каждой текстуры остаются только три карты: color.jpg, normal.jpg (OpenGL), rough.jpg.
Архивы и лишние карты удаляются сразу, повторный запуск пропускает готовое.
"""
import io
import json
import pathlib
import shutil
import urllib.request
import zipfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "textures"
UA = {"User-Agent": "kitchen-configurator/1.0"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def save_jpg(data, path, quality=86):
    im = Image.open(io.BytesIO(data))
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    im.save(path, "JPEG", quality=quality, optimize=True)


def polyhaven(tex):
    tid, res = tex["id"], tex["res"]
    dst = OUT / tid
    if (dst / "rough.jpg").exists():
        return "skip"
    files = json.loads(get(f"https://api.polyhaven.com/files/{tid}"))
    want = {"color": "Diffuse", "normal": "nor_gl", "rough": "Rough"}
    dst.mkdir(parents=True, exist_ok=True)
    for name, key in want.items():
        node = files[key][res]
        fmt = "jpg" if "jpg" in node else "png"
        save_jpg(get(node[fmt]["url"]), dst / f"{name}.jpg", 92 if name == "normal" else 86)
    return "ok"


def ambientcg(tex):
    tid, res = tex["id"], tex["res"]
    dst = OUT / tid
    if (dst / "rough.jpg").exists():
        return "skip"
    z = zipfile.ZipFile(io.BytesIO(get(f"https://ambientcg.com/get?file={tid}_{res}-JPG.zip")))
    pick = {"color": "_Color.jpg", "normal": "_NormalGL.jpg", "rough": "_Roughness.jpg"}
    dst.mkdir(parents=True, exist_ok=True)
    for name, suffix in pick.items():
        member = next(n for n in z.namelist() if n.endswith(suffix))
        save_jpg(z.read(member), dst / f"{name}.jpg", 92 if name == "normal" else 86)
    return "ok"


def hdri(tex):
    # <as>.hdr + <as>.source («id res»): при смене панорамы в textures.json файл перекачивается,
    # а старый <as>.json (солнце) удаляется — его пересчитывает tools/hdri_sun.py
    dst = OUT / "hdri" / f"{tex['as']}.hdr"
    src = dst.with_suffix(".source")
    want = f"{tex['id']} {tex['res']}"
    if dst.exists() and src.exists() and src.read_text().strip() == want:
        return "skip"
    files = json.loads(get(f"https://api.polyhaven.com/files/{tex['id']}"))
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(get(files["hdri"][tex["res"]]["hdr"]["url"]))
    src.write_text(want + "\n")
    dst.with_suffix(".json").unlink(missing_ok=True)
    return "ok"


def main():
    cfg = json.loads((ROOT / "tools" / "textures.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    for t in cfg["polyhaven"]:
        print("polyhaven", t["id"], polyhaven(t), flush=True)
    for t in cfg["ambientcg"]:
        print("ambientcg", t["id"], ambientcg(t), flush=True)
    for t in cfg["hdri"]:
        print("hdri", t["id"], hdri(t), flush=True)
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"total {total/1e6:.1f} MB")


if __name__ == "__main__":
    main()
