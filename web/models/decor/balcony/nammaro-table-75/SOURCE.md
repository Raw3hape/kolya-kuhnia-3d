# nammaro-table-75 — балкон (модель зоны balcony), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- NÄMMARÖ Stół, ogrodowy, 75x63 cm, bejca jasnobrązowa, арт. 005.103.08, 249 zł.
  https://www.ikea.com/pl/pl/p/naemmaroe-stol-ogrodowy-bejca-jasnobrazowa-00510308/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/00510308-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 75.0 × 75.2 × 63.0 см — реальный масштаб, 7000 треугольников, 133 КБ.
- Сборка: tools/decor/balcony/build.py (метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
