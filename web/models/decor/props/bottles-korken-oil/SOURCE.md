# bottles-korken-oil — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- KORKEN Słoik w kształcie butelki z pokr, 0.4 l, szkło bezbarwne, арт. 905.413.67, 7.99 zł.
  https://www.ikea.com/pl/pl/p/korken-sloik-w-ksztalcie-butelki-z-pokr-szklo-bezbarwne-90541367/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/90541367-mini.glb`, скачана 2026-11-15.
- KORKEN Słoik w kształcie butelki z pokr, 1 l, szkło bezbarwne, арт. 105.413.66, 9.99 zł.
  https://www.ikea.com/pl/pl/p/korken-sloik-w-ksztalcie-butelki-z-pokr-szklo-bezbarwne-10541366/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/10541366-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Наполнение (крупы, кофе, масло, уксус) — процедурные материалы build.py, CC0, не товар.

Обработка: `tools/decor/kitchen/build.py` (рецепт `bottles-korken-oil`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 19.3 × 24.1 × 10.9 см (Ш × В × Г), 8216 треугольников, 161 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
