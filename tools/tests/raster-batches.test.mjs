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

async function ecoFixture(compile) {
  const scene = new THREE.Scene(), geometry = new THREE.BoxGeometry(), camera = new THREE.PerspectiveCamera();
  const map = new THREE.Texture(), materials = Array.from({ length: 4 }, (_, i) => {
    const material = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(i / 4, 1 - i / 4, .5), map,
      roughness: .1 + i * .2, metalness: i / 4, clearcoat: i / 5, normalMap: new THREE.Texture(),
      emissive: 0x110905, emissiveIntensity: .7 });
    Object.assign(material.userData, { roomLightingPatched: true, roomLightingBatchSafe: true }); return material;
  });
  const objects = Array.from({ length: 8 }, (_, i) => {
    const object = new THREE.Mesh(geometry, materials[i >> 1]); object.position.x = i;
    object.castShadow = object.receiveShadow = true; scene.add(object); return object;
  });
  const calls = [], renderer = { domElement: new EventTarget(), extensions: { has: () => true },
    compileAsync: (...args) => { calls.push(args); return compile ? compile(...args) : Promise.resolve(); } };
  const batches = createRasterBatches({ THREE, scene, renderer, quality: 'eco' });
  const proxies = () => { const result = []; scene.traverse(o => { if (o.isBatchedMesh) result.push(o); }); return result; };
  batches.update(camera); await settle();
  return { scene, geometry, map, materials, objects, camera, renderer, calls, batches, proxies,
    close() { batches.dispose(); geometry.dispose(); map.dispose(); for (const m of materials) { m.normalMap.dispose(); m.dispose(); } } };
}

test('eco batches group by their actual Lambert state and preserve authored PBR, colors and failure restoration', async () => {
  const f = await ecoFixture();
  try {
    assert.equal(f.batches.stats.representation, 'eco'); assert.equal(f.batches.stats.groups, 1); assert.equal(f.batches.stats.lambertGroups, 1);
    const proxy = f.proxies()[0]; assert.equal(proxy.material.isMeshLambertMaterial, true);
    assert.equal(proxy.material.map, f.map); assert.equal(proxy.material.normalMap, null); assert.equal(proxy.material.envMap, null);
    assert.equal(proxy.material.emissiveIntensity, .7); assert.ok(proxy.material.emissive.equals(f.materials[0].emissive));
    assert.deepEqual(proxy.material.color.toArray(), [1, 1, 1]);
    assert.ok(f.calls.every(([mesh]) => mesh.material.isMeshLambertMaterial), 'the compiled batch is already Lambert');
    f.batches.draw(() => {
      assert.ok(f.objects.every(o => !o.visible)); assert.equal(proxy.visible, true);
      for (let i = 0; i < f.objects.length; i++) {
        const color = proxy.getColorAt(i, new THREE.Color());
        assert.ok(color.equals(f.objects[i].material.color));
      }
    });
    const rebuilds = f.batches.stats.rebuilds;
    f.materials[0].roughness = .99; f.materials[0].clearcoat = .8;
    f.batches.draw(() => assert.ok(f.objects.every(o => !o.visible)));
    f.batches.update(f.camera); assert.equal(f.batches.stats.rebuilds, rebuilds, 'discarded PBR state does not split eco groups');
    assert.throws(() => f.batches.draw(() => { throw Error('draw failed'); }), /draw failed/);
    assert.ok(f.objects.every(o => o.visible)); assert.equal(proxy.visible, false);
    assert.ok(f.objects.every((o, i) => o.material === f.materials[i >> 1]));
  } finally { f.close(); }
});

test('eco shader/state changes fall back before regrouping; textures, emissive, depth and clipping never merge incorrectly', async () => {
  const f = await ecoFixture();
  const regroup = async change => {
    change(); f.batches.draw(() => {
      assert.equal(f.objects[0].visible, true); assert.equal(f.objects[2].visible, false);
      assert.equal(f.proxies()[0].getVisibleAt(0), false);
    });
    f.batches.update(f.camera); await settle(); assert.equal(f.batches.stats.groups, 2);
  };
  try {
    await regroup(() => { f.materials[0].depthWrite = false; });
    f.materials[0].depthWrite = true; f.batches.draw(() => {}); f.batches.update(f.camera); await settle();
    await regroup(() => f.materials[0].emissive.setRGB(.3, .1, .2));
    f.materials[0].emissive.copy(f.materials[1].emissive); f.batches.draw(() => {}); f.batches.update(f.camera); await settle();
    await regroup(() => { f.materials[0].clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 2)]; });
    f.materials[0].clippingPlanes = null; f.batches.draw(() => {}); f.batches.update(f.camera); await settle();
    const replacement = new THREE.Texture(); await regroup(() => { f.materials[0].map = replacement; }); replacement.dispose();
    f.materials[0].map = f.map; f.batches.draw(() => {}); f.batches.update(f.camera); await settle();
    const previous = f.proxies()[0]; f.map.channel = 1;
    f.batches.draw(() => assert.ok(f.objects.every(o => o.visible)));
    f.batches.update(f.camera); await settle(); assert.notEqual(f.proxies()[0], previous);
    assert.equal(f.proxies()[0].material.map.channel, 1);
  } finally { f.close(); }
});

