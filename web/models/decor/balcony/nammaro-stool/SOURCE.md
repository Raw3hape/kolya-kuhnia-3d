# nammaro-stool — балкон (модель зоны balcony), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- NÄMMARÖ Stołek, ogrodowy, 37x45 cm, składany, bejca jasnobrązowa, арт. 705.103.00, 79.99 zł.
  https://www.ikea.com/pl/pl/p/naemmaroe-stolek-ogrodowy-skladany-bejca-jasnobrazowa-70510300/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/70510300-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 36.5 × 45.0 × 36.5 см — реальный масштаб, 4999 треугольников, 83 КБ.
- Сборка: tools/decor/balcony/build.py (метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
