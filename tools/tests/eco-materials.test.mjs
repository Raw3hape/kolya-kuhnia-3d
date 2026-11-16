import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { createEcoMaterials } from '../../web/js/eco-materials.js';
import { collectNetworkObjects } from '../../web/js/network-objects.js';
import { ECO_MAPS, ECO_VALUES, createEcoMaterial } from '../../web/js/eco-material-state.js';

const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function fixture(compile) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial({ color: '#9b6831', emissive: '#110805', emissiveIntensity: 0.7,
    metalness: 1, roughness: 0.1, side: THREE.DoubleSide, alphaTest: 0.25, vertexColors: true });
  Object.assign(material.userData, { roomLightingPatched: true, roomLightingBatchSafe: true });
  material.onBeforeCompile = function (shader) { shader.flatType = this.type; };
  material.customProgramCacheKey = () => 'test-room-lighting';
  const a = new THREE.Mesh(geometry, material), b = new THREE.Mesh(geometry, material);
  a.userData.networkId = 'a'; b.userData.networkId = 'b'; scene.add(a, b);
  const calls = [], domElement = new EventTarget();
  const renderer = { domElement, compileAsync: (...args) => { calls.push(args); return compile ? compile(...args) : Promise.resolve(); } };
  const eco = createEcoMaterials({ THREE, scene, renderer });
  return { scene, camera, geometry, material, a, b, calls, renderer, eco };
}

test('the shared eco representation preserves every retained map and render value for both objects and white batch bases', () => {
  const source = new THREE.MeshPhysicalMaterial({ color: 0x77aa33, emissive: 0x210b06, clearcoat: 1, metalness: 1,
    alphaHash: true, side: THREE.DoubleSide, depthWrite: false, stencilWrite: true, stencilRef: 3,
    polygonOffset: true, polygonOffsetFactor: -2, emissiveIntensity: 2.5 });
  for (const key of ECO_MAPS) source[key] = new THREE.Texture();
  source.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 2)];
  source.blendColor.setRGB(.4, .3, .2);
  const flat = createEcoMaterial(THREE, source), batch = createEcoMaterial(THREE, source, true);
  try {
    for (const value of [flat, batch]) {
      for (const key of [...ECO_MAPS, ...ECO_VALUES]) assert.equal(value[key], source[key], key);
      assert.ok(value.emissive.equals(source.emissive)); assert.ok(value.blendColor.equals(source.blendColor));
      assert.equal(value.onBeforeCompile, source.onBeforeCompile); assert.equal(value.customProgramCacheKey, source.customProgramCacheKey);
      assert.equal(value.normalMap, null); assert.equal(value.envMap, null); assert.equal(value.userData.ecoMaterial, true);
    }
    assert.ok(flat.color.equals(source.color)); assert.deepEqual(batch.color.toArray(), [1, 1, 1]);
  } finally { flat.dispose(); batch.dispose(); for (const key of ECO_MAPS) source[key].dispose(); source.dispose(); }
});

test('only precompiled Lambert variants draw; authored PBR, IDs, geometry and callbacks are restored on every exit', async () => {
  let resolve;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  const sourceHook = f.material.onBeforeCompile, sourceKey = f.material.customProgramCacheKey;
  const map = new THREE.Texture(); f.material.map = map;
  try {
    const before = collectNetworkObjects(f.scene, THREE);
    f.eco.update(f.camera);
    assert.equal(f.eco.stats.compiling, 1); assert.equal(f.eco.stats.ready, 0);
    f.eco.draw(() => assert.equal(f.a.material, f.material));
    resolve(); await settle();
    assert.equal(f.eco.stats.ready, 1);
    let flat;
    assert.equal(f.eco.draw(() => {
      flat = f.a.material; assert.ok(flat.isMeshLambertMaterial); assert.equal(f.b.material, flat);
      assert.equal(flat.map, map); assert.ok(flat.color.equals(f.material.color)); assert.ok(flat.emissive.equals(f.material.emissive));
      assert.equal(flat.emissiveIntensity, 0.7); assert.equal(flat.vertexColors, true); assert.equal(flat.alphaTest, 0.25);
      assert.equal(flat.side, THREE.DoubleSide); assert.equal(flat.envMap, null); assert.equal(flat.userData.ecoMaterial, true);
      assert.equal(flat.onBeforeCompile, sourceHook); assert.equal(flat.customProgramCacheKey, sourceKey);
      const shader = {}; flat.onBeforeCompile(shader); assert.equal(shader.flatType, 'MeshLambertMaterial');
      f.eco.draw(() => assert.equal(f.a.material, flat));
      return 42;
    }), 42);
    assert.equal(f.a.material, f.material); assert.equal(f.b.material, f.material);
    assert.throws(() => f.eco.draw(() => { throw Error('render failed'); }), /render failed/);
    assert.equal(f.a.material, f.material); assert.deepEqual(collectNetworkObjects(f.scene, THREE), before);
    assert.equal(f.a.geometry, f.geometry); assert.equal(f.material.metalness, 1); assert.equal(f.material.onBeforeCompile, sourceHook);
    let flatDisposed = false, sourceDisposed = false;
    flat.addEventListener('dispose', () => { flatDisposed = true; }); f.material.addEventListener('dispose', () => { sourceDisposed = true; });
    f.eco.dispose(); assert.equal(flatDisposed, true); assert.equal(sourceDisposed, false);
  } finally { f.eco.dispose(); map.dispose(); }
});

