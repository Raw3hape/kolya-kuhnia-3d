# Party QA · 2026-11-16

Feature contract: [party.md](party.md).

`npm test`: 117/117. `npm run build`: vendor integrity and static build pass.
Pure tests include exclusive ownership, spam rejection, five sips, throw collision,
late state restoration, disconnect, hookah range and actual ground below the balcony.

Real browser pass: Chrome, eco, one Mac, two full rendered clients connected
through real PeerJS/WebRTC. Host walked from hall to balcony with keyboard input.
Native E took a bottle; holding E consumed exactly one sip; four further clicks
reached five on both clients. Q broke the bottle at a shared collision point;
both clients rendered the break and shards. Hookah ownership/puff and vape
ownership/puff agreed on both clients, with local smoke on each.
Hookah also puffed while seated on the sofa (seat API selected the fixture).
Native pistol fire destroyed the same new island mug for both observers.
Representative balcony, crate, held bottle, lounge and smoke frames were inspected.

`tools/qa/party-ui-qa.mjs` adds ten bounded browser checks: prop pickup takes
priority over seating, seated right-mouse look works while carrying, smoke
shader renders, a late WebRTC guest receives current ownership, remote props
follow the animated wrist, and native mobile buttons emit smoke without overlap.
All ten pass locally with no application errors; every context closes in `finally`.
Set `QA_URL`, `PLAYWRIGHT_MODULE`, and `QA_OUTPUT` to repeat against a release.

Production `e1fcc5a`, `dpl_DoYwTraAPAxkQKeF1s9QbMLxXuSe`: all ten checks pass
at the public URL, including actual late guest and mobile tap. The first run
timed out waiting for the guest connection; a fresh full run passed. Its cause
was later isolated on `3fdbee3`: the guest's deferred PeerJS script exceeded
its ten-second loader timeout while apartment assets were loading. The small
first-party runtime now loads with high priority before `main.js`; its dynamic
fallback also requests high priority. An eleventh browser check confirms the
runtime exists before the first multiplayer action. General NAT/relay coverage
still follows the existing [transport contract](multiplayer/TRANSPORT.md).
The subsequent room-creation fix preserves already-rearranged item homes;
its transport contract is covered by the client handshake test.

Smoke has one draw, at most 180 pooled particles; bottle shards one instanced
draw, at most 72 fragments. The 24 target meshes share eight geometries and
one vertex-color material. Unchanged placement requests no new render.
These are budgets, not a measured FPS guarantee. Cross-network NAT coverage
and a new ten-player capacity soak were not tested in this feature pass.