test('quality switches retire pending eco groups and rebuild exact PBR instead of using a merged PBR fallback', async () => {
  const pending = [], f = await ecoFixture(() => new Promise(resolve => pending.push(resolve)));
  try {
    const oldEco = f.proxies()[0]; assert.equal(f.batches.stats.ready, 0);
    f.batches.draw(() => { assert.ok(f.objects.every(o => o.visible)); assert.equal(oldEco.visible, false); });
    f.batches.setQuality('high');
    f.batches.draw(() => assert.ok(f.objects.every(o => o.visible)));
    f.batches.update(f.camera); await settle();
    assert.equal(f.batches.stats.groups, 4); assert.equal(f.batches.stats.lambertGroups, 0); assert.equal(oldEco.parent, null);
    for (const proxy of f.proxies()) { proxy.material.userData.roomLightingPatched = true; proxy.material.needsUpdate = true; }
    f.batches.update(f.camera); await settle();
    pending.splice(0).forEach(resolve => resolve()); await settle();
    assert.equal(f.batches.stats.ready, 4);
    f.batches.draw(() => {
      assert.ok(f.objects.every(o => !o.visible));
      for (const proxy of f.proxies()) assert.equal(proxy.material.isMeshPhysicalMaterial, true);
    });
    f.batches.setQuality('eco'); f.batches.draw(() => assert.ok(f.objects.every(o => o.visible)));
    f.batches.update(f.camera); await settle(); assert.equal(f.batches.stats.groups, 1); assert.equal(f.batches.stats.ready, 0);
    pending.splice(0).forEach(resolve => resolve()); await settle();
    f.batches.draw(() => { assert.ok(f.objects.every(o => !o.visible)); assert.equal(f.proxies()[0].material.isMeshLambertMaterial, true); });
  } finally { f.close(); pending.forEach(resolve => resolve()); }
});

test('context restoration and late compilation cannot reactivate an obsolete eco program', async () => {
  const pending = [], f = await ecoFixture(() => new Promise(resolve => pending.push(resolve)));
  try {
    f.renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
    pending.splice(0).forEach(resolve => resolve()); await settle(); assert.equal(f.batches.stats.ready, 0);
    f.batches.draw(() => assert.ok(f.objects.every(o => o.visible)));
    f.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    f.batches.update(f.camera); await settle(); assert.equal(f.batches.stats.ready, 0);
    pending.splice(0).forEach(resolve => resolve()); await settle(); assert.equal(f.batches.stats.ready, 1);
    f.batches.draw(() => assert.ok(f.objects.every(o => !o.visible)));
    f.batches.dispose(); assert.equal(f.batches.stats.groups, 0);
    assert.equal(f.renderer.domElement.onwebglcontextlost, undefined);
  } finally { f.close(); pending.forEach(resolve => resolve()); }
});

test('failed Lambert compilation keeps original objects and retries only after context restoration', async () => {
  let fail = true;
  const f = await ecoFixture(() => fail ? Promise.reject(Error('Lambert compile failed')) : Promise.resolve());
  try {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(f.batches.stats.failed, 1); assert.equal(f.batches.stats.ready, 0);
    const calls = f.calls.length; f.batches.update(f.camera); assert.equal(f.calls.length, calls);
    f.batches.draw(() => { assert.ok(f.objects.every(o => o.visible)); assert.ok(f.proxies().every(p => !p.visible)); });
    fail = false; f.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    f.batches.update(f.camera); await settle(); assert.equal(f.batches.stats.ready, 1);
    f.batches.draw(() => assert.ok(f.objects.every(o => !o.visible)));
  } finally { f.close(); }
});

