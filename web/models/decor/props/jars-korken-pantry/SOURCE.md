# jars-korken-pantry — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- KORKEN Słoik z pokrywką, 0.5 l, szkło bezbarwne, арт. 702.135.45, 9.99 zł — 2 шт. в модели.
  https://www.ikea.com/pl/pl/p/korken-sloik-z-pokrywka-szklo-bezbarwne-70213545/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/70213545-mini.glb`, скачана 2026-11-15.
- KORKEN Słoik z pokrywką, 1 l, szkło bezbarwne, арт. 502.135.46, 12.99 zł.
  https://www.ikea.com/pl/pl/p/korken-sloik-z-pokrywka-szklo-bezbarwne-50213546/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/50213546-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Наполнение (крупы, кофе, масло, уксус) — процедурные материалы build.py, CC0, не товар.

Обработка: `tools/decor/kitchen/build.py` (рецепт `jars-korken-pantry`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 39.2 × 16.7 × 14.2 см (Ш × В × Г), 12322 треугольников, 234 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
