// Геометрия: оболочка квартиры из plan.generated.json и кухня из kitchen.json.
// Все размеры в метрах. Оси: X вдоль оконной стены, Z вглубь квартиры, Y вверх.
// UV у всех коробок в метрах (boxUV), чтобы текстуры лежали в реальном масштабе.
// Двери с петлями: полотно/створка — группа-пивот на оси петель с userData.door
// { id, closed, open (rotation.y, рад), isOpen, dir (±1: полотно вдоль ±X пивота), length, thick }.
// Открывает и закрывает их doors.js; у наружных проёмов userData.passage — чистый проход створки в плане.
import * as THREE from 'three';
import { outdoorAreas, areaBeyond } from './walk.js';
import { compactMaterialGroups } from './material-groups.js';

// Углы открытия по умолчанию: межкомнатные открыты, наружные (балконные, входная) закрыты
const DOOR_OPEN = { interior: 85, exterior: 90 };

// Зоны: открытое пространство (кухня-гостиная + холл) делит пол линией state.split, у комнат свои слоты
const ROOM_WALLS = { room2: 'wallsRoom2', room3: 'wallsRoom3', bath: 'wallsBath' };
const ROOM_FLOORS = { room2: 'floorRoom2', room3: 'floorRoom3', bath: 'floorBath' };

// ---------- примитивы ----------

export function boxUV(g, xmin, ymin, zmin) {
  const p = g.parameters, uv = g.attributes.uv;
  const dims = [[p.depth, p.height], [p.depth, p.height], [p.width, p.depth], [p.width, p.depth], [p.width, p.height], [p.width, p.height]];
  const offs = [[zmin, ymin], [zmin, ymin], [xmin, zmin], [xmin, zmin], [xmin, ymin], [xmin, ymin]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] + offs[f][0], uv.getY(i) * dims[f][1] + offs[f][1]);
  }
  return g;
}

// Коробка по границам [x0,x1]×[y0,y1]×[z0,z1].
export function boxAt(x0, x1, y0, y1, z0, z1, mat, opts = {}) {
  const w = Math.max(x1 - x0, 1e-4), h = Math.max(y1 - y0, 1e-4), d = Math.max(z1 - z0, 1e-4);
  const g = boxUV(new THREE.BoxGeometry(w, h, d), x0, y0, z0);
  const m = new THREE.Mesh(g, mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  if (opts.slot) m.userData.slot = opts.slot;
  return m;
}

// Коробка минус коробка (оба выровнены по осям) -> список коробок.
function subtract(a, b) {
  const ov = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0;
  if (!ov) return [a];
  const out = [];
  const push = o => { if (o.x1 - o.x0 > 1e-4 && o.y1 - o.y0 > 1e-4 && o.z1 - o.z0 > 1e-4) out.push(o); };
  push({ ...a, x1: b.x0 });
  push({ ...a, x0: b.x1 });
  const mx = { ...a, x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1) };
  push({ ...mx, y1: b.y0 });
  push({ ...mx, y0: b.y1 });
  const my = { ...mx, y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) };
  push({ ...my, z1: b.z0 });
  push({ ...my, z0: b.z1 });
  return out;
}

function cyl(r, h, mat, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---------- оболочка квартиры ----------

// Зона (id комнаты) в точке плана; шахта зоной не считается.
function zoneAt(plan, x, z) {
  for (const [id, r] of Object.entries(plan.rooms)) {
    if (id !== 'shaft' && r.rects.some(q => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1)) return id;
  }
  return null;
}

// Низ стен = низ плиты балкона: фасад закрыт до плиты, между плитой и стеной нет щели.
const WALL_BASE = -0.22;
// Стыкующиеся коробки стен заходят друг в друга на 0.5 мм: шов без щели от округления float.
const JOIN = 0.0005;
// Грани коробки [+x,−x,+y,−y,+z,−z] по оси и стороне.
const FACE = { x1: 0, x0: 1, y1: 2, y0: 3, z1: 4, z0: 5 };

// Стены плана (уже на всю толщину, см. solidify в extract_plan.py) -> коробки модели:
// разрез вдоль по границам комнат (у каждой грани одна зона), склейка соседних кусков с теми же зонами,
// вырез проёмов, нахлёст на стыках. Двери режут стену до низа (под ними пол или подложка), окна — от подоконника.
function wallParts(plan) {
  const rects = Object.values(plan.rooms).flatMap(r => r.rects);
  const cuts = { x: [...new Set(rects.flatMap(r => [r.x0, r.x1]))], z: [...new Set(rects.flatMap(r => [r.z0, r.z1]))] };
  const holes = plan.openings.map(o => ({ x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1, y0: o.sill > 0 ? o.sill : WALL_BASE - 1, y1: o.head }));
  const out = [];
  for (const w of plan.walls) {
    const ax = w.x1 - w.x0 >= w.z1 - w.z0 ? 'x' : 'z', a0 = w[ax + '0'], a1 = w[ax + '1'];
    const sides = ax === 'x' ? [4, 5] : [0, 1];
    const cs = [a0, ...cuts[ax].filter(c => c > a0 + 1e-3 && c < a1 - 1e-3).sort((p, q) => p - q), a1];
    const merged = [];
    let prev = null;
    for (let i = 1; i < cs.length; i++) {
      const p = { ...w, y0: WALL_BASE, y1: plan.ceiling, [ax + '0']: cs[i - 1], [ax + '1']: cs[i] };
      const key = sides.map(f => faceSlot(plan, p, f)).join();
      if (key === prev) merged[merged.length - 1][ax + '1'] = cs[i];
      else merged.push(p);
      prev = key;
    }
    let parts = merged;
    for (const h of holes) parts = parts.flatMap(p => subtract(p, h));
    out.push(...parts);
  }
  return joinSeams(plan, out);
}

// Грань, целиком прижатая к соседним коробкам, выдвигается в них на JOIN. Не выдвигается, если в нахлёсте
// её боковая грань совпала бы с гранью соседа другого цвета (иначе там будет z-fighting).
function joinSeams(plan, parts) {
  const E = 1e-6, axes = ['x', 'y', 'z'];
  const grow = parts.map(a => {
    const g = {};
    for (const k of axes) for (const s of ['0', '1']) {
      const c = a[k + s], other = s === '1' ? '0' : '1', side = axes.filter(q => q !== k);
      const need = (a[side[0] + '1'] - a[side[0] + '0']) * (a[side[1] + '1'] - a[side[1] + '0']);
      let cov = 0, ok = true;
      for (const b of parts) {
        if (b === a || Math.abs(b[k + other] - c) > E) continue;
        const ov = side.map(q => Math.min(a[q + '1'], b[q + '1']) - Math.max(a[q + '0'], b[q + '0']));
        if (ov[0] <= E || ov[1] <= E) continue;
        cov += ov[0] * ov[1];
        for (const q of side) for (const t of ['0', '1']) {
          if (Math.abs(a[q + t] - b[q + t]) < E && faceSlot(plan, a, FACE[q + t]) !== faceSlot(plan, b, FACE[q + t])) ok = false;
        }
      }
      if (ok && cov >= need - 1e-9) g[k + s] = s === '1' ? JOIN : -JOIN;
    }
    return g;
  });
  return parts.map((p, i) => {
    const q = { ...p };
    for (const [key, d] of Object.entries(grow[i])) q[key] += d;
    return q;
  });
}

// Слот грани коробки стены [+x,−x,+y,−y,+z,−z] по зоне в 2 см перед гранью; наружу из квартиры — фасад.
function faceSlot(plan, p, face) {
  const e = 0.02, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
  const pt = [[p.x1 + e, cz], [p.x0 - e, cz], null, null, [cx, p.z1 + e], [cx, p.z0 - e]][face];
  if (!pt) return 'walls';
  const b = plan.bounds;
  if (pt[0] < b.x0 || pt[0] > b.x1 || pt[1] < b.z0 || pt[1] > b.z1) return 'facade';
  const zone = zoneAt(plan, pt[0], pt[1]);
  // Стена за ТВ и диваном: правая стена кухни-гостиной, грань смотрит в −x
  if (zone === 'kitchen_living' && face === 1 && Math.abs(p.x0 - plan.rooms.kitchen_living.x1) < 0.03) return 'wallAccent';
  return ROOM_WALLS[zone] ?? 'walls';
}

// Плоскость пола [x0,x1]×[z0,z1] на высоте y; UV в метрах мира (u = x, v = −z), плитка совпадает между зонами.
function floorPlane(x0, x1, z0, z1, mat, y = 0) {
  const w = x1 - x0, d = z1 - z0;
  const fg = new THREE.PlaneGeometry(w, d), uv = fg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w + x0, uv.getY(i) * d - z1);
  fg.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(fg, mat);
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  return m;
}

