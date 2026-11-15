// Двери, которые открываются и закрываются (как в играх): в прогулке навести прицел на полотно ближе 2 м
// и нажать E или кликнуть; на телефоне — кнопка «Открыть/Закрыть» под прицелом.
// Полотна строит model.js: пивот на оси петель с userData.door { id, closed, open, isOpen, dir, length, thick }.
// Межкомнатные по умолчанию открыты, балконные и входная закрыты. Состояние — настройка сеанса, в код варианта не входит.
//
// initDoors({ THREE, scene, camera, canvas, plan, M, doorsGroup, shell, walk, requestRender, onChange? })
//   onChange(id, open) — полотно встало в новое положение (например, пересчитать габариты выреза: cutaway.rebuild()).
//   -> { update(dt) -> bool  (true — полотно двигается, нужен кадр; в покое — false и почти ноль работы),
//        colliders() -> [{ x0, x1, z0, z1 } | { ax, az, bx, bz, h }]  глухие части рам и полотна (отрезок петля -> край),
//        target  — дверь под прицелом { id, open } или null: клик/E откроет её; оружие в этот момент не стреляет,
//        list    — все двери [{ id, open }], toggle(id), setOpen(id, open, { instant }) — для проверок из консоли,
//        onToggle(fn) -> снять()  fn(id, open) — дверь начала открываться или закрываться (life.js: за входной дверью монстры),
//        dispose() }
// Прогулке (walk.js) сообщает: refreshObstacles() пока полотно двигается, setAreaGate() — открыт ли путь на балкон
// и на площадку (телепорт с плана туда только через открытую дверь).
import { subtractRect, injectStyle } from './minimap.js';
import { WALK, areaBeyond } from './walk.js';
import { addHelp } from './help.js';

addHelp({ mode: 'walk', topic: 'walk', keys: ['E'], text: 'открыть или закрыть дверь под прицелом (или клик)', touch: 'кнопка под прицелом — открыть дверь', brief: true, order: 50 });

const DUR = 0.6;      // ход полотна, с
const REACH = 2.0;    // прицел достаёт до двери, м
const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const coarse = () => { try { return matchMedia('(hover: none), (pointer: coarse)').matches; } catch { return false; } };

