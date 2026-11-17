# DZIK RC CLUB — art pipeline

Entry: [project README](../../README.md). Runtime: [RC gameplay](../../docs/rc.md).
References: ten original ChatGPT Images sheets in `concepts/`, exact prompts in
[generation.json](concepts/generation.json). [Mapping](REFERENCE-MAPPING.md).

## Source of truth

`web/spec/rc.json` contains final SI dimensions and each design's explicit
`vehicle.bodyNode`, centre of mass, collider and four wheel sockets. The
Blender generator reads those sockets for tire centres, wheel wells, arch lips
and suspension; physics and rendering read the same data. No global guessed
track, axle positions or renderer height correction.

`build.py` + `upgrade_helpers.py` build the geometry deterministically (seed
20261116). Version 2 enlarges the garage by 25%: the recipe already contains the
final dimensions. `modelScale` only scales the smaller artistic control points
once; source dimensions are converted back before authoring, so no second
runtime scale is necessary. Cars are now roughly 1.66–2.19 m long.

Runtime axes: +Y up, +Z nose, +X wheel axle; root is the ground-contact centre.
Each named wheel is a **neutral empty pivot**, with mesh geometry underneath.
Meshopt may transform that child decoder; animation only transforms the empty.
Thus compression cannot move the axle or rotate the wheel 90 degrees.

## Build and validate before promotion

```sh
blender -b --python-exit-code 1 --python tools/rc/build.py -- --out tools/rc/.art-staging/v2
GLTF_TRANSFORM_CLI=/existing/cli.js node tools/rc/pack.mjs \
  --input tools/rc/.art-staging/v2/garage.glb \
  --output tools/rc/.art-staging/v2/garage.packed.glb
blender -b --python-exit-code 1 --python tools/rc/preview.py -- \
  --source tools/rc/.art-staging/v2/garage.blend \
  --out tools/rc/.art-staging/v2/contact.jpg --batch
```

The packer writes `garage.packed.manifest.json` beside the staged asset, retains
the input and removes only its own scratch files. It never promotes an explicit
staged output to `web/models/rc`. The integrator checks all 40 exact wheel
pivots, body names, bind transforms, scale and visual wheel seating, then promotes
the GLB and manifest together. The manifest records the source spec hash,
compression hash, actual rig positions, triangle counts and bounds.

`garage.blend` is the inspectable Blender source; the browser loads only the
compressed `web/models/rc/garage.glb`. Source layout may space templates apart
for editing; exported templates always use local ground-centred origins.

## Art version 2

Bodies have lofted cross sections, actual Boolean wheel cavities, curved roofs,
inset glazing, window seals/pillars and visible cabin details. Tires have hollow
rounded profiles, directional tread, open forged rims, rotors and calipers.
Arches follow each design's real wheel positions. Vehicle-specific geometry
includes the prototype teardrop canopy, formula cockpit/halo, buggy space frame,
rally lamps/roof scoop, expedition basket, pickup bed and van cargo shell.
Large contrasting race numbers sit on the body surfaces.

Ten cars total 300,274 triangles, at most 34,878 per car, five semantic meshes
per template (body plus four wheel geometries). The packed garage is about
2.0 MB; all models share their immutable resources between clients/instances.
These are polished stylized RC models adapted from the references, not a claim
of photorealistic image-to-mesh reconstruction.

Renders and staging are temporary proof. Preserve the short QA report and
published manifest, then remove regenerable frame/render intermediates. No
model download, external texture atlas or runtime asset CDN is involved.
