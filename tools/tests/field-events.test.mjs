import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFieldEventSimulation, EVENT_KINDS } from '../../web/js/field-events-simulation.js';
import { buildHuntRegions } from '../../web/js/hunt-regions.js';
import { createHuntSimulation } from '../../web/js/multiplayer/hunt-simulation.js';
import { createSnapshotEncoder, createSnapshotDecoder } from '../../web/js/multiplayer/snapshot-codec.js';
import { validate } from '../../api/_scores-core.js';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { collectFieldOccluders, fieldRayBlocked } from '../../web/js/field-events-visibility.js';
import { createFieldEventView } from '../../web/js/field-events-view.js';

const json = p => JSON.parse(fs.readFileSync(new URL('../../' + p, import.meta.url)));
const authored = json('web/spec/hunt.json'), site = json('web/spec/site.json'), plan = json('web/spec/plan.generated.json');
// Exercise rare events in seconds; production timing is checked separately below.
const spec = { ...authored, events: { ...authored.events, earlyChance: 0, first: 8, every: [29, 38] } };
const region = buildHuntRegions(site, spec.region, [0, 0], () => 0.5)[0], ground = -site.floorY;
const make = (seed = 123) => createFieldEventSimulation({ spec, region, ground, seed });
const advance = (s, seconds) => { for (let i = 0; i < seconds * 60; i++) s.step(1 / 60); };
function aim(e) {
    const origin = [e.x, e.y + (['police', 'tractor'].includes(e.kind) ? 1 : 0), e.z + 12];
  return { origin, direction: [0, 0, -1], weapon: 'rifle', range: 100 };
}

test('encounters choose all configured kinds, stay bounded and follow safe field lanes', () => {
  const s = make(), seen = new Set();
  assert.ok(s.lanes.length > 3);
  for (const lane of s.lanes) for (let i = 0; i <= 20; i++) {
    assert.ok(region.safe(lane.from[0] + (lane.to[0] - lane.from[0]) * i / 20, lane.from[1], 4));
  }
  for (let i = 0; i < 600 * 60; i++) {
    s.step(1 / 60); const state = s.snapshot(); assert.ok(state.events.length <= 2);
    for (const e of state.events) { seen.add(e.kind); assert.ok(e.x >= Math.min(e.from[0], e.to[0]) - 0.01); }
  }
  assert.deepEqual([...seen].sort(), [...EVENT_KINDS].sort());
});

test('health is shared, a kill is credited once, dead targets stop intercepting rays', () => {
  const s = make(); advance(s, 10); const e = s.snapshot().events[0], ray = aim(e);
  assert.equal(s.hit({ ...ray, weapon: 'none' }), null);
  assert.equal(s.hit({ ...ray, range: 0.5 }), null);
  assert.equal(s.hit({ ...ray, direction: [NaN, 0, -1] }), null);
  assert.equal(s.hit(ray).hp, e.maxHp - Math.round(28 * (spec.events.types[e.kind].armor ?? 1)));
  const partial = s.snapshot(), late = make(999); assert.ok(late.restore(partial)); assert.deepEqual(late.snapshot(), partial);
  let credit = 0;
  for (let i = 0; i < 100; i++) credit += s.hit({ ...ray, playerId: i % 2 ? 'guest' : 'host' })?.points || 0;
  assert.equal(credit, spec.events.types[e.kind].points); assert.equal(s.raycast(ray.origin, ray.direction, ray.range), null);
  assert.ok(s.snapshot().events[0].dead); advance(s, 10); assert.equal(s.snapshot().events.some(x => x.id === e.id), false);
});

