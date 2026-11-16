// Transport contract tests: real ECDSA, deterministic in-memory PeerJS channels, no browser/server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMultiplayerClient, cleanPlayerName } from '../web/js/multiplayer/client.js';
import { decodeHostKey } from '../web/js/multiplayer/peer-transport.js';
import { NETWORK_RULES as R } from '../web/js/multiplayer/rules.js';

const peers = new Map(), storage = new Map(); let serial = 0;
globalThis.location = new URL('https://test.example/#v3-preserved');
globalThis.RTCPeerConnection = class {};
globalThis.sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
class Channel extends EventEmitter {
  constructor(peer) { super(); this.peer = peer; this.open = false; this.closed = false; this.dataChannel = { bufferedAmount: 0 }; }
  send(packet) { if (!this.open) throw new Error('Closed channel'); queueMicrotask(() => { if (this.other.open) this.other.emit('data', structuredClone(packet)); }); }
  close() {
    if (this.closed) return; this.closed = true; this.open = false; this.emit('close');
    if (this.other && !this.other.closed) { this.other.closed = true; this.other.open = false; this.other.emit('close'); }
  }
}
class MockPeer extends EventEmitter {
  constructor(id) {
    super(); this.id = id || `mock-${++serial}`; this.channels = []; this.destroyed = false; this.disconnected = false;
    queueMicrotask(() => { peers.set(this.id, this); this.emit('open', this.id); });
  }
  connect(remoteId) {
    const a = new Channel(remoteId), remote = peers.get(remoteId);
    if (!remote) { queueMicrotask(() => this.emit('error', { type: 'peer-unavailable' })); return a; }
    const b = new Channel(this.id); a.other = b; b.other = a;
    this.channels.push(a); remote.channels.push(b);
    queueMicrotask(() => { remote.emit('connection', b); if (a.closed || b.closed) return; a.open = b.open = true; a.emit('open'); b.emit('open'); });
    return a;
  }
  reconnect() { this.disconnected = false; queueMicrotask(() => this.emit('open', this.id)); }
  destroy() { if (this.destroyed) return; this.destroyed = true; for (const c of this.channels) c.close(); peers.delete(this.id); this.emit('close'); }
}
globalThis.Peer = MockPeer;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn) { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) throw new Error('Wait timed out'); await delay(10); } }
function authorityFactory(log = {}) {
  return async ({ room, send }) => {
    const players = new Map(), tokens = new Map(), sessions = new Map(); let sequence = 0, hostId = null;
    const snapshot = () => ({ type: 'snapshot', seq: ++sequence, time: Date.now(), hostId, players: [...players.values()] });
    const broadcast = () => { const value = snapshot(); for (const peerId of sessions.keys()) send(peerId, value); };
    return {
      connect(peerId, hello) {
        if (hello.version !== R.version) { send(peerId, { type: 'error', code: 'version_mismatch' }); return; }
        log.connections = (log.connections || 0) + 1;
        let id = hello.token && tokens.get(hello.token);
        if (id === hostId && peerId !== 'local') { send(peerId, { type: 'error', code: 'unauthorized' }); return; }
        id ||= `player-${tokens.size}`;
        const token = hello.token || `token-${tokens.size}`;
        if (!hostId) hostId = id;
        tokens.set(token, id); sessions.set(peerId, id);
        players.set(id, { id, name: hello.name, avatar: tokens.size - 1, x: 0, y: 0, z: 0, score: 0 });
        send(peerId, { type: 'welcome', room, id, token, hostId, snapshot: snapshot() }); broadcast();
      },
      receive(peerId, packet) {
        if (packet.type === 'leave') { this.disconnect(peerId); return; }
        const action = packet.action;
        if (action?.requestId) send(peerId, { type: 'result', requestId: action.requestId, ok: true });
        if (action?.kind === 'score') { players.get(sessions.get(peerId)).score += action.amount; broadcast(); }
      },
      disconnect(peerId) { const id = sessions.get(peerId); sessions.delete(peerId); players.delete(id); broadcast(); },
      dispose() { sessions.clear(); players.clear(); },
    };
  };
}
async function pair(log) {
  const host = createMultiplayerClient({ createAuthority: authorityFactory(log) });
  await host.create({ name: 'Хозяин', apartment: { sample: true } });
  storage.delete('kitchen.multiplayer.session.' + host.room);
  const guest = createMultiplayerClient();
  const key = new URL(host.inviteUrl).searchParams.get('key');
  await guest.join({ room: host.room, name: 'Гость', key });
  return { host, guest, key };
}

test('Signed host/guest handshake, snapshot convergence, request result and immediate leave', async () => {
  const { host, guest } = await pair();
  try {
    await waitFor(() => host.state.players.length === 2);
    assert.equal(host.role, 'host'); assert.equal(guest.role, 'guest');
    assert.ok(guest.connected); assert.equal(new URL(host.inviteUrl).hash, '#v3-preserved');
    assert.ok(new URL(host.inviteUrl).searchParams.get('key'));
    assert.ok(!host.inviteUrl.includes('token-'));
    assert.deepEqual(await guest.request({ kind: 'claim', itemId: 'phone' }), { type: 'result', requestId: `${guest.id}:1`, ok: true });
    guest.send({ kind: 'score', amount: 7 });
    await waitFor(() => host.state.players.find(p => p.id === guest.id)?.score === 7);
    const oldGuest = guest.id; guest.leave();
    await waitFor(() => !host.state.players.some(p => p.id === oldGuest));
    assert.equal(guest.connected, false); assert.equal(guest.state, null);
  } finally { guest.dispose(); host.dispose(); }
  assert.equal(peers.size, 0);
});

