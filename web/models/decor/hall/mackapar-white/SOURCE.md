# MACKAPÄR wieszak na czapki i kurtki — источник 3D

- Товар: MACKAPÄR wieszak na czapki i kurtki, biały, IKEA, арт. 105.309.90, 129 zł (ikea.com/pl, сняты 2026-11-15).
  https://www.ikea.com/pl/pl/p/mackapaer-wieszak-na-czapki-i-kurtki-bialy-10530990/
- Размеры по каталогу (Ш × В × Г): 78 × 37 × 32 см.
- 3D: официальная AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/10530990-mini.glb`, скачана 2026-11-15.
- Лицензия: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца,
  модель отдельно не распространять и не публиковать.
- Обработка: `tools/decor/pipeline.py tools/decor/jobs/hall.json` — масштаб файла IKEA (реальный, не менялся),
  центр следа в 0, пол Y = 0, перед +Z, поворот [90, 0, 0]° (настенная модель лежала «стеной вниз»),
  текстуры ≤ 1024, meshopt. `thumb.jpg` 256×256 рисует `tools/decor/thumb.py`.
