// Same WebGL context/world/pixels: scoped per-object eco versus eco batch packets.
// No app state/fixtures patched, no dependency install, bounded browser lifetime.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const base = process.env.QA_URL || 'http://127.0.0.1:8765/';
const output = path.resolve(process.env.QA_OUTPUT || 'output/playwright/raster-representation');
fs.mkdirSync(output, { recursive: true });
let browser;
const report = { base, errors: [], cleanup: false };
const watchdog = setTimeout(() => browser?.close(), 60000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(new URL('favicon.svg', base).href);
  report.result = await page.evaluate(async base => {
    const THREE = await import(new URL('vendor/three-0.169/build/three.module.js', base).href);
    const { createEcoMaterials } = await import(new URL('js/eco-materials.js', base).href);
    const { createRasterBatches } = await import(new URL('js/raster-batches.js', base).href);
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
    renderer.setSize(480, 320); renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1.5, .1, 50);
    camera.position.set(0, 3, 8); camera.lookAt(0, 0, 0);
    scene.background = new THREE.Color('#15202c');
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 7, 5); sun.castShadow = true;
    scene.add(sun, new THREE.AmbientLight(0xffffff, .7));
    const geometry = new THREE.BoxGeometry(.7, .7, .7), materials = [];
    for (let i = 0; i < 12; i++) {
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(i / 12, .6, .55), roughness: (i + 1) / 13, metalness: i % 2,
      });
      Object.assign(material.userData, { roomLightingPatched: true, roomLightingBatchSafe: true });
      materials.push(material);
      for (let copy = 0; copy < 2; copy++) {
        const at = i * 2 + copy, mesh = new THREE.Mesh(geometry, material);
        mesh.position.set((at % 6 - 2.5) * .9, Math.floor(at / 6) * .8 - 1.1, (at % 3) * -.3);
        mesh.rotation.set(.1 * at, .15 * at, 0); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
      }
    }
    const eco = createEcoMaterials({ THREE, scene, renderer });
    let batches;
    const settle = async (condition, tick = () => {}) => {
      const until = performance.now() + 15000;
      while (!condition()) {
        if (performance.now() > until) throw Error('Representation did not become ready');
        await new Promise(r => setTimeout(r, 15));
        tick();
      }
    };
    const pixels = () => {
      const gl = renderer.getContext(), result = new Uint8Array(480 * 320 * 4);
      gl.readPixels(0, 0, 480, 320, gl.RGBA, gl.UNSIGNED_BYTE, result); return result;
    };
    const compare = (a, b) => {
      let changed = 0, max = 0, total = 0;
      for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); if (delta) changed++; max = Math.max(max, delta); total += delta; }
      return { channels: a.length, changed, max, mean: total / a.length };
    };
    try {
      eco.update(camera); await settle(() => eco.stats.ready === eco.stats.programs, () => eco.update(camera));
      eco.draw(() => renderer.render(scene, camera)); const reference = pixels();
      batches = createRasterBatches({ THREE, scene, renderer }); batches.setQuality('eco'); batches.update(camera);
      await settle(() => batches.stats.ready === batches.stats.groups, () => batches.update(camera));
      batches.draw(() => eco.draw(() => renderer.render(scene, camera))); const flat = compare(reference, pixels());
      const ecoStats = batches.stats;
      if (flat.max > 1) throw Error('Eco representation changed pixels: ' + JSON.stringify(flat));
      batches.setQuality('high'); batches.update(camera);
      // This isolated world uses default lighting hooks. The full application
      // patches owned PBR batch materials through lighting.update().
      scene.traverse(o => { if (o.isBatchedMesh) o.material.userData.roomLightingPatched = true; });
      batches.update(camera);
      await settle(() => batches.stats.ready === batches.stats.groups, () => batches.update(camera));
      renderer.render(scene, camera); const highReference = pixels();
      batches.draw(() => renderer.render(scene, camera)); const high = compare(highReference, pixels());
      if (high.max > 1) throw Error('High representation changed pixels: ' + JSON.stringify(high));
      if (materials.some(m => !m.isMeshStandardMaterial)) throw Error('Authored material changed');
      return { flat, high, ecoStats, highStats: batches.stats, authoredMaterials: materials.length };
    } finally {
      batches?.dispose(); eco.dispose(); geometry.dispose(); materials.forEach(m => m.dispose()); renderer.dispose();
    }
  }, base);
} catch (error) { report.failure = error.stack; process.exitCode = 1; }
finally {
  clearTimeout(watchdog); await browser?.close(); report.cleanup = true;
  fs.writeFileSync(path.join(output, 'representation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
