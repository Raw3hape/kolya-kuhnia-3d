// Прогулка от первого лица: WASD/стрелки, взгляд перетаскиванием, джойстик на телефоне, столкновения со стенами.
// Самодостаточный модуль: свою кнопку, подсказку и джойстик вставляет сам (стили на токенах страницы).
// API: initWalk({ THREE, camera, controls, canvas, plan, getObstacles, requestRender, onChange })
//   -> { active, walking, enter(pos?, yaw?), exit({ restore }?), toggle(), update(dt?), boxesOf(object3d),
//        setPersonHeight(cm), personHeight, eyeHeight }   рост по умолчанию 180 см -> глаза 1.68 м
//   update(dt) звать каждый кадр; true — камера сдвинулась, нужен кадр. dt в секундах (можно не передавать).
//   getObstacles() -> [{ x0, x1, z0, z1 } | THREE.Box3]: мебель в плане XZ (кухонный ряд, остров, холодильник).
//   onChange(active) — режим включился/выключился (на время прогулки выключить вырез стен).
// Ядро столкновений (buildColliders, moveCircle, findFree, roomOf) — чистые функции без DOM, их проверяет тест в node.

import { ensureDock, injectStyle, subtractRect } from './minimap.js';

export const WALK = {
  height: 180,        // рост по умолчанию, см; глаза = рост · 0.933 (180 см -> 1.68 м)
  eyeRatio: 0.933,
  radius: 0.22,       // «тело» в плане, м
  walk: 1.4,          // шаг, м/с
  run: 3.0,           // с Shift, м/с
  turn: 1.9,          // поворот стрелками, рад/с
  // Обзор как у человека: вертикальный 55°; горизонтальный не шире 88° (широкие экраны),
  // на портретном экране вертикальный растёт, чтобы по горизонтали было хотя бы ~60°. Щипок/колесо — в пределах 40–75°.
  fovV: 55, fovHMax: 88, fovHMinPortrait: 60, fovMin: 40, fovMax: 75,
  pitch0: -5,         // начальный взгляд чуть вниз, градусы
  pitchMax: 80,       // наклон взгляда, градусы
  doorAngle: 85,      // межкомнатные полотна открыты на этот угол (как в model.js)
  start: { x: 1.3, z: 4.3, yaw: 0 },   // холл у кухни, взгляд к окнам (−z)
  transition: 0.75,   // вход/выход, с
};

// ---------- ядро: план -> препятствия ----------

// Где точка: id комнаты, 'door:<id>' в межкомнатном проёме, null — вне квартиры (шахта и балкон тоже «вне»).
export function roomOf(plan, x, z) {
  for (const [id, r] of Object.entries(plan.rooms)) {
    if (id !== 'shaft' && r.rects.some(q => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1)) return id;
  }
  const d = plan.openings.find(o => o.type === 'interior' && x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1);
  return d ? 'door:' + d.id : null;
}

// Стены минус межкомнатные проёмы (они открыты), плюс стойки коробок и открытые полотна.
// Окна, балконные и входная дверь закрыты: их проёмы остаются стеной.
export function buildColliders(plan, { doorAngle = WALK.doorAngle } = {}) {
  const doors = plan.openings.filter(o => o.type === 'interior');
  let boxes = plan.walls.map(w => ({ x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1 }));
  for (const o of doors) boxes = boxes.flatMap(b => subtractRect(b, o));
  const segs = [];
  for (const o of doors) {
    const X = o.along === 'x', L = o.leaf ?? o.width - 0.1, jamb = (o.width - L) / 2;
    if (jamb > 0.001) {
      if (X) boxes.push({ x0: o.x0, x1: o.x0 + jamb, z0: o.z0, z1: o.z1 }, { x0: o.x1 - jamb, x1: o.x1, z0: o.z0, z1: o.z1 });
      else boxes.push({ x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z0 + jamb }, { x0: o.x0, x1: o.x1, z0: o.z1 - jamb, z1: o.z1 });
    }
    // Полотно — та же формула, что в model.js buildInteriorDoor (оси u вдоль стены, t поперёк)
    const cu = X ? (o.x0 + o.x1) / 2 : (o.z0 + o.z1) / 2, ct = X ? (o.z0 + o.z1) / 2 : (o.x0 + o.x1) / 2;
    const T = X ? o.z1 - o.z0 : o.x1 - o.x0, W = o.width / 2, lt = 0.04, a = (doorAngle * Math.PI) / 180;
    const start = o.hinge === 'start', sw = o.swing ?? 1;
    const hu = start ? -W + jamb : W - jamb, ht = sw * (T / 2 - lt / 2);
    const du = (start ? 1 : -1) * Math.cos(a), dt = sw * Math.sin(a);
    const [hx, hz] = X ? [cu + hu, ct + ht] : [ct + ht, cu + hu];
    const [wx, wz] = X ? [du, dt] : [dt, du];
    segs.push({ ax: hx, az: hz, bx: hx + wx * L, bz: hz + wz * L, h: lt / 2, door: o.id });
  }
  return { boxes, segs };
}

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

