// Телефон в руке (прогулка): взять со стола, листать Shorts, положить. Рисует и играет видео tv.js (экран с полем hold
// в spec/tv.json); здесь только прицел, ввод, подсказка и кнопка.
//   Взять: смотрим на телефон ближе reach и жмём E или кликаем/тапаем по нему (телефон под прицелом важнее двери и стула:
//   обработчики стоят в фазе захвата и дальше событие не пускают). Оружие убирается (getVM().setWeapon('none')).
//   В руке: колесо, ↑/↓ или свайп по телефону — следующее/предыдущее видео; E, Q, Esc или кнопка «Положить» — положить.
//   W/S и мышь по-прежнему ходят и смотрят; 1–5 (оружие) сначала кладут телефон. Вышли из прогулки — телефон кладётся сам.
//
// createHandheld({ THREE, camera, canvas, getWalk, getVM, requestRender, reach, getTarget, getRect, onHold, onStep })
//   getTarget() -> Object3D телефона на столе (луч прицела) | null; getRect() -> DOMRect экрана телефона в руке (свайп);
//   onHold(on) — взяли/положили; onStep(d) — листать (1 — следующее, −1 — предыдущее).
//   -> { sync() — после кадра (прицел пересчитывается, только если сдвинулась камера), pick(), drop(), held, dispose() }
import { injectStyle } from './minimap.js';

const SWIPE = 28;        // px: короче — это не свайп
const STEP_GAP = 320;    // мс между перелистываниями (колесо трекпада сыплет событиями)
const WHEEL = 40;        // накопленная прокрутка, после которой листаем

export function createHandheld({ THREE, camera, canvas, getWalk, getVM, requestRender, reach = 2, getTarget, getRect, onHold, onStep }) {
  let held = false, aimed = false, touchSeen = false, lastStep = 0, wheel = 0, wheelAt = 0, press = null, swipe = null;
  injectStyle('khh-style', CSS);
  const hint = document.createElement('div');
  hint.className = 'khh-hint kw-float'; hint.hidden = true; hint.setAttribute('role', 'status');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'khh-btn kw-float'; btn.hidden = true;
  document.body.append(hint, btn);

  const walking = () => !!getWalk?.()?.walking;
  const mq = matchMedia('(pointer: coarse)'), coarse = () => mq.matches;
  const ray = new THREE.Raycaster(), hits = [], ndc = new THREE.Vector2();
  // попадает ли луч из точки экрана (NDC; по умолчанию центр — прицел) в телефон на столе ближе reach
  function hitAt(x = 0, y = 0) {
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
    const touch = touchSeen || coarse(), on = walking();
    const key = (on ? 1 : 0) | (held ? 2 : 0) | (aimed ? 4 : 0) | (touch ? 8 : 0);
    if (key === hintKey) return;
    hintKey = key;
    hint.hidden = !on || (held ? touch : !aimed || touch);
    hint.classList.toggle('held', held);
    hint.innerHTML = held ? 'Колесо / <kbd>↑</kbd><kbd>↓</kbd> — листать · <kbd>E</kbd> — положить' : '<kbd>E</kbd> — взять телефон';
    btn.hidden = !on || !touch || !(held || aimed);
    btn.classList.toggle('held', held);
    btn.textContent = held ? 'Положить' : 'Взять телефон';
    // E сейчас за телефоном: подсказки и кнопки дверей и стульев (.kd-*) на том же месте прячем
    document.body.classList.toggle('khh-on', on && (held || aimed));
  }

  function pick() {
    if (held || !walking()) return;
    const vm = getVM?.();
    if (vm && vm.weapon && vm.weapon !== 'none') vm.setWeapon('none');
    held = true; aimed = false; lastTarget = null;
    onHold(true); render();
  }
  function drop() {
    if (!held) return;
    held = false; swipe = null;
    onHold(false); render();
    requestRender?.();
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
    if (held && !walking()) drop();
    if (!held) {
      // пересчёт — когда сдвинулась камера или телефон появился/пропал (положили обратно, сменили опцию)
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
      if (e.code === 'KeyE' || e.code === 'KeyQ' || e.code === 'Escape') { if (!e.repeat) drop(); stop(e); }
      else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { step(e.code === 'ArrowDown' ? 1 : -1); stop(e); }
      else if (/^Digit[1-5]$/.test(e.code)) drop();   // оружие: телефон кладём, клавиша идёт дальше в viewmodel
      return;
    }
    if (e.code === 'KeyE' && !e.repeat && walking() && aimed) { pick(); stop(e); }
  };
  const inRect = (e, r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const onDown = e => {
    if (e.pointerType === 'touch' && !touchSeen) { touchSeen = true; render(); }
    if (e.target !== canvas || !walking()) return;
    if (held) {   // свайп по телефону в руке; мимо него — обычный взгляд
      if (inRect(e, getRect())) { swipe = { id: e.pointerId, y: e.clientY }; stop(e); }
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
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
    if (!held || e.target !== canvas) return;
    stop(e);
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
    document.body.classList.remove('khh-on');
  }

  return { sync, pick, drop, dispose, get held() { return held; }, get aimed() { return aimed; } };
}

// Токены --kw-* — у .kw-float (minimap.js), как у подсказок дверей
const CSS = `
.khh-hint, .khh-btn { position: fixed; z-index: 5; left: 50%; top: calc(50% + 22px); transform: translateX(-50%);
  border: 1px solid var(--kw-line); border-radius: 4px; background: var(--kw-sheet); color: var(--kw-ink); box-shadow: var(--kw-shadow);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font: 500 12.5px/1 var(--f-body, "Inter", Arial, sans-serif); white-space: nowrap; }
.khh-hint { padding: 6px 9px; pointer-events: none; }
.khh-hint.held { top: calc(50% - 48px); }   /* в руке телефон занимает низ кадра: подсказка над прицелом */
.khh-hint kbd { font: 600 10.5px/1 var(--f-data, ui-monospace, Menlo, monospace); padding: 2px 5px; margin-right: 1px;
  border: 1px solid currentColor; border-radius: 3px; opacity: 0.7; }
.khh-btn { top: calc(50% + 28px); padding: 0 16px; min-height: 44px; min-width: 112px; cursor: pointer; touch-action: manipulation;
  background: var(--kw-accent); color: var(--kw-accent-ink); border-color: var(--kw-accent); font-size: 14px; }
.khh-btn.held { top: calc(50% - 76px); }
.khh-btn:focus-visible { outline: 2px solid var(--kw-accent); outline-offset: 2px; }
.khh-hint[hidden], .khh-btn[hidden] { display: none; }
body.khh-on .kd-hint, body.khh-on .kd-btn { display: none; }
`;
