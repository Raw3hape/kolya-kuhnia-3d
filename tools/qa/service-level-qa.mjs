// Integrated WebGL and existing PeerJS transport smoke test for the entry door.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { awaitPlayable } from './await-playable.mjs';
import { drawDoorEncounter } from './door-encounter.mjs';
import { createSaunaLayout } from '../../web/js/sauna-layout.js';
import { DESTINATION_SNAPSHOTS } from '../../web/js/door-journey.js';

const playwright = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwright.startsWith('/') ? pathToFileURL(playwright).href : playwright);
const url = process.env.QA_URL || 'http://127.0.0.1:8781/';
const output = resolve(process.env.QA_OUTPUT || 'output/playwright/service-level');
const mode = process.env.QA_MODE || 'all';
const report = { url, mode, checks: [], pageErrors: [] };
const sauna = createSaunaLayout(JSON.parse(await readFile(new URL('../../web/spec/sauna.json', import.meta.url))));
let browser;
await mkdir(output, { recursive: true });
const watchdog = setTimeout(() => {
  report.failure = 'Browser QA deadline';
  browser?.close().catch(() => {});
}, ['all', 'sauna'].includes(mode) ? 560_000 : 210_000);

function pass(name, details) {
  report.checks.push({ name, details });
  process.stdout.write(name + '\n');
}
const attr = (page, query) => page.evaluate(query);
const frame = (page, predicate, arg, timeout = 15000) => page.waitForFunction(predicate, arg, { timeout });
const pose = page => attr(page, () => __kitchen.walk.getNetworkPose());
const service = page => attr(page, () => __kitchen.serviceLevel.snapshot);

