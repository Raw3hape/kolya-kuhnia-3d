// Paired real-scene guard CPU measurements. Both modules share one page, scene,
// renderer and THREE identity; every timed pair runs synchronously without RAF.
// Existing PLAYWRIGHT_MODULE only. One bounded muted browser, closed in finally.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { awaitPlayable } from './await-playable.mjs';

const url = process.env.QA_URL || 'http://127.0.0.1:8788/candidate/';
const before = process.env.QA_BEFORE_URL || 'http://127.0.0.1:8788/baseline/';
const quality = process.env.QA_QUALITY || 'eco';
if (!['eco', 'fast', 'high', 'ultra'].includes(quality)) throw Error('QA_QUALITY must be eco, fast, high or ultra');
const tier = { eco: '512', fast: '1k', high: 'full', ultra: 'full' }[quality];
const output = path.resolve(process.env.QA_OUTPUT || 'output/playwright/raster-cpu');
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const cpuRate = Math.max(1, Math.min(8, Number(process.env.QA_CPU_RATE || 1)));
const rounds = Math.max(4, Math.min(30, Number(process.env.QA_ROUNDS || 12)));
const draws = Math.max(4, Math.min(100, Number(process.env.QA_DRAWS || 16)));
const frameRounds = Math.max(4, Math.min(20, Number(process.env.QA_FRAME_ROUNDS || 6)));
const viewFilter = (process.env.QA_VIEWS || process.env.QA_VIEW || '').split(',').map(value => value.trim()).filter(Boolean);
const extras = [...new Set([...(process.env.QA_EXTRAS === '1' ? ['rc-table', 'rc-field'] : (process.env.QA_EXTRAS || '').split(',').map(value => value.trim()).filter(Boolean)),
  ...viewFilter.filter(value => value === 'rc-table' || value === 'rc-field')])];
