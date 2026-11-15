# nypon-32 — балкон (модель зоны balcony), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- NYPON Osłonka doniczki, 32 cm, szary, do wewnątrz/na zewnątrz, арт. 303.956.32, 49.99 zł.
  https://www.ikea.com/pl/pl/p/nypon-oslonka-doniczki-do-wewnatrz-na-zewnatrz-szary-30395632/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/30395632-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 33.9 × 31.5 × 33.9 см — реальный масштаб, 3000 треугольников, 35 КБ.
- Сборка: tools/decor/balcony/build.py (метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
