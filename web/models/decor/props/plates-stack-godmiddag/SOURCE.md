# plates-stack-godmiddag — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- GODMIDDAG Talerz, 26 cm, biały, арт. 005.850.11, 9.99 zł — 4 шт. в модели.
  https://www.ikea.com/pl/pl/p/godmiddag-talerz-bialy-00585011/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/00585011-mini.glb`, скачана 2026-11-15.
- KRUSTISTEL Talerz, 25 cm, wzór/jasnobeżowy, арт. 805.843.24, 12.99 zł.
  https://www.ikea.com/pl/pl/p/krustistel-talerz-wzor-jasnobezowy-80584324/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/80584324-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `plates-stack-godmiddag`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 26.1 × 6.9 × 26.1 см (Ш × В × Г), 8000 треугольников, 86 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
