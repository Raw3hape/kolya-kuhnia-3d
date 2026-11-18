// Equipment, rider poses and bounded snow effects are drawn from the shared
// simulation. The view never advances rider physics or changes the heightfield.

const COLORS = {
  snow: 0xcadce9, boot: 0x243849, joint: 0x334858, goggles: 0x91d7e6,
  lensEdge: 0x284657, bindings: 0x30414a, steel: 0xb4bec1, wood: 0x987050,
  ski: 0xe85c35, board: 0x205d9b, flag: 0xf7ba53,
  sole: 0x1c2936, bootTrim: 0x4f6271, buckle: 0xbca078,
};
const OUTFITS = [0xde724d, 0x336eaa, 0x477d64, 0x994d7e, 0xb88a30, 0x547396, 0xb25845, 0x508c88];
const GEAR = {
  ski: { length: 1.72, width: 0.108, tips: 0.12, centers: [-0.13, 0.13] },
  board: { length: 1.66, width: 0.31, tips: 0.1, centers: [0] },
};
const RIDER_RANGE = 165;
const TRACK_LIMIT = 400;
const TRACK_LIFETIME = 26;
const TRACK_SPACING = 0.48;
const PARTICLE_COUNT = 280;
const SKI_POSE = { footSpacing: 0.15, face: 0 };
const BOARD_POSE = { footSpacing: 0.31, face: Math.PI / 2 };

export function snowRiderCrouch(rider) {
  return (rider.equipment === 'board' ? 0.18 : 0.12) + Math.min(0.12, rider.speed * 0.0036)
    + (rider.phase === 'air' ? 0.1 : 0.08 * rider.skid);
}

function gearShape(T, { length, width, tips }) {
  const vertices = [], colors = [], indices = [], rows = 29;
  const baseColor = new T.Color(0xffffff), edgeColor = new T.Color(0x586e7b);
  const stripeColor = new T.Color(0xb2d0db);
  const capColor = new T.Color(0x607f94);
  const graphic = position => position < 0.12 || position > 0.9 ? capColor :
    (position > 0.18 && position < 0.25) || (position > 0.70 && position < 0.76) ? stripeColor : baseColor;
  for (let i = 0; i < rows; i++) {
    const along = i / (rows - 1), t = Math.abs(along * 2 - 1);
    const tip = Math.max(0, (t - 0.78) / 0.22);
    const halfWidth = width * (0.41 + 0.18 * t - 0.53 * Math.pow(t, 10));
    const height = tips * tip * tip;
    for (const [x, y, color] of [
      [-halfWidth, height + 0.024, graphic(along)],
      [halfWidth, height + 0.024, graphic(along + 0.024)],
      [-halfWidth, height, edgeColor], [halfWidth, height, edgeColor],
    ]) {
      vertices.push(x, y, (along - 0.5) * length);
      colors.push(color.r, color.g, color.b);
    }
    if (i === rows - 1) continue;
    const a = i * 4, b = a + 4;
    indices.push(
      a, b, a + 1, a + 1, b, b + 1, // top
      a + 2, a + 3, b + 2, a + 3, b + 3, b + 2, // base
      a + 2, b + 2, a, a, b + 2, b, // edge
      a + 1, b + 1, a + 3, a + 3, b + 1, b + 3,
    );
  }
  const end = (rows - 1) * 4;
  indices.push(0, 1, 2, 1, 3, 2, end, end + 2, end + 1, end + 1, end + 2, end + 3);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function contactMaterial(T, own) {
  const size = 32;
  const colors = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const falloff = Math.max(0, 1 - Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2);
    colors.set([255, 255, 255, Math.round(falloff ** 1.5 * 255)], (y * size + x) * 4);
  }
  const map = own(new T.DataTexture(colors, size, size));
  map.minFilter = map.magFilter = T.LinearFilter;
  map.needsUpdate = true;
  return own(new T.MeshBasicMaterial({ color: 0x50657a, map, opacity: 0.43,
    transparent: true, depthWrite: false, alphaTest: 0.014, polygonOffset: true, polygonOffsetFactor: -1 }));
}

