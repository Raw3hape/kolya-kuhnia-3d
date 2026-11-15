# frame-lomviken-lear-dinnerbell — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- LOMVIKEN Ramka, 21x30 cm, czarny, арт. 903.143.03, 19.99 zł.
  https://www.ikea.com/pl/pl/p/lomviken-ramka-czarny-90314303/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/90314303-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Картина: Edward Lear (1812–1888), «More Nonsense, Pictures, Rhymes, Botany, etc. (1872), Stunnia Dinnerbellia», 1872. Public domain, Wikimedia Commons: https://commons.wikimedia.org/wiki/File:More_Nonsense,_Pictures,_Rhymes,_Botany,_etc._(1872),_Stunnia_Dinnerbellia.jpg — отпечаток на бумаге с паспарту и подписью «Stunnia Dinnerbellia.» (`make_art.py`).

Обработка: `tools/decor/kitchen/build.py` (рецепт `frame-lomviken-lear-dinnerbell`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 22.4 × 31.4 × 1.8 см (Ш × В × Г), 265 треугольников, 93 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
