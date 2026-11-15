# nammaro-module — балкон (модель зоны balcony), источники 3D

Товары IKEA с 3D (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- NÄMMARÖ Sekcja siedz sofy modułowej, ogr, 63x63 cm, bejca jasnobrązowa, арт. 105.102.99, 220 zł.
  https://www.ikea.com/pl/pl/p/naemmaroe-sekcja-siedz-sofy-modulowej-ogr-bejca-jasnobrazowa-10510299/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/10510299-mini.glb`, скачана 2026-11-15.
- NÄMMARÖ Oparcie sofy modułowej, zewnętrzne, 60x56 cm, bejca jasnobrązowa, арт. 605.103.05, 90 zł.
  https://www.ikea.com/pl/pl/p/naemmaroe-oparcie-sofy-modulowej-zewnetrzne-bejca-jasnobrazowa-60510305/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/60510305-mini.glb`, скачана 2026-11-15.
- KUDDARNA Poducha siedziska, ogrodowa, 62x62 cm, jasny szarobeżowy, арт. 505.472.48, 75 zł.
  https://www.ikea.com/pl/pl/p/kuddarna-poducha-siedziska-ogrodowa-jasny-szarobezowy-50547248/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/50547248-mini.glb`, скачана 2026-11-15.
- KUDDARNA Poduszka oparcia, na zewnątrz, 62x44 cm, jasny szarobeżowy, арт. 305.472.54, 45 zł.
  https://www.ikea.com/pl/pl/p/kuddarna-poduszka-oparcia-na-zewnatrz-jasny-szarobezowy-30547254/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/30547254-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Габарит (Ш × В × Г): 63.5 × 79.1 × 75.2 см — реальный масштаб, 13107 треугольников, 262 КБ.
- Сборка: tools/decor/balcony/build.py (секция сиденья + спинка + подушки KUDDARNA собраны в один модуль дивана (2 модуля = диван 126 см); метры, низ 0, центр следа 0, перед +Z; остался только цвет, текстуры WEBP ≤ 512, ковры ≤ 1024), затем `gltf-transform meshopt` (pack.py).
- `thumb.jpg` 256×256 — `tools/decor/thumb.py`. Конвейер и порядок шагов — шапка tools/decor/balcony/build.py.
