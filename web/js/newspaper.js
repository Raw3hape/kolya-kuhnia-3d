// Газета с полочки над унитазом: взять (E или клик), читать от первого лица, листать полосы колесом, ↑/↓ или свайпом,
// ходить с ней по квартире и садиться (на унитаз — классика), вернуть на полку — Q. Ввод, прицел и «сесть с вещью в руке»
// — общий handheld.js (в руке одна вещь: взяли газету — телефон сам вернулся на остров и наоборот).
// Полку и стопку строит bath.js (spec/bath.json → papers), тексты газет — spec/newspaper.json (всё выдумано, без политики).
//
// Как это выглядит: газета — слой страницы поверх холста (как телефон в руке), держат две руки внизу кадра; пока идёте,
// она опускается, чтобы было видно дорогу, встали или сели — поднимается к глазам. Полоса листается с шорохом бумаги
// (WebAudio, без файлов). На полке верхняя газета показывает настоящую первую полосу (CanvasTexture на 'bath_paper_cover');
// пока газета в руке, её на полке нет; вернули — наверх ложится следующий выпуск.
// Ничего не грузится до первого вида: тексты — после него (afterRoom), картинка обложки рисуется тогда же.
//
// createNewspaper({ THREE, scene, camera, canvas, requestRender, getWalk, getVM, getSeats, getDoors })
//   -> { sync() — после каждого отрисованного кадра, held, pick(), drop(), status, dispose() }
import { createHandheld } from './handheld.js';
import { injectStyle } from './minimap.js';
import { addHelp } from './help.js';
import { afterRoom, retry } from './loading.js';

// подвал полосы на языке газеты (newspaper.json → lang: be | ru)
const FOOT = {
  be: { page: 'стар.', keys: 'колесо, ↑↓', next: 'далей', again: 'зноў з пачатку', back: 'на паліцу' },
  ru: { page: 'стр.', keys: 'колесо, ↑↓', next: 'дальше', again: 'снова с начала', back: 'на полку' },
};

addHelp(
  { mode: 'walk', topic: 'walk', keys: ['E'], text: 'взять газету с полочки над унитазом и почитать — с ней можно сесть на унитаз (прицел на него и E)', touch: 'кнопка «Взять газету», когда смотрите на полочку', order: 62 },
  { mode: 'paper', keys: ['колесо', '↑', '↓'], text: 'листать полосы', touch: 'свайп по газете — листать', brief: true, order: 10 },
  { mode: 'paper', keys: ['Q'], text: 'вернуть газету на полку (или E, когда прицел ни на что не наведён)', touch: 'кнопка «Положить»', brief: true, order: 20 },
  { mode: 'paper', keys: ['E'], text: 'с газетой можно ходить, открывать двери и садиться: прицел на унитаз, стул или диван и E; на ходу газета опускается', touch: 'кнопка «Сесть» под прицелом', order: 30 },
);

