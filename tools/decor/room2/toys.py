# Игрушки и ноутбук со стримом Dota 2 на кровати спальни — весь конвейер одной командой:
#   python3 tools/decor/room2/toys.py <tmp>        # <tmp> потом удалить
# 1) blender make_toys.py -> <tmp>/raw/<id>.glb (свои CC0-модели)
# 2) meshopt -> web/models/decor/room2/<id>/model.glb, thumb.jpg (tools/decor/thumb.py), SOURCE.md
# 3) части в web/spec/decor/room2.json: в КОНЕЦ parts каждой кровати (README обстановки: сдвиги в ссылках держатся
#    на номерах частей, поэтому старые части не трогаем). Повторный запуск заменяет только хвост из этих же моделей.
# Раскладка — TOYS ниже: точка на кровати SAGESUND (по умолчанию) в координатах квартиры; у других кроватей сдвигается
# вместе с постелью (bedding-160): высота — над постелью (одеяло 0,322 м над её началом, плед в ногах 0,344).
# Экран ноутбука для tv.js (screens[] → bedroom) печатает make_toys.py (SCREEN_RECT), сверить при пересборке.
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
ZONE = os.path.join(ROOT, "web", "spec", "decor", "room2.json")
BEDDING = "models/decor/props/bedding-160/model.glb"
REF = (4.2, 5.6725)                  # постель SAGESUND: x, z
DUVET, PLAID = 0.322, 0.344           # верх одеяла и пледа над началом постели, м

# id: (x, z на SAGESUND, высота над постелью, поворот, что это)
TOYS = {
    "laptop-gaming": (4.02, 5.74, DUVET, -125, "игровой ноутбук 15″, открыт экраном к двери — на нём стрим Dota 2 (tv.js)"),
    "cat-cloudy":    (4.60, 5.84, DUVET, -120, "плюшевый «облачный» кот (клауди кот), смотрит на входящего"),
    "figs-wow":      (3.68, 5.42, DUVET, 170, "фигурки героев в духе World of Warcraft: орк, паладин, эльфийка"),
    "figs-dota":     (4.18, 5.36, DUVET, -130, "фигурки героев в духе Dota 2: мясник с крюком, самурай в маске, ледяная волшебница"),
    "camper-toy":    (4.62, 4.98, PLAID, -100, "игрушечный автодом"),
    "bicycle-toy":   (3.78, 4.92, PLAID, -150, "игрушечный велосипед на подножке"),
}
MODEL = lambda i: f"models/decor/room2/{i}/model.glb"

SOURCE = """# {id} — {what}

- Источник: своя модель, сделана для этого проекта скриптом Blender `tools/decor/room2/make_toys.py`
  (агент спальни, 2026-11-15). Чужих моделей, текстур и логотипов нет; фигурки — собирательные фэнтези-образы.
- Лицензия: CC0 (общественное достояние).
- Контракт: метры, пол Y = 0, центр следа в 0, перед +Z, цвета по вершинам (один материал{extra}), meshopt.
- Габарит (Ш × В × Г): {size}.
- Где стоит: на постели каждой кровати спальни (последние части опций слота «Кровать», `toys.py`).
"""


def main():
    tmp = os.path.abspath(sys.argv[1])
    raw = os.path.join(tmp, "raw")
    if not all(os.path.exists(os.path.join(raw, i + ".glb")) for i in TOYS):
        subprocess.run(["blender", "-b", "--python", os.path.join(HERE, "make_toys.py"), "--", tmp], check=True)
    thumbs = []
    for i, (_, _, _, _, what) in TOYS.items():
        d = os.path.join(ROOT, "web", "models", "decor", "room2", i)
        os.makedirs(d, exist_ok=True)
        out = os.path.join(d, "model.glb")
        subprocess.run(["npx", "-y", "@gltf-transform/cli@4", "meshopt", os.path.join(raw, i + ".glb"), out],
                       check=True, stdout=subprocess.DEVNULL)
        thumbs.append({"glb": out, "out": os.path.join(d, "thumb.jpg"), "size": 256})
        open(os.path.join(d, "SOURCE.md"), "w").write(SOURCE.format(
            id=i, what=what, extra=" + экран `screen`" if i.startswith("laptop") else "", size=dims(raw, i)))
        print(f"{i}: {os.path.getsize(out) // 1024} КБ", flush=True)
    jf = os.path.join(tmp, "thumbs.json")
    json.dump(thumbs, open(jf, "w"))
    subprocess.run(["blender", "-b", "--python", os.path.join(os.path.dirname(HERE), "thumb.py"), "--", jf],
                   check=True, stdout=subprocess.DEVNULL)
    compose()


def dims(raw, i):
    """габарит Ш × В × Г из min/max вершин сырого GLB"""
    import struct
    b = open(os.path.join(raw, i + ".glb"), "rb").read()
    n = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + n])
    lo, hi = [1e9] * 3, [-1e9] * 3
    for m in g["meshes"]:
        for p in m["primitives"]:
            a = g["accessors"][p["attributes"]["POSITION"]]
            lo = [min(x, y) for x, y in zip(lo, a["min"])]
            hi = [max(x, y) for x, y in zip(hi, a["max"])]
    w, h, d = (hi[k] - lo[k] for k in range(3))
    return f"{w * 100:.1f} × {h * 100:.1f} × {d * 100:.1f} см"


def compose():
    z = json.load(open(ZONE))
    ours = {MODEL(i) for i in TOYS}
    bed = next(s for s in z["slots"] if s["id"] == "bed")
    for o in bed["options"]:
        parts = o.get("parts") or []
        bedding = next((p for p in parts if p["model"] == BEDDING), None)
        if not bedding:
            continue
        while parts and parts[-1]["model"] in ours:      # только наш хвост
            parts.pop()
        bx, by, bz = bedding["pos"]
        for i, (x, zz, h, rot, _) in TOYS.items():
            parts.append({"model": MODEL(i), "pos": [round(x - REF[0] + bx, 4), round(by + h, 4), round(zz - REF[1] + bz, 4)],
                          "rot": rot, "mount": "surface"})
    json.dump(z, open(ZONE, "w"), ensure_ascii=False, indent=2)
    open(ZONE, "a").write("\n")
    print("room2.json: игрушки на", sum(1 for o in bed["options"] if o.get("parts")), "кроватях")


if __name__ == "__main__":
    if sys.argv[1:] == ["--compose"]:
        compose()
    else:
        main()