function outfit(id) {
  const value = String(id);
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(31, hash) + value.charCodeAt(i)) >>> 0;
  return OUTFITS[hash % OUTFITS.length];
}

function makeEquipmentStation({ T, group, kind, anchor, geometries, materials, world, own }) {
  const rack = new T.Group();
  rack.name = `snow-gear-${kind}`;
  rack.position.set(anchor.x, world.height(anchor.x, anchor.z), anchor.z);
  group.add(rack);
  const mesh = (geometry, material, x, y, z, sx, sy, sz) => {
    const part = new T.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.scale.set(sx, sy, sz);
    rack.add(part);
    return part;
  };
  const { box, tube, shadow } = geometries;
  mesh(shadow, materials.shadow, 0, 0.033, 0, 1.7, 1, 0.92);
  const def = GEAR[kind];
  const paint = own(new T.MeshStandardMaterial({
    color: COLORS[kind], roughness: 0.53, metalness: 0.05, vertexColors: true,
  }));
  for (const x of def.centers) {
    const ski = mesh(geometries[kind], paint, x, def.length / 2 + 0.22, 0, 1, 1, 1);
    ski.rotation.x = Math.PI / 2;
  }
  for (const x of kind === 'ski' ? def.centers : [0]) {
    for (const y of kind === 'ski' ? [0.95, 1.17] : [0.75, 1.36]) {
      mesh(box, materials.bindings, x, y, 0.037, kind === 'ski' ? 0.067 : 0.21, 0.11, 0.072);
      mesh(box, materials.steel, x, y + 0.018, 0.079, kind === 'ski' ? 0.054 : 0.16, 0.017, 0.016);
    }
  }
  mesh(box, materials.wood, 0, 0.115, 0, 1.1, 0.18, 0.54);
  mesh(box, materials.steel, 0, 0.216, 0, 1.12, 0.036, 0.56);
  for (const x of [-0.37, 0.37]) {
    mesh(box, materials.wood, x, 0.62, -0.115, 0.062, 0.86, 0.072);
    mesh(box, materials.bindings, x, 0.047, 0, 0.1, 0.086, 0.63);
  }
  mesh(box, materials.wood, 0, 0.64, -0.11, 0.78, 0.059, 0.065);
  if (kind === 'ski') {
    for (const x of [-0.3, 0.3]) {
      mesh(tube, materials.steel, x, 0.91, 0.07, 0.014, 0.72, 0.014).rotation.z = x;
      mesh(tube, materials.bindings, x - x * 0.33, 1.34, 0.07, 0.026, 0.12, 0.026).rotation.z = x;
      mesh(tube, materials.bindings, x + x * 0.32, 0.48, 0.07, 0.049, 0.015, 0.05);
    }
  }
  const plaque = mesh(box, materials.bindings, 0, 0.131, 0.289, 0.67, 0.096, 0.023);
  const accent = kind === 'ski' ? materials.ski : materials.board;
  mesh(box, accent, plaque.position.x, plaque.position.y, 0.304, 0.5, 0.027, 0.008);
  const ringGeometry = own(new T.RingGeometry(0.49, 0.53, 40).rotateX(-Math.PI / 2));
  const ring = new T.Mesh(ringGeometry, materials.highlight);
  ring.position.y = 0.026;
  ring.visible = false;
  rack.add(ring);
  return ring;
}

