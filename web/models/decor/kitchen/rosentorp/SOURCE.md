# rosentorp — кухня (модель зоны kitchen), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- ROSENTORP Stołek barowy z oparciem, 63 cm, wysokość blatu/biały, арт. 506.181.94, 279 zł.
  https://www.ikea.com/pl/pl/p/rosentorp-stolek-barowy-z-oparciem-wysokosc-blatu-bialy-50618194/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/50618194-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `rosentorp`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 40.5 × 91.7 × 45.3 см (Ш × В × Г), 9000 треугольников, 189 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
