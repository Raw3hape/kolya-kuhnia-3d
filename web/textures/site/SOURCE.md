# Текстуры окружения (земля, дороги, кора)

Пишет `tools/fetch_site.py --assets`. Источник — ambientCG, лицензия CC0 1.0, скачано 2026-11-15. Оставлена только карта цвета (Color), JPEG q85.
Масштаб в site.js (`TEX_M`): трава и луг — 3 м на повтор, почва 4 м, асфальт 4 м, плитка 2 м, кора 1.5 м.
Тротуарная плитка обесцвечена до серой «kostka brukowa».

| файл | источник | размер |
|---|---|---|
| `grass.jpg` | [Grass004](https://ambientcg.com/view?id=Grass004) | 1024 px |
| `meadow.jpg` | [Ground037](https://ambientcg.com/view?id=Ground037) | 1024 px |
| `soil.jpg` | [Ground106](https://ambientcg.com/view?id=Ground106) | 1024 px |
| `asphalt.jpg` | [Asphalt031](https://ambientcg.com/view?id=Asphalt031) | 1024 px |
| `paving.jpg` | [PavingStones146](https://ambientcg.com/view?id=PavingStones146) | 1024 px, насыщенность ×0.25 |
| `bark.jpg` | [Bark014](https://ambientcg.com/view?id=Bark014) | 512 px, насыщенность ×0.8 |

Листва, ветки, фасады и решётки балконов рисуются кодом в site.js (canvas), файлов у них нет.
