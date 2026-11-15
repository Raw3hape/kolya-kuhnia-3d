# Конвейер обстановки целиком: скачать -> привести к контракту -> meshopt -> миниатюра.
#   IKEA_CLIENT_ID=<id> python3 tools/decor/pipeline.py tools/decor/jobs/<zone>.json <tmp> [id …]
# Результат: web/models/decor/<zone>/<id>/model.glb (meshopt) и thumb.jpg 256×256; <tmp> потом удалить.
# Запись job: {"id", "zone", "article" (IKEA, скачается через fetch_ikea.py) или "in" (свой сырой GLB),
#   "rot": [rx, ry, rz], "W"/"H"/"D", "maxTris"} — поля normalize.py. Перед первым запуском посмотреть модель:
#   blender -b --python tools/decor/inspect.py -- raw.glb (настенные вещи IKEA лежат «стеной вниз»: rot [90, 0, 0]).
# SOURCE.md в папке модели пишется руками (см. web/models/decor/README.md).
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
jobs_path, tmp, only = sys.argv[1], os.path.abspath(sys.argv[2]), set(sys.argv[3:])
jobs = [j for j in json.load(open(jobs_path)) if not only or j["id"] in only]
os.makedirs(tmp, exist_ok=True)

norm, thumbs = [], []
for j in jobs:
    raw = j.get("in") or os.path.join(tmp, f"{j['article']}.glb")
    if not os.path.exists(raw):
        subprocess.run([sys.executable, os.path.join(HERE, "fetch_ikea.py"), "get", j["article"], raw], check=True)
    out_dir = os.path.join(ROOT, "web", "models", "decor", j["zone"], j["id"])
    os.makedirs(out_dir, exist_ok=True)
    mid = os.path.join(tmp, f"{j['zone']}-{j['id']}.glb")
    norm.append({**j, "in": raw, "out": mid})
    thumbs.append({"glb": mid, "out": os.path.join(out_dir, "thumb.jpg"), "size": 256})
json.dump(norm, open(os.path.join(tmp, "jobs.json"), "w"), indent=1)
json.dump(thumbs, open(os.path.join(tmp, "thumbs.json"), "w"), indent=1)

subprocess.run(["blender", "-b", "--python", os.path.join(HERE, "normalize.py"), "--",
                os.path.join(tmp, "jobs.json"), os.path.join(tmp, "report.json")], check=True, stdout=subprocess.DEVNULL)
for j, t in zip(norm, thumbs):
    out = os.path.join(os.path.dirname(t["out"]), "model.glb")
    subprocess.run(["npx", "-y", "@gltf-transform/cli@4", "meshopt", j["out"], out], check=True, stdout=subprocess.DEVNULL)
subprocess.run(["blender", "-b", "--python", os.path.join(HERE, "thumb.py"), "--", os.path.join(tmp, "thumbs.json")],
               check=True, stdout=subprocess.DEVNULL)
for r in json.load(open(os.path.join(tmp, "report.json"))):
    j = next(x for x in norm if x["out"] == r["out"])
    out = os.path.join(ROOT, "web", "models", "decor", j["zone"], j["id"], "model.glb")
    print(f"{j['zone']}/{j['id']}: Ш×В×Г {r['WHD']} м, {r['tris']} треуг., {os.path.getsize(out) // 1024} КБ {' '.join(r['notes'])}")
