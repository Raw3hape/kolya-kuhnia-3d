import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { createHunt } from '../../web/js/hunt.js';

const json = path => JSON.parse(fs.readFileSync(new URL('../../' + path, import.meta.url)));

async function withWildlife(run) {
  const element = () => ({ style: {}, append() {}, appendChild() {}, remove() {}, querySelector: () => element(),
    setAttribute() {}, getContext: () => ({ fillRect() {}, fillText() {}, createRadialGradient: () => ({ addColorStop() {} }) }) });
  const oldDocument = globalThis.document, oldFetch = globalThis.fetch;
  globalThis.document = { createElement: element, getElementById: () => true, body: element(), head: element() };
  const spec = json('web/spec/hunt.json'), site = json('web/spec/site.json'), plan = json('web/spec/plan.generated.json');
  globalThis.fetch = async () => ({ json: async () => spec });
  let hunt;
  try {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 1000), ground = -site.floorY;
    camera.position.set(-100, ground + 1, 0); camera.lookAt(-100, ground + 0.6, 30); camera.updateMatrixWorld(true);
    hunt = createHunt({ THREE, scene, camera, renderer: { domElement: element() }, pipe: {}, plan, site, getWalk: () => ({ active: true }) });
    for (let i = 0; i < 20 && !hunt.stats.ready; i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(hunt.stats.ready);
    const [boar, blob, bird] = scene.getObjectByName('hunt').children.filter(o => o.isInstancedMesh);
    const pose = (kind, i, extra = {}) => ({ kind, i, id: `${kind}:${i}:test`, generation: 1, active: true, dead: false, hp: 100,
      x: -100 + i * 0.1, y: ground, z: 30, yaw: 0.13, scale: 1, phase: 0.2, gait: 0.6, graze: 0.3, alert: 0.4,
      fall: 0.1, fade: 0.2, flash: 0.7, pitch: 0.1, roll: 0.2, amp: 0.8, fold: 0.6, peck: 0.4, fat: 1.3, birdKind: 2, sp: 'duck', ...extra });
    const present = animals => { hunt.applyNetworkSnapshot({ time: 1, animals, encounters: { events: [] } }, 0); hunt.update(0); };
    await run({ hunt, scene, camera, ground, spec, boar, blob, bird, pose, present });
  } finally { hunt?.dispose(); globalThis.document = oldDocument; globalThis.fetch = oldFetch; }
}

function packed(mesh, slot) {
  return {
    matrix: [...mesh.instanceMatrix.array.slice(slot * 16, slot * 16 + 16)],
    color: [...mesh.instanceColor.array.slice(slot * 3, slot * 3 + 3)],
    motion: [...mesh.geometry.attributes.aMot.array.slice(slot * 4, slot * 4 + 4)],
    state: [...mesh.geometry.attributes.aSt.array.slice(slot * 4, slot * 4 + 4)],
    seed: mesh.geometry.attributes.aSeed?.getX(slot),
  };
}

