# vinterfint-fir-150 — балкон (модель зоны balcony), источники 3D

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- VINTERFINT Choinka sztuczna, 150 cm, średnica 51 cm, do wewnątrz/na zewnątrz, zielony, арт. 806.363.75, 99 zł.
  https://www.ikea.com/pl/pl/p/vinterfint-choinka-sztuczna-do-wewnatrz-na-zewnatrz-zielony-80636375/
- STRÅLA Łańcuch świetlny LED, mikro, na baterie, арт. 606.332.45, 34.99 zł.
  https://www.ikea.com/pl/pl/p/strala-lancuch-swietlny-led-na-baterie-mikro-60633245/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 56.3 × 150.0 × 56.7 см — реальный масштаб, 8392 треугольников, 108 КБ.
- Сборка: tools/decor/balcony/build.py (процедурная ёлка Ø 51 см, 56 тёплых огоньков (emissive); метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