export function buildShell(plan, M) {
  const H = plan.ceiling;
  const g = new THREE.Group(); g.name = 'apartment';
  const walls = [];

  // Стены: материал на каждую грань по зоне перед ней; клик -> faceSlots[face.materialIndex]
  for (const p of wallParts(plan)) {
    const faceSlots = [0, 1, 2, 3, 4, 5].map(f => faceSlot(plan, p, f));
    const m = boxAt(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1, faceSlots.map(s => M[s] ?? M.walls), { slot: 'walls' });
    m.userData.faceSlots = faceSlots; m.userData.cutaway = true; m.name = `wall_${p.kind}`;
    compactMaterialGroups(m.geometry, m.material, faceSlots);
    g.add(m); walls.push(m);
  }

  const b = plan.bounds;
  const fw = b.x1 - b.x0, fd = b.z1 - b.z0;
  // Подложка — плита под полами (их строит buildFloors) до низа стен: верх на 3 мм ниже пола даёт порог
  // в дверных проёмах, бока утоплены на 1 см от фасада, чтобы не совпасть с гранями стен
  const inset = 0.01;
  const under = boxAt(b.x0 + inset, b.x1 - inset, WALL_BASE + inset, -0.003, b.z0 + inset, b.z1 - inset, M.walls, { cast: false });
  under.name = 'underlay';
  g.add(under);

  // Потолок (видимая плоскость, односторонняя — сверху не видна) + плита-тень над ним
  const cg = new THREE.PlaneGeometry(fw, fd); cg.rotateX(Math.PI / 2);
  const ceiling = new THREE.Mesh(cg, M.ceiling);
  ceiling.position.set((b.x0 + b.x1) / 2, H, (b.z0 + b.z1) / 2);
  ceiling.receiveShadow = true; ceiling.name = 'ceiling';
  g.add(ceiling);
  const slab = boxAt(b.x0 - 0.2, b.x1 + 0.2, H, H + 0.25, b.z0 - 0.2, b.z1 + 0.2, M.walls, { receive: false });
  slab.layers.set(1); slab.userData.shadowOnly = true; g.add(slab);

  // Балкон: плита (на 2 см ниже пола квартиры), балкон верхнего этажа (даёт реальную тень), ограждение.
  // По балкону можно пройти через открытую балконную дверь; граница прогулки = внутренние грани ограждения.
  const bal = plan.balcony, areas = outdoorAreas(plan);
  g.add(boxAt(bal.x0, bal.x1, -0.22, -0.02, bal.z0, bal.z1, M.balcony));
  const upper = boxAt(bal.x0, bal.x1, H + 0.25, H + 0.47, bal.z0, bal.z1, M.facade);
  upper.userData.cut = 'above'; g.add(upper);
  const balArea = areas.find(a => a.id === 'balcony');
  if (balArea) g.add(buildRailing(bal, balArea, M.railing));
  // Площадка подъезда за входной дверью: пол, стены, потолок (видно, когда дверь открыта)
  const landing = areas.find(a => a.id === 'landing');
  if (landing) g.add(buildLanding(landing, H, M));

  // Окна и наружные двери (межкомнатные строит buildDoors)
  for (const o of plan.openings) if (o.type !== 'interior') g.add(buildOpening(o, plan, M));

  // Вид из окна даёт HDRI с настоящим пейзажем (textures/hdri/day.hdr), земли и домов в сцене нет.

  return { group: g, walls, ceiling };
}

