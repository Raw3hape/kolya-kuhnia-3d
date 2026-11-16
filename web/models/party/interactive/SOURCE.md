# Original interactive household assets

Original geometry authored for this project, generated from `tools/party/build_interactive.blender.py` and `web/spec/party-visuals.json`. No third-party product model. Eight original humorous Russian label illustrations were generated with built-in ChatGPT Images; exact prompts and retained sources are in `tools/party/labels/generation.json`. The other finish maps are authored procedurally.

Manufactured details include a hollow long-neck bottle wall, rolled lip, crimped crown, curved paper label; bevelled anodized vape shell and seams; a stainless/dark-glass hookah with foil, coal and fittings; folded cardboard with real handle openings and dividers.

One Meshopt GLB with WebP textures. All eight labels share one guttered 2048×1280 atlas; stable IDs select small cached UV variants. Immutable template geometry and textures are shared by all instances. Dark olive glass has stronger edge absorption. Bottle liquid is a separate clipped volume plus a gravity-aligned surface: deterministic volume samples preserve the consumed amount through rotation. This is a bounded visual fluid model, without a refraction render target or full fluid solver.

Build entry: `tools/party/README.md`. The runtime uses authored contact sockets and separate opaque/depth-correct held rendering. The material presets deliberately retain glass edges and visible liquid in the default economical mode.
