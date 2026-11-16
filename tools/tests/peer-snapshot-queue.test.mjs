import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotReceiver } from '../../web/js/multiplayer/peer-transport.js';
import { createSnapshotEncoder, createSnapshotDecoder } from '../../web/js/multiplayer/snapshot-codec.js';
import { NETWORK_RULES as R } from '../../web/js/multiplayer/rules.js';

test('a burst decodes every delta but applies only the first and newest snapshot, including unknown party fields', async () => {
  const encoder = createSnapshotEncoder({ compress: false }), decoder = createSnapshotDecoder(), delivered = [], decoded = [];
  const receiver = createSnapshotReceiver({ decode: packet => { decoded.push(packet.seq); return decoder.decode(packet); },
    onPacket: packet => delivered.push(packet), onError: error => { throw error; }, now: () => 0 });
  const states = Array.from({ length: 80 }, (_, i) => ({ type: 'snapshot', seq: i + 1, players: [{ id: 'guest', x: i }],
    hunt: { time: i / 20, animals: [{ id: 'boar:1', x: i }] }, party: { activity: 'future-game', arbitraryNested: [i, { ready: true }] } }));
  const wires = [];
  for (const state of states) { const prepared = encoder.prepare(state); wires.push(await (state.seq === 1 ? prepared.full() : prepared.delta())); }
  await Promise.all(wires.map(packet => receiver.receive(packet)));
  assert.equal(decoded.length, 80, 'all dependent wire bases are reconstructed');
  assert.deepEqual(delivered.map(p => p.seq), [1, 80]); assert.deepEqual(delivered.at(-1), states.at(-1)); assert.equal(receiver.pending, 0);
});

test('events, request results and welcome packets remain ordered barriers between coalesced snapshots', async () => {
  const delivered = [], receiver = createSnapshotReceiver({ decode: async packet => packet, onPacket: packet => delivered.push(packet.kind || packet.seq || packet.type),
    onError: error => { throw error; }, now: () => 0 });
  const snapshot = seq => ({ type: 'snapshot', seq });
  const packets = [{ type: 'welcome' }, snapshot(1), snapshot(2), snapshot(3), { type: 'event', kind: 'shot' },
    snapshot(4), snapshot(5), snapshot(6), { type: 'result', kind: 'request-result' }, snapshot(7), snapshot(8), snapshot(9)];
  await Promise.all(packets.map(packet => receiver.receive(packet)));
  assert.deepEqual(delivered, ['welcome', 1, 3, 'shot', 6, 'request-result', 9]);
});

test('ordinary live frames are applied immediately and a long decode queue continues presenting progress', async () => {
  let now = 0; const delivered = [];
  const receiver = createSnapshotReceiver({ decode: async packet => { now += 60; return packet; }, now: () => now,
    onPacket: packet => delivered.push({ seq: packet.seq, at: now }), onError: error => { throw error; } });
  for (let seq = 1; seq <= 3; seq++) await receiver.receive({ type: 'snapshot', seq });
  assert.deepEqual(delivered.map(p => p.seq), [1, 2, 3]); delivered.length = 0;
  await Promise.all(Array.from({ length: 20 }, (_, i) => receiver.receive({ type: 'snapshot', seq: i + 4 })));
  assert.ok(delivered.length > 1 && delivered.length < 20); assert.equal(delivered.at(-1).seq, 23);
  assert.ok(delivered.slice(1).every((p, i) => p.at - delivered[i].at <= 120), 'presentation is not starved until the backlog drains');
});

test('closing a queued receiver skips outstanding decoding and cannot deliver a late state', async () => {
  let release, decoded = 0; const delivered = [], errors = [];
  const receiver = createSnapshotReceiver({ decode: async packet => { decoded++; await new Promise(resolve => { release = resolve; }); return packet; },
    onPacket: packet => delivered.push(packet), onError: error => errors.push(error) });
  const work = [receiver.receive({ type: 'snapshot', seq: 1 }), receiver.receive({ type: 'snapshot', seq: 2 })];
  await Promise.resolve(); receiver.close(); release(); await Promise.all(work);
  assert.equal(decoded, 1); assert.equal(delivered.length, 0); assert.equal(errors.length, 0); assert.equal(receiver.pending, 0);
});

test('a decode failure reports once and prevents applying later packets with an invalid baseline', async () => {
  const errors = [], delivered = [], receiver = createSnapshotReceiver({ decode: async () => { throw Error('bad base'); },
    onPacket: packet => delivered.push(packet), onError: error => errors.push(error) });
  await Promise.all([receiver.receive({ type: 'snapshot-delta' }), receiver.receive({ type: 'event', kind: 'shot' })]);
  assert.equal(errors.length, 1); assert.equal(delivered.length, 0); assert.equal(receiver.pending, 0);
});

test('a pathological backlog is bounded and abandoned rather than retaining unlimited obsolete packets', async () => {
  const errors = [], delivered = [];
  const receiver = createSnapshotReceiver({ decode: async packet => packet, onPacket: packet => delivered.push(packet), onError: error => errors.push(error) });
  const limit = R.snapshotHz * Math.ceil(R.timeoutMs / 1000);
  await Promise.all(Array.from({ length: limit + 20 }, (_, i) => receiver.receive({ type: 'snapshot', seq: i + 1 })));
  assert.equal(errors.length, 1); assert.match(errors[0].message, /backlog/); assert.equal(delivered.length, 0); assert.equal(receiver.pending, 0);
});
