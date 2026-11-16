// Прогулка от первого лица: WASD/стрелки, взгляд перетаскиванием, джойстик на телефоне, столкновения со стенами,
// прыжок (Пробел).
// Самодостаточный модуль: прицел, джойстик и кнопку прыжка вставляет сам (стили на токенах страницы); вход и выход —
// переключатель режимов и полоса внизу в ui.js (клавиши режима оттуда же: строки справки ниже, help.js).
// API: initWalk({ THREE, camera, controls, canvas, plan, getObstacles, requestRender, onChange })
//   -> { active, walking, moving, running, enter(pos?, yaw?, { orbit }?), exit({ restore }?), toggle(), update(dt?),
//        boxesOf(object3d), setPersonHeight(cm), personHeight, eyeHeight, refreshObstacles(), setAreaGate(fn), orbitPose,
//        setZoom(k), kick(up, side, keep), nudge(dx, dz) }
//   nudge(dx, dz) — сдвинуть игрока на столько метров со столкновениями (мягкий толчок: монстры за входной дверью, landing.js);
//     только в прогулке, кадр применит update().
//   orbitPose — куда вернёт облёт выход из прогулки ({ pos, target, fov, order } | null); enter(…, { orbit }) задаёт его
//     явно (seats.js: встал с дивана в прогулку — выход вернёт облёт, каким он был до посадки, а не точку сиденья).
//   рост по умолчанию 180 см -> глаза 1.68 м.
//   update(dt) звать каждый кадр; true — камера сдвинулась, нужен кадр. dt в секундах (можно не передавать).
//   moving — игрок в этом кадре идёт; running — идёт с Shift (для покачивания рук в viewmodel.js);
//   airborne — в прыжке (глаза выше eyeHeight на высоту подскока).
//   setZoom(k) — прицеливание (viewmodel.js): угол обзора уже в k раз (по тангенсу), чувствительность взгляда падает вместе
//     с ним; 1 — без увеличения. Вход и выход сбрасывают в 1.
//   kick(up, side, keep) — отдача: взгляд вверх на up и вбок на side, рад; доля keep остаётся (ствол «уводит»),
//     остальное плавно возвращается. Мышь: ЛКМ или ПКМ тянуть — смотреть (ПКМ в прогулке — прицел, меню не открывается).
//   getObstacles() -> [{ x0, x1, z0, z1 } | THREE.Box3 | { ax, az, bx, bz, h }]: мебель в плане XZ и полотна дверей
//     (толстый отрезок от петли до края полотна, h — половина толщины; их даёт doors.js).
//   refreshObstacles() — перечитать препятствия сейчас (дверь двигается), иначе раз в 0.75 с.
//   setAreaGate(id => bool) — можно ли телепортом попасть в зону снаружи ('balcony', 'landing'): дверь туда открыта.
//   onChange(active) — режим включился/выключился (на время прогулки выключить вырез стен).
// Ядро столкновений (buildColliders, moveCircle, findFree, roomOf, outdoorAreas, areaBeyond) — чистые функции
// без DOM, их проверяет тест в node. Проёмы дверей в ядре открыты: закрытые полотна и глухие части рам даёт doors.js.

import { injectStyle } from './minimap.js';
import { WALK, OUTDOOR, outdoorAreas, areaBeyond, roomOf, buildColliders, isFree, moveCircle, findFree, normalizeColliders } from './multiplayer/collision.js';
export { WALK, OUTDOOR, outdoorAreas, areaBeyond, roomOf, buildColliders, isFree, moveCircle, findFree } from './multiplayer/collision.js';
import { addHelp } from './help.js';

