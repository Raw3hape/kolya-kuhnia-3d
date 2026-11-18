// Browser input, prediction and camera for the alpine destination.
import { NETWORK_RULES } from './multiplayer/rules.js';
import { createSnowSimulation, normalizeSnowInput, stepSnowRider, nearSnowGear } from './snow-simulation.js';
import { createSnowWorld } from './snow-world.js';
import { createSnowEnvironment, SNOW_LOOK } from './snow-environment.js';
import { createSnowActors, snowRiderCrouch } from './snow-actors.js';
import { createSnowHud } from './snow-hud.js';

const SEND_INTERVAL = 1 / NETWORK_RULES.inputHz;
const KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyE', 'KeyQ', 'KeyZ', 'KeyX', 'KeyR', 'KeyC', 'Space', 'ShiftLeft', 'ShiftRight',
]);
const MAX_HEAD_TURN = Math.PI * 0.75;
const MIN_LOOK_PITCH = -Math.PI * 0.478;
const MAX_LOOK_PITCH = Math.PI * 0.40;
const TELEPORT_METERS = 3;
const wrap = value => Math.atan2(Math.sin(value), Math.cos(value));
const angleTo = (from, to, k) => from + wrap(to - from) * k;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const response = (speed, dt) => 1 - Math.exp(-speed * dt);
const travelYaw = p => p.speed > 0.8 ? Math.atan2(-p.vx, -p.vz) : p.yaw;