test('Owner party homes reach room creation after an apartment was rearranged', async () => {
  const spec = { items: [{ id: 'vape-island', kind: 'vape', position: [2.8, 0.915, 1.4] }] };
  let received;
  const factory = authorityFactory();
  const host = createMultiplayerClient({ createAuthority: async options => {
    const authority = await factory(options), connect = authority.connect;
    authority.connect = function(peer, hello) { if (peer === 'local') received = structuredClone(hello.partySpec); return connect.call(this, peer, hello); };
    return authority;
  } });
  try { await host.create({ name: 'Хозяин', apartment: { aisle: 1.8 }, partySpec: spec }); assert.deepEqual(received, spec); }
  finally { host.dispose(); }
  assert.equal(peers.size, 0);
});

test('Wrong invite key fails before authority admits an impostor', async () => {
  const log = {}, host = createMultiplayerClient({ createAuthority: authorityFactory(log) });
  await host.create({ name: 'Хозяин' });
  const fake = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', fake.publicKey);
  const key = btoa(JSON.stringify(jwk)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const guest = createMultiplayerClient();
  try {
    await assert.rejects(guest.join({ room: host.room, name: 'Подмена', key }), /Подпись хозяина/);
    assert.equal(log.connections, 1); assert.equal(guest.state, null); assert.equal(guest.connected, false);
  } finally { guest.dispose(); host.dispose(); }
  assert.equal(peers.size, 0);
});

test('Guest reconnects with the same identity; host signalling outage preserves live data', async () => {
  const { host, guest } = await pair();
  try {
    const previousId = guest.id;
    const hostPeer = [...peers.values()].find(p => p.id.startsWith('kk3d-'));
    hostPeer.disconnected = true; hostPeer.emit('disconnected');
    guest.send({ kind: 'score', amount: 3 });
    await waitFor(() => host.state.players.find(p => p.id === previousId)?.score === 3);
    const guestPeer = [...peers.values()].find(p => !p.id.startsWith('kk3d-'));
    guestPeer.channels[0].close();
    assert.equal(guest.status, 'reconnecting');
    await waitFor(() => guest.connected);
    assert.equal(guest.id, previousId); assert.equal(guest.role, 'guest');
    assert.equal(host.state.players.length, 2);
  } finally { guest.dispose(); host.dispose(); }
  assert.equal(peers.size, 0);
});

test('Name sanitation and key parser reject malformed or private invitation keys', () => {
  assert.equal(cleanPlayerName('  Ник\u0000\n '), 'Ник'); assert.equal(cleanPlayerName('x'.repeat(40)).length, 24);
  assert.throws(() => decodeHostKey(null), /полная ссылка/);
  assert.throws(() => decodeHostKey('not-a-key'), /повреждена/);
  assert.throws(() => decodeHostKey(btoa(JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'private' }))), /повреждена/);
});

test('Host leaving closes the guest room immediately instead of retrying a dead room', async () => {
  const { host, guest } = await pair();
  try {
    host.leave();
    await waitFor(() => guest.status === 'closed');
    assert.equal(guest.connected, false);
    await delay(25); assert.equal(peers.size, 0);
  } finally { guest.dispose(); host.dispose(); }
});

test('Remote PeerJS identity local is rejected before it can reach the private host bridge', async () => {
  const log = {}, host = createMultiplayerClient({ createAuthority: authorityFactory(log) });
  let attacker;
  try {
    await host.create({ name: 'Хозяин' });
    const before = structuredClone(host.state), hostId = host.id;
    attacker = new MockPeer('local');
    await new Promise(resolve => attacker.once('open', resolve));
    const connection = attacker.connect('kk3d-' + host.room);
    connection.on('open', () => connection.send({ type: 'auth', protocol: R.version, room: host.room,
      clientId: 'local', nonce: 'reservedRemoteAliasAttackNonce' }));
    connection.on('data', packet => { if (packet.type === 'proof') connection.send({ type: 'join', version: R.version, room: host.room, name: 'Подмена хоста' }); });
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Reserved remote identity was not rejected immediately')), 250);
      connection.once('close', () => { clearTimeout(deadline); resolve(); });
    });
    assert.equal(connection.open, false);
    assert.equal(log.connections, 1, 'the remote connection never reaches Room.connect');
    assert.equal(host.connected, true); assert.equal(host.status, 'connected');
    assert.equal(host.role, 'host'); assert.equal(host.id, hostId);
    assert.deepEqual(host.state, before, 'the host world, players and role remain unchanged');
  } finally { attacker?.destroy(); host.dispose(); }
  assert.equal(peers.size, 0);
});
