// Comparable real-WebGL CPU/GPU/frame measurements. No package install; one muted
// browser, bounded runtime, closes every context in finally. See tools/qa/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const url = process.env.QA_URL || 'http://127.0.0.1:8776/';
const output = path.resolve(process.env.QA_OUTPUT || 'output/playwright/performance');
fs.mkdirSync(output, { recursive: true });
const report = { url, label: process.env.QA_LABEL || 'candidate', viewport: [1280, 720], results: [], errors: [], cleanup: false };
const pause = ms => new Promise(r => setTimeout(r, ms));
let browser;
const watchdog = setTimeout(() => { browser?.close().finally(() => process.exit(2)); }, 240000);
function save() { fs.writeFileSync(path.join(output, report.label + '.json'), JSON.stringify(report, null, 2)); }
async function page(target = url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => { localStorage.setItem('kitchen-ui-v1', JSON.stringify({ quality: 'eco', seen: { intro: true } })); });
  const p = await context.newPage();
  p.on('pageerror', e => { if (report.errors.length < 20) report.errors.push(e.message); });
  p.on('console', m => { if (m.type()==='error' && report.errors.length < 20) report.errors.push(m.text().slice(0,700)); });
  await p.goto(target, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__kitchen?.hunt?.stats?.ready, { timeout: 90000 });
  await p.getByRole('button', { name: 'Понятно', exact: true }).click({ timeout: 700 }).catch(() => {});
  await p.evaluate(async () => { await Promise.all([__kitchen.decor?.ready, __kitchen.paper?.ready]); });
  await p.waitForFunction(() => !__kitchen.lighting.debug.baking, {timeout:45000});
  await p.waitForFunction(() => !__kitchen.pipe.batches || __kitchen.pipe.batches.ready === __kitchen.pipe.batches.groups, {timeout:30000});
  await p.waitForFunction(() => !__kitchen.pipe.eco || __kitchen.pipe.eco.ready === __kitchen.pipe.eco.programs, {timeout:30000});
  await pause(2000);
  return p;
}
async function measure(p, name) {
  const session = await p.context().newCDPSession(p);
  await session.send('Profiler.enable'); await session.send('Profiler.start');
  const metrics = await p.evaluate(async () => {
    const k = __kitchen, renderer = k.renderer, gl = renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), pending = [], gpu = [], cpu = [], gaps = [], calls = [], tris = [];
    const original = k.pipe.render, reset = renderer.info.autoReset, originalShadows = renderer.shadowMap.render;
    const shadowUpdates = window.__performanceShadowUpdates = {}; let last = performance.now(), n = 0;
    renderer.shadowMap.render = function (lights,...args) {
      if(this.autoUpdate || this.needsUpdate) for(const l of lights) if(l.shadow.autoUpdate || l.shadow.needsUpdate) {
        const key = `${l.name||l.type}:${l.id}:${l.intensity>0?'on':'off'}`;
        shadowUpdates[key]=(shadowUpdates[key]||0)+1;
      }
      return originalShadows.call(this,lights,...args);
    };
    k.requestRender(); // Continuous render demand, as during camera movement.
    renderer.info.autoReset = false;
    k.pipe.render = function (...args) {
      const now = performance.now(); gaps.push(now - last); last = now; renderer.info.reset();
      let query;
      if (ext && n++ % 4 === 0) { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); }
      const start = performance.now();
      try { return original.apply(this, args); }
      finally {
        cpu.push(performance.now() - start); calls.push(renderer.info.render.calls); tris.push(renderer.info.render.triangles);
        k.requestRender();
        if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); }
        while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
          const q = pending.shift();
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(q);
        }
      }
    };
    await new Promise(r => setTimeout(r, 4000));
    k.pipe.render = original; renderer.info.autoReset = reset; renderer.shadowMap.render=originalShadows;
    for (const q of pending) gl.deleteQuery(q);
    const summary = a => { const s = a.filter(Number.isFinite).sort((a,b) => a-b); return { mean: s.reduce((a,b)=>a+b,0)/s.length, p50:s[s.length>>1], p95:s[Math.floor(s.length*.95)], count:s.length }; };
    let meshes = 0, vertices = 0, lights = 0, shadows = 0;
    k.scene.traverse(o => { if(o.isMesh) {meshes++; vertices += o.geometry?.attributes?.position?.count || 0;} if(o.isLight){lights++; if(o.castShadow) shadows++;} });
    const hardware = gl.getExtension('WEBGL_debug_renderer_info');
    return { quality: k.pipe.quality, fps: 1000 / summary(gaps).mean, frameMs: summary(gaps), renderCpuMs: summary(cpu), gpuMs: summary(gpu), drawCalls: summary(calls), triangles: summary(tris), scene: {meshes,vertices,lights,shadows}, gpu:hardware ? gl.getParameter(hardware.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), role:k.multiplayer?.client.role, position:k.camera.position.toArray(), size:[gl.drawingBufferWidth,gl.drawingBufferHeight] };
  });
  const { profile } = await session.send('Profiler.stop'); await session.detach();
  metrics.shadowUpdates = await p.evaluate(() => { const v = window.__performanceShadowUpdates; delete window.__performanceShadowUpdates; return v; });
  metrics.batches = await p.evaluate(() => __kitchen.pipe.batches || null);
  metrics.eco = await p.evaluate(() => __kitchen.pipe.eco || null);
  const nodeMap = new Map(profile.nodes.map(n => [n.id,n])), totals = new Map();
  for (let i=0;i<(profile.samples?.length||0);i++) { const f=nodeMap.get(profile.samples[i])?.callFrame; if(!f)continue; const key=`${f.functionName || '(anonymous)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber+1}`; totals.set(key,(totals.get(key)||0)+(profile.timeDeltas?.[i]||0)/1000); }
  const selfCpu = [...totals].sort((a,b)=>b[1]-a[1]).slice(0,24).map(([fn,ms])=>({fn,ms:Math.round(ms)}));
  report.results.push({ name, ...metrics, selfCpu }); save();
  console.log(JSON.stringify({name,fps:metrics.fps,renderCpu:metrics.renderCpuMs.mean,gpu:metrics.gpuMs.mean,drawCalls:metrics.drawCalls.mean}));
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  report.browser = browser.version();
  const host = await page();
  await measure(host, 'solo-hall');
  await host.screenshot({ path:path.join(output,report.label+'-hall.png') });
  await host.evaluate(() => __kitchen.walk.enter({x:3.7,z:2},0)); await pause(800);
  await measure(host, 'solo-window');
  await host.evaluate(() => __kitchen.walk.enter({x:1.25,z:4.85},0));
  await host.getByRole('button', {name:'Играть вместе',exact:true}).click();
  await host.getByPlaceholder('Как вас зовут?').fill('Performance QA Host');
  await host.getByRole('button',{name:'Создать комнату',exact:true}).click();
  await host.waitForFunction(()=>__kitchen.multiplayer.client.connected, {timeout:45000});
  const guest = await page(await host.evaluate(()=>__kitchen.multiplayer.client.inviteUrl));
  await guest.getByPlaceholder('Как вас зовут?').fill('Performance QA Guest');
  await guest.getByRole('button',{name:'Войти в квартиру',exact:true}).click();
  await guest.waitForFunction(()=>__kitchen.multiplayer.client.connected,{timeout:45000});
  await Promise.all([host,guest].map(p=>p.evaluate(()=>__kitchen.multiplayer.lobby.close()))); await pause(1000);
  await measure(host,'host-hall'); await measure(guest,'guest-hall');
  await guest.screenshot({path:path.join(output,report.label+'-guest.png')});
  await guest.keyboard.down('KeyW'); await pause(500); await guest.keyboard.up('KeyW');
  await guest.keyboard.press('Digit2'); await pause(800);
  await guest.mouse.click(640,360); await guest.keyboard.press('KeyR');
  await pause(500);
  report.smoke = await Promise.all([host,guest].map(p=>p.evaluate(()=>({connected:__kitchen.multiplayer.client.connected,players:__kitchen.multiplayer.client.state.players.length,weapon:__kitchen.multiplayer.client.self.weapon,ammo:__kitchen.multiplayer.client.self.ammo}))));
  if (!report.smoke.every(s=>s.connected && s.players===2)) throw new Error('Multiplayer smoke lost a player');
  if (process.env.QA_EXTENDED === '1') {
    report.qualities = [];
    for (const quality of ['fast','high','eco']) {
      await host.evaluate(q => dispatchEvent(new CustomEvent('kitchen-quality',{detail:q})),quality);
      await host.evaluate(() => __kitchen.pipe.whenDrawn()); await pause(1800);
      report.qualities.push(await host.evaluate(() => ({quality:__kitchen.pipe.quality,normal:!!__kitchen.M.floorA.normalMap,tier:__kitchen.M.floorA.userData.tier,programs:__kitchen.renderer.info.programs.length})));
      if(quality==='high') await host.screenshot({path:path.join(output,report.label+'-high.png')});
      if(quality==='high' && process.env.QA_HIGH_MEASURE==='1') await measure(host,'host-high');
    }
    report.capture = await host.evaluate(async()=>{const b=await __kitchen.pipe.capture(0);return {type:b?.type,size:b?.size};});
    await guest.setViewportSize({width:390,height:844}); await pause(500);
    await guest.screenshot({path:path.join(output,report.label+'-mobile-layout.png')});
    report.responsive = await guest.evaluate(()=>({width:innerWidth,canvas:__kitchen.renderer.domElement.width,connected:__kitchen.multiplayer.client.connected}));
    save();
  }
  await host.evaluate(()=>__kitchen.multiplayer.client.leave());
} catch (error) { report.failure = error.stack; console.error(error.stack); process.exitCode=1; }
finally { clearTimeout(watchdog); await browser?.close(); report.cleanup=true; if(report.failure || report.errors.length) process.exitCode=1; save(); }
