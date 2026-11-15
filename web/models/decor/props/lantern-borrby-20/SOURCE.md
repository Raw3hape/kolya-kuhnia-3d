# lantern-borrby-20 — балкон (реквизит), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- BORRBY Latarenka, 20 cm, czarny, do wewnątrz/na zewnątrz, арт. 606.088.54, 14.99 zł.
  https://www.ikea.com/pl/pl/p/borrby-latarenka-do-wewnatrz-na-zewnatrz-czarny-60608854/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/60608854-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- SMÅLOM Świeca kolumnowa LED, 9 cm, na baterie, biały, арт. 506.115.93, 12.99 zł.
  https://www.ikea.com/pl/pl/p/smalom-swieca-kolumnowa-led-na-baterie-bialy-50611593/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 11.1 × 19.9 × 11.3 см — реальный масштаб, 3140 треугольников, 52 КБ.
- Сборка: tools/decor/balcony/build.py (внутри — свеча SMÅLOM 9 см; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
