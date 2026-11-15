# tarno-chair — балкон (модель зоны balcony), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- TÄRNÖ Krzesło, ogrodowe, 39x40x79 cm, składany, czarny/bejca jasnobrązowa, арт. 900.954.28, 69.99 zł.
  https://www.ikea.com/pl/pl/p/taernoe-krzeslo-ogrodowe-skladany-czarny-bejca-jasnobrazowa-90095428/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/90095428-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 39.0 × 78.4 × 44.7 см — реальный масштаб, 6000 треугольников, 135 КБ.
- Сборка: tools/decor/balcony/build.py (метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