// Полы по комнатам. Открытое пространство (кухня-гостиная, холл и полы в дверных проёмах — все
// межкомнатные двери выходят в холл) делится по x = state.split: левее floorA, правее floorB.
export function buildFloors(plan, state, M) {
  const g = new THREE.Group(); g.name = 'floors';
  const R = plan.rooms, split = state.split ?? 2.6;
  const doors = plan.openings.filter(o => o.type === 'interior');
  const open = [...R.kitchen_living.rects, ...R.hall.rects, ...doors];
  const add = (x0, x1, z0, z1, slot) => {
    const m = floorPlane(x0, x1, z0, z1, M[slot]);
    m.userData.slot = slot; m.name = `floor_${slot}`; g.add(m);
  };
  for (const r of open) {
    if (r.x0 < split) add(r.x0, Math.min(r.x1, split), r.z0, r.z1, 'floorA');
    if (r.x1 > split) add(Math.max(r.x0, split), r.x1, r.z0, r.z1, 'floorB');
  }
  for (const [id, slot] of Object.entries(ROOM_FLOORS)) for (const r of R[id].rects) add(r.x0, r.x1, r.z0, r.z1, slot);

  // Порожки 6 × 2 мм: по линии смены пола и под каждой дверью на грани перегородки со стороны комнаты
  if (state.threshold === 'profile') {
    const tw = 0.003, th = 0.002, o2 = { cast: false, slot: 'threshold' };
    for (const r of open) if (r.x0 < split && r.x1 > split) g.add(boxAt(split - tw, split + tw, 0, th, r.z0, r.z1, M.threshold, o2));
    for (const o of doors) {
      const ax = o.along === 'x' ? 'z' : 'x', t = o[ax + (o.room_side > 0 ? '1' : '0')];
      if (ax === 'z') g.add(boxAt(o.x0, o.x1, 0, th, t - tw, t + tw, M.threshold, o2));
      else g.add(boxAt(t - tw, t + tw, 0, th, o.z0, o.z1, M.threshold, o2));
    }
  }
  return g;
}

// ---------- межкомнатные двери ----------

export function buildDoors(plan, M) {
  const g = new THREE.Group(); g.name = 'doors';
  for (const o of plan.openings) if (o.type === 'interior') g.add(buildInteriorDoor(o, M));
  return g;
}

// Локальные оси проёма: u — вдоль стены от центра, t — поперёк стены (по +z для стены вдоль X, по +x для стены вдоль Z).
function buildInteriorDoor(o, M) {
  const g = new THREE.Group(); g.name = o.id;
  const X = o.along === 'x';
  const cu = X ? (o.x0 + o.x1) / 2 : (o.z0 + o.z1) / 2, ct = X ? (o.z0 + o.z1) / 2 : (o.x0 + o.x1) / 2;
  const T = X ? o.z1 - o.z0 : o.x1 - o.x0, W = o.width / 2, head = o.head;
  const at = (u0, u1, y0, y1, t0, t1) => {
    const m = X ? boxAt(cu + u0, cu + u1, y0, y1, ct + t0, ct + t1, M.doors, { slot: 'doors' })
      : boxAt(ct + t0, ct + t1, y0, y1, cu + u0, cu + u1, M.doors, { slot: 'doors' });
    m.userData.cutaway = true; g.add(m);
  };
  // Коробка на всю толщину стены: стойки и перемычка над полотном
  const jamb = (o.width - o.leaf) / 2, lh = 2.0, ly = 0.008;
  at(-W, -W + jamb, 0, head, -T / 2, T / 2);
  at(W - jamb, W, 0, head, -T / 2, T / 2);
  at(-W + jamb, W - jamb, ly + lh + 0.004, head, -T / 2, T / 2);
  // Наличники с обеих сторон: 6.5 см, выступ 1.5 см, заходят на коробку на 1 см
  const aw = 0.065, ap = 0.015, ov = 0.01;
  for (const t0 of [T / 2, -T / 2 - ap]) {
    at(-W + ov - aw, -W + ov, 0, head - ov + aw, t0, t0 + ap);
    at(W - ov, W - ov + aw, 0, head - ov + aw, t0, t0 + ap);
    at(-W + ov, W - ov, head - ov, head - ov + aw, t0, t0 + ap);
  }
  // Полотно открыто на DOOR_OPEN.interior° в сторону swing; ось петель у края проёма hinge, у грани стены.
  // Закрытое полотно стоит в проёме заподлицо с гранью стены со стороны открывания.
  const L = o.leaf, lt = 0.04, ang = THREE.MathUtils.degToRad(DOOR_OPEN.interior);
  const hu = o.hinge === 'start' ? -W + jamb : W - jamb, ht = o.swing * (T / 2 - lt / 2);
  // поворот пивота, при котором его локальная X идёт вдоль полотна, открытого на угол a
  const yawAt = a => {
    const du = (o.hinge === 'start' ? 1 : -1) * Math.cos(a), dt = o.swing * Math.sin(a);
    const [wx, wz] = X ? [du, dt] : [dt, du];
    return Math.atan2(-wz, wx);
  };
  const closed = yawAt(0), open = closed + wrapAngle(yawAt(ang) - closed);
  const pivot = new THREE.Group(); pivot.name = `${o.id}_leaf`;
  pivot.position.set(X ? cu + hu : ct + ht, 0, X ? ct + ht : cu + hu);
  pivot.rotation.y = open;
  pivot.userData.door = { id: o.id, closed, open, isOpen: true, dir: 1, length: L, thick: lt };
  const leaf = boxAt(0, L, ly, ly + lh, -lt / 2, lt / 2, M.doors, { slot: 'doors' });
  leaf.userData.cutaway = true; leaf.name = 'leaf'; pivot.add(leaf);
  // Ручка-нажим с двух сторон
  const hx = L - 0.07, hy = 1.0;
  for (const s of [-1, 1]) {
    const rose = cyl(0.025, 0.01, M.metal, 24); rose.rotation.x = Math.PI / 2; rose.position.set(hx, hy, s * (lt / 2 + 0.005)); pivot.add(rose);
    const stem = cyl(0.008, 0.05, M.metal, 12); stem.rotation.x = Math.PI / 2; stem.position.set(hx, hy, s * (lt / 2 + 0.025)); pivot.add(stem);
    const zl = s * (lt / 2 + 0.05);
    pivot.add(boxAt(hx - 0.13, hx + 0.01, hy - 0.009, hy + 0.009, zl - 0.009, zl + 0.009, M.metal));
  }
  g.add(pivot);
  return g;
}

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// Ограждение балкона 1.08 м: поручень, нижняя полоса, стойки через 11 см, боковые стенки до фасада.
// Внутренние грани — по зоне прогулки area (outdoorAreas в walk.js), так что тело упирается ровно в перила.
function buildRailing(bal, area, mat) {
  const g = new THREE.Group(); g.name = 'railing';
  const top = 1.08, z = area.z0 - 0.025, xa = area.x0 - 0.02, xb = area.x1 + 0.02;
  g.add(boxAt(xa, xb, top - 0.04, top, z - 0.025, z + 0.025, mat));
  g.add(boxAt(xa, xb, 0.06, 0.1, z - 0.015, z + 0.015, mat));
  const n = Math.floor((xb - xa) / 0.11);
  const bar = new THREE.BoxGeometry(0.014, top - 0.1, 0.014);
  const inst = new THREE.InstancedMesh(bar, mat, n + 1);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i <= n; i++) { m4.makeTranslation(xa + i * 0.11, (top + 0.06) / 2, z); inst.setMatrixAt(i, m4); }
  inst.castShadow = true; g.add(inst);
  // боковые ограждения: от поручня до фасада
  for (const x of [xa, xb]) g.add(boxAt(x - 0.02, x + 0.02, -0.02, top, z - 0.025, bal.z1, mat));
  return g;
}

