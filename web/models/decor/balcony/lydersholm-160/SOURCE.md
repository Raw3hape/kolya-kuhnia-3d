# lydersholm-160 — балкон (модель зоны balcony), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- LYDERSHOLM Dywan tkany na płasko wewn/zewn, 160x230 cm, średniobrązowy, арт. 204.954.15, 299 zł.
  https://www.ikea.com/pl/pl/p/lydersholm-dywan-tkany-na-plasko-wewn-zewn-sredniobrazowy-20495415/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/20495415-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 160.2 × 0.5 × 230.2 см — реальный масштаб, 186 треугольников, 229 КБ.
- Сборка: tools/decor/balcony/build.py (сплющен до 5 мм; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
