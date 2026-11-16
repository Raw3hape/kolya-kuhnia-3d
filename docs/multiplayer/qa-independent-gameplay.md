# Independent gameplay and state QA — 2026-11-16

Target: https://kolya-kuhnia-3d.vercel.app, Chrome 157.0.8103.78, normal headless Playwright, real WebGL. One host and one guest rendered simultaneously; that guest was closed before a fresh third browser context joined. Native PeerJS/WebRTC, no mocked transport, no local server. Existing implementation validation was not read.

## P1 — Leaving multiplayer raises repeated hunting update errors

Evidence **LEAVE-01**, `output/independent-qa/gameplay/evidence.json`; bounded log `errors.log`.

Reproduction: create room; join another real client; play long enough for animal snapshots; leave as host. This lane invoked the public `multiplayer.client.leave()` method, the same client operation used by the lobby. Host became `idle`, guest `closed`. Four captured exceptions repeat:

```
TypeError: a.members is not iterable
hunt.js:79:14054 → hunt.js:79:18641 → hunt.js:79:18419 [update]
→ main.js:1:13751
```

The client update loop does not return cleanly to solo play. No claim that a visible freeze was independently measured. Root was notified immediately. No runtime source or deployment was changed.

## Passed live checks

| Check | Evidence | Result and limits |
|---|---|---|
| Independent UI entry | UI-01…05, JOIN-01 | Created room and joined through visible native lobby; both full 3D scenes rendered. |
| Four weapons | SCENE-01, WEAPONS-02 | Native number keys + mouse clicks fired pistol, rifle, bolt rifle and shotgun. Authoritative magazines decreased. |
| Empty magazine/reload | WEAPONS-02 | Shotgun 2→0; extra click did not add an accepted shot; native R restored 2 and reserve 24→22. Only shotgun dry/reload was fully checked. |
| Eight material types | MATERIALS-01 | Exact scripted aim from actual authoritative player position; real host scene ray traces; paper, wood, plastic, ceramic, glass, foliage, metal and fruit each broke. Authority and actual renderer `brokenIds` agreed on host and guest. |
| Cloth and toys | BEDROOM-02 | After native walking through hallway/bedroom, destroyed bedding cloth and cat-cloudy, figs-wow, figs-dota, camper-toy, bicycle-toy. Each named unit was broken in both authority state and both renderer modules. |
| Mirror | DETAILS-01 | Actual mirror `scene/8d4e07b4dcfc68f2` broke and replicated; subsequent shared state and late join preserved it. |
| Screen and bullet holes | BEDROOM-02, JOURNAL-01 | Exact ray hit bedroom laptop screen `decor:room2.bed.sagesund-160.3/7ceceab6835e8be8`; both clients reported one screen crack. Shared wall holes also present. |
| Phone exclusivity | INTERACTIONS-01 | Simultaneous real-client `claim` requests: exactly one succeeded. Media index 0→1 shared; native Q released phone for both. Claims were in reach; no teleport. |
| Seat exclusivity | INTERACTIONS-01 | Same stool simultaneous requests: one succeeded, other rejected. Shared occupancy; stand released it. |
| Newspaper exclusivity/pages | PAPER-01 | Simultaneous claims: one winner. Page 1 replicated; native Q released and advanced to next issue/page 0 on both clients. |
| Hood | INTERACTIONS-01 | In-reach hood level 0→2 accepted and shared. |
| Boar death and score | HUNT-01 | Exact scripted aim through real window geometry killed `boar:21:1`; both clients had hp −200/dead true, same shot and hit. Shooter alone received 500 points and one kill. |
| Respawn | COLLISION-01 | Same boar index later active as `boar:21:2`, hp40, generation2. |
| Duplicate shot | HUNT-01 + subsequent states | Resent same shot ID was silently discarded by host bridge; request timed out, score remained 500/kills1. This is not a two-shooter race test. |
| Player collision sample | COLLISION-01 | Native movement toward stationary other player stopped/slid without passing through. Sample only; no exhaustive geometry or high-speed continuous trace. |
| Journal byte eviction | JOURNAL-01 | 84 exact scripted rifle shots accepted, zero rejected. Earliest event 3 evicted; retained range began 54. Both: 68 events, 32,687 encoded bytes, 61 wall holes, one crack, zero pending effects. |
| Disconnect eventually releases phone | DISCONNECT-01, LATEJOIN-01 | Guest claimed phone, then its page/context closed. After one second the last host snapshot still retained that owner/player. By fresh-join ready state it was removed and phone was free. Exact release latency was not measured. |
| Fresh late join with ready assets | LATEJOIN-01 | Awaited decor and newspaper readiness. Host and fresh guest both: 1,412 collected objects, authority broken22, renderer broken21, same 68 journal IDs, 61 holes, one crack, zero pending. Authority includes dependent IDs; renderer count need not equal authority count. Actual renderer ID sets matched between clients. |
| Native transport proof | LATEJOIN-01 | Fresh client had a native RTCPeerConnection `connected`, ICE `connected`, native data channel `open`, 77 received messages/183,164 bytes. Transparent init observer retained native instances; no fake RTC or packet source. |
| Shared clear / permission | CLEAR-01 | Guest clear rejected. Host clear restored authority/renderer broken0, journal0, holes0, cracks0 on both. |

