import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { solveAvatarPose, solveArm } from '../../web/js/multiplayer/avatar-pose.js';
import { AVATAR_RIG as R, WEAPON_PRESENTATION as W } from '../../web/js/multiplayer/avatar-rig.js';
import { makeAvatarAction } from '../../web/js/multiplayer/action-contract.js';
// Browser import-map resolution only; exercise the production renderer/Three.js rig without WebGL.
const sourceURL = new URL('../../web/js/multiplayer/avatars.js', import.meta.url);
const source = fs.readFileSync(sourceURL, 'utf8').replace(/from '([^']+)'/g, (whole, spec) => {
  if (spec === 'three') return `from '${new URL('../../web/vendor/three-0.169/build/three.module.js', import.meta.url).href}'`;
  return spec.startsWith('.') ? `from '${new URL(spec, sourceURL).href}'` : whole;
});
const { createAvatar, AVATAR_ROSTER } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
function finiteTree(value) { if (typeof value === 'number') assert.ok(Number.isFinite(value)); else if (value && typeof value === 'object') for (const next of Object.values(value)) finiteTree(next); }

test('Pose solver is deterministic, finite, anatomically bounded across 10 slots and accepted actions', () => {
  const kinds = ['draw', 'fire', 'reload', 'pickup', 'drop', 'use', 'page', 'sit', 'stand', 'jump', 'land'];
  let seed = 21; const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 2 ** 32; };
  for (let i = 0; i < 300; i++) {
    const time = random() * 100, kind = kinds[i % kinds.length], weapon = Object.keys(W)[i % 4];
    const state = { time, speed: random() * 4, weapon, aimPitch: random() * 4 - 2, aimYaw: random() * 4 - 2, aiming: random(), grounded: i % 5 !== 0, verticalSpeed: random() * 8 - 4,
      held: i % 7 === 0 ? 'phone' : i % 9 === 0 ? 'newspaper' : null, seated: i % 8 === 0, seatY: 0.45,
      action: makeAvatarAction(kind, time - 0.1, { weapon, targetId: 'phone' }), actionTime: 0.1, reloading: kind === 'reload', reloadProgress: random(), shotAge: random() };
    const pose = solveAvatarPose(state, i % 10); finiteTree(pose); assert.deepEqual(pose, solveAvatarPose(state, i % 10));
    for (const arm of Object.values(pose.arms)) { close(distance(arm.shoulder, arm.elbow), R.upperArm); close(distance(arm.elbow, arm.wrist), R.forearm); }
  }
  finiteTree(solveAvatarPose({ time: NaN, speed: Infinity, aiming: NaN, aimPitch: Infinity, seatY: NaN, held: 'unknown', interactionTarget: [NaN, Infinity, 0] }));
  finiteTree(solveArm(1, [NaN, Infinity, 1000]));
});

test('Seated knees bend with flat lower legs; jump, landing and run have distinct poses', () => {
  const idle = solveAvatarPose({ time: 1 }), seated = solveAvatarPose({ time: 1, seated: true, seatY: 0.45 });
  assert.ok(seated.legs.left.hip > 1.5); assert.ok(seated.legs.left.knee < -1.5); close(seated.legs.left.hip + seated.legs.left.knee, 0);
  close(seated.body.y, 0.45 - R.hipY);
  const rising = solveAvatarPose({ time: 1, grounded: false, verticalSpeed: 3 }), falling = solveAvatarPose({ time: 1, grounded: false, verticalSpeed: -3 });
  assert.ok(rising.legs.left.knee < falling.legs.left.knee);
  const land = solveAvatarPose({ time: 1.1, action: makeAvatarAction('land', 1), actionTime: 0.1 }); assert.ok(land.body.y < idle.body.y - 0.05);
  assert.ok(solveAvatarPose({ speed: 3, time: 1 }).body.pitch < solveAvatarPose({ speed: 1, time: 1 }).body.pitch);
});

test('Head retains independent yaw and look pitch while seated and carrying either item', () => {
  for (const held of [null, 'phone', 'newspaper']) {
    const up = solveAvatarPose({ seated: true, held, aimPitch: 0.6, aimYaw: 0.7 });
    const down = solveAvatarPose({ seated: true, held, aimPitch: -0.6, aimYaw: -0.7 });
    assert.ok(up.head.pitch - down.head.pitch > 0.6); close(up.head.yaw, 0.7); close(down.head.yaw, -0.7);
  }
});

