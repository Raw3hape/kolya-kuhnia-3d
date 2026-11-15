# bowls-stack-godmiddag — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- FÄRGKLAR Miska, 16 cm, Matowy zielony, арт. 304.781.37, 29.99 zł.
  https://www.ikea.com/pl/pl/p/faergklar-miska-matowy-zielony-30478137/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/30478137-mini.glb`, скачана 2026-11-15.
- GODMIDDAG Miska, 16 cm, biały, арт. 005.850.30, 7.99 zł — 2 шт. в модели.
  https://www.ikea.com/pl/pl/p/godmiddag-miska-bialy-00585030/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/00585030-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `bowls-stack-godmiddag`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 16.4 × 10.4 × 16.4 см (Ш × В × Г), 5000 треугольников, 38 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
