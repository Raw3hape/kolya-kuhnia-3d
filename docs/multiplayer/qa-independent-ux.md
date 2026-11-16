# Independent UX QA — published production

Final animated release/capacity evidence and the final production readiness fix are recorded in [qa-final-production-capacity-ux.md](qa-final-production-capacity-ux.md). The dated baseline findings below are preserved.

2026-11-16. Target: https://kolya-kuhnia-3d.vercel.app. Chrome 157 headless, real WebGL and WebRTC, isolated host/guest browser contexts. Desktop 1440×900; touch emulation 390×844 and 844×390. At most two WebGL pages in this lane. Main interactive run: 11 min 23 s.

I did not read `VALIDATION.md`. I began with the visible UI, then used read-only `__kitchen` telemetry to measure movement, room state and weapon counters. No runtime files or deployment were changed. Browser screenshots were visually reviewed, then removed as temporary captures.

## Findings

### UX-01 · P1 · Landscape settings panel covers firing controls

1. Enter a room as a guest at 390×844.
2. Open **Прогулка и игры → Оружие**, choose **Автомат**, close the panel.
3. Rotate to 844×390.
4. Tap **Выстрел**.

The settings panel opens on the right, covering jump, fire, aim and ammunition controls. In the reviewed image the panel occupied approximately x=452–830, while fire occupied x=748–824. A real touch action failed because `aside#panel.open` intercepted pointer events. The joystick also overlaps the minimap. This blocks the main playing action after an ordinary orientation change. Manually hiding the panel is the available workaround; I did not verify that workaround in this run.

The same interaction was reproduced after a sequential late join with **Пистолет** selected. The guest remained connected, and the host's changed floor material remained present. This is a layout/input overlap, rather than a lost multiplayer connection. Likely owner: responsive panel layout and touch-control visibility.

### UX-02 · P1, corroborated by separate gameplay lane · Repeated uncaught runtime exception

The full run recorded 943 uncaught `a.members is not iterable` errors: desktop guest 32, mobile guest 457, host 454. The first collector stored the message but not its stack or exact timestamp. This run alone cannot establish the first triggering action. Movement, screenshots, material propagation and door state were still measurable during the session. Treating the browser as error-free would be incorrect.

A fresh single-client host create → leave → five-second trace was attempted twice (15 s then 35 s room-create wait). Both attempts stayed at **Подключаемся…** before a room was created; the second also showed loader 93%, **Двор и город**. They therefore did not reach leave and did not reproduce the exception. `output/independent-qa/ux/trace-leave.json` records the latest failed setup and no page errors; the script captures stacks when a session can be created. Root owns diagnosis and fixes. Do not infer a successful fresh reproduction from the main-run error count alone.

After my own run, the separate gameplay lane reproduced the leave failure and captured `hunt.js:79:14054 → hunt.js:79:18641 → hunt.js:79:18419 [update]`; see `qa-independent-gameplay.md`. This establishes the lifecycle connection and P1 classification independently of my message-only collector.

### UX-03 · P2 provisional · Two cold create attempts remain pending

Exact method: launch a new isolated headless Chrome 157 browser with one 1280×800 page → open the production homepage → wait until **Играть вместе** is visible → dismiss **Понятно** if visible → **Играть вместе** → enter **UX trace** → **Создать комнату** → wait for **Выйти из комнаты**. There is no separate wait for all background assets before pressing Create.

Attempt 1 (09:33:15–09:33:36 UTC) did not expose **Выйти из комнаты** within 15 seconds. Attempt 2 (09:34:17–09:34:59 UTC) did not expose it within 35 seconds. Its captured DOM still showed **Подключаемся…** and the scene loader at 93%, **Двор и город**, with the slow-load notice. Neither attempt reached a connected session. The earlier full UX run created a room successfully, so this is not evidence of universal creation failure.

Cause is inconclusive. The trace collected uncaught errors, not request failures or timing; it has no pending/failing network URL evidence. Source inspection only suggests a possible wait before connection: the host flow awaits decor/furniture/paper readiness in `getRoomState()`. That is a diagnostic lead, not a proven network cause. Both browsers closed in `finally`; no retry remains running.

## Verified behavior

