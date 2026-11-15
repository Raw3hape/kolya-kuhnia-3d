// Ванная как на объекте (не вариант): плитка «кабанчик» 15×7,5 по зонам из spec/bath.json,
// сантехника, стекло душа, светильник. Остальные стены крашеные: это грани стен model.js
// со слотом wallsBath, здесь их не трогаем (плитка ложится поверх тонкими панелями 7 мм).
// Оси плана: X вдоль оконной стены, Z вглубь, Y вверх, метры. UV плитки в метрах: v = 0 у пола,
// u = 0 во внутреннем углу грани (uFrom), так ряды начинаются от пола и швы сходятся в углах.
//
// buildBath(plan, spec, M, state) -> { group, above, cut, colliders, light, setLight(on, scale), ready, seat, dispose }
//   above     — меши у потолка (userData.cut = 'above'), прятать при виде сверху
//   cut       — объекты на стенах (плитка, профили, короб, зеркало, смеситель): прятать вместе со стеной при вырезе
//   colliders — [{ x0, x1, z0, z1 }] для прогулки: короб, унитаз, тумба, стекло
//   light     — SpotLight светильника (выключен интенсивностью 0); setLight(on, scale) включает
//   ready     — Promise: текстуры загружены
//   seat      — wcSeat(spec): где сидит человек на унитазе
// wcSeat(spec) -> { x, y, z, yaw } | null — точка таза на сиденье (крышка закрыта), yaw — куда смотрит сидящий
//   (радианы вокруг +Y, 0 = +Z). Короб на стене x0, унитаз смотрит в +X. Читает seats.js.
import * as THREE from 'three';
import { applyItem } from './materials.js';
import { boxAt } from './model.js';

const EPS = 1e-3;
const LID = 0.012;   // сиденье с крышкой: верх на столько выше wc.bowl.seat

export function wcSeat(spec) {
  const b = spec?.wc?.box, bowl = spec?.wc?.bowl;
  if (!b || !bowl || !Number.isFinite(bowl.seat)) return null;
  return { x: b.x1 + (bowl.hips ?? bowl.depth / 2), y: bowl.seat + LID, z: bowl.z, yaw: Math.PI / 2 };
}

