# Живой дом: монстры за входной дверью и мышь

Подключают `web/js/landing.js` (монстры) и `web/js/mice.js` (мышь); грузятся лениво: монстры — когда игрок
подходит к входной двери или открывает её, мышь — перед первой мышью. Все исходники скачаны 2026-11-15
с poly.pizza (страница модели → кнопка GLB), без регистрации. Автор всех — Quaternius, лицензия CC0 1.0
(подпись не обязательна, но пусть будет).

| Файл | Что внутри | Исходник | Клипы |
|---|---|---|---|
| `yeti.glb` | йети | «Yeti» https://poly.pizza/m/S1E7idPFhe | Idle, No, Bite_Front, HitRecieve, Dance |
| `demon.glb` | синий демон | «Blue Demon» https://poly.pizza/m/S7jYW6Amye | Idle, No, Punch, HitReact, Wave |
| `mushnub.glb` | гриб-коротышка | «Mushnub» https://poly.pizza/m/LWKmS30Xxl | Idle, No, Bite_Front, HitRecieve, Dance |
| `rat.glb` | крыса, в сцене уменьшена до мыши (17 см) | «Rat» https://poly.pizza/m/iltq5bVNaV | Rat_Idle, Rat_Run, Rat_Death |

Обработка: лишние клипы удалены, оставшиеся переименованы под список выше; крыса упрощена в Blender (Decimate 0.3);
затем `npx @gltf-transform/cli@4` prune → resample → meshopt. Масштаб и разворот задаются в коде (CAST в landing.js,
LENGTH в mice.js), файлы можно заменить любыми другими GLB с такими же именами клипов.