async function pageFor(target = url, mobile = false, quality = 'eco') {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height:819 } : { width: 1200, height: 760 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1,
  });
  await context.addInitScript(quality => localStorage.setItem('kitchen-ui-v1', JSON.stringify({ quality, seen: { intro: true } })), quality);
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /THREE\.WebGL|VALIDATE_STATUS|Shader Error/.test(message.text())) report.pageErrors.push(message.text());
  });
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
  await frame(page, () => document.pointerLockElement === null);
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
  await page.getByRole('button', { name: 'Скрыть панель', exact: true }).click();
  await frame(page, () => {
    const poster = __kitchen.scene.getObjectByName('Входная дверь · Открывай на удачу');
    return poster?.parent.userData.door.id === 'entry_door' && poster.children[0].children[0].material.map.image?.complete;
  });
  await shot(page, 'door-poster');
  await page.evaluate(() => {
    __kitchen.doors.setOpen('room3_balcony_door', true, { instant: true });
    __kitchen.walk.enter({ x: -1.37, z: -0.9 }, 0);
  });
  const uziAsset = page.waitForResponse(response => /\/uzi\.glb(?:\?|$)/.test(response.url()) && response.ok());
  await page.keyboard.press('6');
  await uziAsset;
  await frame(page, () => __kitchen.viewmodel.weapon === 'uzi' && __kitchen.viewmodel.armed);
  await page.waitForTimeout(500);
  const shotsBefore = await attr(page, () => __kitchen.viewmodel.shots);
  await page.mouse.click(600, 380);
  await frame(page, before => __kitchen.viewmodel.shots > before, shotsBefore);
  await shot(page, 'uzi-balcony');
  await soloAtDoor(page);
  await frame(page, () => Math.abs(__kitchen.walk.getNetworkPose().z - 5.47) < 0.02);
  assert.equal(await page.evaluate(() => {
    const p = __kitchen.walk.getNetworkPose();
    return __kitchen.walk.lookAtPoint([p.x + 0.15, __kitchen.walk.eyeHeight + 1, p.z - 1]);
  }), true);
  await frame(page, () => !__kitchen.doors.target && !__kitchen.seats.target);
  const apartmentShots = await attr(page, () => __kitchen.viewmodel.shots);
  await page.mouse.click(600, 380);
  await frame(page, before => __kitchen.viewmodel.shots > before, apartmentShots);
  await page.evaluate(() => {
    const p = __kitchen.walk.getNetworkPose();
    __kitchen.walk.lookAtPoint([p.x, __kitchen.walk.eyeHeight, p.z + 1]);
  });
  await frame(page, () => __kitchen.doors.target?.id === 'entry_door');
  await openDestination(page, 'service');
  await frame(page, () => __kitchen.serviceLevel.previewVisible);
  await page.waitForTimeout(750);
  await shot(page, 'threshold');
  await page.keyboard.down('w');
  await frame(page, () => __kitchen.serviceLevel.active);
  await page.keyboard.up('w');
  await frame(page, () => document.querySelector('.sl-hud')?.offsetWidth > 0);
  assert.equal((await service(page)).phase, 'prep');
  assert.equal((await service(page)).players[0].weapon, 'uzi');
  await page.waitForTimeout(500);
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
  await page.mouse.down({ button: 'right' });
  await frame(page, () => __kitchen.serviceLevel.snapshot.players[0].aiming);
  const aimedAmmo = (await service(page)).players[0].ammo;
  await page.mouse.click(600, 380);
  await frame(page, before => __kitchen.serviceLevel.snapshot.players[0].aiming &&
    __kitchen.serviceLevel.snapshot.players[0].ammo < before, aimedAmmo);
  await page.mouse.up({ button: 'right' });
  await page.keyboard.press('5');
  await frame(page, () => __kitchen.serviceLevel.snapshot.players[0].weapon === 'shotgun');
  await page.mouse.click(600, 380);
  await frame(page, () => __kitchen.serviceLevel.snapshot.events.some(event =>
    event.type === 'shot' && event.weapon === 'shotgun' && event.rays.length === 9));
  await page.keyboard.press('1');
  await frame(page, () => __kitchen.serviceLevel.snapshot.players[0].capacity === 0);
  await page.keyboard.press('6');
  await frame(page, () => __kitchen.serviceLevel.snapshot.players[0].weapon === 'uzi');
  pass('Poster on moving door leaf, apartment and balcony Uzi, inherited maze loadout, ADS, switching and reloading');
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
  await page.getByRole('button', { name: 'Uzi', exact: true }).tap();
  await frame(page, () => __kitchen.serviceLevel.snapshot.players[0].weapon === 'uzi');
  await page.getByRole('button', { name: 'Выстрел', exact: true }).tap();
  await frame(page, () => __kitchen.serviceLevel.snapshot.players[0].ammo < 24);
  const separated = await attr(page, () => document.querySelector('.sl-loadout').getBoundingClientRect().bottom <
    document.querySelector('.sl-touch').getBoundingClientRect().top);
  assert.equal(separated, true);
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
  } else if (destination === 'sauna') {
    assert.equal(new Set(a.players.map(p => p.towelSlot)).size, 2);
    await frame(guest, () => __kitchen.serviceLevel.view?.avatars?.distinctTowels === 2);
    const seat = sauna.seats.filter(s => s.zone === 'arrival')[1];
    const guestEye = await spaView(guest);
    await walkSauna(guest, guestEye.x, -1.2);
    await walkSauna(guest, seat.stand[0], -1.2);
    await takeSaunaSeat(guest, seat);
    await frame(host, ({ id, seat }) => __kitchen.serviceLevel.snapshot.seats[seat] === id, { id: guestId, seat: seat.id });
    await host.bringToFront();
    const hostEye = await spaView(host);
    await turnSauna(host, Math.atan2(hostEye.x - seat.x, hostEye.z - seat.z),
      Math.atan2(seat.y + .6 - hostEye.y, Math.hypot(hostEye.x - seat.x, hostEye.z - seat.z)));
    await shot(host, 'sauna-seated-guest');
    await guest.bringToFront();
    await guest.getByRole('button', { name: 'Встать', exact: true }).click();
    await frame(host, key => !__kitchen.serviceLevel.snapshot.seats[key], seat.id);
    await turnSauna(guest, 0, 0);
    await guest.keyboard.down('w');
    try {
      await frame(host, id => __kitchen.serviceLevel.snapshot.players.some(p => p.id === id && p.speed > .5), guestId);
    } finally { await guest.keyboard.up('w'); }
    pass('Two sauna clients share towel identities, reservations, release and walking', { seed: a.seed });
  } else {
    await frame(guest, () => __kitchen.serviceLevel.snapshot.phase === 'combat');
    await guest.mouse.click(600,380);
    await frame(guest, () => document.pointerLockElement?.id === 'scene');
    await guest.keyboard.press('6');
    await frame(host, id => __kitchen.serviceLevel.snapshot.players.some(p => p.id === id && p.weapon === 'uzi'), guestId);
    await guest.mouse.down();
    await frame(host, id => __kitchen.serviceLevel.snapshot.players.some(p => p.id === id && p.weapon === 'uzi' && p.ammo < p.capacity), guestId);
    await guest.mouse.up();
    await frame(host, id => __kitchen.serviceLevel.snapshot.events.some(e => e.type === 'shot' && e.playerId === id && e.weapon === 'uzi'), guestId);
    pass('Two WebRTC clients share seed, roster, Uzi selection, ammo and shots', { seed: a.seed });
  }
  await shot(host, destination + '-online');
  await guest.bringToFront();
  await returnToHall(guest);
  await frame(host, () => __kitchen.serviceLevel.snapshot.players.length === 1);
  await host.bringToFront();
  await returnToHall(host);
  await frame(host, key => __kitchen.multiplayer.client.state[key] === null, DESTINATION_SNAPSHOTS[destination]);
  pass('Independent room exit preserves remaining player, final exit clears run');
  await guest.context().close();
  await host.context().close();
}

