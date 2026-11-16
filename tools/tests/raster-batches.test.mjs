import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { createRasterBatches } from '../../web/js/raster-batches.js';
import { stableObjectId, collectNetworkObjects } from '../../web/js/network-objects.js';

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
async function fixture(options = {}) {
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial(), camera = new THREE.PerspectiveCamera();
  const renderer = { extensions: { has: () => options.supported !== false }, compileAsync: options.compile || (() => Promise.resolve()) };
  const geometry = new THREE.BoxGeometry();
  const mesh = x => {
    const m = new THREE.Mesh(geometry, material); m.position.x = x; m.userData.networkId = `source:${x}`;
    m.castShadow = m.receiveShadow = true; scene.add(m); return m;
  };
  const a = mesh(0), b = mesh(2), batches = createRasterBatches({ THREE, scene, renderer });
  const proxies = () => { const list = []; scene.traverse(o => { if (o.isBatchedMesh) list.push(o); }); return list; };
  batches.update(camera); await settle();
  return { scene, camera, renderer, material, geometry, a, b, mesh, batches, proxies };
}

test('scoped proxies preserve source IDs, geometry, raycasts and exact visibility after successful or failed draw', async () => {
  const f = await fixture();
  try {
    const geometry = f.a.geometry, id = stableObjectId(f.a), index = geometry.index.array.slice();
    assert.equal(f.batches.stats.groups, 1); assert.equal(f.batches.stats.ready, 1);
    const before = collectNetworkObjects(f.scene, THREE);
    f.b.visible = false;
    const result = f.batches.draw(() => {
      assert.equal(f.a.visible, false); assert.equal(f.b.visible, false);
      const p = f.proxies()[0]; assert.equal(p.visible, true); assert.equal(p.parent.visible, true);
      assert.equal(p.getVisibleAt(0), true); assert.equal(p.getVisibleAt(1), false);
      assert.equal(p.userData.networkEntity, true); assert.equal(p.userData.rasterOnly, true);
      assert.equal(stableObjectId(p), null); assert.equal(f.scene.matrixWorldAutoUpdate, false);
      return 42;
    });
    assert.equal(result, 42); assert.equal(f.a.visible, true); assert.equal(f.b.visible, false);
    assert.equal(f.scene.matrixWorldAutoUpdate, true); assert.equal(f.proxies()[0].visible, false);
    assert.throws(() => f.batches.draw(() => { throw Error('draw failed'); }), /draw failed/);
    assert.equal(f.a.visible, true); assert.equal(f.b.visible, false); assert.equal(f.proxies()[0].parent.visible, false);
    assert.equal(f.a.geometry, geometry); assert.equal(stableObjectId(f.a), id); assert.deepEqual(geometry.index.array, index);
    f.b.visible = true; assert.deepEqual(collectNetworkObjects(f.scene, THREE), before);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 0, -1));
    assert.ok(ray.intersectObject(f.a).length > 0); assert.equal(ray.intersectObject(f.proxies()[0]).length, 0);
  } finally { f.batches.dispose(); }
});

test('multi-material box faces merge by material without changing authored index/groups or faceSlots', async () => {
  const f = await fixture();
  try {
    const blue = new THREE.MeshStandardMaterial({ color: 0x0000ff });
    f.a.material = f.b.material = [f.material, blue, f.material, f.material, blue, f.material];
    const index = f.geometry.index.array.slice(), groups = structuredClone(f.geometry.groups);
    f.a.userData.faceSlots = ['a', 'b', 'c', 'd', 'e', 'f']; const slots = [...f.a.userData.faceSlots];
    f.batches.draw(() => {}); f.batches.update(f.camera); await settle();
    assert.equal(f.batches.stats.groups, 1);
    const proxies = f.proxies();
    for (const p of proxies) for (let instance = 0; instance < 2; instance++) {
      const tint = p.getColorAt(instance, new THREE.Color());
      const desired = [];
      for (const group of groups) if (f.a.material[group.materialIndex].color.equals(tint))
        desired.push(...index.slice(group.start, group.start + group.count));
      const range = p.getGeometryRangeAt(p.getGeometryIdAt(instance));
      assert.equal(range.count, desired.length);
      const indices = p.geometry.index.array.slice(range.start, range.start + range.count);
      for (let i = 0; i < desired.length; i++) for (const key of ['position', 'normal', 'uv'])
        for (let c = 0; c < f.geometry.attributes[key].itemSize; c++)
          assert.equal(p.geometry.attributes[key].getComponent(indices[i], c), f.geometry.attributes[key].getComponent(desired[i], c));
    }
    f.batches.draw(() => { assert.equal(f.a.visible, false); assert.ok(proxies.every(p => p.visible)); });
    assert.deepEqual(f.geometry.index.array, index); assert.deepEqual(f.geometry.groups, groups); assert.deepEqual(f.a.userData.faceSlots, slots);
  } finally { f.batches.dispose(); }
});

