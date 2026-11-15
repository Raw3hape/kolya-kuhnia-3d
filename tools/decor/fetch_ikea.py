# Модели и данные товаров IKEA PL для обстановки (web/spec/decor/).
#   IKEA_CLIENT_ID=<id> python3 tools/decor/fetch_ikea.py info <артикул>…        — есть ли 3D, ссылка на GLB, размеры
#   IKEA_CLIENT_ID=<id> python3 tools/decor/fetch_ikea.py get <артикул> <out.glb> — скачать сырой GLB
#   python3 tools/decor/fetch_ikea.py search "<запрос>"                           — поиск ikea.com/pl: артикул, имя, размер, цена, ссылка
# Артикул можно писать как 405.302.29, 40530229 или s49575303 (комплект). IKEA_CLIENT_ID — заголовок X-Client-Id
# веб-клиента IKEA: он виден во вкладке Network на любой странице товара ikea.com/pl с 3D-просмотром (запрос
# web-api.ikea.com/…/rotera/data/model/). В репозиторий ключ не кладём. Дальше: normalize.py -> meshopt -> thumb.py.
import json, os, sys, urllib.parse, urllib.request

UA = {"User-Agent": "Mozilla/5.0"}


def art(a):
    return a.replace(".", "").lstrip("sS")


def get_json(url, headers):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **headers}), timeout=30))


def info(a):
    cid = os.environ.get("IKEA_CLIENT_ID")
    if not cid:
        sys.exit("нужен IKEA_CLIENT_ID (см. шапку)")
    return get_json(f"https://web-api.ikea.com/pl/pl/rotera/data/model/{art(a)}/",
                    {"X-Client-Id": cid, "Accept": "application/json;version=2"})


def search(q):
    u = "https://sik.search.blue.cdtapps.com/pl/pl/search-result-page?" + urllib.parse.urlencode({"q": q, "size": 24, "types": "PRODUCT"})
    for it in get_json(u, {}).get("searchResultPage", {}).get("products", {}).get("main", {}).get("items", []):
        p = it.get("product", {})
        print(p.get("id"), "|", p.get("name"), "|", p.get("typeName"), "|", p.get("itemMeasureReferenceText"), "|",
              p.get("salesPrice", {}).get("numeral"), "|", p.get("pipUrl"))


if __name__ == "__main__":
    cmd, rest = sys.argv[1], sys.argv[2:]
    if cmd == "search":
        search(" ".join(rest))
    elif cmd == "info":
        for a in rest:
            try:
                d = info(a)
                m = {x["measurementType"]: x["value"] for x in d.get("measurements", [])}
                wdh = "×".join(str(m.get(k, "?")) for k in ("width", "height", "depth"))
                print(art(a), d.get("productName"), f"Ш×В×Г {wdh} мм", d.get("modelUrl"))
            except Exception as e:
                print(art(a), "НЕТ 3D:", e)
    elif cmd == "get":
        d = info(rest[0])
        req = urllib.request.Request(d["modelUrl"], headers={**UA, "X-Client-Id": os.environ["IKEA_CLIENT_ID"]})
        open(rest[1], "wb").write(urllib.request.urlopen(req, timeout=60).read())
        print("OK", rest[1], os.path.getsize(rest[1]), "bytes", json.dumps(d.get("measurements")))
    else:
        sys.exit(__doc__)
