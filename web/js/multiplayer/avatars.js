// Lightweight remote players: one vertex-coloured mesh per moving body part, no asset downloads.
// createAvatar({ slot, name, host, layer }) -> { root, height, setIdentity, update, dispose }.
// Feet at y=0; forward is -Z, matching walk.yaw. Caller owns root position/rotation and interpolation.
// update({ dt,time,speed,weapon='none',aimPitch=0,held=null,shooting=false,seated=false,seatY }) animates visuals only.
// Slot allocation/identity/collision belong to the room authority, never to this renderer adapter.
import * as THREE from 'three';
import { AVATAR_RIG as R, WEAPON_PRESENTATION as W } from './avatar-rig.js';
import { solveAvatarPose } from './avatar-pose.js';

export const AVATAR_ROSTER = Object.freeze([
  { id: 'sailor', label: 'Морской свитер', shirt: '#e4e3d8', accent: '#263e59', pants: '#293641', skin: '#d5a47e', hair: '#322b28', style: 'stripes', head: 'crop' },
  { id: 'mustard', label: 'Горчичная куртка', shirt: '#c69237', accent: '#73512c', pants: '#343d38', skin: '#e9b997', hair: '#6c4230', style: 'hood', head: 'crop' },
  { id: 'gardener', label: 'Садовник', shirt: '#dbd2b3', accent: '#53744c', pants: '#53744c', skin: '#c78f6c', hair: '#a6532e', style: 'overalls', head: 'cap' },
  { id: 'artist', label: 'Художница', shirt: '#b8654e', accent: '#e4b86d', pants: '#454945', skin: '#9e674e', hair: '#302626', style: 'jumper', head: 'bun' },
  { id: 'neighbour', label: 'Сосед в жилете', shirt: '#e7e3d8', accent: '#3f6075', pants: '#53504b', skin: '#d8ae90', hair: '#b9b7ae', style: 'vest', head: 'glasses' },
  { id: 'skater', label: 'Скейтер', shirt: '#9380ad', accent: '#292b31', pants: '#41424b', skin: '#bb825e', hair: '#302c2d', style: 'tee', head: 'beanie' },
  { id: 'traveller', label: 'Туристка', shirt: '#428d87', accent: '#d7bc82', pants: '#394d5d', skin: '#edbc93', hair: '#8d6438', style: 'backpack', head: 'braid' },
  { id: 'chef', label: 'Повар', shirt: '#ece6d4', accent: '#b7b9a8', pants: '#383c40', skin: '#bc8d6b', hair: '#514236', style: 'apron', head: 'chef' },
  { id: 'cyclist', label: 'Велосипедистка', shirt: '#ce7064', accent: '#ecd6ad', pants: '#39434d', skin: '#855c46', hair: '#292827', style: 'zip', head: 'bob' },
  { id: 'maker', label: 'Мастер', shirt: '#4e6b87', accent: '#a95735', pants: '#51473b', skin: '#e1aa83', hair: '#534239', style: 'work', head: 'orangehat' },
].map(Object.freeze));

const INK = '#282c30', WHITE = '#eeeadd';

// Merge coloured primitives while building. Each limb remains a single draw call.
function builder(material) {
  const positions = [], normals = [], colors = [];
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), color = new THREE.Color();
  function add(geometry, tint, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
    q.setFromEuler(new THREE.Euler(...rotation));
    matrix.compose(new THREE.Vector3(...position), q, new THREE.Vector3(...scale));
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.applyMatrix4(matrix); color.set(tint);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    g.dispose();
  }
  return {
    box: (size, tint, position, rotation) => add(new THREE.BoxGeometry(...size), tint, position, rotation),
    ball: (radius, tint, position, scale) => add(new THREE.IcosahedronGeometry(radius, 1), tint, position, undefined, scale),
    cylinder: (top, bottom, height, tint, position, rotation) => add(new THREE.CylinderGeometry(top, bottom, height, 8), tint, position, rotation),
    build() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = false; mesh.receiveShadow = true;
      return mesh;
    },
  };
}

