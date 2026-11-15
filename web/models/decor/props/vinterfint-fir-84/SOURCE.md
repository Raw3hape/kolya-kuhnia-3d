# vinterfint-fir-84 — балкон (реквизит), источники 3D

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- VINTERFINT Sztuczna roślina doniczkowa (choinka), doniczka 15 cm, wysokość 84 cm, do wewnątrz/na zewnątrz, zielony, арт. 106.363.88, 59.99 zł.
  https://www.ikea.com/pl/pl/p/vinterfint-sztuczna-roslina-doniczkowa-do-wewnatrz-na-zewnatrz-choinka-zielony-10636388/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 39.1 × 94.0 × 38.7 см — реальный масштаб, 5284 треугольников, 71 КБ.
- Сборка: tools/decor/balcony/build.py (процедурная ёлочка в горшке 15 см; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
