// «Живой дом»: квартира живёт сама и немного абсурдно. Ядро и настройки; сами эффекты — отдельные модули,
// они грузятся после первого вида (dynamic import), их модели — ещё позже, при первом использовании:
//   neighbours.js — соседи за стенами (штробят, долбят, пилят, ругаются) и звонок в дверь раз в три минуты;
//   landing.js    — за входной дверью площадка с мигающей лампой и монстры, которые не пускают дальше;
//   water.js      — кран на кухне, раковина и душ в ванной сами включаются и выключаются;
//   mice.js       — мыши бегают вдоль стен, нюхают и прячутся; в них можно стрелять (очки охоты, hunt.js addTargets).
//
// createLife({ THREE, scene, camera, renderer, pipe, plan, kit, shell, doorsGroup, requestRender,
//              getWalk, getDoors, getHunt, getObstacles })
//   getObstacles() -> [{ x0, x1, z0, z1 } …] мебель в плане (как у прогулки): мыши прячутся под неё
//   -> { update(dt) -> bool  (true — нужен кадр; в покое и вне кадра — false), colliders() -> препятствия прогулки
//        (монстры на площадке), dispose(), debug { mods, prefs, ring(), water(id), mouse(), audio } }
// registerLifeUI(addSection, getLife) — раздел «Живой дом» в настройках (шестерёнка).
//
// Правила (общие для модулей, держит ядро):
// - Звук только после первого жеста пользователя (правило браузеров) и только в прогулке, либо всегда, если так выбрано
//   в «Соседи и звонки». Тише — кнопка с динамиком в прогулке или M (настройка браузера). Синтез WebAudio, файлов нет.
// - В фото-режиме (трассировка), на снимке PNG и при выключенном «Живом доме» эффектов нет (live = false).
// - Кадры: модуль просит кадр, только пока его эффект виден (seen(): в кадре камеры, близко и не за стеной).
// - Число источников света three не меняется: мигающая лампа площадки — «светильник шейдера» (lighting.js, слой 3).
// Настройки — localStorage 'kitchen-life-v1' { life, sound: 'walk' | 'always' | 'off', mute, bellSeen }, в код варианта не входят.
import { addHelp } from './help.js';
import { afterRoom, assetUrl, track, retry } from './loading.js';
import { NOTICE } from './render.js';
import { injectStyle } from './minimap.js';
import { raycastExternalTargets } from './hunt.js';
import { WEAPON_RULES } from './multiplayer/rules.js';

const PREF = 'kitchen-life-v1';
const DEF = { life: true, sound: 'walk', mute: false, bellSeen: false };
const prefs = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { ...DEF }; } })();
function savePrefs() { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch { /* хранилище недоступно */ } }
const listeners = new Set();   // смена настроек -> живой экземпляр
function setPref(k, v) { if (prefs[k] === v) return; prefs[k] = v; savePrefs(); for (const f of listeners) f(k, v); }

addHelp(
  { mode: 'walk', topic: 'life', keys: ['M'], text: 'тише: соседи и звуки дома (или кнопка с динамиком)', touch: 'кнопка с динамиком сверху — тише', order: 85 },
  { mode: 'walk', topic: 'life', text: 'в дверь звонят — открой, если не боишься', order: 86 },
  { mode: 'walk', topic: 'life', text: 'вдоль стен бегают мыши: попадание — очки охоты', order: 87 },
  { mode: 'walk', topic: 'life', text: 'вода иногда включается сама. Это не протечка, это дом живой', order: 88 },
);

