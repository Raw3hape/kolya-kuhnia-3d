# boards-lean-oak-acacia — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- ARTISTISK Deska do krojenia, 59x25 cm, dąb, арт. 805.110.83, 199 zł.
  https://www.ikea.com/pl/pl/p/artistisk-deska-do-krojenia-dab-80511083/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/80511083-mini.glb`, скачана 2026-11-15.
- NORRSJÖN Deska do krojenia, 44x42 cm, dąb, арт. 403.397.11, 99.99 zł.
  https://www.ikea.com/pl/pl/p/norrsjoen-deska-do-krojenia-dab-40339711/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/40339711-mini.glb`, скачана 2026-11-15.
- SMÅÄTA Deska do krojenia, 28x22 cm, akacja, арт. 205.571.68, 29.99 zł.
  https://www.ikea.com/pl/pl/p/smaaeta-deska-do-krojenia-akacja-20557168/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/20557168-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

Обработка: `tools/decor/kitchen/build.py` (рецепт `boards-lean-oak-acacia`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 44.9 × 58.3 × 13.8 см (Ш × В × Г), 2097 треугольников, 117 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