test('camera-only updates keep batches; transforms, hidden ancestors and removal sync safely', async () => {
  const f = await fixture();
  try {
    const proxy = f.proxies()[0], rebuilds = f.batches.stats.rebuilds;
    f.camera.position.x = 3; f.batches.update(f.camera); f.a.position.x = 4;
    f.batches.draw(() => {
      const matrix = new THREE.Matrix4(); proxy.getMatrixAt(0, matrix); assert.equal(matrix.elements[12], 4);
    });
    assert.equal(f.batches.stats.rebuilds, rebuilds);
    const holder = new THREE.Group(); f.scene.add(holder); holder.add(f.b); holder.visible = false;
    f.batches.draw(() => { assert.equal(proxy.getVisibleAt(1), false); });
    assert.equal(f.b.visible, true);
    let disposed = false; proxy.geometry.addEventListener('dispose', () => { disposed = true; });
    f.b.removeFromParent(); f.batches.draw(() => {}); f.batches.update(f.camera); await settle();
    assert.equal(f.batches.stats.groups, 0); assert.equal(disposed, true); assert.equal(f.a.visible, true);
  } finally { f.batches.dispose(); }
});

test('new decals or children immediately return the parent to the original render path', async () => {
  const f = await fixture();
  try {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()); f.a.add(decal);
    f.batches.draw(() => {
      assert.equal(f.a.visible, true); assert.equal(decal.visible, true);
      assert.equal(f.proxies()[0].getVisibleAt(0), false);
    });
    f.batches.update(f.camera); await settle(); assert.equal(f.batches.stats.groups, 0);
  } finally { f.batches.dispose(); }
});

test('compile completion gates proxy use; pending or failed variants keep original meshes', async () => {
  let resolve;
  const f = await fixture({ compile: () => new Promise(done => { resolve = done; }) });
  try {
    assert.equal(f.batches.stats.ready, 0);
    f.batches.draw(() => { assert.equal(f.a.visible, true); assert.equal(f.b.visible, true); });
    resolve(); await settle(); assert.equal(f.batches.stats.ready, 1);
    f.batches.draw(() => { assert.equal(f.a.visible, false); });
  } finally { f.batches.dispose(); }
  const failed = await fixture({ compile: () => { throw Error('context unavailable'); } });
  try { failed.batches.draw(() => assert.equal(failed.a.visible, true)); assert.equal(failed.batches.stats.ready, 0); }
  finally { failed.batches.dispose(); }
});

test('unsupported multi-draw, transparent/custom callbacks, animated meshes and parents stay authored', async () => {
  const f = await fixture({ supported: false });
  try { assert.equal(f.batches.stats.groups, 0); f.batches.draw(() => assert.equal(f.a.visible, true)); }
  finally { f.batches.dispose(); }
  const g = await fixture();
  try {
    g.a.onBeforeRender = () => {}; g.b.material = new THREE.MeshStandardMaterial({ transparent: true });
    g.batches.draw(() => { assert.equal(g.a.visible, true); assert.equal(g.b.visible, true); });
    g.batches.update(g.camera); await settle(); assert.equal(g.batches.stats.groups, 0);
  } finally { g.batches.dispose(); }
});

test('nested drawing restores only on outer exit and disposal releases only owned buffers', async () => {
  const f = await fixture(); let sourceDisposed = false;
  f.geometry.addEventListener('dispose', () => { sourceDisposed = true; });
  f.batches.draw(() => {
    f.batches.draw(() => assert.equal(f.a.visible, false)); assert.equal(f.a.visible, false);
  });
  assert.equal(f.a.visible, true); assert.ok(f.batches.stats.vertices <= f.batches.stats.maxVertices);
  f.batches.dispose(); assert.equal(sourceDisposed, false); assert.equal(f.batches.stats.vertices, 0);
  assert.equal(f.proxies().length, 0); f.batches.draw(() => assert.equal(f.a.visible, true));
});

