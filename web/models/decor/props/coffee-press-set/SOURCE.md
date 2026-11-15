# coffee-press-set — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- DAGGASTER Kubek, 40 cl, w kropki/jasnobeżowy, арт. 106.078.09, 12.99 zł.
  https://www.ikea.com/pl/pl/p/daggaster-kubek-w-kropki-jasnobezowy-10607809/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/10607809-mini.glb`, скачана 2026-11-15.
- KORKEN Słoik z pokrywką, 0.5 l, szkło bezbarwne, арт. 702.135.45, 9.99 zł.
  https://www.ikea.com/pl/pl/p/korken-sloik-z-pokrywka-szklo-bezbarwne-70213545/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/70213545-mini.glb`, скачана 2026-11-15.
- IKEA 365+ Zaparzacz do kawy/herbaty, 1 l, szkło bezbarwne/stal nierdz, арт. 205.327.24, 49.99 zł.
  https://www.ikea.com/pl/pl/p/ikea-365-zaparzacz-do-kawy-herbaty-szklo-bezbarwne-stal-nierdz-20532724/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/20532724-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- Наполнение (крупы, кофе, масло, уксус) — процедурные материалы build.py, CC0, не товар.

Обработка: `tools/decor/kitchen/build.py` (рецепт `coffee-press-set`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 30.6 × 21.0 × 23.9 см (Ш × В × Г), 12606 треугольников, 368 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
