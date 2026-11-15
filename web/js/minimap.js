// Мини-план в левом нижнем углу: стены, комнаты, двери, камера с конусом обзора.
// Самодостаточный модуль: сам вставляет свою разметку и стили (токены страницы --ink, --sheet, --accent… с запасными значениями).
// API: initMinimap({ plan, getCamera, onTeleport, onPick }) -> { update(), el }.
//   update()            — дёшево перерисовать маркер камеры (звать, когда камера сдвинулась).
//   onTeleport(x, z)    — клик/тап по плану, метры в осях плана.
//   onPick(roomId|null) — какая комната под кликом (вызывается до onTeleport), необязательно.
// Ещё экспортирует injectStyle() и subtractRect() — их использует walk.js. План встаёт в #hud-bottom страницы
// (низ слева, рядом с полосой режима ui.js), на телефоне — под карточку заголовка.

import { addHelp } from './help.js';

addHelp({ mode: 'design', keys: [], text: 'план — нажмите на комнату, чтобы перелететь туда; свернуть — стрелка в его углу', order: 70 });

const LABELS = { kitchen_living: 'Кухня-гостиная', hall: 'Холл', room2: 'Комната 2', room3: 'Комната 3', bath: 'Ванная' };
const NS = 'http://www.w3.org/2000/svg';
const PAD = 0.3;          // поле вокруг плана, м
const CONE = 1.5;         // длина конуса обзора, м
const STORE = 'kitchen.minimap.collapsed';

// ---------- общие помощники (их же берёт walk.js) ----------

// Прямоугольник минус прямоугольник в плане XZ -> до 4 кусков.
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

// «Полка» плана: слева в нижней полосе страницы (#hud-bottom), без неё — в левом нижнем углу; на телефоне — под карточкой заголовка.
function ensureDock() {
  let dock = document.getElementById('kw-dock');
  if (dock) return dock;
  injectStyle('kw-dock-style', DOCK_CSS);
  dock = document.createElement('div');
  dock.id = 'kw-dock';
  const host = document.getElementById('hud-bottom');
  if (host) host.prepend(dock); else document.body.appendChild(dock);
  // До 1100 px (планшет, телефон) полка встаёт под карточку заголовка: низ отдан полосе режима, шторке и джойстику.
  // --kw-dock-top пишется в :root — под карточку встают и другие (табло охоты hunt.js)
  const place = () => {
    const tc = document.querySelector('.title-card');
    const top = tc ? Math.round(tc.getBoundingClientRect().bottom + 8) : 0;
    if (top > 0) document.documentElement.style.setProperty('--kw-dock-top', top + 'px');
  };
  addEventListener('resize', place);
  const tc = document.querySelector('.title-card');
  if (tc) new ResizeObserver(place).observe(tc);   // карточка растёт, когда ui.js добавляет переключатель режимов
  place(); document.fonts?.ready.then(place);
  return dock;
}

export function injectStyle(id, css) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id; s.textContent = css;
  document.head.appendChild(s);
}

