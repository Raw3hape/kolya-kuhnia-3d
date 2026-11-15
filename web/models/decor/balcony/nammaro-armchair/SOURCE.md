# nammaro-armchair — балкон (модель зоны balcony), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- NÄMMARÖ Krzesło z podłokietnikami, ogr., 56x62x78 cm, bejca jasnobrązowa, арт. 905.111.05, 249 zł.
  https://www.ikea.com/pl/pl/p/naemmaroe-krzeslo-z-podlokietnikami-ogr-bejca-jasnobrazowa-90511105/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/90511105-mini.glb`, скачана 2026-11-15.
- KUDDARNA Poduszka na krzesło, ogrodowa, 44x44 cm, jasny szarobeżowy, арт. 305.472.30, 30 zł.
  https://www.ikea.com/pl/pl/p/kuddarna-poduszka-na-krzeslo-ogrodowa-jasny-szarobezowy-30547230/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/30547230-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 56.2 × 78.6 × 63.4 см — реальный масштаб, 8500 треугольников, 157 КБ.
- Сборка: tools/decor/balcony/build.py (кресло + подушка KUDDARNA 44 на сиденье; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
