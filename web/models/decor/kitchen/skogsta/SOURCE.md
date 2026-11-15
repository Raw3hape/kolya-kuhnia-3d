# skogsta — кухня (модель зоны kitchen), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- SKOGSTA Stołek barowy z oparciem, 62 cm, wysokość blatu czarny, арт. 006.210.09, 299 zł.
  https://www.ikea.com/pl/pl/p/skogsta-stolek-barowy-z-oparciem-wysokosc-blatu-czarny-00621009/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/00621009-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `skogsta`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 41.0 × 91.5 × 45.8 см (Ш × В × Г), 9000 треугольников, 162 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
