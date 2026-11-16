import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { createHunt } from '../../web/js/hunt.js';

const json = path => JSON.parse(fs.readFileSync(new URL('../../' + path, import.meta.url)));

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
