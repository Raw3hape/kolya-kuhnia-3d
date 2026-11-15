# EKTORP, 2-местный — источник 3D

- Товар: https://www.ikea.com/pl/pl/p/ektorp-sofa-2-osobowa-kilanda-jasnobezowy-s49509025/ (ikea.com/pl, данные сняты 2026-11-15)
- Размеры IKEA: 179 × 88 × 88 см, сиденье 45 см. Модель отмасштабирована по осям точно под эти цифры.
- 3D: официальные AR-модели IKEA, `https://web-api.ikea.com/pl/pl/rotera/data/model/<артикул>/` → `.../rotera/static/models/<артикул>-mini.glb`. У IKEA отдельная модель на каждое покрытие.
- Лицензия: © Inter IKEA Systems B.V. Публичной лицензии нет. Только личная визуализация квартиры владельца, не распространять и не публиковать модели отдельно.
- Обработка (Blender 5.2 + gltf-transform meshopt): Draco снят, ось и центр по контракту (метры, пол = 0, центр следа, ширина X, перед +Z), обивка → материал `fabric`, ножки (отдельные детали у пола) → `legs` с той же текстурой, текстуры ≤ 1024, геометрия > 45k треугольников прорежена. `fabric_fringe`, если есть, — полупрозрачная бахрома ткани из файла IKEA.

| Покрытие | Артикул | Файл | Масштаб x/y/z | Треуг. |
|---|---|---|---|---|
| Kilanda jasnobeżowy | 495.090.25 | model.glb | 1.008/0.948/0.966 | 9685 |
| Blekinge biały | 296.286.75 | нет модели IKEA, тонировка `fabric` цветом #e8e5de | — | — |
| Mångbyn brązowy/wielobarwny | 996.207.27 | нет модели IKEA, тонировка `fabric` цветом #985c43 | — | — |
| Hakebo ciemnoszary | 095.090.13 | cover-hakebo-ciemnoszary.glb | 1.008/0.948/0.966 | 6556 |
| Hakebo szarozielony | 395.090.16 | cover-hakebo-szarozielony.glb | 1.008/0.948/0.966 | 27839 |
| Hillared granatowy | 694.305.21 | cover-hillared-granatowy.glb | 1.008/0.927/0.964 | 12602 |
| Kilanda brązowoczerwony | 596.338.64 | нет модели IKEA, тонировка `fabric` цветом #7a3f37 | — | — |
| Kilanda granatowy | 996.286.91 | нет модели IKEA, тонировка `fabric` цветом #3e4956 | — | — |
| Kilanda szarobrązowy | 596.286.93 | нет модели IKEA, тонировка `fabric` цветом #564c40 | — | — |
| Naggen beżowy | 096.286.95 | нет модели IKEA, тонировка `fabric` цветом #bfb09f | — | — |
| Naggen szaroniebieski | 296.286.99 | нет модели IKEA, тонировка `fabric` цветом #6d8590 | — | — |
| Naggen szarozielony | 696.286.97 | нет модели IKEA, тонировка `fabric` цветом #7a7e65 | — | — |
| Tallmyra jasnozielony | 394.305.27 | cover-tallmyra-jasnozielony.glb | 1.008/0.927/0.964 | 12266 |
| Tallmyra średnioszary | 194.305.28 | cover-tallmyra-srednioszary.glb | 1.009/0.926/0.965 | 7761 |
| Alhamn ciemny szaroniebieski | 896.286.82 | нет модели IKEA, тонировка `fabric` цветом #34474a | — | — |
| Alhamn ciemny żółto-brązowy | 196.286.85 | нет модели IKEA, тонировка `fabric` цветом #542806 | — | — |
| Alhamn głęboki pomarańczowo-czerwony | 696.286.78 | нет модели IKEA, тонировка `fabric` цветом #5a1102 | — | — |
| Hemmesta jasnobeżowy | 396.286.89 | нет модели IKEA, тонировка `fabric` цветом #b2a995 | — | — |
| Hemmesta szarozielony | 796.286.87 | нет модели IKEA, тонировка `fabric` цветом #77867c | — | — |

Посадка у острова: Чехол до пола, ножки скрыты. ширина 179 — на 0.5 см уже острова с каждой стороны; верх спинки 88 — на 2 см ниже столешницы.
