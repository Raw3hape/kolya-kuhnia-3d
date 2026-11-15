// Монитор в кабинете (комната 3, обстановка «Компьютер»: монитор 27″) показывает крипто-биржу «КОЛЯ·EX»: свечи и
// скользящие средние, объёмы, стакан, позиция с мигающим PnL, лента новостей. Цены — случайное блуждание с возвратом к
// «справедливой» цене; раз в 20–40 с на активной паре событие: обвал («−87 %, ВСЁ ПРОПАЛО»), полёт «TO THE MOON 🚀» или
// «Илон твитнул». Пары: BTC, ETH, DOGE и КОЛЯКОИН (его показывают чаще). Всё рисуется на 2D-холсте → CanvasTexture.
//
// Где экран: часть обстановки decor.js с моделью MODEL (её материал 'screen' без UV). Поверх него — своя плоскость
// (размер и место — по габариту меша экрана в координатах модели, +Z модели — к зрителю), дочка модели: растёт с ней и едет за
// перетаскиванием, пересборка обстановки — ищем заново. Плоскость и меш экрана помечены userData.screen (трещины).
// Материал: чёрный глянец + emissiveMap с холста; яркость делится на экспозицию кадра (как постер ТВ в tv.js),
// поэтому экран одинаково светится днём и вечером. В фото-режиме, PNG и GLB — последний нарисованный кадр.
//
// Цена кадра: холст перерисовывается FPS раз в секунду и только когда экран виден — в кадре, к нам лицом, ближе MAX_DIST
// и не за стеной (луч к стенам — только когда сдвинулась камера, не чаще раза в 0,25 с). Иначе update() возвращает false и
// ничего не делает: в другой комнате биржа «на паузе». Стартует после первого вида (afterRoom). Источников света нет.
//
// createTicker({ THREE, scene, camera, renderer, pipe, requestRender })
//   -> { update(dt) -> bool  (true — холст обновился, нужен кадр),
//        status              — что видно (для проверок из консоли): { started, screens, active, pair, price, fps },
//        event(kind)         — устроить событие сейчас: 'crash' | 'moon' | 'tweet' (проверка из консоли),
//        dispose() }
import { afterRoom } from './loading.js';
import { decorPart } from './decor.js';
import { addHelp } from './help.js';

addHelp({ mode: 'walk', keys: [], text: 'монитор в комнате 3 показывает крипто-биржу: подойдите — графики оживут (иногда КОЛЯКОИН улетает на Луну)', order: 76 });

const MODEL = 'models/decor/room3/monitor-27/model.glb';
const SCREEN_MAT = 'screen';
const FPS = 6;                 // кадров биржи в секунду
const MAX_DIST = 6.5;          // м: дальше экран не оживает
const W = 1280, H = 720;       // холст (экран 16:9)
const BRIGHT = 2.2;            // видимая яркость экрана (делится на экспозицию): как видео на ноутбуке рядом
const TICKS_PER_CANDLE = 7;    // свеча закрывается каждые ~1,2 с
const SHOW = 64;               // свечей в окне графика
const KEEP = 96;               // свечей в памяти

const C = {
  bg: '#0b0e11', panel: '#12161c', line: '#1f2630', grid: '#1a2029', text: '#c9d1d9', dim: '#6b7785',
  up: '#0ecb81', down: '#f6465d', gold: '#f0b90b', ma2: '#c084fc', white: '#eef2f6',
};
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = '"Inter", -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

const NEWS = [
  'СРОЧНО: Коля купил КОЛЯКОИН на все деньги',
  'Илон Маск поставил лайк фото кабана',
  'Бабушка вложила пенсию в DOGE и не жалеет',
  'Аналитики: «КОЛЯКОИН либо вырастет, либо нет»',
  'Кабан-шеф открыл шорт по гречке с плечом 100x',
  'Майнинг на вытяжке: +0,00001 BTC в год',
  'HODL — это стратегия, а не диагноз',
  'Сосед сверху продал квартиру и купил ETH на хаях',
  'ЦБ советует не смотреть на график после еды',
  'Кот прошёл по клавиатуре и закрыл сделку в плюс',
];
const BANNERS = {
  crash: () => ({ title: `−${[87, 87, 91, 69, 99][rnd(5)]}%`, sub: 'ВСЁ ПРОПАЛО 📉', color: C.down, ticks: 10, mult: 0.13 }),
  moon: () => ({ title: 'TO THE MOON 🚀', sub: `+${[420, 300, 690][rnd(3)]}%`, color: C.up, ticks: 16, mult: 5 }),
  tweet: () => ({ title: 'ИЛОН ТВИТНУЛ 🐗', sub: '+40% за минуту', color: C.gold, ticks: 5, mult: 1.4 }),
};

