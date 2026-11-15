# KALLSÖ ławka ze schowkiem — источник 3D

- Товар: KALLSÖ ławka ze schowkiem, szary, IKEA, арт. 805.993.25, 499 zł (ikea.com/pl, сняты 2026-11-15).
  https://www.ikea.com/pl/pl/p/kallsoe-lawka-ze-schowkiem-szary-80599325/
- Размеры по каталогу (Ш × В × Г): 80 × 56 × 38 см.
- 3D: официальная AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/80599325-mini.glb`, скачана 2026-11-15.
- Лицензия: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца,
  модель отдельно не распространять и не публиковать.
- Обработка: `tools/decor/pipeline.py tools/decor/jobs/hall.json` — масштаб файла IKEA (реальный, не менялся),
  центр следа в 0, пол Y = 0, перед +Z, 30000 треугольников после прореживания,
  текстуры ≤ 1024, meshopt. `thumb.jpg` 256×256 рисует `tools/decor/thumb.py`.