function torso(material, d) {
  const b = builder(material), broad = ['chef', 'neighbour'].includes(d.id) ? 1.06 : d.id === 'cyclist' ? 0.93 : 1;
  b.box([0.38 * broad, 0.53, 0.23], d.shirt, [0, 1.135, 0]);
  b.box([0.32, 0.17, 0.24], d.pants, [0, 0.83, 0]);
  if (d.style === 'stripes') {
    for (let i = 0; i < 4; i++) b.box([0.385, 0.037, 0.012], d.accent, [0, 0.98 + i * 0.105, -0.12]);
  } else if (d.style === 'overalls') {
    b.box([0.29, 0.37, 0.02], d.accent, [0, 1.02, -0.124]);
    for (const x of [-0.105, 0.105]) {
      b.box([0.045, 0.3, 0.026], d.accent, [x, 1.25, -0.127]);
      b.ball(0.014, '#bba16b', [x, 1.14, -0.15]);
    }
    b.box([0.11, 0.09, 0.022], '#42623d', [0, 1.09, -0.15]);
  } else if (d.style === 'vest') {
    for (const x of [-0.11, 0.11]) b.box([0.155, 0.49, 0.026], d.accent, [x, 1.14, -0.126]);
    b.box([0.385, 0.49, 0.028], d.accent, [0, 1.14, 0.125]);
  } else if (d.style === 'apron') {
    b.box([0.32, 0.58, 0.027], WHITE, [0, 1.01, -0.134]);
    b.box([0.17, 0.17, 0.03], WHITE, [0, 1.31, -0.136]);
    b.box([0.16, 0.075, 0.016], d.accent, [0, 1.04, -0.157]);
  } else if (d.style === 'hood') {
    b.ball(0.15, d.shirt, [0, 1.39, 0.092], [1.16, 0.7, 0.75]);
    b.box([0.01, 0.4, 0.012], d.accent, [0, 1.13, -0.124]);
    for (const x of [-0.065, 0.065]) b.box([0.012, 0.15, 0.015], WHITE, [x, 1.29, -0.127]);
  } else if (d.style === 'backpack') {
    b.box([0.29, 0.35, 0.14], d.accent, [0, 1.15, 0.17]);
    b.box([0.22, 0.12, 0.025], '#a88c5e', [0, 1.06, 0.251]);
    for (const x of [-0.13, 0.13]) b.box([0.035, 0.44, 0.019], d.accent, [x, 1.16, -0.13]);
  } else if (d.style === 'work') {
    for (const x of [-0.09, 0.09]) b.box([0.09, 0.09, 0.022], '#3c556f', [x, 1.24, -0.13]);
    b.box([0.37, 0.05, 0.255], '#3b342e', [0, 0.89, 0]);
    b.box([0.1, 0.14, 0.045], d.accent, [0.14, 0.84, -0.145]);
  } else if (d.style === 'zip') {
    b.box([0.018, 0.5, 0.012], d.accent, [0, 1.14, -0.124]);
    b.box([0.14, 0.035, 0.013], d.accent, [-0.105, 1.3, -0.125], [0, 0, -0.25]);
  } else if (d.style === 'tee') {
    b.box([0.13, 0.15, 0.012], '#d6c8a5', [0, 1.2, -0.123], [0, 0, 0.15]);
    b.box([0.065, 0.07, 0.014], d.accent, [0, 1.2, -0.132], [0, 0, 0.15]);
  }
  return b.build();
}

