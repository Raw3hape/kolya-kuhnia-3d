// Lightweight remote players: one vertex-coloured mesh per moving body part, no asset downloads.
// createAvatar({ slot, name, host, layer }) -> { root, height, setIdentity, update, dispose }.
// Feet at y=0; forward is -Z, matching walk.yaw. Caller owns root position/rotation and interpolation.
// update({ dt,time,speed,weapon='none',aimPitch=0,held=null,shooting=false,seated=false,seatY }) animates visuals only.
// Slot allocation/identity/collision belong to the room authority, never to this renderer adapter.
import * as THREE from 'three';

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
const clamp = THREE.MathUtils.clamp;

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
  b.cylinder(0.061, 0.07, 0.1, d.skin, [0, 1.435, 0]);
  b.ball(0.155, d.skin, [0, 1.605, -0.008], [0.88, 1.1, 0.87]);
  b.box([0.04, 0.045, 0.036], d.skin, [0, 1.59, -0.145]);
  for (const x of [-0.052, 0.052]) {
    b.box([0.024, 0.017, 0.012], INK, [x, 1.635, -0.134]);
    b.ball(0.028, d.skin, [Math.sign(x) * 0.139, 1.61, 0], [0.5, 1, 0.7]);
  }
  b.box([0.045, 0.009, 0.009], '#87594e', [0, 1.55, -0.134]);
  b.ball(0.151, d.hair, [0, 1.696, 0.012], [0.91, 0.58, 0.87]);
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

function limb(material, d, arm, side) {
  const pivot = new THREE.Group(), b = builder(material);
  if (arm) {
    pivot.position.set(side * 0.17, 1.37, 0);
    const sleeve = d.style === 'tee' ? 0.17 : 0.29;
    b.box([0.125, sleeve, 0.16], d.shirt, [0, -sleeve / 2, 0]);
    b.box([0.09, 0.48 - sleeve, 0.105], d.skin, [0, -(0.48 + sleeve) / 2, 0]);
    b.ball(0.06, d.skin, [0, -0.5, 0], [0.8, 1.05, 0.85]);
  } else {
    pivot.position.set(side * 0.103, 0.83, 0);
    const width = d.id === 'skater' ? 0.17 : 0.14;
    b.box([width, 0.7, 0.17], d.pants, [0, -0.35, 0]);
    b.box([width + 0.015, 0.1, 0.26], ['sailor', 'skater', 'cyclist'].includes(d.id) ? WHITE : '#3c3832', [0, -0.775, -0.04]);
    b.box([width + 0.016, 0.023, 0.262], '#b6b2a6', [0, -0.818, -0.04]);
  }
  pivot.add(b.build());
  return pivot;
}

