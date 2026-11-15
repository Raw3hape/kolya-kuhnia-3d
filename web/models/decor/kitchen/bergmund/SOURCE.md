# bergmund — кухня (модель зоны kitchen), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- BERGMUND Stołek barowy z oparciem, 62 cm, wysokość blatu imit. dębu/Gunnared średni szary, арт. 193.847.05, 399 zł.
  https://www.ikea.com/pl/pl/p/bergmund-stolek-barowy-z-oparciem-wysokosc-blatu-imit-debu-gunnared-sredni-szary-s19384705/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/19384705-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `bergmund`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 45.4 × 97.5 × 48.7 см (Ш × В × Г), 4232 треугольников, 139 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
