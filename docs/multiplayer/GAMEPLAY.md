# Shared gameplay adapters

Entry point: [README](../../README.md). Architecture: [ARCHITECTURE](ARCHITECTURE.md).

## Authority and rendering

`web/js/multiplayer/hunt-simulation.js` is pure simulation: no renderer, DOM,
wall clock or global random state. The host authority owns damage, animal IDs,
death, respawn, score and pose history. `hunt-regions.js` and `hunt-hitboxes.js`
are shared by multiplayer and the existing single-player hunt.

`createHuntSimulation({spec,site,plan,seed})` exposes `step(dt)`, `snapshot()`,
`restore(snapshot)`, `raycast(origin,direction,range)` and
`hit({origin,direction,weapon,range,playerId})`. Damage comes from shared
`WEAPON_RULES`; callers clip range against exact trusted world surfaces.

Animal IDs contain kind, pool index and spawn generation. Snapshots contain only
plain poses and health. Browser `hunt.setNetwork(true)` disables its local
random simulation and local XP. `applyNetworkSnapshot(snapshot, personalScore)`
interpolates poses; `applyNetworkHit(hit,{local:true})` shows the shooter's popup.
The corner HUD shows the authority's personal session score, without timed rounds
or a results dialog. Solo score is preserved while temporarily entering a room.
All weapons have `infiniteReserve`; magazines, reload duration and firing rate
remain authoritative. `refillMagazine` is shared with the solo viewmodel, and
wire ammunition values stay finite. See [play session](../play-session.md).

## Weapons and apartment damage

`viewmodel.setNetwork({shoot,reload,clear})` switches fire to requests. Recoil,
animation and predicted ammunition remain immediate; apartment damage waits for
the authority's approved event. Use `setNetwork(null)` to restore solo play.

- `collectNetworkObjects()` returns trusted host object bounds, material,
  canonical breakable unit and contained dependent unit IDs.
- `resolveNetworkSurfaces(origin,direction,range)` traces exact host geometry;
  guest impact claims are observations, never authority.
- `applyNetworkShot(event,{replay})` applies approved effects with deterministic
  fracture seeds and defers effects for assets not loaded yet.
- `reconcileNetworkDamage(effects,broken)` follows the bounded authority journal:
  evicted bullet holes and screen cracks lose their owned decal references;
  evicted retained window fragments disappear; only affected mirror textures
  are reset and replayed. Unchanged journals do not rescan or rebuild the scene.
  `viewmodel.networkDamage` exposes event/decal/pending counts for runtime QA.
- `applyBroken(ids)` enforces durable missing units after bounded journal
  eviction, including late assets; cracked mirrors retain their backing.
- `applyNetworkAmmo(map)` reconciles magazines and reserve ammunition.
- `clearHoles({remote:true})` applies an approved reset without requesting again.

`network-objects.js` assigns asset IDs at synchronous GLB attachment from the
authored decor part key and an immutable model-relative path. UUIDs, scene child
arrival order and furniture placement do not define object identity. A generic
loose-object policy covers every props model, loose semantic slot and bedroom
toy variant, including future models. `spec/break.json` refines materials.
Paper, cloth, foliage, wood, plastic, metal, ceramics, glass and fruit have
different fragment counts, weight/drag or impact sound.

Exact raycasts use the already-installed `three-mesh-bvh` when available.
Per-instance idle preparation preserves the geometry index (`indirect:true`),
skips animated meshes and never replaces global Three prototypes. Disabling
networking cancels preparation and releases owned acceleration structures.
`viewmodel.networkRaycasts` exposes preparation counts for runtime QA.

## Ambient apartment simulation

`life.setNetwork({authority})` keeps random schedules on the host. Guests mirror
`life.applyNetworkSnapshot(snapshot)`; the host publishes `life.snapshot()`
(`networkSnapshot()` alias) at the session's ambient rate. The snapshot includes
mouse pose/animation/death, tap flow timing and a bounded list of neighbour/bell events. Local sound preferences
remain local. Loading modules and GLBs apply the latest pending snapshot.

External combat is deliberately two-phase:

1. Host `life.traceExternalShot(request)` captures nearest mouse targets
   without mutation. Private trace data lets the authority clip surfaces and
   wildlife behind these targets.
2. After approval, `life.resolveExternalShot(approvedEvent)` invokes only the
   captured targets named by `ray.externalHit`. Private `completeExternal`
   derives scoring from `EXTERNAL_TARGET_RULES`; repeated kills cannot award twice.

Mouse IDs contain spawn generation. The [service level](../service-level.md) is a separate simulation owned by the same Worker.

## Beer and smoke items

`party-state.js` is the portable rules engine shared by solo and the room Worker;
`spec/party.json` owns positions, five-sip timing, hose reach and bounded lifetimes.
The authority accepts `party` commands (`take`, `sip`, `puff`, `throw`, `return`),
checks ownership/reach/cooldowns, and publishes `snapshot.party`. Only accepted
commands create observer cues; `players[].carried` chooses the hand prop. A player
can carry one party item or the existing phone/newspaper. Disconnect releases it;
a hookah hose returns when its holder moves beyond the configured length.

Bottle flight uses swept segments against the authority's trusted geometry and
breaks once. Party bottles use stable `party:<id>` units, with their own durable
state and timed replacement; they are excluded from the permanent apartment
`broken` journal. Late join restores the current item state. Leaving multiplayer
removes the adapter and restores the module's saved solo state. Authored furniture
anchors update homes through the owner-only geometry manifest.

## Verification

`node --test tools/tests/multiplayer-content.test.mjs` covers catalog-wide loose
object/book/toy inclusion, identity stability through loading/movement, seeded
simulation determinism, clipped and invalid weapon hits, one-time kill credit,
snapshot restoration and fracture RNG isolation. These tests do not replace
browser verification of multiple clients, WebRTC, animation, collisions or FPS.