All exact aim shots used real player origins and native authority actions; no mutation of authority, collision, ammo, target HP, broken sets or inventory. Native walking and normal interactions remained subject to collision/reach/ownership. Earlier `DETAILS-01` / `BEDROOM-01` route attempts were blocked by an open bathroom leaf; their unreachable entries are superseded by successful native route **ROUTE-04/BEDROOM-02**, not counted as failures or passes.

## Not tested in this lane

- Ten rendered concurrent players / ten-client session, host-only design changes, cross-machine/network and mobile input.
- Every individual loose object in every room and **every catalog variant**. Default kitchen material samples and all five toys of the active default bed were checked; this is not complete catalog acceptance.
- Every shelf, room3/bathroom/balcony item, every mirror/screen, all bed/catalog variants; all weapon reserves/reloads and projectile visuals at useful viewing angles.
- Two players simultaneously killing the same boar; player death/PvP if intended; all animal species/round endings.
- Newspaper/seat owner disconnect specifically; media audio/video playback beyond authoritative index state; life-module water/mice/neighbour/landing behavior.
- Rejoin/reconnect after failure, long-duration memory/performance and authoritative journal count ceiling (byte eviction was tested).
- Separate fresh join after clear. Existing fresh guest saw clear live.

## Reproduction artifacts and cleanup

Entry: `output/independent-qa/gameplay/driver.cjs`; bounded step scripts `step-*.cjs`; evidence keyed by IDs above in `evidence.json`. Commands were driven through a bounded foreground Node process, without adding dependencies. For native UI boot: open target → dismiss coach → Играть вместе → name → Создать комнату; second context opens invitation → name → Войти в квартиру. All tests use production.

Resource ledger: Node driver **PID22057/session62106**, project root, owned Chrome launched by that driver, at most two 3D pages. Stop condition: browser.close in driver's 15-minute deadline/finalization. Deadline completed with exit0 after LEAVE-01; PID22057 absent at cleanup. No server/install/model/renderer started. Own helper count returned to zero; pre-existing parent/other-agent helpers and user apps left untouched. `Research/disk-janitor/janitor.sh --ram` ran after closure; local summary `cleanup-ram.txt`.

Four temporary screenshots were captured, UI and native weapon scene visually inspected, then removed after this report per workspace artifact policy. Some exact-aim damage checks rely on renderer-owned object/decals state rather than a screenshot aimed at each target. No exhaustive visual quality claim.

## Local fix retest — 2026-11-16, 10:45–10:55 Warsaw