test('aircraft tumble and reach the same crash point after snapshot restoration', () => {
  const s = fixtureKind('drone'); const e = s.snapshot().events.find(e => e.kind === 'drone');
  assert.ok(e); const ray = aim(e); for (let i = 0; i < 4; i++) s.hit(ray);
  const dead = s.snapshot(); assert.ok(dead.events.find(x => x.id === e.id).dead);
  const restored = make(4); assert.ok(restored.restore(dead));
  advance(s, 3); advance(restored, 3);
  const a = s.snapshot().events.find(x => x.id === e.id), b = restored.snapshot().events.find(x => x.id === e.id);
  assert.ok(a.impactAge > 0); assert.ok(Math.abs(a.y - ground - 0.7) < 0.01); assert.ok(Math.abs(a.x - b.x) < 0.01);
  assert.ok(Math.abs(a.roll) > 0.5);
});

test('authority uses the same event hitboxes, respects range and carries events in delta frames', async () => {
  const s = createHuntSimulation({ spec, site, plan, seed: 123 }); advance(s, 10);
  const state = s.snapshot(), e = state.encounters.events[0], ray = aim(e);
  assert.equal(s.hit({ ...ray, range: 0.1 }), null);
  const hit = s.hit(ray); assert.ok(hit.event); assert.equal(hit.animalId, e.id); assert.equal(hit.hp, e.maxHp - Math.round(28 * (spec.events.types[e.kind].armor ?? 1)));
  const encoder = createSnapshotEncoder({ compress: false }), decoder = createSnapshotDecoder();
  const first = { type: 'snapshot', seq: 1, epoch: 1, hunt: state };
  const next = { type: 'snapshot', seq: 2, epoch: 1, hunt: s.snapshot() };
  const full = await encoder.prepare(first).full(); await decoder.decode(full);
  const delta = await encoder.prepare(next).delta();
  const decoded = await decoder.decode(delta);
  assert.deepEqual(decoded.hunt.encounters, next.hunt.encounters);
});

test('score submission accepts wildlife plus event targets and rejects fabricated totals', () => {
  const result = { name: 'QA', score: 650, kills: 1, boars: 0, birds: 0, targets: 1, shots: 10, level: 1, round: spec.round };
  assert.ok(validate(result).entry); assert.ok(validate({ ...result, targets: 2 }).error);
  assert.ok(validate({ ...result, targets: -1 }).error);
  assert.ok(validate({ ...result, targets: 0, boars: 1 }).entry);
});

test('new launches randomize frequent encounters and never immediately repeat a kind', () => {
  const first = new Set(), kinds = new Set(); let early = 0;
  for (let seed = 0; seed < 100; seed++) {
    const s = createFieldEventSimulation({ spec: authored, region, ground, seed });
    const initial = s.snapshot(); first.add(initial.next); if (initial.next < authored.events.first[0]) early++;
    assert.ok(initial.next >= authored.events.early[0] && initial.next <= authored.events.first[1]);
    // Restore just before the scheduled encounter to avoid a real ten-minute wait.
    assert.ok(s.restore({ ...initial, time: initial.next - 0.01 })); s.step(0.02);
    const after = s.snapshot(); kinds.add(after.events[0].kind);
    assert.ok(after.next - after.time >= authored.events.every[0] - 0.1 && after.next - after.time <= authored.events.every[1]);
    const previous = after.events[0].kind;
    assert.ok(s.restore({ ...after, time: after.next - 0.01, events: [] })); s.step(0.02);
    assert.notEqual(s.snapshot().events[0].kind, previous);
  }
  assert.ok(first.size > 90); assert.ok(early > 30 && early < 70); assert.equal(kinds.size, EVENT_KINDS.length);
});

function fixtureKind(kind) {
  for (let seed = 0; seed < 100; seed++) {
    const s = make(seed); advance(s, 10);
    if (s.snapshot().events[0]?.kind === kind) return s;
  }
  throw new Error('No seeded fixture for ' + kind);
}

