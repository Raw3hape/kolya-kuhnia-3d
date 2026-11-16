// Вещь в руке (прогулка): взять, пользоваться, носить с собой, сесть с ней, вернуть на место. Вещей несколько —
// телефон с Shorts на острове (рисует и играет tv.js), газета на полке над унитазом (newspaper.js); у каждой свой
// экземпляр createHandheld, в руке всегда одна: взяли другую — первая сама возвращается на место.
// Здесь только прицел, ввод, подсказка и кнопка; что видно в руке — у владельца вещи (onHold, onStep).
//   Взять: смотрим на вещь ближе reach и жмём E или кликаем/тапаем по ней (вещь под прицелом важнее двери и стула:
//   обработчики стоят в фазе захвата и дальше событие не пускают). Оружие убирается (getVM().setWeapon('none')).
//   В руке: колесо, ↑/↓ или свайп по вещи — листать; W/S и мышь по-прежнему ходят и смотрят.
//   С вещью можно ходить по всей квартире, открывать двери и садиться: E с прицелом на двери или сиденье работает
//   как обычно (их подсказки видны), сидя вещь остаётся в руке и листается; E, Esc, Пробел сидя — встать (seats.js).
//   Вернуть на место: Q (всегда), E — когда прицел ни на что не наведён, Esc в прогулке, кнопка «Положить».
//   1–5 (оружие) сначала кладут вещь; вышли из прогулки и не сидим — вещь возвращается сама.
//
// createHandheld({ THREE, camera, canvas, getWalk, getVM, getSeats?, getDoors?, requestRender, reach, getTarget, getRect,
//                  onHold, onStep, name? })
//   getTarget() -> Object3D вещи на месте (луч прицела) | null; getRect() -> DOMRect вещи в руке (свайп);
//   onHold(on) — взяли/положили; onStep(d) — листать (1 — следующее, −1 — предыдущее);
//   name — { take: 'взять телефон', btn: 'Взять телефон', scroll: 'листать', heldHint: true } для подсказок
//   (heldHint: false — в руке своей подсказки не показывать: вещь пишет клавиши сама, как газета в подвале).
//   -> { sync() — после кадра (прицел пересчитывается, только если сдвинулась камера), pick(), drop(), held, aimed, dispose() }
import { injectStyle } from './minimap.js';
import { addHelp } from './help.js';

addHelp(
  { mode: 'walk', topic: 'walk', keys: ['E'], text: 'взять телефон с острова — там Shorts', touch: 'кнопка «Взять телефон», когда смотрите на него', order: 60 },
  { mode: 'phone', keys: ['колесо', '↑', '↓'], text: 'листать видео', touch: 'свайп по телефону — листать', brief: true, order: 10 },
  { mode: 'phone', keys: ['Q'], text: 'вернуть телефон на остров (или E, когда прицел ни на что не наведён)', touch: 'кнопка «Положить»', brief: true, order: 20 },
  { mode: 'phone', keys: ['E'], text: 'с телефоном в руке можно ходить, открывать двери и садиться — прицел на сиденье и E; сидя он листается дальше', touch: 'кнопка «Сесть» под прицелом', order: 30 },
);

const SWIPE = 28;        // px: короче — это не свайп
const STEP_GAP = 320;    // мс между перелистываниями (колесо трекпада сыплет событиями)
const WHEEL = 40;        // накопленная прокрутка, после которой листаем
const ALL = new Set();   // все вещи: в руке одна, классы body — по всем сразу

// Классы body по всем вещам: khh-on — подсказка вещи под прицелом заняла место подсказок дверей и стульев (.kd-*);
// khh-held — что-то в руке (ui.js подписан на классы body)
function bodyClasses() {
  let aim = false, held = false;
  for (const it of ALL) { if (it.state.on && it.state.aimed && !it.state.held) aim = true; if (it.state.on && it.state.held) held = true; }
  document.body.classList.toggle('khh-on', aim && !held);
  document.body.classList.toggle('khh-held', held);
}

