import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSnapshotEncoder, createSnapshotDecoder } from '../../web/js/multiplayer/snapshot-codec.js';
import { createHuntSimulation } from '../../web/js/multiplayer/hunt-simulation.js';
const root = new URL('../../', import.meta.url);
const json = path => JSON.parse(fs.readFileSync(new URL(path, root)));
const bytes = packet => packet.data instanceof ArrayBuffer
  ? packet.data.byteLength + Buffer.byteLength(JSON.stringify({ ...packet, data: '' }))
  : Buffer.byteLength(JSON.stringify(packet));
function fixture() {
  const sim = createHuntSimulation({ spec: json('web/spec/hunt.json'), site: json('web/spec/site.json'), plan: json('web/spec/plan.generated.json'), seed: 'bandwidth' });
  let seq = 0;
  const players = Array.from({ length: 10 }, (_, i) => ({ id: `player-${i}`, name: `Игрок ${i}`, avatar: i, x: 1 + i * 0.55, y: 0, z: 4.3, yaw: 0, pitch: 0, weapon: 'rifle', score: i * 100, held: null, ack: 0,
    ammo: { pistol: { mag: 12, reserve: 48 }, rifle: { mag: 30, reserve: 120 }, bolt: { mag: 5, reserve: 30 }, shotgun: { mag: 2, reserve: 24 } } }));
  let effects = [];
  function effect(id, pellets = 1) {
    return { id, kind: 'shot', actorId: `player-${id % 10}`, shotId: `shot-${id}`, weapon: pellets === 9 ? 'shotgun' : 'rifle', origin: [1.2, 1.68, 4.3], direction: [0, 0, -1],
      rays: Array.from({ length: pellets }, (_, i) => ({ direction: [i * 0.001, i * 0.002, -1], effects: [{ objectId: `decor:room2.books/book-${id % 30}`, unitId: `decor:room2.books/unit-${id % 30}`, point: [1 + id * 0.01, 1.3, 3.5], normal: [0, 0, 1], kind: 'surface', breakable: 'paper' }] })), hits: [] };
  }
  return {
    effect,
    setEffects(value) { effects = value; },
    snapshot() {
      sim.step(0.05); seq++;
      return { type: 'snapshot', seq, time: seq * 0.05, epoch: 0, hostId: 'player-0', revision: 1,
        apartment: { floorA: 1, floorB: 3, sofa: 2, walls: 1 }, players: players.map(p => ({ ...p, x: p.x + Math.sin(seq * 0.03) * 0.1, ack: seq })), doors: { bath: false, balcony: true }, items: { phone: null, newspaper: null }, broken: ['book-1', 'glass-2'], effects: [...effects], hunt: sim.snapshot(), ambient: { water: { kitchen: false }, mice: [] } };
    },
  };
}

test('Full and compressed deltas reconstruct real hunt+10-player snapshots and bounded shot history', async () => {
  const f = fixture(), encoder = createSnapshotEncoder(), decoder = createSnapshotDecoder();
  let previousSeq = null;
  for (let i = 0; i < 12; i++) {
    f.setEffects(Array.from({ length: Math.min(4, i + 1) }, (_, n) => f.effect(Math.max(0, i - 3) + n)));
    const snapshot = f.snapshot(), prepared = encoder.prepare(snapshot);
    const wire = await (prepared.base === previousSeq && previousSeq !== null ? prepared.delta() : prepared.full());
    assert.deepEqual(await decoder.decode(wire), snapshot); previousSeq = snapshot.seq;
    assert.strictEqual(prepared.delta(), prepared.delta(), 'one compression promise is shared across the whole host fanout');
  }
});

test('Missing delta base is rejected and a full snapshot restores convergence', async () => {
  const f = fixture(), encoder = createSnapshotEncoder(), decoder = createSnapshotDecoder();
  const first = encoder.prepare(f.snapshot()); await decoder.decode(await first.full());
  encoder.prepare(f.snapshot());
  const thirdSnapshot = f.snapshot(), third = encoder.prepare(thirdSnapshot);
  await assert.rejects(decoder.decode(await third.delta()), /base mismatch/);
  assert.deepEqual(await decoder.decode(await third.full()), thirdSnapshot);
});