test('patrol turns, drifts, stays inside habitat and leaves if not destroyed', () => {
  const s = fixtureKind('police'), id = s.snapshot().events[0].id;
  let drift = 0, yaw = 0, maxSpeed = 0, previous = s.snapshot().events[0];
  for (let i = 0; i < 120 * 60; i++) {
    s.step(1 / 60); const e = s.snapshot().events.find(e => e.id === id); if (!e) break;
    assert.ok(region.safe(e.x, e.z, 2));
    drift = Math.max(drift, Math.abs(e.drift)); yaw = Math.max(yaw, Math.abs(Math.atan2(Math.sin(e.yaw - previous.yaw), Math.cos(e.yaw - previous.yaw))));
    maxSpeed = Math.max(maxSpeed, Math.hypot(e.x - previous.x, e.z - previous.z) * 60); previous = e;
  }
  assert.ok(drift > 0.25); assert.ok(yaw < 0.35); assert.ok(maxSpeed > 8 && maxSpeed < 20);
  assert.equal(s.snapshot().events.some(e => e.id === id), false);
});

test('airplane travels at aircraft speed with banked S turns and departs far away', () => {
  const s = fixtureKind('plane'), first = s.snapshot().events[0], id = first.id;
  assert.ok(Math.abs(first.from[0] - first.to[0]) >= 1400);
  let minZ = Infinity, maxZ = -Infinity, bank = 0, previous = first, far = first;
  for (let i = 0; i < 70 * 60; i++) {
    s.step(1 / 60); const e = s.snapshot().events.find(e => e.id === id); if (!e) break;
    const speed = Math.hypot(e.x - previous.x, e.y - previous.y, e.z - previous.z) * 60;
    assert.ok(speed > 26 && speed < 36); bank = Math.max(bank, Math.abs(e.roll));
    minZ = Math.min(minZ, e.z); maxZ = Math.max(maxZ, e.z); previous = far = e;
  }
  assert.ok(maxZ - minZ > 45); assert.ok(bank > 0.4); assert.ok(Math.abs(far.x) > 650);
  assert.equal(s.snapshot().events.some(e => e.id === id), false);
});

test('tractor armor ricochets and cargo detaches independently with one-time credit', () => {
  const s = fixtureKind('tractor'), e = s.snapshot().events[0];
  const bodyHit = s.hit(aim(e)); assert.equal(bodyHit.hp, 1400 - 17); assert.ok(bodyHit.ricochet);
  const sign = Math.sin(e.yaw), cargo = [e.x - sign * 3.6, e.y + 1.65, e.z];
  const ray = { origin: [cargo[0], cargo[1], cargo[2] + 10], direction: [0, 0, -1], weapon: 'bolt', range: 30 };
  const result = s.hit(ray); assert.ok(result.cargo); assert.ok(result.killed); assert.equal(result.points, 250);
  const state = s.snapshot().events[0]; assert.equal(state.hp, bodyHit.hp); assert.equal(state.dead, false); assert.ok(state.cargoDead);
  assert.equal(s.hit(ray)?.cargo, undefined); const late = make(555); assert.ok(late.restore(s.snapshot())); assert.ok(late.snapshot().events[0].cargoDead);
});

test('HP occlusion excludes real Three sprites and avatars before tracing but retains cutaway walls', () => {
  const scene = new THREE.Scene(), eventRoot = new THREE.Group(), avatar = new THREE.Group();
  avatar.userData.networkAvatar = true;
  const geometry = new THREE.BoxGeometry(2, 2, 0.2), material = new THREE.MeshBasicMaterial();
  const wall = new THREE.Mesh(geometry, material); wall.position.z = -5; wall.layers.set(1);
  const label = new THREE.Sprite(), actor = new THREE.Mesh(geometry, material), target = actor.clone(), glass = actor.clone();
  glass.userData.glass = true; eventRoot.add(target); avatar.add(actor, label); scene.add(eventRoot, avatar, wall, glass); scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)); ray.layers.enable(1);
  // Sprite.raycast would throw without ray.camera; they are never solid walls.
  const objects = collectFieldOccluders(scene, eventRoot); assert.deepEqual(objects, [wall]);
  assert.ok(ray.intersectObjects(objects, false).length > 0);
  geometry.dispose(); material.dispose(); label.material.dispose();
});

