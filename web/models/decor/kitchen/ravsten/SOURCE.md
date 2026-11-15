# ravsten — кухня (модель зоны kitchen), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- RÄVSTEN Stołek barowy, 62 cm, wysokość blatu drewno kauczukowe, арт. 305.970.55, 179 zł.
  https://www.ikea.com/pl/pl/p/raevsten-stolek-barowy-wysokosc-blatu-drewno-kauczukowe-30597055/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/30597055-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `ravsten`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 33.0 × 62.0 × 33.0 см (Ш × В × Г), 5876 треугольников, 42 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