test('Animal death, pool replacement, removals and epoch clear preserve exact state', async () => {
  const encoder = createSnapshotEncoder(), decoder = createSnapshotDecoder();
  const states = [
    { type: 'snapshot', seq: 1, epoch: 0, effects: [{ id: 1, kind: 'shot' }], hunt: { time: 1, animals: [{ id: 'boar:0:1', hp: 100, dead: false, x: 1 }, { id: 'bird:0:1', hp: 1, dead: false, x: 2 }] } },
    { type: 'snapshot', seq: 2, epoch: 0, effects: [{ id: 1, kind: 'shot' }, { id: 2, kind: 'shot' }], hunt: { time: 2, animals: [{ id: 'boar:0:1', hp: 0, dead: true, x: 1 }, { id: 'bird:0:1', hp: 1, dead: false, x: 3 }] } },
    { type: 'snapshot', seq: 3, epoch: 1, effects: [], hunt: { time: 3, animals: [{ id: 'boar:0:2', hp: 100, dead: false, x: 4 }] } },
  ];
  for (const state of states) {
    const prepared = encoder.prepare(state);
    assert.deepEqual(await decoder.decode(await (state.seq === 1 ? prepared.full() : prepared.delta())), state);
  }
});

test('Compression is optional and a rolling 192-shot history is transmitted incrementally', async () => {
  const f = fixture(), encoder = createSnapshotEncoder({ compress: false }), decoder = createSnapshotDecoder();
  f.setEffects(Array.from({ length: 192 }, (_, i) => f.effect(i, 9)));
  const firstSnapshot = f.snapshot(), first = encoder.prepare(firstSnapshot); await decoder.decode(await first.full());
  f.setEffects(Array.from({ length: 192 }, (_, i) => f.effect(i + 1, 9)));
  const nextSnapshot = f.snapshot(), next = encoder.prepare(nextSnapshot), wire = await next.delta();
  assert.equal(wire.history.effects.add.length, 1); assert.equal(wire.history.effects.ids.length, 192);
  assert.ok(bytes(wire) < bytes(nextSnapshot) * 0.2);
  assert.deepEqual(await decoder.decode(wire), nextSnapshot);
});

test('Measure bandwidth: real 10-player wildlife frames with maximum retained shotgun history', async () => {
  const f = fixture(), encoder = createSnapshotEncoder();
  let raw = 0, encoded = 0, previousSeq = null, maxFrame = 0;
  const started = performance.now();
  for (let i = 0; i < 40; i++) {
    f.setEffects(Array.from({ length: 192 }, (_, n) => f.effect(n + Math.floor(i / 2), 9)));
    const frame = f.snapshot(), prepared = encoder.prepare(frame);
    const wire = await (previousSeq !== null && prepared.base === previousSeq ? prepared.delta() : prepared.full());
    raw += bytes(frame); encoded += bytes(wire); maxFrame = Math.max(maxFrame, bytes(wire)); previousSeq = frame.seq;
  }
  const result = { frames: 40, players: 10, hz: 20, retainedShots: 192, pellets: 9,
    rawAverageBytes: Math.round(raw / 40), wireAverageBytes: Math.round(encoded / 40), maxWireBytes: maxFrame,
    reductionPercent: Math.round((1 - encoded / raw) * 1000) / 10,
    hostUploadMbitPerSecondFor9Guests: Math.round(encoded / 40 * 20 * 9 * 8 / 1e6 * 100) / 100,
    encodeMsPerFrame: Math.round((performance.now() - started) / 40 * 100) / 100 };
  console.log('BANDWIDTH', JSON.stringify(result));
  assert.ok(encoded < raw * 0.15);
});
