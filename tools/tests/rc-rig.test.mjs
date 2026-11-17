// Independent shipped-asset acceptance. Inspect the actual packed GLB, not the
// Blender generator's manifest or a mock that shares its layout implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';

const base = new URL('../../', import.meta.url);
const spec = JSON.parse(readFileSync(new URL('web/spec/rc.json', base)));
const bytes = readFileSync(process.env.RC_ASSET_FILE || new URL('web/' + spec.asset, base));
assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
const length = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.toString('utf8', 20, 20 + length));
const nodes = gltf.nodes;
const close = (a, b, tolerance = .002) => assert(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
function matrix(node) {
  if (node.matrix) return new THREE.Matrix4().fromArray(node.matrix);
  return new THREE.Matrix4().compose(new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
    new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]), new THREE.Vector3().fromArray(node.scale || [1, 1, 1]));
}
function scalar(value, accessor) {
  if (!accessor.normalized) return value;
  const divisor = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[accessor.componentType];
  return divisor ? Math.max(-1, value / divisor) : value;
}
function boundsBelow(pivot) {
  const bounds = new THREE.Box3();
  function visit(index, parent) {
    const node = nodes[index], transform = parent.clone().multiply(matrix(node));
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const position = gltf.accessors[primitive.attributes.POSITION];
      assert(position.min && position.max, `${node.name} needs shipped POSITION bounds`);
      const min = position.min.map(v => scalar(v, position)), max = position.max.map(v => scalar(v, position));
      for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]])
        bounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(transform));
    }
    for (const child of node.children || []) visit(child, transform);
  }
  for (const child of pivot.children || []) visit(child, new THREE.Matrix4());
  assert(!bounds.isEmpty(), `${pivot.name} must contain visible wheel geometry`);
  return bounds;
}
function wheelsOf(design) {
  const root = nodes.find(n => n.name === 'rc_' + design.id); assert(root, design.id + ' car root');
  assert.equal(design.vehicle?.wheels?.length, 4, design.id + ' needs its canonical wheel node contract');
  assert.equal(typeof design.vehicle.bodyNode, 'string');
  assert.equal((root.children || []).map(i => nodes[i]).filter(n => n.name === design.vehicle.bodyNode).length, 1, design.id + ' exact body node is present');
  return design.vehicle.wheels.map(def => {
    const matches = (root.children || []).map(i => nodes[i]).filter(n => n.name === def.node);
    assert.equal(matches.length, 1, `${design.id}/${def.id} needs exactly one named independent pivot ${def.node}`);
    return matches[0];
  });
}

test('all forty published wheel pivots are neutral transform empties, independently of Meshopt decoder children', () => {
  assert.equal(spec.designs.length, 10);
  for (const design of spec.designs) for (const wheel of wheelsOf(design)) {
    assert.equal(wheel.mesh, undefined, `${design.id}/${wheel.name}: animated pivot must not retain a rotated cylinder mesh`);
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    matrix(wheel).decompose(position, rotation, scale);
    close(Math.abs(rotation.w), 1, 1e-5); close(rotation.x, 0, 1e-5); close(rotation.y, 0, 1e-5); close(rotation.z, 0, 1e-5);
    for (const value of scale.toArray()) close(value, 1, 1e-5);
    assert((wheel.children || []).length > 0, 'static mesh children remain below the animated pivot');
  }
});

test('shipped wheel geometry has its axle on X and its rolling circle centred on the pivot', () => {
  for (const design of spec.designs) for (const wheel of wheelsOf(design)) {
    const bounds = boundsBelow(wheel), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    assert(size.x < size.y * .9 && size.x < size.z * .9,
      `${design.id}/${wheel.name}: axle X must be thinner than the Y/Z rolling circle, size ${size.toArray()}`);
    close(size.y, size.z, Math.max(size.y, size.z) * .12);
    close(center.y, 0, .025); close(center.z, 0, .025);
  }
});

test('all shipped wheel pivots and rolling radii match their per-design SI vehicle layout', () => {
  for (const design of spec.designs) {
    assert.equal(design.vehicle?.wheels?.length, 4, design.id + ' needs an authored four-wheel physical layout');
    const byNode = new Map(design.vehicle.wheels.map(w => [w.node, w]));
    assert.equal(byNode.size, 4);
    for (const pivot of wheelsOf(design)) {
      const layout = byNode.get(pivot.name);
      assert(layout, `${design.id}/${pivot.name} has no corresponding physical wheel`);
      assert(layout.position?.length === 3 && layout.position.every(Number.isFinite));
      const position = new THREE.Vector3().setFromMatrixPosition(matrix(pivot)).toArray();
      position.forEach((v, i) => close(v, layout.position[i]));
      const size = boundsBelow(pivot).getSize(new THREE.Vector3());
      assert(layout.radius > 0 && layout.width > 0);
      close(size.y, layout.radius * 2, Math.max(.035, layout.radius * .2));
      close(size.z, layout.radius * 2, Math.max(.035, layout.radius * .2));
      assert(size.x <= layout.width + .05, `${design.id}/${pivot.name}: actual tire width exceeds the physical layout`);
    }
    const front = design.vehicle.wheels.filter(w => w.front), rear = design.vehicle.wheels.filter(w => !w.front);
    assert.equal(front.length, 2); assert.equal(rear.length, 2);
    assert(front.every(w => w.position[2] > 0)); assert(rear.every(w => w.position[2] < 0));
    assert(design.vehicle.centerOfMass?.length === 3 && design.vehicle.centerOfMass.every(Number.isFinite));
  }
});