| Check | Result and measured evidence |
|---|---|
| Empty nickname | PASS on host and guest. Required field stayed invalid, native message `Заполните это поле.` |
| Long nickname | PASS. Typing 36 ASCII characters retained `ABCDEFGHIJKLMNOPQRSTUVWX` (24). |
| Unicode and markup text | PASS. Host `Хозяин Жółć 🐗`; guest entered `Гость 東京 <b>🐈</b>` and roster safely displayed `Гость 東京 b🐈/b`. No markup interpretation. |
| Invite copy and join | PASS. Clipboard received a production-origin room link with room/key; separate guest joined and both showed 2/10. |
| Guest editor access | PASS for visible UI. Guest tabs contained **Прогулка**, **Экспорт**; design/material/furniture/light modes were hidden; `canEdit=false`. Ctrl+Z/M/P were exercised without revealing editing UI. This is not a hostile-client authorization test. |
| F / Escape | PASS. Guest F and Escape opened the participants window; Escape closed it. The guest stayed in walk mode. |
| Modal input freeze | PASS. While the participants dialog was open, holding W and pressing 3 changed neither pose `(1.75,4.3)` nor weapon `none` nor shots 0. |
| Real keyboard movement | PASS. After closing the dialog, W moved z=4.3→3.553; key 2 selected `pistol`. |
| Host material propagation | PASS via actual material UI. `floorA` changed `carrea_miscela_nacar_60`→`carrea_medley_white_rock_60`; both clients reported revision 2 and the new material. |
| Two player bodies | PASS for the tested contact. W/S positioned the guest, then A was held for one second toward the stationary host. Ten authoritative samples retained minimum centre separation 0.4396 m; the guest slid along the body rather than passing through. This is one contact angle, not exhaustive collision coverage. |
| Door action propagation | PASS. Host E under the visible door prompt changed `bath_door=true`→`false`; both clients agreed within 400 ms. |
| Normal guest leave | PASS. Host changed 2/10→1/10; guest `active=false`, `canEdit=true`. |
| Touch walk | PASS. Real CDP touch start/move/end on the visible joystick moved `(1.75,4.3)`→`(1.716,2.877)`. |
| Touch weapon / fire / aim | PASS in portrait. UI selected **Автомат**; touch fire changed shots 0→1 and magazine 30→29; touch aim reached 1. Weapon and controls were visually present. |
| Mobile layout | Portrait PASS for tested controls, with header/minimap above and joystick/fire below. Landscape FAIL, UX-01. This is emulation, not physical-device proof. |
| Cancel connection to solo | PASS. With an unavailable room ID, UI showed **Подключаемся…**; **Играть одному** returned to `idle`, `active=false`, role null, dialog closed, room/key removed from URL. The apartment hash remained. |
| Sequential late join | PASS for edited material persistence. A later mobile guest received `carrea_medley_white_rock_60`. |
| Roster / zero-score display | PASS. Both nicknames, host badge, different assigned appearance labels and 0-point rows were visible in the participants window. Positive-score changes belong to the gameplay lane. |
| Gallery of ten characters | PASS. Published `/characters.html` rendered ten distinct 3D bodies, clothes/accessories and nameplates. Count was ten; all ten were visually reviewed in one 1440×1080 capture. |

## Not tested in this lane

- Walking into a closed door and traversing every doorway. Door toggle replication was tested.
- In-room nameplate readability and avatar animation. An attempted camera framing showed a nearby wall; the gallery is verified separately and does not prove in-room readability.
- Positive-score propagation, shared enemy kills and destruction convergence: separate gameplay lane.
- More than two full clients, ten-player room capacity, reconnect across different physical networks.
- Physical phones, Safari, touch reload, all four weapon variants, prolonged automatic fire.
- Closing via X during a live in-flight join. The **Играть одному** cancellation path was tested against an unavailable room.

## Reproduction and evidence

- `output/independent-qa/ux/results.json`: compact measurements from the executed interactive run.
- `output/independent-qa/ux/qa-ux.mjs`: consolidated standalone UI/telemetry reproduction, syntax checked. It has not been rerun end-to-end after consolidation. Set `PLAYWRIGHT_MODULE` to an existing package; it installs nothing. Browser always closes in `finally`, deadline 12 minutes. Screenshots are temporary unless `QA_KEEP_SCREENSHOTS=1`.
- `output/independent-qa/ux/trace-leave.mjs` and `trace-leave.json`: separately executed fresh lifecycle trace.
- `output/independent-qa/ux/resources.md`: owned-resource lifecycle.

Main browser closed in `finally`. The interactive Node driver retained its stdin handle after browser close; its exact owned PID was terminated gracefully and exit verified. Other lanes' browser processes and the user's applications were left untouched.

## Fix retest — 2026-11-16, 09:47:26–09:48:04 UTC