// Справка (help.js): ui.js показывает brief-строки в полосе прогулки, все — в окне «?» и в разделе «Прогулка»
addHelp(
  { mode: 'design', topic: 'walk', action: 'walk-toggle', keys: ['F'], text: 'прогулка от первого лица', touch: '«Прогулка» в карточке сверху — пройтись от первого лица', order: 60 },
  { mode: 'walk', topic: 'walk', keys: ['W', 'A', 'S', 'D'], text: 'идти (или стрелки)', touch: 'джойстик слева — идти', brief: true, order: 10 },
  { mode: 'walk', topic: 'walk', keys: ['мышь'], text: 'тянуть — смотреть, двойной клик — захватить мышь', touch: 'ведите пальцем — смотреть', brief: true, order: 20 },
  { mode: 'walk', topic: 'walk', keys: ['Shift'], text: 'быстрее', touch: false, order: 30 },
  { mode: 'walk', topic: 'walk', keys: ['колесо'], text: 'шаг вперёд или назад, щипок — шире или уже обзор', touch: false, order: 35 },
  { mode: 'walk', topic: 'walk', keys: ['Пробел'], text: 'прыжок', touch: 'кнопка со стрелкой — прыжок', brief: true, order: 40 },
  { mode: 'walk', topic: 'walk', action: 'teleport', keys: [], text: 'план слева — нажмите на комнату, чтобы перейти туда', order: 80 },
  { mode: 'walk', topic: 'walk', action: 'walk-exit', keys: ['Esc'], text: 'выйти из прогулки (или F)', touch: '«Проект» в карточке сверху — выйти', order: 90 },
);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Вертикальный угол обзора по пропорциям экрана (градусы): 55° по вертикали, но по горизонтали не шире fovHMax;
// на портрете вертикальный растёт до fovMax, чтобы по горизонтали оставалось хотя бы fovHMinPortrait.
export function naturalFov(aspect = 16 / 9) {
  const rad = Math.PI / 180, a = aspect > 0 ? aspect : 1;
  const vFromH = h => (2 * Math.atan(Math.tan((h * rad) / 2) / a)) / rad;
  let v = Math.min(WALK.fovV, vFromH(WALK.fovHMax));
  if (a < 1) v = Math.max(v, vFromH(WALK.fovHMinPortrait));
  return clamp(v, WALK.fovMin, WALK.fovMax);
}

// ---------- режим прогулки ----------

