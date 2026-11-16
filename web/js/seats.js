// Сесть от первого лица: на унитаз, на диван (смотреть ТВ), на стулья, скамьи и кресла из обстановки.
// Места берутся из данных, ничего не вписано руками: диван — furn.items.sofa (seatH и backH из spec/sofas.json,
// спинка находится лучом по самой модели), унитаз — wcSeat(spec/bath.json), обстановка — decor.seats
// (их пересчитывает placeDecor, когда вещь сдвинули в редакторе или она едет за своей опорой).
// Места пересчитываются, когда меняется сцена (диван сдвинули или выбрали другой, другая обстановка), не каждый кадр.
//
// createSeats({ THREE, scene, camera, canvas, controls, plan, bathSpec, walk, requestRender,
//               getState, getFurniture, getDecor, getDoors, getTV })
//   -> { active   — сидим (камеру ведёт этот модуль; прогулка, облёт и полёт WASD в это время выключены),
//        target   — сиденье под прицелом в прогулке (E — сесть) или null: оружие в этот момент не стреляет,
//        current  — id сиденья, на котором сидим, или null,
//        update(dt) -> bool (true — нужен кадр; в покое false и почти ноль работы),
//        sitOn(id) -> bool, stand({ toWalk }?), list() -> [{ id, label }], dispose() }
//   В прогулке: прицел на сиденье ближе SEAT.reach — подсказка «E — сесть», E или клик сажают (дверь важнее).
//   Сидя: мышь или палец — осмотреться (±70° вбок, −45…+30° вверх-вниз), колесо — угол обзора,
//   E, Esc, Пробел или кнопка «Встать» — встать; F — встать и сразу пойти.
//   Встаём туда, откуда сели: в прогулку на свободное место перед сиденьем или в прежний вид облёта.
//   На диване включается звук ТВ (getTV().setAudio), встали — выключается.
//   Вещь в руке (телефон, газета — handheld.js) остаётся в руке и сидя: колесо и свайп листают её, а не приближают;
//   E на сиденье с вещью в руке сажает как обычно (handheld.js пропускает E к дверям и сиденьям под прицелом).
// registerSeatsUI(addSection, getSeats) — раздел «Сесть» во вкладке 'live' сразу после «Прогулки»: кнопка на каждое место.
import { WALK, naturalFov, buildColliders } from './walk.js';
import { wcSeat } from './bath.js';
import { SOFA_CATALOG, FURN_SPEC } from './furniture.js';
import { injectStyle } from './minimap.js';
import { addHelp } from './help.js';
import { decorPart } from './decor.js';

// Справка (help.js): ui.js — окно «?», полоса внизу сидя (brief), раздел «Сесть»
addHelp(
  { mode: 'walk', topic: 'seat', keys: ['E'], text: 'сесть, когда прицел на диване, стуле или кресле (или клик)', touch: 'кнопка «Сесть» под прицелом', order: 55 },
  { mode: 'design', topic: 'seat', keys: [], text: 'сесть можно и без прогулки: вкладка «Прогулка» → «Сесть»', order: 65 },
  { mode: 'seat', topic: 'seat', keys: ['мышь'], text: 'осмотреться, колесо — приблизить', touch: 'ведите пальцем — осмотреться', brief: true, order: 10 },
  { mode: 'seat', topic: 'seat', keys: ['E'], text: 'встать (или Esc, Пробел); F — встать сразу в прогулку', touch: '«Встать» внизу', brief: true, order: 20 },
  { mode: 'seat', topic: 'seat', keys: [], text: 'на диване включается звук телевизора', order: 30 },
  { mode: 'seat', topic: 'seat', keys: ['колесо'], text: 'с телефоном или газетой в руке колесо листает их, Q — вернуть на место; встали — вещь остаётся в руке', order: 40 },
);