if (extras.some(value => !['rc-table', 'rc-field'].includes(value)) || viewFilter.some(value => !['hall', 'living', 'bath-mirror', 'rc-table', 'rc-field'].includes(value))) throw Error('Unknown QA_EXTRAS/QA_VIEWS name');
const report = { url, before, quality, tier, cpuRate, rounds, draws, frameRounds, viewFilter, extras, errors: [], cleanup: false };
fs.mkdirSync(output, { recursive: true });
const save = () => fs.writeFileSync(path.join(output, (process.env.QA_LABEL || 'paired') + '.json'), JSON.stringify(report, null, 2));
let browser, page, cdp;
const watchdog = setTimeout(() => { browser?.close().finally(() => process.exit(2)); }, 240000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem('kitchen-ui-v1', JSON.stringify({ quality: 'eco', seen: { intro: true } })));
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Permissions policy violation: compute-pressure')) report.errors.push(message.text().slice(0, 700)); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await awaitPlayable(page);
  await page.evaluate(quality => dispatchEvent(new CustomEvent('kitchen-quality', { detail: quality })), quality);
  await page.waitForFunction(({ quality, tier }) => __kitchen.pipe.quality === quality && __kitchen.M.floorA.userData.tier === tier,
    { quality, tier }, { timeout: 60000 });
  await page.waitForFunction(() => __kitchen.hunt?.stats.ready && __kitchen.lighting.debug.stable && !__kitchen.pipe.preparing, null, { timeout: 60000 });
  await page.evaluate(() => __kitchen.pipe.whenDrawn());
  await page.getByRole('button', { name: 'Понятно', exact: true }).click({ timeout: 700 }).catch(() => {});
  report.identity = { url: page.url(), title: await page.title(), meaningful: (await page.locator('body').innerText()).trim().length > 50 };
  if (!report.identity.meaningful) throw Error('The actual application did not render meaningful content');
  await page.evaluate(async ({ before, url }) => {
    const THREE = await import('three');
    const [oldModule, newModule, ecoModule, site] = await Promise.all([
      import(new URL('js/raster-batches.js', before).href), import(new URL('js/raster-batches.js', url).href), import(new URL('js/eco-materials.js', url).href),
      fetch(new URL('spec/site.json', url)).then(response => { if (!response.ok) throw Error('Site config unavailable'); return response.json(); }),
    ]);
    const k = __kitchen, originalRender = k.pipe.render;
    const f = window.__rasterCpuQA = { k, THREE, originalRender, originalWorld: k.pipe.drawWorld, nestedCalls: 0, clean: false,
      viewConfig: { table: k.rc?.config?.table, spawn: k.rc?.config?.arena?.spawn?.center, ground: -site.floorY } };
    k.pipe.render = () => {};
    f.cleanup = () => {
      if (f.clean) return; f.clean = true;
      try { for (const pending of f.gpuPending || []) k.renderer.getContext().deleteQuery(pending.query); f.gpuPending = []; f.old?.dispose(); f.next?.dispose(); f.eco?.dispose(); }
      finally { k.pipe.render = originalRender; k.pipe.drawWorld = f.originalWorld; k.requestRender(); delete window.__rasterCpuQA; }
    };
    try {
      const options = { THREE, scene: k.scene, renderer: k.renderer, quality: k.pipe.quality };
      f.old = oldModule.createRasterBatches(options); f.next = newModule.createRasterBatches(options);
      f.eco = k.pipe.quality === 'eco' ? ecoModule.createEcoMaterials(options) : null;
      f.advance = () => { f.old.update(k.camera); f.next.update(k.camera); f.eco?.update(k.camera); };
      f.ready = () => [f.old, f.next].every(manager => manager.stats.ready + manager.stats.failed === manager.stats.groups) &&
        (!f.eco || f.eco.stats.compiling === 0 && f.eco.stats.ready + f.eco.stats.failed === f.eco.stats.programs);
      f.advance();
    } catch (error) { f.cleanup(); throw error; }
  }, { before, url });
  await page.waitForFunction(() => { const f = window.__rasterCpuQA; f.advance(); return f.ready(); }, null, { timeout: 60000, polling: 'raf' });
  report.prepared = await page.evaluate(() => {
    const f = __rasterCpuQA, a = f.old.stats, b = f.next.stats;
    if (a.failed || b.failed) throw Error(`Batch preparation failed: ${a.failed}/${b.failed}`);
    for (const key of ['sources', 'groups', 'ready', 'vertices']) if (a[key] !== b[key]) throw Error(`Unmatched ${key}: ${a[key]}/${b[key]}`);
    return { before: a, after: b, eco: f.eco?.stats || null, quality: f.k.pipe.quality, tier: f.k.M.floorA.userData.tier };
  });
  cdp = await context.newCDPSession(page);
  if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  report.cpu = await page.evaluate(({ rounds, draws }) => {
    const f = __rasterCpuQA, k = f.k, now = performance.now.bind(performance), samples = [];
    const snapshot = () => {
      const records = [];
      function visit(o) { if (o.name === 'raster_batches') return; records.push([o, o.parent, o.visible, o.layers.mask, o.geometry, o.material, o.instanceMatrix, o.instanceColor, o.count]); for (const c of o.children) visit(c); }
      visit(k.scene); return records;
    };
    f.snapshot = snapshot;
    f.same = (a, b) => a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((value, key) => value === b[i][key]));
    k.scene.updateMatrixWorld();
    const canonical = snapshot();
    for (let i = 0; i < 24; i++) { f.old.draw(() => {}, { matricesCurrent: true }); f.next.draw(() => {}, { matricesCurrent: true }); }
    const measure = manager => { const start = now(); for (let i = 0; i < draws; i++) manager.draw(() => {}, { matricesCurrent: true }); return (now() - start) / draws; };
    for (let round = 0; round < rounds; round++) {
      let before, after;
      if (round % 2) { after = measure(f.next); before = measure(f.old); } else { before = measure(f.old); after = measure(f.next); }
      samples.push({ round, order: round % 2 ? 'after-before' : 'before-after', beforeMs: before, afterMs: after, ratio: before / after });
    }
    if (!f.same(canonical, snapshot())) throw Error('Timed batch draws changed the canonical scene');
    const summary = values => { const s = values.slice().sort((a,b) => a-b); return { median: s[Math.floor(s.length / 2)], mean: s.reduce((a,b) => a+b, 0) / s.length, min: s[0], max: s.at(-1) }; };
    return { samples, before: summary(samples.map(s => s.beforeMs)), after: summary(samples.map(s => s.afterMs)), pairedRatio: summary(samples.map(s => s.ratio)),
      canonicalNodes: canonical.length, canonicalRestored: true, sameSynchronousTask: true, matricesPreparedOnce: true,
      beforeStats: f.old.stats, afterStats: f.next.stats };
  }, { rounds, draws });
  report.pixels = await page.evaluate(({ frameRounds, cpuRate, extras, viewFilter }) => {
    const f = __rasterCpuQA, { k, THREE } = f, renderer = k.renderer, gl = renderer.getContext(), originalCamera = k.camera.clone();
    const originalAuto = k.scene.matrixWorldAutoUpdate, originalReset = renderer.info.autoReset, originalShadow = renderer.shadowMap.needsUpdate;
    const ownNow = Object.getOwnPropertyDescriptor(performance, 'now'), originalDateNow = Date.now, date = Date.now();
    const nativeNow = performance.now.bind(performance); let frozen = nativeNow() + 1000;
    const results = [], passes = [], canonical = f.snapshot(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const scratch = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    f.gpuPending = [];
    let views = [['hall', 1.25, 4.85, 0], ['living', 4.7, 2.5, Math.PI / 2], ['bath-mirror', .8, 5.7, Math.PI]];
    if (extras.length) {
      const { table, spawn, ground } = f.viewConfig, p = table?.position;
      if (extras.includes('rc-table')) {
        const x = p?.[0] ?? p?.x, z = p?.[2] ?? p?.z;
        if (![x,z].every(Number.isFinite)) throw Error('RC table config unavailable');
        views.push(['rc-table', x, z + 1.4, 0, 1.45, -.42]);
      }
      if (extras.includes('rc-field')) {
        const x = spawn?.[0] ?? spawn?.x, z = spawn?.[1] ?? spawn?.z;
        if (![x,z,ground].every(Number.isFinite)) throw Error('RC spawn/site config unavailable');
        views.push(['rc-field', x + 3, z + 5, 0, ground + 2, 0, [x, ground + .5, z]]);
      }
    }
    if (viewFilter.length) views = views.filter(view => viewFilter.includes(view[0]));
    if (!views.some(view => view[0] === 'bath-mirror')) views.push(['bath-mirror-witness', .8, 5.7, Math.PI, 1.68, 0, null, true]);
    k.pipe.drawWorld = function(camera) { if (camera !== k.camera) f.nestedCalls++; return f.originalWorld.call(this, camera); };
    Object.defineProperty(performance, 'now', { configurable: true, value: () => frozen }); Date.now = () => date;
    renderer.info.autoReset = false; renderer.shadowMap.needsUpdate = false;
    function render(manager, lane, phase, round = -1, pixels = scratch) {
      frozen += 200; // Re-render stationary mirrors; simulation/uniform times stay frozen with no RAF.
      renderer.info.reset(); const nested = f.nestedCalls;
      const query = ext ? gl.createQuery() : null;
      if (query) f.gpuPending.push({ query, view: results.length, pass: passes.length });
      if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      let submitCpuMs;
      try {
        const start = nativeNow();
        manager.draw(() => f.eco ? f.eco.draw(() => k.pipe.drawWorld(k.camera)) : k.pipe.drawWorld(k.camera), { matricesCurrent: true });
        submitCpuMs = nativeNow() - start;
      } finally { if (query) gl.endQuery(ext.TIME_ELAPSED_EXT); }
      // This readback also synchronizes the preceding submission before the
      // next paired frame. It is deliberately outside the submission timer.
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const pass = { lane, phase, round, submitCpuMs, gpuMs: null, calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles, reflectedPasses: f.nestedCalls - nested };
      passes.push(pass);
      return pixels;
    }
    const difference = (a,b) => { let channels = 0, maximum = 0; for (let i=0;i<a.length;i++) { const n=Math.abs(a[i]-b[i]); if(n)channels++; maximum=Math.max(maximum,n); } return { channels, maximum, totalChannels: a.length }; };
    const summary = values => { const sorted = values.slice().sort((a,b) => a-b); return { median: sorted[Math.floor(sorted.length / 2)] ?? null, mean: sorted.length ? sorted.reduce((a,b) => a+b, 0) / sorted.length : null, count: sorted.length }; };
    try {
      for (const [name, x, z, yaw, y = 1.68, pitch = 0, target, mirrorWitness = false] of views) {
        k.camera.position.set(x, y, z); k.camera.rotation.set(pitch, yaw, 0, 'YXZ');
        if (target) k.camera.lookAt(...target); k.camera.updateMatrixWorld();
        k.scene.updateMatrixWorld(); k.scene.matrixWorldAutoUpdate = false;
        render(f.old, 'before', 'warm'); render(f.next, 'after', 'warm');
        const a = render(f.old, 'before', 'compare', -1, new Uint8Array(scratch.length));
        const b = render(f.next, 'after', 'compare', -1, new Uint8Array(scratch.length));
        const c = render(f.old, 'before', 'compare', -1, new Uint8Array(scratch.length));
        let timedDifferingChannels = 0;
        for (let round = 0; round < (mirrorWitness ? 0 : frameRounds); round++) {
          const order = round % 2 ? [[f.next, 'after'], [f.old, 'before']] : [[f.old, 'before'], [f.next, 'after']];
          for (const [manager, lane] of order) timedDifferingChannels += difference(a, render(manager, lane, 'timed', round)).channels;
        }
        const submission = {};
        for (const lane of ['before', 'after']) submission[lane] = summary(passes.filter(pass => pass.phase === 'timed' && pass.lane === lane).map(pass => pass.submitCpuMs));
        results.push({ name, mirrorWitness, camera: { position: k.camera.position.toArray(), target: target || null, yaw, pitch },
          beforeAfter: difference(a,b), beforeRepeat: difference(a,c), timedDifferingChannels, submission, passes: passes.splice(0) });
        if (!f.same(canonical, f.snapshot())) throw Error(`Canonical references changed after ${name}`);
      }
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { results, reflectedPasses: f.nestedCalls, clockStepMs: 200, noRafBetweenComparisons: true, canonicalRestored: true,
        gpuQuerySupported: !!ext, submissionExcludesReadback: true, renderCpuRate: cpuRate,
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), size: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
    } finally {
      k.camera.copy(originalCamera, false); k.scene.matrixWorldAutoUpdate = originalAuto;
      renderer.info.autoReset = originalReset; renderer.shadowMap.needsUpdate = originalShadow;
      if (ownNow) Object.defineProperty(performance, 'now', ownNow); else delete performance.now;
      Date.now = originalDateNow; k.pipe.drawWorld = f.originalWorld;
    }
  }, { frameRounds, cpuRate, extras, viewFilter });
  report.gpuQueries = await page.evaluate(async () => {
    const f = __rasterCpuQA, gl = f.k.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), pending = f.gpuPending || [];
    try {
      for (let attempt = 0; attempt < 5 && pending.some(row => !gl.getQueryParameter(row.query, gl.QUERY_RESULT_AVAILABLE)); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
      return pending.map(row => ({ view: row.view, pass: row.pass, gpuMs: gl.getQueryParameter(row.query, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT) ? gl.getQueryParameter(row.query, gl.QUERY_RESULT) / 1e6 : null }));
    } finally { for (const row of pending) gl.deleteQuery(row.query); f.gpuPending = []; }
  });
  for (const query of report.gpuQueries) report.pixels.results[query.view].passes[query.pass].gpuMs = query.gpuMs;
  for (const view of report.pixels.results) {
    view.gpu = {};
    for (const lane of ['before', 'after']) {
      const values = view.passes.filter(pass => pass.phase === 'timed' && pass.lane === lane && Number.isFinite(pass.gpuMs)).map(pass => pass.gpuMs).sort((a,b) => a-b);
      view.gpu[lane] = { median: values[Math.floor(values.length / 2)] ?? null, count: values.length };
    }
  }
  if (!report.pixels.reflectedPasses) throw Error('No actual reflected-camera draw was compared');
  if (report.pixels.results.some(result => result.beforeAfter.channels || result.beforeRepeat.channels || result.timedDifferingChannels)) throw Error('Pixel equality failed; inspect old/new/old drift before accepting this comparison');
  await page.evaluate(() => window.__rasterCpuQA.cleanup());
} catch (error) { report.failure = error.stack; process.exitCode = 1; }
finally {
  clearTimeout(watchdog);
  if (cdp) { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {}); await cdp.detach().catch(() => {}); }
  if (page && !page.isClosed()) await page.evaluate(() => window.__rasterCpuQA?.cleanup()).catch(() => {});
  await browser?.close(); report.cleanup = true; if (report.errors.length) process.exitCode = 1; save();
  console.log(JSON.stringify({ file: path.join(output, (process.env.QA_LABEL || 'paired') + '.json'), failure: report.failure || null,
    cpu: report.cpu && { before: report.cpu.before.median, after: report.cpu.after.median, ratio: report.cpu.pairedRatio.median },
    pixels: report.pixels?.results.filter(result => !result.mirrorWitness).map(result => ({ view: result.name, differing: result.beforeAfter.channels,
      repeatDrift: result.beforeRepeat.channels, timedDrift: result.timedDifferingChannels,
      submitBeforeMs: result.submission.before.median, submitAfterMs: result.submission.after.median,
      gpuBeforeMs: result.gpu.before.median, gpuAfterMs: result.gpu.after.median })), errors: report.errors.length, cleanup: report.cleanup }));
}
