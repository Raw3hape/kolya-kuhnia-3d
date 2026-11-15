# Вьюмодели оружия (прогулка)

Подключает `web/js/viewmodel.js`; грузятся лениво, только когда в прогулке выбрано оружие.

| Файл | Исходник | Автор | Лицензия |
|---|---|---|---|
| `pistol.glb` | https://poly.pizza/m/Jyn9qex4ba (GLB: https://static.poly.pizza/3b53f0fe-f86e-451c-816d-6ab9bd265cdc.glb) | Quaternius, пак «Ultimate Guns» https://quaternius.com/packs/ultimategun.html | CC0 |
| `rifle.glb` | https://poly.pizza/m/Bgvuu4CUMV (GLB: https://static.poly.pizza/9a0e478c-de82-4773-9b70-a0219bb0057c.glb) | Quaternius, тот же пак | CC0 |

Скачано 2026-11-15. Перчатки и рукава процедурные (`tools/viewmodel/build.py`), чужих ассетов в них нет.

## Что сделано с исходником

- Узлы: `gun`, `hands`, `muzzle` (пустышка в точке дула — от неё вспышка).
- Начало координат — центр рукояти, ствол смотрит в −Z (вперёд в glTF), верх +Y.
- Реальный размер: пистолет 0.20 м, автомат 0.86 м.
- У автомата срезан приклад (x = −0.62 в исходных единицах) и закрыт срез — у плеча он всё равно вне кадра.
- Цвета ствола чуть осветлены, затенение плоское; перчатки #4a4640, рукав #5c5f62, манжета #45484b.

## Пересборка

```
blender -b --python tools/viewmodel/build.py -- <папка со скачанными GLB по id> <out> <превью>
npx -y @gltf-transform/cli@4 meshopt <out>/pistol.raw.glb pistol.glb
npx -y @gltf-transform/cli@4 meshopt <out>/rifle.raw.glb rifle.glb
```

Исходные GLB кладутся как `<id>.glb` (`Jyn9qex4ba.glb`, `Bgvuu4CUMV.glb`). Положение в кадре задаётся
в `viewmodel.js` (`WEAPONS[*].pos`), а `view` в `tools/viewmodel/build.py` — только ракурс превью.