// Вытолкнуть круг из прямоугольника; true — было пересечение.
function pushBox(p, b, r) {
  const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
  const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r - 1e-12) return false;
  if (d2 > 1e-12) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; return true; }
  // центр внутри: к ближайшей грани
  const l = p.x - b.x0, rr = b.x1 - p.x, t = p.z - b.z0, bb = b.z1 - p.z, m = Math.min(l, rr, t, bb);
  if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === t) p.z = b.z0 - r; else p.z = b.z1 + r;
  return true;
}
// Вытолкнуть из толстого отрезка (полотно двери).
function pushSeg(p, s, r) {
  const vx = s.bx - s.ax, vz = s.bz - s.az, len2 = vx * vx + vz * vz || 1e-9;
  const t = clamp(((p.x - s.ax) * vx + (p.z - s.az) * vz) / len2, 0, 1);
  const cx = s.ax + vx * t, cz = s.az + vz * t, R = r + s.h;
  let dx = p.x - cx, dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= R * R - 1e-12) return false;
  if (d2 < 1e-12) { dx = -vz; dz = vx; }
  const d = Math.hypot(dx, dz);
  p.x = cx + (dx / d) * R; p.z = cz + (dz / d) * R;
  return true;
}
function resolve(p, col, extra, r) {
  for (let i = 0; i < 8; i++) {
    let hit = false;
    for (const b of col.boxes) if (pushBox(p, b, r)) hit = true;
    for (const b of extra) if (pushBox(p, b, r)) hit = true;
    for (const s of col.segs) if (pushSeg(p, s, r)) hit = true;
    if (!hit) return true;
  }
  return false;
}

// Свободна ли точка (круг никого не задевает).
export function isFree(p, col, extra = [], r = WALK.radius) {
  const q = { x: p.x, z: p.z };
  for (const b of col.boxes) if (pushBox(q, b, r - 1e-4)) return false;
  for (const b of extra) if (pushBox(q, b, r - 1e-4)) return false;
  for (const s of col.segs) if (pushSeg(q, s, r - 1e-4)) return false;
  return true;
}

// Сдвиг с подшагами (короче четверти радиуса — сквозь тонкую стену не проскочить) и скольжением вдоль стен.
// Если подшаг не удаётся развести (щель уже тела) — остаёмся на последнем свободном месте.
export function moveCircle(p, dx, dz, col, extra = [], r = WALK.radius) {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * 0.25)));
  for (let i = 0; i < n; i++) {
    const px = p.x, pz = p.z;
    p.x += dx / n; p.z += dz / n;
    if (!resolve(p, col, extra, r) || Math.hypot(p.x - px, p.z - pz) > r) { p.x = px; p.z = pz; break; }
  }
  return p;
}

// Ближайшее свободное место в той же комнате (для входа и телепорта: клик по столешнице -> рядом с ней, а не за стеной).
export function findFree(plan, p, col, extra = [], r = WALK.radius) {
  const room = roomOf(plan, p.x, p.z);
  const same = q => { const id = roomOf(plan, q.x, q.z); return room ? id === room : id != null; };
  if (same(p) && isFree(p, col, extra, r)) return { x: p.x, z: p.z };
  for (let d = 0.05; d <= 2.0; d += 0.05) {
    const n = Math.max(8, Math.round((2 * Math.PI * d) / 0.05));
    let best = null;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, q = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d };
      if (same(q) && isFree(q, col, extra, r)) { best = q; break; }
    }
    if (best) return best;
  }
  return null;
}

// Препятствия в любом виде -> { x0, x1, z0, z1 }
function normBoxes(list) {
  const out = [];
  for (const b of list || []) {
    if (!b) continue;
    if (b.min && b.max) { if (b.max.x > b.min.x && b.max.z > b.min.z) out.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z }); }
    else if (b.x1 > b.x0 && b.z1 > b.z0) out.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 });
  }
  return out;
}

