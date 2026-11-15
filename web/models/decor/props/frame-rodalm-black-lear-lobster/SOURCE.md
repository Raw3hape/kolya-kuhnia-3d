# frame-rodalm-black-lear-lobster — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- RÖDALM Ramka, 30x40 cm, czarny, арт. 205.489.18, 29.99 zł.
  https://www.ikea.com/pl/pl/p/roedalm-ramka-czarny-20548918/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/20548918-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Картина: Edward Lear (1812–1888), «More Nonsense, Pictures, Rhymes, Botany, etc. (1872), The Lively Learned Lobster», 1872. Public domain, Wikimedia Commons: https://commons.wikimedia.org/wiki/File:More_Nonsense,_Pictures,_Rhymes,_Botany,_etc._(1872),_The_Lively_Learned_Lobster.jpg — отпечаток на бумаге с паспарту и подписью «The Lively Learned Lobster.» (`make_art.py`).

Обработка: `tools/decor/kitchen/build.py` (рецепт `frame-rodalm-black-lear-lobster`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 31.8 × 41.8 × 3.2 см (Ш × В × Г), 461 треугольников, 84 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
