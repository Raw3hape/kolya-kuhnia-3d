# Independent browser QA harnesses

These run real production/local WebGL pages. They install nothing and use an existing Playwright package through `PLAYWRIGHT_MODULE` (package name or filesystem path). Set `QA_COMMIT` and `QA_DEPLOYMENT` to the release receipts and `QA_OUTPUT` to a fresh output directory so earlier evidence stays intact. Set `QA_URL` explicitly: the final harnesses default to production; the actor/observer harness defaults to local port8765.

## Final animated multiplayer / capacity

`final-production-animated-qa.mjs` is the actual executed composite harness from the final animation release. It requires explicit `--run` and release receipts, uses one Chrome stack, and closes it in `finally` after completion or ten minutes.

```sh
node tools/qa/final-production-animated-qa.mjs --run
```

Sequence: gallery static/play/pause/pagehide/back → close; ten full 640×360 eco games → canonical IDs/slots and real body fingerprints/joints → ten-second snapshot mean rate → native jump/hip look/ADS at every observer → eleventh rejection and natural A/C/B slot reuse → host stop/close capacity → two fresh mobile contexts and early rotation/readiness/leave/rejoin.

Hip look is accepted only after canonical pitch actually changes. Native RMB is tried first, with native LMB correction if required; there is no forced pose or synthetic authority action. Snapshot Hz is a mean; inspect the recorded maximum callback gap and do not infer frame FPS.

## Mobile weapon readiness only

`mobile-weapon-readiness-qa.mjs` is the executed final readiness harness. Set `QA_EXPECT_READY_CONTROL=1` for the current disabled-fire/HUD contract. It uses at most two fresh full pages and a three-minute deadline, then always closes its browser.

```sh
QA_EXPECT_READY_CONTROL=1 node tools/qa/mobile-weapon-readiness-qa.mjs
```

It observes draw/readiness transitions, native fire and the host's remote shot/flash, reload, early rotation and leave/rejoin. A temporary observational `renderer.render` wrapper reads the private first-person model scene without changing its render call or pose; it and its UI observer are restored/disconnected before page close. Source/model/authority code is never patched.

Results and short bounded pose traces are written to the selected output directory. Read PASS/FAIL records in JSON; the mobile diagnostic harness reports check failures in JSON rather than using them as its process exit status. Review representative screenshots and then delete them. Runtime/transport evidence is not replaced by a unit or syntax check.

Execution receipts and limits: [final production report](../../docs/multiplayer/qa-final-production-capacity-ux.md).

## Actor / observer interactions

`multiplayer-avatar-e2e.mjs` defaults to local port8765. Its executed default is the
47-step carried phone/newspaper hood, door, seating/look and late-observer scenario.
The broader four-weapon/locomotion observations were driven through its bounded
interactive mode; they are not all replayed by the default. See the exact scope in
[actor/observer report](../../docs/multiplayer/qa-independent-avatar.md).
