# First-person weapon aim

`web/js/weapon-aim.js` owns `AIM_NDC` (screen centre) for both `impacts.js`
gameplay rays and `viewmodel.js` presentation. Hip/ADS share the same target.
The reticle CSS is centred at 50%/50% of the full-screen canvas.

The hand scene uses its own FOV and can shift when the settings panel opens.
After that camera's final projection is set, the solver unprojects `AIM_NDC`,
then rotates the model's actual bore toward a point on this ray. The reference
distance is the existing weapon range; it is a presentation convergence point,
not an extra scene raycast or a change to damage/range/network authority.
The offset muzzle is included in the rotation, rather than using `lookAt` on
the trigger pivot. Animation/bob/sway move the hands, and the bore is realigned
before rendering. Recoil still moves the gameplay camera and pushes hands back.
Reload and bolt-cycle handling keep their authored animations and cannot fire.

GLB contract: `muzzle` local **+X** is the bore; `sight_front` is the point to
centre in ADS and `sight_rear` sets the eye distance. The solver reads the live
muzzle transform, including animated bones and scale. ADS position is computed
from the hold pose and bore, without per-weapon yaw/pitch or sight-height guesses.
Transforms reset each draw to avoid accumulating corrections. No continuous
render demand or per-frame world traversal is added.

Checks: `npm test` includes `tools/tests/weapon-aim.test.mjs` (offset/scaled and
animated axes, repeated solves, portrait/landscape, FOV and panel view offsets,
eye pose). `npm run build` checks and packages the browser modules.

Browser verification, 2026-11-16: all four GLBs, native weapon keys/RMB ADS,
native mouse look/W movement, automatic fire and recoil, reload recovery,
panel open/closed, 1440×960, 390×844 and 844×390. Bore convergence error below
0.001 CSS pixel in sampled ready poses; settled ADS front sight within 1 pixel.
107 tests passed; no browser page errors. Temporary frames are inspected, then
removed from ignored `output/playwright/`; they are not release assets.