Target: **http://127.0.0.1:8765/**, root's existing server, current local fixes. This is local regression proof; production was not redeployed or retested. Original production findings above are preserved.

One newly owned Chrome 157 headless browser, two isolated full WebGL contexts at most, 37.6 seconds total, eight-minute hard deadline and `finally` close. The script entered the host and guest through the UI, selected **Автомат** through the guest weapon panel, then used actual touch taps. Read-only telemetry measured shots, ammunition, aim, jump height and lifecycle state. Screenshots of landscape, portrait after return and desktop editor were visually reviewed.

| Retest | Actual result |
|---|---|
| Portrait 390×844 → landscape 844×390 while guest walks | **PASS.** Panel stayed closed and slid outside the viewport (`left=854`); firing, aim and jump remained visible and touchable. No `aside` interception. |
| Landscape touch actions | **PASS.** Shots 0→1; magazine 30→29; aim 0→0.9993; jump peak 0.4123 m. |
| Rotate back to 390×844 and repeat | **PASS.** Panel stayed closed; shots 1→2; magazine 29→28; aim 1→0; jump peak 0.4261 m. |
| Desktop editor | **PASS.** Host material tab opened; **Скрыть панель** hid it; **Панель** reopened it. Design tabs remained available. |
| Guest leave → solo for five seconds | **PASS.** `active=false`, `status=idle`, role null. No uncaught errors. |
| Guest rejoin existing host → five seconds | **PASS.** Connected again in 613 ms; active guest walk restored. No uncaught errors. |
| Host leave → solo for five seconds | **PASS.** Host `active=false`, `status=idle`; guest received closed-room state. No uncaught errors. |
| Entire retest | **Zero page errors**, including no `a.members is not iterable`. |

UX-01's firing blockage and UX-02's tested leave paths are resolved in this local run. The landscape joystick still visually overlaps the minimap; this remaining layout issue does not cover the firing controls. Seating, physical phone rotation and published production behavior were not part of this fix retest.

Residual map detail, from the reviewed 844×390 image: `.kw-joy` occupied approximately `(20,212,114,114)`, and `#kw-dock .km` approximately `(16,171,182,204)`. Exact minimap DOM bounds were not collected. The joystick covered the left central part of the plan; it stayed intact above the map. Read-only CSS inspection agrees with the layering: joystick z-index 5, dock z-index 4; landscape at 844 px uses the 180 px map plus borders, while the 130 px map applies only up to 800 px. This is map occlusion, not observed joystick blockage. Landscape dragging was not exercised in this retest; its fire/aim/jump actions were.

The earlier cold-create hang did **not** reproduce locally. The first launch button appeared at 1.217 s. After **Создать комнату**, the client initially remained `idle`, reached `connecting` at 1.093 s, and `connected` at 2.106 s. This separates approximately 1.1 s before transport start from approximately 1.0 s of transport setup. Guest join took 508 ms and rejoin 613 ms. PeerJS WebSockets opened on `wss://0.peerjs.com/peerjs`.

Exact pending-request snapshots were collected: before Create, `/api/scores` was pending for 383 ms and `/favicon.svg` for 3 ms. At connected state, the only pending request was `http://127.0.0.1:8765/api/scores`. It returned 404 on the local static server and remained in the request tracker until close; the room still connected. The retest recorded no asset or PeerJS request failure explaining the earlier production cold-load hang. A guest scores request and YouTube logging request were aborted during navigation. These are reported separately from room readiness; UX-03's production cause remains inconclusive.

Reproduction: `output/independent-qa/ux/fix-retest.mjs`. Measurements, error collector and exact request URLs/timings: `fix-retest.json`. The browser closed in `finally`; process lookup found no UX retest driver. Temporary screenshots were deleted after review. Root's server and other agents' resources remain owned by their original sessions.

## Minimap geometry retest — 2026-11-16, 09:55:08–09:55:19 UTC

Target remained local `127.0.0.1:8765`. One full touch context entered a host room through the UI and selected **Пистолет**. A setup attempt first hit the late tutorial `#coach` over the portrait fire button; it was closed in `finally`. The final 11.1-second run explicitly dismissed that tutorial through **Понятно**, then tested the requested geometry. Runtime source was not edited.

**PASS** for `390×844 → 844×390 → 667×375 → 390×844`. Every size had zero rectangle intersection between `.km` and `.kw-joy`, zero intersection with `.kvm-fire`, and the complete map stayed inside the viewport. Actual touch taps collapsed and expanded the map; `elementFromPoint` confirmed its fold control was reachable. Actual joystick gestures moved the player 0.53–0.57 m per step, and real fire taps changed shots 0→4 and magazine 12→8 across the sequence. The settings panel remained closed. No page errors.

