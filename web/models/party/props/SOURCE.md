# Everyday household props

Original project-authored geometry and small procedural finish maps. No external
models, product scans, logos or downloaded textures are included.

- Authoring: [props.py](../../../../tools/party/props.py), with dimensions, finishes
  and seed in [props.recipe.json](../../../../tools/party/props.recipe.json).
- Build: `node tools/party/props_build.mjs --gltf-cli /path/to/@gltf-transform/cli/bin/cli.js`.
  Uses an existing Blender and glTF Transform installation; stages outputs, deduplicates,
  applies Meshopt and deletes intermediates. No tool is installed by the build.
- Shipping: `library.glb`, one request. Templates are named, in metres, glTF Y-up,
  with centred floor pivots. `manifest.json` records bounds, triangles and bytes.
- Details: hollow stoneware, rounded lips/foot rings, small handles, recessed tray,
  cut keys, folded linen, cover/page block/bookmark, ribbed thick glass and spice contents.
- Materials: shared PBR finishes; opaque faces culled, glass alpha blended without
  a per-object transmission render. Small embedded repeatable maps for ceramic,
  cork, linen and contents. Runtime instances share all geometry/material/texture data.
- Placement: `web/spec/party-props.json`, in useful asymmetric clusters. Supporting
  furniture frames move the clusters; stable independent unit IDs preserve destruction.

The temporary studio proof was inspected. Browser inspection in the actual room
remains the integration acceptance check.
