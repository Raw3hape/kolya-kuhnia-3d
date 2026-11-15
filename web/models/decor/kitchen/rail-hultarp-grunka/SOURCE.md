# rail-hultarp-grunka — кухня (модель зоны kitchen), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- GRUNKA Przybory kuchenne, 4 szt., stal nierdz, арт. 300.833.34, 49.99 zł.
  https://www.ikea.com/pl/pl/p/grunka-przybory-kuchenne-4-szt-stal-nierdz-30083334/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/30083334-mini.glb`, скачана 2026-11-15.
- HULTARP Hak, 7 cm, czarny, арт. 104.444.45, 14.99 zł за упаковку 5 шт. — 4 шт. в модели.
  https://www.ikea.com/pl/pl/p/hultarp-hak-czarny-10444445/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/10444445-mini.glb`, скачана 2026-11-15.
- HULTARP Szyna, 60 cm, czarny, арт. 004.487.69, 24.99 zł.
  https://www.ikea.com/pl/pl/p/hultarp-szyna-czarny-00448769/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/00448769-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `rail-hultarp-grunka`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 60.0 × 43.5 × 12.1 см (Ш × В × Г), 8521 треугольников, 101 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