export function buildBath(plan, spec, M, state = {}) {
  const H = plan.ceiling;
  const t = spec.tile.thickness ?? 0.007;
  const R = spec.tile.trim?.size ?? 0.01;
  const group = new THREE.Group(); group.name = 'bath';
  const above = [], cut = [], colliders = [];
  const mat = bathMaterials(spec, state);
  const jobs = [applyItem(mat.tile, { tex: spec.tile.texture, gen: true, rough: 1 })];
  if (spec.vanity?.front?.tex) jobs.push(applyItem(mat.front, spec.vanity.front));
  const ready = Promise.all(jobs.map(j => j.catch(() => null)));

  const ref = v => resolveRef(v, spec, H);
  const faces = {};
  for (const [id, f] of Object.entries(spec.faces)) if (!id.startsWith('_')) faces[id] = { id, external: [], uOffset: 0, ...f };

  const mk = (geo, material, name, parent, { cast = true, receive = true, slot = 'bath' } = {}) => {
    const m = new THREE.Mesh(geo, material);
    m.name = name; m.castShadow = cast; m.receiveShadow = receive;
    if (slot) m.userData.slot = slot;
    parent.add(m);
    return m;
  };
  const lbox = (x0, x1, y0, y1, z0, z1, material, name, parent, opts) => {
    const m = mk(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material, name, parent, opts);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return m;
  };
  const lcyl = (r, len, axis, x, y, z, material, name, parent, seg = 24, opts) => {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
    const m = mk(g, material, name, parent, opts);
    m.position.set(x, y, z);
    return m;
  };

  // ---------- плитка ----------

  const tiles = new THREE.Group(); tiles.name = 'bath_tiles'; group.add(tiles);
  const zones = {};   // id грани -> [{ a0, a1, y0, y1 }] как в спеке (до вырезов)
  for (const z of spec.tile.zones) {
    const f = faces[z.face]; if (!f) continue;
    const a0 = clamp(ref(z.from) ?? f.a0, f.a0, f.a1), a1 = clamp(ref(z.to) ?? f.a1, f.a0, f.a1);
    const y0 = Math.max(0, ref(z.y0) ?? 0), y1 = Math.min(H, ref(z.y1) ?? H);
    if (a1 - a0 > 0.01 && y1 - y0 > 0.01) (zones[f.id] ||= []).push({ a0, a1, y0, y1 });
  }
  const pieces = {};  // id грани -> куски после вырезов (проёмы, короб инсталляции)
  for (const [id, rs] of Object.entries(zones)) {
    let ps = rs.map(r => ({ ...r }));
    for (const h of holesOn(faces[id], plan, spec)) ps = ps.flatMap(p => cut2(p, h));
    pieces[id] = ps;
  }
  const tiledAt = (id, a, y) => (pieces[id] || []).some(p => a >= p.a0 - EPS && a <= p.a1 + EPS && y >= p.y0 - EPS && y <= p.y1 + EPS);

  // Грань, упирающаяся в конец e грани f (внутренний угол)
  const perpAt = (f, e) => Object.values(faces).find(p => p.axis !== f.axis && Math.abs(p.at - e) < 0.002 && f.at > p.a0 - 0.002 && f.at < p.a1 + 0.002);
  // Подрезка/выпуск конца куска: z-грани уступают x-граням во внутреннем углу, x-грани заходят на t во внешнем
  const endShift = (f, end, e, y0, y1) => {
    if (Math.abs(e - f[end]) > EPS) return 0;
    const out = end === 'a1' ? 1 : -1;
    if (f.external.includes(end)) return f.axis === 'x' ? out * t : 0;
    const p = perpAt(f, e);
    if (f.axis === 'z' && p && (pieces[p.id] || []).some(q => q.y0 < y1 - EPS && q.y1 > y0 + EPS && f.at > q.a0 - 0.002 && f.at < q.a1 + 0.002)) return -out * t;
    return 0;
  };

  for (const [id, ps] of Object.entries(pieces)) {
    const f = faces[id];
    ps.forEach((p, i) => {
      const a0 = p.a0 + endShift(f, 'a0', p.a0, p.y0, p.y1), a1 = p.a1 + endShift(f, 'a1', p.a1, p.y0, p.y1);
      const m = tilePanel(f, a0, a1, p.y0, p.y1, t, mat.tile);
      m.name = `bath_tile_${id}_${i}`;
      m.userData.slot = 'bath';
      tiles.add(m); cut.push(m);
    });
  }

  // Профили: по верху панели, по открытому вертикальному краю, на внешних углах
  const trimRuns = [];
  for (const [id, rs] of Object.entries(zones)) {
    const f = faces[id], A = axisVec(f), N = normalVec(f);
    const holes = holesOn(f, plan, spec);
    for (const r of rs) {
      if (r.y1 < H - EPS) {
        const a0 = r.a0 + endShift(f, 'a0', r.a0, r.y0, r.y1) * (f.external.includes('a0') ? 1 + R / t : 1);
        const a1 = r.a1 + endShift(f, 'a1', r.a1, r.y0, r.y1) * (f.external.includes('a1') ? 1 + R / t : 1);
        let segs = [[a0, a1]];
        for (const h of holes) if (h.y0 < r.y1 && h.y1 > r.y1 - EPS) segs = segs.flatMap(([u, v]) => [[u, Math.min(v, h.a0)], [Math.max(u, h.a1), v]]);
        for (const [u, v] of segs) if (v - u > 0.01) trimRuns.push({ o: facePoint(f, u, r.y1, 0), D: N, O: Y_UP, A, len: v - u });
      }
      for (const end of ['a0', 'a1']) {
        const e = r[end];
        if (Math.abs(e - f[end]) < EPS) {
          if (f.external.includes(end) && f.axis === 'x') {
            const c = facePoint(f, e + (end === 'a1' ? t : -t), 0, t);
            const m = lcyl(R * 0.7, r.y1 - r.y0 + (r.y1 < H - EPS ? R : 0), 'y', c.x, (r.y0 + r.y1 + (r.y1 < H - EPS ? R : 0)) / 2, c.z, mat.trim, `bath_trim_corner_${id}`, tiles, 16, { cast: false });
            cut.push(m);
          }
          continue;
        }
        const nb = rs.filter(q => q !== r && (Math.abs(q.a0 - e) < EPS || Math.abs(q.a1 - e) < EPS) && q.y0 <= r.y0 + EPS);
        const ys = Math.max(r.y0, ...nb.map(q => q.y1));
        if (r.y1 - ys > 0.01) trimRuns.push({ o: facePoint(f, e, ys, 0), D: N, O: A.clone().multiplyScalar(end === 'a1' ? 1 : -1), A: Y_UP, len: r.y1 - ys });
      }
    }
  }
  trimRuns.forEach((q, i) => {
    const m = mk(quarterRound(R, q.len, q.o, q.D, q.O, q.A), mat.trim, `bath_trim_${i}`, tiles, { cast: false });
    cut.push(m);
  });

  // ---------- душ ----------

  const sh = spec.shower, far = faces.far, left = faces.left;
  const shower = new THREE.Group(); shower.name = 'bath_shower'; group.add(shower);
  // Профиль края полосы на полу и линейный трап у дальней стены
  const pw = sh.edgeProfile?.width ?? 0.008;
  mk(boxGeo(sh.x0 - pw / 2, sh.x0 + pw / 2, 0, 0.002, sh.z0, sh.z1), mat.metal, 'bath_shower_edge', shower, { cast: false });
  const dw = sh.drain.width, dl = Math.min(sh.drain.length, sh.x1 - sh.x0 - 0.08), dcx = (sh.x0 + sh.x1) / 2;
  const dz1 = sh.z1 - t - sh.drain.fromWall, dz0 = dz1 - dw;
  mk(boxGeo(dcx - dl / 2, dcx + dl / 2, 0, 0.0018, dz0, dz1), mat.metal, 'bath_drain', shower, { cast: false });
  for (let i = 0; i < 3; i++) {
    const zz = dz0 + dw * (i + 1) / 4;
    mk(boxGeo(dcx - dl / 2 + 0.01, dcx + dl / 2 - 0.01, 0.0018, 0.0021, zz - 0.002, zz + 0.002), mat.dark, 'bath_drain_slot', shower, { cast: false });
  }

  // Стекло 8 мм вдоль края полосы, от дальней стены; стеновой профиль и стабилизатор к левой стене
  const gl = sh.glass, gx0 = sh.x0, gx1 = sh.x0 + gl.thickness, gz1 = sh.z1 - t, gz0 = sh.z1 - gl.length;
  const glass = mk(boxGeo(gx0, gx1, 0.004, gl.height, gz0, gz1 - 0.004), mat.glass, 'bath_glass', shower, { cast: false, receive: false });
  glass.userData.glass = true; glass.renderOrder = 2;
  const ch = 0.012;
  mk(boxGeo(gx0 - ch, gx1 + ch, 0, gl.height, gz1 - 0.022, gz1), mat.metal, 'bath_glass_profile', shower);
  const sz = gz0 + 0.06, sy = gl.stabilizerY ?? gl.height - 0.04, sx0 = gx1, sx1 = sh.x1 - (tiledAt('left', sz, sy) ? t : 0);
  lcyl(0.009, sx1 - sx0, 'x', (sx0 + sx1) / 2, sy, sz, mat.metal, 'bath_glass_stabilizer', shower, 16);
  lcyl(0.022, 0.01, 'x', sx1 - 0.005, sy, sz, mat.metal, 'bath_glass_stabilizer_rose', shower, 20);
  mk(boxGeo(gx0 - 0.012, gx1 + 0.03, sy - 0.02, sy + 0.02, sz - 0.02, sz + 0.02), mat.metal, 'bath_glass_clamp', shower);
  colliders.push({ x0: gx0 - 0.01, x1: gx1 + 0.01, z0: gz0, z1: sh.z1 });

  // Термостат на двух выводах, стойка с верхней лейкой, ручная лейка со шлангом
  const set = faceFrame(far, sh.mixer.x, 0); set.name = 'bath_shower_set'; shower.add(set); cut.push(set);
  const d0 = tiledAt('far', sh.mixer.x, sh.mixer.y) ? t : 0;
  const my = sh.mixer.y, sp = sh.mixer.spacing, zc = d0 + 0.065, top = sh.rain.top, reach = sh.rain.reach;
  lcyl(0.027, 0.30, 'x', 0, my, zc, mat.metal, 'mixer_body', set, 32);
  for (const s of [-1, 1]) {
    lcyl(0.031, 0.05, 'x', s * 0.175, my, zc, mat.metal, 'mixer_knob', set, 32);
    lcyl(0.010, 0.065, 'z', s * sp / 2, my, d0 + 0.0325, mat.metal, 'mixer_eccentric', set, 16);
    lcyl(0.032, 0.008, 'z', s * sp / 2, my, d0 + 0.004, mat.metal, 'mixer_rose', set, 32);
  }
  const ry0 = my + 0.027;
  lcyl(0.0125, top - ry0, 'y', 0, (ry0 + top) / 2, zc, mat.metal, 'shower_riser', set, 20);
  lcyl(0.008, zc - d0, 'z', 0, 1.80, d0 + (zc - d0) / 2, mat.metal, 'shower_bracket', set, 12);
  lcyl(0.025, 0.008, 'z', 0, 1.80, d0 + 0.004, mat.metal, 'shower_bracket_rose', set, 24);
  mk(new THREE.SphereGeometry(0.0125, 16, 8), mat.metal, 'shower_elbow', set).position.set(0, top, zc);
  lcyl(0.0125, reach, 'z', 0, top, zc + reach / 2, mat.metal, 'shower_arm', set, 20);
  lcyl(sh.rain.diameter / 2, 0.008, 'y', 0, top - 0.024, zc + reach, mat.metal, 'shower_head', set, 48);
  lcyl(0.016, 0.02, 'y', 0, top - 0.01, zc + reach, mat.metal, 'shower_head_joint', set, 16);
  const hy = sh.hand.y;
  lbox(-0.02, 0.02, hy - 0.02, hy + 0.02, zc - 0.018, zc + 0.03, mat.metal, 'hand_holder', set);
  const hand = new THREE.Group(); hand.name = 'hand_shower'; hand.position.set(0, hy - 0.06, zc + 0.045); hand.rotation.x = -0.22; set.add(hand);
  lcyl(0.014, 0.20, 'y', 0, 0, 0, mat.metal, 'hand_grip', hand, 20);
  lcyl(0.05, 0.022, 'y', 0, 0.11, 0, mat.metal, 'hand_head', hand, 32).rotation.x = Math.PI / 2 - 0.15;
  const hose = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, my - 0.027, zc), new THREE.Vector3(0.03, my - 0.25, zc + 0.03),
    new THREE.Vector3(0.07, 0.55, zc + 0.06), new THREE.Vector3(0.05, hy - 0.40, zc + 0.06), new THREE.Vector3(0, hy - 0.16, zc + 0.024),
  ]);
  mk(new THREE.TubeGeometry(hose, 48, 0.0075, 8), mat.metal, 'hand_hose', set);

  // ---------- унитаз: короб инсталляции, кнопка, подвесная чаша ----------

  const wc = spec.wc, bx = wc.box;
  const boxMat = bx.finish === 'tile' ? mat.tile : M.wallsBath;
  const box = boxAt(bx.x0, bx.x1, 0, bx.height, bx.z0, bx.z1, boxMat, { slot: 'wallsBath' });
  box.name = 'bath_wc_box'; group.add(box); cut.push(box);
  colliders.push({ x0: bx.x0, x1: bx.x1, z0: bx.z0, z1: bx.z1 });
  const front = { axis: 'z', at: bx.x1, normal: 1 };
  const plate = faceFrame(front, wc.bowl.z, 0); plate.name = 'bath_wc_plate'; group.add(plate); cut.push(plate);
  const pw2 = wc.plate.width / 2, ph2 = wc.plate.height / 2, py = wc.plate.y;
  lbox(-pw2, pw2, py - ph2, py + ph2, 0, 0.004, mat.metal, 'plate_frame', plate);
  for (const s of [-1, 1]) lbox(s > 0 ? 0.002 : -pw2 + 0.008, s > 0 ? pw2 - 0.008 : -0.002, py - ph2 + 0.008, py + ph2 - 0.008, 0.004, 0.009, mat.metal, 'plate_button', plate);

  const bowl = faceFrame(front, wc.bowl.z, 0); bowl.name = 'bath_wc'; group.add(bowl);
  const bw = wc.bowl.width, bd = wc.bowl.depth, rim = wc.bowl.seat - 0.025;
  const bodyGeo = new THREE.ExtrudeGeometry(eggShape(bw - 0.03, bd - 0.015), { depth: 0.25, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3, curveSegments: 16 });
  bodyGeo.rotateX(Math.PI / 2); bodyGeo.translate(0, rim - 0.015, 0);
  taper(bodyGeo, rim - 0.28, rim - 0.06);
  mk(bodyGeo, mat.ceramic, 'wc_bowl', bowl);
  // Сиденье с закрытой крышкой одним телом: от края чаши до seat + LID
  const lidGeo = new THREE.ExtrudeGeometry(eggShape(bw - 0.02, bd - 0.035), { depth: wc.bowl.seat + LID - rim - 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 16 });
  lidGeo.rotateX(Math.PI / 2); lidGeo.translate(0, wc.bowl.seat + LID - 0.006, 0.012);
  mk(lidGeo, mat.seat, 'wc_seat_lid', bowl);
  lbox(-0.11, 0.11, rim - 0.01, wc.bowl.seat + 0.01, 0, 0.035, mat.ceramic, 'wc_hinge_block', bowl);
  for (const s of [-1, 1]) lcyl(0.012, 0.03, 'x', s * 0.075, wc.bowl.seat + 0.004, 0.04, mat.metal, 'wc_hinge', bowl, 12);
  colliders.push({ x0: bx.x1, x1: bx.x1 + bd, z0: wc.bowl.z - bw / 2, z1: wc.bowl.z + bw / 2 });

  // ---------- тумба с раковиной, смеситель, зеркало, розетка ----------

  const v = spec.vanity;
  const van = faceFrame(far, v.x, 0); van.name = 'bath_vanity'; group.add(van);
  const vd0 = tiledAt('far', v.x, v.top - v.height + 0.01) ? t : 0;
  const vw = v.width / 2, vtop = v.top, vbot = v.top - v.height, slab = 0.04;
  // Корпус открыт сверху под чашей раковины: низ, боковины, задняя стенка (иначе крышка корпуса видна в чаше)
  const cy1 = vtop - slab - 0.003, cz1 = vd0 + v.depth - 0.025, bowlBot = vtop - 0.012 - 0.13, pt = 0.018;
  lbox(-vw, vw, vbot, bowlBot - 0.005, vd0, cz1, mat.front, 'vanity_body', van);
  for (const s of [-1, 1]) lbox(s < 0 ? -vw : vw - pt, s < 0 ? -vw + pt : vw, bowlBot - 0.005, cy1, vd0, cz1, mat.front, 'vanity_side', van);
  lbox(-vw + pt, vw - pt, bowlBot - 0.005, cy1, vd0, vd0 + pt, mat.front, 'vanity_back', van);
  lbox(-vw + 0.002, vw - 0.002, vbot + 0.002, vtop - slab - 0.025, vd0 + v.depth - 0.025, vd0 + v.depth - 0.007, mat.front, 'vanity_drawer', van);
  const top2 = new THREE.Shape(); roundRect(top2, -vw, 0, v.width, v.depth, 0.012);
  const hole = new THREE.Path(); hole.absellipse(0, v.depth * 0.54, vw - 0.07, v.depth * 0.32, 0, Math.PI * 2, false, 0);
  top2.holes.push(hole);
  const topGeo = new THREE.ExtrudeGeometry(top2, { depth: slab, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 24 });
  topGeo.rotateX(Math.PI / 2); topGeo.translate(0, vtop, vd0);
  mk(topGeo, mat.ceramic, 'vanity_basin_top', van);
  const bowlIn = new THREE.SphereGeometry(1, 32, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bowlIn.scale(vw - 0.065, 0.13, v.depth * 0.32 + 0.005); bowlIn.translate(0, vtop - 0.012, vd0 + v.depth * 0.54);
  mk(bowlIn, mat.ceramic, 'vanity_basin_bowl', van);
  lcyl(0.018, 0.003, 'y', 0, bowlBot + 0.002, vd0 + v.depth * 0.54, mat.metal, 'vanity_waste', van, 20, { cast: false });
  const tz = vd0 + 0.06;
  lcyl(0.022, 0.16, 'y', 0, vtop + 0.08, tz, mat.metal, 'tap_body', van, 24);
  lcyl(0.011, 0.12, 'z', 0, vtop + 0.145, tz + 0.06, mat.metal, 'tap_spout', van, 16);
  lbox(-0.005, 0.005, vtop + 0.16, vtop + 0.172, tz - 0.05, tz + 0.01, mat.metal, 'tap_lever', van);
  colliders.push({ x0: v.x - vw, x1: v.x + vw, z0: far.at - vd0 - v.depth, z1: far.at });

  const mr = spec.mirror;
  const mir = faceFrame(far, mr.x, 0); mir.name = 'bath_mirror'; group.add(mir); cut.push(mir);
  const md = tiledAt('far', mr.x, mr.y0 + 0.01) ? t : 0;
  lbox(-mr.width / 2 + 0.05, mr.width / 2 - 0.05, mr.y0 + 0.05, mr.y1 - 0.05, md, md + 0.012, mat.dark, 'mirror_spacer', mir);
  const glassM = lbox(-mr.width / 2, mr.width / 2, mr.y0, mr.y1, md + 0.012, md + 0.017, mat.mirror, 'mirror', mir);
  // отражает саму ванную, а не уличную панораму: lighting.js снимает куб-зонд комнаты (локальная ось +Z — в комнату)
  glassM.userData.localReflection = true;

  if (spec.outlet) {
    const of = faces[spec.outlet.face] || far;
    const so = faceFrame(of, spec.outlet.x, 0); so.name = 'bath_outlet'; group.add(so); cut.push(so);
    const od = tiledAt(of.id, spec.outlet.x, spec.outlet.y) ? t : 0, oy = spec.outlet.y;
    lbox(-0.04, 0.04, oy - 0.04, oy + 0.04, od, od + 0.012, mat.plastic, 'outlet_frame', so);
    lbox(-0.032, 0.032, oy - 0.032, oy + 0.03, od + 0.012, od + 0.02, mat.plastic, 'outlet_flap', so);
  }

  // ---------- светильник на потолке ----------

  const L = spec.light, lamp = new THREE.Group(); lamp.name = 'bath_light'; lamp.position.set(L.x, H, L.z); group.add(lamp);
  const lr = L.diameter / 2, lh = L.height;
  for (const m of [
    lcyl(lr, lh - 0.012, 'y', 0, -(lh - 0.012) / 2, 0, mat.housing, 'light_body', lamp, 48, { cast: false }),
    lcyl(lr - 0.012, 0.012, 'y', 0, -lh + 0.006, 0, mat.diffuser, 'light_diffuser', lamp, 48, { cast: false }),
  ]) { m.userData.cut = 'above'; above.push(m); }
  const light = new THREE.SpotLight(0xffe7c8, 0, 0, Math.PI / 2.2, 1, 2);
  light.name = 'bath_light_spot';
  light.position.set(L.x, H - lh - 0.01, L.z);
  light.target.position.set(L.x, 0, L.z);
  light.userData = { lm: L.lm, base: L.lm / Math.PI };   // ламбертовский вниз: кд = лм / π
  // выключен интенсивностью, а не visible: смена числа источников пересобирает шейдеры всей сцены
  group.add(light, light.target);
  const setLight = (on, scale = 1) => {
    light.intensity = on ? light.userData.base * scale : 0;
    mat.diffuser.emissiveIntensity = on ? 1.4 : 0;
  };

  const dispose = () => {
    group.traverse(o => o.geometry?.dispose());
    for (const m of Object.values(mat)) { for (const k of ['map', 'normalMap', 'roughnessMap']) m[k]?.dispose(); m.dispose(); }
  };
  return { group, above, cut, colliders, light, setLight, ready, seat: wcSeat(spec), dispose };
}