export function initDoors({ THREE, camera, canvas, plan, doorsGroup, shell, walk, requestRender, onChange }) {
  // ---------- двери из сцены ----------
  const doors = [], byMesh = new Map(), blockers = [];
  let target = null, aimDirty = true;
  for (const root of [doorsGroup, shell?.group]) root?.traverse(o => {
    const d = o.userData.door;
    if (!d) return;
    const op = plan.openings.find(q => q.id === d.id);
    const door = { id: d.id, pivot: o, d, open: !!d.isOpen, v: d.isOpen ? 1 : 0, from: 0, to: 0, t: 1,
      area: op && op.type !== 'interior' ? areaBeyond(plan, op).area : null, seg: null };
    o.traverse(m => { if (m.isMesh) byMesh.set(m, door); });
    doors.push(door);
    // глухие части наружного проёма (рама, неоткрывающееся стекло) = проём минус проход створки
    const pass = o.parent?.userData.passage;
    if (op && pass) blockers.push(...subtractRect({ x0: op.x0, x1: op.x1, z0: op.z0, z1: op.z1 }, pass));
  });
  const meshes = [...byMesh.keys()];
  const occluders = [...meshes, ...(shell?.walls || [])];

  // ---------- поза и столкновения ----------
  const vA = new THREE.Vector3(), vX = new THREE.Vector3();
  function pose(door) {
    door.pivot.rotation.y = door.d.closed + (door.d.open - door.d.closed) * ease(door.v);
    door.pivot.updateWorldMatrix(true, false);
    door.seg = segOf(door);
  }
  // Полотно в плане: толстый отрезок от петли вдоль локальной ±X пивота
  function segOf(door) {
    const e = door.pivot.matrixWorld;
    vA.setFromMatrixPosition(e);
    vX.setFromMatrixColumn(e, 0).normalize().multiplyScalar(door.d.dir * door.d.length);
    return { ax: vA.x, az: vA.z, bx: vA.x + vX.x, bz: vA.z + vX.z, h: door.d.thick / 2, door: door.id };
  }
  for (const door of doors) pose(door);

  // Полотно по пути к положению to заденет игрока? Тогда дверь не двигается (не толкает сквозь себя).
  function blocksSwing(door, to) {
    if (!walk?.walking) return false;
    const v0 = door.v, px = camera.position.x, pz = camera.position.z;
    let hit = false;
    for (let i = 1; i <= 12 && !hit; i++) {
      door.v = v0 + ((to - v0) * i) / 12; pose(door);
      const s = door.seg, vx = s.bx - s.ax, vz = s.bz - s.az;
      const k = Math.max(0, Math.min(1, ((px - s.ax) * vx + (pz - s.az) * vz) / (vx * vx + vz * vz || 1e-9)));
      hit = Math.hypot(px - (s.ax + vx * k), pz - (s.az + vz * k)) < WALK.radius + s.h + 0.02;
    }
    door.v = v0; pose(door);
    return hit;
  }

  const animating = new Set(), toggles = new Set();
  function setOpen(id, open, { instant = false } = {}) {
    const door = typeof id === 'string' ? doors.find(d => d.id === id) : id;
    if (!door || door.open === !!open) return false;
    if (blocksSwing(door, open ? 1 : 0)) { flash('Отойдите от двери'); return false; }
    door.open = !!open;
    for (const f of toggles) f(door.id, door.open);
    if (instant) { door.v = open ? 1 : 0; door.t = 1; pose(door); animating.delete(door); onChange?.(door.id, door.open); }
    else { door.from = door.v; door.to = open ? 1 : 0; door.t = 0; animating.add(door); }
    walk?.refreshObstacles?.();
    aimDirty = true; renderHint(); requestRender?.();
    return true;
  }
  const toggle = id => { const d = typeof id === 'string' ? doors.find(q => q.id === id) : id; return d ? setOpen(d, !d.open) : false; };

  walk?.setAreaGate?.(area => doors.some(d => d.area === area && d.open));

  // ---------- прицел и подсказка ----------
  injectStyle('kd-style', DOORS_CSS);
  const hint = document.createElement('div');
  hint.className = 'kd-hint kw-float'; hint.hidden = true; hint.setAttribute('role', 'status');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'kd-btn kw-float'; btn.hidden = true;
  document.body.append(hint, btn);
  let touchSeen = false, flashUntil = 0, flashText = '';
  function flash(text) { flashText = text; flashUntil = performance.now() + 1200; renderHint(); }

  const ray = new THREE.Raycaster(); ray.layers.enableAll(); ray.far = REACH;
  const dir = new THREE.Vector3();
  function aim() {
    camera.updateMatrixWorld();
    camera.getWorldDirection(dir);
    ray.set(camera.getWorldPosition(vA), dir);
    const hit = ray.intersectObjects(occluders, false)[0];
    setTarget(hit ? byMesh.get(hit.object) ?? null : null);
  }
  function setTarget(door) {
    if (door === target) return;
    target = door;
    renderHint();
  }
  function renderHint() {
    const on = !!walk?.walking;
    const touch = touchSeen || coarse();
    const flashing = performance.now() < flashUntil;
    document.body.classList.toggle('kd-aim', on && !!target);
    const label = target ? (target.open ? 'Закрыть' : 'Открыть') : '';
    hint.hidden = !on || (!flashing && (!target || touch));
    hint.innerHTML = flashing ? flashText : target ? `<kbd>E</kbd> — ${label.toLowerCase()}` : '';
    btn.hidden = !on || !target || !touch;
    btn.textContent = label;
  }

  // ---------- ввод ----------
  const onKey = e => {
    if (e.code !== 'KeyE' || e.repeat || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || !walk?.walking) return;
    if (target) toggle(target);
    e.preventDefault();
  };
  // клик: при захвате мыши — сразу по нажатию; без захвата — короткий клик без перетаскивания (иначе это взгляд)
  let down = null;
  const onDown = e => {
    if (e.pointerType === 'touch') { touchSeen = true; renderHint(); return; }
    if (!walk?.walking || e.button !== 0) return;
    if (document.pointerLockElement === canvas) { if (target) toggle(target); return; }
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onUp = e => {
    if (!down || e.pointerId !== down.id) return;
    const d = down; down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && performance.now() - d.t < 500 && target) toggle(target);
  };
  const onBtn = e => { e.preventDefault(); if (target) toggle(target); };
  addEventListener('keydown', onKey);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  btn.addEventListener('click', onBtn);

  // ---------- кадр ----------
  let wasWalking = false;
  const lastCam = new Float64Array(16);
  function update(dt = 0) {
    let moved = false;
    for (const door of animating) {
      door.t = Math.min(1, door.t + dt / DUR);
      door.v = door.from + (door.to - door.from) * door.t;
      pose(door);
      if (door.t >= 1) { animating.delete(door); onChange?.(door.id, door.open); }
      moved = true;
    }
    if (moved) walk?.refreshObstacles?.();
    const walking = !!walk?.walking;
    if (walking) {
      // прицел пересчитываем, только когда сдвинулась камера или полотно (в покое — сравнение 16 чисел)
      const e = camera.matrixWorld.elements;
      let same = !moved && !aimDirty;
      for (let i = 0; i < 16 && same; i++) same = e[i] === lastCam[i];
      if (!same) { lastCam.set(e); aimDirty = false; aim(); }
      if (flashUntil && performance.now() > flashUntil) { flashUntil = 0; renderHint(); }
    } else if (wasWalking || target) { setTarget(null); renderHint(); aimDirty = true; }
    if (walking !== wasWalking) { wasWalking = walking; renderHint(); }
    return moved;
  }

  function colliders() {
    return [...blockers, ...doors.map(d => d.seg)];
  }

  function dispose() {
    removeEventListener('keydown', onKey);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    btn.removeEventListener('click', onBtn);
    hint.remove(); btn.remove();
    document.body.classList.remove('kd-aim');
    walk?.setAreaGate?.(null);
  }

  const pub = d => (d ? { id: d.id, get open() { return d.open; } } : null);
  return {
    update, colliders, dispose, toggle, setOpen,
    onToggle(fn) { toggles.add(fn); return () => toggles.delete(fn); },
    get target() { return pub(target); },
    get list() { return doors.map(pub); },
  };
}

