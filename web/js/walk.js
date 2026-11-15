// Прогулка от первого лица: WASD/стрелки, взгляд перетаскиванием, джойстик на телефоне, столкновения со стенами,
// прыжок (Пробел).
// Самодостаточный модуль: свою кнопку, подсказку, прицел и джойстик вставляет сам (стили на токенах страницы).
// API: initWalk({ THREE, camera, controls, canvas, plan, getObstacles, requestRender, onChange })
//   -> { active, walking, moving, running, enter(pos?, yaw?, { orbit }?), exit({ restore }?), toggle(), update(dt?),
//        boxesOf(object3d), setPersonHeight(cm), personHeight, eyeHeight, refreshObstacles(), setAreaGate(fn), orbitPose,
//        setZoom(k), kick(up, side, keep) }
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
  start: { x: 1.3, z: 4.3, yaw: 0 },   // холл у кухни, взгляд к окнам (−z)
  transition: 0.75,   // вход/выход, с
  jump: 3.0,          // скорость отрыва, м/с: подскок ~0.46 м, как у взрослого с места
  gravity: 9.81,      // м/с²
  headroom: 0.1,      // голова не выше потолка минус это, м
};

// Зоны снаружи квартиры, куда можно выйти через открытую дверь. Один источник и для прогулки, и для model.js
// (ограждение балкона и площадка у входной двери строятся по этим прямоугольникам).
export const OUTDOOR = {
  rail: 0.085,         // внутренняя грань ограждения балкона от края плиты, м
  landingDepth: 1.0,   // площадка за входной дверью, м от двери
  landingSide: 0.45,   // площадка шире двери на столько с каждой стороны, м
};
// -> [{ id, x0, x1, z0, z1, open }]: прямоугольник, по которому можно ходить; open — сторона к дому (там стена с дверью).
export function outdoorAreas(plan) {
  const out = [], b = plan.balcony, r = OUTDOOR.rail;
  if (b) out.push({ id: 'balcony', x0: b.x0 + r, x1: b.x1 - r, z0: b.z0 + r, z1: b.z1, open: 'z1' });
  const e = plan.openings.find(o => o.type === 'entry');
  if (e) out.push({ id: 'landing', x0: e.x0 - OUTDOOR.landingSide, x1: e.x1 + OUTDOOR.landingSide, z0: e.z1, z1: e.z1 + OUTDOOR.landingDepth, open: 'z0' });
  return out;
}

// Куда ведёт наружная дверь: { area: id | null, side: 'x0'|'x1'|'z0'|'z1' } — сторона проёма, что смотрит из квартиры.
export function areaBeyond(plan, o) {
  const X = o.along === 'x', c = X ? (o.x0 + o.x1) / 2 : (o.z0 + o.z1) / 2, d = 0.3;
  const sides = X ? [['z0', c, o.z0 - d], ['z1', c, o.z1 + d]] : [['x0', o.x0 - d, c], ['x1', o.x1 + d, c]];
  const pt = sides.map(([side, x, z]) => ({ side, x, z }));
  const inRoom = q => Object.entries(plan.rooms).some(([id, r]) => id !== 'shaft' && r.rects.some(t => q.x >= t.x0 && q.x <= t.x1 && q.z >= t.z0 && q.z <= t.z1));
  const out = pt.find(q => !inRoom(q)) ?? pt[0];
  const area = outdoorAreas(plan).find(a => out.x >= a.x0 - d && out.x <= a.x1 + d && out.z >= a.z0 - d && out.z <= a.z1 + d);
  return { area: area?.id ?? null, side: out.side };
}

// ---------- ядро: план -> препятствия ----------

// Где точка: id комнаты, 'door:<id>' в дверном проёме, id зоны снаружи ('balcony', 'landing'),
// null — вне квартиры (шахта тоже «вне»).
export function roomOf(plan, x, z) {
  for (const [id, r] of Object.entries(plan.rooms)) {
    if (id !== 'shaft' && r.rects.some(q => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1)) return id;
  }
  const d = plan.openings.find(o => o.type !== 'window' && x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1);
  if (d) return 'door:' + d.id;
  return outdoorAreas(plan).find(a => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1)?.id ?? null;
}