// E — «использовать» (двери, doors.js), поэтому поворот только стрелками
const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const coarse = () => { try { return matchMedia('(hover: none), (pointer: coarse)').matches; } catch { return false; } };
const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function initWalk({ THREE, camera, controls, canvas, plan, getObstacles, requestRender, onChange, canMove: movementGuard = () => true }) {
  const col = buildColliders(plan);
  let network = null, inputSeq = 0, pendingInputs = [], jumpRequested = false;
  const correction = { x: 0, z: 0 };
  const playerObstacles = () => (network?.players?.() || []).filter(q => Number.isFinite(q.x) && Number.isFinite(q.z))
    .map(q => ({ x: q.x, z: q.z, radius: q.radius ?? WALK.radius }));
  const movementObstacles = () => network ? [...extra, ...playerObstacles()] : extra;
  let extra = [], obstaclesAt = -1;
  const refreshObstacles = force => {
    const now = performance.now();
    if (!force && now - obstaclesAt < 750) return;
    obstaclesAt = now;
    try { extra = normalizeColliders(getObstacles?.()); } catch { extra = []; }
  };

  // состояние
  let mode = 'off';                 // off | entering | walk | exiting
  const p = { x: 0, z: 0 };
  const vel = { x: 0, z: 0 };
  let yaw = 0, pitch = 0, tYaw = 0, tPitch = 0, turnVel = 0, fov = WALK.fovV, tFov = WALK.fovV, fovAdj = 0, step = 0;
  let zoom = 1, kp = 0, ky = 0, kpT = 0, kyT = 0;   // прицел (во сколько раз уже обзор) и отдача: текущая и целевая добавка к взгляду
  let heightCm = WALK.height, eye = (WALK.height * WALK.eyeRatio) / 100;
  let saved = null, anim = null, lastT = 0, touchSeen = false, locked = false, unlockedAt = 0;
  let moving = false, running = false, areaGate = () => false;
  let jy = 0, vy = 0;               // прыжок: подъём глаз над eye, м, и вертикальная скорость, м/с
  // Можно ли телепортом/входом оказаться в точке: в квартире — всегда, снаружи — если дверь туда открыта
  // (или игрок уже стоит в этой зоне).
  const reachable = q => {
    const id = roomOf(plan, q.x, q.z);
    if (id == null) return false;
    if (!outdoorAreas(plan).some(a => a.id === id)) return true;
    return areaGate(id) || (mode === 'walk' && roomOf(plan, p.x, p.z) === id);
  };
  const keys = new Set();
  const joy = { id: null, x: 0, y: 0 };
  const PITCH = (WALK.pitchMax * Math.PI) / 180;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ'), q = new THREE.Quaternion();
  const quatOf = (y, pt) => new THREE.Quaternion().setFromEuler(euler.set(pt, y, 0, 'YXZ'));
  const fwd = () => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

  // ---------- разметка ----------
  injectStyle('kw-style', WALK_CSS);
  const joyEl = div('kw-joy kw-float', document.body); joyEl.hidden = true;
  joyEl.setAttribute('aria-hidden', 'true');
  const knob = div('kw-knob', joyEl);
  // прыжок на телефоне — круглая кнопка справа, над кнопками оружия (viewmodel.js)
  const jumpEl = document.createElement('button');
  jumpEl.type = 'button'; jumpEl.className = 'kw-jump kw-float'; jumpEl.hidden = true; jumpEl.setAttribute('aria-label', 'Прыжок');
  jumpEl.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  document.body.appendChild(jumpEl);
  const cross = div('kw-cross kw-float', document.body); cross.hidden = true;

  const syncFloat = () => {
    joyEl.hidden = !(mode === 'walk' || mode === 'entering') || !(touchSeen || coarse());
    jumpEl.hidden = joyEl.hidden;
    cross.hidden = mode !== 'walk';
    document.body.classList.toggle('kw-walking', mode !== 'off');
  };

  // ---------- вход и выход ----------

  function enter(pos, yawArg, { orbit, network: fromNetwork = false } = {}) {
    if (network && mode === 'walk' && !fromNetwork && !network.canTeleport?.()) return false;
    jy = vy = 0;
    if (mode === 'entering' || mode === 'exiting') return false;
    refreshObstacles(true);
    if (mode === 'walk') {
      // телепорт внутри прогулки: только в квартиру
      if (!pos || !reachable(pos)) return false;
      const to = findFree(plan, { x: pos.x, z: pos.z }, col, extra);
      if (!to) return false;
      vel.x = vel.z = 0; step = 0;
      const ty = yawArg ?? yaw;
      anim = { t: 0, dur: reduced() ? 0 : 0.6, kind: 'glide',
        fromPos: new THREE.Vector3(p.x, eye, p.z), toPos: new THREE.Vector3(to.x, eye, to.z),
        fromQ: quatOf(yaw, pitch), toQ: quatOf(ty, pitch), fromFov: fov, toFov: fov, end: () => { p.x = to.x; p.z = to.z; yaw = tYaw = ty; } };
      requestRender?.();
      return true;
    }
    // из орбиты
    saved = orbit
      ? { pos: orbit.pos.clone(), target: orbit.target.clone(), fov: orbit.fov, order: orbit.order || 'XYZ' }
      : { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, order: camera.rotation.order };
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const camYaw = Math.hypot(dir.x, dir.z) > 0.15 ? Math.atan2(-dir.x, -dir.z) : WALK.start.yaw;
    const from = pos ?? { x: camera.position.x, z: camera.position.z };
    let start = reachable(from) ? findFree(plan, from, col, extra) : null;
    let y0 = yawArg ?? camYaw;
    if (!start) { start = findFree(plan, WALK.start, col, extra) || { ...WALK.start }; y0 = yawArg ?? WALK.start.yaw; }
    p.x = start.x; p.z = start.z;
    vel.x = vel.z = 0; step = 0; turnVel = 0;
    yaw = tYaw = y0; pitch = tPitch = (WALK.pitch0 * Math.PI) / 180;
    fovAdj = 0; zoom = 1; kp = ky = kpT = kyT = 0; fov = tFov = naturalFov(camera.aspect);
    controls.enabled = false;
    camera.rotation.reorder('YXZ');   // reorder сохраняет поворот (а присвоение .order — нет)
    mode = 'entering';
    anim = { t: 0, dur: reduced() ? 0 : WALK.transition, kind: 'enter',
      fromPos: camera.position.clone(), toPos: new THREE.Vector3(p.x, eye, p.z),
      fromQ: camera.quaternion.clone(), toQ: quatOf(yaw, pitch), fromFov: camera.fov, toFov: fov,
      end: () => { mode = 'walk'; syncFloat(); } };
    lastT = performance.now();
    syncFloat();
    onChange?.(true);
    requestRender?.();
    return true;
  }

  function exit({ restore = true, network: fromNetwork = false } = {}) {
    if (network && !fromNetwork && !network.canExit?.()) { if (!document.querySelector('dialog[open]')) dispatchEvent(new CustomEvent('kitchen:room-request')); return false; }
    jy = vy = 0;
    if (mode === 'off' || mode === 'exiting') return;
    keys.clear(); joyRelease(); lookRelease(); moving = running = false;
    zoom = 1; kp = ky = kpT = kyT = 0;
    if (locked) { try { document.exitPointerLock(); } catch { /* нет блокировки */ } }
    if (!restore || !saved) {
      // камера остаётся, где стоит (например, дальше её ведёт goView)
      camera.rotation.reorder(saved?.order || 'XYZ');
      const d = new THREE.Vector3(); camera.getWorldDirection(d);
      controls.target.copy(camera.position).addScaledVector(d, 2);
      finish();
      return;
    }
    mode = 'exiting';
    const m = new THREE.Matrix4().lookAt(saved.pos, saved.target, camera.up);
    anim = { t: 0, dur: reduced() ? 0 : WALK.transition, kind: 'exit',
      fromPos: camera.position.clone(), toPos: saved.pos.clone(),
      fromQ: camera.quaternion.clone(), toQ: new THREE.Quaternion().setFromRotationMatrix(m), fromFov: camera.fov, toFov: saved.fov,
      end: () => {
        camera.rotation.reorder(saved.order);
        camera.position.copy(saved.pos); camera.fov = saved.fov; camera.updateProjectionMatrix();
        controls.target.copy(saved.target); camera.lookAt(saved.target);
        finish();
      } };
    lastT = performance.now();
    syncFloat();
    requestRender?.();
  }

  function finish() {
    mode = 'off'; anim = null;
    controls.enabled = true;
    controls.update?.();
    syncFloat();
    onChange?.(false);
    requestRender?.();
  }

  function toggle() { if (mode === 'off') enter(); else if (mode === 'walk') exit(); }

  // ---------- кадр ----------

  let applied = '';
  function apply() {
    camera.position.set(p.x + correction.x, eye + jy, p.z + correction.z);
    camera.rotation.set(clamp(pitch + kp, -PITCH, PITCH), yaw + ky, 0, 'YXZ');
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // цель орбиты держим на сантиметр впереди: если кто-то вызовет controls.update(), взгляд не собьётся
    const f = fwd(), cp = Math.cos(pitch);
    controls.target.set(p.x + correction.x + f.x * cp * 0.01, eye + jy + Math.sin(pitch) * 0.01, p.z + correction.z + f.z * cp * 0.01);
  }

  function update(dt) {
    if (mode === 'off') return false;
    const now = performance.now();
    if (dt == null) dt = (now - lastT) / 1000;
    lastT = now;
    dt = clamp(dt, 0, 0.05);

    if (anim) {
      moving = running = false;
      anim.t = anim.dur > 0 ? Math.min(1, anim.t + dt / anim.dur) : 1;
      const k = anim.t, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(anim.fromPos, anim.toPos, e);
      camera.quaternion.slerpQuaternions(anim.fromQ, anim.toQ, e);
      camera.fov = anim.fromFov + (anim.toFov - anim.fromFov) * e;
      camera.updateProjectionMatrix();
      if (anim.t >= 1) {
        const a = anim; anim = null; a.end();
        if (mode === 'walk') { apply(); applied = ''; }
      }
      return true;
    }
    if (mode !== 'walk') return false;

    refreshObstacles(false);
    const canMove = movementGuard() && (!network || network.canMove?.() !== false);
    const blockers = movementObstacles();
    if (!isFree(p, col, blockers)) { const f = findFree(plan, p, col, blockers); if (f) { p.x = f.x; p.z = f.z; } }
    correction.x *= Math.exp(-16 * dt); correction.z *= Math.exp(-16 * dt);
    if (Math.hypot(correction.x, correction.z) < 0.0001) correction.x = correction.z = 0;

    // поворот стрелками
    const turnIn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
    turnVel += (turnIn * WALK.turn - turnVel) * (1 - Math.exp(-10 * dt));
    if (!turnIn && Math.abs(turnVel) < 1e-3) turnVel = 0;
    tYaw += turnVel * dt;

    // ход
    let f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    let s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
    let speed = shift ? WALK.run : WALK.walk;
    if (joy.id != null) {
      const jm = Math.min(1, Math.hypot(joy.x, joy.y));
      if (jm > 0.12) { f += -joy.y / jm; s += joy.x / jm; speed = jm > 0.95 ? WALK.run * 0.8 : WALK.walk * Math.min(1, jm / 0.8); }
    }
    const m = Math.hypot(f, s);
    if (m > 1) { f /= m; s /= m; }
    const fw = fwd(), rt = { x: -fw.z, z: fw.x };   // вправо = (cos yaw, −sin yaw)
    const dvx = (fw.x * f + rt.x * s) * speed, dvz = (fw.z * f + rt.z * s) * speed;
    const a = 1 - Math.exp(-(m > 0 ? 10 : 8) * dt);
    vel.x += (dvx - vel.x) * a; vel.z += (dvz - vel.z) * a;
    if (m === 0 && Math.hypot(vel.x, vel.z) < 0.01) vel.x = vel.z = 0;

    // шаг колесом
    let take = step * (1 - Math.exp(-14 * dt));
    if (Math.abs(step) < 0.003) take = step;
    step -= take;

    let mx = vel.x * dt + fw.x * take, mz = vel.z * dt + fw.z * take;
    if (!canMove) { mx = mz = 0; vel.x = vel.z = 0; step = 0; jumpRequested = false; }
    const px0 = p.x, pz0 = p.z;
    if (mx || mz) {
      const px = p.x, pz = p.z;
      moveCircle(p, mx, mz, col, blockers);
      // упёрлись — скорость = фактическая (скольжение вдоль стены без накопления)
      if (dt > 0 && (vel.x || vel.z)) {
        const ax = (p.x - px) / dt, az = (p.z - pz) / dt;
        if (Math.hypot(ax, az) < Math.hypot(vel.x, vel.z) - 1e-3) { vel.x = ax; vel.z = az; }
      }
    }

    // прыжок: баллистика, голова не выше потолка (в квартире), приземление — на пол
    if (canMove && (vy || jy)) {
      vy -= WALK.gravity * dt; jy += vy * dt;
      const top = (plan.ceiling ?? 2.64) - WALK.headroom - eye - 0.1;   // 0.1 — от глаз до макушки
      if (jy > top && vy > 0 && roomOf(plan, p.x, p.z) !== 'balcony') { jy = Math.max(0, top); vy = 0; }   // над балконом неба
      if (jy <= 0) { jy = 0; vy = 0; }
    }

    moving = dt > 0 && jy === 0 && Math.hypot(p.x - px0, p.z - pz0) / dt > 0.15;
    running = moving && (shift || (joy.id != null && Math.hypot(joy.x, joy.y) > 0.95));

    // взгляд и угол обзора — с лёгким сглаживанием; обзор следует за пропорциями окна (поворот телефона)
    tFov = clamp(naturalFov(camera.aspect) + fovAdj, WALK.fovMin, WALK.fovMax);
    if (zoom > 1) tFov = (2 * Math.atan(Math.tan((tFov * Math.PI) / 360) / zoom) * 180) / Math.PI;
    tPitch = clamp(tPitch, -PITCH, PITCH);
    const lk = 1 - Math.exp(-24 * dt);
    yaw += (tYaw - yaw) * lk; pitch += (tPitch - pitch) * lk; fov += (tFov - fov) * lk;
    if (Math.abs(tYaw - yaw) < 1e-4) yaw = tYaw;
    if (Math.abs(tPitch - pitch) < 1e-4) pitch = tPitch;
    if (Math.abs(tFov - fov) < 1e-3) fov = tFov;
    if (network && canMove && dt > 0) {
      const command = { type: 'input', seq: ++inputSeq, dt, dx: mx, dz: mz, yaw, pitch, jump: jumpRequested };
      jumpRequested = false;
      pendingInputs.push(command);
      if (pendingInputs.length > 240) pendingInputs.shift();
      network.onInput?.(command);
    }
    // отдача: цель гаснет, взгляд догоняет её — быстрый подброс и плавный возврат
    if (kpT || kyT || kp || ky) {
      kpT *= Math.exp(-7 * dt); kyT *= Math.exp(-7 * dt);
      const kk = 1 - Math.exp(-45 * dt);
      kp += (kpT - kp) * kk; ky += (kyT - ky) * kk;
      if (Math.abs(kp) + Math.abs(ky) + Math.abs(kpT) + Math.abs(kyT) < 2e-5) kp = ky = kpT = kyT = 0;
    }

    const key = `${jy.toFixed(4)}|${p.x.toFixed(4)}|${p.z.toFixed(4)}|${yaw.toFixed(5)}|${pitch.toFixed(5)}|${fov.toFixed(3)}|${kp.toFixed(5)}|${ky.toFixed(5)}`;
    if (key === applied) return false;
    applied = key;
    apply();
    return true;
  }

  // ---------- ввод ----------

  function jump() { if (mode === 'walk' && jy === 0 && !anim && movementGuard() && (!network || network.canMove?.() !== false)) { vy = WALK.jump; jumpRequested = true; requestRender?.(); } }

  addEventListener('keydown', e => {
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'KeyF') { if (!e.repeat) toggle(); e.preventDefault(); return; }
    if (mode === 'off') return;
    if (e.code === 'Escape') {
      if (performance.now() - unlockedAt > 250) exit();   // Esc, снявший захват мыши, из прогулки не выводит
      return;
    }
    if (MOVE.has(e.code)) { keys.add(e.code); e.preventDefault(); requestRender?.(); }
    if (e.code === 'Space' && mode === 'walk') { e.preventDefault(); if (!e.repeat) jump(); }
  });
  addEventListener('keyup', e => { keys.delete(e.code); });
  addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });

  // взгляд: перетаскивание по сцене («тянешь картинку», как в панорамах)
  let look = null;
  const lookRelease = () => { if (look) { try { canvas.releasePointerCapture(look.id); } catch { /* уже отпущен */ } } look = null; };
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') { touchSeen = true; syncFloat(); }
    if (mode !== 'walk' || locked || look) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;   // ПКМ — прицел, взгляд тоже ведёт
    look = { id: e.pointerId, x: e.clientX, y: e.clientY, k: (e.pointerType === 'touch' ? 0.0065 : 0.0042) };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
  });
  canvas.addEventListener('pointermove', e => {
    if (!look || e.pointerId !== look.id) return;
    // как в играх: вправо — взгляд вправо, вверх — вверх (так же, как при захвате мыши)
    const k = look.k * (fov / WALK.fovV);
    tYaw -= (e.clientX - look.x) * k;
    tPitch = clamp(tPitch - (e.clientY - look.y) * k, -PITCH, PITCH);
    look.x = e.clientX; look.y = e.clientY;
    requestRender?.();
  });
  canvas.addEventListener('pointerup', e => { if (look && e.pointerId === look.id) lookRelease(); });
  canvas.addEventListener('contextmenu', e => { if (mode !== 'off') e.preventDefault(); });
  canvas.addEventListener('pointercancel', e => { if (look && e.pointerId === look.id) lookRelease(); });

  // колесо: шаг вперёд/назад; щипок на трекпаде (ctrl+колесо) — угол обзора
  canvas.addEventListener('wheel', e => {
    if (mode !== 'walk') return;
    e.preventDefault();
    const d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (e.ctrlKey) { const n = naturalFov(camera.aspect); fovAdj = clamp(n + fovAdj + d * 0.08, WALK.fovMin, WALK.fovMax) - n; }
    else step = clamp(step - d * 0.003, -1.5, 1.5);
    requestRender?.();
  }, { passive: false });

  // двойной клик — захват мыши (в песочнице может быть запрещён: тогда просто остаётся перетаскивание)
  canvas.addEventListener('dblclick', e => {
    if (mode !== 'walk' || locked || coarse()) return;
    try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* запрещено */ }
  });
  document.addEventListener('pointerlockchange', () => {
    const was = locked;
    locked = document.pointerLockElement === canvas;
    if (was && !locked) unlockedAt = performance.now();
    if (locked) lookRelease();
    syncFloat();
  });
  document.addEventListener('pointerlockerror', () => { locked = false; syncFloat(); });
  document.addEventListener('mousemove', e => {
    if (!locked || mode !== 'walk') return;
    const k = 0.0022 * (fov / WALK.fovV);
    tYaw -= e.movementX * k;
    tPitch = clamp(tPitch - e.movementY * k, -PITCH, PITCH);
    requestRender?.();
  });

  // джойстик
  const R = 40;
  const joyMove = e => {
    const r = joyEl.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    joy.x = dx / R; joy.y = dy / R;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    requestRender?.();
  };
  const joyRelease = () => { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; joyEl.classList.remove('drag'); };
  jumpEl.addEventListener('pointerdown', e => { e.preventDefault(); jump(); });
  joyEl.addEventListener('pointerdown', e => {
    touchSeen = true;
    if (joy.id != null) return;
    joy.id = e.pointerId; joyEl.classList.add('drag');
    try { joyEl.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    joyMove(e); e.preventDefault();
  });
  joyEl.addEventListener('pointermove', e => { if (e.pointerId === joy.id) joyMove(e); });
  joyEl.addEventListener('pointerup', e => { if (e.pointerId === joy.id) joyRelease(); });
  joyEl.addEventListener('pointercancel', e => { if (e.pointerId === joy.id) joyRelease(); });

  // Коробки мебели из объекта сцены: меши ниже 1.3 м (на уровне тела), без подвесов, стекла и теней.
  const tmpBox = new THREE.Box3();
  function boxesOf(root, { bottom = 1.3, top = 0.12, maxArea = 8 } = {}) {
    const out = [];
    if (!root) return out;
    root.updateWorldMatrix?.(true, true);
    root.traverseVisible(o => {
      if (!o.isMesh || o.userData.glass || o.userData.shadowOnly) return;
      // Authored animated small props never inflate the static walking footprint.
      for (let node = o; node && node !== root; node = node.parent) if (node.userData.noBodyCollider) return;
      tmpBox.setFromObject(o);
      if (tmpBox.isEmpty() || tmpBox.min.y > bottom || tmpBox.max.y < top) return;
      const w = tmpBox.max.x - tmpBox.min.x, d = tmpBox.max.z - tmpBox.min.z;
      if (w * d > maxArea) return;
      out.push({ x0: tmpBox.min.x, x1: tmpBox.max.x, z0: tmpBox.min.z, z1: tmpBox.max.z });
    });
    return out;
  }

  // Рост человека, см (150–200 для ползунка; принимается 120–220). Глаза = рост · 0.933.
  function setPersonHeight(cm) {
    const v = Number(cm);
    if (!Number.isFinite(v)) return heightCm;
    heightCm = clamp(v, 120, 220);
    eye = (heightCm * WALK.eyeRatio) / 100;
    if (anim && mode !== 'exiting') { anim.toPos.y = eye; }
    if (mode === 'walk' && !anim) { applied = ''; apply(); requestRender?.(); }
    return heightCm;
  }

  function setZoom(k) {
    const z = Math.max(1, Number(k) || 1);
    if (Math.abs(z - zoom) < 1e-4) return;
    zoom = mode === 'walk' ? z : 1;
    requestRender?.();
  }
  function kick(up = 0, side = 0, keep = 0.3) {
    if (mode !== 'walk') return;
    tPitch = clamp(tPitch + up * keep, -PITCH, PITCH); tYaw += side * keep;
    kpT += up * (1 - keep); kyT += side * (1 - keep);
    requestRender?.();
  }

  function setNetwork(adapter) {
    network = adapter || null;
    inputSeq = 0; pendingInputs = []; jumpRequested = false;
    correction.x = correction.z = 0;
  }
  const getNetworkPose = () => ({ x: p.x, y: jy, z: p.z, yaw, pitch, moving, running });
  function reconcileNetwork(pose, ack = 0, { snap = false } = {}) {
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z)) return false;
    const oldX = p.x + correction.x, oldZ = p.z + correction.z;
    p.x = pose.x; p.z = pose.z;
    jy = Number.isFinite(pose.y) ? Math.max(0, pose.y) : jy;
    vy = Number.isFinite(pose.vy) ? pose.vy : 0;
    pendingInputs = snap ? [] : pendingInputs.filter(command => command.seq > ack);
    const blockers = movementObstacles();
    for (const command of pendingInputs) {
      moveCircle(p, command.dx, command.dz, col, blockers);
      if (command.jump && jy <= 0) vy = WALK.jump;
      if (jy > 0 || vy) {
        vy -= WALK.gravity * command.dt; jy = Math.max(0, jy + vy * command.dt);
        if (jy === 0) vy = 0;
      }
    }
    if (snap) {
      anim = null; mode = 'walk'; controls.enabled = false; syncFloat();
      if (Number.isFinite(pose.yaw)) yaw = tYaw = pose.yaw;
      if (Number.isFinite(pose.pitch)) pitch = tPitch = pose.pitch;
    }
    correction.x = snap ? 0 : oldX - p.x; correction.z = snap ? 0 : oldZ - p.z;
    if (Math.hypot(correction.x, correction.z) > 1) correction.x = correction.z = 0;
    applied = ''; apply(); requestRender?.();
    return true;
  }

  function collisionSnapshot({ includeAmbient = true } = {}) {
    refreshObstacles(true);
    const obstacles = extra.filter(b => includeAmbient || b.scope !== 'ambient');
    return { boxes: [...col.boxes, ...obstacles.filter(b => b.ax === undefined)],
      segs: [...col.segs, ...obstacles.filter(b => b.ax !== undefined)], extra: obstacles.map(b => ({ ...b })) };
  }

  return {
    get active() { return mode !== 'off'; },
    get walking() { return mode === 'walk'; },
    get moving() { return mode === 'walk' && moving; },
    get running() { return mode === 'walk' && running; },
    refreshObstacles: () => refreshObstacles(true),
    setAreaGate(fn) { areaGate = typeof fn === 'function' ? fn : () => false; },
    get personHeight() { return heightCm; },
    get orbitPose() { return saved && { pos: saved.pos.clone(), target: saved.target.clone(), fov: saved.fov, order: saved.order }; },
    get eyeHeight() { return eye; },
    get airborne() { return jy > 0; },
    setNetwork, getNetworkPose, reconcileNetwork, collisionSnapshot,
    setPersonHeight, setZoom, kick,
    nudge(dx, dz) { if (!network && mode === 'walk' && !anim && (dx || dz)) { moveCircle(p, dx, dz, col, extra); requestRender?.(); } },
    enter, exit, toggle, update, boxesOf,
    colliders: col,
  };
}

