# svartra-festoon — балкон (модель зоны balcony), источники 3D

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- SVARTRÅ Łańcuch świetlny LED, 12 lampek, 9 m całości, 4.6 m do 1. lampy, na zewnątrz, czarny, арт. 006.105.86, 99.99 zł.
  https://www.ikea.com/pl/pl/p/svartra-lancuch-swietlny-led-12-lampek-na-zewnatrz-czarny-00610586/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 441.0 × 24.5 × 6.0 см — реальный масштаб, 2728 треугольников, 29 КБ.
- Сборка: tools/decor/balcony/build.py (12 ламп-шаров на провисающем проводе, лампы светятся (emissive), без источника света; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