// Токены страницы с запасными значениями (если страница их не задала — свои светлые/тёмные).
const DOCK_CSS = `
#kw-dock, .kw-float {
  --kw-ink: var(--ink, var(--kw-fb-ink)); --kw-muted: var(--muted, var(--kw-fb-muted));
  --kw-sheet: var(--sheet, var(--kw-fb-sheet)); --kw-line: var(--line, var(--kw-fb-line));
  --kw-accent: var(--accent, var(--kw-fb-accent)); --kw-accent-ink: var(--accent-ink, var(--kw-fb-accent-ink));
  --kw-shadow: var(--shadow, 0 10px 40px rgba(20, 30, 35, 0.16));
  --kw-fb-ink: #1c2326; --kw-fb-muted: #66706f; --kw-fb-sheet: rgba(250, 249, 246, 0.93);
  --kw-fb-line: rgba(28, 35, 38, 0.12); --kw-fb-accent: #0f4352; --kw-fb-accent-ink: #fff;
}
#kw-dock {
  flex: none; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; pointer-events: none;
  font: 13px/1.3 var(--f-body, "Inter", "Helvetica Neue", Arial, sans-serif); color: var(--kw-ink);
}
@media (prefers-color-scheme: dark) { #kw-dock, .kw-float {
  --kw-fb-ink: #e7ebea; --kw-fb-muted: #9aa5a4; --kw-fb-sheet: rgba(22, 27, 29, 0.92);
  --kw-fb-line: rgba(231, 235, 234, 0.12); --kw-fb-accent: #7cc4d3; --kw-fb-accent-ink: #0c1a1e; } }
#kw-dock > * { pointer-events: auto; }
body > #kw-dock { position: fixed; z-index: 4; left: max(16px, env(safe-area-inset-left, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
/* Планшет и телефон: план под карточкой заголовка — полоса режима внизу получает всю ширину до панели */
@media (max-width: 1100px) {
  #kw-dock { position: fixed; z-index: 4; bottom: auto; top: var(--kw-dock-top, calc(120px + env(safe-area-inset-top, 0px))); left: max(16px, env(safe-area-inset-left, 0px)); }
}
@media (max-width: 800px) {
  #kw-dock { left: max(12px, env(safe-area-inset-left, 0px)); gap: 6px; }
  body:has(#panel.open) #kw-dock { display: none; }
}
`;

const MAP_CSS = `
.km { order: 1; width: 180px; background: var(--kw-sheet); border: 1px solid var(--kw-line); border-radius: 4px; box-shadow: var(--kw-shadow);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); overflow: hidden; }
.km-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 2px 0 9px; height: 28px; }
.km-head span { font: 600 11px/1 var(--f-display, inherit); letter-spacing: 0.07em; text-transform: uppercase; color: var(--kw-muted); }
.km-fold { width: 28px; height: 28px; border: 0; background: none; color: var(--kw-muted); cursor: pointer; border-radius: 3px; display: grid; place-items: center; }
.km-fold:hover { color: var(--kw-ink); }
.km-fold:focus-visible { outline: 2px solid var(--kw-accent); outline-offset: -2px; }
.km-fold svg { transition: transform 0.18s ease; }
.km.collapsed { width: auto; }
.km.collapsed .km-fold svg { transform: rotate(180deg); }
.km.collapsed .km-svg { display: none; }
.km-svg { display: block; width: 100%; height: auto; cursor: crosshair; touch-action: manipulation; padding: 0 6px 6px; box-sizing: border-box; }
.km-room { fill: color-mix(in srgb, var(--kw-ink) 6%, transparent); transition: fill 0.12s; }
.km-room.hot { fill: color-mix(in srgb, var(--kw-accent) 16%, transparent); }
.km-balcony { fill: none; stroke: var(--kw-muted); stroke-width: 0.04; stroke-dasharray: 0.15 0.12; opacity: 0.7; }
.km-wall { fill: var(--kw-ink); opacity: 0.86; }
.km-win { fill: var(--kw-sheet); stroke: var(--kw-ink); stroke-width: 0.03; opacity: 0.86; }
.km-door { fill: none; stroke: var(--kw-muted); stroke-width: 0.035; }
.km-label { fill: var(--kw-muted); font-family: var(--f-body, "Inter", Arial, sans-serif); font-weight: 500; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.km-cone { fill: color-mix(in srgb, var(--kw-accent) 26%, transparent); stroke: var(--kw-accent); stroke-width: 0.04; stroke-linejoin: round; }
.km-dot { fill: var(--kw-accent); stroke: var(--kw-sheet); stroke-width: 0.07; }
.km-cam.out { opacity: 0.55; }
@media (max-width: 800px) { .km { width: 130px; } .km-head { height: 24px; } .km-fold { width: 24px; height: 24px; } }
@media (prefers-reduced-motion: reduce) { .km-fold svg, .km-room { transition: none; } }
`;

// ---------- мини-план ----------