function createTracks(T, group, world, maxSpeed, own) {
  const vertices = new Float32Array(TRACK_LIMIT * 12);
  const colors = new Float32Array(TRACK_LIMIT * 16);
  const indexes = new Uint16Array(TRACK_LIMIT * 6);
  const trackTimes = new Float32Array(TRACK_LIMIT).fill(-TRACK_LIFETIME);
  const trackOpacity = new Float32Array(TRACK_LIMIT);
  const tint = new T.Color(0x829ab1);
  const sources = new Map();
  const geometry = own(new T.BufferGeometry());
  const position = new T.BufferAttribute(vertices, 3).setUsage(T.DynamicDrawUsage);
  const color = new T.BufferAttribute(colors, 4).setUsage(T.DynamicDrawUsage);
  for (let index = 0; index < TRACK_LIMIT; index++) {
    const base = index * 4;
    indexes.set([base, base + 1, base + 2, base + 1, base + 3, base + 2], index * 6);
    for (let i = 0; i < 4; i++) colors.set([tint.r, tint.g, tint.b, 0], (base + i) * 4);
  }
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', color);
  geometry.setIndex(new T.BufferAttribute(indexes, 1));
  geometry.setDrawRange(0, 0);
  const material = own(new T.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, alphaTest: 0.012,
  }));
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'snow-track-ribbon';
  mesh.frustumCulled = false;
  group.add(mesh);
  let cursor = 0, used = 0, changed = false, lastFade = -1;

  function segment(ax, az, bx, bz, shift, width, nx, nz, time, opacity) {
    const index = cursor;
    cursor = (cursor + 1) % TRACK_LIMIT;
    used = Math.min(TRACK_LIMIT, used + 1);
    trackTimes[index] = time;
    trackOpacity[index] = opacity;
    const base = index * 12;
    for (let i = 0; i < 4; i++) {
      const side = shift + (i % 2 === 0 ? -width : width);
      const x = (i < 2 ? ax : bx) + nx * side;
      const z = (i < 2 ? az : bz) + nz * side;
      vertices.set([x, world.height(x, z) + 0.031, z], base + i * 3);
    }
    changed = true;
  }

  function mark(rider, time) {
    const { id, x, z, equipment, phase, speed, surface, skid } = rider;
    if (phase !== 'ride' || speed < 1.1 || !equipment) {
      sources.delete(id);
      return;
    }
    let last = sources.get(id);
    if (!last) {
      last = { x, z, seen: time };
      sources.set(id, last);
      return;
    }
    last.seen = time;
    const dx = x - last.x, dz = z - last.z, d = Math.hypot(dx, dz);
    if (d < TRACK_SPACING) return;
    if (d < maxSpeed * 0.19) {
      const nx = -dz / d, nz = dx / d;
      const opacity = surface === 'ice' ? 0.1 : (surface === 'powder' ? 0.22 : 0.18) + skid * 0.11;
      if (equipment === 'ski') {
        segment(last.x, last.z, x, z, -0.13, 0.042, nx, nz, time, opacity);
        segment(last.x, last.z, x, z, 0.13, 0.042, nx, nz, time, opacity);
      } else segment(last.x, last.z, x, z, 0, 0.082 + skid * 0.075, nx, nz, time, opacity);
    }
    last.x = x;
    last.z = z;
  }

  function update(time) {
    if (!changed && time - lastFade < 0.053) return;
    lastFade = time;
    if (changed) {
      position.needsUpdate = true;
      geometry.setDrawRange(0, used * 6);
      changed = false;
    }
    let fading = false;
    for (let i = 0; i < used; i++) {
      const age = time - trackTimes[i];
      const alpha = Math.max(0, Math.min(1, (TRACK_LIFETIME - age) / 6)) * trackOpacity[i];
      if (Math.abs(colors[i * 16 + 3] - alpha) < 0.0001) continue;
      for (let j = 0; j < 4; j++) colors[i * 16 + j * 4 + 3] = alpha;
      fading = true;
    }
    if (fading) color.needsUpdate = true;
    for (const [id, last] of sources) if (time - last.seen > 1) sources.delete(id);
  }
  return { mark, update };
}