// ---------- режим прогулки ----------

const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const coarse = () => { try { return matchMedia('(hover: none), (pointer: coarse)').matches; } catch { return false; } };
const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function initWalk({ THREE, camera, controls, canvas, plan, getObstacles, requestRender, onChange }) {
  const col = buildColliders(plan);
  let extra = [], obstaclesAt = -1;
  const refreshObstacles = force => {
    const now = performance.now();
    if (!force && now - obstaclesAt < 750) return;
    obstaclesAt = now;
    try { extra = normBoxes(getObstacles?.()); } catch { extra = []; }
  };

  // состояние
  let mode = 'off';                 // off | entering | walk | exiting
  const p = { x: 0, z: 0 };
  const vel = { x: 0, z: 0 };
  let yaw = 0, pitch = 0, tYaw = 0, tPitch = 0, turnVel = 0, fov = WALK.fovV, tFov = WALK.fovV, fovAdj = 0, step = 0;
  let heightCm = WALK.height, eye = (WALK.height * WALK.eyeRatio) / 100;
  let saved = null, anim = null, lastT = 0, touchSeen = false, locked = false, unlockedAt = 0;
  const keys = new Set();
  const joy = { id: null, x: 0, y: 0 };
  const PITCH = (WALK.pitchMax * Math.PI) / 180;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ'), q = new THREE.Quaternion();
  const quatOf = (y, pt) => new THREE.Quaternion().setFromEuler(euler.set(pt, y, 0, 'YXZ'));
  const fwd = () => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

  // ---------- разметка ----------
  injectStyle('kw-style', WALK_CSS);
  const dock = ensureDock();
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'kw-btn';
  btn.setAttribute('aria-pressed', 'false');
  dock.appendChild(btn);
  const hint = div('kw-hint kw-float', document.body); hint.hidden = true; hint.setAttribute('role', 'status');
  const joyEl = div('kw-joy kw-float', document.body); joyEl.hidden = true;
  joyEl.setAttribute('aria-hidden', 'true');
  const knob = div('kw-knob', joyEl);
  const cross = div('kw-cross kw-float', document.body); cross.hidden = true;

  const ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8.6" cy="2.5" r="1.6" fill="currentColor"/><path d="M8.2 5.4 6.6 9.5l2.2 1.6.5 3.6M8 5.9l2.6 2.2 1.8.1M6.6 9.5l-1.8 4.9M8 5.9l-2.6 1.2-.8 2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const renderBtn = () => {
    const on = mode !== 'off';
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Выйти из прогулки (Esc)' : 'Пройтись по квартире от первого лица (F)';
    btn.innerHTML = on ? `${ICON}<span>Выйти</span><kbd>Esc</kbd>` : `${ICON}<span>Прогулка</span><kbd>F</kbd>`;
  };
  renderBtn();
  btn.addEventListener('click', () => toggle());

  let hintTimer = 0;
  const showHint = () => {
    const touch = touchSeen || coarse();
    hint.innerHTML = touch
      ? 'Джойстик — идти · веди пальцем — смотреть · план — перейти'
      : '<b>W A S D</b> — идти · тяни мышью — смотреть · <b>Shift</b> — быстрее · колесо — шаг · <b>Esc</b> — выход';
    hint.hidden = false; hint.classList.remove('fade');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.classList.add('fade'); hintTimer = setTimeout(() => { hint.hidden = true; }, 450); }, 5500);
  };
  const hideHint = () => { clearTimeout(hintTimer); hint.hidden = true; };
  const syncFloat = () => {
    joyEl.hidden = !(mode === 'walk' || mode === 'entering') || !(touchSeen || coarse());
    cross.hidden = !(locked && mode === 'walk');
    document.body.classList.toggle('kw-walking', mode !== 'off');
  };

  // ---------- вход и выход ----------

  function enter(pos, yawArg) {
    if (mode === 'entering' || mode === 'exiting') return false;
    refreshObstacles(true);
    if (mode === 'walk') {
      // телепорт внутри прогулки: только в квартиру
      if (!pos || roomOf(plan, pos.x, pos.z) == null) return false;
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
    saved = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, order: camera.rotation.order };
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const camYaw = Math.hypot(dir.x, dir.z) > 0.15 ? Math.atan2(-dir.x, -dir.z) : WALK.start.yaw;
    const from = pos ?? { x: camera.position.x, z: camera.position.z };
    let start = roomOf(plan, from.x, from.z) != null ? findFree(plan, from, col, extra) : null;
    let y0 = yawArg ?? camYaw;
    if (!start) { start = findFree(plan, WALK.start, col, extra) || { ...WALK.start }; y0 = yawArg ?? WALK.start.yaw; }
    p.x = start.x; p.z = start.z;
    vel.x = vel.z = 0; step = 0; turnVel = 0;
    yaw = tYaw = y0; pitch = tPitch = (WALK.pitch0 * Math.PI) / 180;
    fovAdj = 0; fov = tFov = naturalFov(camera.aspect);
    controls.enabled = false;
    camera.rotation.reorder('YXZ');   // reorder сохраняет поворот (а присвоение .order — нет)
    mode = 'entering';
    anim = { t: 0, dur: reduced() ? 0 : WALK.transition, kind: 'enter',
      fromPos: saved.pos.clone(), toPos: new THREE.Vector3(p.x, eye, p.z),
      fromQ: camera.quaternion.clone(), toQ: quatOf(yaw, pitch), fromFov: camera.fov, toFov: fov,
      end: () => { mode = 'walk'; syncFloat(); } };
    lastT = performance.now();
    renderBtn(); syncFloat(); showHint();
    onChange?.(true);
    requestRender?.();
    return true;
  }

  function exit({ restore = true } = {}) {
    if (mode === 'off' || mode === 'exiting') return;
    keys.clear(); joyRelease(); lookRelease();
    if (locked) { try { document.exitPointerLock(); } catch { /* нет блокировки */ } }
    hideHint();
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
    renderBtn(); syncFloat();
    requestRender?.();
  }

  function finish() {
    mode = 'off'; anim = null;
    controls.enabled = true;
    controls.update?.();
    renderBtn(); syncFloat();
    onChange?.(false);
    requestRender?.();
  }

  function toggle() { if (mode === 'off') enter(); else if (mode === 'walk') exit(); }

  // ---------- кадр ----------

  let applied = '';
  function apply() {
    camera.position.set(p.x, eye, p.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // цель орбиты держим на сантиметр впереди: если кто-то вызовет controls.update(), взгляд не собьётся
    const f = fwd(), cp = Math.cos(pitch);
    controls.target.set(p.x + f.x * cp * 0.01, eye + Math.sin(pitch) * 0.01, p.z + f.z * cp * 0.01);
  }

  function update(dt) {
    if (mode === 'off') return false;
    const now = performance.now();
    if (dt == null) dt = (now - lastT) / 1000;
    lastT = now;
    dt = clamp(dt, 0, 0.05);

    if (anim) {
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
    if (!isFree(p, col, extra)) { const f = findFree(plan, p, col, extra); if (f) { p.x = f.x; p.z = f.z; } }

    // поворот стрелками
    const turnIn = (keys.has('ArrowLeft') || keys.has('KeyQ') ? 1 : 0) - (keys.has('ArrowRight') || keys.has('KeyE') ? 1 : 0);
    turnVel += (turnIn * WALK.turn - turnVel) * (1 - Math.exp(-10 * dt));
    if (!turnIn && Math.abs(turnVel) < 1e-3) turnVel = 0;
    tYaw += turnVel * dt;

    // ход
    let f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    let s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? WALK.run : WALK.walk;
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

    const mx = vel.x * dt + fw.x * take, mz = vel.z * dt + fw.z * take;
    if (mx || mz) {
      const px = p.x, pz = p.z;
      moveCircle(p, mx, mz, col, extra);
      // упёрлись — скорость = фактическая (скольжение вдоль стены без накопления)
      if (dt > 0 && (vel.x || vel.z)) {
        const ax = (p.x - px) / dt, az = (p.z - pz) / dt;
        if (Math.hypot(ax, az) < Math.hypot(vel.x, vel.z) - 1e-3) { vel.x = ax; vel.z = az; }
      }
    }

    // взгляд и угол обзора — с лёгким сглаживанием; обзор следует за пропорциями окна (поворот телефона)
    tFov = clamp(naturalFov(camera.aspect) + fovAdj, WALK.fovMin, WALK.fovMax);
    tPitch = clamp(tPitch, -PITCH, PITCH);
    const lk = 1 - Math.exp(-24 * dt);
    yaw += (tYaw - yaw) * lk; pitch += (tPitch - pitch) * lk; fov += (tFov - fov) * lk;
    if (Math.abs(tYaw - yaw) < 1e-4) yaw = tYaw;
    if (Math.abs(tPitch - pitch) < 1e-4) pitch = tPitch;
    if (Math.abs(tFov - fov) < 1e-3) fov = tFov;

    const key = `${p.x.toFixed(4)}|${p.z.toFixed(4)}|${yaw.toFixed(5)}|${pitch.toFixed(5)}|${fov.toFixed(3)}`;
    if (key === applied) return false;
    applied = key;
    apply();
    return true;
  }

  // ---------- ввод ----------

  addEventListener('keydown', e => {
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'KeyF') { if (!e.repeat) toggle(); e.preventDefault(); return; }
    if (mode === 'off') return;
    if (e.code === 'Escape') {
      if (performance.now() - unlockedAt > 250) exit();   // Esc, снявший захват мыши, из прогулки не выводит
      return;
    }
    if (MOVE.has(e.code)) { keys.add(e.code); e.preventDefault(); requestRender?.(); }
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
    if (e.pointerType === 'mouse' && e.button !== 0) return;
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

  return {
    get active() { return mode !== 'off'; },
    get walking() { return mode === 'walk'; },
    get personHeight() { return heightCm; },
    get eyeHeight() { return eye; },
    setPersonHeight,
    enter, exit, toggle, update, boxesOf,
    colliders: col,
  };
}

function div(cls, parent) { const d = document.createElement('div'); d.className = cls; parent.appendChild(d); return d; }

// Токены: --kw-* задаёт #kw-dock и .kw-float (minimap.js); здесь только сами элементы.
const WALK_CSS = `
.kw-btn { order: 2; display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--kw-line); background: var(--kw-sheet); color: var(--kw-ink);
  font: 500 13px/1 var(--f-body, "Inter", "Helvetica Neue", Arial, sans-serif); padding: 8px 10px 8px 9px; border-radius: 4px; box-shadow: var(--kw-shadow);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); cursor: pointer; min-height: 34px; }
.kw-btn:hover { border-color: var(--kw-accent); }
.kw-btn:focus-visible { outline: 2px solid var(--kw-accent); outline-offset: 2px; }
.kw-btn.on { background: var(--kw-accent); color: var(--kw-accent-ink); border-color: var(--kw-accent); }
.kw-btn kbd { font: 500 10.5px/1 var(--f-data, ui-monospace, Menlo, monospace); padding: 2px 4px; border: 1px solid currentColor; border-radius: 3px; opacity: 0.55; }
@media (hover: none), (pointer: coarse) { .kw-btn kbd { display: none; } }
.kw-hint { position: fixed; z-index: 5; left: 50%; transform: translateX(-50%); bottom: calc(76px + env(safe-area-inset-bottom, 0px));
  max-width: calc(100vw - 32px); box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--kw-line); border-radius: 4px;
  background: var(--kw-sheet); color: var(--kw-ink); box-shadow: var(--kw-shadow); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  font: 12.5px/1.45 var(--f-body, "Inter", Arial, sans-serif); text-align: center; pointer-events: none; transition: opacity 0.4s ease; }
.kw-hint b { font-weight: 600; }
.kw-hint.fade { opacity: 0; }
.kw-hint[hidden], .kw-joy[hidden], .kw-cross[hidden] { display: none; }
.kw-joy { position: fixed; z-index: 5; left: max(20px, calc(env(safe-area-inset-left, 0px) + 12px)); bottom: calc(76px + env(safe-area-inset-bottom, 0px));
  width: 112px; height: 112px; border-radius: 50%; display: grid; place-items: center; touch-action: none; user-select: none; -webkit-user-select: none;
  background: color-mix(in srgb, var(--kw-sheet) 80%, transparent); border: 1px solid var(--kw-line); box-shadow: var(--kw-shadow);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.kw-knob { width: 46px; height: 46px; border-radius: 50%; background: var(--kw-accent); opacity: 0.9; pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22); transition: transform 0.14s ease-out; }
.kw-joy.drag .kw-knob { transition: none; }
.kw-cross { position: fixed; z-index: 5; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%;
  background: var(--kw-sheet); box-shadow: 0 0 0 1.5px var(--kw-ink); pointer-events: none; opacity: 0.8; }
@media (max-width: 760px) {
  .kw-hint { bottom: calc(200px + env(safe-area-inset-bottom, 0px)); }
  body:has(#panel.open) .kw-joy, body:has(#panel.open) .kw-hint { display: none; }
}
@media (prefers-reduced-motion: reduce) { .kw-hint, .kw-knob { transition: none; } }
`;
