# Multiplayer architecture

Decision researched: 2026-11-16. Updated after the owner explicitly chose free hosting without a new account. This is a target contract; the QA receipt records what actually works.

## Decision

Keep the existing Three.js apartment and Vercel static frontend. Use **host-authoritative WebRTC in a star topology**, up to 10 players including the creator. The creator's browser runs the portable room simulation; each guest has one encrypted data connection to that host. PeerJS provides the free public signaling service. Rendering and cosmetic effects stay on each participant's machine.

This satisfies the owner's explicit constraints: no Cloudflare account, no dedicated paid server, and the creator acts as the game server. Keep the simulation independent of transport so it can later move to a persistent server without rewriting gameplay.

| Option | Fit under the final constraints | Decision |
| --- | --- | --- |
| PeerJS signaling + WebRTC star | Free public rendezvous, no registration, creator owns simulation; one guest-host connection each | Selected |
| Vercel Blob signaling | Existing credential, but introduces polling, ICE mailboxes, races, expiry and storage operations | Avoid |
| Cloudflare Durable Object / PartyServer | Strong managed single-room authority, but requires a new account and service provisioning | Available future upgrade, not part of this release |
| Colyseus 0.18 on persistent Node | Excellent netcode primitives, but requires actual Node hosting | Future alternative |
| Vercel Function WebSockets alone | Supported since June 2026, but connections can reach different instances and expire at max duration | Not a safe sole room authority |
| Vercel Daemons | No inbound HTTP/TCP or rewrite targets | Not a public game endpoint |
| Managed PartyKit | Hosted service shut down on 23 October 2026 | Do not adopt |
| WebRTC mesh | Duplicated authority and up to 45 links for 10 people | Avoid |

## Connectivity and host lifecycle

The public PeerServer remains available, but PeerJS's free TURN relay was discontinued. STUN discovers network routes; it cannot relay through every restrictive NAT/firewall. Therefore this zero-account baseline cannot honestly promise that every pair of networks will connect. Use explicit connection timeout, retry and a concise recoverable error. Support optional deployment-level TURN configuration if reliable relay coverage is later required; never embed public demo relay credentials.

The host must keep the game open. Host tab closure ends the room; guests cannot claim its editor identity. A Worker can reduce main-thread rendering interference, but cannot defeat browser/OS suspension of a background or mobile host. Show connection/host status plainly. If the host becomes unreachable, freeze interactions until reconnect or leave rather than creating independent scoring worlds.

A working Vercel CLI session and the existing project linkage were verified. No Cloudflare provisioning is needed for the selected design. A development tunnel to the owner's Mac is not a production multiplayer dependency.

## Ownership and identity

- The host issues random room, player and resume credentials. An invitation contains the room/Peer ID and the host public key (or its verifiable fingerprint), never a private key or resume secret.
- Authenticate the invited host before accepting room state: guest generates a random nonce, host signs a context binding nonce + room ID + guest ID + protocol version with its ECDSA key, guest verifies against the invitation. A stranger who registers the same public Peer ID after the owner disconnects cannot impersonate that host.
- Owner identity is bound at room creation and remains stable through reconnect. Server handlers, rather than hidden UI alone, enforce editor-only apartment updates, reset and room management.
- Guest UI exposes movement, weapon choice/fire, permitted interactions, scoreboard and leave. It cannot enter orbit/material/furniture editing through keyboard, hash changes or debug setters.
- Session credentials are scoped to one room/player and stored in session storage. One live connection per identity; reconnect replaces the old connection and rejects stale messages.
- The authority assigns a free character variant from a manifest of 10 distinct silhouettes/outfits. An active room never has duplicate variant IDs. Names are normalized, bounded, plain text, and rendered without HTML.
- Accept only versioned, validated commands with a byte limit, finite bounded values, sequence numbers, action rate limits and meaningful failure codes. Never accept client supplied points, kills, HP, item ownership or editor role.

## Simulation and synchronization

The host simulation owns plain serializable state, outside Three.js. Rendering is an adapter. Keep one canonical configuration for rates, weapon rules, character radius and limits, shared by the host authority and guest prediction.

- **Players:** sequenced displacement commands validated by the host against a replenishing simulation-time budget, static apartment collision and other player circles. Collision uses bounded spatial substeps; no passing through bodies. Spawn into free space rather than all at one point.
- **Responsiveness:** predict local input immediately; server acknowledges processed input sequence; reconcile and replay unacknowledged inputs. Interpolate remote entities between timestamped snapshots; bound extrapolation and snap after long gaps.
- **Initial rates:** 60 Hz host simulation and 20 Hz network input batches/state snapshots. Input batches preserve per-frame sequence numbers for replay. These are starting settings, not a performance claim. Measure before changing them. Remote interpolation target: approximately 100 ms, adapted to measured jitter.
- **Hunting:** the server owns every animal's ID, spawn seed, pose, HP, death, respawn and awarded score. Existing client random simulation is disabled while connected. All current species must either use this authority or be explicitly excluded from room gameplay, never silently remain independent scoring targets.
- **Combat:** client sends weapon/fire intent and aim; server validates weapon, ammunition/reload, cadence, origin near player, and range. The private host bridge performs exact Three.js world ray tests; guests cannot supply trusted world traces. The portable authority validates weapons and origins and ray-tests its animal state, using bounded pose history for wildlife hit tolerance. Nearby external targets (mice/monsters), opaque surfaces and wildlife are ordered before damage is applied. One kill produces one score award even for simultaneous shots. Every accepted shot has one event ID; all clients render its tracer, impact and death effect.
- **Apartment damage:** stable entity IDs derive from spec IDs and model hierarchy paths, never Three.js UUIDs or traversal timing. The authoritative state retains broken entities, bounded impact records and a reset epoch. Parent breakables retain dependent unit IDs so late arrivals do not resurrect contents of shattered jars or bowls. Late arrivals receive this state. Shards/sparks are seeded cosmetic effects; persistent broken/intact state must match exactly.
- **Instance rendering boundary:** `InstancedMesh` is a draw batch, not one atomic world object. The loose-object manifest excludes instance batches rather than publishing their unused template bounds at the origin or expanding decorative instances into thousands of protocol objects. Exact host world ray traces still resolve their real surfaces, including opaque surfaces absent from the manifest. An interactive instanced domain must publish its own stable logical entities and ownership rules. Ordinary apartment meshes remain manifest objects and block handoff through real opaque geometry.
- **Exclusive items:** taking a phone/newspaper or claiming a seat is one atomic host-authority command. One owner at a time; denied pickup leaves the losing client unchanged. Drop/leave/disconnect returns or releases the item. Held items have an authoritative player owner. Seats retain occupancy separately from handheld items; standing finds nearby free space in the same room and cannot teleport through walls or closed doors.
- **Other interactions:** doors, hood, faucets, light changes, TV/navigation and environmental life must be classified as authoritative world state or local presentation. Shared gameplay must never call an unsynchronized local mutation path.
- **Owner edits:** server validates a complete serialized apartment variant with a revision. All clients apply the same accepted revision; rebuilding geometry preserves or deliberately resets damage and interactions as one epoch transition. Quality, audio volume, pointer lock and camera presentation stay local.

