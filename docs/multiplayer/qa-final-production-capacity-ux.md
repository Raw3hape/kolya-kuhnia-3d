# Final independent production QA — 2026-11-16

**Accepted for the tested scope.** Ten real game clients, articulated avatar replication and slot reuse passed on the animation release. The final production readiness patch then passed a separate two-client check. No additional ten-client run was performed for that UI-only patch.

| Evidence run | Exact source | Production deployment |
|---|---|---|
| Gallery + capacity + animated observers, 11:05:20–11:11:56 UTC | `63366357ecfefc43d4aac00f5cdd154ecffb0dfe` | `dpl_GRKpSLBXiLdE1B5KXuHM33xdk74H` |
| Final weapon readiness, 11:26:52–11:29:40 UTC | `6079117701723affbe6df7967b166719a530c199` | `dpl_2pfnW6GnaYNtWNeNLzXg6EfZVtaG` |

Target: https://kolya-kuhnia-3d.vercel.app/. Chrome 157, headless, one owned browser stack at a time. Capacity pages were real 640×360 eco WebGL clients using native PeerJS/WebRTC, with no mocked authority, forced poses or dropped snapshots. Native lobby inputs and actual keyboard/mouse/touch actions drove the tests. The source diff between the releases contains only `web/js/viewmodel.js` and the independent QA summary; avatar/network code was unchanged.

## Actual results

| Check | Result / evidence |
|---|---|
| Gallery static/play/pause | PASS. Ten distinct geometry/color fingerprints, real mesh-bearing head/elbow/knee groups, actual joint changes while playing and stable joints after pause. |
| Gallery lifecycle | PASS. Native navigation away disposed the old renderer/canvas and stopped play; Back restored ten models with exactly one canvas. Gallery closed before capacity. |
| Ten full clients | PASS. Every observer agreed on the same ten IDs and ten unique slots. Each scene contained nine real articulated remote avatars. |
| Model identity | PASS for every observer: root name and static body geometry/color fingerprint matched the gallery definition for the canonical slot. Weapons/nameplates were excluded from the body fingerprint. This checked 90 rendered remote instances, not 90 unique players. |
| Snapshot mean rate | All ten received **200 snapshots over about ten seconds**, mean 19.986–19.999 Hz. See performance boundary below. |
| Native jump | PASS at all nine other observers: canonical peak 0.435 m, rendered peak 0.4304–0.4349 m, with real knee changes. |
| Native hip look up/down | PASS. RMB drag/release actually changed canonical pitch 0→0.374→−0.174 rad. After idle settling, every remote muzzle's real world forward vector matched canonical yaw/pitch within numerical precision. No LMB fallback was needed. |
| Native rifle ADS | PASS at all nine other observers: canonical aim, real arm/elbow changes and settled muzzle direction matched. This was one gun, not a repeated four-weapon matrix. |
| Eleventh complete page | PASS. Native join received the room-full rejection; host remained at ten. Peak was eleven full pages, never twelve. |
| Meaningful slot reuse | PASS. A left slot 0; fresh C occupied 0; B left slot 3; A resumed the same ID/name/score on slot 3. All ten observers' actual model names and fingerprints matched the new canonical assignments, with no duplicate slots. |
| Host stop / lifecycle | PASS. Native host leave closed all active peers and removed all remote avatars. Five seconds later: no uncaught or console errors. All capacity pages then closed. |
| Cold mobile early rotation | PASS. Guest rotated before walk readiness, then entered actual walk with the panel closed. Map stayed within viewport and did not intersect joystick/fire; fold hit-testing was reachable. |
| Final readiness feedback | PASS on `6079117`. During draw: visible fire button disabled, `aria-busy=true`, `fireReady=false`, HUD **Поднимаем оружие…**. On readiness: enabled, `aria-busy=false`, note cleared. |
| Final native fire / remote effect | PASS. First enabled tap: shots 0→1, magazine 30→29. Further ready tap: 1→2. Host received the actual shot events and observed the remote muzzle flash in eight sampled frames. |
| Reload and rotation | PASS. Reload disabled fire and showed its note; portrait/landscape rotation preserved readiness. After reload, native fire worked. |
| Mobile leave/rejoin | PASS. Early rotation and ready fire worked again after rejoin, with a remote shot event. No uncaught page errors in the final two-client run. |

## Performance and evidence limits

The ten-client mean snapshot rate is **not a stable frame-rate or smoothness claim**. The largest measured callback gap was **2.524 s** under ten renderers, shared swap and instrumentation load. The same Mac/network hosted all clients; this does not prove cross-network latency or physical-phone performance. The crowded 640×360 host screenshot was heavily occluded by nearby players, so the nine-model proof uses actual scene geometry/joints, not a claim that all nine were simultaneously readable in that one image.

The 6 min 35 s composite run recorded 20 PASS checks and one genuine early-mobile-fire FAIL: the first tap left shots/ammunition unchanged. A narrow `6336635` followup confirmed fire after mount settling and remote effects; it did not reproduce an ignored tap. It did independently capture an enabled button and empty HUD note while the gun was still raising. Root then added explicit readiness feedback.

The local readiness test kept one diagnostic assertion FAIL: it required the first observed overlay render, while direct pre-tap DOM already showed disabled fire and the correct note. The raw result is preserved. Re-evaluating that captured DOM satisfied the corrected assertion; **no browser rerun is claimed for that correction**. The final fresh production run on `6079117` independently passed all six checks, including the initial readiness transition.

Not repeated here: all gameplay routes, all weapon variants, item/device interactions, physical iOS/Safari and different physical networks. Those are distinct from this bounded final capacity/mobile line.

## Reproduction and local evidence

- Executed portable harness: `tools/qa/final-production-animated-qa.mjs`.
- Executed final readiness harness: `tools/qa/mobile-weapon-readiness-qa.mjs`.
- Setup/scope: `tools/qa/README.md`. Both use an existing Playwright package; no installation or machine-specific dependency path is embedded.
- Local ignored raw/summary data: `output/independent-qa/ux/final-animated/{results,summary,cleanup-proof}.json`.
- Original readiness followup: `output/independent-qa/ux/mobile-ready/results.json`.
- Preserved local diagnostic failure and its data-only review: `output/independent-qa/ux/mobile-ready-local/{results,review}.json`.
- Final production six-PASS data: `output/independent-qa/ux/mobile-ready-production-final/results.json`.

Representative gallery, animation, capacity and mobile screenshots were visually reviewed. All eleven owned temporary captures were deleted after review/data extraction; no frame dump was committed.

## Resource handback

All browsers closed in `finally`; all foreground drivers exited. Capacity driver/session: PID31587 / exec40409. Narrow launch trees recorded and verified gone: 44869/44882/44888/44889/44890/44891/44897; 46979/46985/46990/46991/46992/46993/46999; 54876/54888/54893/54894/54896/54897/54904. No UX browser, watcher or server remains. Root separately stopped its preview servers.

Initial memory-pressure free percentage was 51%; ten-client observation 29%; final observed value 64%. Shared swap stayed allocated and was not touched. Root's final global helper audit belongs to shared application sessions; those helpers were not killed. Exact receipts and the distinction between owned resources and shared machine state are retained in `cleanup-proof.json`.
