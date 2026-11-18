import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../../web/vendor/three-0.169/build/three.module.js';
import { createSaunaTowelGeometry, SAUNA_TOWELS } from '../../web/js/sauna-towels.js';

const resolvedThree = new URL('../../web/vendor/three-0.169/build/three.module.js', import.meta.url).href;
const avatarUrl = new URL('../../web/js/multiplayer/avatars.js', import.meta.url);
const source = readFileSync(avatarUrl, 'utf8').replace(/from '([^']+)'/g, (_, spec) =>
  `from '${spec === 'three' ? resolvedThree : new URL(spec, avatarUrl).href}'`);
const { createAvatar, AVATAR_ROSTER } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('the ten sauna towels have distinct designs and nonoverlapping atlas regions', () => {
  assert.equal(SAUNA_TOWELS.length, AVATAR_ROSTER.length);
  for (const key of ['name', 'icon', 'ground']) assert.equal(new Set(SAUNA_TOWELS.map(towel => towel[key])).size, SAUNA_TOWELS.length);
  const covered = new Set();
  for (let slot = 0; slot < SAUNA_TOWELS.length; slot++) {
    const geometry = createSaunaTowelGeometry(T, slot);
    const uv = geometry.getAttribute('uv');
    const tile = new Set();
    for (let i = 0; i < uv.count; i++) tile.add(Math.floor(uv.getX(i) * 4) + ',' + Math.floor(uv.getY(i) * 4));
    assert.equal(tile.size, 1);
    for (const cell of tile) { assert.ok(!covered.has(cell)); covered.add(cell); }
    geometry.dispose();
  }
});

test('opaque wraps close the front, back, sides and underside while standing and sitting', () => {
  const fabric = new T.MeshStandardMaterial({ transparent: false });
  const waist = new T.Mesh(createSaunaTowelGeometry(T, 0), fabric);
  const chest = new T.Mesh(createSaunaTowelGeometry(T, 0, true), fabric);
  const ray = new T.Raycaster();
  for (const [mesh, blends, y] of [[waist, [0, 0.5, 1], 0.12], [chest, [0], 0.38]]) {
    for (const blend of blends) {
      if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[0] = blend;
      for (let k = 0; k < 8; k++) {
        const a = Math.PI * (k + .28) / 4;
        ray.set(new T.Vector3(Math.sin(a), y, Math.cos(a)), new T.Vector3(-Math.sin(a), 0, -Math.cos(a)));
        assert.ok(ray.intersectObject(mesh).length, `missing cloth at angle ${a}, blend ${blend}`);
      }
      // From beneath the pool deck, the first hit must be the sealed cloth.
      ray.set(new T.Vector3(0.017, -1, 0), new T.Vector3(0, 1, 0));
      assert.ok(ray.intersectObject(mesh).length, "from below blend " + blend + " y " + y);
    }
    mesh.geometry.dispose();
  }
  fabric.dispose();
});

test('the sauna skin batches original rig poses into one opaque draw per guest', () => {
  for (const [slot, identity] of AVATAR_ROSTER.entries()) {
    const avatar = createAvatar({ slot, sauna: true, showNameplate: false, showFace: slot !== 0 });
    const skin = avatar.root.getObjectByName('sauna_skin');
    assert.equal(avatar.definition, identity);
    assert.equal(skin.isSkinnedMesh, true);
    assert.equal(skin.material.transparent, false);
    assert.equal(avatar.root.getObjectByName('avatar_head').children.length, slot === 0 ? 0 : 1);
    const meshes = [];
    avatar.root.traverse(object => { if (object.isMesh) meshes.push(object); });
    assert.deepEqual(meshes, [skin]);
    const count = skin.geometry.getAttribute('position').count;
    const vertex = new T.Vector3();
    for (const pose of [
      { time: 0, speed: 0 }, { time: 1.7, speed: 2 },
      { time: 2, seated: true, seatY: 0.55 }, { time: 2, seated: true, seatY: 0.43, lounging: true },
      { time: 3.1, speed: 0.8, swimming: true },
    ]) {
      avatar.update(pose); avatar.root.updateMatrixWorld(true);
      for (let i = 0; i < count; i += 7) {
        skin.getVertexPosition(i, vertex);
        assert.ok(vertex.toArray().every(Number.isFinite));
        assert.ok(skin.boundingSphere.containsPoint(vertex), JSON.stringify({ slot, pose, vertex: vertex.toArray() }));
      }
    }
    avatar.dispose();
  }
});
