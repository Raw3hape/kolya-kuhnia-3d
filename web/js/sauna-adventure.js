// First-person client. Rules belong to the local/room simulation, not the scene.
import { NETWORK_RULES } from './multiplayer/rules.js';
import { compileSaunaLayout, createSaunaSimulation, moveSaunaPlayer, targetSaunaSeat } from './sauna-simulation.js';
import { createSaunaScene } from './sauna-scene.js';
import { createSaunaAvatars } from './sauna-avatars.js';
import { createSaunaAudio } from './sauna-audio.js';
import { createSaunaHud } from './sauna-hud.js';

const INPUT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const SEND_SECONDS = 1 / NETWORK_RULES.inputHz;
const TOUCH_RADIUS = 48;
const PITCH_LIMIT = Math.PI * .479;
const wrap = yaw => Math.atan2(Math.sin(yaw), Math.cos(yaw));
const angle = (a, b, t) => wrap(a + wrap(b - a) * t);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const mix = (a, b, t) => a + (b - a) * t;
const ease = (seconds, speed) => 1 - Math.exp(-seconds * speed);

export function createSaunaAdventure({ THREE: T, canvas, config, getQuality, connected, request, send, onReturn, onViewChanged }) {
  const layout = compileSaunaLayout(config);
  const eye = new T.PerspectiveCamera(62, 1, 0.045, 140);
  eye.rotation.order = 'YXZ';
  const correction = new T.Vector3();
  const held = new Set(), touches = new Map(), sent = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fixedStep = 1 / layout.rules.tickHz;
  let scene, sceneQuality, avatars, seed, hud, audio, listeners, simulation, snapshot, predicted, selfId;
  let yaw = 0, pitch = 0, initialFov = 60, selected, mouse, joyX = 0, joyZ = 0, stride = 0;
  let seq = 0, sendClock = 0, tickClock = 0, frames = [], notice = '', noticeUntil = 0;
  let active = false, returning = false, busy = false, lockHeld = false, settling;
  let touch = matchMedia('(pointer: coarse)').matches;
  const player = () => snapshot?.players.find(p => p.id === selfId);

  function prepareScene(nextSeed) {
    const quality = getQuality();
    if (scene && seed === nextSeed && sceneQuality === quality) return;
    releasePreview();
    seed = nextSeed; sceneQuality = quality;
    scene = createSaunaScene({ THREE: T, config, layout, quality, seed, onAssetReady: onViewChanged });
    eye.far = scene.far;
  }

  function releasePreview() {
    if (active) return;
    scene?.dispose();
    scene = null;
  }

  function preview(nextSeed) {
    prepareScene(nextSeed);
    return { scene: scene.scene, far: scene.far };
  }

  function input() {
    const axis = (a, b) => Number(held.has(a)) - Number(held.has(b));
    return {
      yaw, pitch,
      moveX: clamp(axis('KeyD', 'KeyA') + joyX, -1, 1),
      moveZ: clamp(axis('KeyW', 'KeyS') + axis('ArrowUp', 'ArrowDown') + joyZ, -1, 1),
    };
  }

  function transmit(value) {
    if (!send({ ...value, seq: ++seq })) return false;
    sent.set(seq, performance.now());
    if (sent.size > 32) sent.delete(sent.keys().next().value);
    return true;
  }

  function resetControls(sendStop = false) {
    held.clear(); mouse = null; joyX = joyZ = 0;
    for (const id of touches.keys()) {
      try { canvas.releasePointerCapture(id); } catch { /* no capture */ }
    }
    touches.clear();
    hud?.move(null);
    if (sendStop && active && !simulation && connected()) transmit(input());
  }

  function adjustLook(dx, dy, k) {
    if (!predicted || returning) return;
    yaw = wrap(yaw - dx * k);
    if (predicted.seat) yaw = wrap(predicted.bodyYaw + clamp(wrap(yaw - predicted.bodyYaw), -layout.rules.seatTurn, layout.rules.seatTurn));
    pitch = clamp(pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT);
  }

  function lock() {
    if (touch || document.pointerLockElement === canvas) return;
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* drag remains available */ }
  }

  function acquire(next, lead = 0) {
    const original = predicted;
    predicted = next;
    if (!original) return;
    const seatChange = next.seat !== original.seat;
    if (seatChange) {
      settling = { left: reduced ? 0.15 : 0.40, from: eye.position.clone(), yaw: eye.rotation.y, pitch: eye.rotation.x };
      settling.duration = settling.left;
      yaw = next.yaw; pitch = next.pitch;
      resetControls();
    }
    if (lead > 0 && !seatChange) predict(lead, input());
    else tickClock = 0;
    if (settling || Math.hypot(original.x - next.x, original.z - next.z) > 0.82) {
      correction.set(0, 0, 0);
    } else {
      correction.x = clamp(eye.position.x - predicted.x, -.33, .33);
      correction.z = clamp(eye.position.z - predicted.z, -.33, .33);
    }
  }

  function enter({ incoming, id, seed: nextSeed, look }) {
    prepareScene(nextSeed);
    selfId = id;
    simulation = incoming ? null : createSaunaSimulation({ config, seed: nextSeed });
    simulation?.join(id);
    snapshot = incoming ?? simulation.snapshot();
    predicted = player();
    if (!predicted) { releasePreview(); return; }
    active = true; returning = busy = false;
    yaw = look.yaw; pitch = clamp(look.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    initialFov = eye.fov = look.fov;
    eye.aspect = Math.max(.1, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    eye.updateProjectionMatrix();
    settling = null;
    correction.set(clamp(look.x - predicted.x, -.8, .8), 0, clamp(look.z - predicted.z, -.8, .8));
    if (!Number.isFinite(correction.x + correction.z)) correction.set(0, 0, 0);
    eye.position.set(predicted.x + correction.x, look.eyeHeight ?? predicted.eyeY, predicted.z + correction.z);
    eye.rotation.set(pitch, yaw, 0, 'YXZ');
    avatars = createSaunaAvatars({ THREE: T, scene: scene.scene });
    audio = createSaunaAudio();
    hud = createSaunaHud({ name: config.name, onReturn, onUse: use, onAudio: () => audio.toggle() });
    seq = stride = tickClock = 0; sendClock = SEND_SECONDS;
    selected = null; frames = []; sent.clear(); noticeUntil = 0;
    lockHeld = document.pointerLockElement === canvas;
    bind();
  }

  function sync(incoming, id) {
    if (simulation || !active || id !== selfId || incoming.seed !== seed || incoming.tick < snapshot.tick) return;
    const next = incoming.players.find(p => p.id === id);
    if (!next) return;
    if (incoming.tick === snapshot.tick) {
      snapshot = incoming;
      if (next.seat !== predicted.seat) acquire(next);
      return;
    }
    const now = performance.now(), stamp = sent.get(next.seq);
    for (const key of sent.keys()) if (key <= next.seq) sent.delete(key);
    frames.push({ stamp: now, players: incoming.players });
    if (frames.length > 7) frames.shift();
    snapshot = incoming;
    acquire(next, stamp === undefined ? 0 : clamp((now - stamp) / 2000, 0, .07));
  }

  function predict(dt, controls) {
    tickClock += dt;
    while (tickClock + 1e-7 >= fixedStep) {
      tickClock = Math.max(0, tickClock - fixedStep);
      predicted = moveSaunaPlayer(layout, predicted, controls, fixedStep);
    }
  }

  function visualPlayers(local) {
    if (simulation || frames.length < 2) return snapshot.players.map(p => p.id === selfId ? local : p);
    const at = performance.now() - NETWORK_RULES.interpolationMs;
    const next = frames.findIndex(frame => frame.stamp >= at);
    const to = next < 0 ? frames.at(-1) : frames[next];
    const from = frames[Math.max(0, next < 0 ? frames.length - 2 : next - 1)];
    const k = from === to ? 1 : clamp((at - from.stamp) / Math.max(1, to.stamp - from.stamp), 0, 1);
    const stale = new Set(snapshot.players.map(p => p.id));
    return to.players.filter(p => stale.has(p.id)).map(p => {
      if (p.id === selfId) return local;
      const a = from.players.find(other => other.id === p.id);
      if (!a || a.seat !== p.seat || Math.hypot(a.x - p.x, a.z - p.z) > 2) return p;
      return { ...p, x: mix(a.x, p.x, k), y: mix(a.y, p.y, k), z: mix(a.z, p.z, k),
        yaw: angle(a.yaw, p.yaw, k), bodyYaw: angle(a.bodyYaw, p.bodyYaw, k),
        pitch: mix(a.pitch, p.pitch, k), speed: mix(a.speed, p.speed, k),
      };
    });
  }

  function use() {
    if (!active || returning || busy || settling || (!simulation && !connected())) return;
    audio.unlock();
    const me = predicted;
    const seat = me.seat ? null : targetSaunaSeat(layout, { ...me, yaw, pitch }, snapshot.seats);
    if (!me.seat && !seat) return;
    const verb = me.seat ? 'stand' : 'sit';
    const details = seat ? { seatId: seat.id, view: { yaw, pitch } } : {};
    if (simulation) {
      const ok = me.seat ? simulation.stand(selfId) : simulation.sit(selfId, seat.id, details.view);
      if (ok) {
        snapshot = simulation.snapshot();
        acquire(player());
      } else inform(me.seat ? 'Освободите место рядом, чтобы встать' : 'Место сейчас недоступно');
      return;
    }
    const executing = listeners;
    busy = true;
    Promise.resolve(request(verb, details)).then(result => {
      if (active && listeners === executing && !result?.ok) inform('Место сейчас недоступно');
    }).catch(() => {
      if (active && listeners === executing) inform('Связь с комнатой прервалась');
    }).finally(() => { if (listeners === executing) busy = false; });
  }

  function inform(message) { notice = message; noticeUntil = performance.now() + 2000; }

  function bind() {
    listeners = new AbortController();
    const options = { capture: true, signal: listeners.signal };
    function key(event) {
      if (event.code === 'Escape' && event.type === 'keydown') {
        resetControls(true);
        if (document.pointerLockElement === canvas) document.exitPointerLock?.();
        event.stopImmediatePropagation();
        return;
      }
      if (!INPUT_KEYS.has(event.code) || event.altKey || event.ctrlKey || event.metaKey ||
          event.target?.closest?.('input,textarea,select,[contenteditable]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.type === 'keyup') { held.delete(event.code); return; }
      audio.unlock();
      if (event.code === 'KeyE' && !event.repeat) use();
      else held.add(event.code);
    }
    addEventListener('keydown', key, options);
    addEventListener('keyup', key, options);
    addEventListener('blur', () => resetControls(true), options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { resetControls(true); audio.update('', false, true); }
    }, options);
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (lockHeld && !locked) resetControls(true);
      lockHeld = locked;
    }, options);
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement === canvas) adjustLook(event.movementX, event.movementY, .00235);
    }, options);

    canvas.addEventListener('pointerdown', event => {
      event.stopImmediatePropagation();
      if (returning) return;
      audio.unlock();
      const { pointerId, clientX: x, clientY: y } = event;
      if (event.pointerType === 'touch') {
        touch = true;
        const side = !predicted.seat && x < canvas.clientWidth * .46 ? 'move' : 'look';
        if ([...touches.values()].some(pointer => pointer.side === side)) return;
        touches.set(pointerId, { side, x, y });
        if (side === 'move') hud.move(x, y);
      } else if (!event.button || event.button === 2) {
        if (lockHeld && event.button === 0) { use(); return; }
        mouse = { id: pointerId, x, y, distance: 0, button: event.button };
      } else return;
      try { canvas.setPointerCapture(pointerId); } catch { /* drag fallback */ }
    }, options);
    canvas.addEventListener('pointermove', event => {
      const point = touches.get(event.pointerId);
      if (point?.side === 'move') {
        const dx = event.clientX - point.x, dy = event.clientY - point.y;
        const length = Math.max(TOUCH_RADIUS, Math.hypot(dx, dy));
        joyX = dx / length; joyZ = -dy / length;
        hud.move(point.x, point.y, joyX * 29, -joyZ * 29);
      } else if (point || (mouse?.id === event.pointerId && !lockHeld)) {
        const drag = point ?? mouse;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!point) drag.distance += Math.hypot(dx, dy);
        adjustLook(dx, dy, point ? .0055 : .0041);
        drag.x = event.clientX; drag.y = event.clientY;
      }
    }, options);
    function release(event) {
      if (touches.get(event.pointerId)?.side === 'move') { joyX = joyZ = 0; hud.move(null); }
      touches.delete(event.pointerId);
      if (mouse?.id !== event.pointerId) return;
      const click = event.type === 'pointerup' && mouse.button === 0 && mouse.distance < 5;
      mouse = null;
      if (click) {
        if (selected || predicted.seat) use();
        else lock();
      }
    }
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, release, options);
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
  }

  function update(dt, draw) {
    if (!active || !predicted) return;
    const step = Math.min(layout.rules.maxFrame, dt);
    const waiting = !simulation && !connected();
    yaw = wrap(yaw + (Number(held.has('ArrowLeft')) - Number(held.has('ArrowRight'))) * 1.5 * step);
    if (predicted.seat) yaw = wrap(predicted.bodyYaw + clamp(wrap(yaw - predicted.bodyYaw), -layout.rules.seatTurn, layout.rules.seatTurn));
    const control = input();
    if (simulation) {
      simulation.input(selfId, { ...control, seq: ++seq });
      simulation.tick(step);
      snapshot = simulation.snapshot(); predicted = player();
    } else if (!waiting && !returning) {
      sendClock += step;
      if (sendClock >= SEND_SECONDS && transmit(control)) sendClock %= SEND_SECONDS;
      predict(step, control);
    }
    const me = predicted;
    correction.multiplyScalar(Math.exp(-18 * step));
    stride += me.speed * step * (me.swimming ? 2 : 3.6);
    const drift = reduced ? 0 : Math.sin(stride) * Math.min(me.speed / layout.rules.walkSpeed, 1) * (me.swimming ? .009 : .013);
    const height = Math.abs(eye.position.y - me.eyeY) > 2 ? me.eyeY : mix(eye.position.y, me.eyeY + drift, ease(step, 12));
    let x = me.x + correction.x, z = me.z + correction.z;
    let eyeY = height, eyeYaw = yaw, eyePitch = pitch;
    if (settling) {
      settling.left = Math.max(0, settling.left - step);
      const phase = 1 - settling.left / settling.duration;
      const eased = phase * phase * (3 - 2 * phase);
      x = mix(settling.from.x, me.x, eased); z = mix(settling.from.z, me.z, eased);
      eyeY = mix(settling.from.y, me.eyeY, eased);
      eyeYaw = angle(settling.yaw, yaw, eased); eyePitch = mix(settling.pitch, pitch, eased);
      if (!settling.left) settling = null;
    }
    eye.position.set(x, eyeY, z);
    eye.rotation.set(eyePitch, eyeYaw, 0, 'YXZ');
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const lens = mix(eye.fov, Math.min(88, initialFov + (aspect < 1 ? 9 : 0)), ease(step, 5));
    if (Math.abs(eye.fov - lens) > .01 || aspect !== eye.aspect) {
      eye.aspect = Math.max(.1, aspect); eye.fov = lens; eye.updateProjectionMatrix();
    }
    const visible = visualPlayers({ ...me, yaw, pitch, x: eye.position.x, z: eye.position.z });
    const zone = layout.byZone.get(layout.seatById.get(me.seat)?.zone) ?? layout.zones.find(({ rect }) =>
      me.x >= rect[0] && me.x <= rect[2] && me.z >= rect[1] && me.z <= rect[3]);
    const message = returning ? 'Возвращаемся на кухню…' : waiting ? 'Восстанавливаем связь…' :
      performance.now() < noticeUntil ? notice : '';
    selected = settling ? null : targetSaunaSeat(layout, { ...me, yaw, pitch }, snapshot.seats);
    audio.update(zone?.id, me.swimming, waiting || returning);
    hud.show({ zone: zone?.label ?? config.name, count: snapshot.players.length,
      label: settling ? '' : me.seat ? 'Встать' : selected ? `Сесть · ${selected.label}` : '',
      locked: lockHeld, waiting, returning, message, touch, muted: audio.muted, resting: !!me.seat });
    avatars.update(visible, { localId: selfId, dt: step, camera: eye });
    scene.update(step, eye, visible);
    draw(scene.scene, eye);
  }

  function leave() {
    if (!active) return;
    active = false;
    listeners.abort(); listeners = null;
    resetControls();
    hud.dispose(); hud = null;
    audio.dispose(); audio = null;
    avatars.dispose(); avatars = null;
    predicted = snapshot = simulation = settling = null;
    frames = []; sent.clear();
    releasePreview();
  }

  return { enter, preview, releasePreview, sync, update, leave,
    setReturning(value) { returning = value; resetControls(); },
    get active() { return active; }, get solo() { return !!simulation; },
    get hasWorld() { return !!scene; }, get snapshot() { return snapshot; },
    get view() { return { x: eye.position.x, y: eye.position.y, z: eye.position.z, yaw: eye.rotation.y, pitch: eye.rotation.x,
      seat: predicted?.seat ?? null, targetSeat: selected?.id ?? null, avatars: avatars?.stats }; },
  };
}
