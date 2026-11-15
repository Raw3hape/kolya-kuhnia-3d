# getkal-railing — балкон (модель зоны balcony), источники 3D

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- GETKÅL Łańcuch świetlny LED, 15 m całości, 5.1 m do 1. lampy, co 10 cm, na zewnątrz, арт. 306.028.77, 49.99 zł.
  https://www.ikea.com/pl/pl/p/getkal-lancuch-swietlny-led-na-zewnatrz-30602877/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 818.1 × 7.4 × 7.4 см — реальный масштаб, 6192 треугольников, 56 КБ.
- Сборка: tools/decor/balcony/build.py (провод спиралью вокруг поручня, огоньки каждые 10 см (emissive); метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