// Площадка подъезда за входной дверью: пол вровень с квартирой, стены и потолок по краям зоны прогулки.
function buildLanding(a, H, M) {
  const g = new THREE.Group(); g.name = 'landing';
  const t = 0.12, back = 0.06;   // толщина стен площадки; заход стен под фасад, чтобы не было щели
  g.add(boxAt(a.x0, a.x1, WALL_BASE, 0, a.z0 - back, a.z1, M.balcony, { cast: false }));
  for (const [x0, x1] of [[a.x0 - t, a.x0], [a.x1, a.x1 + t]]) g.add(boxAt(x0, x1, WALL_BASE, H, a.z0 - back, a.z1 + t, M.facade));
  g.add(boxAt(a.x0, a.x1, WALL_BASE, H, a.z1, a.z1 + t, M.facade));
  const top = boxAt(a.x0 - t, a.x1 + t, H, H + 0.25, a.z0 - back, a.z1 + t, M.facade);
  top.userData.cut = 'above'; g.add(top);
  return g;
}

// Окно / балконная дверь в локальных осях: u — вдоль проёма, t — толщина стены (плюс — внутрь комнаты).
// Створка балконной двери — пивот на оси петель (открывается внутрь на DOOR_OPEN.exterior°), глухая часть
// (fixed_left) остаётся стеклом в раме. Створки окон не открываются (пивот без userData.door).
function buildOpening(o, plan, M) {
  const g = new THREE.Group(); g.name = o.id;
  const W = o.width, sill = o.sill, head = o.head, h = head - sill;
  const fd = 0.07, p = 0.068, tFrame = -0.17;   // рама примерно посередине стены 37.5 см
  const along = o.along;
  if (along === 'x') g.position.set((o.x0 + o.x1) / 2, 0, 0);
  if (along === 'z') { g.position.set(6.171, 0, (o.z0 + o.z1) / 2); g.rotation.y = -Math.PI / 2; }
  // чистый проход в плане по отрезку [ua, ub] вдоль проёма (для столкновений прогулки, doors.js)
  const passage = (ua, ub) => (along === 'x'
    ? { x0: g.position.x + ua, x1: g.position.x + ub, z0: o.z0, z1: o.z1 }
    : { x0: o.x0, x1: o.x1, z0: g.position.z + ua, z1: g.position.z + ub });
  const exterior = DOOR_OPEN.exterior * Math.PI / 180;
  if (o.type === 'entry') return buildEntry(o, g, M, exterior);

  const at = (u0, u1, y0, y1, t0, t1, mat) => boxAt(u0, u1, y0, y1, tFrame + t0, tFrame + t1, mat);
  // Коробка рамы
  g.add(at(-W / 2, -W / 2 + p, sill, head, -fd / 2, fd / 2, M.frame));
  g.add(at(W / 2 - p, W / 2, sill, head, -fd / 2, fd / 2, M.frame));
  g.add(at(-W / 2, W / 2, head - p, head, -fd / 2, fd / 2, M.frame));
  g.add(at(-W / 2, W / 2, sill, sill + (sill > 0 ? p : 0.035), -fd / 2, fd / 2, M.frame));
  const y0 = sill + (sill > 0 ? p : 0.035), y1 = head - p;
  // Секции: глухая слева + створка, либо одна створка
  const u0 = -W / 2 + p, u1 = W / 2 - p;
  const sections = [];
  if (o.fixed_left) {
    const um = -W / 2 + o.fixed_left;
    g.add(at(um - p / 2, um + p / 2, y0, y1, -fd / 2, fd / 2, M.frame));
    sections.push({ a: u0, b: um - p / 2, sash: false }, { a: um + p / 2, b: u1, sash: true, hinge: 'right' });
  } else sections.push({ a: u0, b: u1, sash: true, hinge: 'left' });
  const door = o.type === 'door';
  for (const s of sections) {
    let a = s.a, b = s.b, ya = y0, yb = y1;
    if (!s.sash) {
      const q = 0.02;
      a += q; b -= q; ya += q; yb -= q;
      const glass = at(a, b, ya, yb, 0.01, 0.022, M.glass);
      glass.castShadow = false; glass.receiveShadow = false; glass.renderOrder = 2; glass.userData.glass = true;
      g.add(glass);
      continue;
    }
    // Створка: пивот на оси петель посередине толщины профиля; коробки внутри — в осях пивота
    const q = 0.058, t0 = 0.0, t1 = fd / 2 + 0.012, tm = (t0 + t1) / 2, bot = q + (sill > 0 ? 0 : 0.04);
    const left = s.hinge === 'left', uh = left ? a : b;
    const pivot = new THREE.Group(); pivot.name = `${o.id}_sash`;
    pivot.position.set(uh, 0, tFrame + tm);
    const sa = (ua, ub, ya_, yb_, ta, tb, mat) => boxAt(ua - uh, ub - uh, ya_, yb_, ta - tm, tb - tm, mat);
    pivot.add(sa(a, a + q, ya, yb, t0, t1, M.frame));
    pivot.add(sa(b - q, b, ya, yb, t0, t1, M.frame));
    pivot.add(sa(a, b, yb - q, yb, t0, t1, M.frame));
    pivot.add(sa(a, b, ya, ya + bot, t0, t1, M.frame));
    const hu = left ? b - q / 2 : a + q / 2;
    const hy = sill > 0 ? sill + h / 2 : 1.05;
    pivot.add(sa(hu - 0.012, hu + 0.012, hy - 0.09, hy + 0.03, t1, t1 + 0.04, M.handle));
    if (door) pivot.add(sa(hu - 0.01, hu + 0.01, hy - 0.06, hy + 0.06, t0 - 0.03, t0, M.handle));   // ручка снаружи
    const glass = sa(a + q, b - q, ya + bot, yb - q, 0.01, 0.022, M.glass);
    glass.castShadow = false; glass.receiveShadow = false; glass.renderOrder = 2; glass.userData.glass = true;
    pivot.add(glass);
    if (door) {
      // left: полотно вдоль +u от петли, внутрь (+t) — поворот −90°; right: вдоль −u, поворот +90°
      const dir = left ? 1 : -1;
      pivot.userData.door = { id: o.id, closed: 0, open: -dir * exterior, isOpen: false, dir, length: b - a, thick: t1 - t0 };
      g.userData.passage = passage(s.a, s.b);
    }
    g.add(pivot);
  }
  // Подоконник изнутри: лежит на кладке (верх на 6 мм выше низа проёма, не в одной плоскости с ним)
  if (sill > 0) {
    const inner = 0.0 - tFrame + 0.03;
    g.add(at(-W / 2 - 0.04, W / 2 + 0.04, sill - 0.02, sill + 0.006, fd / 2, inner, M.sill));
  }
  // Дверь, за которой нет балкона («французский балкон»): ограждение снаружи по грани фасада
  if (door && !areaBeyond(plan, o).area) {
    const t = (along === 'x' ? o.z0 : -(o.x1 - g.position.x)) - 0.04, top = 1.1, n = Math.round((W - 0.04) / 0.11);
    const rail = new THREE.Group(); rail.name = 'juliet';
    rail.add(boxAt(-W / 2, W / 2, top - 0.04, top, t - 0.02, t + 0.02, M.railing));
    rail.add(boxAt(-W / 2, W / 2, 0.08, 0.12, t - 0.012, t + 0.012, M.railing));
    for (let i = 0; i <= n; i++) {
      const u = -W / 2 + 0.02 + (i * (W - 0.04)) / n;
      rail.add(boxAt(u - 0.007, u + 0.007, 0.08, top, t - 0.007, t + 0.007, M.railing));
    }
    g.add(rail);
  }
  return g;
}