| Viewport | Exact map bounds `(x,y,width,height)` | Joystick bounds | Map/joystick horizontal gap |
|---|---|---|---|
| 844×390 | `(148,171,132,150.296875)` | `(20,212,114,114)` | 14 px |
| 667×375 | `(148,170,132,150.296875)` | `(20,151,114,114)` | 14 px |
| 390×844, initial and returned | `(12,170,132,150.296875)` | `(20,620,114,114)` | Separate vertical areas |

Screenshots at both landscape sizes were visually reviewed: map beside the joystick, firing controls clear. The two images were then deleted. Script and all precise rectangles are in `output/independent-qa/ux/map-fix-retest.mjs` and `map-fix-retest.json`; `map-fix-attempt1.json` preserves the tutorial setup interruption. Browser closed in `finally`, driver exited, own helpers returned to zero. Production smoke is a separate pending check after publication.

## Production fix smoke — 2026-11-16, 10:22:02–10:22:38 UTC

**PASS for the tested fixes after actual guest walk readiness.** Target: https://kolya-kuhnia-3d.vercel.app/. Deployment receipt supplied by root: **`dpl_7SJd8VdX9YwSsk5qcSbChnoXU1RT`**, READY, source **`b81ca6c14da36822bb3c1b9dd61f240d417c30bd`**. New animation work was still local and is **not** claimed as published or tested here.

One isolated Chrome stack, at most two full WebGL pages; real native lobby Create/Join, copied invitation, guest 390×844 → 844×390 → 390×844, then real fire/aim/jump touches. Four-minute browser deadline, 90-second preparation/readiness allowance. Final successful run lasted 35.7 seconds.

| Production check | Measured outcome |
|---|---|
| Cold host Create | **PASS, 4.057 s.** At 2 ms: client idle, **Готовим квартиру…**, cancellation visible. At 3.052 s: **Подключаемся…** / connecting. At 4.057 s: connected. |
| Guest Join | **PASS.** Transport connected in 901 ms; apartment applying / walk-not-yet-active lasted another 1.710 s. The mobile rotation test waited for `walk.active && !multiplayer.applying`. |
| Active walk → landscape | **PASS.** Panel closed; exact map `(148,171,132,150.296875)`, joystick `(20,212,114,114)`, fire `(748,230,76,76)`; map/joystick and map/fire intersection zero. Map inside viewport, fold hit-test reachable. |
| Landscape touch actions | **PASS.** Magazine 30→29, shots 0→1, aim 0→1, jump peak 0.4293 m. |
| Back to portrait, repeat | **PASS.** Magazine 29→28, shots 1→2, aim 1→0, jump peak 0.4272 m. |
| Guest leave → five seconds solo | **PASS.** `active=false`, idle, role null; zero errors. |
| Guest rejoin → five seconds | **PASS.** Transport 1.722 s; walk ready immediately; zero errors. |
| Host leave → five seconds solo | **PASS.** Host idle, guest receives closed state; zero errors. |
| Entire successful run | **Zero uncaught page errors, zero HTTP responses ≥400.** Third-party YouTube requests aborted during navigation; no game-asset or PeerJS failure explained a cold-create hang. |

Cold-network evidence is retained with phase timing and exact pending URLs. At Create, HDR metadata `textures/hdri/day.json?v=91174df18f` and `/api/scores` were pending briefly; no request remained pending when transport entered connecting. This smoke did not reproduce UX-03's original production hang and did not impose the old 15-second cutoff.

The first attempt exposed a separate readiness transition: a guest was transport-connected while the apartment was still applying (`walk=false`, background loading). Rotating at that moment opened the project-mode panel, and it remained over fire when walk subsequently began. Its result is preserved in `production-smoke-attempt1.json`. The successful smoke repeated with genuine walk readiness before rotating. Root subsequently prepared an additional **enter-walk/seat panel-close guard** locally; that guard and deliberately rotating **before** guest walk readiness require the final animation deployment retest and are not covered by source `b81ca6c` proof here.

Script: `output/independent-qa/ux/production-smoke.mjs`. Final data, deployment/source receipt, errors and request timing: `production-smoke.json`. Landscape and returned portrait screenshots were visually reviewed; all four temporary production captures were deleted. Both attempts' browsers closed in `finally`, foreground drivers exited, exact process lookup empty, janitor --ram read. Root's local preview was left running for its avatar work.