// ---------- материалы ----------

function bathMaterials(spec, state) {
  const P = (name, o) => { const m = new THREE.MeshPhysicalMaterial(o); m.name = name; return m; };
  const metalKind = state?.bathMetal || spec.finish?.metal || 'black';
  const metal = metalKind === 'chrome'
    ? { color: '#e4e5e6', metalness: 1, roughness: 0.08 }
    : { color: '#1f1f20', metalness: 0.35, roughness: 0.42 };
  const trim = {
    white: { color: '#f2f2ef', roughness: 0.3 },
    steel: { color: '#c4c6c8', metalness: 1, roughness: 0.3 },
    black: { color: '#232425', metalness: 0.3, roughness: 0.45 },
  }[spec.tile.trim?.finish] || { color: '#f2f2ef', roughness: 0.3 };
  const fr = spec.vanity?.front || {};
  return {
    tile: P('bathTile', { color: '#f3f3f0', roughness: 0.3 }),
    trim: P('bathTrim', trim),
    ceramic: P('bathCeramic', { color: '#f7f7f5', roughness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.05, side: THREE.DoubleSide }),
    seat: P('bathSeat', { color: '#f3f3f1', roughness: 0.22, clearcoat: 0.3, clearcoatRoughness: 0.1 }),
    metal: P(metalKind === 'chrome' ? 'bathChrome' : 'bathBlackMetal', metal),
    glass: P('bathGlass', { color: '#26302e', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 }),
    mirror: P('bathMirror', { color: '#e3e6e6', metalness: 1, roughness: 0.02 }),
    front: P('bathVanity', { color: fr.color || '#ecebe6', roughness: fr.rough ?? 0.55 }),
    dark: P('bathDark', { color: '#2a2a2b', roughness: 0.8 }),
    plastic: P('bathPlastic', { color: '#f1f1ef', roughness: 0.35 }),
    housing: P('bathLampBody', { color: '#f1f1ef', roughness: 0.45 }),
    diffuser: P('bathLampDiffuser', { color: '#f6f5f2', roughness: 0.6, emissive: '#fff1dc', emissiveIntensity: 0 }),
  };
}

