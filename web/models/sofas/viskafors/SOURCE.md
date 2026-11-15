# VISKAFORS, 2-местный — источник 3D

- Товар: https://www.ikea.com/pl/pl/p/viskafors-sofa-2-osobowa-lejde-jasnobezowy-brzoza-s79443212/ (ikea.com/pl, данные сняты 2026-11-15)
- Размеры IKEA: 194 × 90 × 74 см, сиденье 46 см. Модель отмасштабирована по осям точно под эти цифры.
- 3D: официальные AR-модели IKEA, `https://web-api.ikea.com/pl/pl/rotera/data/model/<артикул>/` → `.../rotera/static/models/<артикул>-mini.glb`. У IKEA отдельная модель на каждое покрытие.
- Лицензия: © Inter IKEA Systems B.V. Публичной лицензии нет. Только личная визуализация квартиры владельца, не распространять и не публиковать модели отдельно.
- Обработка (Blender 5.2 + gltf-transform meshopt): Draco снят, ось и центр по контракту (метры, пол = 0, центр следа, ширина X, перед +Z), обивка → материал `fabric`, ножки (отдельные детали у пола) → `legs` с той же текстурой, текстуры ≤ 1024, геометрия > 45k треугольников прорежена. `fabric_fringe`, если есть, — полупрозрачная бахрома ткани из файла IKEA.

| Покрытие | Артикул | Файл | Масштаб x/y/z | Треуг. |
|---|---|---|---|---|
| Lejde jasnobeżowy/brzoza | 794.432.12 | model.glb | 0.992/0.990/0.996 | 8885 |
| Lejde antracyt/brązowy | 394.432.52 | cover-lejde-antracyt-brazowy.glb | 0.992/0.990/0.995 | 12265 |
| Lejde antracyt/brzoza | 394.432.09 | cover-lejde-antracyt-brzoza.glb | 0.992/0.990/0.996 | 11512 |
| Lejde/szary/zielony brzoza | 494.432.18 | cover-lejde-szary-zielony-brzoza.glb | 0.992/0.990/0.996 | 8898 |
| Lejde szary/zielony/brązowy | 294.432.62 | cover-lejde-szary-zielony-brazowy.glb | 0.992/0.990/0.996 | 12282 |
| Lejde jasnobeżowy/brązowy | 294.432.57 | cover-lejde-jasnobezowy-brazowy.glb | 0.992/0.990/0.995 | 12286 |

Посадка у острова: Деревянный цоколь и ножки (берёза или коричневые) входят в текстуру fabric, перекраска их заденет, но у всех 6 вариантов есть свои модели. ширина 194 — на 7 см шире острова с каждой стороны; верх спинки 74 — на 16 см ниже столешницы.