export function initMinimap({ plan, getCamera, onTeleport, onPick }) {
  const dock = ensureDock();
  injectStyle('km-style', MAP_CSS);

  // Рамка: квартира и балкон
  const b = plan.bounds, bal = plan.balcony;
  const vb = {
    x: Math.min(b.x0, bal?.x0 ?? b.x0) - PAD, y: Math.min(b.z0, bal?.z0 ?? b.z0) - PAD,
  };
  vb.w = Math.max(b.x1, bal?.x1 ?? b.x1) + PAD - vb.x;
  vb.h = Math.max(b.z1, bal?.z1 ?? b.z1) + PAD - vb.y;

  const el = document.createElement('section');
  el.className = 'km';
  el.setAttribute('aria-label', 'План квартиры');
  el.innerHTML = `<div class="km-head"><span>План</span><button type="button" class="km-fold" aria-expanded="true" aria-label="Свернуть план">
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button></div>`;
  const svg = svgEl('svg', { class: 'km-svg', viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, role: 'img', 'aria-label': 'Нажмите на план, чтобы перейти в это место' });
  el.appendChild(svg);
  dock.appendChild(el);

  // Сворачивание (помним между заходами)
  const fold = el.querySelector('.km-fold');
  const setCollapsed = c => {
    el.classList.toggle('collapsed', c);
    fold.setAttribute('aria-expanded', String(!c));
    fold.setAttribute('aria-label', c ? 'Показать план' : 'Свернуть план');
    try { localStorage.setItem(STORE, c ? '1' : '0'); } catch { /* хранилище недоступно */ }
    if (!c) update(true);
  };
  fold.addEventListener('click', () => setCollapsed(!el.classList.contains('collapsed')));
  let startCollapsed = false;
  try { startCollapsed = localStorage.getItem(STORE) === '1'; } catch { /* нет хранилища */ }

  // Комнаты (шахту не показываем отдельно — она стенами)
  const roomsG = svgEl('g'), wallsG = svgEl('g'), openG = svgEl('g'), labelsG = svgEl('g');
  if (bal) roomsG.appendChild(svgEl('rect', { class: 'km-balcony', x: bal.x0, y: bal.z0, width: bal.x1 - bal.x0, height: bal.z1 - bal.z0 }));
  const roomRects = [];
  for (const [id, r] of Object.entries(plan.rooms)) {
    if (id === 'shaft') continue;
    for (const q of r.rects) {
      const n = svgEl('rect', { class: 'km-room', x: q.x0, y: q.z0, width: q.x1 - q.x0, height: q.z1 - q.z0 });
      n.dataset.room = id; roomsG.appendChild(n); roomRects.push(n);
    }
  }
  // Межкомнатные проёмы тоже «пол»: подсвечиваются вместе с холлом
  const doors = plan.openings.filter(o => o.type === 'interior');

  // Стены с вырезанными проёмами
  const holes = plan.openings.map(o => ({ x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1 }));
  for (const w of plan.walls) {
    let parts = [w];
    for (const h of holes) parts = parts.flatMap(p => subtractRect(p, h));
    for (const p of parts) wallsG.appendChild(svgEl('rect', { class: 'km-wall', x: p.x0, y: p.z0, width: p.x1 - p.x0, height: p.z1 - p.z0 }));
  }
  // Окна и балконные двери — двойная линия остекления; входная — проём со створкой; межкомнатные — полотно и дуга
  for (const o of plan.openings) {
    const X = o.along === 'x';
    if (o.type === 'window' || o.type === 'door') {
      const t0 = X ? o.z0 : o.x0, t1 = X ? o.z1 : o.x1;
      const r = X ? { x: o.x0, y: t0, width: o.x1 - o.x0, height: t1 - t0 } : { x: t0, y: o.z0, width: t1 - t0, height: o.z1 - o.z0 };
      openG.appendChild(svgEl('rect', { class: 'km-win', ...r }));
      const mid = (t0 + t1) / 2;
      openG.appendChild(svgEl('path', { class: 'km-door', d: X ? `M${o.x0} ${mid}H${o.x1}` : `M${mid} ${o.z0}V${o.z1}` }));
    } else if (o.type === 'interior') {
      openG.appendChild(svgEl('path', { class: 'km-door', d: doorPath(o) }));
    } else {
      // входная: створка в плане не задана — только проём с порогом
      const mid = X ? (o.z0 + o.z1) / 2 : (o.x0 + o.x1) / 2;
      openG.appendChild(svgEl('path', { class: 'km-door', d: X ? `M${o.x0} ${mid}H${o.x1}` : `M${mid} ${o.z0}V${o.z1}` }));
    }
  }

  // Подписи: в центре самого большого прямоугольника комнаты; размер шрифта подбирается под ширину плана
  const labels = [];
  const addLabel = (text, q) => {
    const t = svgEl('text', { class: 'km-label', x: (q.x0 + q.x1) / 2, y: (q.z0 + q.z1) / 2 });
    labelsG.appendChild(t);
    labels.push({ t, text, w: q.x1 - q.x0, h: q.z1 - q.z0, cx: (q.x0 + q.x1) / 2, cy: (q.z0 + q.z1) / 2 });
  };
  for (const [id, r] of Object.entries(plan.rooms)) {
    if (id === 'shaft') continue;
    const q = r.rects.reduce((a, c) => ((c.x1 - c.x0) * (c.z1 - c.z0) > (a.x1 - a.x0) * (a.z1 - a.z0) ? c : a));
    addLabel(LABELS[id] || r.name, q);
  }
  if (bal) addLabel('Балкон', bal);

  // Камера
  const cam = svgEl('g', { class: 'km-cam' });
  const cone = svgEl('path', { class: 'km-cone' });
  const dot = svgEl('circle', { class: 'km-dot', r: 0.17 });
  cam.append(cone, dot);
  svg.append(roomsG, wallsG, openG, labelsG, cam);

  function layoutLabels() {
    const px = svg.clientWidth || 180;
    const perM = (px - 12) / vb.w;             // пикселей на метр
    const base = (px < 150 ? 8 : 9.5) / perM;  // желаемый кегль в метрах
    const cw = 0.56;                           // средняя ширина буквы, доля кегля
    for (const L of labels) {
      const one = [L.text], two = L.text.includes(' ') ? L.text.split(' ') : null;
      const fit = lines => Math.min(base, (L.w * 0.9) / (Math.max(...lines.map(s => s.length)) * cw), (L.h * 0.8) / (lines.length * 1.15));
      let lines = one, size = fit(one);
      if (two && fit(two) > size * 1.15) { lines = two; size = fit(two); }
      L.t.setAttribute('font-size', size.toFixed(3));
      L.t.textContent = '';
      lines.forEach((s, i) => {
        const sp = svgEl('tspan', { x: L.cx, y: L.cy + (i - (lines.length - 1) / 2) * size * 1.15 });
        sp.textContent = s; L.t.appendChild(sp);
      });
    }
  }
  new ResizeObserver(() => layoutLabels()).observe(svg);

  // Клик -> метры
  const toPlan = e => {
    const r = svg.getBoundingClientRect();
    const padPx = 6, w = r.width - padPx * 2, h = r.height - padPx;   // padding 0 6px 6px
    return { x: vb.x + ((e.clientX - r.left - padPx) / w) * vb.w, z: vb.y + ((e.clientY - r.top) / h) * vb.h };
  };
  const roomAt = (x, z) => {
    for (const [id, r] of Object.entries(plan.rooms)) {
      if (id !== 'shaft' && r.rects.some(q => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1)) return id;
    }
    return doors.some(o => x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1) ? 'hall' : null;
  };
  let hot = null;
  const setHot = id => {
    if (id === hot) return;
    hot = id;
    for (const n of roomRects) n.classList.toggle('hot', n.dataset.room === id);
  };
  let down = null;
  svg.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  svg.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { const p = toPlan(e); setHot(roomAt(p.x, p.z)); } });
  svg.addEventListener('pointerleave', () => setHot(null));
  svg.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) { down = null; return; }
    down = null;
    const p = toPlan(e);
    onPick?.(roomAt(p.x, p.z));
    onTeleport?.(Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100);
  });

  // Маркер камеры: позиция, направление по горизонтали, ширина обзора
  let last = '';
  function update(force = false) {
    if (el.classList.contains('collapsed')) return;
    const c = getCamera?.();
    if (!c) return;
    c.updateMatrixWorld?.();
    const e = c.matrixWorld.elements;
    let x = e[12], z = e[14];
    const dx = -e[8], dy = -e[9], dz = -e[10];
    const hl = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, -dz) * 180 / Math.PI;          // 0 = к окнам (вверх на плане), по часовой
    const hfov = 2 * Math.atan(Math.tan(((c.fov || 60) * Math.PI) / 360) * (c.aspect || 1));
    const half = Math.min(1.1, hfov / 2);
    const len = CONE * Math.min(1, hl * 1.2);
    const m = 0.25;
    const out = x < vb.x + m || x > vb.x + vb.w - m || z < vb.y + m || z > vb.y + vb.h - m;
    x = Math.min(vb.x + vb.w - m, Math.max(vb.x + m, x));
    z = Math.min(vb.y + vb.h - m, Math.max(vb.y + m, z));
    const key = [x, z, yaw, len, half].map(v => v.toFixed(2)).join('|') + out;
    if (key === last && !force) return;
    last = key;
    cam.setAttribute('transform', `translate(${x.toFixed(3)} ${z.toFixed(3)}) rotate(${yaw.toFixed(2)})`);
    cam.classList.toggle('out', out);
    if (len < 0.25) cone.setAttribute('d', '');
    else {
      const s = (len * Math.sin(half)).toFixed(3), k = (-len * Math.cos(half)).toFixed(3);
      cone.setAttribute('d', `M0 0L${-s} ${k}A${len.toFixed(3)} ${len.toFixed(3)} 0 0 1 ${s} ${k}Z`);
    }
  }

  setCollapsed(startCollapsed);
  layoutLabels();
  update(true);
  return { update: () => update(false), el };
}

