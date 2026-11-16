# Independent actor / observer QA — 2026-11-16

Local target: `http://127.0.0.1:8765/`. Baseline renderer/protocol checkpoint `942ccb0`; final fresh-room corrective retest `fc072af`. Chrome157.0.8103.78, one owned browser at a time, two full WebGL clients maximum, native PeerJS/WebRTC. Root's later hip-fire pitch helper change was **not** included in this lane's browser retest.

## P1 found and corrected locally — E drops a carried item at the hood

Baseline: hold phone, aim at hood until `hood.target === true` and the visible E hint offers switching it on; press native E. Phone became unowned, observer removed the phone prop, hood remained level0. `handheld` handled E as a drop before the hood handler. Evidence: `animation/hood-phone-result.json`, `hood-phone-repro.json`.

Root added an injected world-interaction capability. Fresh boot at `fc072af` **passed**:

- Phone stays owned during native E; hood0→1; observer's actual left wrist reaches **0.729 m** from its previous position; phone remains attached to the right wrist.
- Newspaper stays owned during native E; hood1→2; actual left-wrist reach **0.393 m**, newspaper retained.
- Q still releases each item. Native armed door E still works. No page errors.

Evidence: `animation-final-verified/check-phone-hood.json`, `check-paper-hood.json`, corresponding `*-native-E-hood.json` joint frames. No unresolved P1 was found in this avatar lane after this retest. This is local proof; publication and production acceptance belong to root's final integration run.

## Actual observer evidence

All measurements below read named nodes in the **real other client's scene**: head/body, shoulder/elbow/wrist, hip/knee/ankle, gear/grip/muzzle/page. No `createAvatar` gallery substituted for a client; no direct `avatar.update`, joint-transform writes, authority edits, fake RTC or teleport. Observations distinguish accepted state from actual node motion. Native controls drove weapons, look, locomotion, pickup/use/page/drop and doors/hood. Seating used the real UI module's `seats.sitOn()` with authority reach/path/occupancy validation; guest phone claim used a legitimate authority request and is labeled separately.

| Behavior | Independent result |
|---|---|
| Four weapons draw / ADS | Native2/3/4/5 and RMB. Observer aiming reached1. Actual right-wrist shift **0.25–0.36m**, shoulder quaternion changed. Previous gear replaced; final1 removed it. |
| Four weapons fire | Native LMB; canonical accepted shot/ammo decrement, actual recoil wrist travel **0.013–0.024m** and visible muzzle-flash frames for every weapon. Rifle native hold produced multiple shots and stopped on release. |
| Four weapons reload | Native R after local busy state allowed it. Pistol/rifle/shotgun accepted immediately; first bolt R was too early in its local cycle, then a native retry after idle passed. Magazine/reserve changed and actual supporting-hand motion occurred. Do not count the early ignored R as an application failure. |
| Walk / run | Native W, Shift+S. Actual root displacement and alternating arm/hip/knee motion; run produced greater hip/knee excursions than walk. |
| Jump / land | Native Space. Observer root rose **0.432m**, actual hip/knee angles changed, canonical jump/land cues arrived, root returned to0. Guest-as-actor representative jump also rose0.430m. |
| Look | Native drag changed canonical yaw/pitch and actual head quaternion (up/down displacement in quaternion components ~0.166). Seated native look changed head orientation separately from seat/body yaw. |
| Phone carry / use / Q | Native E pickup and ArrowDown/wheel use; actual external phone appeared, use cue moved the hand; ownership persisted during carry. Q removed external prop and freed item. |
| Phone seated / stand | Real stool sit via UI module; hips/knees changed while phone stayed in hand. Native look and Space stand preserved held item and world view: yaw5.779/pitch0.249 before/after within network rounding. |
| Newspaper pickup / page | Native E/ArrowDown. Actual newspaper prop and turning leaf. Final frame set captured **8 visible page-leaf samples** and changing page quaternion. This verifies page animation, not readable newspaper text. |
| Newspaper seated / stand | WC and stool via real UI module; newspaper retained. Outside-paper native drag changed seated view; Space preserved yaw/pitch and item. Q released it. |
| Door / hood interaction gestures | Native armed bath door E toggled both directions; accepted `use` cues and actual reaching arm motion. Native held-phone / held-paper hood E passed as described above. |
| Both role directions | Guest phone claim/use/Q, guest jump, guest draw/RMB/LMB all observed through host's actual scene. Guest phone claim was a legitimate in-reach authority action rather than native pickup aiming. |
| Fresh late observer | Closed the old guest before opening a fresh guest. Current newspaper+stool+head-look state initialized correctly. All sampled named node world positions and quaternions matched the settled pre-join observer **exactly**; gear and grip matched. Body height0.62m matched the stool. |