export function createHandheld({ THREE, camera, canvas, getWalk, getVM, getSeats, getDoors, requestRender, reach = 2, getTarget, getRect,
  onHold, onStep, name = {}, networkId = 'phone' }) {
  const N = { take: 'взять телефон', btn: 'Взять телефон', scroll: 'листать', heldHint: true, ...name };
  const state = { on: false, held: false, aimed: false };
  let network = null, ownerId = null, pending = false, generation = 0;
  const selfId = () => typeof network?.selfId === 'function' ? network.selfId() : network?.selfId;
  const unavailable = () => !!network && ownerId != null && ownerId !== selfId();
  let held = false, aimed = false, touchSeen = false, lastStep = 0, wheel = 0, wheelAt = 0, press = null, swipe = null;
  injectStyle('khh-style', CSS);
  const hint = document.createElement('div');
  hint.className = 'khh-hint kw-float'; hint.hidden = true; hint.setAttribute('role', 'status');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'khh-btn kw-float'; btn.hidden = true;
  document.body.append(hint, btn);

  const walking = () => !!getWalk?.()?.walking;
  const seated = () => !!getSeats?.()?.active;
  const carrying = () => !!getWalk?.()?.active || seated();       // вещь может оставаться в руке
  // E с вещью в руке: дверь или сиденье под прицелом — им (вещь остаётся в руке), иначе — вернуть вещь
  const eBusy = () => seated() || (walking() && (!!getDoors?.()?.target || !!getSeats?.()?.target));
  const mq = matchMedia('(pointer: coarse)'), coarse = () => mq.matches;
  const ray = new THREE.Raycaster(), hits = [], ndc = new THREE.Vector2();
  // попадает ли луч из точки экрана (NDC; по умолчанию центр — прицел) в вещь на месте ближе reach
  function hitAt(x = 0, y = 0) {
    if (unavailable() || pending) return false;
    const t = walking() ? getTarget() : null;
    if (!t) return false;
    ray.setFromCamera(ndc.set(x, y), camera);
    ray.layers.mask = camera.layers.mask; ray.far = reach;
    hits.length = 0;
    ray.intersectObject(t, true, hits);
    return hits.length > 0;
  }

  let hintKey = -1;
  function render() {
    const touch = touchSeen || coarse(), on = held ? carrying() : walking();
    state.on = on; state.held = held; state.aimed = aimed; state.pending = pending;
    const key = (on ? 1 : 0) | (held ? 2 : 0) | (aimed ? 4 : 0) | (touch ? 8 : 0) | (pending ? 16 : 0);
    if (key !== hintKey) {
      hintKey = key;
      hint.hidden = !on || (held ? touch || !N.heldHint : !aimed || touch);
      hint.classList.toggle('held', held);
      hint.innerHTML = held ? `Колесо / <kbd>↑</kbd><kbd>↓</kbd> — ${N.scroll} · <kbd>Q</kbd> — вернуть на место` : `<kbd>E</kbd> — ${N.take}`;
      btn.hidden = !on || !touch || !(held || aimed);
      btn.classList.toggle('held', held);
      btn.textContent = held ? 'Положить' : N.btn;
      btn.disabled = pending;
    }
    bodyClasses();
  }

  function pickLocal() {
    if (held || !walking()) return false;
    if (!network) for (const it of ALL) if (it !== api && it.held) it.drop(); // In rooms the authority releases the previous item atomically.
    const vm = getVM?.();
    if (vm && vm.weapon && vm.weapon !== 'none') vm.setWeapon('none');
    held = true; aimed = false; lastTarget = null;
    onHold(true); render();
    return true;
  }
  function dropLocal() {
    if (!held) return false;
    held = false; swipe = null;
    onHold(false); render();
    requestRender?.();
    return true;
  }
  function requestOwnership(kind) {
    const current = network, token = generation;
    pending = true; aimed = false; render();
    return Promise.resolve(current.request?.({ kind, id: networkId })).then(result => {
      if (current !== network || token !== generation || !result?.ok) return false;
      if (kind === 'claim') {
        if (!carrying()) { current.request?.({ kind: 'release', id: networkId }); return false; }
        ownerId = selfId(); return held || pickLocal();
      }
      ownerId = null; return !held || dropLocal();
    }).catch(() => false).finally(() => { if (token === generation) { pending = false; render(); } });
  }
  function pick() {
    if (held || pending || !walking() || unavailable()) return false;
    return network ? requestOwnership('claim') : pickLocal();
  }
  function drop() {
    if (!held || pending) return false;
    return network ? requestOwnership('release') : dropLocal();
  }
  function setNetwork(adapter) {
    generation++; pending = false;
    if (held) dropLocal();
    network = adapter || null; ownerId = null; lastTarget = null; hintKey = -1; render();
  }
  function applyNetwork(owner) {
    ownerId = owner && typeof owner === 'object' ? owner.owner ?? owner.ownerId ?? null : owner ?? null;
    if (network && ownerId === selfId()) pickLocal();
    else if (held) dropLocal();
    if (unavailable()) aimed = false;
    lastTarget = null; hintKey = -1; render();
  }
  function step(d) {
    const now = performance.now();
    if (now - lastStep < STEP_GAP) return;
    lastStep = now;
    onStep(d);
  }

  // ---------- кадр ----------
  const lastCam = new Float64Array(16);
  let lastTarget = null;
  function sync() {
    if (held && !carrying()) drop();
    if (!held) {
      // пересчёт — когда сдвинулась камера или вещь появилась/пропала (положили обратно, сменили опцию)
      const e = camera.matrixWorld.elements, t = walking() ? getTarget() : null;
      let same = t === lastTarget;
      for (let i = 0; i < 16 && same; i++) same = e[i] === lastCam[i];
      if (!same) { lastCam.set(e); lastTarget = t; aimed = hitAt(); }
      if (!walking()) aimed = false;
    }
    render();
  }

  // ---------- ввод (фаза захвата на window: раньше дверей, стульев, оружия и прогулки) ----------
  const stop = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const typing = t => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const onKey = e => {
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (held) {
      if (!carrying()) return;
      if (e.code === 'KeyQ' || (e.code === 'KeyE' && !eBusy()) || (e.code === 'Escape' && !seated())) { if (!e.repeat) drop(); stop(e); }
      else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { step(e.code === 'ArrowDown' ? 1 : -1); stop(e); }
      else if (/^Digit[1-5]$/.test(e.code)) drop();   // оружие: вещь кладём, клавиша идёт дальше в viewmodel
      return;                                          // E на двери/сиденье и E/Esc/Пробел сидя — дальше, им
    }
    if (e.code === 'KeyE' && !e.repeat && walking() && aimed) { pick(); stop(e); }
  };
  const inRect = (e, r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const onDown = e => {
    if (e.pointerType === 'touch' && !touchSeen) { touchSeen = true; render(); }
    if (e.target !== canvas) return;
    if (held) {   // свайп по вещи в руке; мимо неё — обычный взгляд (и клик по сиденью — сесть)
      if (carrying() && document.pointerLockElement !== canvas && inRect(e, getRect())) { swipe = { id: e.pointerId, y: e.clientY }; stop(e); }
      return;
    }
    if (!walking() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const vm = getVM?.();
    if (!held && vm?.weapon && vm.weapon !== 'none') return;   // с оружием клик — выстрел (экран трескается), взять — клавишей E
    const locked = document.pointerLockElement === canvas;
    if (locked) { if (aimed) { stop(e); pick(); } return; }
    const r = canvas.getBoundingClientRect();
    if (!hitAt(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)) return;
    stop(e);
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onUp = e => {
    if (swipe && e.pointerId === swipe.id) {
      const dy = e.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dy) > SWIPE) step(dy < 0 ? 1 : -1);   // вверх — следующее, как в ленте
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    const p = press; press = null;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 10 && performance.now() - p.t < 600) pick();
  };
  const onWheel = e => {
    if (!held || !carrying() || e.target !== canvas) return;
    stop(e);   // и сидя: колесо листает вещь, а не приближает (seats.js)
    const now = performance.now();
    if (now - wheelAt > 200) wheel = 0;
    wheelAt = now;
    wheel += e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (Math.abs(wheel) >= WHEEL) { step(wheel > 0 ? 1 : -1); wheel = 0; }
  };
  const onBtn = e => { e.preventDefault(); if (held) drop(); else if (aimed) pick(); };
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onDown, true);
  addEventListener('pointerup', onUp, true);
  addEventListener('pointercancel', onUp, true);
  addEventListener('wheel', onWheel, { capture: true, passive: false });
  btn.addEventListener('click', onBtn);

  function dispose() {
    removeEventListener('keydown', onKey, true);
    removeEventListener('pointerdown', onDown, true);
    removeEventListener('pointerup', onUp, true);
    removeEventListener('pointercancel', onUp, true);
    removeEventListener('wheel', onWheel, { capture: true });
    hint.remove(); btn.remove();
    ALL.delete(api);
    bodyClasses();
  }

  const api = { state, sync, pick, drop, dispose, setNetwork, applyNetwork, get ownerId() { return ownerId; }, get held() { return held; }, get aimed() { return aimed; } };
  ALL.add(api);
  return api;
}

