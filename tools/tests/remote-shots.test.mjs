import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { createShotRenderer, shotEndpoint } from '../../web/js/multiplayer/shots.js';

test('the tracer leaves the third-person muzzle, travels, stops on the accepted hit and fades', () => {
  const scene = new THREE.Scene(), renderer = createShotRenderer({ THREE, scene, requestRender() {} });
  const event = { origin: [0, 1.6, 0], rays: [{ direction: [0, 0, -1], hit: { distance: 20, point: [0, 1.6, -20] } }] };
  renderer.shot(event, { origin: [0.25, 1.2, -0.7] });
  const tracer = scene.getObjectByName('bullet-tracers'), { aStart, aEnd } = tracer.geometry.attributes;
  renderer.update(.04);
  assert.ok(Math.abs(aStart.getX(0) - 0.25) < 1e-6);
  assert.ok(Math.abs(aStart.getY(0) - 1.2) < 1e-6);
  assert.ok(aEnd.getZ(0) < -.7 && aEnd.getZ(0) > -20);
  renderer.update(.04);
  assert.equal(aEnd.getZ(0), -20);
  assert.deepEqual(event.rays[0].hit.point, [0, 1.6, -20]);
  renderer.update(.04);
  renderer.update(.04);
  assert.equal(tracer.visible, false);
  renderer.dispose(); assert.equal(scene.children.length, 0);
});

test('an invalid muzzle falls back to the accepted ray and a miss stops at weapon range', () => {
  const scene = new THREE.Scene(), renderer = createShotRenderer({ THREE, scene, requestRender() {} });
  const origin = [0, 1.6, 0], ray = { direction: [0, 0, -1] };
  renderer.shot({ origin, rays: [ray] }, { origin: [NaN, 0, 0], range: 70 });
  renderer.update(.04);
  const { aStart, aEnd } = scene.getObjectByName('bullet-tracers').geometry.attributes;
  assert.ok(Math.abs(aStart.getZ(0) + 0.35) < 1e-6);
  assert.ok(aEnd.getZ(0) < -.35);
  assert.deepEqual(shotEndpoint(origin, ray, 70), [0, 1.6, -70]);
  renderer.dispose();
});

test('glass does not truncate the tracer, and a confirmed RC impact ends it at the car', () => {
  const origin = [1, 2, 3], direction = [1, 0, 0], glass = { kind: 'glass', distance: 4, point: [5, 2, 3] };
  const wall = { kind: 'surface', distance: 12, point: [13, 2, 3] };
  const vehicleHit = { distance: 10, point: [11, 2, 3] };
  assert.deepEqual(shotEndpoint(origin, { direction, effects: [glass] }, 20), [21, 2, 3]);
  assert.equal(shotEndpoint(origin, { direction, effects: [glass, wall] }, 20), wall.point);
  assert.equal(shotEndpoint(origin, { direction, effects: [glass, wall], vehicleHit }, 20), vehicleHit.point);
});
