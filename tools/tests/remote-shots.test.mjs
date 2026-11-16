import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { createShotRenderer } from '../../web/js/multiplayer/shots.js';

test('third-person muzzle changes only the cosmetic start, never the accepted hit', () => {
  const scene = new THREE.Scene(), renderer = createShotRenderer({ THREE, scene, requestRender() {} });
  const event = { origin: [0, 1.6, 0], rays: [{ direction: [0, 0, -1], hit: { distance: 7, point: [0, 1.6, -7] } }] };
  renderer.shot(event, { origin: [0.25, 1.2, -0.7] });
  const line = scene.getObjectByName('network-shots').children[0], positions = line.geometry.attributes.position;
  assert.ok(Math.abs(positions.getX(0) - 0.25) < 1e-6);
  assert.ok(Math.abs(positions.getY(0) - 1.2) < 1e-6);
  assert.equal(positions.getZ(1), -7);
  assert.deepEqual(event.origin, [0, 1.6, 0]);
  assert.deepEqual(event.rays[0].hit.point, [0, 1.6, -7]);
  renderer.update(0.1);
  assert.equal(scene.getObjectByName('network-shots').children.length, 0);
  renderer.dispose(); assert.equal(scene.children.length, 0);
});

test('missing or invalid remote muzzle falls back to the ordinary accepted ray', () => {
  const scene = new THREE.Scene(), renderer = createShotRenderer({ THREE, scene, requestRender() {} });
  renderer.shot({ origin: [0, 1.6, 0], rays: [{ direction: [0, 0, -1] }] }, { origin: [NaN, 0, 0] });
  const positions = scene.getObjectByName('network-shots').children[0].geometry.attributes.position;
  assert.ok(Math.abs(positions.getZ(0) + 0.35) < 1e-6);
  assert.equal(positions.getZ(1), -100);
  renderer.dispose();
});
