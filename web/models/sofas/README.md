# Диваны IKEA (реальные 3D)

Каталог: `web/spec/sofas.json` (порядок = порядок в UI и в коде ссылки, только дописывать в конец).
Папка `<id>/`: `model.glb` (первое покрытие в каталоге), `cover-<coverId>.glb` (свои модели IKEA для других покрытий),
`thumb.jpg` 256×256, `SOURCE.md` (ссылки, лицензия, масштаб каждого файла).

Контракт GLB: метры, пол Y = 0, центр следа в 0, ширина по X, перед (сиденье) смотрит в +Z, спинка в −Z.
Габариты совпадают с цифрами IKEA. Материалы: `fabric` (обивка, её перекрашивает приложение), `legs` (ножки),
иногда `fabric_fringe` (полупрозрачная бахрома). Сжатие meshopt + KHR_mesh_quantization: в three нужен
`loader.setMeshoptDecoder(MeshoptDecoder)`. Текстуры webp ≤ 1024 (у трёх покрытий KIVIK jpeg/png).
Цвет `fabric` у IKEA запечён в текстуру: для покрытий без своей модели приложение тонирует `fabric` цветом `color`.

Лицензия: модели IKEA (© Inter IKEA Systems B.V.) без публичной лицензии, только личная визуализация.

Добавить диван: артикул → `https://web-api.ikea.com/pl/pl/rotera/data/model/<артикул без s>/` (заголовок
`X-Client-Id` из страницы IKEA) даёт `modelUrl` и размеры; скачать GLB, затем
`blender -b --python tools/sofas/normalize.py -- jobs.json report.json` (job: `in`, `out`, `W`, `D`, `H` в метрах,
`clear` — высота под мебелью, если ножки не отдельные детали), потом
`npx -y @gltf-transform/cli@4 meshopt in.glb out.glb`. Проверка: `tools/sofas/render.py` (mode `island`
ставит серый остров 180×60×90 за спинкой).