test('static Meshopt-style interleaved geometry and normalized colors retain their values and version invalidation', async () => {
  const f = await fixture();
  try {
    const geometry = new THREE.BufferGeometry();
    const buffer = new THREE.InterleavedBuffer(new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]), 6);
    const colors = new THREE.InterleavedBuffer(new Uint8Array([255, 128, 0, 0, 0, 255, 128, 0, 128, 0, 255, 0]), 4);
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    geometry.setAttribute('color', new THREE.InterleavedBufferAttribute(colors, 3, 0, true));
    f.a.geometry = f.b.geometry = geometry; f.material.vertexColors = true;
    f.batches.draw(() => {}); f.batches.update(f.camera); await settle();
    assert.equal(f.batches.stats.sources, 2); assert.equal(f.batches.stats.ready, 1);
    const proxy = f.proxies()[0];
    for (const key of ['position', 'normal', 'color']) for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++)
      assert.ok(Math.abs(proxy.geometry.attributes[key].getComponent(i, c) - geometry.attributes[key].getComponent(i, c)) < 1e-6);
    f.batches.draw(() => assert.equal(f.a.visible, false));
    buffer.needsUpdate = true;
    f.batches.draw(() => assert.equal(f.a.visible, true));
    f.batches.update(f.camera); await settle();
    f.batches.draw(() => assert.equal(f.a.visible, false));
  } finally { f.batches.dispose(); }
});

test('equivalent PBR materials use an owned white base and exact independent instance colors', async () => {
  const f = await fixture();
  try {
    const red = new THREE.MeshStandardMaterial({ color: 0xff0000 }), blue = new THREE.MeshStandardMaterial({ color: 0x0000ff });
    f.a.material = red; f.b.material = blue;
    f.batches.draw(() => {}); f.batches.update(f.camera); await settle();
    assert.equal(f.batches.stats.groups, 1);
    const proxy = f.proxies()[0];
    assert.notEqual(proxy.material, red); assert.notEqual(proxy.material, blue);
    assert.deepEqual(proxy.material.color.toArray(), [1, 1, 1]);
    f.batches.draw(() => {});
    assert.ok(proxy.getColorAt(0, new THREE.Color()).equals(red.color)); assert.ok(proxy.getColorAt(1, new THREE.Color()).equals(blue.color));
    red.color.setRGB(0, 1, 0);
    f.batches.draw(() => { assert.equal(f.a.visible, false); assert.ok(proxy.getColorAt(0, new THREE.Color()).equals(red.color)); });
    let cloneDisposed = false, sourceDisposed = false;
    proxy.material.addEventListener('dispose', () => { cloneDisposed = true; }); red.addEventListener('dispose', () => { sourceDisposed = true; });
    blue.roughness = 0.3; // Uniform edits need not increment Material.version.
    f.batches.draw(() => { assert.equal(f.b.visible, true); assert.equal(proxy.getVisibleAt(1), false); });
    f.batches.update(f.camera); await settle();
    assert.equal(cloneDisposed, true); assert.equal(sourceDisposed, false);
    assert.deepEqual(red.color.toArray(), [0, 1, 0]); assert.deepEqual(blue.color.toArray(), [0, 0, 1]);
  } finally { f.batches.dispose(); }
});

test('different texture identities, emissive/scalar parameters or custom shader hooks do not become equivalent', async () => {
  const f = await fixture();
  try {
    f.a.material = f.material.clone(); f.b.material = f.material.clone();
    f.a.material.emissive.setRGB(0.1, 0, 0); f.b.material.emissive.setRGB(0, 0, 0.1);
    f.batches.draw(() => {}); f.batches.update(f.camera); await settle(); assert.equal(f.batches.stats.groups, 0);
    f.a.material.emissive.setRGB(0, 0, 0); f.b.material.emissive.setRGB(0, 0, 0);
    f.a.material.map = new THREE.Texture(); f.b.material.map = new THREE.Texture();
    f.batches.update(f.camera); // no forced scan needed: no active proxy can conceal these unique materials.
    f.batches.draw(() => { assert.equal(f.a.visible, true); assert.equal(f.b.visible, true); });
  } finally { f.batches.dispose(); }
});

test('lighting clones wait for their own patch; shear transforms and changed geometry groups fall back immediately', async () => {
  const f = await fixture();
  try {
    f.material.userData.roomLightingPatched = f.material.userData.roomLightingBatchSafe = true;
    f.material.onBeforeCompile = () => {}; f.material.customProgramCacheKey = () => 'roomlight2';
    f.batches.draw(() => {}); f.batches.update(f.camera); await settle();
    assert.equal(f.batches.stats.ready, 0);
    const proxy = f.proxies()[0];
    assert.equal(proxy.material.userData.roomLightingPatched, undefined);
    proxy.material.userData.roomLightingPatched = proxy.material.userData.roomLightingBatchSafe = true;
    proxy.material.needsUpdate = true; f.batches.update(f.camera); await settle(); assert.equal(f.batches.stats.ready, 1);
    const parent = new THREE.Group(); parent.scale.set(2, 1, 1); parent.add(f.a); f.a.rotation.z = Math.PI / 4; f.scene.add(parent);
    f.batches.draw(() => assert.equal(f.a.visible, true));
    f.geometry.groups[0].count = 3;
    f.batches.draw(() => assert.equal(f.b.visible, true));
  } finally { f.batches.dispose(); }
});