## Wire and lifecycle contract

Handshake: client protocol/build version, room create/join/resume intent, name and optional owner apartment variant. Reply: player ID, role, assigned character, resume credential, authoritative clock/tick, configuration and full room snapshot. Reject incompatible builds before joining.

Commands: `input`, `weapon`, `fire`, `interact`, `apartment`, `clear`, `sit`, `stand`, `ambient`, `leave`, `ping`. Every mutation receives an acknowledgement or rejection. Snapshot contains revision/tick, owner ID, connected players/score, animal state, world state and damage state. Transient events have strictly increasing IDs and can be deduplicated after reconnect.

Graceful leave removes presence and body immediately. Hard disconnect removes them when the server detects close or a bounded heartbeat timeout; “instant” detection of an unplugged network is not physically possible. Reserve identity/score briefly for resume without leaving a blocking ghost body. Reconnect with exponential backoff and jitter, replace stale sockets, reload a full snapshot, clear obsolete prediction and never flush stale shots/pickups after reconnection.

Owner disconnection preserves its role and frozen apartment. Guests may keep playing according to the room policy, but no guest becomes editor. A host-only room may keep its tick loop active; closing the room stops it. Resume identity is bounded to the current authenticated host session. Active rooms need an active host simulation; stop the loop when the room closes. Host reload/restart is a room lifecycle boundary; do not claim transparent survival without an implemented, authenticated restore path. Set transport backpressure limits so a slow client cannot retain unbounded snapshots.

## Acceptance matrix

1. Host + 9 independent clients join; player 11 is rejected clearly. All names/character variants appear, presence counts agree.
2. Guest attempts editor UI, keyboard shortcuts, hash, debug API and forged wire command; room design/revision stay unchanged.
3. Owner changes material/furniture/time; all clients and a late joiner receive the same accepted apartment revision.
4. Players collide in an open room, narrow doorway and at spawn, while moving head on and under latency; no persistent overlap or tunnelling.
5. Multiple players shoot the same boar; exactly one death and one score award. Everyone sees the accepted shots and the same animal state after reconnect/late join.
6. Break glass, a jar, a mirror and a screen; other clients and a late joiner see matching persistent damage; host reset is shared and guest reset rejected.
7. Two clients pick up the same phone simultaneously; exactly one wins. Drop and disconnect release it. Seats and other exclusive objects follow the same rule.
8. Leave, tab close, network loss, same-player reconnect, owner loss, room full and build mismatch all have visible recoverable UI; no editor escalation or duplicate avatar.
9. Browser desktop/phone: enter name, open invitation, join, copy invitation, see scoreboard, leave. Check keyboard focus, pointer-lock release, overflow, console and screenshot readability.
10. Ten-client soak, artificial RTT/jitter/loss, background tab, slow receiver and host interruption: record p50/p95 latency, tick duration, snapshot size, bandwidth, FPS and error counts. The QA receipt must distinguish protocol clients from full rendered browsers and local from deployed proof and same-machine from cross-network connectivity.

## Primary sources

- [PeerJS setup and signaling responsibilities](https://peerjs.com/client/getting-started)
- [PeerJS free TURN discontinuation; public signaling remains](https://github.com/orgs/peers/discussions/1172)
- [WebRTC ICE, STUN, NAT and TURN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols)

- [Vercel WebSockets: lifecycle, instance affinity and external persistent state](https://vercel.com/docs/functions/websockets)
- [Vercel WebSocket public beta announcement, 22 June 2026](https://vercel.com/changelog/websocket-support-is-now-in-public-beta)
- [Vercel Daemons limitations: no inbound HTTP/TCP](https://vercel.com/docs/daemons/limits)
- [Durable Object WebSockets and hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Objects pricing and free-plan availability](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [PartyKit shutdown and PartyServer migration dates](https://docs.partykit.io/guides/migrate-to-partyserver/)
- [Colyseus authoritative state synchronization](https://docs.colyseus.io/state)
- [Colyseus 0.18 netcode and client prediction](https://docs.colyseus.io/netcode)
- [Colyseus fixed timestep and server input](https://docs.colyseus.io/netcode/server-input)
- [Colyseus reconnect lifecycle](https://docs.colyseus.io/room/reconnection)
