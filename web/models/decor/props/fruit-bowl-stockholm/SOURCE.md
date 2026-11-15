# fruit-bowl-stockholm — кухня (реквизит), источники 3D

Товары IKEA (ikea.com/pl, имя, артикул и цена сняты 2026-11-15):

- STOCKHOLM 2025 Miska, 34 cm, beżowy, арт. 505.924.29, 79.99 zł.
  https://www.ikea.com/pl/pl/p/stockholm-2025-miska-bezowy-50592429/
  3D: AR-модель IKEA `https://web-api.ikea.com/pl/pl/rotera/static/models/50592429-mini.glb`, скачана 2026-11-15.

Лицензия моделей IKEA: © Inter IKEA Systems B.V., публичной лицензии нет. Только личная визуализация квартиры владельца; модель отдельно не распространять и не публиковать.

- apple ×3: Poly Haven `food_apple_01`, автор Oliver Harries, CC0, https://polyhaven.com/a/food_apple_01 (glTF 1k, скачана 2026-11-15).
- lemon ×2: Poly Haven `lemon`, автор Kuutti Siitonen, CC0, https://polyhaven.com/a/lemon (glTF 1k, скачана 2026-11-15).
- lime ×1: Poly Haven `food_lime_01`, автор Oliver Harries, CC0, https://polyhaven.com/a/food_lime_01 (glTF 1k, скачана 2026-11-15).
- pomegranate ×1: Poly Haven `food_pomegranate_01`, автор Oliver Harries, CC0, https://polyhaven.com/a/food_pomegranate_01 (glTF 1k, скачана 2026-11-15).

Обработка: `tools/decor/kitchen/build.py` (рецепт `fruit-bowl-stockholm`) — сырые модели без масштабирования (реальный размер IKEA), разложены и собраны в Blender, лишняя геометрия упрощена, текстуры ≤ 1024 WEBP; `tools/decor/kitchen/pack.py` — meshopt и `thumb.jpg` 256×256 (`tools/decor/thumb.py`).
Итог: 34.0 × 12.3 × 34.0 см (Ш × В × Г), 11498 треугольников, 418 КБ; метры, пол Y = 0, центр следа в 0, перед +Z.
