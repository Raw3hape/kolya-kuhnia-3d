// Render-only office machinery and maintenance crews. Each articulated part is a
// vertex-colored instanced batch, so a large wave does not add one draw per enemy.
import * as Three from 'three';

const VIEW_RANGE = 34;
const ACTOR_LIMIT = 48;
const FX_LIMIT = 28;
const TRACE_AGE = 0.13;
const SPARK_AGE = 0.26;
const PAPER = '#e1d8b5';
const INK = '#242729';
const SCUFF = '#777267';
const ALLOY = '#8e9183';
const WARNING = '#dcaa58';
const RED = '#b35537';
const LIME = '#daffae';
const CYAN = '#90ddd3';

function partList() {
  const parts = [];
  const add = (kind) => (color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) =>
    parts.push({ kind, color, position: [x, y, z], size: [sx, sy, sz], angles: [rx, ry, rz] });
  return { parts, box: add('box'), chamfer: add('chamfer'), ball: add('ball'), tube: add('tube'), ring: add('ring') };
}

function paintLabel(draw, x, y, z, width, kind) {
  draw.box(PAPER, x, y, z, width, 0.068, 0.009);
  draw.box(RED, x - width * 0.31, y, z - 0.006, width * 0.16, 0.04, 0.004);
  for (let j = 0; j < kind; j++) {
    draw.box(INK, x + (j - 1) * width * 0.14, y + 0.007, z - 0.006, width * 0.08, 0.027, 0.004);
  }
}

function stamper() {
  const shoe = partList(), shell = partList();
  shoe.chamfer(INK, 0, 0.06, 0.01, 0.65, 0.14, 0.54);
  shoe.chamfer(WARNING, 0, 0.12, -0.01, 0.54, 0.09, 0.46);
  shoe.chamfer('#622f26', 0, 0.134, -0.02, 0.43, 0.027, 0.35);
  shell.chamfer(RED, 0, 0.36, 0.02, 0.91, 0.42, 0.71);
  shell.chamfer('#773b2b', 0, 0.42, 0.037, 0.89, 0.16, 0.69);
  shell.chamfer(INK, 0, 0.43, -0.32, 0.63, 0.14, 0.045);
  shell.chamfer(LIME, -0.125, 0.433, -0.35, 0.14, 0.043, 0.026);
  shell.chamfer(LIME, 0.125, 0.433, -0.35, 0.14, 0.043, 0.026);
  shell.tube(ALLOY, 0, 0.59, 0.02, 0.13, 0.26, 0.13);
  shell.chamfer(RED, 0, 0.75, 0.03, 0.53, 0.13, 0.29);
  shell.chamfer('#e99b60', 0, 0.822, 0.03, 0.41, 0.018, 0.17);
  paintLabel(shell, 0.2, 0.28, -0.339, 0.24, 2);
  for (const x of [-0.32, 0.32]) {
    shell.tube(SCUFF, x, 0.194, 0.13, 0.08, 0.3, 0.08);
    shell.tube(ALLOY, x, 0.284, -0.13, 0.1, 0.25, 0.1);
    shell.ring(INK, x, 0.244, -0.13, 0.1, 0.1, 0.1, Math.PI / 2);
  }
  return [shoe.parts, shell.parts];
}