test('network wildlife keeps poses current without hidden GPU uploads and resumes immediately on camera turn', async () => {
  const element = () => ({ style: {}, append() {}, appendChild() {}, remove() {}, querySelector: () => element(),
    setAttribute() {}, getContext: () => ({ fillRect() {}, fillText() {}, createRadialGradient: () => ({ addColorStop() {} }) }) });
  const oldDocument = globalThis.document, oldFetch = globalThis.fetch;
  globalThis.document = { createElement: element, getElementById: () => true, body: element(), head: element() };
  const spec = json('web/spec/hunt.json'), site = json('web/spec/site.json'), plan = json('web/spec/plan.generated.json');
  globalThis.fetch = async () => ({ json: async () => spec });
  let hunt;
  try {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 1000), ground = -site.floorY;
    camera.position.set(-100, ground + 1, 0); camera.updateMatrixWorld(true);
    hunt = createHunt({ THREE, scene, camera, renderer: { domElement: element() }, pipe: {}, plan, site, getWalk: () => ({ active: true }) });
    for (let i = 0; i < 20 && !hunt.stats.ready; i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(hunt.stats.ready, 'actual procedural wildlife finished loading');
    hunt.setNetwork(true);
    const pose = { kind: 'boar', i: 0, id: 'boar:0:1', generation: 1, active: true, dead: false, hp: 100,
      x: -100, y: ground, z: 30, yaw: 0, scale: 1, phase: 0, gait: 0, graze: 0, alert: 0, fall: 0, fade: 0, flash: 0 };
    const snapshot = { time: 1, animals: [pose], encounters: { events: [] } };
    hunt.applyNetworkSnapshot(snapshot, 0);
    const meshes = scene.getObjectByName('hunt').children.filter(o => o.isInstancedMesh);
    assert.equal(meshes.length, 3);
    const versions = meshes.map(o => o.instanceMatrix.version);
    for (let i = 0; i < 10; i++) hunt.update(1 / 60);
    assert.ok(meshes.every(o => !o.visible));
    assert.deepEqual(meshes.map(o => o.instanceMatrix.version), versions, 'offscreen buffers are not uploaded');
    hunt.applyNetworkSnapshot({ ...snapshot, animals: [{ ...pose, x: -98 }] }, 10);
    for (let i = 0; i < 10; i++) hunt.update(1 / 60);
    assert.ok(hunt.debug.boars[0].x > -99, 'authoritative poses still interpolate while invisible');
    assert.deepEqual(meshes.map(o => o.instanceMatrix.version), versions, 'snapshot receipt does not cause a duplicate upload');
    camera.lookAt(-98, ground + 0.6, 30); camera.updateMatrixWorld(true);
    assert.equal(hunt.update(1 / 60), true);
    assert.ok(meshes.every(o => o.visible));
    assert.ok(meshes.every((o, i) => o.instanceMatrix.version === versions[i] + 1), 'first visible frame presents current buffers once');
    assert.equal(hunt.stats.score, 10);
    hunt.setNetwork(false);
    hunt.update(1 / 60);
    assert.ok(hunt.stats.alive.boars > 0, 'leaving restores the local wildlife');
  } finally {
    hunt?.dispose(); globalThis.document = oldDocument; globalThis.fetch = oldFetch;
  }
});

test('visible wildlife is packed without changing later actors, canonical hit IDs, palettes or shader phases', async () => {
  await withWildlife(({ hunt, camera, ground, boar, blob, bird, pose, present }) => {
    hunt.setNetwork(true);
    const a = pose('boar', 0), b = pose('boar', 3), c = pose('bird', 0), d = pose('bird', 7);
    present([a, b, c, d]);
    assert.deepEqual([boar.count, blob.count, bird.count], [2, 2, 2]);
    const savedBoar = packed(boar, 1), savedBird = packed(bird, 1), savedShadow = [...blob.instanceMatrix.array.slice(16, 32)];
    assert.equal(savedBoar.seed, 3);
    // Deliberate GPU-buffer corruption must not contaminate canonical palettes.
    boar.instanceColor.array.fill(0); bird.instanceColor.array.fill(0);
    present([{ ...a, id: 'boar:0:behind', z: -30 }, b, { ...c, id: 'bird:0:behind', z: -30 }, d]);
    assert.deepEqual([boar.count, blob.count, bird.count], [1, 1, 1]);
    assert.deepEqual(packed(boar, 0), savedBoar);
    assert.deepEqual(packed(bird, 0), savedBird);
    assert.deepEqual([...blob.instanceMatrix.array.slice(0, 16)], savedShadow);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <clipping_planes_fragment>\n#include <color_fragment>' };
    boar.material.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /attribute float aSeed/);
    assert.doesNotMatch(shader.vertexShader, /gl_InstanceID/);
    const direction = new THREE.Vector3(b.x, ground + 0.55, b.z).sub(camera.position).normalize();
    const hit = hunt.raycast(new THREE.Raycaster(camera.position.clone(), direction));
    assert.equal(hit.animalId, b.id); assert.equal(hit.instanceId, 3, 'gameplay keeps canonical pool IDs');
    const count = boar.count;
    boar.onBeforeRender(null, null, camera, boar.geometry, new THREE.MeshDepthMaterial());
    assert.equal(boar.count, 0); boar.onAfterRender(); assert.equal(boar.count, count);
  });
});