const PAGE_W = 600, PAGE_H = 800;   // полоса в CSS-пикселях макета; на экране масштабируется (--s)
const PAGE_W_NARROW = 420;          // на узком экране — уже, колонок две
const LOWER_AFTER = 120, RAISE_AFTER = 380;   // мс: опустить на ходу, поднять после остановки
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createNewspaper({ THREE, scene, camera, canvas, requestRender, getWalk, getVM, getSeats, getDoors }) {
  let papers = null, issue = 0, page = 0, held = false, leaving = null, remoteHeld = false;
  let pendingInteraction = null, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  afterRoom(() => retry(() => fetch('spec/newspaper.json').then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status)))))
    .then(j => { papers = (j?.papers ?? []).filter(p => p?.pages?.length); if (pendingInteraction) applyInteractionState(pendingInteraction); drawCover(); requestRender?.(); resolveReady(); })
    .catch(() => { papers = null; resolveReady(); }));

  // ---------- полка в сцене (bath.js) ----------
  let stack = null, top = null, cover = null;
  function find() {
    if (stack && stack.parent) return;
    stack = scene.getObjectByName('bath_papers_stack') ?? null;
    top = scene.getObjectByName('bath_paper_top') ?? null;
    cover = scene.getObjectByName('bath_paper_cover') ?? null;
  }

  // ---------- первая полоса на полке ----------
  let coverCanvas = null, coverTex = null;
  function drawCover() {
    find();
    const P = papers?.[issue % (papers?.length || 1)];
    if (!cover || !P) return;
    if (!coverCanvas) { coverCanvas = document.createElement('canvas'); coverCanvas.width = 1024; coverCanvas.height = 683; }
    const g = coverCanvas.getContext('2d'), W = coverCanvas.width, H = coverCanvas.height, pg = P.pages[0];
    g.fillStyle = '#ebe5d5'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#16140f'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    let fs = 104;
    do { g.font = `900 ${fs}px Georgia, "Times New Roman", serif`; fs -= 4; } while (g.measureText(P.title.toUpperCase()).width > W - 80 && fs > 40);
    g.fillText(P.title.toUpperCase(), W / 2, 118);
    g.font = 'italic 26px Georgia, serif'; g.fillText(P.tagline || '', W / 2, 158);
    g.fillRect(36, 176, W - 72, 5); g.fillRect(36, 186, W - 72, 1.5);
    g.font = '22px Georgia, serif'; g.textAlign = 'left'; g.fillText(`${P.issue || ''}`, 40, 214);
    g.textAlign = 'right'; g.fillText(`${P.date || ''}`, W - 40, 214);
    g.fillRect(36, 228, W - 72, 1.5);
    g.textAlign = 'left'; g.font = '700 50px Georgia, serif';
    const lines = wrap(g, pg.headline || '', W - 80);
    lines.slice(0, 2).forEach((l, i) => g.fillText(l, 40, 290 + i * 56));
    const y0 = 290 + Math.min(2, lines.length) * 56 - 10;
    // «фото» растром и строки текста
    const px = 40, py = y0, pw = 380, ph = H - y0 - 40;
    g.fillStyle = '#b9b3a4'; g.fillRect(px, py, pw, ph);
    g.fillStyle = '#8c8577';
    for (let y = py + 4; y < py + ph; y += 8) for (let x = px + ((y / 8) % 2 ? 4 : 0) + 4; x < px + pw; x += 8) {
      const r = 1.2 + 1.6 * Math.abs(Math.sin(x * 0.013 + y * 0.021));
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    if (pg.photo?.emoji) {
      g.save(); g.filter = 'grayscale(1) contrast(1.3)'; g.globalAlpha = 0.85; g.textAlign = 'center'; g.font = `${ph * 0.6}px serif`;
      g.fillText(pg.photo.emoji, px + pw / 2, py + ph * 0.75); g.restore();
    }
    g.fillStyle = '#5d5849';
    for (let c = 0; c < 2; c++) for (let y = py + 8; y < H - 40; y += 22) {
      const x = 450 + c * 280, w = 250 - ((y * 7 + c * 31) % 5 === 0 ? 90 : (y * 3) % 40);
      g.fillRect(x, y, w, 8);
    }
    if (!coverTex) {
      coverTex = new THREE.CanvasTexture(coverCanvas);
      coverTex.colorSpace = THREE.SRGBColorSpace; coverTex.anisotropy = 4;
      cover.material.map = coverTex; cover.material.color.set('#ffffff'); cover.material.needsUpdate = true;
    } else coverTex.needsUpdate = true;
    requestRender?.();
  }
  function wrap(g, text, max) {
    const out = []; let line = '';
    for (const w of String(text).split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (g.measureText(t).width > max && line) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
    return out;
  }

  // ---------- газета в руке (слой страницы) ----------
  injectStyle('knp-style', CSS);
  const root = document.createElement('div');
  root.className = 'knp'; root.hidden = true; root.setAttribute('aria-live', 'polite');
  const holdEl = document.createElement('div'); holdEl.className = 'knp-hold';
  const sheet = document.createElement('div'); sheet.className = 'knp-sheet';
  const pageEl = document.createElement('article'); pageEl.className = 'knp-page';
  sheet.appendChild(pageEl);
  holdEl.append(sheet, Object.assign(document.createElement('i'), { className: 'knp-hand l' }), Object.assign(document.createElement('i'), { className: 'knp-hand r' }));
  root.appendChild(holdEl);
  document.body.appendChild(root);

  let pw = PAGE_W, scale = 1;
  function layout() {
    const narrow = innerWidth < 720;
    pw = narrow ? PAGE_W_NARROW : PAGE_W;
    const ph = Math.round(pw * PAGE_H / PAGE_W);
    let left = 0, width = innerWidth;
    if (document.body.classList.contains('panel-open')) {   // открытая панель справа — газета по центру остального
      const r = document.getElementById('panel')?.getBoundingClientRect();
      if (r && r.left > innerWidth / 2) width = r.left;
    }
    // низ газеты — над полосой режима (ui.js пишет её высоту в --hud-bottom), верх — с небольшим полем
    const hb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-bottom')) || 64;
    scale = Math.min((innerHeight - hb - 24) / ph, (width * 0.94) / pw);
    root.classList.toggle('narrow', narrow);
    Object.assign(holdEl.style, { width: `${pw * scale}px`, height: `${ph * scale}px`, left: `${left + width / 2}px`, bottom: `${hb - 6}px` });
    Object.assign(sheet.style, { width: `${pw}px`, height: `${ph}px`, transform: `scale(${scale})` });
    fit();
  }

  function renderPage() {
    const P = papers?.[issue % papers.length];
    if (!P) return;
    page = (page + P.pages.length) % P.pages.length;
    const pg = P.pages[page], first = page === 0;
    const head = first
      ? `<header class="knp-mast"><h1>${esc(P.title)}</h1><p class="knp-tag">${esc(P.tagline)}</p>
         <p class="knp-line"><span>${esc(P.issue)}</span><span>${esc(P.date)}</span><span>${esc(P.price)}</span></p></header>`
      : `<header class="knp-run"><span>${esc(P.title)}</span><span>${esc(P.date)}</span></header>`;
    const photo = pg.photo ? `<figure class="knp-photo"><div><span>${esc(pg.photo.emoji)}</span></div><figcaption>${esc(pg.photo.caption)}</figcaption></figure>` : '';
    const ads = pg.ads ? `<aside class="knp-ads"><h4>${esc(pg.ads.h)}</h4>${pg.ads.items.map(t => `<p>${esc(t)}</p>`).join('')}</aside>` : '';
    const L = FOOT[P.lang] || FOOT.be;   // подвал на языке газеты
    pageEl.innerHTML = `${head}
      <div class="knp-sec">${esc(pg.section)}</div>
      <h2>${esc(pg.headline)}</h2>
      ${pg.lead ? `<p class="knp-lead">${esc(pg.lead)}</p>` : ''}
      <div class="knp-body">${photo}${(pg.articles || []).map(a => `<section><h3>${esc(a.h)}</h3><p>${esc(a.t)}</p></section>`).join('')}${ads}</div>
      <footer class="knp-foot"><span>${esc(P.title)}</span><span>${L.page} ${page + 1} / ${P.pages.length}</span><span class="knp-keys">${L.keys} — ${page + 1 < P.pages.length ? L.next : L.again} · Q — ${L.back}</span></footer>`;
    fit();
  }
  // шрифт полосы — самый крупный, при котором всё влезает (полосы разной длины, экраны разные): двоичный поиск 11–30 px
  function fit() {
    const body = pageEl.querySelector('.knp-body');
    if (!body) return;
    const set = v => pageEl.style.setProperty('--fs', `${v}px`);
    const fits = () => body.scrollHeight <= body.clientHeight + 1 && body.scrollWidth <= body.clientWidth + 1;
    let lo = 11, hi = 30;
    set(hi);
    if (fits()) return;
    for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; set(mid); if (fits()) lo = mid; else hi = mid; }
    set(lo);
  }

  // шорох бумаги: короткий шум через полосовой фильтр (без файлов)
  let ac = null, noise = null;
  function rustle() {
    try {
      ac ||= new (window.AudioContext || window.webkitAudioContext)();
      if (!noise) {
        noise = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / 90));
      }
      const t = ac.currentTime, src = ac.createBufferSource(), f = ac.createBiquadFilter(), gn = ac.createGain();
      src.buffer = noise; f.type = 'bandpass'; f.frequency.value = 2400 + Math.random() * 900; f.Q.value = 0.8;
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.16, t + 0.03); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      src.connect(f).connect(gn).connect(ac.destination); src.start(t); src.stop(t + 0.3);
    } catch { /* без звука */ }
  }

  function onHold(on) {
    find();
    leaving?.cancel(); leaving = null;
    if (on) {
      held = true; if (!itemNetwork) page = 0;
      if (top) top.visible = false;
      root.hidden = false; layout(); renderPage(); setLow(false, true);
      holdEl.animate([{ transform: 'translate(-50%, 70%) rotate(-4deg)', opacity: 0 }, { transform: 'translate(-50%, 0) rotate(0)', opacity: 1 }],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', composite: 'replace' });
      rustle();
      requestRender?.();
      return;
    }
    rustle();
    leaving = holdEl.animate([{ opacity: 1 }, { transform: 'translate(-50%, 80%) rotate(5deg)', opacity: 0 }], { duration: 220, easing: 'ease-in' });
    leaving.onfinish = () => {
      leaving = null; held = false; root.hidden = true;
      if (top) top.visible = !remoteHeld;
      if (!itemNetwork && papers?.length) { issue = (issue + 1) % papers.length; drawCover(); } // In a room the authority advances the returned stack.
      requestRender?.();
    };
  }
  let turning = null;
  function onStep(d) {
    if (!papers) return;
    const count = papers[issue]?.pages.length; if (!count) return;
    const next = (page + d + count) % count;
    if (itemNetwork) return itemNetwork.request?.({ kind: 'interaction', id: 'newspaper', value: { issue, page: next } });
    applyInteractionState({ issue, page: next });
  }
  function applyInteractionState(value) {
    if (!value || !Number.isInteger(value.issue) || !Number.isInteger(value.page) || value.issue < 0 || value.page < 0) return;
    if (!papers) { pendingInteraction = { issue: value.issue, page: value.page }; return; }
    const count = papers[value.issue]?.pages.length;
    if (!count || value.page >= count) return;
    pendingInteraction = null;
    if (issue === value.issue && page === value.page) return;
    const previous = page, issueChanged = issue !== value.issue;
    issue = value.issue; page = value.page;
    if (issueChanged) drawCover();
    turning?.cancel(); turning = null;
    if (!held || itemNetwork && !hand.held) { renderPage(); requestRender?.(); return; }
    const d = page >= previous ? 1 : -1;
    rustle();
    const out = pageEl.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${d > 0 ? -8 : 8}%) rotateY(${d > 0 ? 28 : -28}deg)`, opacity: 0 }],
      { duration: 130, easing: 'ease-in' });
    turning = out;
    out.onfinish = () => {
      renderPage();
      turning = pageEl.animate([{ transform: `translateX(${d > 0 ? 8 : -8}%) rotateY(${d > 0 ? -28 : 28}deg)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 190, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    };
  }

  // на ходу газета опущена (видно дорогу), стоя и сидя — у глаз
  let low = false, lastMove = 0, raiseTimer = 0;
  function setLow(v, now) {
    if (v === low && !now) return;
    low = v; root.classList.toggle('low', v);
  }
  function syncLow() {
    if (!held) return;
    const t = performance.now(), moving = !!getWalk?.()?.moving && !getSeats?.()?.active;
    if (moving) {
      if (!lastMove) lastMove = t;
      if (t - lastMove > LOWER_AFTER) setLow(true);
      clearTimeout(raiseTimer);
      raiseTimer = setTimeout(() => { lastMove = 0; setLow(false); }, RAISE_AFTER);
    }
  }

  const hand = createHandheld({ THREE, camera, canvas, requestRender, reach: 1.9, getWalk, getVM, getSeats, getDoors, networkId: 'newspaper',
    getTarget: () => { find(); return !remoteHeld && papers?.length && stack && top?.visible && !held ? stack : null; },
    getRect: () => sheet.getBoundingClientRect(),
    onHold, onStep, name: { take: 'взять газету', btn: 'Взять газету', scroll: 'листать', heldHint: false } });   // клавиши — в подвале газеты

  const onResize = () => { if (held) layout(); };
  addEventListener('resize', onResize);
  const panelWatch = new MutationObserver(() => { if (held) layout(); });
  panelWatch.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  function sync() {
    hand.sync();
    if (remoteHeld && top) top.visible = false;
    syncLow();
    if (cover && !coverTex && papers) drawCover();
  }

  function dispose() {
    hand.dispose(); clearTimeout(raiseTimer);
    removeEventListener('resize', onResize); panelWatch.disconnect();
    root.remove(); coverTex?.dispose();
    if (top) top.visible = true;
    ac?.close?.();
  }

  let itemNetwork = null;
  function setNetwork(adapter) {
    itemNetwork = adapter || null; remoteHeld = false;
    hand.setNetwork(adapter);
    if (top && !held) top.visible = true;
  }
  function applyNetwork(owner) {
    const id = owner && typeof owner === 'object' ? owner.owner ?? owner.ownerId ?? null : owner;
    const self = typeof itemNetwork?.selfId === 'function' ? itemNetwork.selfId() : itemNetwork?.selfId;
    remoteHeld = id != null && id !== self;
    hand.applyNetwork(id);
    if (top) top.visible = !remoteHeld && !held;
    requestRender?.();
  }
  const networkPosition = () => {
    find(); if (!stack) return null;
    // Bath meshes bake their shelf coordinates into the geometry; the stack's
    // Object3D origin is not the paper's physical position. Hidden shelf meshes
    // stay in place while the held newspaper is a separate DOM presentation.
    stack.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(stack, true);
    return box.isEmpty() ? null : box.getCenter(new THREE.Vector3()).toArray();
  };
  return { sync, dispose, ready, setNetwork, applyNetwork, networkPosition, applyInteractionState,
    snapshot: () => ({ issue, page }), interactionMeta: () => (papers || []).map(paper => paper.pages.length),
    pick: () => hand.pick(), drop: () => hand.drop(), get held() { return held; },
    get status() { return { held, issue: papers?.[issue % (papers?.length || 1)]?.id ?? null, page, low, papers: papers?.length ?? 0, onShelf: !!stack, cover: !!coverTex }; } };
}

