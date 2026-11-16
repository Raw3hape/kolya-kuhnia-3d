import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assignNetworkObjectIds, stableObjectId, loosePropMaterial, seededRandom } from '../../web/js/network-objects.js';
import { createHuntSimulation } from '../../web/js/multiplayer/hunt-simulation.js';
import { WEAPON_RULES } from '../../web/js/multiplayer/rules.js';

const root = new URL('../../', import.meta.url);
const json = path => JSON.parse(fs.readFileSync(new URL(path, root)));
const spec = json('web/spec/hunt.json'), site = json('web/spec/site.json'), plan = json('web/spec/plan.generated.json');
const makeSim = seed => createHuntSimulation({ spec, site, plan, seed });

function node(name = '', x = 0) {
  return { name, type: 'Group', userData: {}, position: { x, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 }, children: [] };
}
function add(parent, child) { parent.children.push(child); child.parent = parent; return child; }

test('asset IDs survive async scene arrivals, growth, movement, and equivalent loading order', () => {
  const build = reverse => {
    const scene = { isScene: true, children: [] }, holder = add(scene, node('d_room2_decor_set_4'));
    const asset = add(holder, node('asset'));
    const book = add(asset, node('book')), toy = add(asset, node('camper-toy'));
    if (reverse) asset.children.reverse();
    assignNetworkObjectIds(asset, 'decor:room2.decor.set.4');
    return { scene, holder, book, toy };
  };
  const a = build(false), b = build(true), bookId = stableObjectId(a.book), toyId = stableObjectId(a.toy);
  assert.equal(bookId, stableObjectId(b.book)); assert.equal(toyId, stableObjectId(b.toy)); assert.notEqual(bookId, toyId);
  a.holder.position.x = 88; a.book.scale.x = 0.01; add(a.scene, node('a_late_model'));
  assert.equal(stableObjectId(a.book), bookId);
  assert.ok(bookId.length < 128);
});

test('named door IDs stay stable when its pivot turns', () => {
  const scene = { isScene: true, children: [] }, door = add(scene, node('door_bath'));
  const glass = add(door, node('glass'));
  const id = stableObjectId(glass);
  door.quaternion.y = 0.7; door.quaternion.w = 0.7;
  assert.equal(stableObjectId(glass), id);
});

test('every current loose prop option, books and room2 toys has a destruction material', () => {
  let looseParts = 0, bookVariants = 0, toys = 0;
  const directory = fileURLToPath(new URL('web/spec/decor/', root));
  for (const filename of fs.readdirSync(directory).filter(n => n.endsWith('.json') && n !== 'index.json')) {
    const doc = json(`web/spec/decor/${filename}`);
    for (const slot of doc.slots ?? []) for (const option of slot.options ?? []) for (const part of option.parts ?? []) {
      const model = part.model;
      if (!model) continue;
      const explicitLoose = model.startsWith('models/decor/props/') || /-toy\/|\/figs-|\/cat-cloudy\//.test(model);
      if (explicitLoose) { looseParts++; assert.ok(loosePropMaterial(model, { slot: slot.id }), `${filename}/${option.id}: ${model}`); }
      if (model.includes('/books-')) { bookVariants++; assert.equal(loosePropMaterial(model), 'paper'); }
      if (/-toy\/|\/figs-|\/cat-cloudy\//.test(model)) { toys++; assert.ok(loosePropMaterial(model)); }
    }
  }
  assert.ok(looseParts > 150, `expected catalog-wide coverage; got ${looseParts}`);
  assert.ok(bookVariants > 15); assert.ok(toys >= 4);
  assert.equal(loosePropMaterial('models/decor/props/new-future-prop/model.glb'), 'plastic');
  assert.equal(loosePropMaterial('models/decor/room2/unknown-future-toy/model.glb'), 'plastic');
  assert.equal(loosePropMaterial('models/decor/props/plant-pothos/model.glb', { nodeName: 'leaves' }), 'foliage');
  assert.equal(loosePropMaterial('models/decor/props/plant-pothos/model.glb', { nodeName: 'pot' }), 'ceramic');
  assert.equal(loosePropMaterial('models/decor/room2/pax-bergsbo-150/model.glb', { slot: 'wardrobe' }), null);
});

test('seeded authority sim is deterministic, bounded and uses safe habitats', () => {
  const a = makeSim('room-a'), b = makeSim('room-a');
  for (let i = 0; i < 240; i++) { a.step(1 / 60); b.step(1 / 60); }
  const snapshot = a.snapshot();
  assert.deepEqual(snapshot, b.snapshot());
  assert.equal(snapshot.animals.filter(a => a.kind === 'boar').length, spec.boars.count);
  assert.ok(snapshot.animals.length <= spec.boars.count + spec.birds.pool);
  assert.ok(JSON.stringify(snapshot).length < 64000);
  assert.equal(new Set(snapshot.animals.map(a => a.id)).size, snapshot.animals.length);
  for (const animal of snapshot.animals) assert.ok([animal.x, animal.y, animal.z, animal.yaw, animal.scale].every(Number.isFinite));
});

test('authority rejects fake weapons and clipped hits, awards one kill, and restores poses', () => {
  const sim = makeSim('combat'), target = sim.snapshot().animals.find(a => a.kind === 'boar');
  const origin = [target.x, target.y + 0.62 * target.scale, target.z - 5], direction = [0, 0, 1];
  assert.equal(sim.hit({ origin, direction, weapon: 'admin-cannon' }), null);
  assert.equal(sim.hit({ origin, direction, weapon: 'bolt', range: 0.1 }), null);
  const hit = sim.hit({ origin, direction, weapon: 'bolt', playerId: 'A' });
  assert.equal(hit.animalId, target.id); assert.equal(hit.killed, true); assert.ok(hit.points > 0);
  assert.ok(WEAPON_RULES.bolt.damage >= spec.boars.hp.adult);
  const second = sim.hit({ origin, direction, weapon: 'bolt', playerId: 'B' });
  assert.ok(!second || second.animalId !== target.id, 'dead target must never award twice');
  const restored = makeSim('different'); assert.equal(restored.restore(sim.snapshot()), true);
  assert.deepEqual(restored.snapshot(), sim.snapshot());
  sim.step(1); assert.ok(sim.snapshot().animals.find(a => a.id === target.id).fall > 0);
});

test('effect RNG is repeatable across clients and does not touch Math.random', () => {
  const original = Math.random, a = seededRandom('shot:7:0'), b = seededRandom('shot:7:0');
  assert.deepEqual(Array.from({ length: 40 }, a), Array.from({ length: 40 }, b));
  assert.equal(Math.random, original);
});
