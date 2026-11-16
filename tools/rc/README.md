# DZIK RC CLUB

Entry: [project README](../../README.md). Runtime contract: [RC gameplay](../../docs/rc.md).

The ten ChatGPT Images references and exact prompts are in `concepts/`.
[Reference mapping](REFERENCE-MAPPING.md) records the Blender adaptation.

Original authoring source: `build.py` + `upgrade_helpers.py` + `web/spec/rc.json`, seed `20261116`.
`garage.blend` is the Blender source (not loaded by the browser). Generated
`web/models/rc/garage.glb` is the only runtime library; ten original distinct
silhouettes share immutable geometry/materials per template. Cars are about
1.5 m long, comparable to an adult boar. +Z = nose; Y up; metres; wheel pivots
`wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR` support suspension/steering/spin.

Build:

```sh
blender -b --python tools/rc/build.py
GLTF_TRANSFORM_CLI=/path/to/@gltf-transform/cli/bin/cli.js node tools/rc/pack.mjs
```

Run both commands. Raw output stays in `tools/rc/.staging/`; the published
asset is replaced by an atomic rename only after compression succeeds. The second packs the GLB with dedup + Meshopt and updates
its SHA-256 manifest. No download, model weights, texture atlas or runtime
external CDN. Sources are original; cannon-es runtime MIT license is in
`web/vendor/cannon-es-0.20.0/LICENSE`. Asset originals belong to this project.

Physics integrity: `node tools/rc/vendor.mjs --check` (offline). To restore the
exact pinned files: `node tools/rc/vendor.mjs --write`; downloaded SHA-256 must
match the committed manifest before either file is written.
