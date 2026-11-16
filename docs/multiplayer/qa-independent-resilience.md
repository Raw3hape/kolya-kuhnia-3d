# Independent multiplayer resilience QA

Date: 2026-11-16. Target: `https://kolya-kuhnia-3d.vercel.app`. Lane: capacity, networking, identity, permissions, lifecycle. The reviewer did not read `VALIDATION.md` before producing these results and did not edit runtime code or deployment.

## Current conclusion

The native browser transport/authority fixture has 17/17 passing checks; the additional network fixture has 6/6 passing checks. The final ten-full-game-pages run has 18/18 passing capacity/lifecycle assertions. One P1 was independently reproduced: repeated `a.members is not iterable` after leaving multiplayer, also observed by the other review lanes. Its fix belongs to the parent lane and was not deployed during these baseline runs.

## Independently observed PASS

| Area | Observation |
| --- | --- |
| Native authentication and nickname | Real PeerJS signalling, native Chrome WebRTC and production Worker joined host+guest. Control characters and angle brackets were removed; Cyrillic and emoji remained. |
| Guest authority | Guest `apartment`, `geometry`, `clear`, `ambient`, direct `score` and unknown actions all returned negative results. Host apartment, revision, epoch and guest score remained unchanged. |
| Invalid movement/replay | NaN and infinities did not produce nonfinite player coordinates. A repeated input sequence advanced once. Huge displacement and time values moved the guest about 0.46 m, within the authority budget. |
| Rate limit | Two hundred actions in small native channel bursts returned 113 accepted and 87 explicit `rate_limited` results in the final protocol run. |
| Shot replay | One accepted shot produced exactly one effect and decremented pistol ammo once. Repeating the same shot ID had no second effect; the rejected replay request settled through the six-second client timeout. |
| Bounded request failure | A malformed nonfinite shooting request returned a negative result within 1 ms in the final protocol run. A transport queue flood rejected all 200 pending requests and resumed the same guest in about 0.71 s. |
| Item release | Guest claimed the authoritative phone in the fixture. Closing its real data channel released the item at the host in 4 ms. |
| Identity on actual reconnect | Closing the native guest data channel automatically resumed the same ID, name, avatar and guest permissions. Additional fixture earned 700 real authoritative points, then preserved all 700 after reconnect. Empty world-surface traces make this a persistence check, not a 3D shooting check. |
| Heartbeat loss | Synthetic suppression of outgoing heartbeats evicted host-side presence in 6.5 s. After restoring heartbeats, the client watchdog established a new native channel and fresh snapshots with the original ID, avatar and 700 points. |
| Host identity forgery | A different ECDSA invitation key was rejected over native WebRTC. |
| Reserved PeerJS identity | A remote PeerJS peer named `local` never opened an accepted game channel and was not added to the host roster. |
| Room isolation | A room A resume token copied into room B storage produced a different guest ID in room B and did not grant host permission or room A state. |
| Graceful/hard departure | Explicit leave removed host-side presence in 4 ms. Closing the guest page removed it within about 6.52 s, consistent with the authority watchdog. |
| Host stop / recreation | Host leave delivered terminal `closed` to the guest in 3 ms. The same client then created a fresh one-player room with new apartment state. |
| Older snapshot | A synthetically injected older full frame did not roll back accepted state. The decoder forced a bounded native reconnect and the guest resumed fresh sequence 350 after sequence 317. This is a packet-injection simulation, not naturally reordered reliable SCTP traffic. |
| Queue isolation | A guest-side native send queue flood caused bounded request rejection and reconnect while the host stayed connected. |

## Full 3D capacity and lifecycle

Final run: **18/18 assertions PASS**, 09:42:05–09:43:21 UTC. One installed Chrome 157 browser, one context, original production game pages at 640×360 and eco quality. No scene, gameplay or transport was mocked. Host creation and all guest admissions used the original lobby UI. Original production asset loading continued in the background.

| Check | Actual observation |
| --- | --- |
| Ten complete participants | All ten original game pages had the same ten distinct IDs and ten unique avatar slots. Every scene had nine actual remote `player_*` avatar groups with child geometry, and nonzero renderer calls. |
| Live updates | Host snapshot sequence advanced from 711 to 911 in 10.004 seconds: 20 snapshots/second. |
| Eleventh full game page | Original lobby received `full` and showed `В комнате уже 10 игроков.` Host roster remained at ten. |
| Explicit leave / return | Presence removed in 17 ms; same tab rejoined with its original ID, name, avatar, score and guest permission. |
| CDP lifecycle | An eight-second CDP `frozen` state did not evict the active WebRTC guest on this Chrome build. After activation it retained its identity and ten-player state. This is narrower than mobile OS suspension. |
| Hard page close | Authority removed the guest in 6.575 seconds; host scene reduced to eight remote avatars with nine active players. |
| Host stop | All eight remaining guests became terminal `closed`, deactivated the multiplayer adapter and removed all network avatars within 28 ms. |
| Asset timing | Initial full run cold host admission completed in 25.9 seconds, guests in 2.4–5.3 seconds. Repeat host admission completed in 2.9 seconds. The pending external module was jsdelivr `three-mesh-bvh`; no sustained host-connect stall was reproduced by this lane. |