// ---------- грани ----------

const Y_UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const axisVec = f => (f.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1));
const normalVec = f => (f.axis === 'x' ? new THREE.Vector3(0, 0, f.normal) : new THREE.Vector3(f.normal, 0, 0));

// Число, 'ceiling', 'wainscot' или путь в спеке ('shower.x0')
function resolveRef(v, spec, H) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (v === 'ceiling') return H;
  if (v === 'wainscot') return spec.tile.wainscot;
  const r = String(v).split('.').reduce((o, k) => o?.[k], spec);
  return typeof r === 'number' ? r : null;
}

// Точка мира по координатам грани: a — вдоль грани, y — высота, d — отступ от плоскости в комнату
function facePoint(f, a, y, d) {
  return f.axis === 'x' ? new THREE.Vector3(a, y, f.at + f.normal * d) : new THREE.Vector3(f.at + f.normal * d, y, a);
}

// u раскладки: от угла uFrom в сторону грани, плюс сдвиг рисунка
function uOf(f, a) {
  const dir = Math.abs(f.a1 - f.uFrom) >= Math.abs(f.a0 - f.uFrom) ? 1 : -1;
  return dir * (a - f.uFrom) + (f.uOffset || 0);
}

// Локальная система у грани: x вдоль стены, y вверх, z от стены в комнату
function faceFrame(f, a, d) {
  const g = new THREE.Group();
  g.position.copy(facePoint(f, a, 0, d));
  const n = normalVec(f);
  g.rotation.y = Math.atan2(n.x, n.z);
  return g;
}

