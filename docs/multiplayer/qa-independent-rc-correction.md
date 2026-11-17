# Independent RC correction review — 2026-11-17

Human entry: [RC gameplay](../rc.md). This receipt separates source/physics/asset
checks from actual rendered proof. The integrator owns browser runs and release.

## Confirmed defects in the previous version

- Packed `wheel_FL` was a mesh with a −90° Z bind rotation, while the runtime
  overwrote its quaternion with the Cannon wheel quaternion. Its native mesh axle
  therefore changed from the intended X axis to Y during gameplay. Correct-looking
  stationary authoring renders did not establish a correct animated rig.
- The body origin subtracted the chassis offset along world Y instead of the
  rotated local centre of mass. Pitch/roll could separate the visual body and wheels.
- The render pipeline used the field chase camera even though the player's body
  remained on the balcony. Testing only the body position accepted the wrong UX.
- Invisible radial limits stopped cars at 150 m although the visible field extends
  to Z −245. Survey grass gaps also produced hidden exclusions. The original
  allowed cells were connected at a 1 m sampling resolution; disconnected OSM
  islands were not the demonstrated root cause.

## Independent regression gates

- `tools/tests/rc-rig.test.mjs` reads the **actual packed GLB JSON**, including
  normalized quantized POSITION bounds. All 40 canonical wheel nodes must be
  neutral empty pivots, with static decoder/mesh transforms below them. Their
  centres, rolling radii, widths and X axle must match each design's authored SI
  layout. Body nodes are matched exactly through `vehicle.bodyNode`. The original
  published asset failed the empty-pivot and descendant-geometry checks.
- `tools/tests/rc-wheel-pose.test.mjs` observes actual Cannon output for all ten
  cars at rest and while steering, comparing wheel centres to raw authored sockets,
  checking axle directions, ground contact and distinct ownership. No shared layout
  conversion helper is used to calculate the expected result. **1/1 passed** after
  the physics correction.
- `tools/tests/rc-arena-independent.test.mjs`: **2/2 passed**. The open field at
  `[0,-200]`, `[-50,-160]`, `[35,-170]`, `[50,-210]`, the centreline and formerly
  excluded grass gaps are traversable. Source hashing and real solid/outside probes
  are checked independently of the perimeter renderer.
- `tools/qa/rc-correction-qa.mjs` instruments the camera actually passed to
  `renderer.render(mainScene, camera)`. Native pickup, throttle/steering, mouse
  look, optical zoom and exit must keep its eyes on the original balcony. It also
  compares real wheel world transforms before/after driving, requires visible spin,
  verifies the displayed perimeter's vertices and own-car marker, and checks the
  fixed-FOV controller overlay shares the same eyes. This script must be run against
  the final integrated asset; syntax validation alone is not rendered proof.

## Art review

The first staged Blender contact sheet visibly improves wheel wells, rims, treads,
windows, cages, racks and spotlights. Formula, buggy, jeep, van and pickup have clear
silhouette differences. Large contrasting hood numbers and a distinctive prototype
canopy improve recognition from the balcony more than additional tiny bevels.
The visual direction is detailed stylized RC toys; it is not photorealistic.

The initial source/asset review started no browser, server or Blender process.
The later independent network execution below used one explicitly owned temporary
browser, closed and verified at the end; it reused the integrator's preview server.

## Final independent network execution

`tools/qa/rc-network-correction-qa.mjs` against `http://127.0.0.1:8765/`:
**10/10 passed**, zero uncaught browser errors. Two separately rendered Chrome
contexts joined through real WebRTC. Both walked through the apartment and onto
the balcony with ordinary movement/collision; no network player was teleported.

- The final viewport camera passed to `renderer.render(mainScene, camera)` stayed
  at each driver's original balcony eyes during driving and looking. Offscreen
  mirror/probe cameras were excluded by checking `renderer.getRenderTarget() === null`.
- Authoritative bodies stayed fixed. Native mouse look changed accepted yaw/pitch
  and the observer's actual avatar head pose; the observer screenshot was inspected.
- The observer received the moving car and its real model projected inside the
  viewport (one measured frame: approximately 46 × 24 px). This projection check
  is not a guarantee that trees can never occlude a car; the own-car marker remains
  useful when foliage crosses the line of sight.
- Native **H** transferred that same controller to exactly one nearby friend.
  The recipient then drove the same car from their own original balcony position.
  Native **Esc** released the controller on both clients and removed driving HUD.

The first real transfer uncovered a separate manifest defect: four decorative
parked-car `InstancedMesh` batches were serialized using their template bounds at
the world origin, falsely blocking a clear handoff. Their exact stable IDs matched
the sedan/hatchback/SUV/van batches. The generic fix excludes instance draw batches
from the **atomic** object manifest; it contains no model names or coordinate
exceptions. The host's trusted exact world raytrace still handles actual instance
surfaces. The new regression verifies that cars parked 50 m away create no origin
blocker, while an ordinary nearby opaque wall still blocks. **44/44 focused tests
passed**, including the existing unknown-opaque-surface shot test.

Execution receipt: `output/playwright/rc-network-correction-independent/report.json`.
The corrected probe recorded no object, walking-proxy or wall hit between the two
friends. Screenshots were visually inspected and then removed as disposable QA
captures. The JSON receipt and small diagnostic text reports remain ignored outputs.

Cleanup: the script closed both contexts and its browser in `finally`; its Node
and Chrome PIDs were independently verified absent. Owned helpers returned from
one temporary browser to the opening baseline of **zero**. The integrator's preview
server and separate production QA were left untouched. Read-only janitor and cleanup
dry-run checks also completed; unrelated helper stacks were not terminated.

This proves two rendered clients on the same Mac/network, not ten rendered clients,
cross-network NAT/TURN coverage or physical-phone performance. The integrator's
separate 10/10 solo and final 4/4 staged mobile-emulation runs are complementary; they do not
establish those broader claims. Production deployment verification is a separate
integrator-owned gate.
