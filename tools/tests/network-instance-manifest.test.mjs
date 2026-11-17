// Regression discovered with two real clients handing a controller across an
// open balcony: parked-car InstancedMesh base bounds were serialized at (0,0,0).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { collectNetworkObjects, stableObjectId } from '../../web/js/network-objects.js';
import { rayBox } from '../../web/js/multiplayer/authority.js';

test('distant decorative car instances never manufacture a handoff blocker at their unused geometry origin', () => {
  const scene = new THREE.Scene(), context = new THREE.Group(); context.name = 'context'; scene.add(context);
  const geometry = new THREE.BoxGeometry(1.83, 1.47, 4.69); geometry.translate(0, .735, 0);
  const material = new THREE.MeshBasicMaterial(), cars = new THREE.InstancedMesh(geometry, material, 2);
  cars.name = 'cars_sedan'; cars.userData.context = true;
  cars.setMatrixAt(0, new THREE.Matrix4().makeTranslation(50, -9.8, 30));
  cars.setMatrixAt(1, new THREE.Matrix4().makeTranslation(60, -9.8, 35)); context.add(cars);
  try {
    // This exact stable identity was observed in the rejected real-room request.
    assert.equal(stableObjectId(cars), 'scene/3ad06476ae8955bc');
    const manifest = collectNetworkObjects(scene, THREE);
    const phantom = manifest.filter(o => rayBox([-1.23, 1.279, -1.027], [1, 0, 0], o.bounds, .74));
    assert.deepEqual(phantom, [], 'instances physically parked fifty metres away cannot block two friends on the balcony');
    delete cars.userData.context;
    assert.deepEqual(collectNetworkObjects(scene, THREE), [], 'atomic-batch exclusion does not depend on a car/context whitelist');
  } finally { geometry.dispose(); material.dispose(); }
});

test('excluding decorative instance templates does not remove an actual opaque nearby handoff barrier', () => {
  const scene = new THREE.Scene(), geometry = new THREE.BoxGeometry(.1, 2, .5), material = new THREE.MeshBasicMaterial();
  const barrier = new THREE.Mesh(geometry, material); barrier.name = 'real_partition'; barrier.position.set(-.9, 1, -1); scene.add(barrier);
  try {
    const manifest = collectNetworkObjects(scene, THREE);
    assert.equal(manifest.length, 1);
    assert(rayBox([-1.23, 1.279, -1.027], [1, 0, 0], manifest[0].bounds, .74), 'real occlusion must still reject a through-wall transfer');
  } finally { geometry.dispose(); material.dispose(); }
});
