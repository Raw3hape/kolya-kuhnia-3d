# ledge-mosslanda-prints — кухня (модель зоны kitchen), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- HÄCKHAGTORN Ramka, 30x40 cm, sosna, арт. 006.141.17, 14.99 zł.
  https://www.ikea.com/pl/pl/p/haeckhagtorn-ramka-sosna-00614117/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/00614117-mini.glb`, скачана 2026-11-15.
- LOMVIKEN Ramka, 21x30 cm, czarny, арт. 903.143.03, 19.99 zł.
  https://www.ikea.com/pl/pl/p/lomviken-ramka-czarny-90314303/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/90314303-mini.glb`, скачана 2026-11-15.
- MOSSLANDA Półka na zdjęcia, 55 cm, imit. dębu, арт. 805.898.35, 19.99 zł.
  https://www.ikea.com/pl/pl/p/mosslanda-polka-na-zdjecia-imit-debu-80589835/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/80589835-mini.glb`, скачана 2026-11-15.
- RÖDALM Ramka, 21x30 cm, biały, арт. 105.488.86, 14.99 zł.
  https://www.ikea.com/pl/pl/p/roedalm-ramka-bialy-10548886/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/10548886-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Картина: Edward Lear (1812–1888), «More Nonsense, Pictures, Rhymes, Botany, etc. (1872), Stunnia Dinnerbellia», 1872. Public domain, Wikimedia Commons: https://commons.wikimedia.org/wiki/File:More_Nonsense,_Pictures,_Rhymes,_Botany,_etc._(1872),_Stunnia_Dinnerbellia.jpg — отпечаток на бумаге с паспарту и подписью «Stunnia Dinnerbellia.» (`make_art.py`).
- Картина: Edward Lear (1812–1888), «More Nonsense, Pictures, Rhymes, Botany, etc. (1872), Minspysia Deliciosa», 1872. Public domain, Wikimedia Commons: https://commons.wikimedia.org/wiki/File:More_Nonsense,_Pictures,_Rhymes,_Botany,_etc._(1872),_Minspysia_Deliciosa.jpg — отпечаток на бумаге с паспарту и подписью «Minspysia Deliciosa.» (`make_art.py`).
- Картина: Ellen Isham Schutt (1873–1955), USDA Pomological Watercolor Collection, «Pomological Watercolor POM00006821», 27 July 1911. Public domain, Wikimedia Commons: https://commons.wikimedia.org/wiki/File:Pomological_Watercolor_POM00006821.jpg — отпечаток на бумаге с паспарту (`make_art.py`).

Обработка: `tools/decor/kitchen/build.py` (рецепт `ledge-mosslanda-prints`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 58.2 × 43.0 × 12.0 см (Ш × В × Г), 1081 треугольников, 248 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