export function registerLifeUI(addSection, getLife) {
  addSection({
    id: 'life', tab: 'settings', title: 'Живой дом', order: 30, open: true,
    summary: () => [prefs.life ? 'мыши, вода, гости' : null, prefs.sound === 'off' ? null : 'соседи'].filter(Boolean).join(' · ') || 'выключен',
    controls: [
      { type: 'toggle', key: 'lifeOn', label: 'Мыши, вода сама, гости за дверью', get: () => prefs.life, set: v => setPref('life', !!v) },
      { type: 'seg', key: 'lifeSound', label: 'Соседи и звонки', get: () => prefs.sound, set: v => setPref('sound', v),
        options: [{ id: 'walk', name: 'В прогулке' }, { id: 'always', name: 'Всегда' }, { id: 'off', name: 'Нет' }] },
      { type: 'readout', key: 'lifeHint', style: 'hint',
        value: () => 'Звук начинается после первого клика или клавиши. Вода и мыши звучат по тому же правилу. Запоминается в этом браузере.' },
      { type: 'help', topic: 'life' },
    ],
  });
}

const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function createLife({ THREE, scene, camera, renderer, pipe, plan, kit, shell, doorsGroup, requestRender,
  getWalk, getDoors, getHunt, getObstacles }) {
  const mods = {};
  let started = false, disposed = false, capturing = false, live = false, frameNo = 0;
  let network = null, networkSnapshot = null, entryVisitor = false;
  const externalPending = new Map();

  // ---------- звук ----------
  let gestured = false, ctx = null, master = null, buses = null, noiseBuf = null, quietSince = 0;
  const walkOn = () => !!getWalk?.()?.active;
  const soundOk = () => gestured && !prefs.mute && !pipe?.photo && !capturing && (walkOn() || prefs.sound === 'always');
  const neighOk = () => soundOk() && prefs.sound !== 'off';
  function ensureAudio() {
    if (ctx || !gestured || disposed) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'playback' }); } catch { return null; }
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    buses = { neigh: ctx.createGain(), fx: ctx.createGain() };
    for (const b of Object.values(buses)) { b.gain.value = 0; b.connect(master); }
    const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    return ctx;
  }
  function onGesture(e) {
    if (e.type === 'keydown' && typing(e.target)) return;
    gestured = true;
    if (soundOk()) { ensureAudio(); if (ctx?.state === 'suspended') ctx.resume().catch(() => {}); }
  }
  for (const t of ['pointerdown', 'keydown', 'touchend']) addEventListener(t, onGesture, { capture: true, passive: true });

  const lp = new THREE.Vector3(), lf = new THREE.Vector3(), lu = new THREE.Vector3();
  function setParam(p, v, t) { if (p) p.setTargetAtTime(v, t, 0.05); }
  function syncAudio() {
    const ok = soundOk(), nOk = neighOk();
    if (ok && !ctx) ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    setParam(master.gain, ok ? 1 : 0, t);
    setParam(buses.neigh.gain, nOk ? 1 : 0, t);
    setParam(buses.fx.gain, ok && live ? 1 : 0, t);
    const now = performance.now();
    if (ok) {
      quietSince = 0;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      // слушатель — камера
      const L = ctx.listener;
      camera.getWorldPosition(lp); lf.set(0, 0, -1).applyQuaternion(camera.quaternion); lu.set(0, 1, 0).applyQuaternion(camera.quaternion);
      if (L.positionX) {
        L.positionX.value = lp.x; L.positionY.value = lp.y; L.positionZ.value = lp.z;
        L.forwardX.value = lf.x; L.forwardY.value = lf.y; L.forwardZ.value = lf.z; L.upX.value = lu.x; L.upY.value = lu.y; L.upZ.value = lu.z;
      } else { L.setPosition(lp.x, lp.y, lp.z); L.setOrientation(lf.x, lf.y, lf.z, lu.x, lu.y, lu.z); }
    } else if (ctx.state === 'running') {
      // долго тихо — усыпить звук (поток не крутится зря)
      if (!quietSince) quietSince = now;
      else if (now - quietSince > 15000) ctx.suspend().catch(() => {});
    }
  }
  // Источник в точке (x, y, z): панорама по направлению и спад с расстоянием; bus 'neigh' | 'fx'
  function panner(x, y, z, { bus = 'fx', ref = 1.5, rolloff = 1, max = 40 } = {}) {
    if (!ctx) return null;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = max;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    p.connect(buses[bus]);
    return p;
  }
  function noise(loop = true) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = loop;
    s.loopStart = Math.random(); s.loopEnd = s.loopStart + 0.9;
    return s;
  }

  // ---------- видно ли точку ----------
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere(), los = new THREE.Raycaster();
  let frustumAt = -1, occluders = null;
  const tv = new THREE.Vector3(), td = new THREE.Vector3();
  function occl() {
    if (occluders) return occluders;
    occluders = [...(shell?.walls || [])];
    doorsGroup?.traverse(o => { if (o.isMesh && !o.userData.glass) occluders.push(o); });
    return occluders;
  }
  // В кадре, ближе max и не за стеной (стены, спрятанные вырезом, не мешают: они на слое 1)
  function seen(x, y, z, r = 0.3, max = 14) {
    if (frustumAt !== frameNo) {
      frustumAt = frameNo;
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    camera.getWorldPosition(tv);
    const d = tv.distanceTo(td.set(x, y, z));
    if (d > max || !frustum.intersectsSphere(sph.set(td, r))) return false;
    if (d < r + 0.3) return true;
    los.set(tv, td.sub(tv).divideScalar(d)); los.near = 0; los.far = Math.max(0, d - r);
    return los.intersectObjects(occl(), false).length === 0;
  }

  // ---------- модели (лениво, со сжатием meshopt, как decor.js) ----------
  let loaderP = null;
  function loadGLB(path) {
    loaderP ??= Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js'),
      import('three/addons/utils/SkeletonUtils.js')])
      .then(([{ GLTFLoader }, { MeshoptDecoder }, SU]) => { const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); return { l, SU }; });
    return loaderP.then(({ l, SU }) => track(retry(() => l.loadAsync(assetUrl(path))), { later: true }).then(g => ({ ...g, clone: SU.clone })));
  }
  // Шейдеры новых вещей собрать заранее, пока их не видно (иначе первый кадр с ними замирает)
  async function warm(obj) {
    const saved = [];
    obj.traverse(o => { if (o.isMesh) { saved.push([o, o.layers.mask]); o.layers.set(5); } });
    scene.add(obj);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));   // lighting.js подменит шейдеры материалов
    try { await renderer.compileAsync?.(obj, camera, scene); } catch { /* соберутся при первом кадре */ }
    for (const [o, m] of saved) o.layers.mask = m;
  }

  // ---------- кнопка «тише» в прогулке ----------
  injectStyle('klife-style', LIFE_CSS);
  const muteBtn = document.createElement('button');
  muteBtn.type = 'button'; muteBtn.className = 'klife-mute kw-float'; muteBtn.hidden = true;
  document.body.append(muteBtn);
  const ICON_ON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  let btnState = '';
  function syncButton() {
    const show = walkOn() && !pipe?.photo && (prefs.life || prefs.sound !== 'off');
    const st = `${show}|${prefs.mute}`;
    if (st === btnState) return;
    btnState = st;
    muteBtn.hidden = !show;
    muteBtn.innerHTML = prefs.mute ? ICON_OFF : ICON_ON;
    muteBtn.classList.toggle('off', prefs.mute);
    const label = prefs.mute ? 'Вернуть звуки дома (M)' : 'Тише: соседи и звуки дома (M)';
    muteBtn.title = label; muteBtn.setAttribute('aria-label', label); muteBtn.setAttribute('aria-pressed', String(!!prefs.mute));
  }
  const toggleMute = () => { setPref('mute', !prefs.mute); gestured = true; syncButton(); syncAudio(); };
  muteBtn.addEventListener('click', toggleMute);
  const onKey = e => {
    if (e.code !== 'KeyM' || e.repeat || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || !walkOn()) return;
    toggleMute(); e.preventDefault();
  };
  addEventListener('keydown', onKey);

  const notice = (msg, ms = 5000) => dispatchEvent(new CustomEvent(NOTICE, { detail: { msg, action: null, ms } }));

  // ---------- ядро для модулей ----------
  const core = {
    THREE, scene, camera, renderer, pipe, plan, kit, requestRender, prefs, setPref,
    get walk() { return getWalk?.() ?? null; },
    get doors() { return getDoors?.() ?? null; },
    get hunt() { return getHunt?.() ?? null; },
    get live() { return live; },
    get frame() { return frameNo; },
    obstacles: () => { try { return getObstacles?.() || []; } catch { return []; } },
    audio: {
      get ctx() { return ctx; },
      get ok() { return soundOk() && !!ctx; },          // эффекты (вода, мыши, монстры)
      get neighOk() { return neighOk() && !!ctx; },     // соседи и звонок
      get gestured() { return gestured; },
      panner, noise,
    },
    seen, loadGLB, warm, notice,
  };

  const offLive = pipe?.onLive?.(l => { capturing = !l; syncLive(); });
  function syncLive() {
    const desired = network && !network.authority ? !!networkSnapshot?.live : prefs.life;
    const l = desired && !pipe?.photo && !capturing;
    if (l === live) return;
    live = l;
    for (const m of Object.values(mods)) m.setLive?.(live);
    requestRender?.();
  }
  const onPref = k => { if (k === 'life') syncLive(); syncButton(); syncAudio(); };
  listeners.add(onPref);

  // Модули готовятся под заставкой после первого кадра; ready покрывает всю инициализацию.
  const ready = afterRoom(async () => {
    if (disposed) return;
    const list = [['neighbours', import('./neighbours.js')], ['landing', import('./landing.js')],
      ['water', import('./water.js')], ['mice', import('./mice.js')]];
    for (const [id, p] of list) {
      try {
        const m = await p; if (disposed) return; mods[id] = m.create(core);
        mods[id].setNetwork?.(network);
        if (id === 'landing') mods[id].setVisitor?.(entryVisitor);
        if (networkSnapshot?.modules?.[id]) mods[id].applyNetworkSnapshot?.(networkSnapshot.modules[id]);
      } catch (e) { console.warn('life:', id, e); throw e; }
    }
    started = true;
    syncLive();
    for (const m of Object.values(mods)) m.setLive?.(live);
    if (networkSnapshot) applyNetworkSnapshot(networkSnapshot);
  });

  function update(dt = 0) {
    frameNo++;
    syncButton();
    if (!started) return false;
    syncLive();
    syncAudio();
    let need = false;
    for (const m of Object.values(mods)) if (m.update?.(dt)) need = true;
    return need;
  }

  function colliders() {
    if (!started) return [];
    const out = [];
    for (const m of Object.values(mods)) { const c = m.colliders?.(); if (c) out.push(...c); }
    return out;
  }

  function dispose() {
    externalPending.clear();
    disposed = true;
    for (const t of ['pointerdown', 'keydown', 'touchend']) removeEventListener(t, onGesture, { capture: true });
    removeEventListener('keydown', onKey);
    listeners.delete(onPref);
    offLive?.();
    for (const m of Object.values(mods)) m.dispose?.();
    muteBtn.remove();
    ctx?.close?.().catch(() => {});
  }

  function setNetwork(value) {
    const next = value || null;
    if (network?.authority === next?.authority && !!network === !!next) return;
    network = next; externalPending.clear();
    if (!network) networkSnapshot = null;
    for (const m of Object.values(mods)) m.setNetwork?.(network);
    syncLive();
  }
  function snapshot() {
    return { live, collision: colliders(), modules: Object.fromEntries(Object.entries(mods).filter(([, m]) => m.snapshot).map(([id, m]) => [id, m.snapshot()])) };
  }
  function applyNetworkSnapshot(value) {
    if (!value || !network || network.authority) return;
    networkSnapshot = value; syncLive();
    for (const [id, state] of Object.entries(value.modules ?? {})) mods[id]?.applyNetworkSnapshot?.(state);
    requestRender?.();
  }
  const externalRay = new THREE.Raycaster(); externalRay.near = 0.02;
  function traceExternalShot(shot) {
    const rays = shot?.rays ?? [];
    if (!network?.authority || !WEAPON_RULES[shot.weapon]?.range) return rays.map(() => null);
    const range = WEAPON_RULES[shot.weapon].range;
    const targets = rays.slice(0, 9).map(ray => {
      externalRay.set(new THREE.Vector3(...shot.origin), new THREE.Vector3(...ray.direction).normalize()); externalRay.far = range;
      return raycastExternalTargets(externalRay);
    });
    if (shot.shotId) {
      externalPending.set(shot.shotId, targets);
      while (externalPending.size > 128) externalPending.delete(externalPending.keys().next().value);
    }
    return targets.map(hit => hit?.animalId ? { animalId: hit.animalId, species: hit.animal,
      distance: hit.distance, point: hit.point.toArray(), normal: hit.normal.toArray(), running: !!hit.running } : null);
  }
  function resolveExternalShot(shot) {
    if (!network?.authority) return [];
    const pending = externalPending.get(shot.shotId) ?? [];
    externalPending.delete(shot.shotId);
    const results = [];
    for (let i = 0; i < (shot.rays?.length ?? 0); i++) {
      const candidate = shot.rays[i].externalHit, target = pending[i];
      if (!candidate || !target || target.animalId !== candidate.animalId) continue;
      const result = target.hit?.(shot.weapon, WEAPON_RULES[shot.weapon]?.damage);
      if (!result) continue;
      results.push({ animalId: candidate.animalId, species: candidate.species, running: candidate.running,
        point: candidate.point, normal: candidate.normal, zone: 'body', ...result });
    }
    return results;
  }
  return {
    ready,
    get muted() { return !!prefs.mute; },
    update, colliders, dispose, setNetwork, snapshot, networkSnapshot: snapshot, applyNetworkSnapshot, traceExternalShot, resolveExternalShot,
    setEntryVisitor(on) { entryVisitor = !!on; mods.landing?.setVisitor?.(entryVisitor); },
    setShowerControlled(on) { mods.water?.setShowerControlled(on); },
    get debug() { return { mods, prefs, core, ring: () => mods.neighbours?.ring(), water: id => mods.water?.start(id), mouse: () => mods.mice?.spawn(true) }; },
  };
}

