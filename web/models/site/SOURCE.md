# Машины на парковках

`cars.glb` пишет `tools/fetch_site.py --assets`: Kenney «Car Kit» 3.1 (https://kenney.nl/assets/car-kit), автор Kenney, лицензия CC0 1.0, скачано 2026-11-15.
Модели sedan, hatchback-sports, suv, van: части склеены в один меш, цвет палитры запечён в цвет вершин, материалы убраны (site.js задаёт один материал и перекрашивает кузов).
Масштаб: габариты растянуты до реальных (длина × ширина × высота, м): sedan 4.69 × 1.83 × 1.47 (Škoda Octavia), hatchback 4.28 × 1.79 × 1.46 (VW Golf), suv 4.60 × 1.86 × 1.69 (Toyota RAV4), van 4.90 × 1.90 × 1.97 (VW Transporter).
Контракт: метры, пол Y = 0, центр следа в 0, перед смотрит в +Z. Сжатие meshopt (`npx -y @gltf-transform/cli@4 meshopt`).
