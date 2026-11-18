// Integrated WebGL and existing PeerJS transport smoke test for the entry door.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { awaitPlayable } from './await-playable.mjs';
import { drawDoorEncounter } from './door-encounter.mjs';

const playwright = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwright.startsWith('/') ? pathToFileURL(playwright).href : playwright);
const url = process.env.QA_URL || 'http://127.0.0.1:8781/';
const output = resolve(process.env.QA_OUTPUT || 'output/playwright/service-level');
const mode = process.env.QA_MODE || 'all';
const report = { url, mode, checks: [], pageErrors: [] };
let browser;
await mkdir(output, { recursive: true });
const watchdog = setTimeout(() => {
  report.failure = 'Browser QA deadline';
  browser?.close().catch(() => {});
}, mode === 'all' ? 560_000 : 210_000);

function pass(name, details) {
  report.checks.push({ name, details });
  process.stdout.write(name + '\n');
}
const attr = (page, query) => page.evaluate(query);
const frame = (page, predicate, arg, timeout = 15000) => page.waitForFunction(predicate, arg, { timeout });
const pose = page => attr(page, () => __kitchen.walk.getNetworkPose());
const service = page => attr(page, () => __kitchen.serviceLevel.snapshot);

async function pageFor(target = url, mobile = false) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height:819 } : { width: 1200, height: 760 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1,
  });
  await context.addInitScript(() => localStorage.setItem('kitchen-ui-v1', JSON.stringify({ quality: 'eco', seen: { intro: true } })));
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

async function openDestination(page, mode, mobile = false) {
  const route = await drawDoorEncounter(page, mode);
  if (!await attr(page, () => __kitchen.doors.list.find(d => d.id === 'entry_door')?.open)) {
    await frame(page, () => __kitchen.doors.target?.id === 'entry_door');
    if (mobile) await page.getByRole('button', { name: 'Открыть', exact: true }).tap();
    else await page.keyboard.press('e');
  }
  await frame(page, () => __kitchen.doors.list.find(d => d.id === 'entry_door')?.open);
  return route;
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
  await openDestination(page, 'service');
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
  await openDestination(page, 'service', true);
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

  const visit = await pageFor(url);
  await soloAtDoor(visit);
  assert.equal(await attr(visit, () => __kitchen.social.debug.state.courier), null);
  await openDestination(visit, 'courier');
  await frame(visit, () => __kitchen.social.debug.state.courier?.phase === 'offering');
  assert.equal(await attr(visit, () => __kitchen.serviceLevel.previewVisible || __kitchen.serviceLevel.active), false);
  await visit.evaluate(() => {
    const box = __kitchen.social.debug.state.pizza.position;
    __kitchen.walk.lookAtPoint(box);
  });
  await frame(visit, () => __kitchen.social.debug.target === 'courier');
  await visit.keyboard.press('e');
  await frame(visit, () => __kitchen.social.held);
  const received = await attr(visit, () => __kitchen.social.debug.state.pizza.id);
  await visit.evaluate(() => __kitchen.doors.setOpen('entry_door', false));
  await frame(visit, () => __kitchen.social.debug.state.courier === null && __kitchen.social.held);
  assert.equal(await attr(visit, () => __kitchen.social.debug.state.pizza.id), received);
  pass('Courier rolled on opening, handoff works, closing preserves the delivered box');
  await visit.context().close();
}

async function online(destination = 'service') {
  const host = await pageFor();
  // Ready both browsers before starting the room clock. Otherwise a cold
  // guest startup can let the real courier reserve the tested entrance.
  const guest = await pageFor();
  await host.bringToFront();
  await host.evaluate(() => __kitchen.multiplayer.lobby.open());
  await host.locator('#kmp-name').fill('Service QA host');
  await host.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  await frame(host, () => __kitchen.multiplayer.client.connected, null, 60_000);
  await host.evaluate(() => __kitchen.multiplayer.lobby.close());
  const invite = await attr(host, () => __kitchen.multiplayer.client.inviteUrl);
  await guest.bringToFront();
  await guest.evaluate(invite => {
    const target = new URL(invite);
    history.replaceState(null, '', target);
    __kitchen.multiplayer.lobby.open({ room: target.searchParams.get('room') });
  }, invite);
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
    if (page === host) await openDestination(page, destination);
    await frame(page, value => __kitchen.serviceLevel.previewVisible && __kitchen.serviceLevel.doorJourney.mode === value, destination);
    await page.keyboard.down('w');
    try { await frame(page, () => __kitchen.serviceLevel.active); }
    finally { await page.keyboard.up('w'); }
  }
  await Promise.all([host,guest].map(page => frame(page, () => __kitchen.serviceLevel.snapshot?.players.length === 2)));
  const [a,b] = await Promise.all([host,guest].map(service));
  const [doorA, doorB] = await Promise.all([host,guest].map(page => attr(page, () => __kitchen.serviceLevel.doorJourney)));
  assert.deepEqual(doorA, doorB);
  assert.equal(a.seed,b.seed);
  assert.deepEqual(a.players.map(p=>p.id),b.players.map(p=>p.id));
  await guest.bringToFront();
  const guestId = await attr(guest, () => __kitchen.multiplayer.client.id);
  if (destination === 'snow') {
    await pickGear(guest, 'board');
    await guest.keyboard.down('w');
    await frame(host, id => __kitchen.serviceLevel.snapshot.players.some(p => p.id === id && p.equipment === 'board' && p.speed > 4), guestId);
    await guest.keyboard.up('w');
    await host.bringToFront();
    await pickGear(host, 'ski');
    await host.keyboard.down('w');
    await frame(guest, () => __kitchen.serviceLevel.snapshot.players.some(p => p.equipment === 'ski' && p.speed > 4));
    await host.keyboard.up('w');
    pass('Two WebRTC clients see the same snow route, both equipment choices and shared motion', { seed: a.seed });
  } else {
    await frame(guest, () => __kitchen.serviceLevel.snapshot.phase === 'combat');
    await guest.mouse.click(600,380);
    await frame(guest, () => document.pointerLockElement?.id === 'scene');
    await guest.mouse.down();
    await frame(host, id => __kitchen.serviceLevel.snapshot.players.some(p => p.id === id && p.ammo < p.capacity), guestId);
    await guest.mouse.up();
    pass('Two WebRTC clients share seed, roster and guest pulse state', { seed: a.seed });
  }
  await shot(host, 'online');
  await guest.bringToFront();
  await returnToHall(guest);
  await frame(host, () => __kitchen.serviceLevel.snapshot.players.length === 1);
  await host.bringToFront();
  await returnToHall(host);
  await frame(host, mode => __kitchen.multiplayer.client.state[mode === 'snow' ? 'snowLevel' : 'serviceLevel'] === null, destination);
  pass('Independent room exit preserves remaining player, final exit clears run');
  await guest.context().close();
  await host.context().close();
}

