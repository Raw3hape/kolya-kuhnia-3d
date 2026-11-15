# frame-rodalm-walnut-lemon — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- RÖDALM Ramka, 30x40 cm, orzech, арт. 605.489.21, 29.99 zł.
  https://www.ikea.com/pl/pl/p/roedalm-ramka-orzech-60548921/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/60548921-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Картина: Ellen Isham Schutt (1873–1955), USDA Pomological Watercolor Collection, «Pomological Watercolor POM00006821», 27 July 1911. Public domain, Wikimedia Commons: https://commons.wikimedia.org/wiki/File:Pomological_Watercolor_POM00006821.jpg — отпечаток на бумаге с паспарту (`make_art.py`).

Обработка: `tools/decor/kitchen/build.py` (рецепт `frame-rodalm-walnut-lemon`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 31.8 × 41.8 × 3.2 см (Ш × В × Г), 466 треугольников, 84 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
