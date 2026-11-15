# kettle-vattentat — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- VATTENTÄT Czajnik, 2 l, stal nierdz/czarny, арт. 202.395.95, 79.99 zł.
  https://www.ikea.com/pl/pl/p/vattentaet-czajnik-stal-nierdz-czarny-20239595/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/20239595-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `kettle-vattentat`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 23.1 × 23.4 × 19.1 см (Ш × В × Г), 4999 треугольников, 83 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