function printer() {
  const base = partList(), tray = partList();
  for (const x of [-0.37, 0.37]) {
    base.chamfer(INK, x, 0.1, 0, 0.17, 0.21, 0.83);
    base.chamfer(ALLOY, x, 0.12, -0.15, 0.182, 0.095, 0.39);
  }
  base.chamfer('#c1c0ab', 0, 0.49, 0.013, 1.07, 0.68, 0.84);
  base.chamfer('#989b90', 0, 0.749, -0.02, 1.01, 0.19, 0.87);
  base.chamfer('#dcd8bd', 0, 0.773, -0.014, 0.94, 0.095, 0.82);
  base.chamfer(INK, 0, 0.475, -0.42, 0.78, 0.21, 0.029);
  base.box('#595b55', 0, 0.286, -0.412, 0.85, 0.014, 0.014);
  base.chamfer(INK, 0.22, 0.66, -0.432, 0.32, 0.122, 0.024);
  base.chamfer(CYAN, 0.17, 0.66, -0.45, 0.153, 0.044, 0.008);
  base.chamfer(RED, 0.326, 0.66, -0.45, 0.052, 0.045, 0.009);
  paintLabel(base, -0.28, 0.665, -0.439, 0.26, 3);
  for (const x of [-0.34, -0.23, -0.12, -0.01, 0.1, 0.21, 0.32]) {
    base.box(SCUFF, x, 0.83, -0.12, 0.023, 0.008, 0.27);
  }
  tray.chamfer('#797663', 0, 0.405, -0.452, 0.68, 0.055, 0.32, 0.14);
  tray.box(PAPER, -0.06, 0.447, -0.438, 0.47, 0.018, 0.42, 0.18);
  tray.box(PAPER, -0.02, 0.475, -0.64, 0.46, 0.018, 0.15, 0.59);
  for (const x of [-0.17, -0.09, -0.01, 0.07]) {
    tray.box(RED, x, 0.484, -0.658, 0.029, 0.014, 0.064, 0.59);
  }
  return [base.parts, tray.parts];
}

function cabinet() {
  const body = partList(), drawer = partList();
  body.chamfer('#5b6e62', 0, 0.854, 0.003, 0.91, 1.33, 0.67);
  body.chamfer('#9a9d82', 0, 1.52, 0.004, 0.99, 0.096, 0.75);
  body.chamfer('#3e4e47', 0, 0.865, -0.335, 0.813, 1.25, 0.05);
  for (const x of [-0.35, 0.35]) for (const z of [-0.25, 0.25]) {
    body.tube(INK, x, 0.102, z, 0.12, 0.105, 0.12, Math.PI / 2);
    body.tube(ALLOY, x, 0.112, z - 0.015, 0.057, 0.12, 0.057, Math.PI / 2);
    body.chamfer(ALLOY, x, 0.172, z, 0.115, 0.136, 0.12);
  }
  for (const y of [0.37, 0.66, 0.95]) {
    body.chamfer('#879079', 0, y, -0.366, 0.778, 0.266, 0.055);
    body.chamfer('#524b3e', -0.11, y + 0.041, -0.405, 0.2, 0.102, 0.027);
    paintLabel(body, -0.11, y + 0.041, -0.425, 0.169, 2);
    body.chamfer(INK, 0.137, y + 0.018, -0.406, 0.217, 0.072, 0.029);
    body.chamfer(ALLOY, 0.137, y + 0.04, -0.427, 0.237, 0.028, 0.03);
  }
  drawer.chamfer('#9ba085', 0, 1.277, -0.393, 0.816, 0.316, 0.131);
  drawer.chamfer(INK, 0, 1.298, -0.469, 0.71, 0.13, 0.024);
  drawer.chamfer(WARNING, -0.176, 1.3, -0.487, 0.145, 0.037, 0.025, 0, 0, -0.25);
  drawer.chamfer(WARNING, 0.176, 1.3, -0.487, 0.145, 0.037, 0.025, 0, 0, 0.25);
  drawer.chamfer('#ae5940', 0, 1.182, -0.475, 0.285, 0.05, 0.019);
  return [body.parts, drawer.parts];
}

