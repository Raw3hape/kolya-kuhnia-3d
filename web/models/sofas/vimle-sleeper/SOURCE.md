# VIMLE, 2-местный раскладной — источник 3D

- Товар: https://www.ikea.com/pl/pl/p/vimle-sofa-2-osobowa-rozkladana-gunnared-bezowy-s89545229/ (ikea.com/pl, данные сняты 2026-11-15)
- Размеры IKEA: 190 × 98 × 83 см, сиденье 48 см. Модель отмасштабирована по осям точно под эти цифры.
- 3D: официальные AR-модели IKEA, `https://web-api.ikea.com/pl/pl/rotera/data/model/<артикул>/` → `.../rotera/static/models/<артикул>-mini.glb`. У IKEA отдельная модель на каждое покрытие.
- Лицензия: © Inter IKEA Systems B.V. Публичной лицензии нет. Только личная визуализация квартиры владельца, не распространять и не публиковать модели отдельно.
- Обработка (Blender 5.2 + gltf-transform meshopt): Draco снят, ось и центр по контракту (метры, пол = 0, центр следа, ширина X, перед +Z), обивка → материал `fabric`, ножки (отдельные детали у пола) → `legs` с той же текстурой, текстуры ≤ 1024, геометрия > 45k треугольников прорежена. `fabric_fringe`, если есть, — полупрозрачная бахрома ткани из файла IKEA.

| Покрытие | Артикул | Файл | Масштаб x/y/z | Треуг. |
|---|---|---|---|---|
| Gunnared beżowy | 895.452.29 | model.glb | 1.001/0.996/0.973 | 8220 |
| Knäbäck jasnobeżowy | 096.319.85 | нет модели IKEA, тонировка `fabric` цветом #d7cdba | — | — |
| Gunnared średnioszary | 095.452.71 | cover-gunnared-srednioszary.glb | 0.998/0.998/0.999 | 8821 |
| Hillared granatowy | 695.369.71 | cover-hillared-granatowy.glb | 0.998/0.998/0.999 | 8834 |
| Johanneshov brązowobeżowy | 196.319.75 | нет модели IKEA, тонировка `fabric` цветом #8e7f6a | — | — |
| Knäbäck szarozielony | 596.319.83 | нет модели IKEA, тонировка `fabric` цветом #526050 | — | — |
| Kelinge beżowy | 696.319.87 | нет модели IKEA, тонировка `fabric` цветом #b7a794 | — | — |
| Kelinge szaroturkusowy | 796.319.77 | нет модели IKEA, тонировка `fabric` цветом #476262 | — | — |
| Kelinge granatowy | 396.319.79 | нет модели IKEA, тонировка `fabric` цветом #172938 | — | — |
| Djuparp ciemnoszary | 995.372.57 | cover-djuparp-ciemnoszary.glb | 0.998/0.997/0.999 | 9154 |
| Knäbäck antracyt | 196.319.80 | нет модели IKEA, тонировка `fabric` цветом #2c3236 | — | — |
| Johanneshov ciemnoszary | 596.319.78 | нет модели IKEA, тонировка `fabric` цветом #565759 | — | — |
| Johanneshov ciemnozielony | 796.319.82 | нет модели IKEA, тонировка `fabric` цветом #2f3528 | — | — |
| Johanneshov kremowy | 396.319.84 | нет модели IKEA, тонировка `fabric` цветом #dfdac8 | — | — |
| Mosshed ciemnobrązowy | 996.319.81 | нет модели IKEA, тонировка `fabric` цветом #584739 | — | — |
| Mosshed czerwonobrązowy | 896.319.86 | нет модели IKEA, тонировка `fabric` цветом #884229 | — | — |
| Mosshed szarozielony | 996.319.76 | нет модели IKEA, тонировка `fabric` цветом #838c6d | — | — |

Посадка у острова: Раскладывается вперёд до 241 см глубины, спальное место 140×200. ширина 190 — на 5 см шире острова с каждой стороны; верх спинки 83 — на 7 см ниже столешницы.