test('transient currentProgram replacement retries with a cooldown and cannot permanently disable eco groups', async t => {
  const f = await ecoFixture(); let now = performance.now(); t.mock.method(performance, 'now', () => now);
  const properties = new WeakMap(); let calls = 0, stable = false;
  f.renderer.properties = { get: material => properties.get(material) };
  f.renderer.compile = mesh => {
    calls++; properties.set(mesh.material, { currentProgram: { isReady: () => stable } }); return new Set([mesh.material]);
  };
  try {
    f.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    f.batches.update(f.camera);
    const material = f.proxies()[0].material;
    properties.get(material).currentProgram = { isReady: () => true }; // Another pipeline/probe compile supersedes the warmup.
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.batches.stats.ready, 0); assert.equal(f.batches.stats.failed, 0);
    f.batches.draw(() => assert.ok(f.objects.every(o => o.visible)));
    const initialCalls = calls;
    for (let i = 0; i < 20; i++) f.batches.update(f.camera);
    assert.equal(calls, initialCalls, 'pending retry does not compile every RAF');
    now += 249; f.batches.update(f.camera); assert.equal(calls, initialCalls);
    stable = true; now += 1; f.batches.update(f.camera); await settle();
    assert.equal(calls, initialCalls + 1); assert.equal(f.batches.stats.ready, 1);
    f.batches.draw(() => assert.ok(f.objects.every(o => !o.visible)));
  } finally { f.close(); }
});

test('real renderer.compile failures exhaust bounded retries, keep originals and recover on context restoration', async t => {
  const f = await ecoFixture(); let now = performance.now(); t.mock.method(performance, 'now', () => now);
  let calls = 0, fail = true;
  const program = { isReady: () => true };
  f.renderer.properties = { get: () => ({ currentProgram: program }) };
  f.renderer.compile = mesh => { calls++; if (fail) throw Error('Real renderer compilation failure'); return new Set([mesh.material]); };
  try {
    f.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    for (let i = 0; i < 4; i++) {
      f.batches.update(f.camera); await settle(); now += 250;
    }
    assert.equal(calls, 4); assert.equal(f.batches.stats.failed, 1); assert.equal(f.batches.stats.ready, 0);
    f.batches.draw(() => assert.ok(f.objects.every(o => o.visible)));
    for (let i = 0; i < 20; i++) { now += 1000; f.batches.update(f.camera); await settle(); }
    assert.equal(calls, 4, 'exhausted failures cannot loop forever or keep preparing pending');
    fail = false; f.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    f.batches.update(f.camera); await settle(); assert.equal(calls, 5); assert.equal(f.batches.stats.ready, 1); assert.equal(f.batches.stats.failed, 0);
  } finally { f.close(); }
});

test('real program-readiness timeouts also exhaust retries and reset after material version changes', async t => {
  const f = await ecoFixture(); let now = performance.now(); t.mock.method(performance, 'now', () => now);
  let calls = 0, ready = false;
  const program = { isReady: () => ready };
  f.renderer.properties = { get: () => ({ currentProgram: program }) };
  f.renderer.compile = mesh => { calls++; return new Set([mesh.material]); };
  try {
    f.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    for (let i = 0; i < 4; i++) {
      f.batches.update(f.camera);
      now += 15001; await new Promise(resolve => setTimeout(resolve, 15)); now += 250;
    }
    assert.equal(calls, 4); assert.equal(f.batches.stats.failed, 1);
    f.batches.update(f.camera); assert.equal(calls, 4);
    ready = true; f.proxies()[0].material.needsUpdate = true;
    f.batches.update(f.camera); await settle(); assert.equal(calls, 5); assert.equal(f.batches.stats.ready, 1); assert.equal(f.batches.stats.failed, 0);
  } finally { f.close(); }
});

test('an ad-hoc hook replacement cannot silently share another eco material shader', async () => {
  const f = await ecoFixture();
  try {
    const hook = () => {}, key = () => 'changed-source-hook';
    f.materials[0].onBeforeCompile = hook; f.materials[0].customProgramCacheKey = key;
    f.batches.draw(() => assert.equal(f.objects[0].visible, true));
    f.batches.update(f.camera); await settle(); assert.equal(f.batches.stats.groups, 2);
    assert.ok(f.proxies().some(p => p.material.onBeforeCompile === hook && p.material.customProgramCacheKey === key));
  } finally { f.close(); }
});

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

test('periodic rediscovery reuses unchanged descriptions and preserves live transforms and colors', async t => {
  let now = performance.now(); t.mock.method(performance, 'now', () => now);
  const f = await fixture();
  try {
    const proxy = f.proxies()[0], count = f.batches.stats.descriptions;
    f.a.position.x = 6; f.material.color.setRGB(0.2, 0.4, 0.7);
    for (let i = 0; i < 3; i++) { now += 1000; f.batches.update(f.camera); await settle(); }
    assert.equal(f.batches.stats.descriptions, count);
    assert.equal(f.batches.stats.reusedDescriptions, 6);
    assert.equal(f.proxies()[0], proxy);
    f.batches.draw(() => {
      assert.equal(f.a.visible, false);
      const matrix = new THREE.Matrix4(); proxy.getMatrixAt(0, matrix);
      assert.equal(matrix.elements[12], 6);
      const color = proxy.getColorAt(0, new THREE.Color());
      for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(color[channel] - f.material.color[channel]) < 1e-6);
    });
  } finally { f.batches.dispose(); }
});