function teammate() {
  const torso = partList(), leg = partList(), beacon = partList();
  torso.chamfer('#c6bfa4', 0, 1.157, 0.025, 0.46, 0.57, 0.29);
  torso.chamfer('#727a65', 0, 1.17, 0.181, 0.36, 0.428, 0.19);
  torso.box(LIME, 0, 1.118, 0.281, 0.29, 0.074, 0.02);
  torso.chamfer(INK, 0, 0.948, 0, 0.47, 0.13, 0.31);
  torso.ball('#c4b78a', 0, 1.586, 0, 0.209, 0.204, 0.197);
  torso.chamfer('#63634f', 0, 1.545, -0.038, 0.428, 0.095, 0.356);
  torso.chamfer('#293b38', 0, 1.49, -0.102, 0.343, 0.141, 0.228);
  torso.chamfer(CYAN, 0, 1.519, -0.202, 0.232, 0.036, 0.023);
  for (const x of [-0.24, 0.24]) {
    torso.chamfer(ALLOY, x, 1.249, 0.005, 0.164, 0.28, 0.22, 0.35, 0, -x);
    torso.chamfer('#c6bfa4', x * 0.91, 1.094, -0.17, 0.147, 0.142, 0.353, -0.11, x * 1.1);
    torso.chamfer(INK, x * 0.71, 1.118, -0.336, 0.108, 0.115, 0.146);
  }
  torso.chamfer(RED, 0, 1.154, -0.425, 0.331, 0.27, 0.26);
  torso.chamfer(LIME, 0, 1.155, -0.565, 0.222, 0.096, 0.025);
  leg.chamfer(ALLOY, 0, -0.39, 0.004, 0.193, 0.795, 0.234);
  leg.chamfer('#52574a', 0, -0.51, -0.046, 0.173, 0.24, 0.221);
  leg.chamfer('#383b2e', 0, -0.791, -0.06, 0.203, 0.21, 0.348);
  beacon.chamfer('#293b38', 0, 0, 0, 0.29, 0.29, 0.022);
  beacon.box(CYAN, 0, 0, -0.017, 0.16, 0.044, 0.007);
  beacon.box(CYAN, 0, 0, -0.017, 0.044, 0.16, 0.007);
  return [torso.parts, leg.parts, beacon.parts];
}

function scanner() {
  const handle = partList(), bulb = partList();
  handle.chamfer('#675e4c', 0.107, -0.18, 0.148, 0.159, 0.144, 0.48, -0.32, 0.12, 0.26);
  handle.chamfer('#555443', 0.067, -0.108, 0.063, 0.163, 0.16, 0.174, -0.09, 0.05, 0.27);
  handle.chamfer(INK, 0, -0.044, 0.025, 0.235, 0.155, 0.262);
  for (const x of [-0.08, -0.037, 0.003]) {
    handle.chamfer('#77755b', x, -0.094, 0.015, 0.024, 0.048, 0.193, 0, x * 1.7);
  }
  handle.chamfer('#ac6542', 0, 0.014, -0.013, 0.272, 0.174, 0.316);
  handle.chamfer('#d79e64', 0, 0.062, 0.014, 0.273, 0.09, 0.247);
  handle.chamfer('#191f1d', 0, 0.079, 0.095, 0.194, 0.06, 0.144, 0.25);
  handle.chamfer(CYAN, 0, 0.098, 0.118, 0.135, 0.032, 0.088, 0.25);
  for (const x of [-0.082, 0.082]) {
    handle.chamfer(INK, x, 0.106, -0.01, 0.041, 0.024, 0.047);
    handle.chamfer(WARNING, x, 0.112, -0.01, 0.023, 0.013, 0.027);
  }
  handle.ring(INK, 0, 0.031, -0.177, 0.118, 0.089, 0.091);
  handle.ring(ALLOY, 0, 0.032, -0.19, 0.101, 0.077, 0.055);
  handle.ring('#655d41', 0, 0.032, -0.19, 0.069, 0.053, 0.047);
  bulb.ring(LIME, 0, 0.034, -0.201, 0.048, 0.035, 0.039);
  bulb.chamfer(CYAN, -0.039, 0.116, 0.096, 0.018, 0.017, 0.055, 0.2);
  return [handle.parts, bulb.parts];
}