function headMesh(material, d) {
  const b = builder(material);
  b.cylinder(0.061, 0.07, 0.1, d.skin, [0, 1.435, 0]);
  b.ball(0.155, d.skin, [0, 1.605, -0.008], [0.88, 1.1, 0.87]);
  b.box([0.04, 0.045, 0.036], d.skin, [0, 1.59, -0.145]);
  for (const x of [-0.052, 0.052]) {
    b.box([0.037, 0.023, 0.012], WHITE, [x, 1.635, -0.133]);
    b.box([0.015, 0.019, 0.015], INK, [x, 1.635, -0.142]);
    b.box([0.042, 0.009, 0.014], d.hair, [x, 1.665, -0.128]);
    b.ball(0.028, d.skin, [Math.sign(x) * 0.139, 1.61, 0], [0.5, 1, 0.7]);
  }
  b.box([0.045, 0.009, 0.009], '#87594e', [0, 1.55, -0.134]);
  b.ball(0.151, d.hair, [0, 1.696, 0.012], [0.91, 0.58, 0.87]);
  if (d.head === 'cap') {
    b.ball(0.157, d.accent, [0, 1.711, 0.006], [0.96, 0.55, 0.94]);
    b.box([0.23, 0.021, 0.16], d.accent, [0, 1.719, -0.105]);
  } else if (d.head === 'beanie' || d.head === 'orangehat') {
    const tint = d.head === 'orangehat' ? d.accent : '#2a2b30';
    b.ball(0.158, tint, [0, 1.714, 0.006], [0.96, 0.72, 0.96]);
    b.cylinder(0.145, 0.145, 0.05, tint, [0, 1.701, 0.006]);
  } else if (d.head === 'bun') {
    b.ball(0.075, d.hair, [0, 1.79, 0.06]);
    for (const x of [-0.149, 0.149]) b.ball(0.018, d.accent, [x, 1.575, -0.01], [0.65, 1.4, 0.65]);
  } else if (d.head === 'braid') {
    for (let i = 0; i < 5; i++) b.ball(0.04 - i * 0.003, d.hair, [0.09, 1.62 - i * 0.065, 0.126]);
  } else if (d.head === 'chef') {
    b.cylinder(0.115, 0.125, 0.12, WHITE, [0, 1.777, 0]);
    for (const [x, z] of [[-0.065, 0], [0.065, 0], [0, -0.06], [0, 0.06]]) b.ball(0.075, WHITE, [x, 1.85, z], [1, 0.8, 1]);
    b.ball(0.115, d.hair, [0, 1.528, 0], [0.93, 0.43, 1.08]);
  } else if (d.head === 'bob') {
    for (const x of [-0.125, 0.125]) b.box([0.055, 0.21, 0.19], d.hair, [x, 1.605, 0.025]);
  }
  if (d.head === 'glasses' || d.head === 'bob') {
    for (const x of [-0.055, 0.055]) {
      b.box([0.087, 0.054, 0.013], INK, [x, 1.633, -0.147]);
      b.box([0.065, 0.033, 0.014], d.head === 'bob' ? '#445c62' : '#b5d1d0', [x, 1.633, -0.155]);
    }
    b.box([0.035, 0.012, 0.013], INK, [0, 1.636, -0.151]);
  }
  return b.build();
}


function nameplate() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material); sprite.position.y = 2.08; sprite.scale.set(1.18, 0.221, 1);
  sprite.userData.rasterOnly = true;
  const position = new THREE.Vector3(), viewport = new THREE.Vector4();
  sprite.onBeforeRender = (renderer, scene, camera) => {
    sprite.getWorldPosition(position).applyMatrix4(camera.matrixWorldInverse);
    const pixels = renderer.getViewport(viewport).w || renderer.domElement.clientHeight || 1;
    const worldPerPixel = 2 * (camera.isPerspectiveCamera ? Math.abs(position.z) : 1) / (camera.projectionMatrix.elements[5] * pixels);
    const height = Math.min(0.221, Math.max(0.004, worldPerPixel * 38));
    sprite.scale.set(height * 512 / 96, height, 1); sprite.updateMatrixWorld();
  };
  return {
    sprite,
    write(name, host) {
      ctx.clearRect(0, 0, 512, 96);
      const label = `${String(name || 'Игрок').slice(0, 24)}${host ? ' · хозяин' : ''}`;
      ctx.font = '500 34px Inter, Arial, sans-serif';
      const width = Math.min(500, Math.ceil(ctx.measureText(label).width) + 36), x = (512 - width) / 2;
      ctx.fillStyle = 'rgba(24,32,34,0.88)'; ctx.beginPath(); ctx.roundRect(x, 13, width, 66, 12); ctx.fill();
      ctx.fillStyle = '#faf9f4'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 256, 47, width - 26);
      texture.needsUpdate = true;
    },
  };
}