// Токены --kw-* даёт .kw-float (minimap.js). Кнопка — слева от табло охоты (справа сверху).
const LIFE_CSS = `
.klife-mute { position: fixed; z-index: 5; top: calc(64px + env(safe-area-inset-top, 0px)); right: calc(max(14px, env(safe-area-inset-right, 0px)) + 204px);
  width: 36px; height: 36px; padding: 0; display: grid; place-items: center; cursor: pointer; border-radius: 50%;
  border: 1px solid var(--kw-line); background: var(--kw-sheet); color: var(--kw-ink); box-shadow: var(--kw-shadow);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); touch-action: manipulation; }
.klife-mute.off { color: var(--kw-muted); }
.klife-mute:focus-visible { outline: 2px solid var(--kw-accent); outline-offset: 2px; }
.klife-mute[hidden] { display: none; }
body.panel-open .klife-mute { top: calc(14px + env(safe-area-inset-top, 0px)); right: calc(var(--panel-w, 376px) + 28px + 204px); }
@media (max-width: 760px) {
  .klife-mute, body.panel-open .klife-mute { top: var(--kw-dock-top, calc(120px + env(safe-area-inset-top, 0px))); right: calc(max(14px, env(safe-area-inset-right, 0px)) + 176px); }
  body:has(#panel.open) .klife-mute { display: none; }
}
`;