test('HP visibility stops at an opaque wall while transparent and non-writing surfaces cannot hide a target', () => {
  const geometry = new THREE.BoxGeometry(2, 2, 0.2);
  const solid = new THREE.MeshBasicMaterial(), clear = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.01 });
  const mask = new THREE.MeshBasicMaterial({ colorWrite: false });
  const wall = new THREE.Mesh(geometry, solid), pane = new THREE.Mesh(geometry, clear), hole = new THREE.Mesh(geometry, mask);
  wall.position.z = -5; pane.position.z = -2; hole.position.z = -3;
  for (const mesh of [wall, pane, hole]) mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 0, 20);
  const costlyRoom = { raycast() { throw new Error('Occluded furnished rooms must not be traced'); }, layers: new THREE.Layers() };
  assert.equal(fieldRayBlocked(ray, [pane, hole]), false);
  assert.equal(fieldRayBlocked(ray, [pane, hole, wall, costlyRoom]), true);
  ray.far = 4;
  assert.equal(fieldRayBlocked(ray, [pane, hole, wall]), false, 'a surface behind the target is not an occluder');
  wall.layers.set(1); ray.far = 20;
  assert.equal(fieldRayBlocked(ray, [wall]), false);
  ray.layers.enable(1);
  assert.equal(fieldRayBlocked(ray, [wall]), true, 'cutaway walls retain occlusion');
  geometry.dispose(); solid.dispose(); clear.dispose(); mask.dispose();
});

test('HP candidate collection prunes hidden and actor subtrees before visiting their meshes', () => {
  const scene = new THREE.Scene(), hidden = new THREE.Group(), avatar = new THREE.Group(), world = new THREE.Group();
  hidden.visible = false; avatar.userData.networkAvatar = true;
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const wall = new THREE.Mesh(geometry, material); world.add(wall);
  // A getter provides behavioral evidence that neither excluded subtree is scanned.
  for (const root of [hidden, avatar]) root.add(new THREE.Object3D());
  for (const root of [hidden, avatar]) Object.defineProperty(root.children[0], 'visible', { get() { throw new Error('Excluded subtree was visited'); } });
  scene.add(hidden, avatar, world);
  assert.deepEqual(collectFieldOccluders(scene, null), [wall]);
  geometry.dispose(); material.dispose();
});

test('offscreen and photo encounters skip world raycasts while a visible target still tests occlusion', () => {
  const element = () => ({ style: {}, append() {}, remove() {}, setAttribute() {}, getContext: () => ({ fillRect() {}, fillText() {} }) });
  const oldDocument = globalThis.document, oldWidth = globalThis.innerWidth, oldHeight = globalThis.innerHeight;
  globalThis.document = { createElement: element, getElementById: () => true, body: element(), head: element() };
  globalThis.innerWidth = 800; globalThis.innerHeight = 600;
  let view;
  try {
    const simulation = make(42); advance(simulation, 9);
    const event = simulation.snapshot().events[0]; assert.ok(event);
    const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 2000);
    camera.position.set(0, 1.5, 0); camera.updateMatrixWorld(true);
    view = createFieldEventView({ THREE, parent: new THREE.Scene(), camera, ground, rules: spec.events });
    let traces = 0;
    const update = (pose, options = {}) => view.update({ events: [{ ...event, ...pose }] }, { visible: true, walking: true, canSee() { traces++; return true; }, ...options });
    update({ x: 0, y: 0, z: 30 }); assert.equal(traces, 0, 'behind camera');
    update({ x: 1000, y: 0, z: -30 }); assert.equal(traces, 0, 'outside viewport');
    update({ x: 0, y: 0, z: -30 }, { visible: false }); assert.equal(traces, 0, 'photo/hidden mode');
    update({ x: 0, y: 0, z: -30 }); assert.equal(traces, 1, 'onscreen target remains occluded by the real world');
  } finally {
    view?.dispose(); globalThis.document = oldDocument; globalThis.innerWidth = oldWidth; globalThis.innerHeight = oldHeight;
  }
});