function div(cls, parent) { const d = document.createElement('div'); d.className = cls; parent.appendChild(d); return d; }

// Токены: --kw-* задаёт #kw-dock и .kw-float (minimap.js); здесь только сами элементы.
const WALK_CSS = `
.kw-joy[hidden], .kw-cross[hidden], .kw-jump[hidden] { display: none; }
.kw-jump { position: fixed; z-index: 5; right: max(20px, calc(env(safe-area-inset-right, 0px) + 12px)); bottom: calc(var(--hud-bottom, 76px) + 104px);
  width: 56px; height: 56px; padding: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: var(--kw-ink);
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; border: 1px solid var(--kw-line);
  background: color-mix(in srgb, var(--kw-sheet) 88%, transparent); box-shadow: var(--kw-shadow); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.kw-jump:active { transform: scale(0.94); }
.kw-joy { position: fixed; z-index: 5; left: max(20px, calc(env(safe-area-inset-left, 0px) + 12px)); bottom: var(--hud-bottom, 76px);
  width: 112px; height: 112px; border-radius: 50%; display: grid; place-items: center; touch-action: none; user-select: none; -webkit-user-select: none;
  background: color-mix(in srgb, var(--kw-sheet) 80%, transparent); border: 1px solid var(--kw-line); box-shadow: var(--kw-shadow);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.kw-knob { width: 46px; height: 46px; border-radius: 50%; background: var(--kw-accent); opacity: 0.9; pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22); transition: transform 0.14s ease-out; }
.kw-joy.drag .kw-knob { transition: none; }
.kw-cross { position: fixed; z-index: 5; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%;
  background: var(--kw-sheet); box-shadow: 0 0 0 1.5px var(--kw-ink); pointer-events: none; opacity: 0.8; transition: opacity 0.12s ease; }
body.kvm-ads .kw-cross { opacity: 0; }   /* смотрим через прицел оружия (viewmodel.js) */
@media (max-width: 800px) { body:has(#panel.open) .kw-joy, body:has(#panel.open) .kw-jump { display: none; } }
@media (prefers-reduced-motion: reduce) { .kw-knob { transition: none; } }
`;
