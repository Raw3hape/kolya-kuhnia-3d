# cushion-tofto-50 — балкон (реквизит), источники 3D

Товары IKEA без 3D — смоделированы по размерам с карточки (ikea.com/pl, сняты 2026-11-15):

- TOFTÖ Poszewka, 50x50 cm, ciemny szarozielony, na zewnątrz, арт. 005.813.10, 49.99 zł.
  https://www.ikea.com/pl/pl/p/toftoe-poszewka-ciemny-szarozielony-na-zewnatrz-do-uzytku-w-pomieszczeniach-00581310/
- INNER Poduszka wewnętrzna, 50x50 cm, biały, do wewnątrz/na zewnątrz, арт. 505.507.02, 15 zł.
  https://www.ikea.com/pl/pl/p/inner-poduszka-wewnetrzna-bialy-do-wewnatrz-na-zewnatrz-50550702/

Геометрия и текстуры — свои (Blender, процедурно), можно использовать свободно.

- Габарит (Ш × В × Г): 48.0 × 44.4 × 19.7 см — реальный масштаб, 672 треугольников, 12 КБ.
- Сборка: tools/decor/balcony/build.py (подушка 50 × 50 в наволочке TOFTÖ (текстура make_tex.py); метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