function joint(name, position = [0, 0, 0]) {
  const group = new THREE.Group(); group.name = name; group.position.set(...position); return group;
}
function armChain(material, d, side) {
  const label = side < 0 ? 'left' : 'right', shoulder = joint(`${label}_shoulder`, [side * R.shoulderX, R.shoulderY - R.hipY, 0]);
  const elbow = joint(`${label}_elbow`, [0, -R.upperArm, 0]), wrist = joint(`${label}_wrist`, [0, -R.forearm, 0]);
  const upper = builder(material), lower = builder(material), hand = builder(material);
  const tee = d.style === 'tee', sleeve = tee ? 0.17 : R.upperArm;
  upper.box([0.10, sleeve, 0.135], d.shirt, [0, -sleeve / 2, 0]);
  if (tee) upper.box([0.087, R.upperArm - sleeve, 0.105], d.skin, [0, -(R.upperArm + sleeve) / 2, 0]);
  upper.ball(0.052, tee ? d.skin : d.shirt, [0, -R.upperArm, 0], [0.95, 1, 1]);
  if (!tee) {
    lower.box([0.09, 0.095, 0.11], d.shirt, [0, -0.0475, 0]);
    lower.box([0.096, 0.025, 0.116], d.accent, [0, -0.095, 0]);
  }
  const skinLength = tee ? R.forearm : R.forearm - 0.105;
  lower.box([0.075, skinLength, 0.09], d.skin, [0, -(R.forearm - skinLength / 2), 0]);
  hand.box([0.073, 0.075, 0.045], d.skin, [0, -0.024, 0]);
  for (let i = 0; i < 4; i++) hand.box([0.014, 0.039, 0.035], d.skin, [-0.024 + i * 0.016, -0.075, -0.006]);
  hand.box([0.027, 0.045, 0.035], d.skin, [-side * 0.042, -0.025, -0.018], [0.3, 0, -side * 0.4]);
  const a = upper.build(), b = lower.build(), c = hand.build(); a.name = `${label}_upper_arm_mesh`; b.name = `${label}_forearm_mesh`; c.name = `${label}_hand`;
  shoulder.add(a, elbow); elbow.add(b, wrist); wrist.add(c);
  return { shoulder, elbow, wrist };
}
function legChain(material, d, side) {
  const label = side < 0 ? 'left' : 'right', hip = joint(`${label}_hip`, [side * R.hipX, R.hipY, 0]);
  const knee = joint(`${label}_knee`, [0, -R.upperLeg, 0]), ankle = joint(`${label}_ankle`, [0, -R.lowerLeg, 0]);
  const width = d.id === 'skater' ? 0.17 : 0.14, upper = builder(material), lower = builder(material), boot = builder(material);
  upper.box([width, R.upperLeg, 0.17], d.pants, [0, -R.upperLeg / 2, 0]);
  upper.ball(width * 0.48, d.pants, [0, -R.upperLeg, 0], [1, 0.8, 1.02]);
  lower.box([width * 0.93, R.lowerLeg, 0.15], d.pants, [0, -R.lowerLeg / 2, 0]);
  lower.box([width * 0.97, 0.027, 0.16], d.accent, [0, -R.lowerLeg + 0.015, 0]);
  const shoe = ['sailor', 'skater', 'cyclist'].includes(d.id) ? WHITE : '#3c3832';
  boot.box([width + 0.014, 0.095, 0.255], shoe, [0, -0.06, -0.043]);
  boot.box([width + 0.017, 0.018, 0.26], '#b6b2a6', [0, -0.111, -0.043]);
  for (let i = 0; i < 3; i++) boot.box([width * 0.55, 0.006, 0.012], shoe === WHITE ? d.accent : '#c7bdab', [0, -0.009, -0.016 - i * 0.025]);
  hip.add(upper.build(), knee); knee.add(lower.build(), ankle); ankle.add(boot.build());
  return { hip, knee, ankle };
}