test('glass, screens, reflection/context meshes, custom callbacks, unsafe shaders and avatars retain their materials', async () => {
  const f = fixture();
  try {
    for (const flag of ['glass', 'screen', 'tvScreen', 'mirror', 'mirrorGlass', 'networkMirror', 'context', 'networkAvatar']) {
      const parent = new THREE.Group(), mesh = new THREE.Mesh(f.geometry, f.material); parent.userData[flag] = true; parent.add(mesh); f.scene.add(parent);
    }
    const custom = new THREE.Mesh(f.geometry, f.material); custom.onBeforeRender = () => {}; f.scene.add(custom);
    const transparent = f.material.clone(); transparent.transparent = true;
    const transmissive = new THREE.MeshPhysicalMaterial({ transmission: 0.8 });
    Object.assign(transmissive.userData, { roomLightingPatched: true, roomLightingBatchSafe: true });
    const unsafe = f.material.clone(); unsafe.userData.roomLightingBatchSafe = false;
    const skipped = [new THREE.Mesh(f.geometry, transparent), new THREE.Mesh(f.geometry, transmissive), new THREE.Mesh(f.geometry, unsafe), custom];
    f.scene.add(...skipped);
    f.eco.update(f.camera); await settle();
    f.eco.draw(() => {
      assert.ok(f.a.material.isMeshLambertMaterial);
      for (const o of skipped) assert.equal(o.material.isMeshLambertMaterial, undefined);
      for (const parent of f.scene.children.filter(o => o.isGroup)) assert.equal(parent.children[0].material, f.material);
    });
    assert.equal(f.eco.stats.materials, 1);
  } finally { f.eco.dispose(); }
});

test('BatchedMesh receives its own compiled shader layout while preserving instance colors and source arrays', async () => {
  const f = fixture();
  try {
    const batch = new THREE.BatchedMesh(2, f.geometry.attributes.position.count, f.geometry.index.count, f.material);
    const gid = batch.addGeometry(f.geometry), instance = batch.addInstance(gid); batch.setColorAt(instance, new THREE.Color('#45aaff'));
    f.scene.add(batch); const matrices = batch._matricesTexture.image.data.slice();
    f.eco.update(f.camera); await settle();
    assert.equal(f.eco.stats.programs, 2); assert.equal(f.eco.stats.ready, 2);
    assert.ok(f.calls.some(([o]) => o.isBatchedMesh));
    f.eco.draw(() => { assert.ok(batch.material.isMeshLambertMaterial); assert.deepEqual(batch._matricesTexture.image.data, matrices); });
    assert.equal(batch.material, f.material); batch.dispose();
  } finally { f.eco.dispose(); }
});

test('multi-material arrays keep excluded slots and color updates while new texture/shader layouts wait for warming', async () => {
  const f = fixture();
  try {
    const glass = new THREE.MeshStandardMaterial({ transparent: true }); const materials = [f.material, glass]; f.a.material = materials;
    f.eco.update(f.camera); await settle();
    f.material.color.set('#33dd11'); f.material.emissiveIntensity = 2;
    f.eco.draw(() => { assert.ok(f.a.material[0].isMeshLambertMaterial); assert.equal(f.a.material[1], glass);
      assert.ok(f.a.material[0].color.equals(f.material.color)); assert.equal(f.a.material[0].emissiveIntensity, 2); });
    assert.equal(f.a.material, materials);
    f.material.map = new THREE.Texture();
    f.eco.draw(() => assert.equal(f.a.material, materials, 'a texture change cannot use an uncompiled variant'));
    f.eco.update(f.camera); await settle();
    f.eco.draw(() => assert.equal(f.a.material[0].map, f.material.map));
    f.material.map.dispose();
  } finally { f.eco.dispose(); }
});

