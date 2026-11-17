// Compare generated context before/after exact vertex indexing in real WebGL.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const before = process.env.QA_BEFORE_URL, after = process.env.QA_URL;
if (!before || !after) throw Error('Set QA_BEFORE_URL and QA_URL to frozen source lanes');
const output = path.resolve(process.env.QA_OUTPUT || 'output/playwright/context-index');
fs.mkdirSync(output, { recursive: true });
let browser;
const report = { before, after, errors: [], cleanup: false };
const timer = setTimeout(() => browser?.close(), 120000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  const fixture = new URL('__context-index-qa__.html', after).href;
  const imports = { three: new URL('vendor/three-0.169/build/three.module.js', after).href,
    'three/addons/': new URL('vendor/three-0.169/examples/jsm/', after).href };
  await page.route(fixture, route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<html><head><script type="importmap">' + JSON.stringify({ imports }) + '</script></head><body></body></html>' }));
  await page.goto(fixture);
  report.result = await page.evaluate(async ({ before, after }) => {
    const THREE = await import(new URL('vendor/three-0.169/build/three.module.js', after).href);
    const site = await fetch(new URL('spec/site.json', after)).then(r => r.json());
    const lanes = [], width = 640, height = 360;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    try {
      for (const base of [before, after]) {
        const { buildContext } = await import(new URL('js/site.js', base).href);
        const scene = new THREE.Scene(); scene.background = new THREE.Color('#a4b9c8');
        scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2));
        const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(20, 50, 15); sun.castShadow = true;
        sun.shadow.mapSize.set(512, 512); scene.add(sun);
        const context = buildContext(site, THREE, { date: '2026-11-17', assetUrl: p => new URL(p, base).href,
          track: p => p, afterRoom: fn => Promise.resolve().then(fn) });
        scene.add(context); await Promise.all([context.ready, context.later]);
        const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
        renderer.setSize(width, height); renderer.setPixelRatio(1); renderer.shadowMap.enabled = true;
        const camera = new THREE.PerspectiveCamera(55, width / height, .1, 1500);
        const geometries = new Set(); let vertices = 0, bytes = 0, indices = 0;
        context.traverse(o => { const g = o.geometry; if (!g || geometries.has(g)) return; geometries.add(g);
          vertices += g.attributes.position?.count || 0; indices += g.index?.count || 0;
          const buffers = new Set();
          for (const a of [...Object.values(g.attributes), g.index].filter(Boolean)) {
            const array = a.isInterleavedBufferAttribute ? a.data.array : a.array;
            if (!buffers.has(array)) { buffers.add(array); bytes += array.byteLength; }
          }
        });
        lanes.push({ scene, context, renderer, camera, geometry: { vertices, bytes, indices, geometries: geometries.size } });
      }
      const results = [];
      for (const date of ['2026-11-17', '2026-07-01', '2027-01-15']) {
        for (const lane of lanes) lane.context.setSeason(date);
        for (const [name, at, look] of [['hall', [1.25, 1.68, 4.85], [2.6, 1.2, .2]],
          ['opposite', [1.25, 1.68, 4.85], [-30, 1, 80]], ['outside', [-90, 3, -50], [20, 0, -100]]]) {
          const samples = [], order = results.length % 2 ? [1, 0] : [0, 1];
          for (const laneIndex of order) {
            const lane = lanes[laneIndex];
            const { renderer, scene, camera } = lane;
            camera.position.fromArray(at); camera.lookAt(...look); camera.updateMatrixWorld(true);
            renderer.render(scene, camera); renderer.render(scene, camera);
            const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
            const pixels = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            const query = ext ? gl.createQuery() : null, draws = 20;
            if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
            for (let i = 0; i < draws; i++) renderer.render(scene, camera);
            if (query) gl.endQuery(ext.TIME_ELAPSED_EXT);
            let gpuMs = null;
            if (query) {
              for (let i = 0; i < 120; i++) {
                await nextFrame();
                if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
                  if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 / draws;
                  break;
                }
              }
              gl.deleteQuery(query);
            }
            samples[laneIndex] = { pixels, gpuMs, triangles: renderer.info.render.triangles };
          }
          let changed = 0, max = 0;
          for (let i = 0; i < samples[0].pixels.length; i++) {
            const d = Math.abs(samples[0].pixels[i] - samples[1].pixels[i]); if (d) changed++; max = Math.max(max, d);
          }
          const result = { date, name, order, channels: samples[0].pixels.length, changed, max,
            triangles: samples.map(s => s.triangles), gpuMs: samples.map(s => s.gpuMs) };
          results.push(result);
          if (changed) throw Error('Exact indexed context pixels changed: ' + JSON.stringify(result));
        }
      }
      return { geometry: lanes.map(lane => lane.geometry), views: results };
    } finally { for (const lane of lanes) lane.renderer.dispose(); }
  }, { before, after });
  if (report.errors.length) throw Error(report.errors.join('\n'));
} catch (error) { report.failure = error.stack; process.exitCode = 1; }
finally {
  clearTimeout(timer); await browser?.close(); report.cleanup = true;
  fs.writeFileSync(path.join(output, 'context-index.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cleanup: report.cleanup, errors: report.errors, failure: report.failure,
    geometry: report.result?.geometry, views: report.result?.views }));
}
