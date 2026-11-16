import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { createNetworkRaycastAcceleration } from '../../web/js/network-raycast.js';

function fixture() {
  const scene = new THREE.Scene(), geometry = new THREE.SphereGeometry(1, 24, 16), material = new THREE.MeshBasicMaterial();
  const a = new THREE.Mesh(geometry, material), b = new THREE.Mesh(geometry, material); b.position.x = 4; scene.add(a, b); scene.updateMatrixWorld(true);
  const callbacks = new Map(); let serial = 0, builds = 0, accelerated = 0;
  const library = { MeshBVH: class { constructor() { builds++; } }, acceleratedRaycast(ray, hits) { accelerated++; THREE.Mesh.prototype.raycast.call(this, ray, hits); } };
  const options = { THREE, scene, loadLibrary: async () => library,
    scheduleIdle: fn => { const id = ++serial; callbacks.set(id, fn); return id; }, cancelIdle: id => callbacks.delete(id) };
  const drain = () => { let count = 0; while (callbacks.size) { assert.ok(count++ < 1000); const [id, fn] = callbacks.entries().next().value; callbacks.delete(id); fn(); } };
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 4), new THREE.Vector3(0, 0, -1));
  return { scene, geometry, material, a, b, options, drain, ray, callbacks, get builds() { return builds; }, get accelerated() { return accelerated; } };
}

test('shared static geometries build once, preserve authored data and restore exact mesh callbacks on disposal', async () => {
  const f = fixture(), acceleration = createNetworkRaycastAcceleration(f.options), original = f.a.raycast, indices = f.geometry.index.array.slice();
  const expected = f.ray.intersectObject(f.a).map(h => [h.distance, h.faceIndex, ...h.point.toArray()]);
  try {
    await acceleration.start(); f.drain(); assert.equal(f.builds, 1); assert.equal(acceleration.status.accelerated, 2);
    assert.deepEqual(f.ray.intersectObject(f.a).map(h => [h.distance, h.faceIndex, ...h.point.toArray()]), expected); assert.ok(f.accelerated > 0);
    assert.deepEqual(f.geometry.index.array, indices); assert.equal(THREE.Mesh.prototype.raycast, original);
    await acceleration.start(); f.drain(); assert.equal(f.builds, 1, 'start is idempotent across role changes');
  } finally { acceleration.dispose(); }
  assert.equal(f.a.raycast, original); assert.equal(f.geometry.boundsTree, undefined); assert.equal(f.callbacks.size, 0);
  assert.equal(await acceleration.start(), false, 'a late afterRoom callback cannot resurrect a disposed scene');
});

test('two owners of the same meshes and tree stop independently without duplicate builds or premature restoration', async () => {
  const f = fixture(), a = createNetworkRaycastAcceleration(f.options), b = createNetworkRaycastAcceleration(f.options);
  try {
    await a.start(); f.drain(); const wrapper = f.a.raycast, tree = f.geometry.boundsTree;
    await b.start(); f.drain(); assert.equal(f.builds, 1); assert.equal(f.a.raycast, wrapper);
    a.stop(); assert.equal(f.a.raycast, wrapper); assert.equal(f.geometry.boundsTree, tree);
    f.ray.intersectObject(f.a); assert.ok(f.accelerated > 0);
    b.dispose(); assert.equal(f.a.raycast, THREE.Mesh.prototype.raycast); assert.equal(f.geometry.boundsTree, undefined);
  } finally { a.dispose(); b.dispose(); }
});

test('position/index version changes use exact fallback immediately and rebuild once during idle work', async () => {
  const f = fixture(), a = createNetworkRaycastAcceleration(f.options);
  try {
    await a.start(); f.drain(); const before = f.accelerated;
    f.geometry.attributes.position.needsUpdate = true;
    f.ray.intersectObject(f.a); assert.equal(f.accelerated, before); assert.equal(f.geometry.boundsTree, undefined);
    a.update(); f.drain(); assert.equal(f.builds, 2); f.ray.intersectObject(f.a); assert.ok(f.accelerated > before);
    f.geometry.index.needsUpdate = true; f.ray.intersectObject(f.a); a.update(); f.drain(); assert.equal(f.builds, 3);
  } finally { a.dispose(); }
});

