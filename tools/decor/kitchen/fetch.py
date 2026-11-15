# Скачивает исходники кухонной обстановки по products.json во временную папку <tmp> (потом удалить):
#   <tmp>/raw/<артикул без точек>.glb  — AR-модели IKEA (rotera), <tmp>/ph/<id>/ — CC0 Poly Haven (glTF 1k),
#   <tmp>/art/<key>.jpg                — картины общественного достояния с Wikimedia Commons (ширина 1600).
# IKEA_CLIENT_ID=<id> python3 tools/decor/kitchen/fetch.py <tmp>
# IKEA_CLIENT_ID — заголовок X-Client-Id веб-клиента IKEA (см. шапку tools/decor/fetch_ikea.py), в репозиторий не кладётся.
import json, os, subprocess, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DECOR = os.path.dirname(HERE)
tmp = os.path.abspath(sys.argv[1])
P = json.load(open(os.path.join(HERE, "products.json")))
UA = {"User-Agent": "kolya-kuhnia-decor/1.0"}

os.makedirs(os.path.join(tmp, "raw"), exist_ok=True)
for it in P["ikea"]:
    out = os.path.join(tmp, "raw", it["article"].replace(".", "") + ".glb")
    if not os.path.exists(out):
        subprocess.run([sys.executable, os.path.join(DECOR, "fetch_ikea.py"), "get", it["article"], out], check=True)

subprocess.run([sys.executable, os.path.join(DECOR, "living", "fetch_polyhaven.py"), os.path.join(tmp, "ph"), "1k",
                *[x["id"] for x in P["polyhaven"] if not os.path.isdir(os.path.join(tmp, "ph", x["id"]))]], check=True)

os.makedirs(os.path.join(tmp, "art"), exist_ok=True)
for a in P["art"]:
    out = os.path.join(tmp, "art", a["key"] + ".jpg")
    if os.path.exists(out):
        continue
    q = urllib.parse.urlencode({"action": "query", "titles": "File:" + a["title"], "prop": "imageinfo",
                                "iiprop": "url", "iiurlwidth": 1600, "format": "json"})
    page = next(iter(json.load(urllib.request.urlopen(urllib.request.Request(
        "https://commons.wikimedia.org/w/api.php?" + q, headers=UA)))["query"]["pages"].values()))
    open(out, "wb").write(urllib.request.urlopen(urllib.request.Request(page["imageinfo"][0]["thumburl"], headers=UA)).read())
    print("art", a["key"], "->", out)
