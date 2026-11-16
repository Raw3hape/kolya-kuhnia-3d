// One bounded WebGL witness for all supported encounter models; no game state mutation.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const url = process.env.QA_URL || 'http://127.0.0.1:8765/', output = process.env.QA_OUTPUT || 'output/playwright/field-gallery'; fs.mkdirSync(output, { recursive: true });
let browser; const deadline = setTimeout(() => browser?.close(), 60000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const p = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  await p.goto(new URL('robots.txt', url).href);
  await p.setContent('<style>body{margin:0}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/vendor/three-0.169/build/three.module.js"}}</script>');
  const result = await p.evaluate(async () => {
    const T = await import('three'), { createFieldEventView } = await import('/js/field-events-view.js');
    const spec = await fetch('/spec/hunt.json').then(r => r.json()), kinds = Object.keys(spec.events.types);
    const scene = new T.Scene(); scene.background = new T.Color('#bfcdd0');
    scene.add(new T.HemisphereLight('#e9f5ff', '#756347', 2.5));
    const sun = new T.DirectionalLight('#fff1d2', 3); sun.position.set(-15, 25, 20); scene.add(sun);
    const renderer = new T.WebGLRenderer({ antialias: true }); renderer.setSize(1400, 820); renderer.setPixelRatio(1); document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(38, 1400 / 820, .1, 300); camera.position.set(32, 28, 62); camera.lookAt(0, 1, 0);
    const groundGeometry = new T.PlaneGeometry(110, 45), groundMaterial = new T.MeshStandardMaterial({ color: '#8b9966', roughness: 1 });
    const ground = new T.Mesh(groundGeometry, groundMaterial); ground.rotation.x = -Math.PI / 2; ground.position.y = -.02; scene.add(ground);
    const view = createFieldEventView({ THREE: T, parent: scene, camera, ground: 0, rules: spec.events });
    const events = kinds.map((kind, i) => ({ id: `gallery-${kind}`, kind, x: (i - 3) * 8.5, y: kind === 'balloon' ? 3.4 : spec.events.types[kind].altitude ? 2.2 : 0, z: 0,
      yaw: -.3, pitch: 0, roll: 0, age: 2, duration: 120, route: null, progress: 0, drift: 0, speed: spec.events.types[kind].speed, dead: false, hp: spec.events.types[kind].hp, maxHp: spec.events.types[kind].hp,
      flash: 0, deadAge: 0, impactAge: null, hits: 0, cargoHp: 110, cargoMaxHp: 110, cargoDead: false, cargoFlash: 0, cargoAge: 0 }));
    view.update({ events }, { visible: true, walking: false, dt: 1 / 60 }); renderer.render(scene, camera);
    let invalid = 0; scene.traverse(o => { if (![o.position.x, o.position.y, o.position.z, o.scale.x, o.scale.y, o.scale.z].every(Number.isFinite)) invalid++; });
    window.cleanupGallery = () => { view.dispose(); groundGeometry.dispose(); groundMaterial.dispose(); renderer.dispose(); renderer.forceContextLoss(); };
    return { kinds, invalidTransforms: invalid, models: view.root.children.length, drawCalls: renderer.info.render.calls };
  });
  await p.screenshot({ path: path.join(output, 'gallery.png') }); await p.evaluate(() => window.cleanupGallery());
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); if (result.invalidTransforms) process.exitCode = 1;
} finally { clearTimeout(deadline); await browser?.close(); }