const CSS = `
.knp { position: fixed; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; perspective: 1600px; }
.knp[hidden] { display: none; }
.knp-hold { position: absolute; bottom: 0; transform: translate(-50%, 0); transform-origin: 50% 100%;
  transition: translate 0.45s cubic-bezier(0.3, 0.7, 0.2, 1), rotate 0.45s; }
.knp.low .knp-hold { translate: 0 70%; rotate: x 18deg; }
.knp-sheet { position: absolute; left: 0; top: 0; transform-origin: 0 0; background:
    radial-gradient(120% 90% at 50% 40%, #f1ecdf 0%, #e7e0cd 70%, #d9d1bb 100%);
  box-shadow: 0 30px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.08); border-radius: 2px; overflow: hidden; }
.knp-sheet::after { content: ''; position: absolute; inset: 0; pointer-events: none;   /* сгиб посередине и тень от рук */
  background: linear-gradient(90deg, transparent 49.6%, rgba(0,0,0,0.10) 50%, rgba(255,255,255,0.25) 50.4%, transparent 51%),
              linear-gradient(0deg, rgba(0,0,0,0.12), transparent 18%); }
.knp-page { position: absolute; inset: 0; padding: 26px 30px 20px; display: flex; flex-direction: column; color: #1b1914;
  font: var(--fs, 15px)/1.38 Georgia, "Times New Roman", "PT Serif", serif; transform-origin: 0 50%; }
.knp-mast { text-align: center; border-bottom: 4px double #1b1914; padding-bottom: 6px; margin-bottom: 10px; }
.knp-mast h1 { margin: 0; font: 900 58px/1 Georgia, "Times New Roman", serif; letter-spacing: 0.02em; text-transform: uppercase; }
.knp.narrow .knp-mast h1 { font-size: 40px; }
.knp-tag { margin: 4px 0 6px; font-style: italic; font-size: 14px; }
.knp-line { display: flex; justify-content: space-between; margin: 0; padding-top: 4px; border-top: 1px solid #1b1914; font-size: 12px; }
.knp-run { display: flex; justify-content: space-between; border-bottom: 2px solid #1b1914; padding-bottom: 4px; margin-bottom: 12px;
  font: 700 12px/1 Georgia, serif; text-transform: uppercase; letter-spacing: 0.08em; }
.knp-sec { font: 700 11px/1 "Inter", Arial, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #8a1d14; margin-bottom: 4px; }
.knp-page h2 { margin: 0 0 6px; font: 800 31px/1.06 Georgia, "Times New Roman", serif; }
.knp.narrow .knp-page h2 { font-size: 24px; }
.knp-lead { margin: 0 0 10px; font-style: italic; font-size: 1.08em; }
.knp-body { flex: 1; min-height: 0; overflow: hidden; column-count: 3; column-gap: 18px; column-rule: 1px solid rgba(0,0,0,0.25); column-fill: balance; }
.knp.narrow .knp-body { column-count: 2; }
.knp-body section { margin: 0 0 10px; }                     /* заметка может перетечь в соседнюю колонку — колонки ровные */
.knp-photo, .knp-ads { break-inside: avoid; margin: 0 0 10px; }
.knp-body h3 { break-after: avoid; margin: 0 0 3px; font: 800 1.08em/1.15 Georgia, serif; }
.knp-body p { margin: 0; text-align: justify; hyphens: auto; }
.knp-photo div { aspect-ratio: 4 / 3; display: grid; place-items: center; overflow: hidden;
  background: radial-gradient(circle, #7d776a 1.2px, transparent 1.6px) 0 0 / 5px 5px, #b7b09f; }
.knp-photo span { font-size: 64px; filter: grayscale(1) contrast(1.4); opacity: 0.85; }
.knp-photo figcaption { font-size: 0.82em; font-style: italic; margin-top: 3px; }
.knp-ads { border: 2px solid #1b1914; padding: 6px 8px; }
.knp-ads h4 { margin: 0 0 4px; font: 800 0.9em/1 "Inter", Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.1em; }
.knp-ads p { margin: 0 0 5px; padding-bottom: 5px; border-bottom: 1px dashed rgba(0,0,0,0.35); font-size: 0.92em; }
.knp-ads p:last-child { border: 0; margin: 0; }
.knp-foot { display: flex; justify-content: space-between; border-top: 1px solid #1b1914; padding: 4px 13% 0; margin-top: 6px; gap: 10px;
  font: 11px/1 Georgia, serif; }
.knp-keys { font: 600 10.5px/1 "Inter", Arial, sans-serif; color: #8a1d14; }
.knp-hand { position: absolute; bottom: -7%; width: 15%; aspect-ratio: 1 / 1.25; border-radius: 46% 46% 40% 40%;
  background: radial-gradient(70% 60% at 45% 30%, #f1c7a3, #d79f78 70%, #b97f5a); box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
.knp-hand.l { left: -3%; rotate: 14deg; }
.knp-hand.r { right: -3%; rotate: -14deg; }
.knp-hand::before { content: ''; position: absolute; top: -18%; left: 30%; width: 34%; height: 46%; border-radius: 50%;
  background: radial-gradient(60% 60% at 50% 35%, #f3cbab, #d39a72); }   /* большой палец поверх газеты */
@media (prefers-reduced-motion: reduce) { .knp-hold { transition: none; } }
`;
