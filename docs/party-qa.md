# Party QA · 2026-11-16

Feature contract: [party.md](party.md).

`npm test`: 116/116. `npm run build`: vendor integrity and static build pass.
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

Smoke has one draw, at most 180 pooled particles; bottle shards one instanced
draw, at most 72 fragments. The 24 target meshes share eight geometries and
one vertex-color material. Unchanged placement requests no new render.
These are budgets, not a measured FPS guarantee. Cross-network NAT coverage
and a new ten-player capacity soak were not tested in this feature pass.