// Токены --kw-* — у .kw-float (minimap.js), как у подсказок дверей
const CSS = `
.khh-hint, .khh-btn { position: fixed; z-index: 5; left: 50%; top: calc(50% + 22px); transform: translateX(-50%);
  border: 1px solid var(--kw-line); border-radius: 4px; background: var(--kw-sheet); color: var(--kw-ink); box-shadow: var(--kw-shadow);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font: 500 12.5px/1 var(--f-body, "Inter", Arial, sans-serif); white-space: nowrap; }
.khh-hint { padding: 6px 9px; pointer-events: none; }
.khh-hint.held { top: calc(50% - 48px); }   /* в руке вещь занимает низ кадра: подсказка над прицелом */
.khh-hint kbd { font: 600 10.5px/1 var(--f-data, ui-monospace, Menlo, monospace); padding: 2px 5px; margin-right: 1px;
  border: 1px solid currentColor; border-radius: 3px; opacity: 0.7; }
.khh-btn { top: calc(50% + 28px); padding: 0 16px; min-height: 44px; min-width: 112px; cursor: pointer; touch-action: manipulation;
  background: var(--kw-accent); color: var(--kw-accent-ink); border-color: var(--kw-accent); font-size: 14px; }
.khh-btn.held { top: calc(50% - 76px); }
.khh-btn:focus-visible { outline: 2px solid var(--kw-accent); outline-offset: 2px; }
.khh-hint[hidden], .khh-btn[hidden] { display: none; }
body.khh-on .kd-hint, body.khh-on .kd-btn { display: none; }
`;
