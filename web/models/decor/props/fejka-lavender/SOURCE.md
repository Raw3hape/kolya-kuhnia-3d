# fejka-lavender — балкон (реквизит), источники 3D

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- FEJKA Sztuczna roślina w doniczce, 35x42 cm, lawenda, арт. 005.863.55, 79.99 zł.
  https://www.ikea.com/pl/pl/p/fejka-sztuczna-roslina-w-doniczce-do-wewnatrz-na-zewnatrz-lawenda-00586355/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 35.2 × 40.1 × 16.6 см — реальный масштаб, 9216 треугольников, 131 КБ.
- Сборка: tools/decor/balcony/build.py (процедурная лаванда в белом прямоугольном горшке; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
