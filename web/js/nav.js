// Свободная камера вне прогулки — как в Figma / SketchUp / Blender.
//
//   createNav({ THREE, camera, controls, canvas, scene, plan, requestRender, isWalking, raycastTargets })
//     -> { update(dt?) → bool (камера сдвинулась), setEnabled(b), stop(), focusOn(point), dispose() }
//
// Управление:
//   мышь:     колесо — к точке под курсором (и сквозь стены дальше), ЛКМ — вращать вокруг точки под курсором,
//             ПКМ / Shift+ЛКМ / средняя — сдвиг (точка под курсором едет за курсором), двойной клик — фокус.
//   трекпад:  щипок — к курсору, два пальца — сдвиг (как в Figma), ⌥ + два пальца — вращение.
//   тач:      один палец — вращение, два — щипок и сдвиг.
//   клавиши:  WASD / стрелки — лететь в горизонтальной плоскости взгляда, Q/E — вниз/вверх, Shift — быстрее.
//
// Ввод OrbitControls выключен, сам он остаётся «держателем» controls.target: controls.update() в main.js
// делает lookAt(target), а вырез стен прячет всё между камерой и target. Поэтому target всегда держим
// перед камерой на оси взгляда, чуть ближе первой видимой поверхности (retarget), а не где придётся.
// Своё движение сглажено; если камеру двинул кто-то другой (ракурс, мини-карта, выход из прогулки),
// недоделанное своё движение бросается.

export const NAV_HINT = 'Колесо — к курсору · ЛКМ — вращать · ПКМ/Shift — сдвиг · WASD, Q/E — летать · двойной клик — фокус';

export const NAV = {
  maxRadius: 40,        // дальше этого от центра квартиры камера не улетает, м
  minEye: 0.10,         // над полом квартиры не ниже, м
  slab: 0.6,            // толщина «перекрытия»: снизу сквозь пол внутрь квартиры тоже не пройти, м
  targetMin: 0.3,       // target не ближе к камере, м
  targetMax: 40,
  targetGap: 0.12,      // target ставится на столько ближе первой видимой поверхности по оси взгляда, м
  notch: 0.18,          // шаг колеса мыши: доля расстояния до точки под курсором
  pinch: 0.015,         // щипок трекпада: на единицу deltaY
  minStep: 1.25,        // минимальный шаг на единицу «силы» зума, м (0.18 → 22 см): упёршись, проходишь насквозь
  rotate: 0.8,          // полный оборот за 1/0.8 высоты холста
  pitchLimit: 88,       // наклон взгляда, градусы: перевернуться нельзя
  dragPx: 3,            // до этого сдвига указателя — ещё клик (main.js по клику открывает раздел панели)
  tauOrbit: 0.035,      // сглаживание, с
  tauPan: 0.04,
  tauDolly: 0.09,
  speedK: 0.6,          // скорость клавиш = расстояние до target × speedK, м/с
  speedMin: 0.8,
  speedMax: 14,
  speedIndoor: 1.8,     // м/с в комнатах: быстрый шаг
  shiftK: 3,
  accel: 7,             // разгон / торможение клавиш, 1/с
  decel: 10,
  focusFar: 3,          // двойной клик: издалека подлетаем вдвое ближе, но не ближе этого, м
  focusMin: 0.6,
  focusDur: 0.6,        // с
  gestureGap: 220,      // мс тишины — новый жест колеса/трекпада
};

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const typing = el => el?.matches?.('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=""], [contenteditable="true"]');