export function createSnowAdventure({ THREE: T, canvas, config, getQuality, onReturn, request, send, connected }) {
  const scene = new T.Scene();
  scene.background = new T.Color(SNOW_LOOK.sky);
  scene.fog = new T.Fog(SNOW_LOOK.fog, SNOW_LOOK.fogNear, SNOW_LOOK.fogFar);
  const fill = new T.HemisphereLight(0xc9e7ff, 0x72909e, 1.9);
  const sun = new T.DirectionalLight(0xffedd1, 2.35);
  sun.position.set(-8, 14, 5);
  scene.add(fill, sun);
  const camera = new T.PerspectiveCamera(60, 1, 0.06, SNOW_LOOK.far);
  camera.rotation.order = 'YXZ';
  const correction = new T.Vector3();
  const visualRider = {};
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let world, environment, actors, hud, simulation, state, playerId, predicted, controller;
  let active = false, returning = false, pending = false, notice = '', noticeUntil = 0;
  let frames = [], commandSeq = 0, sendClock = 0, lastJump = 0, jumpSerial = 0;
  const sent = new Map();
  let viewYaw = 0, viewPitch = 0, motionYaw = 0, headYaw = 0, eyeHeight = config.station.eyeHeight;
  let slopePitch = 0, softRoll = 0, baseFov = 60, viewFov = 60, predictionClock = 0, arrival = 0;
  let ridingView = false, centerLook = false, hasLock = false;
  let touch = matchMedia('(pointer: coarse)').matches, mouse, joyX = 0, joyZ = 0, handheld = {};
  const keys = new Set(), pointers = new Map();

  function setWorld(seed) {
    if (world?.seed === seed) return;
    releasePreview();
    world = createSnowWorld(seed, config.terrain);
    environment = createSnowEnvironment(world, { quality: getQuality() });
    actors = createSnowActors({ THREE: T, scene, world, config });
    scene.add(environment.group);
  }

  function releasePreview() {
    if (active) return;
    actors?.dispose(); environment?.group.removeFromParent(); environment?.dispose();
    actors = environment = world = null;
  }

  function preview(seed, x, z) {
    setWorld(seed);
    environment.update(x, z, 0);
    return { scene, far: camera.far, floor: world.height(0, 0) };
  }

  function resetInput() {
    keys.clear(); handheld = {}; mouse = null; joyX = joyZ = 0;
    for (const id of pointers.keys()) {
      try { canvas.releasePointerCapture(id); } catch { /* pointer already ended */ }
    }
    pointers.clear();
  }

  const held = (...codes) => codes.some(code => keys.has(code));
  const local = () => state?.players.find(player => player.id === playerId);
  const near = () => predicted ? nearSnowGear(world, predicted, config) : null;
  const lock = () => {
    if (touch || document.pointerLockElement === canvas) return;
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* drag to look */ }
  };

  function readInput() {
    const left = held('KeyA', 'ArrowLeft'), right = held('KeyD', 'ArrowRight');
    const up = held('KeyW', 'ArrowUp'), down = held('KeyS', 'ArrowDown');
    const skiing = predicted?.phase !== 'walk';
    const steer = clamp(Number(right) - Number(left) + joyX + (handheld.steer || 0), -1, 1);
    return normalizeSnowInput({
      seq: commandSeq,
      steer,
      push: clamp(Number(up) - (!skiing ? Number(down) : 0) + joyZ + Number(handheld.push || 0), -1, 1),
      brake: (skiing && down) || Boolean(handheld.brake),
      tuck: held('ShiftLeft', 'ShiftRight') || Boolean(handheld.tuck),
      jump: held('Space') || Boolean(handheld.jump),
      jumpSerial,
      spin: handheld.spin || (held('KeyE', 'KeyQ') ? Number(held('KeyE')) - Number(held('KeyQ')) : steer),
      flip: handheld.flip || Number(held('KeyX')) - Number(held('KeyZ')),
      lookYaw: viewYaw,
    });
  }

  function resetGaze() { if (predicted) centerLook = true; }

  function bindInput() {
    controller = new AbortController();
    const options = { capture: true, signal: controller.signal };
    function key(event) {
      if (event.code === 'Escape') {
        resetInput();
        if (document.pointerLockElement === canvas) document.exitPointerLock?.();
        event.stopImmediatePropagation();
        return;
      }
      if (!KEYS.has(event.code) || event.ctrlKey || event.metaKey || event.altKey ||
          event.target?.closest?.('input,textarea,select,[contenteditable]') ||
          (event.code === 'Space' && event.target?.closest?.('button'))) return;
      event.stopImmediatePropagation(); event.preventDefault();
      if (event.type === 'keyup') { keys.delete(event.code); return; }
      keys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'Space') jumpSerial++;
      if (event.code === 'KeyE' && predicted?.phase === 'walk') {
        const equipment = near(); if (equipment) command('equip', { equipment });
      }
      if (event.code === 'KeyR') command('reset', { walk: event.shiftKey });
      if (event.code === 'KeyC') resetGaze();
    }
    addEventListener('keydown', key, options);
    addEventListener('keyup', key, options);
    addEventListener('blur', resetInput, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); }, options);
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && hasLock) resetInput();
      if (locked) mouse = null;
      hasLock = locked;
    }, options);
    function rotate(dx, dy, scale) {
      if (!predicted || returning || (!dx && !dy)) return;
      centerLook = false;
      if (ridingView) {
        // If equipped while facing uphill, preserve the existing angle and
        // allow the head to come back within the normal range without a snap.
        headYaw = clamp(headYaw - dx * scale, Math.min(headYaw, -MAX_HEAD_TURN), Math.max(headYaw, MAX_HEAD_TURN));
      } else viewYaw = wrap(viewYaw - dx * scale);
      viewPitch = clamp(viewPitch - dy * scale, MIN_LOOK_PITCH, MAX_LOOK_PITCH);
    }
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement === canvas) rotate(event.movementX, event.movementY, 0.0023);
    }, options);
    canvas.addEventListener('pointerdown', event => {
      event.stopImmediatePropagation();
      if (event.pointerType === 'touch') {
        touch = true;
        const side = predicted?.phase === 'walk' && event.clientX < canvas.clientWidth * 0.47 ? 'move' : 'look';
        if ([...pointers.values()].some(p => p.side === side)) return;
        pointers.set(event.pointerId, { side, x: event.clientX, y: event.clientY });
        try { canvas.setPointerCapture(event.pointerId); } catch { /* support passive look */ }
      } else if (event.button === 0 || event.button === 2) {
        mouse = { id: event.pointerId, x: event.clientX, y: event.clientY };
        if (event.button === 0) lock();
        if (document.pointerLockElement !== canvas) {
          try { canvas.setPointerCapture(event.pointerId); } catch { /* drag inside the canvas still works */ }
        }
      }
    }, options);
    canvas.addEventListener('pointermove', event => {
      const point = pointers.get(event.pointerId);
      if (point?.side === 'move') {
        const dx = event.clientX - point.x, dy = event.clientY - point.y, length = Math.max(45, Math.hypot(dx, dy));
        joyX = dx / length; joyZ = -dy / length;
      } else if (point?.side === 'look' || (mouse?.id === event.pointerId && !document.pointerLockElement)) {
        const drag = point || mouse;
        rotate(event.clientX - drag.x, event.clientY - drag.y, point ? 0.006 : 0.0042);
        drag.x = event.clientX; drag.y = event.clientY;
      }
    }, options);
    function release(event) {
      if (pointers.get(event.pointerId)?.side === 'move') joyX = joyZ = 0;
      pointers.delete(event.pointerId);
      if (mouse?.id === event.pointerId) mouse = null;
    }
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) addEventListener(name, release, options);
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
  }

  async function command(verb, details) {
    if (!active || pending || returning) return;
    if (verb === 'equip') {
      if (near() !== details.equipment) return;
      lock();
    }
    pending = true;
    try {
      const ok = simulation
        ? verb === 'equip' ? simulation.select(playerId, details.equipment) : simulation.reset(playerId, details)
        : (await request(verb, details))?.ok;
      if (!active) return;
      if (!ok) {
        notice = verb === 'equip' ? 'Подойдите ближе к снаряжению' : 'Снова попробуйте вернуться на старт';
        noticeUntil = performance.now() + 1800;
      }
      if (ok) canvas.focus({ preventScroll: true });
    } finally {
      pending = false;
    }
  }

  function enter({ incoming, id, seed, look }) {
    setWorld(seed);
    playerId = id;
    simulation = incoming ? null : createSnowSimulation({ seed, config });
    if (simulation) simulation.join(id);
    state = incoming || simulation.snapshot();
    predicted = { ...local() };
    viewYaw = look.yaw; viewPitch = look.pitch; baseFov = viewFov = look.fov;
    motionYaw = look.yaw; headYaw = slopePitch = softRoll = 0;
    const x = Number.isFinite(look.x) ? clamp(look.x, -0.8, 0.8) : predicted.x;
    const z = Number.isFinite(look.z) ? clamp(look.z, -0.5, 0.25) : predicted.z;
    const crossingHeight = Number.isFinite(look.eyeHeight) ? clamp(look.eyeHeight, 0.85, 2.3) : config.station.eyeHeight;
    const y = world.height(world.start.x, world.start.z) + crossingHeight;
    eyeHeight = y - world.height(x, z);
    camera.position.set(x, y, z);
    camera.rotation.set(viewPitch, viewYaw, 0, 'YXZ');
    correction.set(x - predicted.x, 0, z - predicted.z);
    arrival = 0.22;
    ridingView = centerLook = returning = false;
    hasLock = document.pointerLockElement === canvas;
    notice = ''; active = true;
    frames = []; commandSeq = sendClock = predictionClock = jumpSerial = lastJump = 0;
    sent.clear();
    bindInput();
    hud = createSnowHud({
      config, onReturn, onEquip: equipment => command('equip', { equipment }),
      onReset: options => command('reset', typeof options === 'object' ? options : { walk: options === true }),
      onCenter: resetGaze,
      onInput: patch => {
        if (patch.jump && !handheld.jump) jumpSerial++;
        handheld = { ...handheld, ...patch };
      },
    });
  }

  function sync(incoming, id) {
    if (!active || simulation || id !== playerId || incoming.tick <= state.tick) return;
    if (incoming.seed !== world.seed) return;
    const me = incoming.players.find(player => player.id === id);
    if (!me) return;
    const now = performance.now();
    frames.push({ at: now, state: incoming });
    if (frames.length > 6) frames.shift();
    const timestamp = sent.get(me.ack);
    for (const seq of sent.keys()) if (seq <= me.ack) sent.delete(seq);
    const lead = timestamp === undefined ? 0 : clamp((now - timestamp - SEND_INTERVAL * 1000) / 2000, 0, 0.10);
    const old = predicted;
    state = incoming;
    predicted = { ...me };
    advancePrediction(lead, readInput());
    const dx = old.x - predicted.x, dy = old.y - predicted.y, dz = old.z - predicted.z;
    if (Math.hypot(dx, dy, dz) < TELEPORT_METERS) {
      correction.x += dx; correction.y += dy; correction.z += dz;
    } else correction.set(0, 0, 0);
  }

  function advancePrediction(seconds, input) {
    const step = 1 / config.simulation.tickHz;
    predictionClock += seconds;
    while (predictionClock >= step) {
      predicted = stepSnowRider(world, predicted, input, step, config);
      predictionClock -= step;
    }
  }

  function displayedState() {
    if (simulation || frames.length < 2) return { ...state, players: state.players.map(p => p.id === playerId ? visualRider : p) };
    const at = performance.now() - NETWORK_RULES.interpolationMs;
    const i = frames.findIndex(frame => frame.at >= at);
    const after = i < 0 ? frames.at(-1) : frames[i], before = frames[Math.max(0, i < 0 ? frames.length - 2 : i - 1)];
    const factor = before === after ? 1 : clamp((at - before.at) / Math.max(1, after.at - before.at), 0, 1);
    return { ...state, players: after.state.players.map(p => {
      if (p.id === playerId) return visualRider;
      const old = before.state.players.find(other => other.id === p.id);
      if (!old || Math.hypot(old.x - p.x, old.z - p.z) > 12) return p;
      return { ...p, x: lerp(old.x, p.x, factor), y: lerp(old.y, p.y, factor), z: lerp(old.z, p.z, factor),
        yaw: angleTo(old.yaw, p.yaw, factor), lean: lerp(old.lean, p.lean, factor), pitch: lerp(old.pitch, p.pitch, factor),
        flip: angleTo(old.flip, p.flip, factor), speed: lerp(old.speed, p.speed, factor) };
    }) };
  }

  function orient(dt) {
    const p = predicted;
    const riding = p.phase !== 'walk' && !!p.equipment;
    if (riding !== ridingView) {
      if (riding) {
        motionYaw = travelYaw(p);
        headYaw = wrap(viewYaw - motionYaw);
        joyX = joyZ = 0;
      }
      ridingView = riding;
    }
    if (centerLook) {
      const amount = response(14, dt);
      if (riding) headYaw = lerp(headYaw, 0, amount);
      else viewYaw = angleTo(viewYaw, p.yaw, amount);
      viewPitch = lerp(viewPitch, 0, amount);
      if (Math.abs(viewPitch) < 0.002 && (!riding || Math.abs(headYaw) < 0.002)) centerLook = false;
    }
    if (riding) {
      // The head follows the line of travel rather than the stance. Keep a
      // stable horizon during tricks, whose full rotation is visible below.
      motionYaw = angleTo(motionYaw, travelYaw(p), response(9, dt));
      viewYaw = wrap(motionYaw + headYaw);
    }
    const crouch = riding ? snowRiderCrouch(p) : 0;
    const targetHeight = p.phase === 'crashed' ? 0.63 : riding ? config.station.eyeHeight - 0.22 - crouch : config.station.eyeHeight;
    eyeHeight = lerp(eyeHeight, targetHeight, response(14, dt));
    const gradeView = riding ? clamp(p.pitch * (reduceMotion ? 0.14 : 0.36), -0.27, 0.16) : 0;
    slopePitch = lerp(slopePitch, gradeView, response(8, dt));
    softRoll = reduceMotion ? 0 : lerp(softRoll, riding ? -p.lean * 0.041 : 0, response(9, dt));
    const headingWeight = 0.5 + 0.5 * Math.cos(riding ? headYaw : 0);
    const pitch = clamp(viewPitch + slopePitch * headingWeight, MIN_LOOK_PITCH, MAX_LOOK_PITCH);

    correction.multiplyScalar(Math.exp(-(arrival > 0 ? 7 : 16) * dt));
    arrival -= dt;
    const x = p.x + correction.x, z = p.z + correction.z;
    const y = Math.max(p.y + correction.y, world.height(x, z));
    Object.assign(visualRider, p, { x, y, z });
    camera.position.set(x, y + eyeHeight, z);
    camera.rotation.set(pitch, viewYaw, softRoll, 'YXZ');
    const aspect = Math.max(0.1, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const speedFov = riding && !reduceMotion ? Math.min(5, p.speed * 0.12) : 0;
    const gearFov = riding && aspect < 1 ? 7 : 0;
    viewFov = lerp(viewFov, baseFov + speedFov + gearFov, response(6, dt));
    const fov = Math.min(94, viewFov);
    if (Math.abs(camera.fov - fov) > 0.02 || camera.aspect !== aspect) {
      camera.aspect = aspect; camera.fov = fov; camera.updateProjectionMatrix();
    }
  }

  function update(dt, draw) {
    const step = Math.min(0.05, dt);
    const waiting = !simulation && !connected();
    const input = readInput();
    if (simulation) {
      simulation.input(playerId, { ...input, seq: ++commandSeq });
      simulation.tick(step);
      state = simulation.snapshot(); predicted = local();
    } else if (!waiting && !returning) {
      sendClock += step;
      if (sendClock >= SEND_INTERVAL || jumpSerial !== lastJump) {
        const seq = ++commandSeq;
        if (send({ ...input, seq })) {
          sent.set(seq, performance.now());
          if (sent.size > 20) sent.delete(sent.keys().next().value);
          sendClock %= SEND_INTERVAL; lastJump = jumpSerial;
        }
      }
      advancePrediction(step, input);
    }
    if (!predicted) return;
    orient(step);
    environment.update(predicted.x, predicted.z, step);
    const nearGear = near();
    actors.update(displayedState(), { playerId, dt: step, nearGear });
    hud.update(state, { playerId, nearGear, touch,
      status: waiting ? 'Восстанавливаем связь с комнатой…' : returning ? 'Возвращаемся в квартиру…' :
        performance.now() < noticeUntil ? notice : '' });
    draw(scene, camera);
  }

  function leave() {
    if (!active) return;
    active = false;
    controller.abort(); controller = null;
    resetInput();
    hud.dispose(); hud = null;
    simulation = state = predicted = null;
    frames = []; sent.clear();
    releasePreview();
  }

  return { preview, releasePreview, enter, sync, update, leave, setReturning(value) { returning = value; resetInput(); },
    get active() { return active; }, get solo() { return !!simulation; }, get hasWorld() { return !!world; },
    get snapshot() { return state; },
    get view() { return { x: camera.position.x, y: camera.position.y, z: camera.position.z,
      yaw: camera.rotation.y, pitch: camera.rotation.x, gear: actors?.localGear ?? null,
      terrain: environment?.stats?.(), nearGear: near() }; },
  };
}