function createGear(kind, material, flashMaterial, screenMaterial) {
  const root = joint(`avatar_${Object.hasOwn(W, kind) ? 'weapon' : kind}`), b = builder(material);
  let muzzle = null, flash = null, magazine = null, bolt = null, barrels = null, page = null;
  if (kind === 'phone') {
    b.box([0.078, 0.15, 0.014], INK, [0, 0.04, 0]);
    b.box([0.083, 0.155, 0.008], '#4c5558', [0, 0.04, -0.004]);
    b.ball(0.011, '#171d20', [-0.023, 0.094, -0.015]);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.125, 0.003), screenMaterial);
    screen.name = 'avatar_phone_screen'; screen.position.set(0, 0.04, 0.009); root.add(screen);
    b.box([0.024, 0.004, 0.002], WHITE, [0, -0.012, 0.012]);
    b.box([0.023, 0.006, 0.002], INK, [0, 0.098, 0.012]); root.add(b.build());
  } else if (kind === 'newspaper') {
    root.position.set(-0.20, 0.035, -0.014);
    b.box([0.40, 0.285, 0.012], '#dedbcc', [0, 0.035, 0]);
    b.box([0.006, 0.29, 0.016], '#bbb5a2', [0, 0.035, 0]);
    for (const side of [-1, 1]) {
      b.box([0.16, 0.024, 0.014], '#525b56', [side * 0.10, 0.142, 0.002]);
      b.box([0.07, 0.063, 0.014], side < 0 ? '#71938c' : '#b88a62', [side * 0.065, 0.075, 0.002]);
      for (let i = 0; i < 7; i++) b.box([0.16, 0.005, 0.014], '#838277', [side * 0.10, 0.012 - i * 0.017, 0.002]);
    }
    root.add(b.build()); page = joint('newspaper_page', [0, 0.035, 0.012]);
    const leaf = builder(material); leaf.box([0.195, 0.278, 0.005], '#ece7d8', [0.10, 0, 0]);
    for (let i = 0; i < 8; i++) leaf.box([0.16, 0.004, 0.007], '#7e7f76', [0.10, 0.105 - i * 0.027, 0]);
    page.add(leaf.build()); root.add(page); page.visible = false;
  } else {
    const pistol = kind === 'pistol', profile = W[kind], length = profile.length - (pistol ? 0.09 : 0.16);
    b.box([0.062, 0.085, pistol ? 0.16 : 0.22], '#363d40', [0, 0.045, -0.065]);
    b.box([0.045, 0.115, 0.06], '#66503b', [0, -0.035, 0.008], [-0.18, 0, 0]);
    b.box([0.025, 0.009, 0.04], '#959d98', [0, 0.092, -0.075]);
    if (!pistol) {
      b.box([0.065, 0.10, 0.18], '#66513d', [0, 0.018, 0.115]);
      b.box([0.06, 0.07, 0.14], '#655742', [0, 0.025, -0.18]);
    }
    if (kind === 'bolt') { b.cylinder(0.025, 0.025, 0.17, INK, [0, 0.123, -0.095], [Math.PI / 2, 0, 0]); }
    if (kind === 'rifle') { b.box([0.038, 0.018, 0.08], INK, [0, 0.117, -0.06]); }
    root.add(b.build());
    barrels = joint('weapon_barrel', [0, 0.045, pistol ? -0.07 : -0.12]);
    const barrel = builder(material);
    if (kind === 'shotgun') {
      for (const x of [-0.018, 0.018]) barrel.cylinder(0.014, 0.014, length, '#707773', [x, 0, -length / 2], [Math.PI / 2, 0, 0]);
    } else barrel.cylinder(pistol ? 0.015 : 0.011, pistol ? 0.015 : 0.011, length, '#65706d', [0, 0, -length / 2], [Math.PI / 2, 0, 0]);
    barrel.box([0.018, 0.025, 0.015], INK, [0, 0.02, -length + 0.025]); barrels.add(barrel.build()); root.add(barrels);
    if (kind === 'rifle' || pistol) {
      const mag = builder(material); mag.box([0.038, pistol ? 0.09 : 0.14, 0.065], '#333b40', [0, 0, 0]);
      magazine = mag.build(); magazine.name = 'weapon_magazine'; magazine.position.set(0, pistol ? -0.085 : -0.095, pistol ? 0.01 : -0.09); root.add(magazine);
    }
    if (kind === 'bolt') {
      bolt = joint('weapon_bolt', [0.044, 0.073, -0.015]);
      const lever = builder(material); lever.box([0.05, 0.014, 0.014], '#9b9d91', [0.018, 0, 0]); lever.ball(0.018, INK, [0.05, -0.01, 0]); bolt.add(lever.build()); root.add(bolt);
    }
    muzzle = joint('avatar_muzzle', [0, 0, -length]); barrels.add(muzzle);
    flash = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.12, 6), flashMaterial);
    flash.name = 'muzzle_flash'; flash.rotation.x = -Math.PI / 2; flash.position.z = -0.055; flash.visible = false; muzzle.add(flash);
  }
  const grip = joint('avatar_prop_grip', root.position.clone().negate().toArray()); root.add(grip);
  return { root, kind, muzzle, flash, magazine, bolt, barrels, page, grip };
}

