# Anatomical first-person grips

Original meshes authored for this project, 2026-11-16. No downloaded geometry,
textures or weapon-rig derivatives are included. The skin micro-normal is a
small deterministic procedural tile.

- Authoring: `tools/party/hands.recipe.json` and `tools/party/hands-build.py`.
- Runtime map: `web/spec/party-grips.json`; loader: `web/js/party-hands.js`.
- Three grips: cylindrical beer, narrow device pinch, hookah mouthpiece pinch.
- Each uses five distinct fingers and nails, a continuous closed palm/wrist/forearm,
  and a neutral cloth cuff. A tapered elliptical loft blends the slim wrist into the palm and forearm. Origin and axes match the held prop at identity.
- About 6,080 triangles and three draws per visible grip. Materials and the
  128px micro-normal are shared. No runtime skinning or geometry allocation.
- Packed GLB: about 427KB. `KHR_mesh_quantization` needs no additional decoder.

Regenerate from the project root:

```sh
blender -b --python tools/party/hands-build.py -- --render
# Then dedup + quantize with @gltf-transform/cli 4.5.1; source GLB is valid without packing.
```

The renderer writes a temporary studio contact sheet to
`output/playwright/party-realism/hands/grips.png`; inspect and remove it after QA.
The three node names in the generated runtime map are the public asset contract.