Target **http://127.0.0.1:8765/**, root-owned server; this retest does not establish that production is fixed. Baseline P1 above remains the historical production finding. Root's local `hunt-session-state.js` change was present. Independent evidence: `output/independent-qa/gameplay/retest/evidence.json`; bounded scripts in the same directory. Existing VALIDATION.md was still not read.

**P1 no longer reproduced locally.** Two complete cycles each performed visible lobby create → real guest join → synced hunting snapshots/native in-room fire → guest leave → host leave → 5.1 seconds solo updates → native solo pistol shots → recreate. Both cycles had **zero page errors**. Each client retained the original animal objects, each bird's original `f` flock object, each boar's original `group` object, and the original individual flock/group objects. All active members remained in their proper `members` arrays. Network-only `bird:*` identifiers were removed on exit. Two native solo clicks added two real viewmodel shots on each client in each cycle. Evidence **CYCLE-1**, **CYCLE-2**.

An additional whole-pool observation after solo shooting checked actual positions over 5.1 seconds: host **20/42 active birds and 40 boars moved**, guest **37/50 active birds and 36 boars moved**. Active birds had valid flock members; each pool included both perched and flying birds. The first ten birds in the earlier guest samples were perched, so those earlier unchanged positions were not interpreted as a regression. Evidence **SOLO-ALL-BIRDS**.

### Additional live coverage

**Simultaneous real boar kill race passed.** Both clients sent legitimate exact-aim bolt shots simultaneously from their actual positions, through host-resolved scene geometry, at **boar:17:1**. Both actions were accepted. Both clients agreed: target dead/hp−80, exactly one killed hit, host105 points/kill1, guest0 points/kill0. Evidence **BOAR-RACE**. No target HP, position, authority, ammo or score was rewritten.

**Life mouse shot/death/reset remains unverified.** Two bounded attempts requested ordinary host debug spawning (12 tries each). No mouse materialized in the sampled hallway; no approved external mouse shot occurred. Both clients consistently had no current mouse. This does not prove mouse damage, death or respawn. Native movement attempts were constrained by the guest avatar/door geometry; no teleport or forced mouse placement was used to bypass it. Evidence **LIFE-MOUSE**, **LIFE-MOUSE-2**, **LIFE-DIAG**. Missing room/item samples remain open.

### Catalog registration coverage — static, separate from E2E

Independent inventory parsed **7 zone files /172 options /505 part references**. Of these, the current loose-object material policy selected **381 candidate part references /113 unique GLB files /68 options**. It inspected their GLB JSON mesh nodes: **1,364 mesh-node references, 1,364 with destruction material, zero missing candidate assets, zero unclassified candidate nodes**. This is policy/asset inventory plus the current common `assignNetworkObjectIds` attach path review; it is **not** actual GLTFLoader registration or destruction E2E for every option. Individual renderer registration still needs a runtime catalog sweep, and individual shots need their own evidence.

Reproducible read-only script: `retest/catalog-census.mjs`; matrix: `retest/catalog-census.json`. Focused source checks independently ran `node --test tools/tests/hunt-session-state.test.mjs tools/tests/multiplayer-content.test.mjs`: **9 passed** (`retest/source-tests.txt`). These support the browser evidence and do not replace it.

### Retest cleanup / limitations

Owned Node **PID44285/session52492**, owned headless Chrome157, at most two full WebGL pages; 10-minute deadline. Driver explicitly closed browser, then exited; PID absent and session unavailable at final check. One local-scene screenshot visually confirmed a rendered room, weapon and other player's avatar (large foreground avatar constrained sight/movement); screenshot deleted. Post-close `janitor.sh --ram` census saved in `retest/cleanup-ram.txt`. Root's local server was reused and left untouched. No owned disposable helper remains.

One automation incident: after the two main cycles and score race, both Playwright page handles became closed while their browser remained connected and error collector was empty. No cause was established and this was not attributed to the application. Empty owned contexts were closed and fresh pages in the same owned browser performed the bounded life attempts; no extra browser was launched. Evidence **BROWSER-STATUS**.
