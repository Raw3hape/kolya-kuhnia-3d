# lantern-berggran-34 — балкон (реквизит), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- BERGGRAN Latarenka na świece kolumnowe, 34 cm, antracyt, do wewnątrz/na zewnątrz, арт. 905.594.04, 49.99 zł.
  https://www.ikea.com/pl/pl/p/berggran-latarenka-na-swiece-kolumnowe-do-wewnatrz-na-zewnatrz-antracyt-90559404/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/90559404-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- SMÅLOM Świeca kolumnowa LED, 19 cm, na baterie, biały, арт. 906.115.91, 17.99 zł.
  https://www.ikea.com/pl/pl/p/smalom-swieca-kolumnowa-led-na-baterie-bialy-90611591/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 13.5 × 46.8 × 12.6 см — реальный масштаб, 3139 треугольников, 161 КБ.
- Сборка: tools/decor/balcony/build.py (внутри — свеча SMÅLOM 19 см; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
