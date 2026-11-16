# Independent observer animation QA plan

Prepared 2026-11-16 from current code paths; **not a test result**. Wait for root's source freeze before opening a browser. Implementation agents' screenshots/reported passes will not count as independent proof.

## Setup and evidence rules

Use root's local server, one owned Chrome, two full WebGL pages maximum. A host/actor and guest/observer, then reverse the actor/observer roles in the same session. Reuse both pages; fresh late join follows one page close. No fake RTC, no direct avatar.update calls, no authority mutations, no teleport/reach bypass. Native actor controls are first choice. A fallback must use the actual module/request path and remain subject to the same ownership, reach and ammo checks; label each such action.

Record three separate facts per action: **native input or legitimate action sent**, **observer received canonical state**, **observer's actual rendered hierarchy moved**. A changed snapshot alone cannot pass animation. Sample bounded world matrices/positions/quaternions from observer-rendered joints and props at 20–30 Hz through each transition, with 100–300 ms settling allowance for network/interpolation. Capture at most four representative temporary screenshots, inspect them, summarize and delete. State is independent from visual quality; one passing limb angle cannot establish a plausible grip or readable pose.

Identify the remote avatar through the observer scene's network-avatar root and remote slot/name/position; read implementation hierarchy only to identify joints/props. Never write their transforms. After freeze adapt the sampler to named head/neck/spine, shoulders/elbows/wrists, hips/knees/feet, and active prop/muzzle. Store world coordinates and local rotations. If joints are merged/unidentifiable, mark the joint assertion untestable and rely on explicit visual review for that aspect, without inventing a pass.

## Action matrix

| Actor action / trigger | Required observer behavior and independent measurement |
|---|---|
| Idle / no item (`1`) | Detailed avatar visible at proper scale; head/torso/limbs distinct, feet near floor, relaxed pose, no stale gun/phone/newspaper. Screenshot front and side where possible. |
| Native W/A/S/D, Shift and stop | Root translation matches shared position; alternating left/right arm and leg motion while moving; settles to idle after stop; no stride left running indefinitely. Walk and run cadence/amplitude compared. |
| Native mouse look / drag / pointer lock | Shared yaw/pitch changes match actor. Observer root yaw and independent head/neck look orientation change; head position pivots around neck, instead of translating whole torso or only gun. Test left/right and up/down at idle, moving and seated. |
| Native Space jump | Authority y/vy and observer root/body/feet rise, apex, descend and land. At least three distinct airborne samples; grounded height returns without persistent drift. No fake local jump animation if authority rejects input. |
| Native 2/3/4/5 and 1 | Each distinct weapon appears on observer and previous gear disappears. Actual prop/world transform and attachment near hand(s) verified; screenshot checks weapon detail, grip and direction. |
| Native right mouse aim down/up, for each weapon | Observer receives actual aim transition; shoulders/elbows/wrists/prop differ from hip-fire, barrel lines toward look direction, release returns to lowered pose. Record input held interval; do not substitute pitch changes for ADS. |
| Native mouse fire (pistol/bolt/shotgun) | Authoritative accepted shot and ammo decrement; observer has timely recoil/joint/prop movement and visible muzzle/tracer when intended, then settles. A dry click must not create a remote accepted-fire animation. |
| Native automatic hold and release | Several accepted rifle shots; repeated observer recoil/fire sequence lasts only during actual fire; no indefinite shooting after release. |
| Native R reload / weapon cycle | Reload accepted and ammo fills at end; observer reload-specific hand/prop motion when part of delivered behavior, with no phantom accepted shots. State and visual portions reported separately. |
| Phone E pickup, walk, look, scroll, Q drop | One holder only; world phone disappears on island, external phone prop appears and tracks hand. Arms/head read phone in standing and seated poses; page/media state is shared. Drop removes hand prop and restores island phone. |
| Newspaper E pickup, walk, pages, Q drop | One owner; prop visually reads as a newspaper, hands support it; observer sees reading pose and persistent carry while moving/seated. Page changes synchronized; drop removes prop and advances/restores shelf issue as designed. |
| Native E sit / seat UI module path when in reach | Authority seat occupied once; actual hips/legs/knees/feet and torso settle onto correct seat height. No feet buried deeply or hovering, no torso stuck standing. Test stool plus sofa/WC/chair/bed classes where reachable. |
| Sit while holding phone/newspaper; E/Space/F stand | Item remains with its legitimate owner, arms/prop continue reading pose; legs and hips use sitting pose. Stand returns to walk with item intact. Weapon eligibility matches actual gameplay rules, not stale remote gear. |
| Native door E / hood E / screen controls | Shared world object changes (door transforms, hood level/LED, media index), actor's delivered interaction gesture if implemented, and prop ownership remain coherent. State can pass while gesture is explicitly absent/untested. |
| Item/seat claim race and disconnect | One canonical owner and one actual carry/seated avatar; rejected second actor stays in original pose. Owner leave/disconnect removes avatar and releases claim after documented timeout. |
| Invalid/out-of-reach action / weapon while item held | Rejection does not animate a successful remote pickup/sit/fire; no double-equipped gear. |
| Fresh observer late join during carry/ADS/sit | Fresh renderer initializes to current canonical pose/prop with no transition from incorrect stale default. Then receives subsequent movement/drop/stand normally. |
| Room exit and recreate | Remote avatars/props removed, no orphan meshes; existing hunting exit fix retains clean solo updates. New session has no stale aim/fire/seat/held flags. |

## Placement and observation

First move the observer away from the shared spawn corridor so it does not physically pin the actor or obscure close shots. Keep a useful 2–4 m viewing distance and unobstructed view. Native movement remains collision-constrained; when a door leaf blocks a route, change the door using the legitimate in-reach action and navigate around it. Observer camera orientation may be scripted for framing from its real position; label this and leave actor/world authority untouched.

Action order minimizes navigation: idle/move/look/jump → each weapon/ADS/fire/reload → kitchen phone and nearby stool/hood → hallway newspaper and WC → other seat classes/room media → claim/disconnect/late join → exit/recreate. Repeat a representative weapon, carry, look, jump and sit sequence with guest as actor to cover both directions. Whole catalog variants and all separate props remain an additional destruction/registration matrix, not implicit avatar acceptance.

## Reporting

P0/P1 first with actor input, canonical observer state, actual joint/prop evidence IDs, visible result and reproduction. Then PASS / FAIL / NOT TESTED per matrix row, including the native-versus-canonical fallback distinction. Save bounded JSON and reusable scripts under `output/independent-qa/gameplay/animation/`; append independent results to `qa-independent-gameplay.md` after source freeze. Browser/server lifecycle and screenshot cleanup are part of finishing.
