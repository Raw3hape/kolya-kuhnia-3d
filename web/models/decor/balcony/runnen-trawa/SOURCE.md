# runnen-trawa — балкон (модель зоны balcony), источники 3D

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- RUNNEN Płyta podłogowa, ogrodowa, 0.81 m² (9 szt. 30x30 cm, grubość 2 cm), sztuczna trawa, арт. 503.131.31, 179 zł.
  https://www.ikea.com/pl/pl/p/runnen-plyta-podlogowa-ogrodowa-sztuczna-trawa-50313131/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 814.9 × 2.0 × 185.1 см — реальный масштаб, 12 треугольников, 248 КБ.
- Сборка: tools/decor/balcony/build.py (то же, текстура искусственной травы; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