const rnd = n => Math.floor(Math.random() * n);
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const NF = {};
const fmt = (v, d) => (NF[d] ||= new Intl.NumberFormat('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })).format(v);
const digits = p => (p >= 1000 ? 1 : p >= 10 ? 2 : p >= 1 ? 3 : 4);
const pct = v => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v), 2)}%`;

// ---------- рынок ----------
function makePair(sym, quote, base, vol, weight) {
  const P = { sym, quote, base, fair: base, vol, weight, p: base, candles: [], tick: 0, mode: null, modeT: 0, drift: 0 };
  P.candles.push({ o: base, h: base, l: base, c: base, v: 0 });
  for (let i = 0; i < KEEP * TICKS_PER_CANDLE; i++) step(P);
  return P;
}
function step(P) {
  P.fair *= Math.exp(0.002 * gauss());
  let mu = -0.012 * Math.log(P.p / P.fair);   // обвал потихоньку отрастает, полёт — сдувается
  let sig = P.vol;
  if (P.mode) { mu = P.drift; sig *= 0.7; if (--P.modeT <= 0) P.mode = null; }
  P.p *= Math.exp(mu + sig * gauss());
  const k = P.candles[P.candles.length - 1];
  k.c = P.p; if (P.p > k.h) k.h = P.p; if (P.p < k.l) k.l = P.p;
  k.v += (0.4 + Math.random()) * (1 + Math.abs(mu) * 60);
  if (++P.tick % TICKS_PER_CANDLE === 0) {
    P.candles.push({ o: P.p, h: P.p, l: P.p, c: P.p, v: 0 });
    if (P.candles.length > KEEP) P.candles.shift();
  }
}

export function createTicker({ THREE, scene, camera, renderer, pipe, requestRender }) {
  const pairs = [
    makePair('BTC', 'USDT', 97412, 0.0022, 1),
    makePair('ETH', 'USDT', 3412, 0.0035, 1),
    makePair('DOGE', 'USDT', 0.4123, 0.007, 1),
    makePair('КОЛЯКОИН', 'USDT', 13.37, 0.012, 3),
  ];
  let active = pairs[3], switchIn = FPS * 20, eventIn = FPS * (14 + rnd(10)), banner = null, frameNo = 0;
  let pos = null, balance = 1337, liquidated = 0;
  const openPos = () => { pos = { side: Math.random() < 0.8 ? 'LONG' : 'SHORT', lev: [20, 50, 100][rnd(3)], entry: active.p, margin: Math.max(100, balance * 0.5) }; };
  openPos();
  let greed = 72, newsX = 0;
  const newsText = NEWS.join('   ·   ') + '   ·   ';
  let newsW = 0;

  // ---------- холст и материал ----------
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.5, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: BRIGHT });
  mat.name = 'ticker_screen';

  // ---------- экраны в сцене ----------
  let group = null, screens = [], started = false, lastScan = -1e9;
  afterRoom(() => { started = true; draw(); requestRender(); });
  function decorGroup() { for (const c of scene.children) if (c.name === 'decor') return c; return null; }
  function dropScreens() { for (const s of screens) { s.plane.removeFromParent(); s.plane.geometry.dispose(); } screens = []; }
  const _inv = new THREE.Matrix4(), _rel = new THREE.Matrix4(), _box = new THREE.Box3();
  // часть с монитором: найти меш экрана (модель грузится лениво) и положить поверх свою плоскость
  function attach(holder) {
    let mesh = null;
    holder.traverse(o => { if (!mesh && o.isMesh && o.material?.name === SCREEN_MAT) mesh = o; });
    if (!mesh) return null;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    // плоскость — дочка самой модели (верхний узел под частью), не части: модель после первого вида «вырастает»
    // из уменьшенной (decor.js GROW_FROM), и экран, посчитанный по части в этот момент, ушёл бы внутрь корпуса
    let top = mesh; while (top.parent && top.parent !== holder) top = top.parent;
    holder.updateWorldMatrix(true, true);
    _rel.multiplyMatrices(_inv.copy(top.matrixWorld).invert(), mesh.matrixWorld);
    _box.copy(mesh.geometry.boundingBox).applyMatrix4(_rel);
    const w = _box.max.x - _box.min.x, h = _box.max.y - _box.min.y;
    if (!(w > 0.05 && h > 0.05)) return null;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    plane.name = 'ticker_screen';
    plane.position.set((_box.min.x + _box.max.x) / 2, (_box.min.y + _box.max.y) / 2, _box.max.z + 0.0012);
    plane.castShadow = false; plane.receiveShadow = false;
    plane.userData.screen = true; mesh.userData.screen = true;
    top.add(plane);
    return { holder, plane, center: new THREE.Vector3(), normal: new THREE.Vector3(), radius: Math.hypot(w, h) / 2, dist: Infinity };
  }
  function scan(now) {
    const grp = decorGroup();
    if (grp !== group) { dropScreens(); group = grp; lastScan = -1e9; }
    if (!grp || now - lastScan < 1000) return;
    lastScan = now;
    for (const h of grp.children) {
      if (screens.some(s => s.holder === h)) continue;
      const i = decorPart(h);
      if (i && i.option.parts[i.index]?.model === MODEL) { const s = attach(h); if (s) { screens.push(s); draw(); requestRender(); } }
    }
    screens = screens.filter(s => { if (s.holder.parent === grp) return true; s.plane.geometry.dispose(); return false; });
  }

  // ---------- видимость ----------
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere(), camPos = new THREE.Vector3(), _v = new THREE.Vector3();
  const ray = new THREE.Raycaster(), hits = [];
  let occluders = null, seen = false, lastLook = -1e9;
  const lastCam = new Float64Array(16);
  function getOccluders() {
    if (occluders && occluders.length && occluders[0].parent && isAttached(occluders[0])) return occluders;
    occluders = [];
    for (const c of scene.children) if (c.name === 'apartment' || c.name === 'doors') c.traverse(o => { if (o.isMesh && o.userData.cutaway) occluders.push(o); });
    return occluders;
  }
  function isAttached(o) { while (o.parent) o = o.parent; return o === scene; }
  function visibleChain(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
  function look(now) {
    const e = camera.matrixWorld.elements;
    let same = now - lastLook < 1500;
    for (let i = 0; i < 16 && same; i++) same = e[i] === lastCam[i];
    if (same || now - lastLook < 250) return seen;
    lastCam.set(e); lastLook = now;
    camera.getWorldPosition(camPos);
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    seen = false;
    for (const s of screens) {
      if (!visibleChain(s.plane)) continue;
      s.plane.updateWorldMatrix(true, false);
      s.center.setFromMatrixPosition(s.plane.matrixWorld);
      s.normal.setFromMatrixColumn(s.plane.matrixWorld, 2).normalize();
      const d = s.dist = camPos.distanceTo(s.center);
      if (d > MAX_DIST || _v.subVectors(camPos, s.center).dot(s.normal) <= 0) continue;
      if (!frustum.intersectsSphere(sphere.set(s.center, s.radius))) continue;
      ray.layers.mask = camera.layers.mask;
      ray.set(camPos, _v.subVectors(s.center, camPos).divideScalar(d));
      ray.near = 0; ray.far = Math.max(0, d - 0.05);
      hits.length = 0;
      ray.intersectObjects(getOccluders(), false, hits);
      if (!hits.length) { seen = true; break; }
    }
    return seen;
  }

  // ---------- кадр ----------
  let acc = 0, lastExp = 0;
  function update(dt = 0) {
    const now = performance.now();
    scan(now);
    const exp = renderer.toneMappingExposure || 1;
    if (Math.abs(exp - lastExp) > 1e-3) { lastExp = exp; mat.emissiveIntensity = BRIGHT / exp; }
    if (!started || !screens.length || pipe?.photo) return false;
    if (!look(now)) { acc = 0; return false; }
    acc += dt;
    if (acc < 1 / FPS) return false;
    acc = Math.min(acc - 1 / FPS, 1 / FPS);
    tick();
    draw();
    return true;
  }

  function tick() {
    frameNo++;
    for (const P of pairs) step(P);
    if (--switchIn <= 0) {
      // КОЛЯКОИН показывают чаще
      const sum = pairs.reduce((a, P) => a + (P === active ? 0 : P.weight), 0);
      let r = Math.random() * sum;
      for (const P of pairs) { if (P === active) continue; r -= P.weight; if (r <= 0) { active = P; break; } }
      switchIn = FPS * (16 + rnd(10));
      if (!banner) openPos();
    }
    if (--eventIn <= 0) { event(Math.random() < 0.45 ? 'crash' : Math.random() < 0.7 ? 'moon' : 'tweet'); eventIn = FPS * (20 + rnd(20)); }
    if (banner && --banner.left <= 0) banner = null;
    // позиция: плечо съедает маржу — ликвидация и новая позиция
    const pnl = pnlOf();
    if (pnl <= -pos.margin) { balance = Math.max(50, balance - pos.margin); liquidated = FPS * 3; openPos(); }
    if (liquidated > 0) liquidated--;
    greed = Math.max(1, Math.min(99, greed + gauss() * 2 + (active.mode === 'moon' ? 4 : active.mode === 'crash' ? -6 : 0)));
    newsX += 26;
  }
  function pnlOf() { const r = active.p / pos.entry - 1; return pos.margin * pos.lev * (pos.side === 'LONG' ? r : -r); }
  function event(kind) {
    const b = (BANNERS[kind] || BANNERS.moon)();
    active.mode = kind; active.modeT = b.ticks; active.drift = Math.log(b.mult) / b.ticks;
    banner = { ...b, kind, left: FPS * 3.5, total: FPS * 3.5 };
    eventIn = Math.max(eventIn, FPS * 20);   // события не наслаиваются
    if (kind !== 'crash' && pos.side === 'SHORT') pos.side = 'LONG';
  }

  // ---------- рисование ----------
  function txt(s, x, y, color, font, align = 'left') { g.fillStyle = color; g.font = font; g.textAlign = align; g.fillText(s, x, y); }
  function draw() {
    if (!newsW) { g.font = `500 22px ${SANS}`; newsW = g.measureText(newsText).width; }
    g.textBaseline = 'middle';
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    header();
    chart(12, 56, 880, 528);
    book(904, 56, 364, 380);
    position(904, 446, 364, 138);
    footer();
    tex.needsUpdate = true;
  }
  function header() {
    g.fillStyle = C.panel; g.fillRect(0, 0, W, 46);
    txt('🐗 КОЛЯ·EX', 16, 23, C.gold, `800 22px ${SANS}`);
    let x = 170;
    for (const P of pairs) {
      const ch = (P.p / P.candles[0].o - 1) * 100, on = P === active;
      if (on) { g.fillStyle = C.line; g.fillRect(x - 10, 6, 236, 34); }
      txt(P.sym, x, 23, on ? C.white : C.dim, `700 17px ${SANS}`);
      g.font = `700 17px ${SANS}`; const w = g.measureText(P.sym).width;
      txt(fmt(P.p, digits(P.p)), x + w + 10, 23, C.text, `500 16px ${MONO}`);
      txt(pct(ch), x + 226, 23, ch >= 0 ? C.up : C.down, `600 14px ${MONO}`, 'right');
      x += 250;
    }
    const d = new Date();
    txt(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`, W - 14, 23, C.dim, `500 16px ${MONO}`, 'right');
  }
  function chart(x0, y0, w, h) {
    const P = active, ks = P.candles.slice(-SHOW), dg = digits(P.p);
    g.fillStyle = C.panel; g.fillRect(x0, y0, w, h);
    const first = ks[0].o, ch = (P.p / first - 1) * 100, col = ch >= 0 ? C.up : C.down;
    txt(`${P.sym}/${P.quote}`, x0 + 14, y0 + 24, C.white, `700 22px ${SANS}`);
    g.font = `700 22px ${SANS}`; let tx = x0 + 24 + g.measureText(`${P.sym}/${P.quote}`).width;
    txt(fmt(P.p, dg), tx, y0 + 24, col, `700 26px ${MONO}`);
    g.font = `700 26px ${MONO}`; tx += g.measureText(fmt(P.p, dg)).width + 14;
    txt(pct(ch), tx, y0 + 25, col, `600 18px ${MONO}`);
    txt('1м · MA 7 · MA 25', x0 + w - 70, y0 + 24, C.dim, `500 14px ${MONO}`, 'right');
    // область свечей и объёмов
    const cx0 = x0 + 10, cx1 = x0 + w - 78, cy0 = y0 + 52, cy1 = y0 + h - 104, vy0 = y0 + h - 94, vy1 = y0 + h - 12;
    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (const k of ks) { if (k.l < lo) lo = k.l; if (k.h > hi) hi = k.h; if (k.v > vmax) vmax = k.v; }
    const pad = (hi - lo) * 0.08 || hi * 0.01; lo -= pad; hi += pad;
    const Y = p => cy1 - ((p - lo) / (hi - lo)) * (cy1 - cy0);
    g.strokeStyle = C.grid; g.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const p = lo + ((hi - lo) * i) / 5, y = Math.round(Y(p)) + 0.5;
      g.beginPath(); g.moveTo(cx0, y); g.lineTo(cx1, y); g.stroke();
      txt(fmt(p, dg), cx1 + 8, y, C.dim, `500 13px ${MONO}`);
    }
    const cw = (cx1 - cx0) / SHOW, bw = Math.max(2, cw * 0.62);
    ks.forEach((k, i) => {
      const xc = cx0 + cw * (i + 0.5), up = k.c >= k.o;
      g.fillStyle = up ? C.up : C.down;
      g.fillRect(Math.round(xc) - 1, Y(k.h), 2, Math.max(1, Y(k.l) - Y(k.h)));
      const yt = Y(Math.max(k.o, k.c)), yb = Y(Math.min(k.o, k.c));
      g.fillRect(xc - bw / 2, yt, bw, Math.max(2, yb - yt));
      g.globalAlpha = 0.45;
      const vh = vmax ? (k.v / vmax) * (vy1 - vy0) : 0;
      g.fillRect(xc - bw / 2, vy1 - vh, bw, vh);
      g.globalAlpha = 1;
    });
    // скользящие средние по закрытиям
    const all = P.candles, off = all.length - ks.length;
    for (const [n, color] of [[7, C.gold], [25, C.ma2]]) {
      g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
      let started = false;
      for (let i = 0; i < ks.length; i++) {
        const j = off + i; if (j < n - 1) continue;
        let s = 0; for (let q = j - n + 1; q <= j; q++) s += all[q].c;
        const x = cx0 + cw * (i + 0.5), y = Y(s / n);
        if (started) g.lineTo(x, y); else { g.moveTo(x, y); started = true; }
      }
      g.stroke();
    }
    // текущая цена: пунктир и плашка на оси
    const yp = Math.round(Y(P.p)) + 0.5, last = ks[ks.length - 1], pc = last.c >= last.o ? C.up : C.down;
    g.strokeStyle = pc; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(cx0, yp); g.lineTo(cx1, yp); g.stroke(); g.setLineDash([]);
    g.fillStyle = pc; g.fillRect(cx1 + 2, yp - 12, 76, 24);
    txt(fmt(P.p, dg), cx1 + 6, yp + 1, '#0b0e11', `700 13px ${MONO}`);
    if (P === active && pos) {   // вход позиции
      const ye = Y(pos.entry);
      if (ye > cy0 && ye < cy1) { g.strokeStyle = C.gold; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(cx0, ye); g.lineTo(cx1, ye); g.stroke(); g.globalAlpha = 1;
        txt(`вход ${pos.side} ${pos.lev}x`, cx0 + 6, ye - 10, C.gold, `600 13px ${MONO}`); }
    }
    if (banner) bannerDraw(cx0, cy0, cx1, cy1);
  }
  function bannerDraw(x0, y0, x1, y1) {
    const b = banner, k = 1 - b.left / b.total, blink = frameNo % 2 === 0;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (b.kind === 'moon') {   // ракета летит по диагонали графика
      g.font = `64px ${SANS}`; g.textAlign = 'center';
      g.fillText('🚀', x0 + 60 + (x1 - x0 - 120) * k, y1 - 40 - (y1 - y0 - 80) * k);
    }
    if (b.kind === 'crash') { g.fillStyle = 'rgba(246,70,93,0.12)'; g.fillRect(x0, y0, x1 - x0, y1 - y0); }
    g.globalAlpha = blink ? 1 : 0.75;
    g.fillStyle = 'rgba(11,14,17,0.82)'; g.fillRect(mx - 300, my - 78, 600, 156);
    g.strokeStyle = b.color; g.lineWidth = 4; g.strokeRect(mx - 300, my - 78, 600, 156);
    txt(b.title, mx, my - 18, b.color, `900 ${b.title.length > 8 ? 56 : 84}px ${SANS}`, 'center');
    txt(b.sub, mx, my + 46, C.white, `800 30px ${SANS}`, 'center');
    g.globalAlpha = 1;
  }
  function book(x0, y0, w, h) {
    g.fillStyle = C.panel; g.fillRect(x0, y0, w, h);
    txt('Стакан', x0 + 14, y0 + 20, C.white, `700 17px ${SANS}`);
    txt('Цена', x0 + 14, y0 + 44, C.dim, `500 13px ${SANS}`);
    txt('Кол-во', x0 + w - 14, y0 + 44, C.dim, `500 13px ${SANS}`, 'right');
    const P = active, dg = digits(P.p), tickSz = P.p * 0.0004, rows = 7, rh = 20;
    const row = (i, price, side) => {
      const y = side === 'ask' ? y0 + 66 + (rows - 1 - i) * rh : y0 + 66 + rows * rh + 40 + i * rh;
      const q = Math.random() * (side === 'ask' ? 1.1 : 1) + 0.05 * (rows - i), col = side === 'ask' ? C.down : C.up;
      g.globalAlpha = 0.16; g.fillStyle = col; const bw = Math.min(1, q / 2.2) * (w - 28); g.fillRect(x0 + w - 14 - bw, y - rh / 2 + 1, bw, rh - 2); g.globalAlpha = 1;
      txt(fmt(price, dg), x0 + 14, y, col, `500 15px ${MONO}`);
      txt(fmt(q * (P.p > 1000 ? 1 : P.p > 10 ? 40 : 4000), 3), x0 + w - 14, y, C.text, `500 15px ${MONO}`, 'right');
    };
    for (let i = 0; i < rows; i++) row(i, P.p + tickSz * (i + 1 + Math.random() * 0.5), 'ask');
    const last = P.candles[P.candles.length - 1], col = last.c >= last.o ? C.up : C.down;
    txt(`${fmt(P.p, dg)} ${last.c >= last.o ? '↑' : '↓'}`, x0 + 14, y0 + 66 + rows * rh + 20, col, `700 22px ${MONO}`);
    for (let i = 0; i < rows; i++) row(i, P.p - tickSz * (i + 1 + Math.random() * 0.5), 'bid');
  }
  function position(x0, y0, w, h) {
    g.fillStyle = C.panel; g.fillRect(x0, y0, w, h);
    const pnl = pnlOf(), roe = (pnl / pos.margin) * 100, col = pnl >= 0 ? C.up : C.down, blink = frameNo % 3 !== 0;
    txt(`Позиция · ${active.sym} ${pos.side} ${pos.lev}x`, x0 + 14, y0 + 20, pos.side === 'LONG' ? C.up : C.down, `700 15px ${SANS}`);
    if (liquidated > 0) {
      txt('ЛИКВИДИРОВАН 💀', x0 + w / 2, y0 + 62, frameNo % 2 ? C.down : C.white, `900 28px ${SANS}`, 'center');
      txt('открываю новую, теперь точно', x0 + w / 2, y0 + 96, C.dim, `500 14px ${SANS}`, 'center');
    } else {
      g.globalAlpha = blink ? 1 : 0.35;
      txt(`${pnl >= 0 ? '+' : '−'}${fmt(Math.abs(pnl), 2)} $`, x0 + 14, y0 + 60, col, `800 30px ${MONO}`);
      g.globalAlpha = 1;
      txt(`ROE ${pct(roe)}`, x0 + 14, y0 + 94, col, `600 16px ${MONO}`);
      txt(roe > 200 ? 'ФИКСИРОВАТЬ? НЕТ, HODL' : roe < -50 ? 'ЭТО КОРРЕКЦИЯ' : 'ВСЁ ПО ПЛАНУ', x0 + w - 14, y0 + 94, C.dim, `600 13px ${SANS}`, 'right');
    }
    txt(`Баланс ${fmt(balance, 2)} $`, x0 + 14, y0 + 122, C.text, `500 14px ${MONO}`);
  }
  function footer() {
    const y0 = 592;
    g.fillStyle = C.panel; g.fillRect(12, y0, W - 24, 78);
    // кнопки
    g.fillStyle = C.up; g.fillRect(28, y0 + 16, 200, 46);
    txt('КУПИТЬ', 128, y0 + 40, '#0b0e11', `800 22px ${SANS}`, 'center');
    g.fillStyle = C.down; g.fillRect(244, y0 + 16, 200, 46);
    txt('ПРОДАТЬ', 344, y0 + 40, '#0b0e11', `800 22px ${SANS}`, 'center');
    // индекс жадности
    const gx = 480, gw = 420, gy = y0 + 46;
    txt(`Индекс страха и жадности: ${Math.round(greed)} — ${greed > 75 ? 'ЖАДНОСТЬ' : greed < 25 ? 'СТРАХ' : 'НЕЙТРАЛЬНО'}`, gx, y0 + 24, C.text, `600 16px ${SANS}`);
    const grd = g.createLinearGradient(gx, 0, gx + gw, 0);
    grd.addColorStop(0, C.down); grd.addColorStop(0.5, C.gold); grd.addColorStop(1, C.up);
    g.fillStyle = grd; g.fillRect(gx, gy, gw, 10);
    g.fillStyle = C.white; g.fillRect(gx + (gw * greed) / 100 - 2, gy - 5, 4, 20);
    txt(frameNo % 4 < 2 ? '● LIVE' : '○ LIVE', W - 28, y0 + 24, C.down, `700 15px ${MONO}`, 'right');
    txt(`сделок сегодня: ${fmt(4200 + frameNo * 3, 0)}`, W - 28, y0 + 52, C.dim, `500 14px ${MONO}`, 'right');
    // бегущая строка новостей
    g.fillStyle = '#000'; g.fillRect(0, 680, W, 40);
    g.fillStyle = C.gold; g.fillRect(0, 680, 124, 40);
    txt('НОВОСТИ', 62, 700, '#0b0e11', `800 18px ${SANS}`, 'center');
    g.save(); g.beginPath(); g.rect(124, 680, W - 124, 40); g.clip();
    const sx = 140 - (newsX % newsW);
    txt(newsText, sx, 700, C.white, `500 22px ${SANS}`); txt(newsText, sx + newsW, 700, C.white, `500 22px ${SANS}`);
    g.restore();
  }

  draw();   // первый кадр, чтобы экран не был чёрным до первого обновления

  return {
    update,
    event(kind) { event(kind); requestRender(); },
    get status() { return { started, screens: screens.length, active: seen, pair: active.sym, price: active.p, fps: FPS, mode: active.mode }; },
    dispose() { dropScreens(); tex.dispose(); mat.dispose(); },
  };
}