test('empty views submit no wildlife and previously unused network slots keep white canonical palettes across resets', async () => {
  await withWildlife(({ hunt, spec, boar, blob, bird, pose, present }) => {
    const bi = spec.boars.count + 7, wi = spec.birds.pool - 1;
    assert.deepEqual([boar.count, blob.count, bird.count], [0, 0, 0]);
    for (let pass = 0; pass < 2; pass++) {
      hunt.setNetwork(true);
      const animals = [pose('boar', bi), pose('bird', wi)];
      present(animals);
      assert.deepEqual([boar.count, blob.count, bird.count], [1, 1, 1]);
      assert.deepEqual(packed(boar, 0).color, [1, 1, 1]);
      assert.deepEqual(packed(bird, 0).color, [1, 1, 1]);
      assert.equal(packed(boar, 0).seed, bi);
      present(animals.map(a => ({ ...a, active: false })));
      assert.deepEqual([boar.count, blob.count, bird.count], [0, 0, 0]);
      assert.ok([boar, blob, bird].every(m => !m.visible));
      present(animals);
      assert.deepEqual([boar.count, blob.count, bird.count], [1, 1, 1]);
      hunt.setNetwork(false);
      assert.equal(hunt.debug.boars[bi].active, false);
      assert.equal(hunt.debug.boars[bi].i, bi);
    }
  });
});

test('solo wildlife restores its packed draw immediately when the same view returns before the idle tick', async () => {
  await withWildlife(({ hunt, camera, ground, boar, blob, bird }) => {
    for (const a of [...hunt.debug.boars, ...hunt.debug.birds]) a.active = false;
    const animal = hunt.debug.boars[3]; animal.active = true; animal.x = -100; animal.z = 30;
    hunt.debug.box.set(new THREE.Vector3(-102, ground, 28), new THREE.Vector3(-98, ground + 3, 32));
    hunt.update(0);
    assert.deepEqual([boar.count, blob.count, bird.count], [1, 1, 0]);
    const saved = packed(boar, 0), view = camera.quaternion.clone();
    camera.lookAt(-100, ground + 1, -30); camera.updateMatrixWorld(true); hunt.update(0);
    assert.deepEqual([boar.count, blob.count, bird.count], [0, 0, 0]);
    camera.quaternion.copy(view); camera.updateMatrixWorld(true); hunt.update(0);
    assert.deepEqual([boar.count, blob.count, bird.count], [1, 1, 0]);
    assert.deepEqual(packed(boar, 0), saved);
    assert.equal(animal.i, 3);
  });
});

test('leaving a network session rebuilds the local packed view before the next idle tick', async () => {
  await withWildlife(({ hunt, ground, boar, blob, bird, pose, present }) => {
    for (const a of [...hunt.debug.boars, ...hunt.debug.birds]) a.active = false;
    const local = hunt.debug.boars[3]; local.active = true; local.x = -100; local.z = 30;
    hunt.debug.box.set(new THREE.Vector3(-102, ground, 28), new THREE.Vector3(-98, ground + 3, 32));
    hunt.update(0);
    const saved = packed(boar, 0);
    assert.equal(saved.seed, 3);
    hunt.setNetwork(true);
    present([pose('boar', 55)]);
    assert.equal(packed(boar, 0).seed, 55);
    present([pose('boar', 55, { x: 10000, z: -10000 })]);
    hunt.update(0.1);
    assert.equal(boar.count, 0);
    hunt.setNetwork(false);
    hunt.update(0);
    assert.deepEqual([boar.count, blob.count, bird.count], [1, 1, 0]);
    assert.deepEqual(packed(boar, 0), saved);
    assert.ok(hunt.debug.box.containsPoint(new THREE.Vector3(local.x, ground, local.z)));
  });
});