test('rediscovery re-describes material uniform, array-member and geometry-range changes without a preceding draw', async t => {
  let now = performance.now(); t.mock.method(performance, 'now', () => now);
  const f = await fixture();
  const scan = async () => { now += 1000; f.batches.update(f.camera); await settle(); };
  try {
    let count = f.batches.stats.descriptions;
    f.material.roughness = 0.23; await scan();
    assert.equal(f.batches.stats.descriptions, count + 2);
    assert.equal(f.proxies()[0].material.roughness, 0.23);
    f.a.material = f.b.material = Array(6).fill(f.material); await scan();
    count = f.batches.stats.descriptions;
    const replacement = f.material.clone(); replacement.color.setRGB(0.7, 0.2, 0.1);
    f.a.material[0] = replacement; await scan();
    assert.equal(f.batches.stats.descriptions, count + 2);
    count = f.batches.stats.descriptions;
    f.geometry.setDrawRange(0, 12); await scan();
    assert.equal(f.batches.stats.descriptions, count + 2);
    assert.ok(f.proxies().every(p => p.getGeometryRangeAt(p.getGeometryIdAt(0)).count <= 12));
    count = f.batches.stats.descriptions;
    f.geometry.groups[0].count = 3; await scan();
    assert.equal(f.batches.stats.descriptions, count + 2);
    count = f.batches.stats.descriptions;
    f.geometry.attributes.normal.normalized = true; await scan();
    assert.equal(f.batches.stats.descriptions, count + 2);
  } finally { f.batches.dispose(); }
});

test('singleton description caching does not conceal regrouping or changes to render-state keys', async t => {
  let now = performance.now(); t.mock.method(performance, 'now', () => now);
  const f = await fixture();
  const scan = async () => { now += 1000; f.batches.update(f.camera); await settle(); };
  try {
    f.b.material = f.material.clone(); f.b.material.roughness = 0.1; await scan();
    assert.equal(f.batches.stats.groups, 0);
    const count = f.batches.stats.descriptions; await scan();
    assert.equal(f.batches.stats.descriptions, count);
    f.b.material.roughness = f.material.roughness; await scan();
    assert.equal(f.batches.stats.groups, 1);
    for (const [set, reset] of [
      [() => { f.a.castShadow = false; }, () => { f.a.castShadow = true; }],
      [() => { f.a.receiveShadow = false; }, () => { f.a.receiveShadow = true; }],
      [() => f.a.layers.set(2), () => f.a.layers.set(0)],
      [() => { f.a.renderOrder = 4; }, () => { f.a.renderOrder = 0; }],
    ]) {
      set(); await scan(); assert.equal(f.batches.stats.groups, 0);
      reset(); await scan(); assert.equal(f.batches.stats.groups, 1);
    }
  } finally { f.batches.dispose(); }
});

test('replacement version-zero indices rebuild copied triangles even when their count and geometry are unchanged', async () => {
  const f = await fixture();
  try {
    const previous = f.proxies()[0], index = f.geometry.index;
    const replacement = new THREE.BufferAttribute(index.array.slice().reverse(), 1);
    assert.equal(replacement.version, index.version); assert.equal(replacement.count, index.count);
    f.geometry.setIndex(replacement);
    f.batches.draw(() => assert.equal(f.a.visible, true));
    f.batches.update(f.camera); await settle();
    const current = f.proxies()[0]; assert.notEqual(current, previous);
    const range = current.getGeometryRangeAt(current.getGeometryIdAt(0));
    assert.deepEqual([...current.geometry.index.array.slice(range.start, range.start + range.count)], [...replacement.array]);
    f.batches.draw(() => assert.equal(f.a.visible, false));
  } finally { f.batches.dispose(); }
});

