# Миниатюры опций гостиной (вся сборка: мебель + книги + растения) -> web/models/decor/living/thumbs/<option>.jpg.
# python3 thumbs.py   (после compose.py; рисует tools/decor/living/preview.py в Blender, режим thumb)
import json, os, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "web")
spec = json.load(open(os.path.join(WEB, "spec", "decor", "living.json")))
out_dir = os.path.join(WEB, "models", "decor", "living", "thumbs")
os.makedirs(out_dir, exist_ok=True)
jobs = []
for o in next(s for s in spec["slots"] if s["id"] == "shelves")["options"]:
    if not o.get("parts"):
        continue
    xs = [p["pos"][0] for p in o["parts"]]
    zs = [p["pos"][2] for p in o["parts"]]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    # повернуть сборку на 180°: стена уходит назад, перед смотрит в +Z, как у одиночных моделей
    glbs = [{"glb": os.path.join(WEB, p["model"]), "pos": [-(p["pos"][0] - cx), p["pos"][1], -(p["pos"][2] - cz)],
             "rot": p["rot"] - 180} for p in o["parts"]]
    jobs.append({"glbs": glbs, "out": os.path.join(out_dir, o["id"] + ".jpg"), "mode": "thumb"})
with tempfile.TemporaryDirectory() as tmp:
    jf = os.path.join(tmp, "jobs.json")
    json.dump(jobs, open(jf, "w"))
    subprocess.run(["blender", "-b", "--python", os.path.join(HERE, "preview.py"), "--", jf], check=True, stdout=subprocess.DEVNULL)
print("\n".join(j["out"] for j in jobs))