test('a replaced geometry is queued again, and removal/reinsertion cannot get stuck in a permanent WeakSet', async t => {
  const f = fixture(), a = createNetworkRaycastAcceleration(f.options);
  try {
    await a.start(); f.drain(); const old = f.geometry.boundsTree;
    f.a.geometry = new THREE.SphereGeometry(1, 32, 16);
    f.ray.intersectObject(f.a); a.update(); f.drain(); assert.equal(f.builds, 2); assert.notEqual(f.a.geometry.boundsTree, old);
    f.a.removeFromParent(); const now = performance.now(); const clock = t.mock.method(performance, 'now', () => now + 1100);
    a.update(); f.drain(); assert.equal(f.a.raycast, THREE.Mesh.prototype.raycast); assert.equal(f.a.geometry.boundsTree, undefined);
    f.scene.add(f.a); clock.mock.restore(); t.mock.method(performance, 'now', () => now + 2200);
    a.update(); f.drain(); assert.equal(a.status.accelerated, 2); assert.equal(f.builds, 3);
  } finally { a.dispose(); }
});

test('borrowed trees and externally replaced raycast callbacks are never destroyed or overwritten', async () => {
  const f = fixture(), external = {}; f.geometry.boundsTree = external;
  const a = createNetworkRaycastAcceleration(f.options);
  await a.start(); f.drain(); assert.equal(f.builds, 0);
  const callback = () => {}; f.a.raycast = callback;
  a.dispose(); assert.equal(f.geometry.boundsTree, external); assert.equal(f.a.raycast, callback); assert.equal(f.b.raycast, THREE.Mesh.prototype.raycast);
});

test('a sheared parent falls back immediately and ordinary transforms resume acceleration without rebuilding', async () => {
  const f = fixture(), a = createNetworkRaycastAcceleration(f.options);
  try {
    await a.start(); f.drain(); const before = f.accelerated;
    const parent = new THREE.Group(); parent.scale.set(2, 1, 1); f.scene.add(parent); parent.add(f.a); f.a.rotation.z = Math.PI / 4; f.scene.updateMatrixWorld(true);
    f.ray.intersectObject(f.a); assert.equal(f.accelerated, before);
    f.a.rotation.z = 0; f.scene.updateMatrixWorld(true); f.ray.intersectObject(f.a);
    assert.ok(f.accelerated > before); assert.equal(f.builds, 1);
  } finally { a.dispose(); }
});

test('transient actors, custom raycasts, dynamic vertices and partial/group-gap draw ranges stay authored', async () => {
  const f = fixture();
  const actor = new THREE.Group(); actor.userData.networkEntity = true; actor.add(f.a); f.scene.add(actor);
  f.b.raycast = () => {};
  const dynamic = new THREE.Mesh(f.geometry.clone(), f.material); dynamic.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const partial = new THREE.Mesh(f.geometry.clone(), f.material); partial.geometry.setDrawRange(3, 60);
  const gap = new THREE.Mesh(f.geometry.clone(), [f.material]); gap.geometry.addGroup(3, gap.geometry.index.count - 3, 0);
  f.scene.add(dynamic, partial, gap);
  const a = createNetworkRaycastAcceleration(f.options);
  try { await a.start(); f.drain(); assert.equal(a.status.accelerated, 0); assert.equal(f.builds, 0); }
  finally { a.dispose(); }
});

test('dispose cancels queued idle callbacks and pending library completion without touching the scene', async () => {
  const f = fixture(); let resolve;
  const a = createNetworkRaycastAcceleration({ ...f.options, loadLibrary: () => new Promise(done => { resolve = done; }) });
  const ready = a.start(); await Promise.resolve(); a.dispose(); resolve({}); await ready; f.drain();
  assert.equal(a.status.active, false); assert.equal(f.callbacks.size, 0); assert.equal(f.a.raycast, THREE.Mesh.prototype.raycast);
  const b = createNetworkRaycastAcceleration(f.options); await b.start(); assert.ok(f.callbacks.size > 0); b.dispose();
  assert.equal(f.callbacks.size, 0); assert.equal(f.geometry.boundsTree, undefined);
});