The first full run also passed ten-client convergence and eleventh rejection, but its host-stop observer timed out. That observer synchronously wrote the growing result JSON on every repeated baseline UI error. The final run aggregates identical errors instead; all eight guests then closed in 28 ms. The initial timeout is retained in `capacity-results-run1.json` as an inconclusive instrumentation-heavy attempt, not reported as a separately confirmed transport P1.

Temporary 640×360 host screenshots were visually inspected: the original apartment canvas, lobby count `10 / 10`, named avatar roster and production navigation UI rendered. Screenshots were removed after this written report.

## P1 reproduced: multiplayer leave triggers unhandled hunt UI errors

Steps: create the production room, join guests, then call the original multiplayer client's `leave()` for a guest or host. The lobby exit uses this same method. After ordinary guest leave, the browser repeatedly raises `a.members is not iterable`; after host stop, additional guests raise the same error.

Final full run: nine occurrences across five guest pages. First full run: 5,867 repeated occurrences while the heavier error observer remained active. No different JavaScript error kind was observed. Transport assertions passing does not clear this runtime error. Parent lane is responsible for fixing it and checking the published result.

## Source review: cold host preparation can wait without a network timeout

This is a concrete code risk, not a claim that it caused the separate UX lane's 15/35-second observations. `site.js` first-view terrain images used `TextureLoader.load(url)` without an error callback, then resolved each readiness promise only from `texture.onUpdate` (GPU upload). A failed image, or an image that never receives a drawn GPU upload, cannot settle that promise. `main.js` waits `context.ready` before `roomReady()`. Background decor and newspaper readiness wait `afterRoom()`, and `session.roomState()` waits them before the lobby calls `client.create()`.

Consequently the client's 18-second network connection timeout does not cover this preparation stage, and the lobby can remain busy without starting a connection. `loading.retry()` retries rejected loads but does not impose a deadline on a never-settling load. The parent lane is fixing image readiness settlement and adding bounded, cancellable room preparation. A separate controlled failed-texture browser check is required before claiming the fix works.

### Independent local fix verification

The parent supplied the local patch at `http://127.0.0.1:8765`; this lane then ran **7/7 checks PASS**, with zero page errors, using one original full game page followed by a separate small lobby fixture in the same owned browser.

- Intentionally aborted the original first-view `textures/site/256/grass.jpg` request. The actual full page reached `usable ready`, hid the loader and rendered within 9.73 seconds.
- Created a real native PeerJS/WebRTC host through the original lobby in 1.998 seconds after pressing create. The aborted terrain image did not deadlock room preparation.
- In the explicitly synthetic deferred-room fixture, imported the actual `createMultiplayerLobby`: button read `Готовим квартиру…`, status explained asset preparation, and `Играть одному` remained available before any client create call.
- Clicked the real solo button, then resolved the delayed room promise: zero rooms were created. A new keyboard Enter submission created exactly one room after its preparation resolved. Disposing a third pending preparation prevented a second late room.
- Imported the actual preparation helper in that browser; a deliberately never-settling task with a 20 ms configured deadline rejected in 21.8 ms with the retry message.

Evidence: `startup-negative-qa.mjs` and `startup-negative-results.json` in the lane output folder. The client used inside the small lobby fixture is a labelled call-count stub; the failed-texture full-game host check uses the original native transport. This verifies the local patch only and does not assert it was published. Browser ended closed.

## NOT TESTED / boundaries

- Separate physical devices, distinct external networks, strict symmetric NAT and TURN reachability. Same-Mac native WebRTC cannot prove these.
- A genuinely bandwidth-constrained remote WebRTC receiver over a long session. The tested native queue flood and synthetic heartbeat drop are narrower cases.
- Mobile OS background suspension and return, real device thermals and prolonged 10-player rendering. The actual ten-page network cadence measurement lasted ten seconds; total full run lasted about 76 seconds.
- Deliberate host credential theft, compromised browser extensions or an attacker already controlling the host page.

## Evidence and reproduction

Entry: `output/independent-qa/resilience/README.md`. Detailed assertions and timings: `protocol-results.json`, `network-extra-results.json`, `capacity-results.json`; matching scripts and bounded logs are in the same directory. All runs ended with `browserClosed: true`. No production state or source was changed by this lane.

Scripts use installed Chrome 157 and existing Playwright, install nothing, preserve tokens only in ephemeral browser storage, and close their owned browser in `finally`. Fixture tests intercept only their blank QA document; multiplayer modules, PeerJS signalling and host Worker are the original published assets.

P0: none observed. P1: unhandled hunt UI error on leave, reproduced above. Native transport/capacity checks pass within the stated scope; fixes and separate-network proof are separate gates.

## Baseline resource cleanup

All four final browser runs acknowledged `browserClosed: true`; all four recorded foreground Node process IDs were independently confirmed exited. The owned helper count returned to zero. Janitor RAM inventory and cleanup dry-run were saved in the evidence folder; shared MCP helpers and other lanes' new local-test browsers were left untouched. The local port 8765 server belongs to the parent lane and was reused without stopping it. No persistent server was started by this lane. Temporary review screenshots and the accidentally URL-encoded screenshot directory were removed after inspection.

Disk stayed above 54 GiB free. The final capacity run reported 57% memory free at ten participants and no swap growth. Overall machine RAM was not claimed restored to the earlier snapshot because the other independent lanes had resumed their local browser tests.