function createSpray(T, group, own) {
  const position = new Float32Array(PARTICLE_COUNT * 3);
  const velocity = new Float32Array(PARTICLE_COUNT * 3);
  const color = new Float32Array(PARTICLE_COUNT * 4);
  const life = new Float32Array(PARTICLE_COUNT);
  const geo = own(new T.BufferGeometry());
  const positionBuffer = new T.BufferAttribute(position, 3).setUsage(T.DynamicDrawUsage);
  const colorBuffer = new T.BufferAttribute(color, 4).setUsage(T.DynamicDrawUsage);
  geo.setAttribute('position', positionBuffer);
  geo.setAttribute('color', colorBuffer);
  geo.setDrawRange(0, 0);
  const size = 24, bitmap = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4;
    const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5);
    bitmap.set([255, 255, 255, Math.round(Math.max(0, 1 - r * 2) ** 1.2 * 255)], offset);
  }
  const map = own(new T.DataTexture(bitmap, size, size));
  map.magFilter = map.minFilter = T.LinearFilter;
  map.needsUpdate = true;
  const material = own(new T.PointsMaterial({
    map, vertexColors: true, transparent: true, alphaTest: 0.016,
    depthWrite: false, size: 0.26, sizeAttenuation: true,
  }));
  const cloud = new T.Points(geo, material);
  cloud.name = 'snow-carve-spray';
  cloud.frustumCulled = false;
  group.add(cloud);
  let cursor = 0, used = 0, living = 0, noise = 2954;
  const random = () => {
    noise = (Math.imul(1664525, noise) + 1013904223) >>> 0;
    return noise / 0x100000000;
  };

  function emit(rider, count, effort) {
    const { x, y, z, vx, vz, speed, yaw } = rider;
    if (!(speed > 0)) return;
    for (let i = 0; i < count; i++) {
      const index = cursor;
      cursor = (cursor + 1) % PARTICLE_COUNT;
      used = Math.min(PARTICLE_COUNT, used + 1);
      const t = index * 3, c = index * 4;
      if (!life[index]) living++;
      const lean = (random() - 0.5) * (0.7 + effort * 1.9);
      position.set([x - vx / speed * 0.3 + lean * 0.24, y + 0.10, z - vz / speed * 0.3], t);
      velocity.set([
        vx * 0.36 - Math.abs(lean) * Math.sin(yaw) + lean * Math.cos(yaw) * 2.1,
        0.45 + random() * (1 + effort * 3),
        vz * 0.36 - Math.abs(lean) * Math.cos(yaw) - lean * Math.sin(yaw) * 2.1,
      ], t);
      life[index] = 0.24 + random() * 0.47;
      color.set([0.81, 0.91, 1, 0.65], c);
    }
  }

  function update(dt) {
    if (!living) return;
    for (let i = 0; i < used; i++) {
      const lifeLeft = life[i];
      if (lifeLeft <= 0) continue;
      life[i] = Math.max(0, lifeLeft - dt);
      if (!life[i]) living--;
      const t = i * 3;
      position[t] += velocity[t] * dt;
      position[t + 1] += velocity[t + 1] * dt;
      position[t + 2] += velocity[t + 2] * dt;
      velocity[t + 1] -= 6.5 * dt;
      color[i * 4 + 3] = Math.min(0.82, life[i] * 1.45);
    }
    geo.setDrawRange(0, living ? used : 0);
    positionBuffer.needsUpdate = colorBuffer.needsUpdate = true;
  }
  return { emit, update };
}

