# Готовые модели кухни (build.py -> <tmp>/out/{kitchen,props}/<id>.glb) -> web/models/decor/<dest>/<id>/model.glb
# (meshopt; текстуры уже WEBP ≤ 1024 из build.py) + thumb.jpg 256×256 (общий tools/decor/thumb.py).
#   python3 tools/decor/kitchen/pack.py <tmp> [id …]
# Чужой реквизит не трогает: папку props/<id> с чужим SOURCE.md (без пометки tools/decor/kitchen) не перезаписывает.
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
tmp, only = os.path.abspath(sys.argv[1]), set(sys.argv[2:])
MARK = "tools/decor/kitchen"          # так подписан SOURCE.md наших папок (см. sources.py)
thumbs = []
for dest in ("kitchen", "props"):
    src_dir = os.path.join(tmp, "out", dest)
    for f in sorted(os.listdir(src_dir)):
        aid = f[:-4]
        if only and aid not in only:
            continue
        out_dir = os.path.join(ROOT, "web", "models", "decor", dest, aid)
        src_md = os.path.join(out_dir, "SOURCE.md")
        if dest == "props" and os.path.exists(src_md) and MARK not in open(src_md).read():
            print("ПРОПУСК: props/%s уже есть и не наш" % aid)
            continue
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, "model.glb")
        subprocess.run(["npx", "-y", "@gltf-transform/cli@4", "meshopt", os.path.join(src_dir, f), out],
                       check=True, stdout=subprocess.DEVNULL)
        thumbs.append({"glb": out, "out": os.path.join(out_dir, "thumb.jpg"), "size": 256})
        print(f"{dest}/{aid}: {os.path.getsize(out) // 1024} КБ", flush=True)
jf = os.path.join(tmp, "thumbs.json")
json.dump(thumbs, open(jf, "w"))
subprocess.run(["blender", "-b", "--python", os.path.join(os.path.dirname(HERE), "thumb.py"), "--", jf],
               check=True, stdout=subprocess.DEVNULL)
