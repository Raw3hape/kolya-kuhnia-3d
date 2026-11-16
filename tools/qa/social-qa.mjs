// Native WebGL/WebRTC activity QA. Fixture movement is solo-only; room movement is native.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { awaitPlayable } from './await-playable.mjs';
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const url = process.env.QA_URL || 'http://127.0.0.1:8765/';
const output = path.resolve(process.env.QA_OUTPUT || 'output/playwright/social-qa'); fs.mkdirSync(output, { recursive: true });
const report = { url, checks: [], errors: [], cleanup: false }, contexts = [];
let browser;
const watchdog = setTimeout(() => browser?.close().finally(() => process.exit(2)), 720000);
function check(name, pass, details) { report.checks.push({ name, pass, details }); console.log(JSON.stringify({ name, pass })); if (!pass) throw Error(name); }
async function page(target = url, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 }); contexts.push(context);
  await context.addInitScript(() => { localStorage.setItem('kitchen-ui-v1', JSON.stringify({ quality: 'eco', seen: { intro: true } })); localStorage.setItem('kitchen-life-v1', JSON.stringify({ life: false, sound: 'off', mute: false })); });
  // Accelerate only delivery waiting; transport, physics, actions and all placement checks are unchanged.
  await context.route('**/spec/social.json', async route => { const response = await route.fetch(), spec = await response.json(); spec.rules.firstDelivery = 2; await route.fulfill({ response, json: spec }); });
  const p = await context.newPage(); p.setDefaultTimeout(12000); p.on('pageerror', error => report.errors.push(error.message));
  await p.goto(target, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__kitchen?.social?.debug.ready, null, { timeout: 90000 }); await p.waitForTimeout(500);
  const preparation = await p.evaluate(() => ({ status: __kitchen.startup.status, time: __kitchen.social.debug.state.time }));
  check('delivery waits for complete startup', preparation.status !== 'loading' || preparation.time === 0, preparation);
  await awaitPlayable(p);
  await p.waitForFunction(() => __kitchen.social.debug.ready && __kitchen.party?.spec);
  await p.getByRole('button', { name: 'Понятно', exact: true }).click({ timeout: 700 }).catch(() => {});
  return p;
}
async function screenshot(p, name) { await p.screenshot({ path: path.join(output, name + '.png') }); }
async function aim(p, target) {
  for (let j = 0; j < 12; j++) {
    const s = await p.evaluate(() => ({ ...__kitchen.walk.getNetworkPose(), eye: __kitchen.camera.position.y })), dx = target[0] - s.x, dz = target[2] - s.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(target[1] - s.eye, Math.hypot(dx, dz));
    const angle = Math.atan2(Math.sin(s.yaw - yaw), Math.cos(s.yaw - yaw));
    const mx = Math.max(-210, Math.min(210, angle / .0042)), my = Math.max(-140, Math.min(140, (s.pitch - pitch) / .0042));
    if (Math.abs(mx) < .6 && Math.abs(my) < .6) break;
    await p.mouse.move(620, 350); await p.mouse.down({ button: 'right' }); await p.mouse.move(620 + mx, 350 + my, { steps: 5 }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(60);
  }
  await p.waitForTimeout(250);
}
async function connected(p) { await p.waitForFunction(() => __kitchen.multiplayer.client.connected, null, { timeout: 60000 }); await p.evaluate(() => __kitchen.multiplayer.lobby.close()); }
async function walkTo(p, x, z) {
  const deadline = Date.now() + 16000;
  let lastPose;
  while (Date.now() < deadline) {
    const pose = await p.evaluate(() => __kitchen.walk.getNetworkPose()), distance = Math.hypot(pose.x - x, pose.z - z); lastPose = pose; if (distance < .3) return;
    await aim(p, [x, 1.68, z]); await p.keyboard.down('w'); await p.waitForTimeout(Math.max(70, Math.min(350, distance / 3 * 1000))); await p.keyboard.up('w'); await p.waitForTimeout(50);
  }
  throw Error('native movement blocked: ' + JSON.stringify({ x, z, lastPose }));
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  if (!process.env.QA_ROOM_ONLY) {
  const solo = await page();
  check('three independent smoking pipes and two sofa places', await solo.evaluate(() => __kitchen.party.spec.items.filter(i => i.kind === 'vape').length === 3 && __kitchen.seats.list().filter(s => s.id.startsWith('sofa')).length === 2));
  await solo.waitForFunction(() => __kitchen.social.debug.state.pizza);
  await solo.evaluate(() => { __kitchen.doors.setOpen('entry_door', true, { instant: true }); __kitchen.walk.enter({ x: -2.03, z: 5.25 }, Math.PI); }); await solo.waitForTimeout(950);
  await aim(solo, [-2.03, 1.25, 7.25]); await screenshot(solo, 'courier');
  await aim(solo, await solo.evaluate(() => __kitchen.social.debug.state.pizza.position.map((n, i) => i === 1 ? n + .03 : n)));
  await solo.waitForFunction(() => __kitchen.social.debug.target === 'courier'); await solo.keyboard.press('e'); await solo.waitForFunction(() => __kitchen.social.held); await solo.waitForTimeout(800); await solo.keyboard.press('x');
  await aim(solo, await solo.evaluate(() => __kitchen.social.debug.state.pizza.position.map((n, i) => i === 1 ? n + .03 : n)));
  await solo.waitForFunction(() => __kitchen.social.debug.target === 'pizza'); await solo.keyboard.press('e');
  await solo.waitForFunction(() => __kitchen.social.debug.state.pizza.open); await solo.waitForTimeout(650); await screenshot(solo, 'pizza-open');
  await solo.mouse.click(640, 400); await solo.waitForFunction(() => __kitchen.social.debug.state.pizza.remaining === 11 && __kitchen.social.debug.sliceCount === 11);
  check('native pizza opening and eating remove exactly one slice', await solo.evaluate(() => __kitchen.social.debug.sliceCount === 11));
  await solo.keyboard.press('g'); await solo.waitForFunction(() => __kitchen.social.held);
  await aim(solo, [-1.8, 0, 5.45]); await solo.waitForFunction(() => __kitchen.social.debug.placement);
  await solo.keyboard.press('q'); await solo.waitForFunction(() => !__kitchen.social.held);
  check('native box pickup and surface placement preserve shared contents', await solo.evaluate(() => __kitchen.social.debug.state.pizza.remaining === 11));
  await solo.evaluate(() => __kitchen.walk.enter({ x: 5.25, z: 2.25 }, 0)); await solo.waitForTimeout(950);
  await aim(solo, await solo.evaluate(() => __kitchen.social.debug.state.radio.position.map((n, i) => i === 1 ? n + .12 : n))); await solo.waitForFunction(() => __kitchen.social.debug.target === 'radio');
  await solo.keyboard.press('e'); await solo.waitForFunction(() => __kitchen.social.debug.audio.music);
  check('radio decodes and plays real bundled music', await solo.evaluate(() => __kitchen.social.debug.audio.context === 'running' && __kitchen.social.debug.state.radio.playing));
  await solo.getByRole('button', { name: 'Следующая радиостанция', exact: true }).click(); await solo.waitForFunction(() => __kitchen.social.debug.state.radio.station === 1 && __kitchen.social.debug.audio.music);
  await solo.getByRole('button', { name: 'Следующая радиостанция', exact: true }).click(); await solo.waitForFunction(() => __kitchen.social.debug.state.radio.station === 2 && __kitchen.social.debug.audio.music); await screenshot(solo, 'radio');
  check('all three stations produce decoded playback', await solo.evaluate(() => __kitchen.social.debug.audio.loaded === 3));
  await solo.evaluate(() => __kitchen.walk.enter({ x: 5.30, z: 5.84 }, 0)); await solo.waitForTimeout(950); await aim(solo, [4.7, .62, 5.85]);
  await solo.waitForFunction(() => __kitchen.seats.target?.id.endsWith(':recline')); await solo.keyboard.press('e'); await solo.waitForTimeout(1100);
  check('native bed interaction reclines beside laptop', await solo.evaluate(() => __kitchen.seats.current?.endsWith(':recline') && __kitchen.tv.status.found.includes('bedroom')));
  await screenshot(solo, 'bed'); await solo.keyboard.press('e'); await solo.waitForTimeout(1000);
  await solo.evaluate(() => { __kitchen.doors.setOpen('door_bath', true, { instant: true }); __kitchen.walk.enter({ x: 1.52, z: 5.65 }, Math.PI); }); await solo.waitForTimeout(1000);
  await aim(solo, [1.55, 1.05, 6.8]); await solo.waitForFunction(() => __kitchen.social.debug.target === 'shower'); await solo.keyboard.press('e');
  await solo.waitForFunction(() => __kitchen.social.debug.state.shower.owner === 'solo'); await screenshot(solo, 'shower');
  check('native shower produces shared flowing water', await solo.evaluate(() => __kitchen.scene.getObjectByName('social_activities').children.some(o => o.isPoints && o.visible)));
  await solo.context().close();
  }
  if (!process.env.QA_SOLO_ONLY) {
  const host = await page();
  await host.locator('#kmp-launch').click(); await host.locator('#kmp-name').fill('Social host'); await host.locator('.kmp-form button[type=submit]').click(); await connected(host);
  const guest = await page(await host.evaluate(() => __kitchen.multiplayer.client.inviteUrl)); await guest.locator('#kmp-name').fill('Social guest'); await guest.locator('.kmp-form button[type=submit]').click(); await connected(guest);
  await Promise.all([host, guest].map(p => p.waitForFunction(() => !__kitchen.multiplayer.applying && __kitchen.walk.walking)));
  check('late WebRTC guest receives courier and pizza state', await guest.evaluate(() => !!__kitchen.social.debug.state.pizza));
  // Both sofa places are within normal walking range from the foyer/living entrance.
  const seats = await host.evaluate(() => __kitchen.seats.networkSeats().filter(s => s.id.startsWith('sofa')));
  for (const [p, seat] of [[host, seats[0]], [guest, seats[1]]]) {
    await walkTo(p, 2.65, 2.75); await aim(p, [seat.position[0], seat.position[1], seat.position[2]]);
    const result = await p.evaluate(id => __kitchen.seats.sitOn(id), seat.id); check('authority accepts separate sofa place ' + seat.id, result);
    await p.waitForFunction(id => __kitchen.seats.current === id, seat.id);
  }
  check('two real WebRTC players sit together without overlapping', await host.evaluate(() => { const p = __kitchen.multiplayer.client.state.players.filter(p => p.seat?.startsWith('sofa')); return p.length === 2 && Math.hypot(p[0].x - p[1].x, p[0].z - p[1].z) > .6; }));
  await screenshot(guest, 'sofa-together');
  await host.evaluate(() => __kitchen.seats.stand({ toWalk: true })); await host.waitForFunction(() => __kitchen.walk.walking);
  await walkTo(host, 1.3, 4.3); await walkTo(host, -1.2, 4.35); await walkTo(host, -1.25, 5.15);
  await aim(host, [-2.03, 1.2, 6.53]); await host.waitForFunction(() => __kitchen.doors.target?.id === 'entry_door'); await host.keyboard.press('e'); await host.waitForFunction(() => __kitchen.social.debug.state.courier?.phase === 'offering');
  await aim(host, await host.evaluate(() => __kitchen.social.debug.state.pizza.position.map((n, i) => i === 1 ? n + .03 : n)));
  await host.waitForFunction(() => __kitchen.social.debug.target === 'courier'); await host.keyboard.press('e'); await host.waitForFunction(() => __kitchen.social.held); await host.waitForTimeout(800);
  await guest.waitForFunction(() => __kitchen.social.debug.state.pizza.owner === __kitchen.multiplayer.client.state.hostId);
  check('host picks up shared delivery and guest sees the same owner', true);
  await walkTo(host, -1.2, 4.35); await walkTo(host, -.3, 4.35);
  const bathLeaf = await host.evaluate(() => { const d = __kitchen.doors.list.find(d => d.id === 'bath_door'); if (!d?.open) return null; const c = __kitchen.doors.colliders().find(c => c.door === d.id); return [(c.ax + c.bx) / 2, 1.2, (c.az + c.bz) / 2]; });
  if (bathLeaf) { await aim(host, bathLeaf); await host.waitForFunction(() => __kitchen.doors.target?.id === 'bath_door'); await host.keyboard.press('e'); await host.waitForFunction(() => !__kitchen.doors.list.find(d => d.id === 'bath_door').open); }
  await aim(host, [.15, 0, 4.4]); await host.waitForFunction(() => __kitchen.social.debug.placement);
  await host.keyboard.press('q'); await host.waitForFunction(() => !__kitchen.social.held);
  await aim(host, await host.evaluate(() => __kitchen.social.debug.state.pizza.position.map((n, i) => i === 1 ? n + .03 : n))); await host.keyboard.press('e'); await host.waitForFunction(() => __kitchen.social.debug.state.pizza.open);
  await guest.evaluate(() => __kitchen.seats.stand({ toWalk: true })); await guest.waitForFunction(() => __kitchen.walk.walking); await walkTo(guest, 1.3, 4.3);
  await aim(guest, await guest.evaluate(() => __kitchen.social.debug.state.pizza.position.map((n, i) => i === 1 ? n + .03 : n)));
  await Promise.all([host, guest].map(p => p.waitForFunction(() => __kitchen.social.debug.target === 'pizza' && !__kitchen.social.debug.pending)));
  await Promise.all([host.mouse.click(640, 400), guest.mouse.click(640, 400)]);
  await Promise.all([host, guest].map(p => p.waitForFunction(() => __kitchen.social.debug.state.pizza.remaining === 10)));
  check('two real WebRTC players eat different slices from one placed box', true); await screenshot(guest, 'shared-pizza');
  const shared = await Promise.all([host, guest].map(p => p.evaluate(() => __kitchen.social.debug.state.pizza)));
  check('shared contents and position agree after carrying and concurrent eating', shared[0].remaining === shared[1].remaining && shared[0].position.every((n, i) => Math.abs(n - shared[1].position[i]) < .001));
  await guest.context().close(); await host.context().close();
  }
  if (!process.env.QA_ROOM_ONLY) {
  const mobile = await page(url, true);
  await mobile.waitForFunction(() => __kitchen.social.debug.state.pizza);
  await mobile.evaluate(() => { __kitchen.walk.enter({ x: -2.03, z: 5.25 }, Math.PI); __kitchen.doors.setOpen('entry_door', true, { instant: true }); }); await mobile.waitForTimeout(1000);
  await mobile.evaluate(() => { const p = __kitchen.social.debug.state.pizza.position, c = __kitchen.camera; c.lookAt(p[0], p[1] + .03, p[2]); });
  // Mobile aiming follows the same view/controller path through a drag.
  const point = await mobile.evaluate(() => __kitchen.social.debug.state.pizza.position);
  await mobile.evaluate(pos => { const s = __kitchen.walk.getNetworkPose(); __kitchen.walk.reconcileNetwork({ ...s, yaw: Math.atan2(s.x - pos[0], s.z - pos[2]), pitch: Math.atan2(pos[1] - 1.68, Math.hypot(pos[0] - s.x, pos[2] - s.z)) }, s.ack, { snap: true }); }, point);
  await mobile.waitForFunction(() => __kitchen.social.debug.target === 'courier'); await mobile.locator('.social-actions [data-action=receive]').tap(); await mobile.waitForFunction(() => __kitchen.social.held); await mobile.waitForTimeout(800); await mobile.locator('.social-actions [data-action=return]').tap();
  const returned = await mobile.evaluate(() => __kitchen.social.debug.state.pizza.position); await mobile.evaluate(pos => { const s = __kitchen.walk.getNetworkPose(); __kitchen.walk.reconcileNetwork({ ...s, yaw: Math.atan2(s.x - pos[0], s.z - pos[2]), pitch: Math.atan2(pos[1] - 1.68, Math.hypot(pos[0] - s.x, pos[2] - s.z)) }, s.ack, { snap: true }); }, returned);
  await mobile.waitForFunction(() => __kitchen.social.debug.target === 'pizza'); await mobile.locator('.social-actions [data-action=open]').tap();
  await mobile.waitForFunction(() => __kitchen.social.debug.state.pizza.open); await mobile.locator('.social-actions [data-action=eat]').tap(); await mobile.waitForFunction(() => __kitchen.social.debug.state.pizza.remaining === 11);
  check('mobile native controls open and eat shared pizza', true); await screenshot(mobile, 'mobile-pizza');
  }
  check('no application errors', report.errors.length === 0, report.errors);
} catch (error) {
  report.failure = error.message; process.exitCode = 1;
  for (const context of contexts) for (const p of context.pages()) if (!p.isClosed()) { await screenshot(p, 'failure-' + contexts.indexOf(context)).catch(() => {}); report.lastState = await p.evaluate(() => ({ social: __kitchen.social.debug, walk: __kitchen.walk.getNetworkPose(), seat: __kitchen.seats.target, startup: __kitchen.startup.status })).catch(() => null); }
} finally {
  await browser?.close(); clearTimeout(watchdog); report.cleanup = true; fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ checks: report.checks.length, failure: report.failure, errors: report.errors, cleanup: true }));
}