// Стены минус все дверные проёмы (межкомнатные, балконные, входная), плюс стойки коробок межкомнатных дверей
// и границы зон снаружи: ограждение балкона, стены площадки, «французский балкон» за дверью, которая никуда не ведёт.
// Окна остаются стеной. Полотна дверей и глухие части балконных рам — динамические, их даёт doors.js.
export function buildColliders(plan) {
  const holes = plan.openings.filter(o => o.type !== 'window');
  let boxes = plan.walls.map(w => ({ x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1 }));
  for (const o of holes) boxes = boxes.flatMap(b => subtractRect(b, o));
  for (const o of holes) {
    if (o.type !== 'interior') continue;
    const L = o.leaf ?? o.width - 0.1, jamb = (o.width - L) / 2;
    if (jamb <= 0.001) continue;
    if (o.along === 'x') boxes.push({ x0: o.x0, x1: o.x0 + jamb, z0: o.z0, z1: o.z1 }, { x0: o.x1 - jamb, x1: o.x1, z0: o.z0, z1: o.z1 });
    else boxes.push({ x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z0 + jamb }, { x0: o.x0, x1: o.x1, z0: o.z1 - jamb, z1: o.z1 });
  }
  // зоны снаружи: три стороны закрыты, сторона к дому открыта (там стена дома со своими проёмами)
  const F = 0.5;
  for (const a of outdoorAreas(plan)) {
    const zLo = a.open === 'z0' ? a.z0 : a.z0 - F, zHi = a.open === 'z1' ? a.z1 : a.z1 + F;
    boxes.push({ x0: a.x0 - F, x1: a.x0, z0: zLo, z1: zHi }, { x0: a.x1, x1: a.x1 + F, z0: zLo, z1: zHi });
    if (a.open !== 'z0') boxes.push({ x0: a.x0, x1: a.x1, z0: a.z0 - F, z1: a.z0 });
    if (a.open !== 'z1') boxes.push({ x0: a.x0, x1: a.x1, z0: a.z1, z1: a.z1 + F });
  }
  for (const o of holes) {
    if (o.type === 'interior') continue;
    const { area, side } = areaBeyond(plan, o);
    if (area) continue;
    const f = { x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1 };
    if (side === 'x1') { f.x0 = o.x1; f.x1 = o.x1 + F; } else if (side === 'x0') { f.x1 = o.x0; f.x0 = o.x0 - F; }
    else if (side === 'z1') { f.z0 = o.z1; f.z1 = o.z1 + F; } else { f.z1 = o.z0; f.z0 = o.z0 - F; }
    boxes.push(f);
  }
  return { boxes, segs: [] };
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
// Препятствие из списка extra: коробка или толстый отрезок (полотно двери).
const push = (p, b, r) => (b.ax !== undefined ? pushSeg(p, b, r) : pushBox(p, b, r));
function resolve(p, col, extra, r) {
  for (let i = 0; i < 8; i++) {
    let hit = false;
    for (const b of col.boxes) if (pushBox(p, b, r)) hit = true;
    for (const b of extra) if (push(p, b, r)) hit = true;
    for (const s of col.segs) if (pushSeg(p, s, r)) hit = true;
    if (!hit) return true;
  }
  return false;
}

// Свободна ли точка (круг никого не задевает).
export function isFree(p, col, extra = [], r = WALK.radius) {
  const q = { x: p.x, z: p.z };
  for (const b of col.boxes) if (pushBox(q, b, r - 1e-4)) return false;
  for (const b of extra) if (push(q, b, r - 1e-4)) return false;
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
// Если в той же комнате места нет (стоял в дверном проёме, а полотно закрылось), — любое место в квартире рядом.
export function findFree(plan, p, col, extra = [], r = WALK.radius) {
  const room = roomOf(plan, p.x, p.z);
  const search = same => {
    if (same(p) && isFree(p, col, extra, r)) return { x: p.x, z: p.z };
    for (let d = 0.05; d <= 2.0; d += 0.05) {
      const n = Math.max(8, Math.round((2 * Math.PI * d) / 0.05));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, q = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d };
        if (same(q) && isFree(q, col, extra, r)) return q;
      }
    }
    return null;
  };
  const any = q => roomOf(plan, q.x, q.z) != null;
  return (room ? search(q => roomOf(plan, q.x, q.z) === room) : null) ?? search(any);
}

// Препятствия в любом виде -> { x0, x1, z0, z1 } или отрезок { ax, az, bx, bz, h } как есть
function normBoxes(list) {
  const out = [];
  for (const b of list || []) {
    if (!b) continue;
    if (b.ax !== undefined) out.push(b);
    else if (b.min && b.max) { if (b.max.x > b.min.x && b.max.z > b.min.z) out.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z }); }
    else if (b.x1 > b.x0 && b.z1 > b.z0) out.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 });
  }
  return out;
}

// ---------- режим прогулки ----------