Across **593 final corrective-retest joint frames**, maximum right-wrist/prop-grip separation was `1.12e-16m`; upper-arm length deviation from0.25m was `1.12e-5m`, forearm deviation from0.245m `9.58e-6m` (positions rounded to5 decimals in evidence). These measurements concern renderer bones and attachments; they are independent of the authority snapshot passing by itself.

Evidence directories:

- `output/independent-qa/gameplay/animation/`: original broader run, per-action joint frames, original P1, successful bolt reload retry, both role directions, WC/newspaper and first late join.
- `output/independent-qa/gameplay/animation-final-verified/`: fresh corrective test, all checks passed, `core-completed.json` reports47 steps /empty failed list; `independent-measurements.json` contains the aggregate calculations.
- `animation-final/` is an earlier corrective attempt with a QA-route assumption failure: it assumed the bathroom door started open, two E toggles ended closed and blocked the paper route. Those failed checks were **not** credited. The final executed script observes actual door state and ensures it is open before entering. Dragging inside the large newspaper DOM also scrolls it by design; final look input starts outside that rectangle.

## Visual review and limits

A real fresh observer's seated-newspaper frame was inspected independently and by root: figure scale/placement in the kitchen, head, bent arms and seating were visible. Newspaper was partly occluded by torso/shoulder, so this frame **does not establish readable newspaper text or screen content**. Precise prop/grip/page proof comes from actual renderer nodes above. One final phone-hood screenshot faced away from the actor; it was explicitly excluded from visual acceptance. Initial frames had panel/door occlusion and were not used to claim complete grip readability. All temporary screenshots were deleted after review.

This lane does not independently establish: every roster appearance in-world, all four weapons at every pitch/hip-fire muzzle alignment after root's later helper change, every seat class, all carried-item door gestures, full TV/laptop audio/video behavior, every life-module animation, mobile input, ten simultaneous rendered clients, or every catalog prop variant. Whole-catalog destruction still has the boundaries in [qa-independent-gameplay.md](qa-independent-gameplay.md). Root's gallery/unit tests and final ten-client production lane remain separate evidence.

## Reproducible default scenario and cleanup

Portable **actually executed** script: [tools/qa/multiplayer-avatar-e2e.mjs](../../tools/qa/multiplayer-avatar-e2e.mjs). Its default is the targeted phone/newspaper hood, native doors, seated look/Q and real late-observer scenario, not a claim to replay every broader baseline action. It uses existing Playwright through `PLAYWRIGHT_MODULE` or ordinary import, `QA_URL` defaults to local8765, writes bulk evidence under ignored `output/`, performs no installation, has a20-minute deadline and `finally` closes its own browser. No absolute user path appears in the tracked source. `node --check` and `git diff --check` passed.

Resource ledger, sequential (never overlapping): first interactive Node99986/session50238; first corrective default Node19059/session62759; final verified default Node21557/session41428. Every owned Chrome closed. First interactive driver printed CLOSED but retained stdin; no Chrome children remained, then its exact Node PID was terminated gracefully. Default runs exited naturally (failed QA route exit1, verified retest exit0). All three PIDs were absent at final check. Post-close `janitor.sh --ram` census is saved with final evidence. Own disposable helper count returned to zero; root's8765 server and other owners' resources were untouched.