// Вырезы на грани: проёмы плана и короб инсталляции, если он стоит вплотную
function holesOn(f, plan, spec) {
  const out = [], perp = f.axis === 'x' ? 'z' : 'x';
  for (const o of plan.openings) {
    if (o.along !== f.axis || f.at < o[perp + '0'] - 0.02 || f.at > o[perp + '1'] + 0.02) continue;
    out.push({ a0: o[f.axis + '0'], a1: o[f.axis + '1'], y0: o.sill, y1: o.head });
  }
  const b = spec.wc?.box;
  if (b) {
    const near = f.normal > 0 ? b[perp + '0'] : b[perp + '1'];
    if (Math.abs(near - f.at) < 0.01) out.push({ a0: b[f.axis + '0'], a1: b[f.axis + '1'], y0: 0, y1: b.height });
  }
  return out;
}

// Прямоугольник (a, y) минус прямоугольник
function cut2(r, h) {
  if (h.a0 >= r.a1 || h.a1 <= r.a0 || h.y0 >= r.y1 || h.y1 <= r.y0) return [r];
  const out = [];
  const push = o => { if (o.a1 - o.a0 > 0.005 && o.y1 - o.y0 > 0.005) out.push(o); };
  push({ ...r, a1: h.a0 }); push({ ...r, a0: h.a1 });
  const m = { ...r, a0: Math.max(r.a0, h.a0), a1: Math.min(r.a1, h.a1) };
  push({ ...m, y1: h.y0 }); push({ ...m, y0: h.y1 });
  return out;
}

