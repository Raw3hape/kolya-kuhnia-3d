# nammaro-bench — балкон (модель зоны balcony), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- NÄMMARÖ Ławka z oparciem, na zewnątrz, 106x62x78 cm, bejca jasnobrązowa, арт. 305.103.02, 449 zł.
  https://www.ikea.com/pl/pl/p/naemmaroe-lawka-z-oparciem-na-zewnatrz-bejca-jasnobrazowa-30510302/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/30510302-mini.glb`, скачана 2026-11-15.
- KUDDARNA Poduszka na krzesło, ogrodowa, 44x44 cm, jasny szarobeżowy, арт. 305.472.30, 30 zł.
  https://www.ikea.com/pl/pl/p/kuddarna-poduszka-na-krzeslo-ogrodowa-jasny-szarobezowy-30547230/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/30547230-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 106.0 × 78.5 × 63.3 см — реальный масштаб, 10999 треугольников, 166 КБ.
- Сборка: tools/decor/balcony/build.py (скамья + 2 подушки KUDDARNA 44 на сиденье; метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
