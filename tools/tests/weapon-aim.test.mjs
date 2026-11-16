import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { AIM_NDC, createWeaponAim } from '../../web/js/weapon-aim.js';

test('offset and animated bores converge on the shot centre across hand projections', () => {
  const aim = createWeaponAim(THREE), ray = new THREE.Raycaster();
  for (const [width, height] of [[1440, 960], [390, 844], [844, 390]]) {
    for (const shift of [0, 190]) for (const fov of [36, 50, 86]) {
      const camera = new THREE.PerspectiveCamera(fov, width / height, 0.01, 5);
      if (shift) camera.setViewOffset(width, height, shift, 0, width, height);
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      ray.setFromCamera(AIM_NDC, camera);
      for (const distance of [70, 150, 400, 800]) {
        const rig = new THREE.Group(), bone = new THREE.Group(), muzzle = new THREE.Object3D();
        rig.position.set(0.14, -0.17, -0.46); rig.rotation.set(0.2, -0.1, 0.04);
        bone.scale.setScalar(0.025); bone.rotation.set(0.12, 1.4, -0.1);
        muzzle.position.set(30, 2, 0); bone.add(muzzle); rig.add(bone);
        const target = ray.ray.at(distance, new THREE.Vector3());
        for (let i = 0; i < 10; i++) {
          aim.align(rig, muzzle, camera, distance); rig.updateMatrixWorld(true);
          const origin = muzzle.getWorldPosition(new THREE.Vector3());
          const direction = new THREE.Vector3(1, 0, 0).transformDirection(muzzle.matrixWorld);
          const to = target.clone().sub(origin);
          assert.ok(to.dot(direction) > 0, 'target must be in front of the muzzle');
          assert.ok(to.cross(direction).length() < 1e-8, 'bore must intersect shared target without accumulating drift');
          const screen = target.clone().project(camera);
          assert.ok(Math.hypot(screen.x, screen.y) < 1e-10);
        }
      }
    }
  }
});

test('eye pose centres the front sight using the bore, including lateral model tilt', () => {
  const aim = createWeaponAim(THREE), bore = new THREE.Vector3(0.03, 0.04, -1).normalize();
  const rear = new THREE.Vector3(0.01, 0.09, -0.04), front = new THREE.Vector3(0.02, 0.1, -0.7);
  const before = [rear.clone(), front.clone(), bore.clone()];
  const p = aim.eyePose(0.45, rear, front, bore);
  const q = new THREE.Quaternion().setFromUnitVectors(bore, new THREE.Vector3(0, 0, -1));
  const f = front.clone().applyQuaternion(q).add(p), r = rear.clone().applyQuaternion(q).add(p);
  assert.ok(Math.hypot(f.x, f.y) < 1e-12);
  assert.ok(Math.abs(r.z + 0.45) < 1e-12);
  [rear, front, bore].forEach((v, i) => assert.deepEqual(v.toArray(), before[i].toArray()));
});