test('Pitched ADS support hand remains at the actual rotated weapon foregrip', () => {
  for (const weapon of ['rifle', 'bolt', 'shotgun']) for (const pitch of [-0.55, 0.55]) {
    const pose = solveAvatarPose({ weapon, aiming: 1, aimPitch: pitch, shotAge: 10 });
    const v = W[weapon].support, angle = pose.hands.right[0], c = Math.cos(angle), s = Math.sin(angle);
    const expected = [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
    const actual = pose.arms.left.wrist.map((n, i) => n - pose.arms.right.wrist[i]);
    assert.ok(distance(actual, expected) < 1e-6, `${weapon} ${pitch} support lost foregrip`);
  }
});

test('Accepted pickup/drop, phone tap, page turn, fire and reload expose timed observer cues', () => {
  const pickup = makeAvatarAction('pickup', 10, { targetId: 'phone' });
  assert.equal(solveAvatarPose({ time: 10.05, held: 'phone', action: pickup, actionTime: 0.05 }).gear.visible, false);
  assert.equal(solveAvatarPose({ time: 10.4, held: 'phone', action: pickup, actionTime: 0.4 }).gear.visible, true);
  const drop = makeAvatarAction('drop', 11, { targetId: 'phone' });
  assert.equal(solveAvatarPose({ time: 11.1, held: null, action: drop, actionTime: 0.1 }).gear.kind, 'phone');
  assert.equal(solveAvatarPose({ time: 11.5, held: null, action: drop, actionTime: 0.5 }).gear.visible, false);
  assert.equal(solveAvatarPose({ time: 12, held: null, action: drop, actionTime: 0.55 }).gear.kind, 'none');
  const holster = { kind: 'holster', at: 12, duration: 1, targetId: 'rifle' };
  assert.equal(solveAvatarPose({ time: 12.1, weapon: 'none', action: holster, actionTime: 0.1 }).gear.kind, 'rifle');
  assert.equal(solveAvatarPose({ time: 12.9, weapon: 'none', action: holster, actionTime: 0.9 }).gear.visible, false);
  assert.ok(solveAvatarPose({ held: 'phone', action: makeAvatarAction('use', 1, { targetId: 'phone' }), actionTime: 0.2 }).gear.tap > 0);
  assert.ok(solveAvatarPose({ held: 'newspaper', action: makeAvatarAction('page', 1), actionTime: 0.25 }).gear.page > 0);
  assert.ok(solveAvatarPose({ weapon: 'rifle', shotAge: 0.03 }).gear.recoil > 0); assert.equal(solveAvatarPose({ weapon: 'rifle', shotAge: 0.2 }).gear.muzzle, false);
  assert.ok(solveAvatarPose({ weapon: 'rifle', reloading: true, reloadProgress: 0.4 }).gear.magazine > 0.5);
  assert.ok(solveAvatarPose({ weapon: 'shotgun', reloading: true, reloadProgress: 0.5 }).gear.breakOpen > 0.5);
  assert.ok(solveAvatarPose({ weapon: 'bolt', shotAge: 0.4 }).gear.bolt > 0.5);
});

test('External door/device use animates a free hand while every weapon or carried item remains gripped', () => {
  for (const kind of ['pistol', 'rifle', 'bolt', 'shotgun', 'phone', 'newspaper']) {
    const state = { time: 1, weapon: Object.hasOwn(W, kind) ? kind : 'none', held: ['phone', 'newspaper'].includes(kind) ? kind : null, shotAge: 10 };
    const idle = solveAvatarPose(state);
    const use = solveAvatarPose({ ...state, action: makeAvatarAction('use', 0.7, { targetId: 'hood' }), actionTime: 0.25, interactionTarget: [0.2, 1.5, -0.5] });
    assert.ok(distance(idle.arms.left.wrist, use.arms.left.wrist) > 0.08, `${kind} has no external-use gesture`);
    assert.equal(use.gear.kind, kind); assert.equal(use.gear.visible, true);
    assert.equal(use.gear.tap, 0); assert.equal(use.gear.page, 0);
  }
});

test('Production rig has real joints, hand-parented props, exact grip contact, muzzle and bounded drawables', () => {
  for (let slot = 0; slot < 10; slot++) {
    const avatar = createAvatar({ slot, name: 'Игрок' });
    try {
      for (const name of ['avatar_head', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle']) assert.ok(avatar.root.getObjectByName(name));
      for (const kind of ['pistol', 'rifle', 'bolt', 'shotgun', 'phone', 'newspaper']) {
        avatar.update({ time: 2, weapon: Object.hasOwn(W, kind) ? kind : 'none', held: kind === 'phone' || kind === 'newspaper' ? kind : null, aimPitch: 0.4, aiming: 1, shotAge: 0.03 });
        avatar.root.updateMatrixWorld(true);
        const wrist = avatar.root.getObjectByName('right_wrist'), grip = avatar.root.getObjectByName('avatar_prop_grip');
        assert.ok(grip); assert.equal(avatar.animation.parent, 'right_wrist');
        const world = object => { const p = object.position.clone(); object.getWorldPosition(p); return p.toArray(); };
        close(distance(world(wrist), world(grip)), 0);
        const muzzle = avatar.getMuzzleWorldPosition(); assert.equal(!!muzzle, Object.hasOwn(W, kind));
        let visible = 1; avatar.root.traverse(o => { if (!o.isMesh) return; for (let p = o; p; p = p.parent) if (!p.visible) return; visible++; });
        assert.ok(visible <= 20, `${AVATAR_ROSTER[slot].id}/${kind} needs ${visible} drawables`);
        finiteTree(avatar.animation);
      }
      avatar.update({ time: 3, seated: true, seatY: 0.45, held: 'phone', aimYaw: 0.6 }); assert.ok(avatar.root.getObjectByName('left_knee').rotation.x < -1.5);
    } finally { avatar.dispose(); }
  }
});

test('Prop cache and articulated rig dispose every owned geometry/material exactly once', () => {
  const avatar = createAvatar(), geometry = new Map(), materials = new Map();
  for (const kind of ['pistol', 'rifle', 'bolt', 'shotgun', 'phone', 'newspaper']) {
    avatar.update({ weapon: Object.hasOwn(W, kind) ? kind : 'none', held: ['phone', 'newspaper'].includes(kind) ? kind : null });
    avatar.root.traverse(o => { if (o.isMesh) {
      if (!geometry.has(o.geometry)) { geometry.set(o.geometry, 0); o.geometry.addEventListener('dispose', () => geometry.set(o.geometry, geometry.get(o.geometry) + 1)); }
      if (!materials.has(o.material)) { materials.set(o.material, 0); o.material.addEventListener('dispose', () => materials.set(o.material, materials.get(o.material) + 1)); }
    } });
  }
  avatar.dispose(); avatar.dispose();
  assert.ok(geometry.size > 20); for (const count of geometry.values()) assert.equal(count, 1); for (const count of materials.values()) assert.equal(count, 1);
});
