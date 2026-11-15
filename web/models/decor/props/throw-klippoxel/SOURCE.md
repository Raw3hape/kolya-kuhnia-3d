# throw-klippoxel — балкон (реквизит), источники 3D

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- KLIPPOXEL Pled, 130x170 cm, ciemnozielony, арт. 106.366.99, 79.99 zł.
  https://www.ikea.com/pl/pl/p/klippoxel-pled-ciemnozielony-10636699/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 42.0 × 6.0 × 30.0 см — реальный масштаб, 324 треугольников, 12 КБ.
- Сборка: tools/decor/balcony/build.py (сложенный плед 42 × 30 см (текстура make_tex.py); метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
