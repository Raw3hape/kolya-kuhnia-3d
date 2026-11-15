// Сесть от первого лица: на унитаз, на диван (смотреть ТВ), на стулья, скамьи и кресла из обстановки.
// Места берутся из данных, ничего не вписано руками: диван — furn.items.sofa (seatH и backH из spec/sofas.json,
// спинка находится лучом по самой модели), унитаз — wcSeat(spec/bath.json), обстановка — decor.seats.
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
// registerSeatsUI(addSection, getSeats) — раздел «Сесть» во вкладке 'view' сразу после «Прогулки»: кнопка на каждое место.
import { WALK, naturalFov, buildColliders } from './walk.js';
import { wcSeat } from './bath.js';
import { SOFA_CATALOG, FURN_SPEC } from './furniture.js';
import { injectStyle } from './minimap.js';

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
  getState, getFurniture, getDecor, getDoors, getTV }) {
  const wc = wcSeat(bathSpec);
  const walls = buildColliders(plan).boxes;   // стены по плану (проёмы открыты): прицел не сажает сквозь стену
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const ray = new THREE.Raycaster(); ray.layers.enableAll();

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
    return { id: 'sofa', label: 'Сесть на диван', root: obj, hip, face, look: tvPoint(furn) };
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
      // объект для прицела — ближайшая вещь обстановки к месту (по полу, не дальше метра)
      let root = null, best = 1;
      for (const h of holders) { const dd = Math.hypot(h.position.x - s.x, h.position.z - s.z); if (dd < best) { best = dd; root = h; } }
      return { id: String(s.id), label: s.label || 'Сесть', root, hip: V(s.x, s.y, s.z), face: s.yaw, look: null };
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
    anchors = [sofaSeat(getFurniture?.(), S), wcAnchor(), ...decorSeats(getDecor?.())].filter(Boolean);
    return anchors;
  }
  const byId = id => getAnchors().find(a => a.id === id) || null;

  // ---------- поза сидящего ----------

  const eyeAbove = () => SEAT.eyeAboveSeat * ((walk?.personHeight ?? WALK.height) / WALK.height);
  const eyeOf = a => V(a.hip.x, a.hip.y + eyeAbove(), a.hip.z);
  const fwdOf = face => V(Math.sin(face), 0, Math.cos(face));
  const YAW = SEAT.yaw * RAD, PMIN = SEAT.pitchMin * RAD, PMAX = SEAT.pitchMax * RAD;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const quatOf = (y, p) => new THREE.Quaternion().setFromEuler(euler.set(p, y, 0, 'YXZ'));

  // mode: off | sitting (переход) | seated | standing (переход); камера: yaw = base + rel (base — лицом по сиденью)
  let mode = 'off', seat = null, eye = null, base = 0, rel = 0, tRel = 0, pitch = 0, tPitch = 0, fov = 55, tFov = 55;
  let anim = null, origin = null, applied = '', target = null, seatKeyRef = null;

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

  function sitOn(id) {
    const a = byId(id);
    if (!a) return false;
    if (mode === 'off') {
      if (walk?.active) {
        const orbit = walk.orbitPose;       // облёт до прогулки: туда вернёт выход из неё после того, как встанем
        walk.exit({ restore: false });
        if (walk.active) return false;      // прогулка ещё доигрывает выход
        origin = { walk: true, orbit };
      } else {
        origin = { walk: false, pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
      }
      controls.enabled = false;
      fov = tFov = naturalFov(camera.aspect);
      showHint();
    }
    if (seat?.id === 'sofa' && a.id !== 'sofa') getTV?.()?.setAudio(false);
    seat = a; seatKeyRef = lastKey; eye = eyeOf(a);
    aimAt(a, eye);
    mode = 'sitting';
    startAnim(eye.clone(), quatOf(base + rel, pitch), fov, SEAT.transition, () => { mode = 'seated'; });
    if (a.id === 'sofa') getTV?.()?.setAudio(true);
    // фокус с кнопки панели: иначе Пробел («встать») снова нажмёт её
    if (document.activeElement?.closest?.('#panel')) document.activeElement.blur();
    target = null; renderAim(); syncUI();
    requestRender?.();
    return true;
  }

  function stand({ toWalk = false } = {}) {
    if (mode === 'off' || mode === 'standing') return;
    const a = seat;
    if (a?.id === 'sofa') getTV?.()?.setAudio(false);
    lookRelease();
    if (origin?.walk || toWalk) {
      // в прогулку: прогулка сама плавно переведёт камеру к свободному месту перед сиденьем
      const fw = fwdOf(a.face), p = a.hip.clone().addScaledVector(fw, SEAT.standOut);
      const orbit = origin.walk ? origin.orbit : origin;
      controls.target.copy(camera.position).addScaledVector(camera.getWorldDirection(V()), 2);
      finish(false);
      if (!walk?.enter({ x: p.x, z: p.z }, a.face + Math.PI, { orbit })) controls.enabled = true;
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
    if (seat?.id === 'sofa') getTV?.()?.setAudio(false);
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
    const list = getAnchors().filter(a => a.root);
    let next = null;
    if (list.length) {
      camera.getWorldPosition(posTmp); camera.getWorldDirection(dirTmp);
      ray.set(posTmp, dirTmp); ray.far = SEAT.reach * 2;
      let best = Infinity;
      for (const a of list) {
        const h = ray.intersectObject(a.root, true).find(x => x.object.visible && !x.object.userData.glass && !x.object.userData.shadowOnly);
        if (!h || h.distance >= best || Math.hypot(h.point.x - posTmp.x, h.point.z - posTmp.z) > SEAT.reach) continue;
        if (blocked(posTmp, h.point)) continue;
        best = h.distance; next = a;
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
  const standBtn = el('button', 'ks-stand kw-float', 'Встать'); standBtn.type = 'button';
  const seatHint = el('div', 'kw-hint kw-float ks-hint'); seatHint.setAttribute('role', 'status');
  let touchSeen = false, hintTimer = 0;

  // дверь под прицелом важнее: тогда своё не показываем (у двери своя подсказка на том же месте)
  const aimed = () => (target && !getDoors?.()?.target ? target : null);
  function renderAim() {
    const t = walk?.walking ? aimed() : null, touch = touchSeen || coarse();
    aimHint.hidden = !t || touch;
    if (t) aimHint.innerHTML = `<kbd>E</kbd> — ${t.label.toLowerCase()}`;
    aimBtn.hidden = !t || !touch;
    if (t) aimBtn.textContent = t.label;
    document.body.classList.toggle('ks-aim', !!t);
  }
  function showHint() {
    const touch = touchSeen || coarse();
    seatHint.innerHTML = touch
      ? 'Ведите пальцем — осмотреться. Встать — кнопкой внизу.'
      : 'Мышь — осмотреться, колесо — приблизить. <b>E</b>, <b>Esc</b> или <b>Пробел</b> — встать.';
    seatHint.hidden = false; seatHint.classList.remove('fade');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { seatHint.classList.add('fade'); hintTimer = setTimeout(() => { seatHint.hidden = true; }, 450); }, 5000);
  }
  function syncUI() {
    const on = mode === 'sitting' || mode === 'seated';
    standBtn.hidden = !on;
    if (!on) { clearTimeout(hintTimer); seatHint.hidden = true; }
  }

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
      if (look || (e.pointerType === 'mouse' && e.button !== 0)) return;
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
  const onStandBtn = e => { e.preventDefault(); stand(); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  aimBtn.addEventListener('click', onAimBtn);
  standBtn.addEventListener('click', onStandBtn);

  function dispose() {
    if (mode !== 'off') abandon(false);
    removeEventListener('keydown', onKey, true);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('wheel', onWheel);
    clearTimeout(hintTimer);
    document.body.classList.remove('ks-aim');
    for (const d of [aimHint, aimBtn, standBtn, seatHint]) d.remove();
  }

  return {
    get active() { return mode !== 'off'; },
    get target() { const t = walk?.walking ? aimed() : null; return t ? { id: t.id, label: t.label } : null; },
    get current() { return mode === 'off' ? null : seat?.id ?? null; },
    update, sitOn, stand, dispose,
    list: () => getAnchors().map(({ id, label }) => ({ id, label })),
  };
}

// Раздел панели: по кнопке на каждое место (сколько мест — столько кнопок, не больше SEAT.uiMax).
// Кнопка ui.js с run(): нажатие сразу сажает на это место.
export function registerSeatsUI(addSection, getSeats) {
  const list = () => getSeats()?.list() ?? [];
  const at = i => list()[i];
  addSection({
    id: 'seats', tab: 'view', title: 'Сесть', order: 20.5,
    visible: () => list().length > 0,
    summary: () => { const n = list().length; return n ? `${n} ${n === 1 ? 'место' : n < 5 ? 'места' : 'мест'}` : ''; },
    controls: [
      ...Array.from({ length: SEAT.uiMax }, (_, i) => ({
        type: 'button', key: `seat${i}`, primary: i === 0,
        visible: () => !!at(i), label: () => at(i)?.label ?? '',
        run: () => { const s = at(i); if (s) getSeats()?.sitOn(s.id); },
      })),
      { type: 'readout', key: 'seatKeys', style: 'hint',
        value: 'Работает из облёта и из прогулки (там — прицел на сиденье и E). Сидя: мышь или палец — осмотреться, колесо — приблизить, E, Esc или Пробел — встать. На диване включается звук ТВ.' },
    ],
  });
}

// Токены --kw-* задаёт .kw-float (minimap.js); подсказка и кнопка под прицелом — классы doors.js (.kd-hint, .kd-btn),
// подсказка «сидя» — .kw-hint из walk.js. Здесь только кнопка «Встать» и подсветка прицела.
const SEATS_CSS = `
.ks-aim .kw-cross { width: 10px; height: 10px; margin: -5px 0 0 -5px; background: var(--kw-accent); box-shadow: 0 0 0 1.5px var(--kw-sheet); opacity: 1; }
.ks-stand { position: fixed; z-index: 5; left: 50%; transform: translateX(-50%); top: calc(16px + env(safe-area-inset-top, 0px));
  min-height: 44px; min-width: 120px; padding: 0 18px; border: 1px solid var(--kw-accent); border-radius: 4px;
  background: var(--kw-accent); color: var(--kw-accent-ink); box-shadow: var(--kw-shadow); cursor: pointer; touch-action: manipulation;
  font: 500 14px/1 var(--f-body, "Inter", "Helvetica Neue", Arial, sans-serif); }
.ks-stand:focus-visible { outline: 2px solid var(--kw-accent); outline-offset: 2px; }
.ks-stand[hidden] { display: none; }
@media (max-width: 760px) { .ks-stand { left: auto; right: max(12px, env(safe-area-inset-right, 0px)); transform: none; top: calc(78px + env(safe-area-inset-top, 0px)); } }
`;
