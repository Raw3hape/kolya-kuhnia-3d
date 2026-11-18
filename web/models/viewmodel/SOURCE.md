# Модели оружия от первого лица

Квартира и Служебный этаж загружают выбранное оружие через `web/js/weapon-models.js`.
Сборка — `tools/viewmodel/build.py` (Blender, без окна), затем сжатие meshopt. Исходники первых четырёх моделей скачаны 2026-11-15
с poly.pizza (страница модели → кнопка GLB), без регистрации.

| Файл | Что внутри | Исходники | Автор | Лицензия |
|---|---|---|---|---|
| `pistol.glb` | руки + пистолет класса Glock, клипы idle/shoot/reload | «Fps Rig» https://poly.pizza/m/uxko5LkGia | J-Toastie | CC-BY 3.0 |
| `rifle.glb` | руки + автомат класса АКМ, клипы idle/shoot/reload | «Fps Rig AKM» https://poly.pizza/m/U6l6wjxFhC | J-Toastie | CC-BY 3.0 |
| `bolt.glb` | руки из «Fps Rig AKM» + винтовка класса Kar98k; клипы собраны в build.py | https://poly.pizza/m/U6l6wjxFhC, «Kar98k» https://poly.pizza/m/ntijptIGIw | J-Toastie; AdamKokrito | CC-BY 3.0 (оба) |
| `shotgun.glb` | руки из «Fps Rig AKM» + обрез-двустволка; клип reload собран в build.py, патроны свои | https://poly.pizza/m/U6l6wjxFhC, «Shotgun Sawed Off» https://poly.pizza/m/29FXKu7G91 | J-Toastie; Quaternius | CC-BY 3.0; CC0 |
| `uzi.glb` | оригинальная модель и руки, клипы idle/shoot/reload | `tools/viewmodel/uzi.blend`, `tools/viewmodel/build-uzi.py` | Kolya Kuhnia 3D | ассет проекта |

Обязательная подпись (CC-BY 3.0, показать там, где перечислены авторы):
«Fps Rig» и «Fps Rig AKM» — J-Toastie (poly.pizza, CC-BY 3.0); «Kar98k» — AdamKokrito (poly.pizza, CC-BY 3.0).
Изменения: масштаб, оси, обрезка клипов, новые кости и анимации для винтовки и двустволки.

## Контракт GLB (читает weapon-models.js)

- Метры; ствол смотрит в −Z (glTF), верх +Y; начало координат — спусковой крючок.
- Руки и оружие могут быть одним мешем со скином или группами с анимацией; клипы `idle` (кадр 0 — поза держания), `shoot`, `reload`
  (у двустволки нет `shoot`: выстрел — процедурная отдача).
- Пустышки на кости оружия: `muzzle` (дуло, его +X — вдоль ствола), `sight_rear` и `sight_front` (линия прицела:
  самые высокие точки у казны и у дула). По ним `viewmodel.js` сам строит позу в прицеле.
- Положение в кадре, глаз в прицеле (`ads.eye`, `ads.lift`) и доли событий по ходу клипов (`reloadEv`, `cycleEv`) —
  в `WEAPONS` в `web/js/weapon-catalog.js`. Если пересобранный клип поменяет тайминг, доли надо сверить.

## Винтовка и двустволка (сборка)

- Руки — риг автомата без автомата, поза кадра 0 его Idle. Левая кисть переезжает на цевьё (высота цевья
  меряется лучом по треугольникам), правая — ведётся IK к шару затвора / к патронам; IK запекается в кости.
- `bolt.glb`: кости `kar_bolt` (затвор: поворот 90° и ход 10 см), `kar_clip` (обойма), `kar_rounds` (патроны).
  shoot — передёрнуть затвор (0.83 с), reload — открыть, обойма в паз, патроны вниз, закрыть, обойма слетает (2.58 с).
- `shotgun.glb`: кость `sg_barrels` (стволы с цевьём, шарнир перед колодкой), `sg_shells` (два патрона 12-го калибра,
  своя геометрия). reload — переломить, гильзы назад-вверх, правая рука приносит два патрона, закрыть (2.0 с).

## Пересборка

```
blender -b --python tools/viewmodel/build.py -- <папка с исходными GLB> <out> [pistol rifle bolt shotgun]
npx -y @gltf-transform/cli@4 meshopt <out>/<id>.raw.glb web/models/viewmodel/<id>.glb
```

Исходные GLB кладутся под их id с poly.pizza: `uxko5LkGia.glb`, `U6l6wjxFhC.glb`, `ntijptIGIw.glb`, `29FXKu7G91.glb`.
Размеры после meshopt: 140–260 КБ, текстур нет (цвета материалов).

Оригинальная модель Uzi пересобирается командой `blender -b -t 2 -P tools/viewmodel/build-uzi.py`.
После экспорта GLB сжимается через `gltf-transform meshopt`. Исходник Blender сохраняется рядом со скриптом.