// Входная дверь: стальная коробка и полотно на петлях у начала проёма (меньший x), открывается в холл (−z), как на плане.
// Локальные оси группы: u = x, t = z от середины проёма.
function buildEntry(o, g, M, ang) {
  const W = o.width, head = o.head, fw = 0.05, fd = 0.1, lt = 0.06;
  g.position.set((o.x0 + o.x1) / 2, 0, (o.z0 + o.z1) / 2);
  g.add(boxAt(-W / 2, -W / 2 + fw, 0, head, -fd / 2, fd / 2, M.door));
  g.add(boxAt(W / 2 - fw, W / 2, 0, head, -fd / 2, fd / 2, M.door));
  g.add(boxAt(-W / 2, W / 2, head - 0.04, head, -fd / 2, fd / 2, M.door));
  const L = W - 2 * fw - 0.006, uh = -W / 2 + fw + 0.003;
  const pivot = new THREE.Group(); pivot.name = `${o.id}_leaf`;
  pivot.position.set(uh, 0, 0);
  pivot.add(boxAt(0, L, 0.01, head - 0.043, -lt / 2, lt / 2, M.door));
  const hx = L - 0.08;
  pivot.add(boxAt(hx - 0.12, hx + 0.01, 1.02, 1.04, -lt / 2 - 0.05, -lt / 2 - 0.03, M.metal));   // ручка изнутри
  pivot.add(boxAt(hx - 0.01, hx + 0.01, 1.0, 1.06, -lt / 2 - 0.03, -lt / 2, M.metal));
  pivot.add(boxAt(hx - 0.015, hx + 0.015, 0.98, 1.1, lt / 2, lt / 2 + 0.03, M.metal));          // скоба снаружи
  // полотно вдоль +u; поворот +ang уводит его в −t (в холл)
  pivot.userData.door = { id: o.id, closed: 0, open: ang, isOpen: false, dir: 1, length: L, thick: lt };
  g.add(pivot);
  g.userData.passage = { x0: g.position.x - W / 2 + fw, x1: g.position.x + W / 2 - fw, z0: o.z0, z1: o.z1 };
  return g;
}

// ---------- кухня ----------