function makeGeometries(T, own) {
  // The rounded case uses real shallow bevels, with normals calculated once.
  const shape = new T.Shape();
  shape.moveTo(-0.43, -0.43);
  shape.lineTo(0.43, -0.43);
  shape.lineTo(0.43, 0.43);
  shape.lineTo(-0.43, 0.43);
  shape.closePath();
  const chamfer = new T.ExtrudeGeometry(shape, { depth: 0.86, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.07, bevelThickness: 0.07, steps: 1 });
  chamfer.translate(0, 0, -0.43);
  const raw = {
    box: new T.BoxGeometry(),
    chamfer,
    ball: new T.IcosahedronGeometry(1, 2),
    tube: new T.CylinderGeometry(1, 1, 1, 10),
    ring: new T.TorusGeometry(0.77, 0.23, 7, 24),
  };
  const primitives = {};
  for (const [key, geometry] of Object.entries(raw)) {
    primitives[key] = geometry.index ? geometry.toNonIndexed() : geometry;
    if (geometry.index) geometry.dispose();
  }
  const position = new T.Vector3(), normal = new T.Vector3(), scale = new T.Vector3();
  const angles = new T.Euler(), quaternion = new T.Quaternion(), color = new T.Color();
  const matrix = new T.Matrix4(), normalMatrix = new T.Matrix3(), origin = new T.Vector3();
  function compose(parts) {
    const floats = parts.reduce((n, part) => n + primitives[part.kind].attributes.position.count * 3, 0);
    const positions = new Float32Array(floats), normals = new Float32Array(floats), colors = new Float32Array(floats);
    let offset = 0;
    for (const part of parts) {
      const attrs = primitives[part.kind].attributes;
      matrix.compose(origin.fromArray(part.position), quaternion.setFromEuler(angles.fromArray(part.angles)), scale.fromArray(part.size));
      normalMatrix.getNormalMatrix(matrix);
      color.set(part.color);
      for (let i = 0; i < attrs.position.count; i++, offset += 3) {
        position.fromBufferAttribute(attrs.position, i).applyMatrix4(matrix).toArray(positions, offset);
        normal.fromBufferAttribute(attrs.normal, i).applyNormalMatrix(normalMatrix).toArray(normals, offset);
        color.toArray(colors, offset);
      }
    }
    const geometry = own(new T.BufferGeometry());
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    return geometry;
  }
  const rigs = { stamper: stamper().map(compose), printer: printer().map(compose), cabinet: cabinet().map(compose), player: teammate().map(compose), tool: scanner().map(compose) };
  for (const geometry of Object.values(primitives)) geometry.dispose();
  return rigs;
}

function hashActor(id) {
  let hash = 0;
  for (const c of String(id)) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash;
}

function createAudio() {
  let context, output, active = 0;
  async function resume() {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return;
    try {
      if (!context) {
        context = new Audio();
        output = context.createGain();
        output.gain.value = 0.2;
        output.connect(context.destination);
      }
      if (context.state !== 'running') await context.resume();
    } catch { /* silent playback when the browser denies sound */ }
  }
  function tone({ type = 'sine', from, to, duration, volume }) {
    if (context?.state !== 'running' || active >= 9) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator(), envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    envelope.gain.setValueAtTime(Math.max(0.0002, volume), now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope).connect(output);
    oscillator.start(now);
    oscillator.stop(now + duration);
    active++;
    oscillator.onended = () => { active--; oscillator.disconnect(); envelope.disconnect(); };
  }
  function dispose() {
    if (context && context.state !== 'closed') context.close().catch(() => {});
    context = null;
    output = null;
  }
  return { resume, tone, dispose };
}

