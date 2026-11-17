// Deterministic old/new actual wildlife shaders in two renderers, one browser.
// Same canonical poses, colors, animation and camera; no authority/app patches.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const before = process.env.QA_BEFORE_URL, after = process.env.QA_URL;
if (!before || !after) throw Error('Set QA_BEFORE_URL and QA_URL to frozen source lanes');
const output = path.resolve(process.env.QA_OUTPUT || 'output/playwright/wildlife-render');
fs.mkdirSync(output, { recursive: true });
let browser;
const report = { before, after, errors: [], cleanup: false };
const timer = setTimeout(() => browser?.close(), 60000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  const fixture = new URL('__wildlife-render-qa__.html', after).href;
  await page.route(fixture, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(fixture);
  report.result = await page.evaluate(async ({ before, after }) => {
    const THREE = await import(new URL('vendor/three-0.169/build/three.module.js', after).href);
    const site = await fetch(new URL('spec/site.json', after)).then(r => r.json());
    const plan = await fetch(new URL('spec/plan.generated.json', after)).then(r => r.json());
    const oldRandom = Math.random, views = [], width = 640, height = 360;
    const nextFrame = () => new Promise(r => requestAnimationFrame(r));
    try {
      for (const base of [before, after]) {
        const { createHunt } = await import(new URL('js/hunt.js', base).href);
        let seed = 1729; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
        renderer.setSize(width, height); renderer.setPixelRatio(1);
        const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, width / height, .1, 1000);
        scene.background = new THREE.Color('#839aa5'); scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2));
        const ground = -site.floorY;
        camera.position.set(-100, ground + 3, 0); camera.lookAt(-100, ground + .6, 22); camera.updateMatrixWorld(true);
        const hunt = createHunt({ THREE, scene, camera, renderer, pipe: {}, plan, site, getWalk: () => ({ active: true }) });
        const view = { renderer, scene, camera, hunt }; views.push(view);
        const until = performance.now() + 15000;
        while (!hunt.stats.ready) { if (performance.now() > until) throw Error('Wildlife did not initialize'); await new Promise(r => setTimeout(r, 5)); }
        hunt.setNetwork(true);
        const animals = [];
        for (const [kind, indices] of [['boar', [2, 17, 55]], ['bird', [3, 49, 95]]]) for (let j = 0; j < indices.length; j++) {
          const i = indices[j]; animals.push({ kind, i, id: `${kind}:${i}:1`, generation: 1, active: true, dead: false, hp: 100,
            x: -103 + j * 3, y: ground + (kind === 'bird' ? 2 : 0), z: kind === 'bird' ? 27 : 20,
            yaw: j * .6, pitch: .1, roll: .1, scale: kind === 'bird' ? 2 : 1.5,
            phase: .31 + j * .1, gait: 2, graze: .35, alert: .5, fall: 0, fade: 0, flash: 0, pig: false,
            sp: 'goose', birdKind: 3, fat: 1.1, amp: .7, fold: 0, peck: 0 });
        }
        hunt.applyNetworkSnapshot({ time: 10, animals, encounters: { events: [] } }, 0); hunt.update(1 / 60);
        renderer.render(scene, camera);
        const gl = renderer.getContext(), pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        view.pixels = pixels; view.triangles = renderer.info.render.triangles;
        view.instances = scene.getObjectByName('hunt').children.filter(o => o.isInstancedMesh).map(o => o.count);
      }
      let changed = 0, max = 0;
      for (let i = 0; i < views[0].pixels.length; i++) { const delta = Math.abs(views[0].pixels[i] - views[1].pixels[i]); if (delta) changed++; max = Math.max(max, delta); }
      if (max > 1) throw Error('Canonical wildlife image changed: ' + JSON.stringify({ changed, max }));
      const timings = [];
      for (const view of views) {
        const gl = view.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (!ext) { timings.push(null); continue; }
        const query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        for (let i = 0; i < 100; i++) view.renderer.render(view.scene, view.camera);
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        const until = performance.now() + 10000;
        while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) { if (performance.now() > until) throw Error('GPU query timeout'); await nextFrame(); }
        timings.push(gl.getParameter(ext.GPU_DISJOINT_EXT) ? null : gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e8); gl.deleteQuery(query);
      }
      return { channels: views[0].pixels.length, changed, max, triangles: views.map(v => v.triangles), instances: views.map(v => v.instances), gpuMsPerDraw: timings };
    } finally { Math.random = oldRandom; for (const v of views) { v.hunt.dispose(); v.renderer.dispose(); } }
  }, { before, after });
} catch (error) { report.failure = error.stack; process.exitCode = 1; }
finally {
  clearTimeout(timer); await browser?.close(); report.cleanup = true;
  fs.writeFileSync(path.join(output, 'wildlife-render.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
