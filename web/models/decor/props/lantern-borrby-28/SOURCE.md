# lantern-borrby-28 — балкон (реквизит), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- BORRBY Lampion, 28 cm, czarny, do wewnątrz/na zewnątrz, арт. 101.561.09, 19.99 zł.
  https://www.ikea.com/pl/pl/p/borrby-lampion-do-wewnatrz-na-zewnatrz-czarny-10156109/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/10156109-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- SMÅLOM Świeca kolumnowa LED, 14 cm, na baterie, biały, арт. 906.197.85, 14.99 zł.
  https://www.ikea.com/pl/pl/p/smalom-swieca-kolumnowa-led-na-baterie-bialy-90619785/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 15.2 × 27.7 × 15.2 см — реальный масштаб, 3139 треугольников, 62 КБ.
- Сборка: tools/decor/balcony/build.py (внутри — свеча SMÅLOM 14 см (цилиндр, светящийся огонёк); метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