export function createServiceLevelActors({ THREE: T = Three, scene, camera }) {
  const root = new T.Group();
  root.name = 'service-level actors';
  scene.add(root);
  const ownsCamera = !camera.parent;
  if (ownsCamera) scene.add(camera);
  const resources = [], batches = [];
  const own = resource => { resources.push(resource); return resource; };
  const rigs = makeGeometries(T, own);
  const material = own(new T.MeshLambertMaterial({ vertexColors: true, emissive: '#797760', emissiveIntensity: 0.17 }));
  const toolMaterial = own(new T.MeshLambertMaterial({ vertexColors: true, emissive: '#a6957d', emissiveIntensity: 0.23, fog: false, transparent: true }));
  const toolLight = own(new T.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true }));
  const traceMaterial = own(new T.MeshBasicMaterial({ toneMapped: false, fog: true }));
  const dummy = new T.Object3D(), tint = new T.Color(), direction = new T.Vector3(), head = new T.Vector3(), tail = new T.Vector3();
  const axisY = new T.Vector3(0, 1, 0);
  const audio = createAudio();
  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const tintNormal = new T.Color(0xffffff), tintHit = new T.Color('#ff7459');
  const tintAttack = new T.Color('#ffd589'), tintDown = new T.Color('#a5b4b1');
  const traceColors = { friendly: new T.Color('#c6fff1'), enemy: new T.Color('#ff9763'), stamp: new T.Color('#ffdb66') };
  function batch(geometry, mat, size) {
    const mesh = own(new T.InstancedMesh(geometry, mat, size));
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    root.add(mesh);
    batches.push(mesh);
    return mesh;
  }
  const enemyBatches = {
    stamper: rigs.stamper.map(geo => batch(geo, material, ACTOR_LIMIT)),
    printer: rigs.printer.map(geo => batch(geo, material, ACTOR_LIMIT)),
    cabinet: rigs.cabinet.map(geo => batch(geo, material, ACTOR_LIMIT)),
  };
  const teammateBatches = [0, 1, 1, 2].map(index => batch(rigs.player[index], material, ACTOR_LIMIT));
  const traceGeometry = own(new T.CylinderGeometry(1, 1, 1, 6, 1, true));
  const sparkGeometry = own(new T.OctahedronGeometry(1));
  const traceBatch = batch(traceGeometry, traceMaterial, FX_LIMIT);
  const sparkBatch = batch(sparkGeometry, traceMaterial, FX_LIMIT * 4);
  const tool = new T.Group();
  tool.name = 'fault scanner';
  camera.add(tool);
  const toolCase = new T.Mesh(rigs.tool[0], toolMaterial), toolRing = new T.Mesh(rigs.tool[1], toolLight);
  // Draw the handheld shell after scenery and transparent contact shadows.
  // A fresh depth buffer prevents wall clipping and still occludes the shell's own parts.
  toolCase.renderOrder = 100;
  toolCase.onBeforeRender = renderer => {
    renderer.state.buffers.depth.setMask(true);
    renderer.clearDepth();
  };
  toolRing.renderOrder = 101;
  tool.add(toolCase, toolRing);

  const resolution = 32, contact = new Uint8Array(resolution * resolution * 4);
  for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const offset = (y * resolution + x) * 4;
    const radius = Math.hypot((x + 0.5) / resolution - 0.5, (y + 0.5) / resolution - 0.5) * 2;
    contact[offset] = contact[offset + 1] = contact[offset + 2] = 255;
    contact[offset + 3] = Math.round(150 * Math.max(0, 1 - radius * radius) ** 2);
  }
  const shadowMap = own(new T.DataTexture(contact, resolution, resolution));
  shadowMap.magFilter = T.LinearFilter;
  shadowMap.minFilter = T.LinearFilter;
  shadowMap.needsUpdate = true;
  const shadowMat = own(new T.MeshBasicMaterial({ color: 0x3a2a23, map: shadowMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  const shadowGeo = own(new T.PlaneGeometry(2, 2));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadows = batch(shadowGeo, shadowMat, ACTOR_LIMIT);

  function transform(mesh, x, y, z, yaw, sx, sy, sz, color, tilt = 0) {
    if (mesh.count >= mesh.instanceMatrix.count) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set(tilt, yaw, 0, 'YXZ');
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(mesh.count, dummy.matrix);
    if (color) mesh.setColorAt(mesh.count, color);
    mesh.count++;
  }

  let time = 0, shotAt = -1, lastTick = -1, lastSeed, lastEvent = -1;
  let lastPosition, moving = 0;
  const caches = new Map(), flashes = new Map(), traces = [], sparks = [];
  function rigPose(entity, dt, maxSpeed) {
    let state = caches.get(entity.id);
    if (!state || Math.hypot(state.x - entity.x, state.z - entity.z) > 4) {
      state = { x: entity.x, z: entity.z, yaw: entity.yaw, lastX: entity.x, lastZ: entity.z, step: hashActor(entity.id) * 0.05, motion: 0, stride: 0, seen: time };
      caches.set(entity.id, state);
    }
    const blend = 1 - Math.exp(-18 * dt);
    const distance = Math.hypot(state.x - entity.x, state.z - entity.z);
    state.x += (entity.x - state.x) * blend;
    state.z += (entity.z - state.z) * blend;
    state.yaw += Math.atan2(Math.sin(entity.yaw - state.yaw), Math.cos(entity.yaw - state.yaw)) * blend;
    const stepDistance = Math.hypot(state.x - state.lastX, state.z - state.lastZ);
    state.motion += (Math.min(stepDistance / Math.max(dt, 0.001), maxSpeed) - state.motion) * blend;
    state.stride += (state.motion / maxSpeed - state.stride) * blend;
    state.step += distance > 0.0005 ? stepDistance * 9 : 0;
    state.lastX = state.x;
    state.lastZ = state.z;
    state.seen = time;
    return state;
  }

  function emit(list, obj) {
    if (list.length >= FX_LIMIT) list.shift();
    list.push(obj);
  }

  function eventAudio(event, localId) {
    if (event.type === 'shot') {
      const local = event.playerId === localId;
      const distance = Math.hypot(event.x - camera.position.x, event.z - camera.position.z);
      const volume = local ? 0.25 : 0.13 * Math.max(0, 1 - distance / 16);
      if (volume > 0) audio.tone({ type: 'triangle', from: 710, to: 155, duration: 0.096, volume });
    } else if (event.type === 'hit' && event.playerId === localId) {
      audio.tone({ type: 'sine', from: 230, to: 92, duration: 0.11, volume: 0.16 });
    } else if (event.type === 'hurt' && event.playerId === localId) {
      audio.tone({ type: 'triangle', from: 150, to: 54, duration: 0.32, volume: 0.2 });
    } else if (event.type === 'reload' && event.playerId === localId) {
      audio.tone({ type: 'sine', from: 350, to: 805, duration: 0.19, volume: 0.11 });
    }
  }

  function ingest(snapshot, localId) {
    if (lastSeed !== snapshot.seed || snapshot.tick < lastTick) {
      caches.clear();
      traces.length = sparks.length = 0;
      flashes.clear();
      lastSeed = snapshot.seed;
      lastEvent = -1;
    }
    lastTick = snapshot.tick;
    for (const event of snapshot.events ?? []) {
      if (event.id <= lastEvent) continue;
      lastEvent = Math.max(lastEvent, event.id);
      eventAudio(event, localId);
      if (event.type === 'shot' || event.type === 'enemyAttack') {
        const local = event.type === 'shot' && event.playerId === localId;
        if (local) shotAt = time;
        const attackType = event.type === 'enemyAttack' && snapshot.enemies.find(enemy => enemy.id === event.enemyId)?.type;
        if (attackType === 'stamper' || attackType === 'cabinet') {
          emit(sparks, { born: time, x: event.x, y: 0.06, z: event.z, seed: hashActor(event.enemyId) % 29, color: 'stamp' });
        } else if ([event.x, event.y, event.z, event.toX, event.toY, event.toZ].every(Number.isFinite)) {
          emit(traces, { born: time, local, x: event.x, y: event.y, z: event.z, toX: event.toX, toY: event.toY, toZ: event.toZ, color: event.type === 'shot' ? 'friendly' : 'enemy' });
        }
      }
      if (event.type === 'hit' || event.type === 'defeatEnemy') {
        flashes.set(event.enemyId, time);
        emit(sparks, { born: time, x: event.x, y: event.y, z: event.z, seed: hashActor(event.enemyId) % 29, color: event.type === 'hit' ? 'friendly' : 'stamp' });
      }
    }
  }

  function enemyPose(entity, dt) {
    const [body, feature] = enemyBatches[entity.type] ?? [];
    if (!body || body.count >= ACTOR_LIMIT) return;
    const pose = rigPose(entity, dt, 3.5);
    const sway = reduceMotion ? 0 : Math.sin(pose.step) * pose.stride;
    const strike = entity.state === 'attack', winding = entity.state === 'windup';
    const hit = Math.max((entity.hit ?? 0) * 0.58, 1 - (time - (flashes.get(entity.id) ?? -1)) * 8);
    tint.copy(winding ? tintAttack : tintNormal).lerp(tintHit, hit);
    transform(shadows, pose.x, 0.007, pose.z, pose.yaw, 0.51, 1, 0.47);
    if (entity.type === 'stamper') {
      const hop = Math.abs(sway) * 0.16;
      transform(body, pose.x, hop, pose.z, pose.yaw, 1, 1, 1, tint, sway * 0.06);
      transform(feature, pose.x, hop + (winding ? 0.19 : strike ? -0.095 : 0.017), pose.z, pose.yaw, 1 + hit * 0.06, 1 - hit * 0.1, 1, tint, sway * 0.13);
    } else {
      const tilt = strike ? 0.14 : winding ? -0.12 : sway * 0.045;
      const extend = strike ? 0.18 : winding ? 0.11 : 0;
      transform(body, pose.x, 0.009 + Math.abs(sway) * 0.013, pose.z, pose.yaw, 1, 1 - hit * 0.055, 1, tint, tilt * 0.25);
      transform(feature, pose.x - Math.sin(pose.yaw) * extend, Math.abs(sway) * 0.013, pose.z - Math.cos(pose.yaw) * extend, pose.yaw, 1, 1, 1, tint, tilt * 0.25);
    }
  }

  function teammatePose(entity, dt) {
    const pose = rigPose(entity, dt, 4.2);
    const sway = reduceMotion ? 0 : Math.sin(pose.step) * pose.stride;
    transform(shadows, pose.x, 0.008, pose.z, pose.yaw, 0.39, 1, 0.43);
    const down = entity.downed;
    const hue = 0.09 + (hashActor(entity.id) % 13) * 0.024;
    tint.setHSL(hue, 0.15, 0.84);
    if (down) tint.copy(tintDown);
    transform(teammateBatches[0], pose.x, down ? 0.04 : Math.abs(sway) * 0.048, pose.z, pose.yaw, 1, down ? 0.46 : 1, 1, tint, down ? 0.37 : 0.045);
    for (let i = 0; i < 2; i++) {
      const offset = (i ? -1 : 1) * 0.13;
      const height = down ? 0.5 : 0.9 + Math.abs(sway) * 0.035;
      const swing = (i ? -1 : 1) * sway * 0.48;
      transform(teammateBatches[i + 1], pose.x + Math.cos(pose.yaw) * offset, height, pose.z - Math.sin(pose.yaw) * offset, pose.yaw, 1, down ? 0.56 : 1, 1, tint, down ? 0.4 : swing);
    }
    if (down) {
      const yawToEye = Math.atan2(pose.x - camera.position.x, pose.z - camera.position.z);
      transform(teammateBatches[3], pose.x, 1.09, pose.z, yawToEye, 1, 1, 1, tintNormal);
    }
  }

  function drawFx() {
    while (traces[0] && time - traces[0].born >= TRACE_AGE) traces.shift();
    while (sparks[0] && time - sparks[0].born >= SPARK_AGE) sparks.shift();
    for (const fx of traces) {
      tail.set(fx.x, fx.y, fx.z);
      head.set(fx.toX, fx.toY, fx.toZ);
      if (fx.local) {
        // A small offset keeps the near end below the center of the view.
        tail.lerp(head, 0.05);
        tail.y -= 0.16;
      }
      direction.subVectors(head, tail);
      const length = direction.length();
      if (length < 0.001) continue;
      const life = 1 - (time - fx.born) / TRACE_AGE;
      dummy.position.copy(tail).lerp(head, 0.5);
      dummy.quaternion.setFromUnitVectors(axisY, direction.normalize());
      const width = (fx.local ? 0.017 : 0.025) * life;
      dummy.scale.set(width, length, width);
      dummy.updateMatrix();
      traceBatch.setMatrixAt(traceBatch.count, dummy.matrix);
      traceBatch.setColorAt(traceBatch.count, traceColors[fx.color]);
      traceBatch.count++;
    }
    for (const fx of sparks) {
      const age = time - fx.born, size = 0.055 * (1 - age / SPARK_AGE);
      if (!Number.isFinite(fx.y)) continue;
      for (let i = 0; i < 4; i++) {
        const angle = fx.seed + i * Math.PI * 0.5, radius = 0.05 + age * (1.2 + i * 0.25);
        transform(sparkBatch, fx.x + radius * Math.cos(angle), fx.y + age * (0.8 + i * 0.64) - age * age * 3, fx.z + radius * Math.sin(angle), angle, size, size * 1.9, size, traceColors[fx.color], age * 8);
      }
    }
  }

  function update(snapshot, { playerId, dt = 1 / 60 } = {}) {
    dt = Math.min(0.1, Math.max(0, dt));
    time += dt;
    tool.visible = false;
    for (const mesh of batches) { mesh.count = 0; mesh.visible = false; }
    if (!snapshot) return;
    ingest(snapshot, playerId);
    let local;
    for (const enemy of snapshot.enemies) {
      if (Math.hypot(enemy.x - camera.position.x, enemy.z - camera.position.z) <= VIEW_RANGE) enemyPose(enemy, dt);
    }
    for (const player of snapshot.players) {
      if (player.id === playerId) local = player;
      else if (Math.hypot(player.x - camera.position.x, player.z - camera.position.z) <= VIEW_RANGE) teammatePose(player, dt);
    }
    for (const [id, pose] of caches) if (time - pose.seen > 1.3) caches.delete(id);
    for (const [id, hitAt] of flashes) if (time - hitAt > SPARK_AGE) flashes.delete(id);
    drawFx();
    for (const mesh of batches) {
      if (mesh.count === 0) continue;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (!local || local.downed) return;
    const velocity = lastPosition ? Math.min(3, Math.hypot(camera.position.x - lastPosition[0], camera.position.z - lastPosition[1]) / Math.max(dt, 0.001)) : 0;
    lastPosition ??= [0, 0];
    lastPosition[0] = camera.position.x;
    lastPosition[1] = camera.position.z;
    moving += (velocity - moving) * (1 - Math.exp(-8 * dt));
    const recoil = Math.max(0, 1 - (time - shotAt) * 7) ** 2;
    const breadth = camera.aspect * Math.tan(camera.fov * Math.PI / 360);
    const height = Math.tan(camera.fov * Math.PI / 360);
    const depth = -0.64 + (reduceMotion ? 0 : 0.062 * recoil);
    const sway = reduceMotion ? 0 : Math.sin(time * 9) * moving * 0.004;
    const lower = local.reloadLeft > 0 ? 0.09 + Math.min(0.1, local.reloadLeft * 0.16) : 0;
    tool.visible = true;
    tool.scale.setScalar(Math.min(0.78, Math.max(0.52, 0.58 + breadth * 0.12)));
    tool.position.set(-depth * breadth * 0.69 + sway, depth * height * 0.81 - lower + Math.abs(sway) * 0.93, depth);
    tool.rotation.set(-0.095 - recoil * 0.16 - lower, 0.112, -0.12 + sway);
    toolRing.scale.setScalar(1 + recoil * 0.12);
  }

  function dispose() {
    root.removeFromParent();
    tool.removeFromParent();
    if (ownsCamera && camera.parent === scene) scene.remove(camera);
    for (const resource of resources) resource.dispose();
    audio.dispose();
  }

  return { update, dispose, resumeAudio: audio.resume };
}
