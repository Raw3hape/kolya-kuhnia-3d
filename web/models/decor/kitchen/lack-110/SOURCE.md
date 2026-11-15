# lack-110 — кухня (модель зоны kitchen), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- LACK Półka ścienna, 110x26 cm, biały, арт. 902.821.80, 69.99 zł.
  https://www.ikea.com/pl/pl/p/lack-polka-scienna-bialy-90282180/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/90282180-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `lack-110`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 110.3 × 5.2 × 26.3 см (Ш × В × Г), 28 треугольников, 48 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