export function createAvatar({ slot = 0, name = '', host = false, layer = 0 } = {}) {
  const index = Number.isInteger(slot) && slot >= 0 && slot < AVATAR_ROSTER.length ? slot : 0, d = AVATAR_ROSTER[index];
  const root = joint(`player_${d.id}`), rig = joint('avatar_rig'), body = joint('avatar_body', [0, R.hipY, 0]);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, flatShading: true });
  const flashMaterial = new THREE.MeshBasicMaterial({ color: '#ffda84', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
  const screenMaterial = new THREE.MeshBasicMaterial({ color: '#85b8bc', toneMapped: false });
  const torsoMesh = torso(material, d); torsoMesh.position.y = -R.hipY; body.add(torsoMesh);
  const head = joint('avatar_head', [0, R.neckY - R.hipY, 0]), face = headMesh(material, d); face.position.y = -R.neckY; head.add(face); body.add(head);
  const leftArm = armChain(material, d, -1), rightArm = armChain(material, d, 1);
  const leftLeg = legChain(material, d, -1), rightLeg = legChain(material, d, 1);
  body.add(leftArm.shoulder, rightArm.shoulder); rig.add(body, leftLeg.hip, rightLeg.hip); root.add(rig);
  const gearSocket = joint('avatar_gear'); rightArm.wrist.add(gearSocket);
  const spare = builder(material); spare.box([0.036, 0.12, 0.055], '#333b40', [0, -0.06, 0]);
  const spareMagazine = spare.build(); spareMagazine.name = 'reload_magazine_in_hand'; spareMagazine.visible = false; leftArm.wrist.add(spareMagazine);
  const plate = nameplate(); if (plate) { root.add(plate.sprite); plate.write(name, host); }
  const gearCache = new Map(), down = new THREE.Vector3(0, -1, 0), direction = new THREE.Vector3();
  const lowerWorld = new THREE.Quaternion(), handWorld = new THREE.Quaternion(), euler = new THREE.Euler(), target = new THREE.Vector3();
  let currentGear = null, pose = null, disposed = false, lastSeatY = 0.45;
  function setLayer(object) { object.traverse(o => { o.layers.set(layer); o.userData.rasterOnly = true; }); }
  setLayer(root);
  function applyArm(chain, points, rotation) {
    direction.fromArray(points.elbow).sub(target.fromArray(points.shoulder)).normalize();
    chain.shoulder.quaternion.setFromUnitVectors(down, direction);
    direction.fromArray(points.wrist).sub(target.fromArray(points.elbow)).normalize(); lowerWorld.setFromUnitVectors(down, direction);
    chain.elbow.quaternion.copy(chain.shoulder.quaternion).invert().multiply(lowerWorld);
    handWorld.setFromEuler(euler.set(...rotation, 'XYZ'));
    chain.wrist.quaternion.copy(lowerWorld).invert().multiply(handWorld);
  }
  function update(input = {}) {
    if (disposed) return;
    const state = { ...input };
    if (state.seated && Number.isFinite(state.seatY)) lastSeatY = state.seatY;
    if (!Number.isFinite(state.seatY)) state.seatY = lastSeatY;
    const interaction = state.interaction || state.action;
    if (Array.isArray(interaction?.target) && interaction.target.length === 3) {
      root.updateWorldMatrix(true, false); target.fromArray(interaction.target); root.worldToLocal(target);
      target.y -= state.seated ? lastSeatY - R.hipY : 0; state.interactionTarget = target.toArray();
    }
    pose = solveAvatarPose(state, index);
    rig.position.y = pose.body.y; body.rotation.set(pose.body.pitch, 0, pose.body.roll);
    head.rotation.set(pose.head.pitch, pose.head.yaw, -pose.body.roll * 0.3);
    for (const [chain, value] of [[leftLeg, pose.legs.left], [rightLeg, pose.legs.right]]) {
      chain.hip.rotation.x = value.hip; chain.knee.rotation.x = value.knee; chain.ankle.rotation.x = value.ankle;
    }
    applyArm(leftArm, pose.arms.left, pose.hands.left); applyArm(rightArm, pose.arms.right, pose.hands.right);
    const kind = pose.gear.kind;
    if (currentGear?.kind !== kind) {
      currentGear?.root.removeFromParent(); currentGear = null;
      // Party rendering owns its shared models, liquids and hose. The rig only poses the hand.
      if (kind !== 'none' && !['beer', 'vape', 'hookah'].includes(kind)) {
        if (!gearCache.has(kind)) { const gear = createGear(kind, material, flashMaterial, screenMaterial); setLayer(gear.root); gearCache.set(kind, gear); }
        currentGear = gearCache.get(kind); gearSocket.add(currentGear.root);
      }
    }
    if (currentGear) {
      currentGear.root.visible = pose.gear.visible; gearSocket.scale.setScalar(pose.gear.scale);
      if (currentGear.flash) currentGear.flash.visible = pose.gear.muzzle;
      if (currentGear.magazine) currentGear.magazine.visible = pose.gear.magazine < 0.2;
      if (currentGear.barrels) currentGear.barrels.rotation.x = -pose.gear.breakOpen * 0.65;
      if (currentGear.bolt) { currentGear.bolt.position.z = -0.015 + pose.gear.bolt * 0.075; currentGear.bolt.rotation.z = -pose.gear.bolt * 0.8; }
      if (currentGear.page) { currentGear.page.visible = pose.gear.page > 0.001 && pose.gear.page < 0.999; currentGear.page.rotation.y = -Math.PI * pose.gear.page; }
    }
    spareMagazine.visible = !!currentGear?.magazine && pose.gear.magazine >= 0.15;
    if (plate) plate.sprite.position.y = 2.08 + pose.body.y;
  }
  update();
  return {
    root, height: 1.8, slot: index, definition: d,
    setIdentity({ name: nextName = name, host: nextHost = host } = {}) { name = nextName; host = nextHost; plate?.write(name, host); },
    update,
    getMuzzleWorldPosition(out = new THREE.Vector3()) {
      if (!currentGear?.muzzle || !currentGear.root.visible) return null;
      root.updateMatrixWorld(true); return currentGear.muzzle.getWorldPosition(out);
    },
    get animation() {
      return { pose: pose ? structuredClone(pose) : null, gear: currentGear?.kind || 'none',
        parent: currentGear?.root.parent?.parent?.name || null,
        joints: [head, leftArm.shoulder, leftArm.elbow, leftArm.wrist, rightArm.shoulder, rightArm.elbow, rightArm.wrist,
          leftLeg.hip, leftLeg.knee, leftLeg.ankle, rightLeg.hip, rightLeg.knee, rightLeg.ankle].map(j => ({ name: j.name, rotation: j.quaternion.toArray(), position: j.position.toArray() })) };
    },
    dispose() {
      if (disposed) return; disposed = true; root.removeFromParent();
      currentGear?.root.removeFromParent();
      root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      for (const gear of gearCache.values()) gear.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); gearCache.clear();
      material.dispose(); flashMaterial.dispose(); screenMaterial.dispose();
      if (plate) { plate.sprite.material.map.dispose(); plate.sprite.material.dispose(); }
    },
  };
}
