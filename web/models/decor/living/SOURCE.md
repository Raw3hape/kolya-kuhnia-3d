# Гостиная: стеллажи у пустой стены — модели и конвейер

Зона `living` (`web/spec/decor/living.json`). Пустая стена — перегородка с комнатой 2, z = 3,68,
x 2,00–6,17. Мебель — реальные товары ikea.com/pl (цены на 2026-11-15), каждая папка со своим `SOURCE.md`.
Книги, растения, вазы и рамки — общий реквизит без бренда: `../props/README.md`.

| Папка | Товар | Арт. | zł |
|---|---|---|---|
| `billy-80-oak` | BILLY Regał, imit. dębu, 80x28x202 cm | 105.089.32 | 349 |
| `billy-40-oak` | BILLY Regał, imit. dębu, 40x28x202 cm | 604.773.82 | 249 |
| `ivar-3` | IVAR 3 sekcje/półki, sosna, 219x30x226 cm | 894.039.46 | 1205 |
| `kallax-5x5` | KALLAX Regał, imitacja dębu bejcowanego na biało, 182x182 cm | 903.245.09 | 799 |
| `eket-walnut` | EKET Kombinacja szafek ściennych, brązowy orzech, 175x35x70 cm | 995.688.33 | 800 |
| `mosslanda-115-walnut` | MOSSLANDA Półka na zdjęcia, orzech, 115 cm | 606.366.49 | 39,99 |
| `strandmon-grann` | STRANDMON Fotel uszak, Grann/Bomstad ciemnobrązowy | 004.946.38 | 1499 |
| `arstid-lamp` | ÅRSTID Lampa podłogowa, mosiądz/biały | 003.213.17 | 179 |

`thumbs/<опция>.jpg` — миниатюры собранных опций (мебель + реквизит), их рисует `tools/decor/living/thumbs.py`.

## Конвейер (`tools/decor/living/`)

1. Модель IKEA: rotera (`https://web-api.ikea.com/pl/pl/rotera/data/model/<арт.>/` → `modelUrl`), сырьё — в scratchpad.
2. `normalize.py` (Blender headless) — центр следа, пол, перед +Z, реальный масштаб, текстуры ≤ 1024; отчёт с уровнями полок.
3. `anatomy.py` → `anatomy.json` — пролёты (x0..x1 между стойками) и полки (высота и просвет) каждой модели.
4. `pack.py` — webp + meshopt, `thumb.jpg` через общий `tools/decor/thumb.py`. `preview.py` — листы «со всех сторон».
5. Реквизит: `fetch_polyhaven.py` (CC0, 1k) + `make_prints.py` (свои принты) → `make_props.py` (Blender) → `pack.py`
   → `../props/<id>/` и `../props/index.json` (габарит, след горшка, низ плетей).
6. `compose.py` — пишет `living.json`: расстановка у стены и раскладка полок по `anatomy.json`, проверки
   (вещь входит в просвет и в глубину полки, не налезает на соседку, не упирается в полку над ней, проход
   до дивана/острова ≥ 90 см, не уходит за комнату); `--boxes <мебель.json> --plot <план.png>` — вид сверху.
7. `thumbs.py` — миниатюры опций.

Код варианта: опции и слоты только дописывать в конец (`../README.md`).
