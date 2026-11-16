import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoomAuthority } from '../../web/js/multiplayer/authority.js';
import { createHostAuthority } from '../../web/js/multiplayer/host.js';
import { NETWORK_RULES as R } from '../../web/js/multiplayer/rules.js';

const read = name => JSON.parse(readFileSync(new URL(`../../web/spec/${name}.json`, import.meta.url)));

test('ten-player Worker fanout sends one shared snapshot and excludes departed peers', () => {
  const direct = [], batches = [];
  const room = createRoomAuthority({ roomId: 'fanout', plan: read('plan.generated'), site: read('site'), huntSpec: read('hunt'),
    send: (peer, packet) => direct.push({ peer, packet }),
    sendMany: (peers, packet) => batches.push({ peers, packet }) });
  try {
    room.connect('local', { type: 'create', version: R.version, apartment: {} });
    for (let i = 0; i < 9; i++) room.connect(`guest-${i}`, { type: 'join', version: R.version });
    direct.length = batches.length = 0;
    for (let i = 0; i < 4; i++) room.step(1 / R.tickHz);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].packet.type, 'snapshot');
    assert.equal(batches[0].packet.players.length, 10);
    assert.deepEqual(batches[0].peers, ['local', ...Array.from({ length: 9 }, (_, i) => `guest-${i}`)]);
    assert.equal(direct.length, 0, 'broadcast snapshots never clone through the per-player path');
    room.disconnect('guest-4');
    const latest = batches.at(-1);
    assert.equal(latest.packet.type, 'snapshot');
    assert.equal(latest.peers.length, 9);
    assert.ok(!latest.peers.includes('guest-4'));
    assert.equal(latest.packet.players.length, 9);
  } finally { room.dispose(); }
});

test('host bridge preserves packet order, identity and once-only external shot resolution', async () => {
  const original = globalThis.Worker, workers = [], received = [], resolved = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); this.commands = []; }
    postMessage(data) {
      this.commands.push(data);
      if (data.command === 'init') queueMicrotask(() => this.onmessage({ data: { type: 'ready' } }));
    }
    terminate() { this.terminated = true; }
  };
  let host;
  try {
    host = await createHostAuthority({ room: 'bridge', plan: {}, huntSpec: {}, site: {},
      resolveExternalShot: event => { resolved.push(event); return [{ animalId: 'mouse', killed: true }]; },
      send: (peer, packet) => received.push({ peer, packet }) });
    const worker = workers[0], peers = ['local', 'guest-a', 'guest-b'];
    const welcome = { type: 'welcome' }, event = { type: 'event', event: { kind: 'shot', shotId: 'one', actorId: 'host' } }, snapshot = { type: 'snapshot', seq: 7 };
    worker.onmessage({ data: { type: 'packet', peer: 'guest-a', packet: welcome } });
    worker.onmessage({ data: { type: 'broadcast', peers, packet: event } });
    worker.onmessage({ data: { type: 'broadcast', peers, packet: snapshot } });
    assert.equal(received[0].packet, welcome);
    assert.deepEqual(received.slice(1, 4).map(r => r.peer), peers);
    assert.ok(received.slice(1, 4).every(r => r.packet === event));
    assert.ok(received.slice(4).every(r => r.packet === snapshot));
    assert.equal(resolved.length, 1);
    assert.equal(worker.commands.filter(c => c.command === 'external').length, 1);
  } finally { host?.dispose(); globalThis.Worker = original; }
  assert.equal(workers[0].terminated, true);
});
