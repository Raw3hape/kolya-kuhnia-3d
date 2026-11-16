# Transport and avatar handoff

## Entry points

- `client.js`: application callbacks and per-tab session identity; unchanged gameplay actions.
- `peer-transport.js`: PeerJS 1.5.5, WebRTC star, signed host handshake, bounded channels.
- `snapshot-codec.js`: shared snapshot preparation/compression and per-connection reconstruction.
- `lobby.js`: DOM dialog and room controls, using the existing UI tokens.
- `avatars.js`: ten procedural low-poly players, animated limbs, weapon/item silhouettes and depth-tested names.

`createMultiplayerClient({ createAuthority, onSnapshot, onEvent, onStatus, onWelcome, transportFactory?, peerOptions? })` exposes:

- `create({name,apartment,collision,objects,doors,items,seats,interactions,interactionMeta})`, `join({room,name,key?})`: promises resolving to welcome.
- `send(action)`: boolean; `request(action)`: result promise with timeout and disconnect rejection.
- `leave()`, `dispose()`, `subscribe(listener)`.
- Read-only `state`, `self`, `role`, `connected`, `room`, `id`, `status`, `inviteUrl`.

The app supplies `createAuthority({room,send}) -> Promise<{connect,receive,disconnect,dispose}>`. The host's local link is `local`. Native game packets remain `{type:'action',action:{kind,...}}`. Call `dispose()` on room/page teardown; it closes all data channels, destroys the PeerJS identity and terminates the supplied authority.

## Identity and connection behavior

Invites contain `room` and a public ECDSA P-256 key, preserving `#v3` apartment links. They never contain the host's private key or a resume token. A guest verifies a signed random nonce bound to room, PeerJS client ID and protocol version before accepting welcome. Host metadata/game actions are never accepted from an unauthenticated channel.

The nickname uses local storage. Resume tokens use session storage so two browser tabs do not take over the same player. Host signing keys also use session storage. These are browser runtime values, never repository files or logs.

Every client sends a heartbeat every 1.5 seconds even while standing still. A stale host snapshot pauses game actions at 3 seconds. A guest reconnects after 6.5 seconds, with backoff capped at 6 seconds, for at most 60 seconds. Existing direct channels survive a PeerJS signaling outage. A host closing the room ends its simulation; there is no implicit host migration.

## Ordering, buffering and bandwidth

Data connections use PeerJS **binary** serialization, whose chunking handles large welcome/world packets. JSON serialization has a small-message limit and failed in a real browser test; do not switch it back.

Snapshots share one cached compression promise per sequence across the host fanout. Unchanged apartment, ownership, doors, broken sets and ambient fields are omitted by the delta. Shot history sends additions plus retained IDs. Wildlife sends changed fields by stable animal ID; respawn/removal is explicit. Serialized wildlife poses use millimetres/milliradians; authoritative simulation and hitboxes retain full precision.

Deflate bytes travel as an ArrayBuffer over the binary channel. Older browsers without decompression support negotiate full ordinary snapshots. Events and results stay in channel order with snapshots. At most two snapshots wait per channel; stale snapshots are dropped above 256 KiB of native buffer. A base gap uses the next full snapshot. Excessive channel backlog closes that connection for a clean resync.

2026-11-16 deterministic codec stress measurement (`node --test tools/tests/snapshot-codec.test.mjs`):

| Fixture | Result |
|---|---|
| Actual wildlife simulation + 10 player poses, 20 Hz | 40 successive frames |
| Retained synthetic shotgun history | 192 shots × 9 pellets; intentionally exceeds the live 32 KiB journal budget |
| Full JSON frame mean | 391,405 bytes |
| Compressed incremental wire mean | 1,980 bytes |
| First full wire frame | 12,830 bytes |
| Reduction | 99.5% |
| Host payload for nine guests | approximately 2.85 Mbit/s, before SCTP/DTLS/IP overhead |
| Encoding fixture + JSON measurement work | approximately 4–5 ms/frame in Node; not a browser or device performance claim |

The test proves exact full/delta reconstruction, rolling history, animal death/respawn/removal, epoch reset and recovery after a missing base. `tools/test_multiplayer_client.mjs` separately tests real ECDSA validation, request results, convergence, immediate leave, same-identity reconnect and signaling-loss behavior with deterministic in-memory data channels. Real internet/NAT/device coverage must be reported separately.

## Avatar API

`createAvatar({slot,name,host,layer})` returns `{root,height,slot,definition,setIdentity,update,dispose}`. Feet are at y=0; forward is −Z, matching walk yaw. The caller owns the root pose. `update({dt,time,speed,weapon,aimPitch,held,shooting,seated,seatY})` changes visuals only. The room assigns unique slots, owns all collision/occupancy and retains a slot on reconnect when that appearance remains available.

The model merges colored primitives into one mesh per moving body part. No textures or model downloads are required. Name sprites use depth testing and are hidden by walls. Disposal releases owned geometry/materials/textures while preserving Three.js shared sprite geometry.

Official references: [PeerJS connection API](https://peerjs.com/client/api/data-connection), [PeerServer Cloud](https://peerjs.com/server/cloud), [PeerJS FAQ](https://peerjs.com/client/faq), [npm version metadata](https://registry.npmjs.org/peerjs/1.5.5).