export function buildKitchen(kit, state, M) {
  const g = new THREE.Group(); g.name = 'kitchen';
  const top = kit.worktop.height, th = kit.worktop.thickness, oh = kit.worktop.overhang;
  const ph = kit.plinth.height, pr = kit.plinth.recess, gap = kit.frontGap, ft = 0.019;
  const run = kit.run, D = run.depth, Z0 = run.startZ;
  const handles = state.handles === 'bar';
  // Холодильник — маленький, под столешницей, в крайнем модуле у шахты ("fridge" в kitchen.json).
  // Столешница всегда идёт до конца. under — встроенный за фасадом, under-free — отдельностоящий в нише.
  let z = Z0;
  const mods = run.modules.map(m => { const r = { ...m, zA: z, zB: z - m.w }; z -= m.w; return r; });
  const fr = ['under', 'under-free'].includes(state.fridge) ? mods.find(m => m.fridge) : null;
  const free = fr && state.fridge === 'under-free' ? fr : null;

  // Ряд вдоль стены (корпус добавляется ниже, когда известно место мойки)
  const plinth = [{ x0: 0, x1: D - pr, y0: 0, y1: ph, z0: 0, z1: Z0 }];
  for (const p of free ? subtract(plinth[0], { x0: -1, x1: 9, y0: -1, y1: 9, z0: free.zB, z1: free.zA }) : plinth)
    g.add(boxAt(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1, M.plinth, { slot: 'fronts' }));
  if (fr) g.add(buildFridge(state.fridge, fr, kit, top - th, M));
  let sinkZ = null, hobZ = null;
  for (const { zA, zB, ...mod } of mods) {
    if (free && zA === free.zA) continue;
    const panels = frontPanels(mod.front, ph + gap, top - th - gap, gap);
    for (const [ya, yb] of panels) {
      g.add(boxAt(D - ft, D, ya, yb, zB + gap / 2, zA - gap / 2, M.fronts, { slot: 'fronts' }));
      if (handles) g.add(handleBar('x+', D, yb - 0.05, (zA + zB) / 2, Math.min(0.32, mod.w - 0.16), M.metal));
    }
    if (mod.sink) sinkZ = (zA + zB) / 2;
    if (mod.hob) hobZ = (zA + zB) / 2;
  }
  // Столешница с вырезом под мойку
  const sx = 0.32, sw = kit.sink.w, sd = kit.sink.d;
  const cut = sinkZ != null ? { x0: sx - sd / 2, x1: sx + sd / 2, z0: sinkZ - sw / 2, z1: sinkZ + sw / 2 } : null;
  let top0 = [{ x0: 0, x1: D + oh, y0: top - th, y1: top, z0: 0, z1: Z0 }];
  if (cut) top0 = subtract(top0[0], { ...cut, y0: -1, y1: 9 });
  for (const p of top0) g.add(boxAt(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1, M.counter, { slot: 'counter' }));
  let body = [{ x0: 0, x1: D - ft, y0: ph, y1: top - th, z0: 0, z1: Z0 }];
  if (cut) body = subtract(body[0], { x0: cut.x0 - 0.01, x1: cut.x1 + 0.01, z0: cut.z0 - 0.01, z1: cut.z1 + 0.01, y0: top - th - kit.sink.depth - 0.02, y1: 9 });
  if (free) body = body.flatMap(p => subtract(p, { x0: -1, x1: 9, y0: -1, y1: 9, z0: free.zB + 0.016, z1: free.zA - 0.016 }));
  for (const p of body) g.add(boxAt(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1, M.carcass, { slot: 'fronts' }));
  if (cut) g.add(buildSink(cut, top - th, kit.sink.depth, M));
  if (sinkZ != null) g.add(buildFaucet(0.07, top, sinkZ, M.metal));
  if (hobZ != null) {
    const hb = boxAt(D / 2 - kit.hob.d / 2 + 0.01, D / 2 + kit.hob.d / 2 + 0.01, top, top + 0.005, hobZ - kit.hob.w / 2, hobZ + kit.hob.w / 2, M.hob);
    g.add(hb);
    if (kit.hood) g.add(buildHood(kit, top, hobZ, M));
  }
  // Фартук
  if (state.backsplash !== 'none') {
    const mat = state.backsplash === 'slab' ? M.counter : M.backsplash;
    g.add(boxAt(0, 0.012, top, 1.5, 0, Z0, mat, { slot: state.backsplash === 'slab' ? 'counter' : 'backsplash' }));
  }

  // Остров
  const isl = islandBox(kit, state);
  const { x0, x1, z0, z1 } = isl;
  g.add(boxAt(x0 + ft, x1 - ft, ph, top - th, z0, z1, M.islandCarcass, { slot: 'island' }));
  g.add(boxAt(x0 + pr, x1 - pr, 0, ph, z0 + pr, z1 - pr, M.islandCarcass, { slot: 'island' }));
  const n = kit.island.kitchenSide.length, mw = (z1 - z0) / n;
  kit.island.kitchenSide.forEach((type, i) => {
    const za = z0 + i * mw, zb = za + mw;
    for (const [ya, yb] of frontPanels(type, ph + gap, top - th - gap, gap)) {
      g.add(boxAt(x0, x0 + ft, ya, yb, za + gap / 2, zb - gap / 2, M.island, { slot: 'island' }));
      if (handles) g.add(handleBar('x-', x0, yb - 0.05, (za + zb) / 2, 0.3, M.metal));
    }
  });
  g.add(boxAt(x1 - ft, x1, ph, top - th, z0, z1, M.island, { slot: 'island' }));
  g.add(boxAt(x1 - ft, x1, 0, ph, z0, z1, M.islandCarcass, { slot: 'island' }));
  const ioh = 0.01;
  g.add(boxAt(x0 - ioh, x1 + ioh, top - th, top, z0 - ioh, z1 + ioh, M.islandTop, { slot: 'islandTop' }));
  return { group: g, island: isl };
}

