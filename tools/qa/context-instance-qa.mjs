// Real generated context, same WebGL pixels, nested reflection before outer
// context draws. Exercises season/index changes and original-state restoration.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const base = process.env.QA_URL || 'http://127.0.0.1:8765/';
const output = path.resolve(process.env.QA_OUTPUT || 'output/playwright/context-instance');
fs.mkdirSync(output, { recursive: true });
let browser;
const report = { base, errors: [], cleanup: false };
const timer = setTimeout(() => browser?.close(), 90000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  const fixture = new URL('__context-instance-qa__.html', base).href;
  const imports = { three: new URL('vendor/three-0.169/build/three.module.js', base).href,
    'three/addons/': new URL('vendor/three-0.169/examples/jsm/', base).href };
  await page.route(fixture, route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<html><head><script type="importmap">' + JSON.stringify({ imports }) + '</script></head><body></body></html>' }));
  await page.goto(fixture);
  report.result = await page.evaluate(async base => {
    const THREE = await import(new URL('vendor/three-0.169/build/three.module.js', base).href);
    const { buildContext } = await import(new URL('js/site.js', base).href);
    const { createContextInstanceView } = await import(new URL('js/context-instance-view.js', base).href);
    const site = await fetch(new URL('spec/site.json', base)).then(r => r.json());
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#a4b9c8');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(20, 50, 15); sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512); scene.add(sun);
    const context = buildContext(site, THREE, { date: '2026-11-17', assetUrl: p => new URL(p, base).href,
      track: p => p, afterRoom: fn => Promise.resolve().then(fn) });
    scene.add(context); await Promise.all([context.ready, context.later]);
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(640, 360); renderer.setPixelRatio(1); renderer.info.autoReset = false; renderer.shadowMap.enabled = true;
    const camera = new THREE.PerspectiveCamera(55, 640 / 360, .1, 1500);
    const reflection = new THREE.PerspectiveCamera(55, 640 / 360, .1, 1500);
    reflection.position.set(15, 3, 10); reflection.lookAt(-90, -site.floorY + 2, -120); reflection.updateMatrixWorld(true);
    const target = new THREE.WebGLRenderTarget(640, 360);
    const trigger = new THREE.Mesh(new THREE.PlaneGeometry(.1, .1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
    trigger.frustumCulled = false; trigger.renderOrder = -100; scene.add(trigger);
    const manager = createContextInstanceView({ THREE, scene }); let compact = false;
    trigger.onBeforeRender = (r, s, cam) => {
      if (cam !== camera) return;
      const previous = r.getRenderTarget(); r.setRenderTarget(target);
      try { if (compact) manager.draw(reflection, () => r.render(scene, reflection)); else r.render(scene, reflection); }
      finally { r.setRenderTarget(previous); }
    };
    const pixels = () => { const gl = renderer.getContext(), values = new Uint8Array(640 * 360 * 4); gl.readPixels(0, 0, 640, 360, gl.RGBA, gl.UNSIGNED_BYTE, values); return values; };
    const snapshot = () => { const objects = []; scene.traverse(o => { if (o.userData.rasterCullInstances) objects.push({ object: o,
      geometry: o.geometry, matrix: o.instanceMatrix, color: o.instanceColor, count: o.count, visible: o.visible,
      attributes: Object.entries(o.geometry.attributes), index: o.geometry.index }); }); return objects; };
    const compare = (a, b) => { let changed = 0, max = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) changed++; max = Math.max(max, d); } return { channels: a.length, changed, max }; };
    const results = []; let lastReference, lastTriangles;
    try {
      for (const date of ['2026-11-17', '2026-07-01', '2027-01-15']) {
        context.setSeason(date);
        for (const [name, at, look] of [ ['hall', [1.25, 1.68, 4.85], [2.6, 1.2, .2]],
          ['opposite', [1.25, 1.68, 4.85], [-30, 1, 80]], ['outside', [-90, 3, -50], [20, 0, -100]] ]) {
          camera.position.fromArray(at); camera.lookAt(...look); camera.updateMatrixWorld(true);
          compact = false; renderer.setRenderTarget(null); renderer.render(scene, camera); renderer.info.reset();
          renderer.render(scene, camera); const reference = pixels(), triangles = renderer.info.render.triangles;
          lastReference = reference; lastTriangles = triangles;
          const original = snapshot(); compact = true; renderer.info.reset();
          manager.draw(camera, () => renderer.render(scene, camera));
          const difference = compare(reference, pixels());
          for (const v of original) {
            const o = v.object;
            if (o.geometry !== v.geometry || o.instanceMatrix !== v.matrix || o.instanceColor !== v.color || o.count !== v.count || o.visible !== v.visible || o.geometry.index !== v.index || v.attributes.some(([k, a]) => o.geometry.attributes[k] !== a)) throw Error('Authored state was not restored');
          }
          if (difference.max > 1) throw Error('Nested context pixels changed: ' + JSON.stringify({ date, name, ...difference }));
          results.push({ date, name, difference, triangles: [triangles, renderer.info.render.triangles], stats: manager.stats });
        }
      }
      manager.dispose(); compact = false; renderer.info.reset(); renderer.render(scene, camera);
      const disposedDifference = compare(lastReference, pixels());
      if (disposedDifference.max > 1) throw Error('Disposal damaged original GPU resources: ' + JSON.stringify(disposedDifference));
      results.push({ date: 'disposed', name: 'original', difference: disposedDifference,
        triangles: [lastTriangles, renderer.info.render.triangles], stats: manager.stats });
      return results;
    } finally { manager.dispose(); target.dispose(); trigger.geometry.dispose(); trigger.material.dispose(); renderer.dispose(); }
  }, base);
} catch (error) { report.failure = error.stack; process.exitCode = 1; }
finally {
  clearTimeout(timer); await browser?.close(); report.cleanup = true;
  fs.writeFileSync(path.join(output, 'context-instance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cleanup: report.cleanup, errors: report.errors, failure: report.failure, results: report.result?.map(x => ({ date: x.date, name: x.name, difference: x.difference, triangles: x.triangles })) }));
}
