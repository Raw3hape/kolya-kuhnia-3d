# JÄTTEBO, 2-местный модульный — источник 3D

- Товар: https://www.ikea.com/pl/pl/p/jaettebo-sofa-modulowa-2-osobowa-axvall-kremowy-s49608266/ (ikea.com/pl, данные сняты 2026-11-15)
- Размеры IKEA: 190 × 95 × 71 см, сиденье 46 см. Модель отмасштабирована по осям точно под эти цифры.
- 3D: официальные AR-модели IKEA, `https://web-api.ikea.com/pl/pl/rotera/data/model/<артикул>/` → `.../rotera/static/models/<артикул>-mini.glb`. У IKEA отдельная модель на каждое покрытие.
- Лицензия: © Inter IKEA Systems B.V. Публичной лицензии нет. Только личная визуализация квартиры владельца, не распространять и не публиковать модели отдельно.
- Обработка (Blender 5.2 + gltf-transform meshopt): Draco снят, ось и центр по контракту (метры, пол = 0, центр следа, ширина X, перед +Z), обивка → материал `fabric`, ножки (отдельные детали у пола) → `legs` с той же текстурой, текстуры ≤ 1024, геометрия > 45k треугольников прорежена. `fabric_fringe`, если есть, — полупрозрачная бахрома ткани из файла IKEA.

| Покрытие | Артикул | Файл | Масштаб x/y/z | Треуг. |
|---|---|---|---|---|
| Axvall kremowy | 496.082.66 | model.glb | 1.000/0.999/0.998 | 36392 |
| Samsala granatowy | 796.082.36 | cover-samsala-granatowy.glb | 1.000/0.999/0.998 | 36392 |
| Samsala ciemny żółto-zielony | 294.714.05 | cover-samsala-ciemny-zolto-zielony.glb | 0.984/0.977/0.981 | 27664 |
| Samsala szarobeżowy | 594.714.04 | cover-samsala-szarobezowy.glb | 0.983/0.980/0.981 | 2376 |
| Axvall ciemny szaroniebieski | 296.082.67 | cover-axvall-ciemny-szaroniebieski.glb | 1.000/0.999/0.998 | 36392 |
| Samsala brązowoczerwony | 696.082.65 | нет модели IKEA, тонировка `fabric` цветом #7e3f36 | — | — |
| Samsala ciemnobrązowy | 596.082.61 | нет модели IKEA, тонировка `fabric` цветом #493427 | — | — |
| Samsala żółtobrązowy | 396.082.62 | cover-samsala-zoltobrazowy.glb | 1.000/0.999/0.998 | 36392 |
| Johanneshov brązowobeżowy | 096.082.68 | cover-johanneshov-brazowobezowy.glb | 1.000/0.999/0.998 | 36392 |
| Johanneshov ciemnozielony | 896.082.69 | cover-johanneshov-ciemnozielony.glb | 1.000/0.999/0.998 | 36392 |

Посадка у острова: Модульная: 2 сиденья + 2 подлокотника, низкая спинка. ширина 190 — на 5 см шире острова с каждой стороны; верх спинки 71 — на 19 см ниже столешницы.