export const SEAT = {
  eyeAboveSeat: 0.72,  // глаза над сиденьем у человека ростом WALK.height (дальше — пропорционально росту из прогулки), м
  hipFromBack: 0.2,    // таз сидящего на диване — на столько впереди спинки, м
  minFront: 0.15,      // и не ближе этого к переднему краю сиденья, м
  standOut: 0.6,       // встали — шаг вперёд от таза, м (дальше ближайшее свободное место ищет прогулка)
  reach: 2.0,          // в прогулке E достаёт до сиденья, м по полу
  yaw: 70,             // осмотреться вбок от направления сиденья, градусы
  pitchMin: -45, pitchMax: 30,
  transition: 0.8,     // сесть и встать, с
  uiMax: 8,            // сколько кнопок «Сесть…» держит панель
};

const RAD = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const coarse = () => { try { return matchMedia('(hover: none), (pointer: coarse)').matches; } catch { return false; } };
const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function createSeats({ THREE, scene, camera, canvas, controls, plan, bathSpec, walk, requestRender,
  getState, getFurniture, getDecor, getDoors, getTV, seating }) {
  const wc = wcSeat(bathSpec);
  const walls = buildColliders(plan).boxes;   // стены по плану (проёмы открыты): прицел не сажает сквозь стену
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const ray = new THREE.Raycaster(); ray.layers.enableAll();
  ray.firstHitOnly = true; // Back/seat queries use the nearest eligible mesh surface.

  // ---------- места из сцены ----------
  // Место: { id, label, root (объект для прицела), hip: Vector3 (точка таза на сиденье), face (куда смотрит, 0 = +Z),
  //          look: Vector3 | null (на что смотреть, сев: экран ТВ) }

  const sofaDims = (S, obj) => {
    const e = SOFA_CATALOG.find(x => x.id === S.sofaModel);
    if (e) return { seatH: e.seatH, backH: e.backH ?? e.size.h };
    const s = FURN_SPEC?.sofas?.[S.sofa] ?? FURN_SPEC?.sofas?.straight3;
    return s ? { seatH: s.seatH, backH: s.h } : { seatH: obj.userData.seatH, backH: null };
  };
  function sofaSeat(furn, S) {
    const obj = furn?.items?.sofa;
    if (!obj || !obj.visible) return null;
    const d = obj.userData.depth, { seatH, backH } = sofaDims(S, obj);
    if (!Number.isFinite(d) || !Number.isFinite(seatH)) return null;
    obj.updateWorldMatrix(true, true);
    // спинка — лучом по самой модели: от переда к спинке на середине её высоты над сиденьем
    const y = Number.isFinite(backH) && backH > seatH ? (seatH + backH) / 2 : seatH + 0.2, z0 = d / 2 + 0.2;
    const face = obj.rotation.y, dir = V(-Math.sin(face), 0, -Math.cos(face));
    ray.set(obj.localToWorld(V(0, y, z0)), dir); ray.far = d + 0.4;
    const hit = ray.intersectObject(obj, true).find(h => h.object.visible);
    const back = hit ? z0 - hit.distance : -d / 2;
    const hipZ = Math.min(back + SEAT.hipFromBack, d / 2 - SEAT.minFront);
    const hip = obj.localToWorld(V(0, 0, hipZ)); hip.y = seatH;
    return { id: 'sofa', label: 'Диван · левое место', root: obj, hip, face, look: tvPoint(furn) };
  }
  // Экран ТВ: меш с userData.tvScreen или 'tv_screen' (его ставит tv.js), иначе центр ТВ из мебели
  function tvPoint(furn) {
    let screen = null;
    const find = o => { if (!screen && (o.userData.tvScreen || o.name === 'tv_screen')) screen = o; };
    furn?.group?.traverse(find);
    if (!screen) scene.traverse(find);
    const o = screen || furn?.items?.tv;
    if (!o || !o.visible) return null;
    o.updateWorldMatrix(true, false);
    if (o.isMesh && o.geometry) {
      o.geometry.boundingBox || o.geometry.computeBoundingBox();
      return o.geometry.boundingBox.getCenter(V()).applyMatrix4(o.matrixWorld);
    }
    return o.getWorldPosition(V());
  }
  function wcAnchor() {
    if (!wc) return null;
    const root = scene.getObjectByName('bath_wc');
    if (root && !root.visible) return null;
    return { id: 'wc', label: 'Сесть на унитаз', root, hip: V(wc.x, wc.y, wc.z), face: wc.yaw, look: null };
  }
  function decorSeats(decor) {
    const list = Array.isArray(decor?.seats) ? decor.seats : [];
    const holders = decor?.group?.children ?? [];
    return list.filter(s => [s.x, s.y, s.z, s.yaw].every(Number.isFinite)).map(s => {
      // объект для прицела — сама часть (decor.js отдаёт root), иначе ближайшая вещь к месту (по полу, не дальше метра)
      let root = s.root?.isObject3D ? s.root : null, best = 1;
      if (!root) for (const h of holders) { const dd = Math.hypot(h.position.x - s.x, h.position.z - s.z); if (dd < best) { best = dd; root = h; } }
      const hitRoots = String(s.id).startsWith('d_room2_bed:') ? holders.filter(h => { const part = decorPart(h); return h.userData.decor === root?.userData.decor && part?.option.parts[part.index].seatTarget; }) : [root];
      return { id: String(s.id), label: s.label || 'Сесть', root, hitRoots, hip: V(s.x, s.y, s.z), face: s.yaw, look: null };
    });
  }

  // Ключ сцены: что влияет на места. Считается, только когда места нужны (прогулка, сидим, панель).
  let anchors = [], lastKey = [];
  function sceneKey() {
    const furn = getFurniture?.(), sofa = furn?.items?.sofa, tv = furn?.items?.tv, decor = getDecor?.(), S = getState?.() ?? {};
    return [furn, sofa, sofa?.position.x, sofa?.position.z, sofa?.rotation.y, sofa?.children.length, S.sofaModel, S.sofa,
      tv, tv?.position.x, tv?.position.y, tv?.position.z, decor, decor?.seats, decor?.seats?.length];
  }
  function getAnchors() {
    const key = sceneKey();
    if (key.length === lastKey.length && key.every((v, i) => v === lastKey[i])) return anchors;
    lastKey = key;
    const S = getState?.() ?? {};
    const sofa = sofaSeat(getFurniture?.(), S), sofaSeats = [];
    if (sofa) for (const [i, sign] of [[0, -1], [1, 1]]) {
      const hip = sofa.hip.clone(); hip.x += Math.cos(sofa.face) * sign * seating.sofaSpacing / 2; hip.z -= Math.sin(sofa.face) * sign * seating.sofaSpacing / 2;
      sofaSeats.push({ ...sofa, hip, id: i ? 'sofa:2' : 'sofa', label: i ? 'Диван · правое место' : sofa.label });
    }
    const decor = decorSeats(getDecor?.());
    const bed = decor.find(a => a.id.startsWith('d_room2_bed:'));
    const recline = bed ? { ...bed, id: bed.id + ':recline', label: 'Лечь рядом с ноутбуком', posture: 'recline',
      hip: bed.root.localToWorld(V(-seating.reclineOffset, bed.hip.y - bed.root.position.y + seating.reclineHip, 0)),
      stand: bed.root.localToWorld(V(-seating.reclineOffset - SEAT.standOut, 0, 0)),
      look: bed.hip.clone().add(V(0, 0.15, -0.1)) } : null;
    anchors = [...sofaSeats, wcAnchor(), recline, ...decor].filter(Boolean);
    return anchors;
  }
  const byId = id => getAnchors().find(a => a.id === id) || null;

  // ---------- поза сидящего ----------

  const eyeAbove = () => SEAT.eyeAboveSeat * ((walk?.personHeight ?? WALK.height) / WALK.height);
  const eyeOf = a => a.posture === 'recline' ? V(a.hip.x, a.hip.y + seating.reclineEye, a.hip.z).addScaledVector(V(-Math.sin(a.face), 0, -Math.cos(a.face)), seating.reclineHead) : V(a.hip.x, a.hip.y + eyeAbove(), a.hip.z);
  const fwdOf = face => V(Math.sin(face), 0, Math.cos(face));
  const YAW = SEAT.yaw * RAD, PMIN = SEAT.pitchMin * RAD, PMAX = SEAT.pitchMax * RAD;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const quatOf = (y, p) => new THREE.Quaternion().setFromEuler(euler.set(p, y, 0, 'YXZ'));

  // mode: off | sitting (переход) | seated | standing (переход); камера: yaw = base + rel (base — лицом по сиденью)
  let mode = 'off', seat = null, eye = null, base = 0, rel = 0, tRel = 0, pitch = 0, tPitch = 0, fov = 55, tFov = 55;
  let anim = null, origin = null, applied = '', target = null, seatKeyRef = null;
  let network = null, seatOwners = {}, pendingSeat = false, networkGeneration = 0;
  const selfId = () => typeof network?.selfId === 'function' ? network.selfId() : network?.selfId;
  const available = id => !network || !seatOwners[id] || seatOwners[id] === selfId();
  function requestSeat(action) {
    if (pendingSeat) return false;
    const current = network, generation = networkGeneration;
    pendingSeat = true; renderAim();
    return Promise.resolve(current.request?.(action)).then(result => !!result?.ok).catch(() => false)
      .finally(() => { if (generation === networkGeneration) { pendingSeat = false; renderAim(); } });
  }

  function aimAt(a, e) {
    base = a.face + Math.PI;   // камера смотрит в −Z: лицом по +face
    if (a.look) {
      const d = a.look.clone().sub(e);
      rel = clamp(wrap(Math.atan2(-d.x, -d.z) - base), -YAW, YAW);
      pitch = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), PMIN, PMAX);
    } else { rel = 0; pitch = WALK.pitch0 * RAD; }
    tRel = rel; tPitch = pitch;
  }
  function startAnim(toPos, toQ, toFov, dur, end) {
    anim = { t: 0, dur: reduced() ? 0 : dur, fromPos: camera.position.clone(), toPos, fromQ: camera.quaternion.clone(), toQ,
      fromFov: camera.fov, toFov, end };
  }

  function sitOn(id, { authoritative = false, instant = false } = {}) {
    const a = byId(id);
    if (!a) return false;
    if (network && !authoritative) return available(id) ? requestSeat({ kind: 'sit', id }) : false;
    if (mode === 'off') {
      if (walk?.active) {
        const orbit = walk.orbitPose;       // облёт до прогулки: туда вернёт выход из неё после того, как встанем
        walk.exit({ restore: false, network: authoritative });
        if (walk.active) return false;      // прогулка ещё доигрывает выход
        origin = { walk: true, orbit, from: camera.position.clone() };
      } else {
        origin = { walk: false, pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
      }
      controls.enabled = false;
      fov = tFov = naturalFov(camera.aspect);
    }
    if (seat?.id.startsWith('sofa') && !a.id.startsWith('sofa')) getTV?.()?.setAudio(false);
    seat = a; seatKeyRef = lastKey; eye = eyeOf(a);
    aimAt(a, eye);
    mode = 'sitting';
    startAnim(eye.clone(), quatOf(base + rel, pitch), fov, instant ? 0 : SEAT.transition, () => { mode = 'seated'; });
    if (a.id.startsWith('sofa')) getTV?.()?.setAudio(true);
    // фокус с кнопки панели: иначе Пробел («встать») снова нажмёт её
    if (document.activeElement?.closest?.('#panel')) document.activeElement.blur();
    target = null; renderAim(); syncUI();
    requestRender?.();
    return true;
  }

  function stand({ toWalk = false, authoritative = false, pose = null } = {}) {
    if (mode === 'off' || mode === 'standing') return;
    if (network && !authoritative) return requestSeat({ kind: 'stand' });
    const a = seat;
    if (a?.id.startsWith('sofa')) getTV?.()?.setAudio(false);
    lookRelease();
    if (origin?.walk || toWalk) {
      // в прогулку: прогулка сама плавно переведёт камеру к свободному месту перед сиденьем
      const fw = fwdOf(a.face), p = pose && Number.isFinite(pose.x) && Number.isFinite(pose.z) ? V(pose.x, 0, pose.z) : origin.from?.clone() || a.stand?.clone() || a.hip.clone().addScaledVector(fw, SEAT.standOut);
      const orbit = origin.walk ? origin.orbit : origin;
      controls.target.copy(camera.position).addScaledVector(camera.getWorldDirection(V()), 2);
      finish(false);
      if (!walk?.enter({ x: p.x, z: p.z }, pose?.yaw ?? a.face + Math.PI, { orbit, network: authoritative })) controls.enabled = true;
      if (authoritative && pose) walk?.reconcileNetwork?.(pose, pose.ack, { snap: true });
      return;
    }
    mode = 'standing';
    const m = new THREE.Matrix4().lookAt(origin.pos, origin.target, camera.up);
    startAnim(origin.pos.clone(), new THREE.Quaternion().setFromRotationMatrix(m), origin.fov, SEAT.transition, () => {
      restoreOrbitInstant();
      finish(true);
    });
    syncUI();
    requestRender?.();
  }
  // облёт как был: позиция, точка взгляда, угол обзора
  function restoreOrbitInstant() {
    camera.position.copy(origin.pos); camera.fov = origin.fov; camera.updateProjectionMatrix();
    controls.target.copy(origin.target); camera.lookAt(origin.target);
  }
  // releaseControls: false — камерой дальше распоряжается кто-то другой (прогулка, переход к ракурсу)
  function finish(releaseControls) {
    mode = 'off'; seat = null; eye = null; anim = null; origin = null; applied = '';
    if (releaseControls) { controls.enabled = true; controls.update?.(); }
    syncUI();
    requestRender?.();
  }
  // камеру забрали снаружи (ракурс из панели, телепорт по плану, включили прогулку): встаём на месте
  function abandon(byWalk) {
    if (seat?.id.startsWith('sofa')) getTV?.()?.setAudio(false);
    lookRelease();
    if (!byWalk) {
      controls.target.copy(camera.position).addScaledVector(camera.getWorldDirection(V()), 2);
      finish(true);
    } else finish(false);
  }

  function apply() {
    camera.position.copy(eye);
    camera.quaternion.copy(quatOf(base + rel, pitch));
    if (Math.abs(camera.fov - fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }

  // ---------- кадр ----------

  const lastCam = new Float64Array(16);
  let aimDirty = true;
  function update(dt = 0) {
    if (mode === 'off') {
      if (walk?.walking) {
        // прицел пересчитываем, только когда сдвинулась камера (в покое — сравнение 16 чисел)
        const e = camera.matrixWorld.elements;
        let same = !aimDirty;
        for (let i = 0; i < 16 && same; i++) same = e[i] === lastCam[i];
        if (!same) { lastCam.set(e); aimDirty = false; aim(); }
        else if (target && getDoors?.()?.target) renderAim();
      } else if (target || !aimDirty) { target = null; aimDirty = true; renderAim(); }
      return false;
    }
    if (walk?.active) { abandon(true); return true; }
    if (anim) {
      anim.t = anim.dur > 0 ? Math.min(1, anim.t + dt / anim.dur) : 1;
      const k = ease(anim.t);
      camera.position.lerpVectors(anim.fromPos, anim.toPos, k);
      camera.quaternion.slerpQuaternions(anim.fromQ, anim.toQ, k);
      camera.fov = anim.fromFov + (anim.toFov - anim.fromFov) * k;
      camera.updateProjectionMatrix();
      if (anim.t >= 1) { const a = anim; anim = null; a.end(); applied = ''; if (mode === 'seated') apply(); }
      return true;
    }
    if (mode !== 'seated') return false;
    if (camera.position.distanceToSquared(eye) > 1e-8) { abandon(false); return true; }
    // место сдвинулось (диван переставили, сменили модель, рост): пересесть плавно
    getAnchors();
    if (lastKey !== seatKeyRef || Math.abs(eyeOf(seat).y - eye.y) > 1e-4) {
      seatKeyRef = lastKey;
      const a = byId(seat.id);
      if (!a) { stand(); return true; }
      const keepRel = tRel, keepPitch = tPitch;
      seat = a; eye = eyeOf(a); base = a.face + Math.PI;
      rel = tRel = keepRel; pitch = tPitch = keepPitch;
      if (a.look) aimAt(a, eye);
      mode = 'sitting';
      startAnim(eye.clone(), quatOf(base + rel, pitch), fov, SEAT.transition / 2, () => { mode = 'seated'; });
      return true;
    }
    const lk = 1 - Math.exp(-24 * dt);
    rel += (tRel - rel) * lk; pitch += (tPitch - pitch) * lk; fov += (tFov - fov) * lk;
    if (Math.abs(tRel - rel) < 1e-4) rel = tRel;
    if (Math.abs(tPitch - pitch) < 1e-4) pitch = tPitch;
    if (Math.abs(tFov - fov) < 1e-3) fov = tFov;
    const key = `${rel.toFixed(5)}|${pitch.toFixed(5)}|${fov.toFixed(3)}`;
    if (key === applied) return false;
    applied = key;
    apply();
    return true;
  }

  // ---------- прицел в прогулке ----------

  const dirTmp = V(), posTmp = V();
  function aim() {
    const list = getAnchors().filter(a => a.root && available(a.id));
    let next = null;
    if (list.length) {
      camera.getWorldPosition(posTmp); camera.getWorldDirection(dirTmp);
      ray.set(posTmp, dirTmp); ray.far = SEAT.reach * 2;
      let best = Infinity;
      for (const a of list) {
        const h = ray.intersectObjects(a.hitRoots || [a.root], true).find(x => x.object.visible && !x.object.userData.glass && !x.object.userData.shadowOnly);
        const score = h ? h.distance + Math.hypot(h.point.x - a.hip.x, h.point.z - a.hip.z) * 0.08 : Infinity;
        if (!h || score >= best || Math.hypot(h.point.x - posTmp.x, h.point.z - posTmp.z) > SEAT.reach) continue;
        if (blocked(posTmp, h.point)) continue;
        best = score; next = a;
      }
    }
    if (next !== target) { target = next; renderAim(); }
  }
  // стена или закрытое полотно двери между глазом и сиденьем (по плану: стены прогулки и полотна из doors.js)
  function blocked(p, q) {
    for (const b of [...walls, ...(getDoors?.()?.colliders?.() ?? [])]) {
      if (b.ax !== undefined ? segHit(p, q, b) : boxHit(p, q, b.isBox3 ? { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z } : b)) return true;
    }
    return false;
  }
  function boxHit(p, q, b) {
    let t0 = 0, t1 = 1;
    for (const [o, d, lo, hi] of [[p.x, q.x - p.x, b.x0, b.x1], [p.z, q.z - p.z, b.z0, b.z1]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) return false;
    }
    return true;
  }
  function segHit(p, q, s) {
    const rx = q.x - p.x, rz = q.z - p.z, sx = s.bx - s.ax, sz = s.bz - s.az, den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) return false;
    const t = ((s.ax - p.x) * sz - (s.az - p.z) * sx) / den, u = ((s.ax - p.x) * rz - (s.az - p.z) * rx) / den;
    return t > 0 && t < 1 && u >= 0 && u <= 1;
  }

  // ---------- подсказки и кнопки ----------

  injectStyle('ks-style', SEATS_CSS);
  const el = (tag, cls, text) => { const d = document.createElement(tag); d.className = cls; if (text) d.textContent = text; document.body.appendChild(d); d.hidden = true; return d; };
  const aimHint = el('div', 'kd-hint kw-float'); aimHint.setAttribute('role', 'status');
  const aimBtn = el('button', 'kd-btn kw-float', 'Сесть'); aimBtn.type = 'button';
  let touchSeen = false;

  // дверь под прицелом важнее: тогда своё не показываем (у двери своя подсказка на том же месте)
  const aimed = () => (target && !getDoors?.()?.target ? target : null);
  function renderAim() {
    const t = walk?.walking ? aimed() : null, touch = touchSeen || coarse();
    aimBtn.disabled = pendingSeat;
    aimHint.hidden = !t || touch;
    if (t) aimHint.innerHTML = `<kbd>E</kbd> — ${t.label.toLowerCase()}`;
    aimBtn.hidden = !t || !touch;
    if (t) aimBtn.textContent = t.label;
    document.body.classList.toggle('ks-aim', !!t);
  }
  // сидим: ui.js по этому классу показывает полосу «сидя» с кнопкой «Встать» (seats.stand())
  function syncUI() { document.body.classList.toggle('ks-seated', mode !== 'off'); }   // ui.js следит за классом: снимается, когда встали совсем

  // ---------- ввод ----------

  const onKey = e => {
    if (e.repeat || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (mode === 'sitting' || mode === 'seated') {
      // дальше клавиша не идёт: иначе та же F или Esc сразу включит или выключит прогулку, в которую встаём
      const toWalk = e.code === 'KeyF';
      if (!toWalk && e.code !== 'KeyE' && e.code !== 'Escape' && e.code !== 'Space') return;
      e.stopImmediatePropagation(); e.preventDefault();
      stand({ toWalk });
      return;
    }
    if (e.code === 'KeyE' && walk?.walking && aimed()) { e.preventDefault(); sitOn(target.id); }
  };
  addEventListener('keydown', onKey, true);   // в фазе захвата: F сидя не должна доходить до прогулки

  // клик в прогулке сажает (при захвате мыши — сразу, без захвата — короткий клик без перетаскивания)
  let down = null, look = null;
  const lookRelease = () => { if (look) { try { canvas.releasePointerCapture(look.id); } catch { /* уже отпущен */ } } look = null; };
  const onDown = e => {
    if (e.pointerType === 'touch') touchSeen = true;
    if (mode === 'seated' || mode === 'sitting') {
      if (look || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
      look = { id: e.pointerId, x: e.clientX, y: e.clientY, k: e.pointerType === 'touch' ? 0.0065 : 0.0042 };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
      return;
    }
    if (!walk?.walking || e.button !== 0 || e.pointerType === 'touch') return;
    if (document.pointerLockElement === canvas) { if (aimed()) sitOn(target.id); return; }
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onMove = e => {
    if (!look || e.pointerId !== look.id) return;
    const k = look.k * (fov / WALK.fovV);
    tRel = clamp(tRel - (e.clientX - look.x) * k, -YAW, YAW);
    tPitch = clamp(tPitch - (e.clientY - look.y) * k, PMIN, PMAX);
    look.x = e.clientX; look.y = e.clientY;
    requestRender?.();
  };
  const onUp = e => {
    if (look && e.pointerId === look.id) { lookRelease(); return; }
    if (!down || e.pointerId !== down.id) return;
    const d = down; down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && performance.now() - d.t < 500 && aimed()) sitOn(target.id);
  };
  const onCancel = e => { if (look && e.pointerId === look.id) lookRelease(); down = null; };
  // колесо и щипок на трекпаде — угол обзора в пределах прогулки
  const onWheel = e => {
    if (mode !== 'seated' && mode !== 'sitting') return;
    e.preventDefault();
    const d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    tFov = clamp(tFov + d * (e.ctrlKey ? 0.08 : 0.03), WALK.fovMin, WALK.fovMax);
    requestRender?.();
  };
  const onAimBtn = e => { e.preventDefault(); if (aimed()) sitOn(target.id); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  aimBtn.addEventListener('click', onAimBtn);

  function dispose() {
    if (mode !== 'off') abandon(false);
    removeEventListener('keydown', onKey, true);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('wheel', onWheel);
    document.body.classList.remove('ks-aim', 'ks-seated');
    for (const d of [aimHint, aimBtn]) d.remove();
  }

  function setNetwork(adapter) {
    network = adapter || null; seatOwners = {}; pendingSeat = false; networkGeneration++;
    if (!network && mode !== 'off') stand({ toWalk: true, authoritative: true });
    aimDirty = true; renderAim();
  }
  function applyNetwork(owners, player, { instant = false } = {}) {
    seatOwners = owners && typeof owners === 'object' && !Array.isArray(owners) ? { ...owners } : {};
    const desired = player?.seat ?? null;
    if (desired && seat?.id !== desired) sitOn(desired, { authoritative: true, instant });
    else if (!desired && mode !== 'off') stand({ toWalk: true, authoritative: true, pose: player });
    aimDirty = true; renderAim();
  }
  function networkSeats() {
    return getAnchors().map(a => {
      const stand = a.stand || a.hip.clone().addScaledVector(fwdOf(a.face), SEAT.standOut);
      return { id: a.id, position: a.hip.toArray(), yaw: a.face + Math.PI, eyeY: eyeOf(a).y, stand: [stand.x, stand.z], posture: a.posture || 'sit' };
    });
  }

  return {
    get active() { return mode !== 'off'; },
    get target() { const t = walk?.walking ? aimed() : null; return t ? { id: t.id, label: t.label } : null; },
    get current() { return mode === 'off' ? null : seat?.id ?? null; },
    // Walking has its own sequenced movement stream. A seated view is a look
    // intent only; the authority retains the seat position and body facing.
    getNetworkPose() { return mode === 'seated' ? { yaw: base + rel, pitch } : null; },
    update, sitOn, stand, dispose, setNetwork, applyNetwork, networkSeats,
    list: () => getAnchors().map(({ id, label }) => ({ id, label })),
  };
}

// Раздел панели: по кнопке на каждое место (сколько мест — столько кнопок, не больше SEAT.uiMax).
// Кнопка ui.js с run(): нажатие сразу сажает на это место.
export function registerSeatsUI(addSection, getSeats) {
  const list = () => getSeats()?.list() ?? [];
  const at = i => list()[i];
  addSection({
    id: 'seats', tab: 'live', title: 'Сесть', order: 20,
    visible: () => list().length > 0,
    summary: () => { const n = list().length; return n ? `${n} ${n === 1 ? 'место' : n < 5 ? 'места' : 'мест'}` : ''; },
    controls: [
      ...Array.from({ length: SEAT.uiMax }, (_, i) => ({
        type: 'button', key: `seat${i}`, primary: i === 0,
        visible: () => !!at(i), label: () => at(i)?.label ?? '',
        run: () => { const s = at(i); if (s) getSeats()?.sitOn(s.id); },
      })),
      { type: 'help', topic: 'seat' },
    ],
  });
}

// Токены --kw-* задаёт .kw-float (minimap.js); подсказка и кнопка под прицелом — классы doors.js (.kd-hint, .kd-btn);
// «Встать» и клавиши сидя — полоса режима ui.js. Здесь только подсветка прицела.
const SEATS_CSS = `
.ks-aim .kw-cross { width: 10px; height: 10px; margin: -5px 0 0 -5px; background: var(--kw-accent); box-shadow: 0 0 0 1.5px var(--kw-sheet); opacity: 1; }
`;