// Вытяжка над варкой (kitchen.json → hood): наклонная, чёрное стекло, без воздуховода (рециркуляция через фильтр).
// Профиль сбоку (X от стены, Y вверх): клин от низа depthBottom до верха depthTop, спереди 3 см борт, сверху стекло.
// Снизу фильтр и LED-полоса, на стекле точки сенсора (питание + 3 скорости). Группа 'hood' с userData.hood;
// включает в прогулке hood.js (он же меняет яркость материалов ниже — они общие на сеанс, переживают пересборку кухни).
// Метки детей: hoodLed — полоса, hoodDot = 0..3 — точки (0 — питание), hoodPool — пятно света на варке (только растр).
let HOOD_MAT = null;
export function hoodMaterials() {
  if (HOOD_MAT) return HOOD_MAT;
  const std = (name, o) => Object.assign(new THREE.MeshStandardMaterial(o), { name });
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), grd = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grd; x.fillRect(0, 0, 128, 128);
  const pool = new THREE.CanvasTexture(c); pool.colorSpace = THREE.SRGBColorSpace;
  HOOD_MAT = {
    body: std('hood_body', { color: '#161617', roughness: 0.48, metalness: 0.35 }),
    glass: std('hood_glass', { color: '#050506', roughness: 0.04, metalness: 0.1 }),
    led: std('hood_led', { color: '#e9e6df', roughness: 0.5, emissive: '#fff1dc', emissiveIntensity: 0 }),
    dotOff: std('hood_dot_off', { color: '#3a3b3d', roughness: 0.4 }),
    dotOn: std('hood_dot_on', { color: '#ffffff', roughness: 0.4, emissive: '#e8f2ff', emissiveIntensity: 1 }),
    pool: Object.assign(new THREE.MeshBasicMaterial({ map: pool, color: '#000000', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), { name: 'hood_pool' }),
  };
  return HOOD_MAT;
}

function buildHood(kit, top, hobZ, M) {
  const h = kit.hood, HM = hoodMaterials();
  const g = new THREE.Group(); g.name = 'hood';
  const b = h.bottom, H = h.h, dB = h.depthBottom, dT = h.depthTop, lip = 0.03, w = h.w;
  const z0 = hobZ - w / 2, z1 = hobZ + w / 2;
  const prism = (pts, mat) => {
    const s = new THREE.Shape(pts.map(([px, py]) => new THREE.Vector2(px, py)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    geo.translate(0, 0, z0);
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  g.add(prism([[0, b], [dB, b], [dB, b + lip], [dT, b + H], [0, b + H]], HM.body));
  // стекло по наклону: отрезок A→B, толщина t наружу по нормали n
  const A = [dB, b + lip], B = [dT, b + H], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const n = [(B[1] - A[1]) / len, (A[0] - B[0]) / len], t = 0.006;
  const glass = prism([A, B, [B[0] + n[0] * t, B[1] + n[1] * t], [A[0] + n[0] * t, A[1] + n[1] * t]], HM.glass);
  g.add(glass);
  // снизу: фильтр и полоса света к варке
  g.add(boxAt(0.03, dB - 0.085, b - 0.002, b, z0 + 0.03, z1 - 0.03, M.vent, { cast: false }));
  const led = boxAt(dB - 0.065, dB - 0.04, b - 0.003, b, z0 + 0.04, z1 - 0.04, HM.led, { cast: false });
  led.userData.hoodLed = true; g.add(led);
  // точки сенсора на стекле внизу справа (смотрим со стороны комнаты: +X, правее — меньше Z)
  const dotGeo = new THREE.CircleGeometry(0.0042, 16);
  for (let i = 0; i < 4; i++) {
    const s = 0.03, px = A[0] + (B[0] - A[0]) * (s / len) + n[0] * (t + 0.0006), py = A[1] + (B[1] - A[1]) * (s / len) + n[1] * (t + 0.0006);
    const dot = new THREE.Mesh(dotGeo, HM.dotOff);
    dot.position.set(px, py, z0 + 0.05 + (i === 0 ? 0 : 0.03 + i * 0.022));
    dot.lookAt(px + n[0], py + n[1], dot.position.z);
    dot.userData.hoodDot = i; g.add(dot);
  }
  // пятно света на варке: растровая подсказка, что полоса светит (в фото и GLB его нет — прячет hood.js)
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(dB + 0.2, w + 0.1).rotateX(-Math.PI / 2), HM.pool);
  pool.position.set(dB / 2 + 0.02, top + 0.0075, hobZ);
  pool.visible = false; pool.castShadow = false; pool.receiveShadow = false; pool.renderOrder = 2;
  Object.assign(pool.userData, { hoodPool: true, rasterOnly: true, noPick: true });
  g.add(pool);
  g.userData.hood = { center: new THREE.Vector3(dB / 2, b + H / 2, hobZ), z0, z1, bottom: b, top: b + H };
  return g;
}

export function islandBox(kit, state) {
  const aisle = state.aisle ?? kit.island.aisle, gapW = state.gapW ?? kit.island.gapToWindowWall;
  const x0 = kit.run.depth + aisle, x1 = x0 + kit.island.depth;
  const z0 = gapW, z1 = z0 + kit.island.length;
  return { x0, x1, z0, z1 };
}

// Маленький холодильник под столешницей в модуле у шахты.
// under: встроенный, снаружи обычный фасад, выдаёт его только решётка в цоколе.
// under-free: отдельностоящий 0.60 × 0.85 в нише между боковинами корпуса.
function buildFridge(kind, m, kit, yTop, M) {
  const g = new THREE.Group(); g.name = 'fridge';
  const D = kit.run.depth, ph = kit.plinth.height, pr = kit.plinth.recess;
  if (kind === 'under') {
    g.add(boxAt(D - pr, D - pr + 0.004, 0.02, ph - 0.02, m.zB + 0.08, m.zA - 0.08, M.vent, { slot: 'fronts' }));
    return g;
  }
  const s = 0.004, z0 = m.zB + 0.016 + s, z1 = m.zA - 0.016 - s, h = Math.min(0.85, yTop - 0.01), d = D - 0.02;
  g.add(boxAt(0.02, d - 0.03, 0.01, h, z0, z1, M.fridge, { slot: 'fridge' }));
  g.add(boxAt(d - 0.03, d, 0.01, h, z0, z1, M.fridge, { slot: 'fridge' }));   // дверь
  g.add(vHandle(d, h - 0.3, z0 + 0.04, 0.22, M.metal));
  return g;
}

function frontPanels(type, y0, y1, gap) {
  const H = y1 - y0;
  if (type === 'drawers3') {
    const a = y1 - H * 0.24, b = a - (H - H * 0.24) / 2;
    return [[b + gap / 2, a - gap / 2], [y0, b - gap / 2], [a + gap / 2, y1]].sort((p, q) => p[0] - q[0]);
  }
  if (type === 'drawers2') { const m = y0 + H / 2; return [[y0, m - gap / 2], [m + gap / 2, y1]]; }
  return [[y0, y1]];
}

function handleBar(face, x, y, zc, len, mat) {
  // Скоба: планка на двух ножках, отстоит от фасада на 2 см
  const s = face === 'x+' ? 1 : -1, grp = new THREE.Group();
  const span = (d0, d1) => [Math.min(x + s * d0, x + s * d1), Math.max(x + s * d0, x + s * d1)];
  const [bx0, bx1] = span(0.02, 0.032);
  grp.add(boxAt(bx0, bx1, y - 0.006, y + 0.006, zc - len / 2, zc + len / 2, mat));
  const [lx0, lx1] = span(0, 0.02);
  for (const dz of [-len / 2 + 0.012, len / 2 - 0.012]) grp.add(boxAt(lx0, lx1, y - 0.005, y + 0.005, zc + dz - 0.005, zc + dz + 0.005, mat));
  return grp;
}

// Вертикальная скоба на фасаде, смотрящем в +x
function vHandle(x, yc, z, len, mat) {
  const grp = new THREE.Group();
  grp.add(boxAt(x + 0.02, x + 0.032, yc - len / 2, yc + len / 2, z - 0.006, z + 0.006, mat));
  for (const dy of [-len / 2 + 0.012, len / 2 - 0.012]) grp.add(boxAt(x, x + 0.02, yc + dy - 0.005, yc + dy + 0.005, z - 0.005, z + 0.005, mat));
  return grp;
}

function buildSink(c, yTopUnder, depth, M) {
  const g = new THREE.Group(), t = 0.008, yb = yTopUnder - depth;
  g.add(boxAt(c.x0, c.x1, yb - t, yb, c.z0, c.z1, M.sink));
  g.add(boxAt(c.x0 - t, c.x0, yb, yTopUnder, c.z0, c.z1, M.sink));
  g.add(boxAt(c.x1, c.x1 + t, yb, yTopUnder, c.z0, c.z1, M.sink));
  g.add(boxAt(c.x0, c.x1, yb, yTopUnder, c.z0 - t, c.z0, M.sink));
  g.add(boxAt(c.x0, c.x1, yb, yTopUnder, c.z1, c.z1 + t, M.sink));
  const drain = cyl(0.035, 0.004, M.metal); drain.position.set((c.x0 + c.x1) / 2, yb + 0.002, (c.z0 + c.z1) / 2); g.add(drain);
  return g;
}

function buildFaucet(x, top, z, mat) {
  const g = new THREE.Group();
  const base = cyl(0.026, 0.05, mat); base.position.set(x, top + 0.025, z); g.add(base);
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(x, top + 0.05, z), new THREE.Vector3(x, top + 0.42, z),
    new THREE.Vector3(x + 0.24, top + 0.42, z), new THREE.Vector3(x + 0.24, top + 0.27, z));
  const spout = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.012, 14), mat);
  spout.castShadow = true; g.add(spout);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.09), mat);
  lever.position.set(x, top + 0.11, z + 0.05); lever.castShadow = true; g.add(lever);
  return g;
}

