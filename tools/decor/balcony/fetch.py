# Скачивает AR-модели IKEA (rotera) для балкона по products.json → <tmp>/raw/<артикул без точек>.glb (готовое пропускает).
#   IKEA_CLIENT_ID=<id> python3 tools/decor/balcony/fetch.py <tmp>
# IKEA_CLIENT_ID — заголовок X-Client-Id веб-клиента IKEA (см. шапку tools/decor/fetch_ikea.py), в репозиторий не кладётся.
# Дальше: make_tex.py → build.py → pack.py → compose.py → sources.py (порядок — в шапке build.py). <tmp> потом удалить.
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
tmp = os.path.abspath(sys.argv[1])
os.makedirs(os.path.join(tmp, "raw"), exist_ok=True)
for it in json.load(open(os.path.join(HERE, "products.json")))["ikea"]:
    out = os.path.join(tmp, "raw", it["article"].replace(".", "") + ".glb")
    if not os.path.exists(out):
        subprocess.run([sys.executable, os.path.join(os.path.dirname(HERE), "fetch_ikea.py"), "get", it["article"], out], check=True)
