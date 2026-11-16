# Six original energy labels

Created 2026-11-17 with **ChatGPT Images**, one independent built-in
`image_gen.imagegen` generation per drink. These are the full, unmodified PNG
masters. The bottle pipeline derives compressed runtime textures from them.

| File | Drink | Original pixels |
| --- | --- | --- |
| `zabych.png` | ЖАБЫЧ 24/7 — киви, лайм, ночная очередь | 1024 × 1536 |
| `panika.png` | ПАНИКА В ЗУС — красный апельсин, бумажная волокита | 1145 × 1374 |
| `pierog.png` | ПЕРОГ-РАКЕТА — вишня, ваниль, космический сметан | 1024 × 1536 |
| `bobr.png` | БОБР КУРБИНА — груша, имбирь, дубовая искра | 1145 × 1374 |
| `paragon.png` | ПАРАГОН В ОГНЕ — малина, перец, касса номер два | 1024 × 1536 |
| `tram.png` | ТРАМВАЙ В 6:01 — чёрная смородина, мята, последний вагон | 1024 × 1536 |

`generation.json` preserves exact prompts, original tool output paths, names,
flavors, taglines, completion status and SHA256 checksums. Every master was
visually inspected for its unique artwork and Russian text.

Fit the entire image to the authored front label panel. Do not crop the title,
taste or bottom tagline. The two 1145 × 1374 masters have a wider aspect ratio;
preserve their full frame when deriving bottle textures. Existing authoring
entry point: `../build-energy.blender.py`.