// ---------- мелкие постоянные детали комнаты ----------

// Объединение отрезков [a,b]; короче 2 см отбрасываются.
function mergeIv(iv) {
  const out = [];
  for (const [a, b] of iv.filter(([a, b]) => b - a > 1e-4).sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-4) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out.filter(([a, b]) => b - a > 0.02);
}

export function buildFixtures(plan, kit, M) {
  const g = new THREE.Group(); g.name = 'fixtures';
  // Вертикальный радиатор на простенке
  const r = kit.radiator, zw = 0.035 + r.depth / 2;
  const n = 7, step = (r.w - 0.03) / (n - 1);
  for (let i = 0; i < n; i++) {
    const t = cyl(0.014, r.h, M.radiator, 12);
    t.position.set(r.centerX - r.w / 2 + 0.015 + i * step, r.bottom + r.h / 2, zw); g.add(t);
  }
  for (const y of [r.bottom + 0.03, r.bottom + r.h - 0.03]) {
    const hdr = cyl(0.018, r.w + 0.02, M.radiator, 12); hdr.rotation.z = Math.PI / 2; hdr.position.set(r.centerX, y, zw); g.add(hdr);
  }
  // Низкий панельный радиатор справа от балконной двери (по плану)
  g.add(boxAt(5.62, 6.02, 0.15, 0.75, 0.05, 0.15, M.panelRad));
  // Плинтус по краям комнат там, где за краем пола у самого пола стоит стена (дверные проёмы
  // выпадают сами). Ванная в плитке — без плинтуса; зона кухонного ряда с колонной — тоже.
  const sk = 0.06, st = 0.012, e = 0.004;
  const parts = wallParts(plan).filter(p => p.y0 < 0.03);
  const run = { x0: -1, x1: kit.run.depth + 0.02, z0: -1, z1: kit.run.startZ };
  for (const id of ['kitchen_living', 'hall', 'room2', 'room3']) for (const r of plan.rooms[id].rects) {
    // [ось вдоль края, координата края, наружу]
    for (const [ax, c, s] of [['x', r.z0, -1], ['x', r.z1, 1], ['z', r.x0, -1], ['z', r.x1, 1]]) {
      const ox = ax === 'x' ? 'z' : 'x', q = c + s * e, a0 = r[ax + '0'], a1 = r[ax + '1'];
      let iv = parts.filter(p => p[ox + '0'] < q && q < p[ox + '1'])
        .map(p => [Math.max(a0, p[ax + '0']), Math.min(a1, p[ax + '1'])]);
      if (id === 'kitchen_living' && c >= run[ox + '0'] && c <= run[ox + '1']) iv = iv.flatMap(([u0, u1]) => [[u0, Math.min(u1, run[ax + '0'])], [Math.max(u0, run[ax + '1']), u1]]);
      for (const [u0, u1] of mergeIv(iv)) {
        const [t0, t1] = s > 0 ? [c - st, c] : [c, c + st];
        g.add(ax === 'x' ? boxAt(u0, u1, 0, sk, t0, t1, M.skirting) : boxAt(t0, t1, 0, sk, u0, u1, M.skirting));
      }
    }
  }
  return g;
}