async function pickGear(page, kind, mobile = false) {
  await page.keyboard.down('w');
  try {
    await frame(page, () => {
      const id = __kitchen.multiplayer.client.id || 'solo';
      return __kitchen.serviceLevel.snapshot.players.find(p => p.id === id)?.z < -2.85;
    }, null, 5500);
  } finally { await page.keyboard.up('w'); }
  if ((await attr(page, () => __kitchen.serviceLevel.view?.nearGear)) !== kind) {
    const side = kind === 'ski' ? 'a' : 'd';
    await page.keyboard.down(side);
    try { await frame(page, equipment => __kitchen.serviceLevel.view?.nearGear === equipment, kind, 4000); }
    finally { await page.keyboard.up(side); }
  }
  if (mobile) await page.getByRole('button', { name: kind === 'ski' ? 'Взять лыжи' : 'Взять сноуборд', exact: true }).tap();
  else await page.keyboard.press('e');
  await frame(page, equipment => {
    const self = __kitchen.multiplayer.client.id || 'solo';
    return __kitchen.serviceLevel.snapshot?.players.find(p => p.id === self)?.equipment === equipment;
  }, kind);
}

async function snowSolo(mobile = false) {
  const page = await pageFor(url, mobile);
  await soloAtDoor(page);
  await openDestination(page, 'snow', mobile);
  await frame(page, () => __kitchen.serviceLevel.previewVisible);
  await page.waitForTimeout(750);
  await shot(page, mobile ? 'snow-mobile-door' : 'snow-door');
  await page.keyboard.down('w');
  await frame(page, () => __kitchen.serviceLevel.destination === 'snow' && __kitchen.serviceLevel.active);
  await page.keyboard.up('w');
  await frame(page, () => document.querySelector('.snow-approach')?.getBoundingClientRect().width > 0);
  await shot(page, mobile ? 'snow-mobile-station' : 'snow-station');
  await pickGear(page, mobile ? 'ski' : 'board', mobile);
  await page.keyboard.down('w');
  await frame(page, () => __kitchen.serviceLevel.snapshot.players[0].speed > 6);
  await page.keyboard.up('w');
  if (mobile) await page.getByRole('button', { name: 'Прыжок', exact: true }).tap();
  else await page.keyboard.press('Space');
  await frame(page, () => __kitchen.serviceLevel.snapshot.players[0].phase === 'air');
  await page.keyboard.down('q');
  await frame(page, () => Math.abs(__kitchen.serviceLevel.snapshot.players[0].spin) > 0.25);
  await page.keyboard.up('q');
  const metrics = await measure(page);
  const distance = (await service(page)).players[0].distance;
  assert(distance > 12);
  await shot(page, mobile ? 'snow-mobile-ride' : 'snow-ride');
  await page.keyboard.press('Shift+R');
  await frame(page, () => __kitchen.serviceLevel.snapshot.players[0].phase === 'walk');
  await returnToHall(page);
  pass(mobile ? 'Touch gear choice and jump on alpine slope' : 'Snow vista, board selection, descent, jump, spin and reset', { ...metrics, distance });
  await page.context().close();
}

try {
  browser = await chromium.launch({ channel:'chrome', headless:true,
    args:['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'] });
  if (mode === 'all' || mode === 'solo') await solo();
  if (mode === 'all' || mode === 'mobile') await mobileAndCourier();
  if (mode === 'all' || mode === 'online') await online();
  if (mode === 'all' || mode === 'snow') await snowSolo();
  if (mode === 'all' || mode === 'snow-mobile') await snowSolo(true);
  if (mode === 'all' || mode === 'snow-online') await online('snow');
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.failure = error.stack;
  for (const [i, context] of (browser?.contexts() || []).entries()) for (const page of context.pages()) {
    await shot(page, 'failure-'+i).catch(() => {});
    report.lastStates ??= [];
    const lastState = await page.evaluate(() => ({ pose: __kitchen.walk.getNetworkPose(), door: __kitchen.doors.target?.id,
      preview: __kitchen.serviceLevel.previewVisible, courier: __kitchen.social.reservesLanding, run: __kitchen.serviceLevel.snapshot, room: __kitchen.multiplayer.client.status, self: __kitchen.multiplayer.client.self })).catch(() => null);
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
