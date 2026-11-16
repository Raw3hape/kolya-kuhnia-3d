# Domestic party assets

Feature: [../../docs/party.md](../../docs/party.md).

- `props.recipe.json` + `props.py` / `props_build.mjs`: domestic prop library and studio layout. Output `web/models/party/props/library.glb`.
- `hands.recipe.json` + `hands-build.py`: three anatomical static grip meshes, shared materials. Output `web/models/party/hands.glb`; runtime sockets in `web/spec/party-grips.json`.
- `web/spec/party-visuals.json` + `build_interactive.blender.py`: hollow bottle, vape, mouthpiece, smoked-glass hookah and returnable cardboard carrier. `make_interactive_textures.py` authors small original maps.
- `labels/generation.json`: exact prompts and eight source illustrations made with built-in ChatGPT Images. `web/spec/party-labels.json` binds stable bottle IDs and titles to atlas cells. The texture builder packs one shared atlas with edge gutters; world, held and remote instances use cached UV variants.

Build interactives with an existing `GLTF_TRANSFORM_CLI` and Blender:

```sh
GLTF_TRANSFORM_CLI=/path/to/cli.js node tools/party/interactive_build.mjs
```

The builder uses bounded foreground jobs, stages the final asset atomically and removes its regenerable source maps and raw exports. Textures become WebP before Meshopt geometry compression. No package installs beyond the existing uv Pillow environment. Use `--render` with the Blender source for a disposable studio proof after generating the atlas and three finish maps. Keep no `.blend` or frame dumps in the runtime asset folders.

Metres, glTF +Y up; prop bottoms are origins. Preserve semantic cap/liquid/rest-mouthpiece groups. Geometry/textures are shared; only liquid plane/surface state belongs to each bottle. World and held materials use separate caches. No face/toy generator remains.
