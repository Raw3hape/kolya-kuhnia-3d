# Вьюмодели оружия (прогулка)

Подключает `web/js/viewmodel.js`; грузятся лениво, только когда в прогулке выбрано оружие.

| Файл | Исходник | Автор | Лицензия |
|---|---|---|---|
| `pistol.glb` | https://poly.pizza/m/Jyn9qex4ba (GLB: https://static.poly.pizza/3b53f0fe-f86e-451c-816d-6ab9bd265cdc.glb) | Quaternius, пак «Ultimate Guns» https://quaternius.com/packs/ultimategun.html | CC0 |
| `rifle.glb` | https://poly.pizza/m/Bgvuu4CUMV (GLB: https://static.poly.pizza/9a0e478c-de82-4773-9b70-a0219bb0057c.glb) | Quaternius, тот же пак | CC0 |
| `bolt.glb` | процедурная, `tools/viewmodel/procedural.py` | своя работа, 2026-11-15 | как у проекта |
| `shotgun.glb` | процедурная, `tools/viewmodel/procedural.py` | своя работа, 2026-11-15 | как у проекта |

Скачано 2026-11-15. Перчатки и рукава процедурные (`tools/viewmodel/build.py`), чужих ассетов в них нет.

## Что сделано с исходником

- Узлы: `gun`, `hands`, `muzzle` (пустышка в точке дула — от неё вспышка).
- Начало координат — центр рукояти, ствол смотрит в −Z (вперёд в glTF), верх +Y.
- Реальный размер: пистолет 0.20 м, автомат 0.86 м.
- У автомата срезан приклад (x = −0.62 в исходных единицах) и закрыт срез — у плеча он всё равно вне кадра.
- Цвета ствола чуть осветлены, затенение плоское; перчатки #4a4640, рукав #5c5f62, манжета #45484b.

## Винтовка и двустволка (процедурные)

- `bolt.glb` — обобщённая магазинная винтовка Первой мировой (класс Маузер/Мосин, не копия конкретной), 1.16 м, дерево и воронёная сталь.
  Узлы: `gun`, `bolt` (ось вращения — ось канала ствола, z 0.055), `clip` (обойма на 5 патронов), `hand_r`, `hand_l`, `muzzle`.
  Линия прицеливания приподнята: низ прорези целика и верх мушки на высоте 0.091 м, иначе в прицеле мешает затвор.
- `shotgun.glb` — горизонтальная двустволка. Узлы: `gun`, `barrels` (шарнир переламывания), `shells` (две гильзы),
  `hand_r`, `hand_l`, `muzzle`; левая рука, гильзы и дуло — дочерние к `barrels` и откидываются вместе со стволами.
- Анимации (затвор, обойма, переламывание) делает `viewmodel.js`, двигая эти узлы; в GLB анимаций нет.
- Точки прицела (`WEAPONS[*].ads.sight`) заданы в `viewmodel.js` в метрах модели: при правке геометрии прицела их надо сверить.

## Пересборка

```
blender -b --python tools/viewmodel/build.py -- <папка со скачанными GLB по id> <out> <превью>
npx -y @gltf-transform/cli@4 meshopt <out>/pistol.raw.glb pistol.glb
npx -y @gltf-transform/cli@4 meshopt <out>/rifle.raw.glb rifle.glb

blender -b --python tools/viewmodel/procedural.py -- <out> <превью>
npx -y @gltf-transform/cli@4 meshopt <out>/bolt.raw.glb bolt.glb
npx -y @gltf-transform/cli@4 meshopt <out>/shotgun.raw.glb shotgun.glb
```

Исходные GLB кладутся как `<id>.glb` (`Jyn9qex4ba.glb`, `Bgvuu4CUMV.glb`). Положение в кадре задаётся
в `viewmodel.js` (`WEAPONS[*].pos`), а `view` в `tools/viewmodel/build.py` — только ракурс превью.
