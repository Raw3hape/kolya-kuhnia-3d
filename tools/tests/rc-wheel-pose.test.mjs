// Observe actual Cannon outputs for ten distinct canonical SI rigs. This does
// not call the shared layout/model-origin conversion helpers under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { createRCSimulation, controllerPositions } from '../../web/js/rc-state.js';
const read = name => JSON.parse(readFileSync(new URL(`../../web/spec/${name}.json`, import.meta.url)));
const spec = read('rc'), site = read('site');

test('all ten physical vehicles retain authored wheel centres and axle directions at rest and while steering', () => {
  const sim = createRCSimulation({ spec, site }), controllers = controllerPositions(spec);
  const drivers = controllers.map((c, i) => ({ id: 'independent-rig-' + i, x: c.position[0], z: c.position[2] }));
  try {
    drivers.forEach((p, i) => assert(sim.command(p, 'take', 'rc-' + i).ok));
    for (let i = 0; i < 120; i++) sim.step(1 / 60);
    const inspect = (moving = false) => {
      for (const car of sim.snapshot().cars) {
        const design = spec.designs.find(d => d.id === car.designId), chassisQ = new THREE.Quaternion().fromArray(car.quaternion).normalize(), inverse = chassisQ.clone().invert();
        assert.equal(car.wheels.length, 4); assert(design.vehicle?.wheels?.length === 4, design.id + ' canonical wheel layout');
        car.wheels.forEach((wheel, i) => {
          const authored = design.vehicle.wheels[i], local = new THREE.Vector3().fromArray(wheel.position).sub(new THREE.Vector3().fromArray(car.position)).applyQuaternion(inverse).add(new THREE.Vector3().fromArray(design.vehicle.centerOfMass));
          assert(Math.abs(local.x - authored.position[0]) < .002, `${design.id}/${authored.id} physical track differs from the rendered socket`);
          assert(Math.abs(local.z - authored.position[2]) < .002, `${design.id}/${authored.id} physical wheelbase differs from the rendered socket`);
          assert(Math.abs(local.y - authored.position[1]) < .16, `${design.id}/${authored.id} suspension cannot hide a doubled model offset`);
          const actualAxle = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().fromArray(wheel.quaternion).normalize()).applyQuaternion(inverse);
          const expectedAxle = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), authored.steer ? car.steering : 0);
          assert(actualAxle.distanceTo(expectedAxle) < .002, `${design.id}/${authored.id} steering/spin rotated the tire off its physical axle`);
          if (!moving) assert(Math.abs(wheel.position[1] - authored.radius + site.floorY) < .06, `${design.id}/${authored.id} tire should contact the actual ground`);
        });
      }
    };
    inspect();
    for (let step = 0; step < 40; step++) {
      drivers.forEach((p, i) => assert(sim.command(p, 'input', 'rc-' + i, { throttle: .3, steer: i % 2 ? -.4 : .4, brake: false, seq: step + 1 }).ok));
      sim.step(1 / 60);
    }
    inspect(true);
    assert.equal(new Set(sim.snapshot().cars.map(c => c.owner)).size, 10);
  } finally { sim.dispose(); }
});
