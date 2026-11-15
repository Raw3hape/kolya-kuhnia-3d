# vinterfint-pine-bunch — балкон (реквизит), источники 3D

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- VINTERFINT Sztuczna gałązka, 70 cm, sosna, zielony, арт. 406.365.27, 12.99 zł.
  https://www.ikea.com/pl/pl/p/vinterfint-sztuczna-galazka-do-wewnatrz-na-zewnatrz-sosna-zielony-40636527/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 54.0 × 76.5 × 33.9 см — реальный масштаб, 9876 треугольников, 128 КБ.
- Сборка: tools/decor/balcony/build.py (пучок сосновых веток; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
