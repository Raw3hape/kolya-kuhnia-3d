// Integrated WebGL and existing PeerJS transport smoke test for the entry door.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { awaitPlayable } from './await-playable.mjs';

const playwright = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwright.startsWith('/') ? pathToFileURL(playwright).href : playwright);
const url = process.env.QA_URL || 'http://127.0.0.1:8779/';
const output = resolve(process.env.QA_OUTPUT || 'output/playwright/service-level');
const mode = process.env.QA_MODE || 'all';
const report = { url, mode, checks: [], pageErrors: [] };
let browser;
await mkdir(output, { recursive: true });
const watchdog = setTimeout(() => {
  report.failure = 'Browser QA deadline';
  browser?.close().catch(() => {});
}, 210_000);

function pass(name, details) {
  report.checks.push({ name, details });
  process.stdout.write(name + '\n');
}
const attr = (page, query) => page.evaluate(query);
const frame = (page, predicate, arg, timeout = 15000) => page.waitForFunction(predicate, arg, { timeout });
const pose = page => attr(page, () => __kitchen.walk.getNetworkPose());
const service = page => attr(page, () => __kitchen.serviceLevel.snapshot);

async function pageFor(target = url, mobile = false, courier = false) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height:819 } : { width: 1200, height: 760 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1,
  });
  await context.addInitScript(() => localStorage.setItem('kitchen-ui-v1', JSON.stringify({ quality: 'eco', seen: { intro: true } })));
  if (courier) await context.route('**/spec/social.json', async route => {
    const response = await route.fetch();
    const json = await response.json(); json.rules.firstDelivery = 1.5;
    await route.fulfill({ response, json });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await awaitPlayable(page);
  await page.getByRole('button', { name: 'Понятно', exact: true }).click({ timeout: 600 }).catch(() => {});
  return page;
}

const shot = (page, name) => page.screenshot({ path: resolve(output, name + '.png') });

async function soloAtDoor(page) {
  await page.evaluate(() => __kitchen.walk.enter({ x:-2.0379, z:5.47 }, Math.PI));
  await frame(page, () => __kitchen.doors.target?.id === 'entry_door');
}

async function walkTo(page, x, z) {
  for (let i = 0; i < 15; i++) {
    const p = await pose(page);
    const distance = Math.hypot(x-p.x, z-p.z);
    if (distance < 0.22) return;
    await page.evaluate(([x,z]) => __kitchen.walk.lookAtPoint([x, __kitchen.walk.eyeHeight, z]), [x,z]);
    // The previous key-up leaves a small velocity tail. Let the camera
    // settle before probing the next point along the hall.
    await page.waitForTimeout(260);
    await page.keyboard.down('w');
    await page.waitForTimeout(Math.max(80, Math.min(1000, (distance - 0.12) / 1.4 * 1000)));
    await page.keyboard.up('w');
    if (await attr(page, () => __kitchen.serviceLevel.active)) return;
    await page.waitForTimeout(240);
  }
  throw new Error('Hall route stalled ' + JSON.stringify({ x, z, current: await pose(page) }));
}

async function returnToHall(page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'На кухню', exact: true }).first().click();
  await frame(page, () => !__kitchen.serviceLevel.active && __kitchen.walk.walking);
}

async function measure(page) {
  return page.evaluate(async () => {
    const gaps = [], calls = [];
    let previous = performance.now();
    for (let i = 0; i < 100; ++i) await new Promise(done => requestAnimationFrame(now => {
      gaps.push(now - previous); previous = now;
      calls.push(__kitchen.renderer.info.render.calls); done();
    }));
    gaps.sort((a,b)=>a-b); calls.sort((a,b)=>a-b);
    return { frameP50Ms: Number(gaps[50].toFixed(1)), frameP95Ms: Number(gaps[95].toFixed(1)),
      medianDrawCalls: calls[50], gpu: __kitchen.renderer.getContext().getParameter(7937) };
  });
}

async function solo() {
  const page = await pageFor();
  await soloAtDoor(page);
  await page.keyboard.press('e');
  await frame(page, () => __kitchen.serviceLevel.previewVisible);
  await page.waitForTimeout(750);
  await shot(page, 'threshold');
  await page.keyboard.down('w');
  await frame(page, () => __kitchen.serviceLevel.active);
  await page.keyboard.up('w');
  await frame(page, () => document.querySelector('.sl-hud')?.offsetWidth > 0);
  assert.equal((await service(page)).phase, 'prep');
  assert.equal(await attr(page, () => document.querySelector('.title-card').checkVisibility({checkVisibilityCSS:true})), false);
  await shot(page, 'inside');
  pass('Desktop door preview → walking transition → scene/HUD', await measure(page));
  await page.keyboard.down('w');
  await page.waitForTimeout(1350);
  await page.keyboard.up('w');
  assert((await service(page)).players[0].z < -2.8);
  await frame(page, () => __kitchen.serviceLevel.snapshot?.phase === 'combat' && __kitchen.serviceLevel.snapshot.enemies.length > 0);
  await page.mouse.click(602, 379);
  await frame(page, () => document.pointerLockElement?.id === 'scene');
  await page.mouse.down();
  await frame(page, () => __kitchen.serviceLevel.snapshot.players[0].ammo < __kitchen.serviceLevel.snapshot.players[0].capacity);
  await page.mouse.up();
  await page.keyboard.press('r');
  await frame(page, () => __kitchen.serviceLevel.snapshot?.players[0].reloadLeft > 0);
  await frame(page, () => __kitchen.serviceLevel.snapshot?.players[0].reloadLeft === 0);
  pass('Native walking, pulse, reload and enemies in Chrome');
  await shot(page, 'combat');
  await returnToHall(page);
  assert((await pose(page)).z < 6.43);
  pass('Return to safe hall');
  await page.context().close();
}

