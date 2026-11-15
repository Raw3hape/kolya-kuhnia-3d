# Сжать готовые GLB в веб (текстуры -> WEBP, геометрия -> meshopt) и нарисовать thumb.jpg общим tools/decor/thumb.py.
# python3 pack.py <src_dir> <dst_dir> [id ...]
#   src_dir/<id>.glb или src_dir/<id>/model.glb  ->  dst_dir/<id>/model.glb + thumb.jpg
# Примеры: pack.py <tmp>/norm web/models/decor/living      (мебель IKEA после normalize.py)
#          pack.py <tmp>/props web/models/decor/props      (реквизит после make_props.py)
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = ["npx", "-y", "@gltf-transform/cli@4"]
src, dst, only = sys.argv[1], sys.argv[2], set(sys.argv[3:])
ids = sorted({n[:-4] if n.endswith(".glb") else n for n in os.listdir(src)
              if n.endswith(".glb") or os.path.exists(os.path.join(src, n, "model.glb"))})
thumbs = []
with tempfile.TemporaryDirectory() as tmp:
    for i in ids:
        if only and i not in only:
            continue
        f = os.path.join(src, i + ".glb")
        if not os.path.exists(f):
            f = os.path.join(src, i, "model.glb")
        os.makedirs(os.path.join(dst, i), exist_ok=True)
        mid, out = os.path.join(tmp, i + ".glb"), os.path.join(dst, i, "model.glb")
        subprocess.run(CLI + ["webp", f, mid, "--quality", "82"], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(CLI + ["meshopt", mid, out], check=True, stdout=subprocess.DEVNULL)
        thumbs.append({"glb": out, "out": os.path.join(dst, i, "thumb.jpg"), "size": 256})
        print(f"{i}: {os.path.getsize(out) // 1024} КБ", flush=True)
    if os.path.exists(os.path.join(src, "index.json")):
        shutil.copy(os.path.join(src, "index.json"), os.path.join(dst, "index.json"))
    jf = os.path.join(tmp, "thumbs.json")
    json.dump(thumbs, open(jf, "w"))
    subprocess.run(["blender", "-b", "--python", os.path.join(os.path.dirname(HERE), "thumb.py"), "--", jf],
                   check=True, stdout=subprocess.DEVNULL)