// E — «использовать» (двери, doors.js), поэтому поворот только стрелками
const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
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
  const dock = ensureDock();
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'kw-btn';
  btn.setAttribute('aria-pressed', 'false');
  dock.appendChild(btn);
  const hint = div('kw-hint kw-float', document.body); hint.hidden = true; hint.setAttribute('role', 'status');
  const joyEl = div('kw-joy kw-float', document.body); joyEl.hidden = true;
  joyEl.setAttribute('aria-hidden', 'true');
  const knob = div('kw-knob', joyEl);
  // прыжок на телефоне — круглая кнопка справа, над кнопками оружия (viewmodel.js)
  const jumpEl = document.createElement('button');
  jumpEl.type = 'button'; jumpEl.className = 'kw-jump kw-float'; jumpEl.hidden = true; jumpEl.setAttribute('aria-label', 'Прыжок');
  jumpEl.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  document.body.appendChild(jumpEl);
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
      ? 'Джойстик — идти · веди пальцем — смотреть · наведи на дверь — открыть · план — перейти · с оружием: кнопки огня и прицела справа'
      : '<b>W A S D</b> — идти · тяни мышью — смотреть · <b>E</b> или клик — дверь · <b>Shift</b> — быстрее · <b>Пробел</b> — прыжок · <b>2</b>–<b>5</b> — оружие, <b>1</b> — убрать · <b>ПКМ</b> — прицел · <b>R</b> — перезарядка · <b>Esc</b> — выход';
    hint.hidden = false; hint.classList.remove('fade');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.classList.add('fade'); hintTimer = setTimeout(() => { hint.hidden = true; }, 450); }, 5500);
  };
  const hideHint = () => { clearTimeout(hintTimer); hint.hidden = true; };
  const syncFloat = () => {
    joyEl.hidden = !(mode === 'walk' || mode === 'entering') || !(touchSeen || coarse());
    jumpEl.hidden = joyEl.hidden;
    cross.hidden = mode !== 'walk';
    document.body.classList.toggle('kw-walking', mode !== 'off');
  };

  // ---------- вход и выход ----------

  function enter(pos, yawArg, { orbit } = {}) {
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
    renderBtn(); syncFloat(); showHint();
    onChange?.(true);
    requestRender?.();
    return true;
  }

  function exit({ restore = true } = {}) {
    jy = vy = 0;
    if (mode === 'off' || mode === 'exiting') return;
    keys.clear(); joyRelease(); lookRelease(); moving = running = false;
    zoom = 1; kp = ky = kpT = kyT = 0;
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
    camera.position.set(p.x, eye + jy, p.z);
    camera.rotation.set(clamp(pitch + kp, -PITCH, PITCH), yaw + ky, 0, 'YXZ');
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // цель орбиты держим на сантиметр впереди: если кто-то вызовет controls.update(), взгляд не собьётся
    const f = fwd(), cp = Math.cos(pitch);
    controls.target.set(p.x + f.x * cp * 0.01, eye + jy + Math.sin(pitch) * 0.01, p.z + f.z * cp * 0.01);
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
    if (!isFree(p, col, extra)) { const f = findFree(plan, p, col, extra); if (f) { p.x = f.x; p.z = f.z; } }

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

    const mx = vel.x * dt + fw.x * take, mz = vel.z * dt + fw.z * take;
    const px0 = p.x, pz0 = p.z;
    if (mx || mz) {
      const px = p.x, pz = p.z;
      moveCircle(p, mx, mz, col, extra);
      // упёрлись — скорость = фактическая (скольжение вдоль стены без накопления)
      if (dt > 0 && (vel.x || vel.z)) {
        const ax = (p.x - px) / dt, az = (p.z - pz) / dt;
        if (Math.hypot(ax, az) < Math.hypot(vel.x, vel.z) - 1e-3) { vel.x = ax; vel.z = az; }
      }
    }

    // прыжок: баллистика, голова не выше потолка (в квартире), приземление — на пол
    if (vy || jy) {
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

  function jump() { if (mode === 'walk' && jy === 0 && !anim) { vy = WALK.jump; requestRender?.(); } }

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
    setPersonHeight, setZoom, kick,
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
.kw-hint[hidden], .kw-joy[hidden], .kw-cross[hidden], .kw-jump[hidden] { display: none; }
.kw-jump { position: fixed; z-index: 5; right: max(20px, calc(env(safe-area-inset-right, 0px) + 12px)); bottom: calc(196px + env(safe-area-inset-bottom, 0px));
  width: 56px; height: 56px; padding: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: var(--kw-ink);
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; border: 1px solid var(--kw-line);
  background: color-mix(in srgb, var(--kw-sheet) 88%, transparent); box-shadow: var(--kw-shadow); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.kw-jump:active { transform: scale(0.94); }
.kw-joy { position: fixed; z-index: 5; left: max(20px, calc(env(safe-area-inset-left, 0px) + 12px)); bottom: calc(76px + env(safe-area-inset-bottom, 0px));
  width: 112px; height: 112px; border-radius: 50%; display: grid; place-items: center; touch-action: none; user-select: none; -webkit-user-select: none;
  background: color-mix(in srgb, var(--kw-sheet) 80%, transparent); border: 1px solid var(--kw-line); box-shadow: var(--kw-shadow);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.kw-knob { width: 46px; height: 46px; border-radius: 50%; background: var(--kw-accent); opacity: 0.9; pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22); transition: transform 0.14s ease-out; }
.kw-joy.drag .kw-knob { transition: none; }
.kw-cross { position: fixed; z-index: 5; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%;
  background: var(--kw-sheet); box-shadow: 0 0 0 1.5px var(--kw-ink); pointer-events: none; opacity: 0.8; transition: opacity 0.12s ease; }
body.kvm-ads .kw-cross { opacity: 0; }   /* смотрим через прицел оружия (viewmodel.js) */
@media (max-width: 760px) {
  .kw-hint { bottom: calc(200px + env(safe-area-inset-bottom, 0px)); }
  body:has(#panel.open) .kw-joy, body:has(#panel.open) .kw-hint, body:has(#panel.open) .kw-jump { display: none; }
}
@media (prefers-reduced-motion: reduce) { .kw-hint, .kw-knob { transition: none; } }
`;