test('failed compilation falls back, context restoration retries, and disposal cannot resurrect pending variants', async t => {
  let fail = true;
  const f = fixture(() => fail ? Promise.reject(Error('shader failed')) : Promise.resolve());
  try {
    f.eco.update(f.camera); await settle(); assert.equal(f.eco.stats.failed, 1); assert.equal(f.eco.stats.compiling, 0);
    f.eco.draw(() => assert.equal(f.a.material, f.material));
    fail = false; f.renderer.domElement.dispatchEvent(new Event('webglcontextlost')); f.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    f.eco.update(f.camera); await settle(); assert.equal(f.eco.stats.ready, 1); assert.equal(f.eco.stats.failed, 0);
    f.a.removeFromParent(); f.b.removeFromParent();
    const now = performance.now(); const clock = t.mock.method(performance, 'now', () => now + 351);
    f.eco.update(f.camera); assert.equal(f.eco.stats.materials, 0); clock.mock.restore();
  } finally { f.eco.dispose(); }
  let resolve;
  const pending = fixture(() => new Promise(done => { resolve = done; }));
  pending.eco.update(pending.camera); pending.eco.dispose(); resolve(); await settle();
  assert.deepEqual(pending.eco.stats, { materials: 0, programs: 0, ready: 0, failed: 0, compiling: 0 });
  pending.eco.draw(() => assert.equal(pending.a.material, pending.material));
});

test('steady updates avoid structural scans while visible uniforms and late materials stay current between scans', async t => {
  const f = fixture(); const now = performance.now(); t.mock.method(performance, 'now', () => now);
  try {
    let scans = 0; const traverse = f.scene.traverse;
    f.scene.traverse = function (callback) { scans++; return traverse.call(this, callback); };
    f.eco.update(f.camera); await settle(); const firstScans = scans;
    for (let i = 0; i < 20; i++) f.eco.update(f.camera);
    assert.equal(scans, firstScans, 'idle RAFs do not rediscover hundreds of hidden source materials');
    f.material.color.set('#13c582'); f.material.emissive.set('#2200ff'); f.material.emissiveIntensity = 3;
    f.eco.draw(() => { assert.ok(f.a.material.color.equals(f.material.color)); assert.ok(f.a.material.emissive.equals(f.material.emissive)); assert.equal(f.a.material.emissiveIntensity, 3); });
    assert.equal(scans, firstScans);
    const late = f.material.clone(); late.onBeforeCompile = f.material.onBeforeCompile; late.customProgramCacheKey = f.material.customProgramCacheKey;
    f.b.material = late;
    f.eco.draw(() => assert.equal(f.b.material, late, 'a late source remains authored until its variant is warm'));
    const firstPrograms = f.calls.length;
    f.eco.update(f.camera); await settle();
    assert.ok(f.calls.length > firstPrograms, 'the unknown visible material requests immediate shader preparation');
    assert.equal(scans, 0, 'shared indexing avoids full scene traversals even during discovery');
    f.eco.draw(() => assert.ok(f.b.material.isMeshLambertMaterial));
  } finally { f.eco.dispose(); }
});

test('indexed discovery follows late hidden subtrees, reparented blocked ancestors and releases its listeners', async t => {
  const f = fixture(); let now = performance.now(); t.mock.method(performance, 'now', () => now);
  const group = new THREE.Group(), blocked = new THREE.Group(); blocked.userData.networkAvatar = true;
  const late = new THREE.Mesh(f.geometry, f.material); group.visible = false;
  f.scene.add(blocked); blocked.add(group); group.add(late);
  try {
    f.eco.update(f.camera); await settle();
    const material = f.material.clone(); material.onBeforeCompile = f.material.onBeforeCompile; material.customProgramCacheKey = f.material.customProgramCacheKey;
    late.material = material;
    f.scene.add(group); now += 400; f.eco.update(f.camera); await settle();
    group.visible = true;
    f.eco.draw(() => assert.ok(late.material.isMeshLambertMaterial, 'a hidden late subtree warms before becoming visible'));
    blocked.add(group); now += 400; f.eco.update(f.camera); await settle();
    f.eco.draw(() => assert.equal(late.material, material, 'reparenting under an avatar preserves authored materials'));
    group.removeFromParent(); now += 400; f.eco.update(f.camera);
    assert.equal(f.eco.stats.materials, 1);
    f.eco.dispose();
    assert.equal(f.scene._listeners.childadded.length, 0);
    assert.equal(late._listeners.childremoved.length, 0);
    material.dispose();
  } finally { f.eco.dispose(); }
});