function equipment(material, weapon, held) {
  const b = builder(material), group = new THREE.Group();
  if (held) {
    if (String(held).includes('phone')) {
      b.box([0.075, 0.145, 0.014], INK);
      b.box([0.063, 0.125, 0.004], '#a3c4bd', [0, 0, -0.01]);
      group.position.set(0.12, 1.2, -0.39);
    } else {
      b.box([0.31, 0.36, 0.01], '#dedbcc');
      for (let i = 0; i < 6; i++) b.box([0.24, 0.008, 0.013], '#797a73', [0, 0.12 - i * 0.044, -0.008]);
      group.position.set(0, 1.16, -0.42);
    }
  } else if (weapon !== 'none') {
    const pistol = weapon === 'pistol', length = pistol ? 0.21 : weapon === 'bolt' ? 0.64 : 0.5;
    b.box([0.055, 0.075, length], '#383c3d', [0, 0, -length / 2]);
    b.box([0.047, 0.12, 0.065], '#5c4d3e', [0, -0.085, -0.035], [-0.2, 0, 0]);
    if (!pistol) {
      b.box([0.07, 0.1, 0.17], '#66513d', [0, -0.016, 0.075]);
      if (weapon === 'rifle') b.box([0.045, 0.14, 0.07], '#292d30', [0, -0.1, -0.17], [-0.2, 0, 0]);
      if (weapon === 'bolt') b.cylinder(0.022, 0.022, 0.15, INK, [0, 0.08, -0.2], [Math.PI / 2, 0, 0]);
      if (weapon === 'shotgun') b.box([0.085, 0.04, 0.33], '#6a6d68', [0, 0.016, -0.3]);
    }
    group.position.set(0.16, 1.16, -0.42);
  } else return group;
  group.add(b.build());
  return group;
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

export function createAvatar({ slot = 0, name = '', host = false, layer = 0 } = {}) {
  const index = Number.isInteger(slot) && slot >= 0 && slot < AVATAR_ROSTER.length ? slot : 0;
  const d = AVATAR_ROSTER[index], root = new THREE.Group();
  root.name = `player_${d.id}`; root.userData.rasterOnly = true;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, flatShading: true });
  const body = torso(material, d), leftLeg = limb(material, d, false, -1), rightLeg = limb(material, d, false, 1);
  const leftArm = limb(material, d, true, -1), rightArm = limb(material, d, true, 1);
  root.add(body, leftLeg, rightLeg, leftArm, rightArm);
  const plate = nameplate();
  if (plate) { root.add(plate.sprite); plate.write(name, host); }
  let gear = null, gearKey = '', gait = 0, disposed = false, motion = 0;
  function setLayer(object) {
    object.traverse(o => { o.layers.set(layer); o.userData.rasterOnly = true; });
  }
  setLayer(root);
  function update({ dt = 0, time = 0, speed = 0, weapon = 'none', aimPitch = 0, held = null, shooting = false, seated = false, seatY = 0.45 } = {}) {
    if (disposed) return;
    const stepDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1), walking = clamp(Number.isFinite(speed) ? speed : 0, 0, 4);
    motion = THREE.MathUtils.damp(motion, walking, 14, stepDt);
    gait += stepDt * (3.5 + motion * 3.5);
    const stride = Math.sin(gait) * Math.min(0.53, motion * 0.2);
    const seatOffset = seated ? clamp(Number.isFinite(seatY) ? seatY : 0.45, 0.2, 1.2) - 0.83 : 0;
    leftLeg.position.y = rightLeg.position.y = 0.83 + seatOffset;
    leftArm.position.y = rightArm.position.y = 1.37 + seatOffset;
    leftLeg.rotation.x = seated ? 0.98 : stride; rightLeg.rotation.x = seated ? 0.98 : -stride;
    const armed = weapon !== 'none' || !!held;
    leftArm.rotation.x = held && String(held).includes('phone') ? 0 : armed ? 1.03 + aimPitch * 0.4 : -stride * 0.65;
    rightArm.rotation.x = armed ? 1.12 + aimPitch * 0.4 : stride * 0.65;
    leftArm.rotation.z = armed && !held ? 0.55 : 0.04; rightArm.rotation.z = -0.04;
    body.position.y = seatOffset + (seated ? 0 : Math.abs(Math.sin(gait * 2)) * Math.min(0.012, motion * 0.004));
    const nextKey = `${weapon}|${held || ''}`;
    if (nextKey !== gearKey) {
      if (gear) { gear.removeFromParent(); gear.traverse(o => o.geometry?.dispose()); }
      gear = equipment(material, weapon, held); gearKey = nextKey;
      gear.userData.baseY = gear.position.y;
      setLayer(gear); root.add(gear);
    }
    if (gear) { gear.position.y = gear.userData.baseY + seatOffset; gear.rotation.x = clamp(aimPitch, -1.2, 1.2) + (shooting ? -0.06 : 0); }
    if (plate) plate.sprite.position.y = 2.08 + seatOffset + Math.sin(time * 1.5) * 0.004;
  }
  return {
    root, height: 1.8, slot: index, definition: d,
    setIdentity({ name: nextName = name, host: nextHost = host } = {}) {
      name = nextName; host = nextHost; plate?.write(name, host);
    },
    update,
    dispose() {
      if (disposed) return;
      disposed = true; root.removeFromParent();
      root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      material.dispose();
      if (plate) { plate.sprite.material.map.dispose(); plate.sprite.material.dispose(); }
    },
  };
}