export function createSnowActors({ THREE: T, scene, world, config }) {
  const group = new T.Group();
  group.name = 'snow-actors';
  scene.add(group);
  const disposables = new Set();
  const own = (resource) => { disposables.add(resource); return resource; };
  const gearNodes = new Map(), riders = new Map();
  const geometries = {
    box: own(new T.BoxGeometry(1, 1, 1)),
    body: own(new T.SphereGeometry(1, 10, 7)),
    tube: own(new T.CylinderGeometry(1, 1, 1, 8)),
    shadow: own(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
    ski: own(gearShape(T, GEAR.ski)),
    board: own(gearShape(T, GEAR.board)),
  };
  const materials = Object.fromEntries(['wood', 'steel', 'bindings', 'ski', 'board'].map(key =>
    [key, own(new T.MeshStandardMaterial({ color: COLORS[key], roughness: key === 'steel' ? 0.48 : 0.84 }))]));
  materials.shadow = contactMaterial(T, own);
  materials.highlight = own(new T.MeshBasicMaterial({ color: COLORS.flag, side: T.DoubleSide }));
  const bodyMaterial = own(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }));
  const gearMaterial = own(new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, vertexColors: true }));
  const capacities = { box: 12, body: 21, tube: 2, ski: 2, board: 1, shadow: 1 };
  const batches = {};
  for (const [key, perRider] of Object.entries(capacities)) {
    const material = key === 'shadow' ? materials.shadow : key === 'ski' || key === 'board' ? gearMaterial : bodyMaterial;
    const batch = new T.InstancedMesh(geometries[key], material, config.simulation.maxPlayers * perRider);
    batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
    batch.name = `snow-rider-${key}`;
    batch.count = 0;
    batch.frustumCulled = false;
    batches[key] = batch;
    group.add(batch);
  }
  for (const [kind, offset] of Object.entries(config.station.options)) {
    const anchor = { x: world.start.x + offset.x, z: world.start.z + offset.z };
    const ring = makeEquipmentStation({ T, group, kind, anchor, geometries, materials, world, own });
    gearNodes.set(kind, { anchor, ring });
  }
  const tracks = createTracks(T, group, world, config.motion.maxSpeed, own);
  const spray = createSpray(T, group, own);
  const sample = {}, dummy = new T.Object3D(), root = new T.Object3D();
  const kitRotation = new T.Quaternion();
  const frameBody = new T.Matrix4(), slopeFrame = new T.Matrix4();
  const groundOrigin = new T.Vector3(), groundRotation = new T.Quaternion();
  const scale = new T.Vector3(1, 1, 1);
  const rotation = new T.Quaternion();
  const align = new T.Matrix4();
  const right = new T.Vector3(), up = new T.Vector3(), back = new T.Vector3();
  const segmentDirection = new T.Vector3(), yAxis = new T.Vector3(0, 1, 0), yTurn = new T.Quaternion();
  const color = new T.Color(), angles = new T.Euler(0, 0, 0, 'YXZ');
  let age = 0, localGear = null;

  function append(kind, tone, orientation) {
    const mesh = batches[kind];
    const slot = mesh.count;
    if (slot >= mesh.instanceMatrix.count) return;
    dummy.updateMatrix();
    align.multiplyMatrices(orientation, dummy.matrix);
    mesh.setMatrixAt(slot, align);
    mesh.setColorAt(slot, color.setHex(tone));
    mesh.count++;
  }

  function part(kind, tone, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, orientation = frameBody) {
    dummy.position.set(x, y, z);
    dummy.quaternion.setFromEuler(angles.set(rx, ry, rz));
    dummy.scale.set(sx, sy, sz);
    append(kind, tone, orientation);
  }

  function limb(tone, ax, ay, az, bx, by, bz, width) {
    segmentDirection.set(bx - ax, by - ay, bz - az);
    const length = segmentDirection.length();
    if (length < 0.001) return;
    dummy.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    dummy.quaternion.setFromUnitVectors(yAxis, segmentDirection.multiplyScalar(1 / length));
    dummy.scale.set(width, length * 0.68, width * 0.95);
    append('body', tone, frameBody);
  }

  function boardAlignment(rider) {
    const { x, y, z, yaw, phase, flip } = rider;
    root.position.set(x, y + 0.035, z);
    const terrain = world.sample(x, z, sample);
    up.set(-terrain.dx, 1, -terrain.dz).normalize();
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    back.set(sin, terrain.dx * sin + terrain.dz * cos, cos).normalize();
    right.crossVectors(up, back).normalize();
    groundRotation.setFromRotationMatrix(slopeFrame.makeBasis(right, up, back));
    groundOrigin.set(x, terrain.height + 0.038, z);
    slopeFrame.compose(groundOrigin, groundRotation, scale);
    const arc = Math.min(0.55, Math.max(0, (y - terrain.height) * 0.12));
    part('shadow', 0xffffff, 0, 0, 0, 0.94 - arc, 1, 1.60 - arc, 0, 0, 0, slopeFrame);
    if (phase === 'air') kitRotation.setFromEuler(angles.set(rider.pitch + flip, yaw, -0.36 * rider.lean));
    else kitRotation.copy(groundRotation);
    root.quaternion.copy(kitRotation);
    root.updateMatrix();
  }

  function pose(rider, stride, firstPerson) {
    const { equipment, phase, speed, lean } = rider;
    const board = equipment === 'board', ride = equipment && phase !== 'walk';
    const crashed = phase === 'crashed';
    const garment = outfit(rider.id);
    boardAlignment(rider);
    if (ride) {
      if (firstPerson) localGear = equipment;
      for (const center of GEAR[equipment].centers) {
        part(equipment, COLORS[equipment], center, 0, 0, 1, 1, 1, 0, 0, 0, root.matrix);
      }
      for (const offset of board ? [-0.31, 0.31] : [-0.13, 0.13]) {
        part('box', COLORS.bindings, board ? 0 : offset, 0.048, board ? offset : 0,
          board ? 0.245 : 0.084, 0.045, board ? 0.15 : 0.22, 0, 0, 0, root.matrix);
      }
    }
    const rig = board ? BOARD_POSE : SKI_POSE;
    rotation.copy(kitRotation).multiply(yTurn.setFromAxisAngle(yAxis, rig.face));
    if (crashed) rotation.multiply(yTurn.setFromEuler(angles.set(0.05, -0.32, -1.38)));
    frameBody.compose(root.position, rotation, scale);
    const stance = ride ? rig.footSpacing : 0.16;
    const crouch = ride ? snowRiderCrouch(rider) : 0;
    const hipsY = 0.77 - crouch;
    const centerX = ride ? lean * (board ? 0.085 : 0.18) : 0;
    const spineZ = ride ? -0.10 - crouch * 0.4 : 0;
    const collarY = hipsY + 0.47;
    const shoulderX = centerX + lean * 0.07;
    for (const side of [-1, 1]) {
      const step = ride ? 0 : Math.sin(stride) * side * Math.min(0.22, speed * 0.12);
      const bootX = stance * side;
      const ankleY = (ride ? 0.137 : 0.16) + Math.max(0, step) * 0.45;
      const kneeY = ankleY + (hipsY - ankleY) * 0.52, kneeZ = step * 0.45 - 0.16 - crouch * 0.23;
      const hipX = centerX + side * 0.132;
      const kneeX = (bootX + hipX) * 0.5;
      const elbowX = shoulderX + side * (ride ? 0.31 + 0.13 * Math.abs(lean) : 0.31);
      const gloveX = elbowX + side * (board && ride ? 0.17 : 0.024);
      const gloveY = collarY - (board && ride ? 0.18 : 0.42) + Math.abs(lean) * 0.05 - (firstPerson && board ? 0.15 : 0);
      const gloveZ = spineZ + step * 0.65 - (firstPerson && board ? 0.29 : ride ? 0.17 : 0.02);
      limb(COLORS.joint, hipX, hipsY, spineZ, kneeX, kneeY, kneeZ, 0.117);
      limb(COLORS.boot, kneeX, kneeY, kneeZ, bootX, ankleY, step, 0.103);
      const bootTurn = side * 0.21;
      if (firstPerson) {
        part('box', COLORS.sole, bootX, ankleY - 0.092, step - 0.05, 0.151, 0.043, 0.28, 0, bootTurn);
        part('body', COLORS.boot, bootX, ankleY - 0.029, step - 0.059, 0.077, 0.067, 0.147, 0, bootTurn);
        part('box', COLORS.bootTrim, bootX + side * 0.012, ankleY + 0.025, step - 0.094, 0.127, 0.024, 0.049, 0, bootTurn);
        part('box', COLORS.buckle, bootX + side * 0.055, ankleY + 0.038, step - 0.088, 0.025, 0.013, 0.032, 0, bootTurn);
      } else part('box', COLORS.boot, bootX, ankleY - 0.042, step - 0.05, 0.146, 0.137, 0.29, 0, bootTurn);
      const sleeveY = collarY - (firstPerson ? 0.27 : 0.07);
      const elbowY = collarY - (firstPerson && board ? 0.34 : 0.2);
      const elbowZ = spineZ + step * 0.25 - (firstPerson && board ? 0.09 : 0);
      limb(garment, shoulderX + side * 0.19, sleeveY, spineZ,
        elbowX, elbowY, elbowZ, firstPerson ? 0.070 : 0.103);
      limb(garment, elbowX, elbowY, elbowZ, gloveX, gloveY, gloveZ, firstPerson ? 0.061 : 0.089);
      part('body', COLORS.boot, gloveX, gloveY, gloveZ, firstPerson ? 0.061 : 0.076, 0.059, 0.071);
      if (firstPerson) part('body', COLORS.bootTrim, gloveX - side * 0.047, gloveY + 0.012, gloveZ - 0.028, 0.035, 0.028, 0.047);
      if (ride && !board && !crashed) {
        const poleAngle = side * 0.18;
        part('tube', COLORS.steel, gloveX + side * 0.078, gloveY - 0.4, gloveZ + 0.20,
          0.01, 0.94, 0.01, -0.44, 0, poleAngle);
        part('body', COLORS.bindings, gloveX + side * 0.145, gloveY - 0.805, gloveZ + 0.389,
          0.048, 0.015, 0.046);
      }
    }
    // Through the rider's eyes the limbs and equipment share the terrain
    // transform. Full torso, pack, and helmet stay in the observer view.
    if (firstPerson) return;
    part('body', garment, centerX, hipsY + 0.21, spineZ, 0.249, 0.323, 0.155, 0.13 + crouch * 0.6, 0, -lean * 0.2);
    part('body', COLORS.joint, shoulderX, hipsY + 0.26, spineZ + 0.136, 0.177, 0.246, 0.12,
      0.09, 0, -lean * 0.15);
    part('box', COLORS.steel, shoulderX, hipsY + 0.19, spineZ + 0.245, 0.073, 0.012, 0.012);
    const headTurn = board && ride ? -0.61 : -lean * 0.29;
    const headY = collarY + 0.15, headZ = spineZ - 0.048;
    part('body', COLORS.boot, shoulderX, headY, headZ, 0.155, 0.168, 0.149);
    part('body', garment, shoulderX, headY + 0.047, headZ + 0.025, 0.146, 0.091, 0.137);
    const lensX = shoulderX - Math.sin(headTurn) * 0.123;
    const lensZ = headZ - Math.cos(headTurn) * 0.123;
    part('body', COLORS.lensEdge, lensX, headY + 0.008, lensZ, 0.130, 0.059, 0.055, 0, headTurn);
    part('body', COLORS.goggles, lensX - Math.sin(headTurn) * 0.032, headY + 0.012,
      lensZ - Math.cos(headTurn) * 0.032, 0.108, 0.039, 0.028, 0, headTurn);
  }

  function update(snapshot, { playerId, dt = 0, nearGear } = {}) {
    dt = Math.min(0.075, Math.max(0, dt));
    age += dt;
    localGear = null;
    const players = snapshot?.players ?? [];
    const local = players.find(player => player.id === playerId);
    for (const [kind, { anchor, ring }] of gearNodes) {
      ring.parent.visible = !local || Math.hypot(local.x - anchor.x, local.z - anchor.z) < 65;
      ring.visible = kind === nearGear;
    }
    for (const batch of Object.values(batches)) batch.count = 0;
    for (const rider of players) {
      if (local && Math.hypot(rider.x - local.x, rider.z - local.z) > RIDER_RANGE) continue;
      const firstPerson = rider.id === playerId;
      if (firstPerson && rider.phase === 'walk') continue;
      let animated = riders.get(rider.id);
      if (!animated) {
        animated = { stride: 0, spray: 0, seen: age };
        riders.set(rider.id, animated);
      }
      animated.seen = age;
      animated.stride += dt * Math.min(12, rider.speed * 7);
      pose(rider, animated.stride, firstPerson);
      tracks.mark(rider, age);
      if (rider.phase === 'ride') {
        const effort = Math.min(1, Math.max(rider.skid, Math.abs(rider.lean) * 0.34));
        const flakes = rider.surface === 'powder' ? 1.4 : rider.surface === 'ice' ? 0.32 : 1;
        animated.spray += dt * Math.min(55, rider.speed * flakes * (0.12 + effort * 2.4));
        const count = Math.floor(animated.spray);
        if (count) { spray.emit(rider, count, effort); animated.spray -= count; }
      }
    }
    for (const [id, state] of riders) if (age - state.seen > 2) riders.delete(id);
    for (const batch of Object.values(batches)) {
      if (!batch.count) continue;
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    }
    tracks.update(age);
    spray.update(dt);
  }

  function dispose() {
    group.removeFromParent();
    for (const batch of Object.values(batches)) batch.dispose();
    for (const resource of disposables) resource.dispose();
    disposables.clear();
    riders.clear();
  }

  return { update, dispose, get localGear() { return localGear; } };
}