const spaView = page => attr(page, () => __kitchen.serviceLevel.view);
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
async function turnSauna(page, yaw, pitch, mobile = false) {
  // Native drag has a larger range than a pointer event under capture. Split
  // angles to keep both endpoints inside the viewport.
  for (let step = 0; step < 5; step++) {
    const eye = await spaView(page);
    if (Math.abs(wrap(yaw - eye.yaw)) < .012 && Math.abs(pitch - eye.pitch) < .012) return;
    const k = mobile ? .0055 : .0041, width = mobile ? 158 : 510;
    const dx = Math.max(-width, Math.min(width, wrap(eye.yaw - yaw) / k));
    const dy = Math.max(-260, Math.min(260, (eye.pitch - pitch) / k));
    if (mobile) await touchSauna(page, { x: 202, y: 360 }, { x: 202 + dx, y: 360 + dy });
    else {
      await page.mouse.move(600, 367);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(600 + dx, 367 + dy, { steps: 4 });
      await page.mouse.up({ button: 'right' });
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  throw Error('Sauna camera did not reach its native look target');
}

async function walkSauna(page, x, z, mobile = false) {
  for (let i = 0; i < 18; i++) {
    const eye = await spaView(page);
    const distance = Math.hypot(eye.x - x, eye.z - z);
    if (distance < .24) return;
    await turnSauna(page, Math.atan2(eye.x - x, eye.z - z), 0, mobile);
    const hold = Math.min(710, Math.max(90, (distance - .12) * 560));
    if (mobile) await touchSauna(page, { x: 65, y: 500 }, { x: 65, y: 423 }, hold);
    else {
      await page.keyboard.down('w');
      try { await page.waitForTimeout(hold); }
      finally { await page.keyboard.up('w'); }
    }
    await page.waitForTimeout(130);
  }
  throw Error('Sauna movement did not reach ' + JSON.stringify({ x, z, eye: await spaView(page) }));
}

async function takeSaunaSeat(page, seat, mobile = false) {
  await walkSauna(page, ...seat.stand, mobile);
  const eye = await spaView(page);
  await turnSauna(page, Math.atan2(eye.x - seat.x, eye.z - seat.z),
    Math.atan2(seat.y + .12 - eye.y, Math.hypot(eye.x - seat.x, eye.z - seat.z)), mobile);
  await frame(page, id => __kitchen.serviceLevel.view?.targetSeat === id, seat.id);
  if (mobile) await page.getByRole('button', { name: /^Сесть · / }).tap();
  else await page.keyboard.press('e');
  await frame(page, id => __kitchen.serviceLevel.view?.seat === id, seat.id);
  await page.getByRole('button', { name: 'Встать', exact: true }).waitFor({ state: 'visible' });
}

async function touchSauna(page, start, end, hold = 0) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
    if (hold) await page.waitForTimeout(hold);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

async function saunaSolo(mobile = false, quality = 'eco') {
  const page = await pageFor(url, mobile, quality);
  const panorama = page.waitForResponse(response => /\/dolomites\.webp(?:\?|$)/.test(response.url()) && response.ok(), { timeout: 25000 });
  await soloAtDoor(page);
  if (!mobile) await page.getByRole('button', { name: 'Скрыть панель', exact: true }).click();
  await openDestination(page, 'sauna', mobile);
  await frame(page, () => __kitchen.serviceLevel.previewVisible);
  await panorama;
  await page.waitForTimeout(720);
  await shot(page, mobile ? 'sauna-mobile-door' : 'sauna-door');
  await page.keyboard.down('w');
  try { await frame(page, () => __kitchen.serviceLevel.active && __kitchen.serviceLevel.destination === 'sauna'); }
  finally { await page.keyboard.up('w'); }
  await frame(page, () => Number.isInteger(__kitchen.serviceLevel.view?.avatars?.localTowel));
  await shot(page, mobile ? 'sauna-mobile-arrival' : 'sauna-arrival');
  if (mobile) {
    await touchSauna(page, { x: 250, y: 295 }, { x: 250, y: 508 });
    await frame(page, () => __kitchen.serviceLevel.view.pitch < -.9);
    await shot(page, 'sauna-mobile-towel');
    const start = await spaView(page);
    await touchSauna(page, { x: 68, y: 510 }, { x: 68, y: 432 }, 830);
    const after = await spaView(page);
    assert(Math.hypot(after.x - start.x, after.z - start.z) > 1.2);
    const seat = sauna.seats.filter(s => s.zone === 'arrival')[1];
    await takeSaunaSeat(page, seat, true);
    await shot(page, 'sauna-mobile-seated');
    await page.getByRole('button', { name: 'Встать', exact: true }).tap();
    await frame(page, () => !__kitchen.serviceLevel.view?.seat);
    pass('Sauna portrait touch camera, local towel, movement, sit, stand and return');
  } else {
    await turnSauna(page, 0, -1.43);
    await shot(page, 'sauna-towel');
    await turnSauna(page, 0, 0);
    const pool = sauna.pools[0], [x0, , x1, edge] = pool.rect;
    const middle = (x0 + x1) / 2;
    await walkSauna(page, middle, edge - pool.steps - 1.5);
    const swim = (await service(page)).players[0];
    assert.equal(swim.swimming, true);
    await shot(page, 'sauna-pool-swim');
    await walkSauna(page, middle, edge + 1);
    assert.equal((await service(page)).players[0].pose, 'walk');
    await turnSauna(page, 0, -.1);
    await shot(page, 'sauna-pool-panorama');
    const metrics = await measure(page);
    const seat = sauna.seats.filter(s => s.zone === 'arrival')[1];
    await takeSaunaSeat(page, seat);
    await shot(page, 'sauna-seated');
    const seated = (await service(page)).players[0];
    assert.equal(seated.seat, seat.id);
    const view = await spaView(page);
    assert(Math.abs(view.y - seated.eyeY) < .08);
    await page.keyboard.press('e');
    await frame(page, () => !__kitchen.serviceLevel.view?.seat && __kitchen.serviceLevel.view?.y > 1.52);
    await turnSauna(page, 0, .08);
    await page.mouse.click(600, 380);
    await frame(page, () => document.pointerLockElement?.id === 'scene');
    await page.keyboard.press('Escape');
    await frame(page, () => document.pointerLockElement === null);
    pass('Sauna desktop portal, first-person towel, swim and stairs, sitting and pointer-lock release', metrics);
  }
  await returnToHall(page);
  await frame(page, () => !document.querySelector('.sauna-hud'));
  await page.context().close();
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

async function snowLook(page, mobile, dx, dy) {
  if (mobile) {
    const session = await page.context().newCDPSession(page);
    try {
      const x = 235, y = 330;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await session.detach(); }
  } else {
    await page.mouse.move(600, 360);
    if (!await attr(page, () => document.pointerLockElement?.id === 'scene')) {
      await page.mouse.click(600, 360);
      await frame(page, () => document.pointerLockElement?.id === 'scene');
    }
    await page.mouse.move(600 + dx, 360 + dy, { steps: 5 });
  }
}

async function snowFirstPerson(page, mobile) {
  const gear = mobile ? 'ski' : 'board';
  await frame(page, kind => __kitchen.serviceLevel.view?.gear === kind, gear);
  const before = await attr(page, () => __kitchen.serviceLevel.view);
  await snowLook(page, mobile, mobile ? 105 : 210, 0);
  await frame(page, yaw => Math.abs(Math.sin(__kitchen.serviceLevel.view.yaw - yaw)) > 0.25, before.yaw);
  const side = await attr(page, () => ({
    view: __kitchen.serviceLevel.view, rider: __kitchen.serviceLevel.snapshot.players[0],
  }));
  assert(Math.hypot(side.view.x - side.rider.x, side.view.z - side.rider.z) < 0.65, 'camera travels at the rider');
  assert(side.view.y - side.rider.y > 0.65 && side.view.y - side.rider.y < 1.85, 'camera remains at head height');
  assert(Math.abs(side.rider.lean) < 0.1, 'looking aside does not steer');
  async function center() {
    if (mobile) await page.getByRole('button', { name: 'Смотреть по ходу', exact: true }).tap();
    else await page.keyboard.press('c');
  }
  await center();
  await frame(page, () => Math.abs(__kitchen.serviceLevel.view.pitch) < 0.42);
  await snowLook(page, mobile, 0, mobile ? 220 : 600);
  await frame(page, () => __kitchen.serviceLevel.view.pitch < -1.16);
  await shot(page, mobile ? 'snow-mobile-skis-down' : 'snow-board-down');
  await center();
  await frame(page, () => Math.abs(__kitchen.serviceLevel.view.pitch) < 0.42);
  pass(mobile ? 'Touch first-person look and visible ski gear' : 'Mouse first-person head look, snowboard, and recenter', {
    gear, eyeHeight: side.view.y - side.rider.y, lookRadians: Math.abs(side.view.yaw - before.yaw),
  });
}

async function snowSolo(mobile = false) {
  const page = await pageFor(url, mobile);
  await soloAtDoor(page);
  await openDestination(page, 'snow', mobile);
  await frame(page, () => __kitchen.serviceLevel.previewVisible);
  const courierToast = page.locator('.social-hud:not([hidden])').getByText('Курьер Żabka у двери', { exact: true });
  assert.equal(await courierToast.count(), 0);
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
  await snowFirstPerson(page, mobile);
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
  if (['all', 'solo', 'arsenal'].includes(mode)) await solo();
  if (['all', 'mobile', 'arsenal'].includes(mode)) await mobileAndCourier();
  if (mode === 'all' || mode === 'online') await online();
  if (['all', 'snow', 'snow-first-person'].includes(mode)) await snowSolo();
  if (['all', 'snow-mobile', 'snow-first-person'].includes(mode)) await snowSolo(true);
  if (mode === 'all' || mode === 'snow-online') await online('snow');
  if (['all', 'sauna', 'sauna-solo'].includes(mode)) await saunaSolo();
  if (['all', 'sauna', 'sauna-mobile'].includes(mode)) await saunaSolo(true);
  if (mode === 'sauna-high') await saunaSolo(false, 'high');
  if (['all', 'sauna', 'sauna-online'].includes(mode)) await online('sauna');
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