// Межкомнатная дверь на плане: полотно, открытое на 90°, и четверть дуги (как на чертеже).
function doorPath(o) {
  const X = o.along === 'x', W = o.width / 2, L = o.leaf ?? o.width - 0.1, jamb = (o.width - L) / 2;
  const cu = X ? (o.x0 + o.x1) / 2 : (o.z0 + o.z1) / 2, ct = X ? (o.z0 + o.z1) / 2 : (o.x0 + o.x1) / 2;
  const T = X ? o.z1 - o.z0 : o.x1 - o.x0, sw = o.swing ?? 1, start = o.hinge !== 'end';
  const hu = start ? -W + jamb : W - jamb, tu = start ? W - jamb : -W + jamb, face = sw * T / 2;
  const P = (u, t) => (X ? [cu + u, ct + t] : [ct + t, cu + u]).map(v => v.toFixed(3)).join(' ');
  // в осях (u, t): петля (hu, face), конец полотна (hu, face + sw·L), дуга до (tu, face)
  const tip = P(hu, face + sw * L), end = P(tu, face);
  // направление обхода дуги: считаем по знаку векторного произведения в экранных осях (x, z)
  const [hx, hz] = X ? [cu + hu, ct + face] : [ct + face, cu + hu];
  const [ax, az] = X ? [cu + hu, ct + face + sw * L] : [ct + face + sw * L, cu + hu];
  const [bx, bz] = X ? [cu + tu, ct + face] : [ct + face, cu + tu];
  const cross = (ax - hx) * (bz - hz) - (az - hz) * (bx - hx);
  return `M${P(hu, face)}L${tip}A${L} ${L} 0 0 ${cross > 0 ? 1 : 0} ${end}`;
}

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