export function createNav({ THREE, camera, controls, canvas, scene, plan, requestRender = () => {}, isWalking = () => false, raycastTargets = null }) {
  const V3 = THREE.Vector3;
  const Y = new V3(0, 1, 0);

  // ---------- OrbitControls: только держатель target ----------
  const savedControls = {};
  const OWN = { enableRotate: false, enablePan: false, enableZoom: false, zoomToCursor: false, screenSpacePanning: true,
    minDistance: 0, maxDistance: Infinity, minPolarAngle: 0, maxPolarAngle: Math.PI };
  for (const k of Object.keys(OWN)) { savedControls[k] = controls[k]; controls[k] = OWN[k]; }

  // ---------- геометрия квартиры ----------
  const b = plan?.bounds || { x0: -3, x1: 7, z0: -1, z1: 8 };
  const center = new V3((b.x0 + b.x1) / 2, 1.3, (b.z0 + b.z1) / 2);
  const feet = [b, plan?.balcony].filter(Boolean);
  const inFootprint = (x, z) => feet.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);

  // ---------- состояние ----------
  let enabled = true;
  let lastT = 0;
  const lastPos = camera.position.clone(), lastTarget = controls.target.clone();
  let pendingYaw = 0, pendingPitch = 0;
  const orbitPivot = new V3();
  const pendingPan = new V3(), pendingDolly = new V3();
  const vel = new V3();
  const keys = new Set();
  let shift = false;
  let focus = null;          // { t, from, fromT, to, toT }
  let drag = null;           // мышь / перо: { id, mode, x, y, sx, sy, started, pivot, depth }
  const touches = new Map(); // тач: id -> { x, y }
  let touch = null;          // { n, x, y, len, sx, sy, started, pivot, depth }
  let gesture = { t: -1e9, kind: 'mouse', pivot: null, depth: 1 };
  let safariScale = 1, safariAt = -1e9;

  // временные
  const tmp = new V3(), tmp2 = new V3(), fwd = new V3(), right = new V3(), up = new V3();
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const rc = new THREE.Raycaster(); rc.layers.set(0);   // слой 0: вырезанные стены (слой 1) не мешают, как и на экране
  const ndc = new THREE.Vector2();
  const floor = new THREE.Plane(new V3(0, 1, 0), 0);

  const active = () => enabled && controls.enabled !== false && !isWalking();

  // ---------- луч ----------
  function pickable(o) {
    if (!o.isMesh) return false;
    const u = o.userData;
    if (u.glass || u.shadowOnly || u.noPick) return false;
    const m = o.material;
    if (m && !Array.isArray(m) && (m.visible === false || (m.transparent && m.opacity < 0.2))) return false;
    for (let p = o; p; p = p.parent) {
      if (!p.visible || p.isTransformControlsGizmo || p.isTransformControlsPlane) return false;
    }
    return true;
  }
  function firstHit() {
    const hits = rc.intersectObjects(raycastTargets ? raycastTargets() : scene.children, true);
    for (const h of hits) if (pickable(h.object)) return h;
    return null;
  }
  function rayAt(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / (r.width || 1)) * 2 - 1, -((cy - r.top) / (r.height || 1)) * 2 + 1);
    camera.updateMatrixWorld();
    rc.setFromCamera(ndc, camera);
    return rc.ray;
  }
  // Точка под курсором: поверхность -> пол квартиры (y = 0) -> глубина текущего target.
  function pivotAt(cx, cy) {
    const ray = rayAt(cx, cy);
    const h = firstHit();
    if (h) return { p: h.point.clone(), dist: h.distance, hit: true };
    const td = camera.position.distanceTo(controls.target);
    // пол — только недалеко: вращение вокруг точки у горизонта швыряет камеру на десятки метров
    if (ray.intersectPlane(floor, tmp) && tmp.distanceTo(ray.origin) < Math.min(NAV.maxRadius / 2, Math.max(8, td * 2))) {
      return { p: tmp.clone(), dist: tmp.distanceTo(ray.origin), hit: false };
    }
    const d = clamp(td, 1, NAV.targetMax);
    return { p: ray.at(d, new V3()), dist: d, hit: false };
  }
  const forward = v => camera.getWorldDirection(v);
  const depthOf = p => clamp(tmp2.copy(p).sub(camera.position).dot(forward(fwd)), NAV.targetMin, NAV.targetMax);

  // target — на оси взгляда, чуть ближе первой видимой поверхности (так вырез стен ведёт себя предсказуемо)
  function retarget() {
    forward(fwd);
    camera.updateMatrixWorld();
    rc.set(camera.position, fwd);
    rc.camera = camera;
    const h = firstHit();
    // ничего впереди — target в паре метров: вырезать нечего, а скорость клавиш не падает до минимума
    const d = h ? h.distance - NAV.targetGap : Math.max(2, camera.position.distanceTo(controls.target));
    controls.target.copy(camera.position).addScaledVector(fwd, clamp(d, NAV.targetMin, NAV.targetMax));
  }

  // ---------- движение ----------
  function shiftBy(v) { camera.position.add(v); controls.target.add(v); }

  function constrain() {
    // не дальше maxRadius от квартиры
    tmp.copy(camera.position).sub(center);
    if (tmp.length() > NAV.maxRadius) {
      tmp.setLength(NAV.maxRadius).add(center).sub(camera.position);
      shiftBy(tmp);
    }
    // пол квартиры — перекрытие: сверху не ниже minEye, снизу не выше −slab
    const p = camera.position;
    if (p.y < NAV.minEye && p.y > -NAV.slab && inFootprint(p.x, p.z)) {
      const ny = p.y > (NAV.minEye - NAV.slab) / 2 ? NAV.minEye : -NAV.slab;
      shiftBy(tmp.set(0, ny - p.y, 0));
    }
    // target не в камере
    if (controls.target.distanceToSquared(camera.position) < NAV.targetMin * NAV.targetMin) {
      controls.target.copy(camera.position).addScaledVector(forward(fwd), NAV.targetMin);
    }
  }

  // поворот камеры и target вокруг точки: рыскание вокруг вертикали, наклон вокруг горизонтальной оси экрана
  function orbitAround(P, yaw, pitch) {
    forward(fwd);
    const cur = Math.asin(clamp(fwd.y, -1, 1));
    const lim = Math.max(THREE.MathUtils.degToRad(NAV.pitchLimit), Math.abs(cur));
    const dp = clamp(cur + pitch, -lim, lim) - cur;
    q1.setFromAxisAngle(Y, yaw);
    right.crossVectors(fwd, Y);
    if (right.lengthSq() < 1e-10) right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0);
    right.normalize().applyQuaternion(q1);
    q2.setFromAxisAngle(right, dp).multiply(q1);
    camera.position.sub(P).applyQuaternion(q2).add(P);
    controls.target.sub(P).applyQuaternion(q2).add(P);
    camera.lookAt(controls.target);
  }

  // сдвиг на пиксели экрана: точка на глубине depth едет ровно за курсором
  function panPixels(dx, dy, depth) {
    const h = canvas.clientHeight || 1;
    const wpp = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / h;
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    pendingPan.addScaledVector(right, -dx * wpp).addScaledVector(up, dy * wpp);
  }

  // к точке под курсором (fr > 0) или от неё (fr < 0); камера и target едут вместе вдоль луча курсора,
  // поэтому точка остаётся под курсором; шаг ∝ расстоянию, но не меньше minStep·|fr| — так проходишь насквозь
  function dolly(fr, cx, cy) {
    if (!fr) return;
    const pv = pivotAt(cx, cy);
    const dir = rc.ray.direction.clone();
    const D = Math.max(0, pv.dist - pendingDolly.dot(dir));
    const min = NAV.minStep * Math.abs(fr);
    const step = fr > 0 ? Math.max(D * (1 - Math.exp(-fr)), min) : -Math.max(D * (Math.exp(-fr) - 1), min);
    pendingDolly.addScaledVector(dir, step);
    requestRender();
  }

  function flushOrbit() {
    if (pendingYaw || pendingPitch) orbitAround(orbitPivot, pendingYaw, pendingPitch);
    pendingYaw = pendingPitch = 0;
  }
  function clearPending() {
    pendingYaw = pendingPitch = 0;
    pendingPan.set(0, 0, 0); pendingDolly.set(0, 0, 0);
    focus = null;
  }

  function focusOn(P) {
    clearPending();
    vel.set(0, 0, 0);
    const d = camera.position.distanceTo(P);
    const nd = d > NAV.focusFar ? Math.max(NAV.focusFar, d * 0.5) : Math.max(d, NAV.focusMin);
    const dir = tmp.copy(P).sub(camera.position).normalize();
    focus = { t: 0, from: camera.position.clone(), fromT: controls.target.clone(),
      to: P.clone().addScaledVector(dir, -nd), toT: P.clone() };
    requestRender();
  }

  // ---------- кадр ----------
  function syncLast() { lastPos.copy(camera.position); lastTarget.copy(controls.target); }

  function update(dt) {
    const now = performance.now();
    if (dt == null) dt = lastT ? (now - lastT) / 1000 : 1 / 60;
    lastT = now;
    dt = clamp(dt, 0, 0.1);

    if (!active()) {
      clearPending(); vel.set(0, 0, 0);
      if (isWalking()) keys.clear();
      syncLast();
      return false;
    }
    // камеру двинул кто-то другой — своё недоделанное бросаем
    if (camera.position.distanceToSquared(lastPos) > 1e-8 || controls.target.distanceToSquared(lastTarget) > 1e-8) {
      clearPending(); vel.set(0, 0, 0);
    }

    let moved = false, translated = false;

    if (focus) {
      focus.t = Math.min(1, focus.t + dt / NAV.focusDur);
      const k = focus.t, e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(focus.from, focus.to, e);
      controls.target.lerpVectors(focus.fromT, focus.toT, e);
      if (k >= 1) focus = null;
      moved = true;
    }

    if (pendingYaw || pendingPitch) {
      const f = 1 - Math.exp(-dt / NAV.tauOrbit);
      let y = pendingYaw * f, p = pendingPitch * f;
      if (Math.abs(pendingYaw - y) < 1e-4 && Math.abs(pendingPitch - p) < 1e-4) { y = pendingYaw; p = pendingPitch; }
      orbitAround(orbitPivot, y, p);
      pendingYaw -= y; pendingPitch -= p;
      moved = true;
    }

    for (const [pend, tau] of [[pendingPan, NAV.tauPan], [pendingDolly, NAV.tauDolly]]) {
      if (pend.lengthSq() === 0) continue;
      const f = 1 - Math.exp(-dt / tau);
      tmp.copy(pend).multiplyScalar(f);
      if (pend.lengthSq() - tmp.lengthSq() < 1e-8) tmp.copy(pend);
      shiftBy(tmp);
      pend.sub(tmp);
      if (pend.lengthSq() < 1e-12) pend.set(0, 0, 0);
      moved = translated = true;
    }

    // клавиши: разгон и торможение, скорость ∝ расстоянию до target
    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const u = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    tmp.set(0, 0, 0);
    if (f || s || u) {
      forward(fwd).setY(0);
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0);   // взгляд строго вниз
      fwd.normalize();
      right.crossVectors(fwd, Y).normalize();
      tmp.addScaledVector(fwd, f).addScaledVector(right, s).addScaledVector(Y, u).normalize();
      const dist = camera.position.distanceTo(controls.target);
      // внутри квартиры (в плане и ниже потолка) не быстрее шага, снаружи — пропорционально расстоянию
      const p = camera.position, inside = p.y < 2.7 && p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1;
      const v = clamp(dist * NAV.speedK, NAV.speedMin, inside ? NAV.speedIndoor : NAV.speedMax);
      tmp.multiplyScalar(v * (shift ? NAV.shiftK : 1));
    }
    if (f || s || u || vel.lengthSq() > 0) {
      const k = 1 - Math.exp(-dt * (f || s || u ? NAV.accel : NAV.decel));
      vel.lerp(tmp, k);
      if (!(f || s || u) && vel.lengthSq() < 1e-4) vel.set(0, 0, 0);
      if (vel.lengthSq() > 0) { shiftBy(tmp.copy(vel).multiplyScalar(dt)); moved = translated = true; }
    }

    if (moved) {
      constrain();
      camera.lookAt(controls.target);
      if (translated && !focus) retarget();
      requestRender();
    }
    syncLast();
    return moved;
  }

  // ---------- мышь, перо, тач ----------
  function onPointerDown(e) {
    if (!active()) return;
    focus = null;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
      touchBase();
      return;
    }
    if (drag) return;
    let mode = null;
    if (e.button === 0) mode = e.shiftKey ? 'pan' : 'orbit';
    else if (e.button === 1 || e.button === 2) mode = 'pan';
    if (!mode) return;
    if (e.button === 1) e.preventDefault();   // без автопрокрутки браузера
    flushOrbit();
    const pv = pivotAt(e.clientX, e.clientY);
    drag = { id: e.pointerId, mode, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, started: false,
      pivot: pv.p, depth: depthOf(pv.p) };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
  }

  function onPointerMove(e) {
    if (touches.has(e.pointerId)) { touchMove(e); return; }
    if (!drag || e.pointerId !== drag.id) return;
    if (!active()) { endDrag(); return; }   // например, начали тянуть гизмо мебели: оно выключает controls
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < NAV.dragPx) return;
      drag.started = true;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.mode === 'orbit') {
      const k = (2 * Math.PI / (canvas.clientHeight || 1)) * NAV.rotate;
      orbitPivot.copy(drag.pivot);
      pendingYaw -= dx * k; pendingPitch -= dy * k;
    } else {
      panPixels(dx, dy, drag.depth);
    }
    requestRender();
  }

  function endDrag() {
    if (!drag) return;
    try { canvas.releasePointerCapture(drag.id); } catch { /* уже отпущен */ }
    drag = null;
  }
  function onPointerUp(e) {
    if (touches.has(e.pointerId)) {
      touches.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* уже отпущен */ }
      touchBase();
      return;
    }
    if (drag && e.pointerId === drag.id) endDrag();
  }

  // тач: один палец — вращение вокруг точки, два — щипок к середине и сдвиг
  function touchBase() {
    const pts = [...touches.values()];
    if (!pts.length) { touch = null; return; }
    flushOrbit();
    const [a, c = a] = pts;
    const x = (a.x + c.x) / 2, y = (a.y + c.y) / 2;
    const pv = pivotAt(x, y);
    touch = { n: Math.min(2, pts.length), x, y, sx: x, sy: y, len: Math.hypot(a.x - c.x, a.y - c.y) || 1,
      started: touch?.started && pts.length > 1, pivot: pv.p, depth: depthOf(pv.p) };
  }
  function touchMove(e) {
    touches.get(e.pointerId).x = e.clientX;
    touches.get(e.pointerId).y = e.clientY;
    if (!touch || !active()) return;
    const [a, c = a] = touches.values();
    const x = (a.x + c.x) / 2, y = (a.y + c.y) / 2;
    if (!touch.started) {
      if (touch.n === 1 && Math.hypot(x - touch.sx, y - touch.sy) < NAV.dragPx * 2) return;
      touch.started = true;
    }
    const dx = x - touch.x, dy = y - touch.y;
    touch.x = x; touch.y = y;
    if (touch.n === 1) {
      const k = (2 * Math.PI / (canvas.clientHeight || 1)) * NAV.rotate * 1.15;
      orbitPivot.copy(touch.pivot);
      pendingYaw -= dx * k; pendingPitch -= dy * k;
    } else {
      const len = Math.hypot(a.x - c.x, a.y - c.y) || 1;
      panPixels(dx, dy, touch.depth);
      dolly(clamp(Math.log(len / touch.len), -0.4, 0.4), x, y);
      touch.len = len;
    }
    requestRender();
  }

  // ---------- колесо и трекпад ----------
  // Мышь: колесо = к курсору (как SketchUp/Blender). Трекпад Mac: щипок = к курсору, два пальца = сдвиг
  // (как Figma), ⌥ + два пальца = вращение. Кто есть кто — решаем в начале жеста и держим до паузы.
  function looksLikeTrackpad(e) {
    if (e.deltaMode !== 0) return false;                 // строки/страницы — колесо мыши (Firefox)
    if (e.deltaX !== 0 && !e.shiftKey) return true;      // мышь без Shift по горизонтали не крутит
    const d = e.deltaY;
    if (d !== 0 && d % 4.000244140625 === 0) return false;   // щелчок колеса в Chrome/Safari на Mac (как в Mapbox GL)
    if (Math.abs(d) < 4) return true;
    const w = e.wheelDeltaY;                             // Chrome/Safari: у трекпада wheelDeltaY = −3·deltaY
    if (typeof w === 'number' && w !== 0) return Math.abs(w + 3 * d) < 1.5 && Math.abs(w) % 120 !== 0;
    return !Number.isInteger(d) || Math.abs(d) < 16;
  }
  function onWheel(e) {
    if (!active()) return;
    e.preventDefault();
    focus = null;
    const now = performance.now();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    const fresh = now - gesture.t > NAV.gestureGap;
    if (e.ctrlKey) {
      // щипок трекпада (Chrome, Firefox) или Ctrl+колесо; в Safari щипок приходит жестами ниже
      if (now - safariAt < 300) { gesture.t = now; return; }
      dolly(clamp(-dy * NAV.pinch, -0.4, 0.4), e.clientX, e.clientY);
      gesture = { t: now, kind: 'pinch', pivot: null, depth: 1 };
      return;
    }
    if (fresh || gesture.kind === 'pinch') {
      gesture = { t: now, kind: looksLikeTrackpad(e) ? 'pad' : 'mouse', pivot: null, depth: 1 };
    } else if (gesture.kind === 'mouse' && e.deltaX !== 0 && !e.shiftKey) gesture.kind = 'pad';
    gesture.t = now;

    if (gesture.kind === 'mouse') {
      // щелчок колеса: ~100 px (Chrome, Windows), 100.006 = 25 × 4.000244 (Chrome на Mac), 4.000244 (Safari на Mac)
      const d = dy || dx, a = Math.abs(d);
      const n = a < 50 && d % 4.000244140625 === 0 ? 1 : clamp(a / 100, 0.5, 2.5);
      if (d) dolly(-Math.sign(d) * NAV.notch * n, e.clientX, e.clientY);
      return;
    }
    if (!gesture.pivot) {
      flushOrbit();
      gesture.pivot = pivotAt(e.clientX, e.clientY).p;
      gesture.depth = depthOf(gesture.pivot);
    }
    if (e.altKey) {
      const k = (2 * Math.PI / (canvas.clientHeight || 1)) * NAV.rotate;
      orbitPivot.copy(gesture.pivot);
      pendingYaw += dx * k; pendingPitch += dy * k;
    } else {
      panPixels(-dx, -dy, gesture.depth);
    }
    requestRender();
  }

  // Safari (macOS): щипок трекпада — это gesture*-события, а не Ctrl+колесо
  function onGestureStart(e) {
    if (!active() || touches.size) return;
    e.preventDefault();
    safariScale = e.scale || 1; safariAt = performance.now();
  }
  function onGestureChange(e) {
    if (!active() || touches.size) return;
    e.preventDefault();
    const s = e.scale || 1;
    dolly(clamp(Math.log(s / safariScale), -0.4, 0.4), e.clientX, e.clientY);
    safariScale = s; safariAt = performance.now();
  }
  function onGestureEnd(e) { if (active() && !touches.size) e.preventDefault(); }

  // ---------- двойной клик: фокус на точку ----------
  function onDblClick(e) {
    if (!active()) return;
    rayAt(e.clientX, e.clientY);
    const h = firstHit();
    if (!h) return;
    e.preventDefault();
    focusOn(h.point);
  }

  function onContextMenu(e) { if (active()) e.preventDefault(); }
  function onMouseDown(e) { if (e.button === 1 && active()) e.preventDefault(); }   // средняя кнопка: без автопрокрутки

  // ---------- клавиатура ----------
  function onKeyDown(e) {
    shift = e.shiftKey;
    if (e.metaKey) { keys.clear(); return; }   // при зажатом ⌘ macOS не присылает keyup: клавиши бы залипли
    if (!active() || e.ctrlKey || e.altKey || e.defaultPrevented || !MOVE_KEYS.has(e.code)) return;
    if (typing(e.target)) return;
    if (ARROWS.has(e.code)) {
      // стрелки на кнопках и вкладках панели — навигация панели, не камера
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== canvas && ae !== document.documentElement) return;
      e.preventDefault();
    }
    keys.add(e.code);
    focus = null;
    requestRender();
  }
  function onKeyUp(e) {
    shift = e.shiftKey;
    if (e.key === 'Meta') keys.clear();
    keys.delete(e.code);
  }
  function onBlur() { keys.clear(); shift = false; endDrag(); }
  function onVisibility() { if (document.hidden) onBlur(); }

  const listeners = [
    [canvas, 'pointerdown', onPointerDown], [canvas, 'pointermove', onPointerMove],
    [canvas, 'pointerup', onPointerUp], [canvas, 'pointercancel', onPointerUp],
    [canvas, 'wheel', onWheel, { passive: false }],
    [canvas, 'gesturestart', onGestureStart], [canvas, 'gesturechange', onGestureChange], [canvas, 'gestureend', onGestureEnd],
    [canvas, 'dblclick', onDblClick], [canvas, 'contextmenu', onContextMenu], [canvas, 'mousedown', onMouseDown],
    [window, 'keydown', onKeyDown], [window, 'keyup', onKeyUp], [window, 'blur', onBlur],
    [document, 'visibilitychange', onVisibility],
  ];
  for (const [t, n, fn, o] of listeners) t.addEventListener(n, fn, o);

  return {
    update,
    setEnabled(v) { enabled = !!v; if (!enabled) { clearPending(); vel.set(0, 0, 0); keys.clear(); endDrag(); touches.clear(); touch = null; } },
    stop() { clearPending(); vel.set(0, 0, 0); syncLast(); },
    focusOn(p) { focusOn(p.clone ? p.clone() : new V3(p.x, p.y, p.z)); },
    get busy() { return !!(focus || drag || touch || keys.size || pendingYaw || pendingPitch || pendingPan.lengthSq() || pendingDolly.lengthSq() || vel.lengthSq()); },
    dispose() {
      for (const [t, n, fn, o] of listeners) t.removeEventListener(n, fn, o);
      for (const k of Object.keys(savedControls)) controls[k] = savedControls[k];
      keys.clear(); endDrag();
    },
  };
}
