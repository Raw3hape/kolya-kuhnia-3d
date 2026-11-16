import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { compactMaterialGroups } from '../../web/js/material-groups.js';

test('six equal wall faces become one draw without changing vertices, indices, or picked slot', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial(), materials = Array(6).fill(material), slots = Array(6).fill('walls');
  const index = geometry.index, position = geometry.attributes.position, indices = Array.from(index.array);
  compactMaterialGroups(geometry, materials, slots);
  assert.deepEqual(geometry.groups, [{start:0,count:36,materialIndex:0}]);
  assert.equal(geometry.index,index); assert.equal(geometry.attributes.position,position); assert.deepEqual(Array.from(index.array),indices);
  const mesh = new THREE.Mesh(geometry,materials); mesh.updateMatrixWorld();
  for (const axis of [[2,0,0],[-2,0,0],[0,2,0],[0,-2,0],[0,0,2],[0,0,-2]]) {
    const origin = new THREE.Vector3(...axis), direction = origin.clone().negate().normalize();
    const hit = new THREE.Raycaster(origin,direction).intersectObject(mesh)[0];
    assert.equal(slots[hit.face.materialIndex],'walls');
  }
  geometry.dispose(); material.dispose();
});

test('different room slots stay independently pickable even when materials share an object', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial(), materials = Array(6).fill(material), slots = ['room2','walls','walls','walls','walls','room3'];
  compactMaterialGroups(geometry, materials, slots);
  assert.deepEqual(geometry.groups.map(g=>[g.count,slots[g.materialIndex]]),[[6,'room2'],[24,'walls'],[6,'room3']]);
  geometry.dispose(); material.dispose();
});
