# sheepskin-toftlund-drape — балкон (реквизит), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- TOFTLUND Dywan (imitacja skóry owczej), 55x85 cm, biały, арт. 204.202.41, 39.99 zł.
  https://www.ikea.com/pl/pl/p/toftlund-dywan-bialy-20420241/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/20420241-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 55.0 × 40.6 × 54.1 см — реальный масштаб, 3226 треугольников, 31 КБ.
- Сборка: tools/decor/balcony/build.py (AR-модель изогнута: лежит на сиденье и свисает за переднюю кромку; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
