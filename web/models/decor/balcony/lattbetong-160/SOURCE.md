# lattbetong-160 — балкон (модель зоны balcony), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- LÄTTBETONG Dywan tkany na płasko wewn/zewn, 160x230 cm, beżowy/jasnobrązowy, арт. 105.957.12, 349 zł.
  https://www.ikea.com/pl/pl/p/laettbetong-dywan-tkany-na-plasko-wewn-zewn-bezowy-jasnobrazowy-10595712/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/10595712-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 160.0 × 0.4 × 230.1 см — реальный масштаб, 400 треугольников, 261 КБ.
- Сборка: tools/decor/balcony/build.py (сплющен до 5 мм; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
