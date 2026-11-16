# Observer avatar animation

Entry points: `web/js/multiplayer/avatars.js` (Three.js adapter), `avatar-pose.js` (pure pose solver), `avatar-rig.js` (metres and weapon presentation profiles), `action-contract.js` (shared authoritative action timing, owned by the room layer). Public preview: `/characters.html`.

## State and ownership

The room owns actor position/body yaw, occupancy, equipped weapon, held item, ammo, accepted actions and their start times. Observers receive those properties; the renderer derives joint transforms locally. No bone transforms or per-frame cosmetic commands are sent.

`avatar.update(state)` accepts:

| Property | Meaning |
|---|---|
| `time` | Interpolated room simulation seconds |
| `speed`, `grounded`, `verticalSpeed` | Locomotion presentation inputs; root translation stays external |
| `weapon`, `held` | Current canonical equipment; `held` is `phone`, `newspaper` or null |
| `aimPitch`, `aimYaw`, `aiming` | Look angles in radians; ADS weight 0–1. Seated body yaw remains aligned with its seat while the head can turn |
| `seated`, `seatY` | Seat occupancy and authored hip height |
| `action` | Latest accepted `{kind, at, duration, targetId?, target?}`; `target` is a world-space interaction point |
| `actionTime` | Elapsed **seconds**, clamped to `action.duration`; the solver normalizes this into progress |
| `reloading`, `reloadProgress` | Authoritative reload state and 0–1 progress |
| `shotAge`, `shooting` | Time since the current weapon's accepted shot and sampled firing flag |
| `interaction` | The active pickup/drop/use/page action, when present |

`session.js` samples this contract through `sampleAvatarAction`; equipment changes use the presentation boundary associated with the accepted cue. A late observer reconstructs the same current phase. The solver has no wall clock, global RNG, network writes, camera movement or physics updates.

There is one canonical `update` path. `createAvatar` also exposes `root`, `setIdentity`, `getMuzzleWorldPosition(out?)`, read-only `animation` diagnostics and idempotent `dispose`. Muzzle coordinates are cosmetic tracer origins; the room's accepted ray origin/endpoints retain their gameplay meaning.

## Rig and presentation

Feet start at y=0, forward is −Z, and the external root follows the room pose. Stable named nodes include `avatar_rig`, `avatar_body`, `avatar_head`, left/right `shoulder`, `elbow`, `wrist`, `hip`, `knee`, `ankle`, plus `avatar_gear`, `avatar_prop_grip`, `avatar_phone`, `avatar_newspaper`, `avatar_weapon` and `avatar_muzzle`.

- The head and its hairstyle/accessories rotate independently. Reading adds a downward bias while preserving look-pitch response; head yaw remains independent when seated.
- Arms use analytic two-bone IK with an outward elbow pole. Requested reach is clamped to anatomical length. Weapon foregrip offsets rotate with aim pitch. The right wrist owns every prop through `avatar_gear`; its explicit grip marker coincides with the hand, including newspaper offsets.
- Thighs, knees and ankles articulate separately. Walking/running use deterministic room-time gait with foot lift and sagittal leg IK; jumping tucks the legs, landing compresses the knees, and seat/stand cues blend authored hip height and knee flexion.
- Draw/holster, ADS, recoil/flash and all four reload styles are visible. Rifle/pistol magazines transfer to the free hand; the bolt cycles; double barrels break open.
- Phone pickup/read/tap/drop and newspaper pickup/read/page-turn/drop have separate gestures and hand-mounted props. During external door/hood/media use, the free hand reaches while the other retains the weapon or item.
- Holster/drop retain the departing prop only during the accepted transition, using `targetId` after the canonical inventory has changed. The solver never delays ownership or ammo rules.

All ten original silhouettes/palettes remain, with articulated palm/finger/thumb shapes, eyes/brows, cuffs and boot detail. Geometry is merged by moving segment and uses vertex colors. Hands have wrist articulation and shaped fingers; individual finger phalanges are not separately animated. Foot placement targets this apartment's floor and authored seat heights; it does not perform terrain/ragdoll simulation.

## Resource budget

At most 20 visible avatar drawables, including the name sprite, are asserted across all ten rigs and equipment. Prop geometry is created lazily and cached for six supported presentations; inactive props are detached. Disposal releases every cached geometry, owned material and label texture exactly once, while preserving Three.js's shared sprite geometry.

The public gallery uses one renderer and ten scissor views. It is static on first load. Preview animation uses one RAF, stops after at most 20 seconds, stops when hidden, and is disposed on pagehide; bfcache restore rebuilds it. It supplies demonstration actions through the same production pose API.

## Verification on 2026-11-16

`node --test tools/tests/avatar-animation.test.mjs`: **9/9 pass**. Coverage includes 300 deterministic sampled states, finite/anatomically bounded joints (including pole-aligned reaches), sit/jump/land/run poses, carrying/seated look angles, pitched foregrip contact, timed item/weapon cues, external use while armed/holding items, exact real-rig grip contact, muzzle behavior, draw budget and complete resource disposal.

A bounded real-browser smoke opened only `/characters.html`, one fresh profile/page/canvas. All ten models loaded, static default had no RAF, and there were no page errors or horizontal overflow. Each gun/phone/newspaper remained a descendant of `right_wrist` with measured grip error zero; muzzle coordinates existed only for guns. Seated knees measured approximately +1.654/−1.654 radians. The mixed-pose contact sheet was visually reviewed. The renderer/page/profile were closed, and both exact owned Node/Chrome PIDs were verified absent.

The coordinator performs the separate actor/observer gameplay and release verification. The gallery smoke proves rendering and local pose behavior, not remote-network coverage or ten full game scenes running concurrently.

## Design references

The rendering/simulation boundary follows the separate-scene/game-system organization discussed in the [official Three.js game guide](https://threejs.org/manual/pages/game.html). Deriving presentation from networked properties and action timing is informed by [Photon's animation synchronization guidance](https://doc.photonengine.com/fusion/v2/concepts-and-patterns/animation). The room-time pure solver and procedural rig are this project's implementation; these references add no engine or service dependency.
