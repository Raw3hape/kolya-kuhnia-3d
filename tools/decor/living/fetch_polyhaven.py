# Скачивает CC0-модели Poly Haven (glTF, разрешение текстур res) в <out>/<id>/ и печатает размеры из API.
# python3 fetch_polyhaven.py <out> <res> id [id ...]      пример: ... <scratch>/ph 1k potted_plant_02
import json, os, sys, urllib.request

out, res, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
UA = {"User-Agent": "kolya-kuhnia-decor/1.0"}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read()


for i in ids:
    files = json.loads(get(f"https://api.polyhaven.com/files/{i}"))
    info = json.loads(get(f"https://api.polyhaven.com/info/{i}"))
    g = files["gltf"][res]["gltf"]
    d = os.path.join(out, i)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, os.path.basename(g["url"])), "wb").write(get(g["url"]))
    for rel, f in g.get("include", {}).items():
        p = os.path.join(d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "wb").write(get(f["url"]))
    print(i, "dims(mm)", info.get("dimensions"), "authors", list(info.get("authors", {}).keys()), "->", d, flush=True)
