# tarno-table — балкон (модель зоны balcony), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- TÄRNÖ Stół, ogrodowy, 55x54 cm, czarny/bejca jasnobrązowa, арт. 700.954.29, 99 zł.
  https://www.ikea.com/pl/pl/p/taernoe-stol-ogrodowy-czarny-bejca-jasnobrazowa-70095429/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/70095429-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 55.0 × 70.5 × 54.0 см — реальный масштаб, 5000 треугольников, 91 КБ.
- Сборка: tools/decor/balcony/build.py (метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
