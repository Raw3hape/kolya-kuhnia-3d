// CPU-only adapter benchmark, no browser/GPU/server. Explicit execution only:
// RASTER_BASELINE_REF=<git commit> node tools/tests/raster-cpu.bench.mjs
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { execFileSync } from 'node:child_process';
import { createRasterBatches } from '../../web/js/raster-batches.js';
import { createEcoMaterials } from '../../web/js/eco-materials.js';

const ref = process.env.RASTER_BASELINE_REF;
if (!ref) throw Error('Set RASTER_BASELINE_REF to the unchanged baseline commit.');
const warmup = new URL('../../web/js/shader-warmup.js', import.meta.url).href;
async function originalModule(path) {
  const source = execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', maxBuffer: 1e6 })
    .replace("from './shader-warmup.js'", `from ${JSON.stringify(warmup)}`);
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const baselineBatches = (await originalModule('web/js/raster-batches.js')).createRasterBatches;
const baselineEco = (await originalModule('web/js/eco-materials.js')).createEcoMaterials;
const noop = () => {};
async function fixture(makeBatches, makeEco, geometryCount) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const geometries = Array.from({ length: geometryCount }, () => new THREE.BoxGeometry());
  const materials = Array.from({ length: 160 }, (_, i) => {
    const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setHSL(i / 160, 0.5, 0.5), roughness: 0.7 });
    m.map = new THREE.Texture(); Object.assign(m.userData, { roomLightingPatched: true, roomLightingBatchSafe: true }); return m;
  });
  for (let room = 0; room < 12; room++) {
    const group = new THREE.Group(); group.position.x = room * 6; scene.add(group);
    for (let i = 0; i < 100; i++) {
      const index = room * 100 + i, object = new THREE.Mesh(geometries[index % geometryCount], materials[index % materials.length]);
      object.position.set(i % 10, 0, Math.floor(i / 10)); object.castShadow = object.receiveShadow = true; group.add(object);
    }
  }
  const renderer = { extensions: { has: () => true }, compileAsync: () => Promise.resolve(), domElement: new EventTarget() };
  const batches = makeBatches({ THREE, scene, renderer }), eco = makeEco({ THREE, scene, renderer });
  batches.update(camera);
  scene.traverse(o => { if (o.isBatchedMesh) Object.assign(o.material.userData, { roomLightingPatched: true, roomLightingBatchSafe: true }); });
  for (let i = 0; i < 180; i++) {
    batches.update(camera); eco.update(camera); for (let n = 0; n < 5; n++) await Promise.resolve();
  }
  const flat = () => eco.draw(noop), combined = () => batches.draw(flat);
  for (let i = 0; i < 100; i++) combined();
  scene.updateMatrixWorld();
  return { batches, eco, flat, combined, current: () => batches.draw(flat, { matricesCurrent: true }),
    close() { batches.dispose(); eco.dispose(); for (const g of geometries) g.dispose(); for (const m of materials) { m.map.dispose(); m.dispose(); } } };
}
function median(values) { return values.sort((a, b) => a - b)[Math.floor(values.length / 2)]; }
function measure(fn) {
  const samples = [];
  for (let round = 0; round < 3; round++) {
    const start = performance.now(); for (let frame = 0; frame < 250; frame++) fn();
    samples.push((performance.now() - start) / 250);
  }
  return median(samples);
}
const results = [];
for (const geometries of [1, 600]) {
  const before = await fixture(baselineBatches, baselineEco, geometries), after = await fixture(createRasterBatches, createEcoMaterials, geometries);
  try {
    const baseline = { rasterMs: measure(() => before.batches.draw(noop)), ecoMs: measure(before.flat), combinedMs: measure(before.combined) };
    const optimized = { rasterMs: measure(() => after.batches.draw(noop)), ecoMs: measure(after.flat), combinedMs: measure(after.combined),
      matricesCurrentCombinedMs: measure(after.current) };
    results.push({ sources: 1200, materials: 160, geometries, baseline, optimized,
      combinedCpuSpeedup: baseline.combinedMs / optimized.combinedMs,
      currentMatricesCpuSpeedup: baseline.combinedMs / optimized.matricesCurrentCombinedMs });
  } finally { before.close(); after.close(); }
}
console.log(JSON.stringify({ scope: 'CPU adapter overhead only; mock compilation; no GPU/FPS claims', baselineRef: ref, framesPerStage: 750, results }));
