// Pure shared apartment collision. No renderer, browser globals or module side effects.

export function subtractRect(b, h) {
  if (h.x0 >= b.x1 || h.x1 <= b.x0 || h.z0 >= b.z1 || h.z1 <= b.z0) return [b];
  const out = [], e = 1e-4;
  const push = (x0, x1, z0, z1) => { if (x1 - x0 > e && z1 - z0 > e) out.push({ ...b, x0, x1, z0, z1 }); };
  const mx0 = Math.max(b.x0, h.x0), mx1 = Math.min(b.x1, h.x1);
  push(b.x0, mx0, b.z0, b.z1);
  push(mx1, b.x1, b.z0, b.z1);
  push(mx0, mx1, b.z0, Math.max(b.z0, h.z0));
  push(mx0, mx1, Math.min(b.z1, h.z1), b.z1);
  return out;
}

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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
export function pushCircle(p, other, r) {
  const radius = r + (other.radius ?? WALK.radius), dx = p.x - other.x, dz = p.z - other.z;
  const d = Math.hypot(dx, dz);
  if (d >= radius - 1e-7) return false;
  if (d < 1e-9) { p.x += radius; return true; }
  const k = (radius - d) / d;
  p.x += dx * k; p.z += dz * k;
  return true;
}
const push = (p, b, r) => (b.ax !== undefined ? pushSeg(p, b, r) : b.radius !== undefined ? pushCircle(p, b, r) : pushBox(p, b, r));
function resolve(p, col, extra, r) {
  for (let i = 0; i < 8; i++) {
    let hit = false;
    for (const b of col.boxes || []) if (pushBox(p, b, r)) hit = true;
    for (const b of extra) if (push(p, b, r)) hit = true;
    for (const s of col.segs || []) if (pushSeg(p, s, r)) hit = true;
    if (!hit) return true;
  }
  return false;
}

// Свободна ли точка (круг никого не задевает).
export function isFree(p, col, extra = [], r = WALK.radius) {
  const q = { x: p.x, z: p.z };
  for (const b of col.boxes || []) if (pushBox(q, b, r - 1e-4)) return false;
  for (const b of extra) if (push(q, b, r - 1e-4)) return false;
  for (const s of col.segs || []) if (pushSeg(q, s, r - 1e-4)) return false;
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
export function normalizeColliders(list) {
  const out = [];
  for (const b of list || []) {
    if (!b) continue;
    if (b.ax !== undefined) out.push(b);
    else if (Number.isFinite(b.x) && Number.isFinite(b.z) && Number.isFinite(b.radius)) out.push({ x: b.x, z: b.z, radius: b.radius });
    else if (b.min && b.max) { if (b.max.x > b.min.x && b.max.z > b.min.z) out.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z }); }
    else if (b.x1 > b.x0 && b.z1 > b.z0) out.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 });
  }
  return out;
}