async function mobileAndCourier() {
  const page = await pageFor(url, true);
  await soloAtDoor(page);
  await page.getByRole('button', { name: 'Открыть', exact: true }).tap();
  await frame(page, () => __kitchen.serviceLevel.previewVisible);
  await page.keyboard.down('w');
  await frame(page, () => __kitchen.serviceLevel.active);
  await page.keyboard.up('w');
  await frame(page, () => document.querySelector('.sl-touch')?.getBoundingClientRect().height > 0);
  await shot(page, 'mobile');
  const before = await attr(page, () => __kitchen.serviceLevel.view);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:65,y:500}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:65,y:433}]});
  await page.waitForTimeout(630);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const after = await attr(page, () => __kitchen.serviceLevel.view);
  assert(Math.hypot(before.x-after.x,before.z-after.z) > 0.75);
  pass('Portrait touch layout and native touch walking');
  await page.context().close();

  const visit = await pageFor(url, false, true);
  await soloAtDoor(visit);
  await frame(visit, () => __kitchen.social.debug.state.courier?.phase === 'waiting');
  await visit.keyboard.press('e');
  await frame(visit, () => __kitchen.social.debug.state.courier?.phase === 'offering');
  assert.equal(await attr(visit, () => __kitchen.serviceLevel.previewVisible || __kitchen.serviceLevel.active), false);
  await visit.evaluate(() => {
    const box = __kitchen.social.debug.state.pizza.position;
    __kitchen.walk.lookAtPoint(box);
  });
  await frame(visit, () => __kitchen.social.debug.target === 'courier');
  await visit.keyboard.press('e');
  await frame(visit, () => __kitchen.social.held);
  pass('Courier priority and pizza handoff at the same door');
  await visit.context().close();
}

async function online() {
  const host = await pageFor();
  await host.evaluate(() => __kitchen.multiplayer.lobby.open());
  await host.locator('#kmp-name').fill('Service QA host');
  await host.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  await frame(host, () => __kitchen.multiplayer.client.connected, null, 60_000);
  await host.evaluate(() => __kitchen.multiplayer.lobby.close());
  const guest = await pageFor(await attr(host, () => __kitchen.multiplayer.client.inviteUrl));
  await guest.locator('#kmp-name').fill('Service QA guest');
  await guest.locator('.kmp-form button[type=submit]').click();
  await frame(guest, () => __kitchen.multiplayer.client.connected, null, 60_000);
  await guest.evaluate(() => __kitchen.multiplayer.lobby.close());
  for (const page of [host, guest]) {
    await page.bringToFront();
    pass("Connected browser entering hall", { role: page === host ? "host" : "guest", pose: await pose(page) });
    await walkTo(page, -1.2, 4.38);
    await walkTo(page, -1.23, 5.32);
    await walkTo(page, -2.0379, 5.44);
    await page.evaluate(() => __kitchen.walk.lookAtPoint([-2.0379, 1.53, 6.55]));
    if (page === host) {
      await frame(page, () => __kitchen.doors.target?.id === 'entry_door');
      await page.keyboard.press('e');
    }
    await frame(page, () => __kitchen.serviceLevel.previewVisible);
    await page.keyboard.down('w');
    try { await frame(page, () => __kitchen.serviceLevel.active); }
    finally { await page.keyboard.up('w'); }
  }
  await Promise.all([host,guest].map(page => frame(page, () => __kitchen.serviceLevel.snapshot?.players.length === 2)));
  const [a,b] = await Promise.all([host,guest].map(service));
  assert.equal(a.seed,b.seed);
  assert.deepEqual(a.players.map(p=>p.id),b.players.map(p=>p.id));
  await guest.bringToFront();
  const guestId = await attr(guest, () => __kitchen.multiplayer.client.id);
  await frame(guest, () => __kitchen.serviceLevel.snapshot.phase === 'combat');
  await guest.mouse.click(600,380);
  await frame(guest, () => document.pointerLockElement?.id === 'scene');
  await guest.mouse.down();
  await frame(host, id => __kitchen.serviceLevel.snapshot.players.some(p => p.id === id && p.ammo < p.capacity), guestId);
  await guest.mouse.up();
  pass('Two independent WebRTC clients share seed, roster and guest pulse state', { seed: a.seed });
  await shot(host, 'online');
  await returnToHall(guest);
  await frame(host, () => __kitchen.serviceLevel.snapshot.players.length === 1);
  await host.bringToFront();
  await returnToHall(host);
  await frame(host, () => __kitchen.multiplayer.client.state.serviceLevel === null);
  pass('Independent room exit preserves remaining player, final exit clears run');
  await guest.context().close();
  await host.context().close();
}

try {
  browser = await chromium.launch({ channel:'chrome', headless:true,
    args:['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'] });
  if (mode === 'all' || mode === 'solo') await solo();
  if (mode === 'all' || mode === 'mobile') await mobileAndCourier();
  if (mode === 'all' || mode === 'online') await online();
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.failure = error.stack;
  for (const [i, context] of (browser?.contexts() || []).entries()) for (const page of context.pages()) {
    await shot(page, 'failure-'+i).catch(() => {});
    report.lastStates ??= [];
    const lastState = await page.evaluate(() => ({ pose: __kitchen.walk.getNetworkPose(), door: __kitchen.doors.target?.id,
      preview: __kitchen.serviceLevel.previewVisible, run: __kitchen.serviceLevel.snapshot, room: __kitchen.multiplayer.client.status, self: __kitchen.multiplayer.client.self })).catch(() => null);
    report.lastStates.push(lastState);
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  clearTimeout(watchdog);
  report.cleanup = true;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report,null,2)+'\n');
}
