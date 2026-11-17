// Independent correction witness. Uses the original player camera actually sent
// to WebGL, rather than accepting an unchanged body pose beside a field camera.
// Solo fixture placement is explicit; every drive/look/exit action is native input.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { awaitPlayable } from './await-playable.mjs';
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const url = process.env.QA_URL || 'http://127.0.0.1:8765/';
const output = path.resolve(process.env.QA_OUTPUT || 'output/playwright/rc-correction-independent');
fs.mkdirSync(output, { recursive: true });
const report = { url, mode: 'solo fixture / native controls / actual WebGL camera', checks: [], errors: [], cleanup: false };
let browser, context, page;
const watchdog = setTimeout(() => browser?.close().finally(() => process.exit(2)), 240000);
function check(name, pass, details) {
  report.checks.push({ name, pass, details }); console.log(JSON.stringify({ name, pass }));
  if (!pass) throw Error(name + ': ' + JSON.stringify(details));
}
async function aim(target) {
  for (let i = 0; i < 16; i++) {
    const p = await page.evaluate(() => ({ ...__kitchen.walk.getNetworkPose(), eye: __kitchen.camera.position.y }));
    const dx = target[0] - p.x, dz = target[2] - p.z, yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(target[1] - p.eye, Math.hypot(dx, dz));
    const angle = Math.atan2(Math.sin(p.yaw - yaw), Math.cos(p.yaw - yaw));
    const mx = Math.max(-210, Math.min(210, angle / .0042)), my = Math.max(-140, Math.min(140, (p.pitch - pitch) / .0042));
    if (Math.abs(mx) < .7 && Math.abs(my) < .7) break;
    await page.mouse.move(620, 350); await page.mouse.down({ button: 'right' });
    await page.mouse.move(620 + mx, 350 + my, { steps: 5 }); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(70);
  }
  await page.waitForTimeout(250);
}
async function inspectRig() {
  return page.evaluate(async () => {
    const T = await import('three'), api = __kitchen, held = api.rc.held;
    const car = api.rc.snapshot().cars.find(c => c.id === held.id), view = api.scene.getObjectByName('rc_car_' + held.id);
    const design = api.rc.config.designs.find(d => d.id === car.designId), expected = new T.Vector3().fromArray(car.position);
    if (!design.vehicle?.centerOfMass) throw Error('missing canonical SI vehicle layout');
    view.updateWorldMatrix(true, true);
    const root = view.getWorldPosition(new T.Vector3()), q = view.getWorldQuaternion(new T.Quaternion());
    const center = root.clone().add(new T.Vector3().fromArray(design.vehicle.centerOfMass).applyQuaternion(q));
    const errors = design.vehicle.wheels.map((layout, i) => {
      const id = layout.id, wheel = view.getObjectByName(layout.node);
      if (!wheel || !car.wheels?.[i]) return { id, missing: true };
      const position = wheel.getWorldPosition(new T.Vector3()), rotation = wheel.getWorldQuaternion(new T.Quaternion()), expectedQ = new T.Quaternion().fromArray(car.wheels[i].quaternion);
      const actualAxle = new T.Vector3(1, 0, 0).applyQuaternion(rotation), expectedAxle = new T.Vector3(1, 0, 0).applyQuaternion(expectedQ);
      return { id, emptyPivot: !wheel.isMesh, positionError: position.distanceTo(new T.Vector3().fromArray(car.wheels[i].position)), rotationError: 1 - Math.abs(rotation.dot(expectedQ)), axleError: actualAxle.distanceTo(expectedAxle), quaternion: rotation.toArray() };
    });
    return { id: car.id, rootCOMError: center.distanceTo(expected), errors, carPosition: car.position, human: api.walk.getNetworkPose(), camera: api.camera.position.toArray(), cameraQuaternion: api.camera.quaternion.toArray(), renderCameras: window.__rcCorrectionCameras.slice(-16) };
  });
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem('kitchen-ui-v1', JSON.stringify({ quality: 'eco', seen: { intro: true } })));
  if (process.env.QA_ACCESS_URL_FILE) await context.request.get(fs.readFileSync(process.env.QA_ACCESS_URL_FILE, 'utf8').trim());
  page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' }); await awaitPlayable(page);
  await page.waitForFunction(() => __kitchen.rc?.config && __kitchen.rc.controllers.length === 10);
  await page.getByRole('button', { name: 'Понятно', exact: true }).click({ timeout: 500 }).catch(() => {});
  const fixture = await page.evaluate(() => {
    __kitchen.viewmodel.setWeapon('none');
    __kitchen.doors.setOpen('room3_balcony_door', true, { instant: true });
    const t = __kitchen.rc.config.table.position;
    __kitchen.walk.enter({ x: t[0], z: t[2] + .65 }, 0);
    return { controller: __kitchen.rc.controllers[0] };
  });
  await page.waitForTimeout(1100); await aim(fixture.controller.position);
  await page.waitForFunction(() => !!__kitchen.rc.target);
  await page.evaluate(() => {
    window.__rcCorrectionCameras = [];
    const api = __kitchen, original = api.renderer.render;
    window.__rcCorrectionRender = original;
    api.renderer.render = function (scene, camera, ...rest) {
      if (scene === api.scene && api.rc.controlling && this.getRenderTarget() === null) {
        window.__rcCorrectionCameras.push(camera.position.toArray());
        if (window.__rcCorrectionCameras.length > 64) window.__rcCorrectionCameras.shift();
      }
      if (scene !== api.scene && api.rc.controlling) {
        const controller = scene.getObjectByName('rc_held_controller');
        if (controller) window.__rcCorrectionOverlay = { camera, root: controller };
      }
      return original.call(this, scene, camera, ...rest);
    };
  });
  const before = await page.evaluate(() => ({ body: __kitchen.walk.getNetworkPose(), camera: __kitchen.camera.position.toArray() }));
  await page.keyboard.press('e'); await page.waitForFunction(() => __kitchen.rc.controlling); await page.waitForTimeout(500);
  const picked = await inspectRig();
  const renderedOnBalcony = picked.renderCameras.length && picked.renderCameras.every(c => Math.hypot(c[0] - before.camera[0], c[1] - before.camera[1], c[2] - before.camera[2]) < .06);
  check('actual rendered camera stays at the original balcony eyes while controller is held', renderedOnBalcony, picked);
  check('published rig initially matches Cannon wheel centres, axes and rotated centre of mass', picked.rootCOMError < .015 && picked.errors.every(w => !w.missing && w.emptyPivot && w.positionError < .015 && Math.abs(w.rotationError) < .001), picked);
  const fieldWitness = await page.evaluate(async () => {
    const { PLAYABLE_FIELD } = await import('/js/playable-field.generated.js'), api = __kitchen;
    const boundary = api.scene.getObjectByName('rc_arena_boundary'), ring = api.scene.getObjectByName('rc_driver_ring'), marker = document.querySelector('.rc-driver-marker');
    const expected = PLAYABLE_FIELD.polygons.flatMap(p => [p.outer, ...(p.holes || [])]), lines = boundary?.children || [];
    const matching = lines.length === expected.length && lines.every((line, i) => {
      const positions = line.geometry?.attributes?.position; if (positions?.count !== expected[i].length) return false;
      return expected[i].every((p, j) => Math.abs(positions.getX(j) - p[0]) < .002 && Math.abs(positions.getZ(j) - p[1]) < .002);
    });
    const rect = marker?.getBoundingClientRect();
    return { boundaryVisible: !!boundary?.visible, contourCount: lines.length, exactPublishedContours: matching, ringVisible: !!ring?.visible,
      markerVisible: !!marker && !marker.hidden && rect.width > 10 && rect.height > 10 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
      markerText: marker?.textContent, markerOwner: marker?.dataset.rcId, ownedCar: api.rc.held.id };
  });
  check('visible limits use the published playable perimeter and the player can identify their own car', fieldWitness.boundaryVisible && fieldWitness.exactPublishedContours && fieldWitness.ringVisible && fieldWitness.markerVisible && fieldWitness.markerOwner === fieldWitness.ownedCar, fieldWitness);
  await page.keyboard.down('w'); await page.waitForTimeout(1100); await page.keyboard.down('d'); await page.waitForTimeout(700); await page.keyboard.up('d'); await page.keyboard.up('w');
  const beforeLook = await page.evaluate(() => __kitchen.camera.quaternion.toArray());
  await page.mouse.move(650, 400); await page.mouse.down({ button: 'right' }); await page.mouse.move(755, 438, { steps: 8 }); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(500);
  const moving = await inspectRig();
  check('driving and looking preserve balcony position and physical wheel alignment', Math.hypot(moving.human.x - before.body.x, moving.human.z - before.body.z) < .002 &&
    moving.renderCameras.length && moving.renderCameras.every(c => Math.hypot(c[0] - before.camera[0], c[1] - before.camera[1], c[2] - before.camera[2]) < .06) &&
    moving.rootCOMError < .015 && moving.errors.every(w => !w.missing && w.positionError < .015 && Math.abs(w.rotationError) < .001 && w.axleError < .002), moving);
  const spinChanged = moving.errors.some((wheel, i) => 1 - Math.abs(wheel.quaternion.reduce((sum, value, j) => sum + value * picked.errors[i].quaternion[j], 0)) > .01);
  check('native throttle visibly rotates the physical wheels while the car travels', spinChanged && Math.hypot(...moving.carPosition.map((v, i) => v - picked.carPosition[i])) > .25, { before: picked.errors, after: moving.errors, carPositions: [picked.carPosition, moving.carPosition] });
  check('native mouse drag looks from the balcony instead of orbiting the car', 1 - Math.abs(moving.cameraQuaternion.reduce((sum, value, i) => sum + value * beforeLook[i], 0)) > .0005, { before: beforeLook, after: moving.cameraQuaternion });
  await page.keyboard.press('c'); await page.waitForTimeout(350);
  const beforeZoom = await page.evaluate(() => __kitchen.camera.fov);
  const beforeOverlayFov = await page.evaluate(() => window.__rcCorrectionOverlay?.camera.fov);
  await page.mouse.move(700, 450); await page.mouse.wheel(0, -140); await page.waitForTimeout(500);
  const zoom = await page.evaluate(() => ({ fov: __kitchen.camera.fov, camera: __kitchen.camera.position.toArray() }));
  check('trackpad zoom changes optical field of view without leaving balcony eyes', zoom.fov < beforeZoom && Math.hypot(...zoom.camera.map((v, i) => v - before.camera[i])) < .06, { beforeFov: beforeZoom, after: zoom });
  const overlayWitness = await page.evaluate(async () => {
    const T = await import('three'), overlay = window.__rcCorrectionOverlay; if (!overlay) return null;
    const camera = overlay.camera, controller = overlay.root.children[0]; controller.updateWorldMatrix(true, true);
    const center = new T.Box3().setFromObject(controller).getCenter(new T.Vector3()).project(camera);
    return { fov: camera.fov, eyes: camera.position.toArray(), center: center.toArray(), modelVisible: controller.visible && Math.abs(center.x) < 1 && Math.abs(center.y) < 1 && center.z > -1 && center.z < 1 };
  });
  check('optical zoom preserves a visible controller using an overlay at the same balcony eyes', overlayWitness?.modelVisible && Math.abs(overlayWitness.fov - beforeOverlayFov) < .001 && Math.hypot(...overlayWitness.eyes.map((v, i) => v - before.camera[i])) < .06, overlayWitness);
  await page.screenshot({ path: path.join(output, 'balcony-remote-driving.png') });
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !__kitchen.rc.controlling);
  const exited = await page.evaluate(() => ({ pose: __kitchen.walk.getNetworkPose(), camera: __kitchen.camera.position.toArray(), rcHUD: document.querySelector('.rc-hud')?.hidden }));
  check('exit keeps original balcony location and removes RC controls', Math.hypot(exited.pose.x - before.body.x, exited.pose.z - before.body.z) < .002 && exited.rcHUD, exited);
  check('no uncaught browser errors', report.errors.length === 0, report.errors);
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  await page?.evaluate(() => { if (window.__rcCorrectionRender && window.__kitchen) __kitchen.renderer.render = window.__rcCorrectionRender; delete window.__rcCorrectionOverlay; }).catch(() => {});
  await context?.close().catch(() => {}); await browser?.close().catch(() => {}); clearTimeout(watchdog);
  report.cleanup = true; fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(c => c.pass).length, failure: report.failure, report: path.join(output, 'report.json'), cleanup: report.cleanup }));
}