test('in-place attribute arrays and layout metadata invalidate the proxy immediately and rebuild current values', async () => {
  const f = await fixture();
  const refresh = async change => {
    const previous = f.proxies()[0]; change();
    f.batches.draw(() => assert.equal(f.a.visible, true));
    f.batches.update(f.camera); await settle();
    assert.notEqual(f.proxies()[0], previous);
    f.batches.draw(() => assert.equal(f.a.visible, false));
    return f.proxies()[0];
  };
  try {
    let proxy = await refresh(() => {
      const attribute = f.geometry.attributes.position;
      attribute.array = attribute.array.slice(); attribute.array[0] = 1.75;
    });
    assert.equal(proxy.geometry.attributes.position.getX(0), 1.75);
    proxy = await refresh(() => { f.geometry.attributes.uv.normalized = true; });
    assert.equal(proxy.geometry.attributes.uv.normalized, true);
    proxy = await refresh(() => { f.geometry.attributes.uv.gpuType = THREE.IntType; });
    assert.equal(proxy.geometry.attributes.uv.gpuType, THREE.IntType);
    await refresh(() => {
      const index = f.geometry.index; index.array = index.array.slice().reverse();
    });
    const array = new Float32Array([0, 0, 0, 7, 1, 0, 0, 8, 0, 1, 0, 9]);
    const buffer = new THREE.InterleavedBuffer(array, 4), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    f.a.geometry = f.b.geometry = geometry;
    f.batches.draw(() => {}); f.batches.update(f.camera); await settle();
    proxy = await refresh(() => { geometry.attributes.position.offset = 1; });
    assert.equal(proxy.geometry.attributes.position.getZ(0), 7);
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

test('cached material equivalence detects newly added fields even when another own field disappears', async () => {
  const f = await fixture();
  try {
    f.batches.draw(() => { assert.equal(f.a.visible, false); });
    delete f.material.name;
    f.material.extraRenderParameter = { mode: 1 };
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

test('caller-owned current matrices skip duplicate traversal while movement and unsafe transforms remain guarded', async () => {
  const f = await fixture();
  try {
    const original = f.scene.updateMatrixWorld;
    let updates = 0;
    f.scene.updateMatrixWorld = function (...args) { updates++; return original.apply(this, args); };
    f.a.position.x = 7; f.scene.updateMatrixWorld(); updates = 0;
    f.batches.draw(() => {
      const matrix = new THREE.Matrix4(); f.proxies()[0].getMatrixAt(0, matrix);
      assert.equal(matrix.elements[12], 7); assert.equal(f.a.visible, false);
    }, { matricesCurrent: true });
    assert.equal(updates, 0);
    f.batches.draw(() => {}); assert.equal(updates, 1);
    f.a.scale.x = -1; f.scene.updateMatrixWorld();
    for (let i = 0; i < 2; i++) f.batches.draw(() => assert.equal(f.a.visible, true), { matricesCurrent: true });
  } finally { f.batches.dispose(); }
});

test('shared geometry and ancestor guard caches refresh on every draw for all matching source objects', async () => {
  const f = await fixture();
  try {
    const parent = new THREE.Group(); f.scene.add(parent); parent.add(f.a, f.b);
    parent.visible = false;
    f.batches.draw(() => { assert.equal(f.proxies()[0].getVisibleAt(0), false); assert.equal(f.proxies()[0].getVisibleAt(1), false); });
    parent.visible = true;
    f.batches.draw(() => { assert.equal(f.proxies()[0].getVisibleAt(0), true); assert.equal(f.proxies()[0].getVisibleAt(1), true); });
    f.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(f.geometry.attributes.position.count * 3).fill(1), 3));
    f.batches.draw(() => { assert.equal(f.a.visible, true); assert.equal(f.b.visible, true); });
    f.batches.update(f.camera); await settle();
    f.geometry.groups[0].count = 3;
    f.batches.draw(() => { assert.equal(f.a.visible, true); assert.equal(f.b.visible, true); });
  } finally { f.batches.dispose(); }
});

test('fully substituted container subtrees are pruned only inside draw and never hide a remaining renderable child', async () => {
  const f = await fixture();
  try {
    const parent = new THREE.Group(), nested = new THREE.Object3D(); f.scene.add(parent); parent.add(f.a, nested); nested.add(f.b);
    f.batches.draw(() => { assert.equal(parent.visible, false); assert.equal(nested.visible, false); });
    assert.equal(parent.visible, true); assert.equal(nested.visible, true); assert.equal(f.a.visible, true); assert.equal(f.b.visible, true);
    assert.throws(() => f.batches.draw(() => { throw Error('render interrupted'); }), /render interrupted/);
    assert.equal(parent.visible, true); assert.equal(nested.visible, true);
    const sprite = new THREE.Sprite(); parent.add(sprite);
    f.batches.draw(() => { assert.equal(parent.visible, true); assert.equal(sprite.visible, true); assert.equal(nested.visible, false); });
    assert.equal(nested.visible, true);
  } finally { f.batches.dispose(); }
});
