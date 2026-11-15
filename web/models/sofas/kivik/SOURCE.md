# KIVIK, 2-местный — источник 3D

- Товар: https://www.ikea.com/pl/pl/p/kivik-sofa-2-osobowa-tresund-jasnobezowy-s19482819/ (ikea.com/pl, данные сняты 2026-11-15)
- Размеры IKEA: 190 × 95 × 83 см, сиденье 45 см. Модель отмасштабирована по осям точно под эти цифры.
- 3D: официальные AR-модели IKEA, `https://web-api.ikea.com/pl/pl/rotera/data/model/<артикул>/` → `.../rotera/static/models/<артикул>-mini.glb`. У IKEA отдельная модель на каждое покрытие.
- Лицензия: © Inter IKEA Systems B.V. Публичной лицензии нет. Только личная визуализация квартиры владельца, не распространять и не публиковать модели отдельно.
- Обработка (Blender 5.2 + gltf-transform meshopt): Draco снят, ось и центр по контракту (метры, пол = 0, центр следа, ширина X, перед +Z), обивка → материал `fabric`, ножки (отдельные детали у пола) → `legs` с той же текстурой, текстуры ≤ 1024, геометрия > 45k треугольников прорежена. `fabric_fringe`, если есть, — полупрозрачная бахрома ткани из файла IKEA.

| Покрытие | Артикул | Файл | Масштаб x/y/z | Треуг. |
|---|---|---|---|---|
| Tresund jasnobeżowy | 194.828.19 | model.glb | 1.004/0.992/0.968 | 11372 |
| Tibbleby beżowy/szary | 094.405.99 | cover-tibbleby-bezowy-szary.glb | 1.008/1.008/0.985 | 44999 |
| Gunnared beżowy | 594.847.55 | cover-gunnared-bezowy.glb | 1.004/0.993/0.968 | 22569 |
| Gunnared jasnozielony | 194.847.57 | cover-gunnared-jasnozielony.glb | 1.000/1.000/1.000 | 22151 |
| Gunnared jasny różowy | 394.847.56 | cover-gunnared-jasny-rozowy.glb | 1.000/1.001/1.002 | 5360 |
| Gunnared niebieski | 594.848.02 | cover-gunnared-niebieski.glb | 1.000/1.003/0.970 | 19641 |
| Gunnared średnioszary | 994.847.58 | cover-gunnared-srednioszary.glb | 1.004/0.993/0.968 | 26066 |
| Kelinge szaroturkusowy | 494.430.44 | cover-kelinge-szaroturkusowy.glb | 1.008/1.008/0.983 | 45000 |
| Tresund antracyt | 994.828.20 | cover-tresund-antracyt.glb | 1.004/0.992/0.967 | 6962 |
| Tallmyra beżowy | 594.847.60 | cover-tallmyra-bezowy.glb | 1.004/0.993/0.969 | 43142 |
| Tallmyra biały/czarny | 794.847.64 | cover-tallmyra-bialy-czarny.glb | 1.000/1.000/1.000 | 26004 |
| Tallmyra ciemnozielony | 194.847.62 | cover-tallmyra-ciemnozielony.glb | 1.000/1.000/1.000 | 22151 |
| Tallmyra jasnozielony | 994.847.63 | cover-tallmyra-jasnozielony.glb | 1.000/1.001/1.001 | 5948 |
| Tallmyra niebieski | 394.847.61 | cover-tallmyra-niebieski.glb | 1.016/0.993/0.968 | 22458 |
| Tallmyra średnioszary | 894.848.05 | cover-tallmyra-srednioszary.glb | 1.004/0.993/0.969 | 12374 |
| Grann/Bomstad czarny | 505.195.18 | cover-grann-bomstad-czarny.glb | 0.994/1.007/0.960 | 24440 |

Посадка у острова: ширина 190 — на 5 см шире острова с каждой стороны; верх спинки 83 — на 7 см ниже столешницы.