// ---------- геометрия ----------

function boxGeo(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

// Панель плитки толщиной t на грани, UV в метрах раскладки (u от угла, v = высота от пола)
function tilePanel(f, a0, a1, y0, y1, t, material) {
  const p = facePoint(f, a0, y0, 0), q = facePoint(f, a1, y1, t);
  const g = boxGeo(Math.min(p.x, q.x), Math.max(p.x, q.x), y0, y1, Math.min(p.z, q.z), Math.max(p.z, q.z));
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, uOf(f, f.axis === 'x' ? pos.getX(i) : pos.getZ(i)), pos.getY(i));
  const m = new THREE.Mesh(g, material);
  m.castShadow = false; m.receiveShadow = true;
  return m;
}

// Профиль-четвертушка радиуса R длиной len: D — от стены, O — от кромки плитки наружу, A — вдоль
function quarterRound(R, len, origin, D, O, A) {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(R, 0); s.absarc(0, 0, R, 0, Math.PI / 2, false); s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 6 });
  let a = A.clone(), o = origin.clone();
  if (new THREE.Vector3().crossVectors(O, A).dot(D) < 0) { a.negate(); o.addScaledVector(A, len); }
  g.applyMatrix4(new THREE.Matrix4().makeBasis(D, O, a).setPosition(o));
  return g;
}

// Контур подвесного унитаза в плане: задняя кромка у стены (t = 0), закруглённый нос (t = d)
function eggShape(w, d) {
  const s = new THREE.Shape(), h = w / 2;
  s.moveTo(-h, 0); s.lineTo(h, 0); s.lineTo(h, d * 0.3);
  s.bezierCurveTo(h, d * 0.8, w * 0.3, d, 0, d);
  s.bezierCurveTo(-w * 0.3, d, -h, d * 0.8, -h, d * 0.3);
  s.closePath();
  return s;
}

// Сужение чаши книзу: ниже yTop контур плавно сжимается до ~78 % у yBot (к стене не сдвигается)
function taper(g, yBot, yTop) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = clamp((p.getY(i) - yBot) / (yTop - yBot), 0, 1), f = 0.78 + 0.22 * Math.sin(k * Math.PI / 2);
    p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * (0.86 + 0.14 * f));
  }
  g.computeVertexNormals();
}

function roundRect(s, x, y, w, h, r) {
  s.moveTo(x, y); s.lineTo(x + w, y); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y);
}