// Токены --kw-* задаёт #kw-dock и .kw-float (minimap.js); прицел .kw-cross — из walk.js, здесь только подсветка.
const DOORS_CSS = `
.kd-aim .kw-cross { width: 10px; height: 10px; margin: -5px 0 0 -5px; background: var(--kw-accent); box-shadow: 0 0 0 1.5px var(--kw-sheet); opacity: 1;
  transition: width 0.12s ease, height 0.12s ease, margin 0.12s ease; }
.kd-hint, .kd-btn { position: fixed; z-index: 5; left: 50%; top: calc(50% + 22px); transform: translateX(-50%);
  border: 1px solid var(--kw-line); border-radius: 4px; background: var(--kw-sheet); color: var(--kw-ink); box-shadow: var(--kw-shadow);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font: 500 12.5px/1 var(--f-body, "Inter", Arial, sans-serif); white-space: nowrap; }
.kd-hint { padding: 6px 9px; pointer-events: none; }
.kd-hint kbd { font: 600 10.5px/1 var(--f-data, ui-monospace, Menlo, monospace); padding: 2px 5px; margin-right: 1px;
  border: 1px solid currentColor; border-radius: 3px; opacity: 0.7; }
.kd-btn { top: calc(50% + 28px); padding: 0 16px; min-height: 44px; min-width: 112px; cursor: pointer; touch-action: manipulation;
  background: var(--kw-accent); color: var(--kw-accent-ink); border-color: var(--kw-accent); font-size: 14px; }
.kd-btn:focus-visible { outline: 2px solid var(--kw-accent); outline-offset: 2px; }
.kd-hint[hidden], .kd-btn[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .kd-aim .kw-cross { transition: none; } }
`;
