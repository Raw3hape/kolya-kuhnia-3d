# plates-lean-silversida — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- DAGGASTER Talerz, 26 cm, w kropki/jasnobeżowy, арт. 506.078.12, 12.99 zł.
  https://www.ikea.com/pl/pl/p/daggaster-talerz-w-kropki-jasnobezowy-50607812/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/50607812-mini.glb`, скачана 2026-11-15.
- KRUSTISTEL Talerz, 25 cm, wzór/jasnobeżowy, арт. 805.843.24, 12.99 zł.
  https://www.ikea.com/pl/pl/p/krustistel-talerz-wzor-jasnobezowy-80584324/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/80584324-mini.glb`, скачана 2026-11-15.
- SILVERSIDA Talerz, 26 cm, wzór/niebieski, арт. 906.097.34, 14.99 zł.
  https://www.ikea.com/pl/pl/p/silversida-talerz-wzor-niebieski-90609734/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/90609734-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `plates-lean-silversida`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 33.4 × 25.6 × 14.1 см (Ш × В × Г), 6498 треугольников, 132 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
