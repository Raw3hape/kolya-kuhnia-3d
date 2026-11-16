// Вытяжка над варкой: в прогулке навести прицел ближе REACH и нажать E (или кликнуть без оружия; на телефоне — кнопка
// под прицелом): выкл. → скорость 1 → 2 → 3 → выкл. Горит LED-полоса снизу, на варке мягкое пятно света, на стекле
// загораются точки сенсора, гудит мотор (WebAudio-синтез: шум + низкий тон, громче на высокой скорости и ближе к вытяжке).
// Геометрию строит model.js (buildHood, группа 'hood' внутри группы 'kitchen'; размеры — kitchen.json → hood), материалы —
// общие на сеанс (hoodMaterials): пересборка кухни не сбрасывает включённую вытяжку. Источников света three не добавляет
// (см. шапку lamps.js): полоса — светящийся материал, пятно — растровая подсказка (в фото, PNG и GLB его нет).
// Состояние — настройка сеанса, в код варианта не входит.
//
// createHood({ THREE, scene, camera, canvas, renderer, pipe, requestRender, getWalk, getVM })
//   -> { update(dt) -> bool  (true — нужен кадр: сменилась яркость под экспозицию), level (0–3), setLevel(n), toggle(),
//        target — вытяжка под прицелом (bool), dispose() }
import { hoodMaterials } from './model.js';
import { addHelp } from './help.js';

addHelp({ mode: 'walk', topic: 'walk', keys: ['E'], text: 'вытяжка над варкой под прицелом: включить, скорость 1–3, выключить (или клик без оружия)', touch: 'кнопка под прицелом — вытяжка', order: 52 });

const REACH = 2.4;        // м: прицел достаёт до вытяжки
const LED = 1.6;          // видимая яркость полосы (делится на экспозицию кадра)
const POOL = [0, 0.13, 0.17, 0.22];   // яркость пятна на варке по скоростям
const VOL = [0, 0.05, 0.08, 0.12];    // громкость гула по скоростям
const LABEL = ['включить вытяжку', 'вытяжка: скорость 2', 'вытяжка: скорость 3', 'выключить вытяжку'];
const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const coarse = () => { try { return matchMedia('(hover: none), (pointer: coarse)').matches; } catch { return false; } };

export function createHood({ THREE, scene, camera, canvas, renderer, pipe, requestRender, getWalk, getVM }) {
  const HM = hoodMaterials();
  let group = null, meshes = [], level = 0, target = false, capturing = false;
  let network = null, pending = false, networkGeneration = 0;
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();

  function find() {
    if (group?.parent?.parent === scene) return group;
    group = null; meshes = [];
    const k = scene.children.find(c => c.name === 'kitchen');
    const h = k?.children.find(c => c.name === 'hood');
    if (!h) return null;
    group = h;
    h.traverse(o => { if (o.isMesh && !o.userData.hoodPool) meshes.push(o); });
    apply();
    return group;
  }
  // точки, пятно и полоса — по текущей скорости
  let lastExp = 0;
  function apply() {
    const exp = renderer.toneMappingExposure || 1;
    lastExp = exp;
    HM.led.emissiveIntensity = level ? (LED * (0.75 + level * 0.12)) / exp : 0;
    HM.pool.color.setScalar(POOL[level] / exp);
    if (!group) return;
    group.traverse(o => {
      if (o.userData.hoodDot != null) o.material = level && o.userData.hoodDot <= level ? HM.dotOn : HM.dotOff;
      if (o.userData.hoodPool) o.visible = level > 0 && !pipe?.photo && !capturing;
    });
  }
  function setLevel(n, { authoritative = false } = {}) {
    if (!Number.isFinite(n)) return false;
    const next = ((Math.trunc(n) % 4) + 4) % 4;
    if (network && !authoritative) {
      if (pending) return false;
      const generation = networkGeneration;
      pending = true; renderHint();
      return Promise.resolve(network.request?.({ kind: 'interaction', id: 'hood', value: { level: next }, expectedLevel: level }))
        .then(result => !!result?.ok).catch(() => false)
        .finally(() => { if (generation === networkGeneration) { pending = false; renderHint(); } });
    }
    if (level === next) return true;
    level = next;
    find(); apply(); sound(); renderHint(); requestRender();
    return true;
  }
  const toggle = () => setLevel(level + 1);

  // ---------- гул ----------
  let ctx = null, master = null, lp = null, osc = null;
  function sound() {
    if (!ctx && level) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }   // бурый шум
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
      osc = ctx.createOscillator(); osc.type = 'triangle';
      const og = ctx.createGain(); og.gain.value = 0.18;
      master = ctx.createGain(); master.gain.value = 0;
      src.connect(lp); lp.connect(master); osc.connect(og); og.connect(master); master.connect(ctx.destination);
      src.start(); osc.start();
    }
    if (!ctx) return;
    if (level && ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    lp.frequency.setTargetAtTime(260 + level * 260, t, 0.3);
    osc.frequency.setTargetAtTime(72 + level * 18, t, 0.4);
    gain(true);
    if (!level) setTimeout(() => { if (!level && ctx.state === 'running') ctx.suspend(); }, 900);
  }
  let lastGain = -1;
  function gain(force) {
    if (!ctx || !master) return;
    let g = 0;
    if (level && find()) {
      _p.copy(group.userData.hood.center);
      const d = camera.getWorldPosition(_v).distanceTo(_p);
      g = VOL[level] / (1 + Math.max(0, d - 0.8) * 0.9);
    }
    if (!force && Math.abs(g - lastGain) < 0.002) return;
    lastGain = g;
    master.gain.setTargetAtTime(g, ctx.currentTime, force ? 0.25 : 0.1);
  }

  // ---------- прицел и подсказка (стили — у doors.js: .kd-hint, .kd-btn) ----------
  const hint = document.createElement('div');
  hint.className = 'kd-hint kw-float'; hint.hidden = true; hint.setAttribute('role', 'status');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'kd-btn kw-float'; btn.hidden = true;
  document.body.append(hint, btn);
  let touchSeen = false;
  const walking = () => !!getWalk?.()?.walking;
  function renderHint() {
    const on = walking() && target, touch = touchSeen || coarse();
    if (on) document.body.classList.add('kd-aim');   // подсветка прицела, как у двери (снимаем ниже, в aim)
    hint.hidden = !on || touch;
    btn.hidden = !on || !touch;
    btn.disabled = pending;
    if (on) { hint.innerHTML = `<kbd>E</kbd> — ${LABEL[level]}`; btn.textContent = level === 3 ? 'Выключить' : level ? `Скорость ${level + 1}` : 'Вытяжка'; }
  }
  const ray = new THREE.Raycaster(); ray.layers.enableAll(); ray.far = REACH;
  const lastCam = new Float64Array(16);
  function aim() {
    const was = target;
    target = false;
    if (walking() && find() && meshes.length) {
      camera.getWorldPosition(_v);
      if (_v.distanceTo(group.userData.hood.center) < REACH + 0.5) {
        camera.getWorldDirection(_d);
        ray.set(_v, _d);
        target = ray.intersectObjects(meshes, false).length > 0;
      }
    }
    if (target !== was) {
      renderHint();
      if (!target && was) document.body.classList.remove('kd-aim');
    }
  }

  // ---------- ввод ----------
  const armed = () => !!getVM?.()?.armed;
  const onKey = e => {
    if (e.code !== 'KeyE' || e.repeat || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || !walking() || !target) return;
    toggle(); e.preventDefault();
  };
  let down = null;
  const onDown = e => {
    if (e.pointerType === 'touch') { touchSeen = true; renderHint(); return; }
    if (!walking() || e.button !== 0 || armed()) return;
    if (document.pointerLockElement === canvas) { if (target) toggle(); return; }
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onUp = e => {
    if (!down || e.pointerId !== down.id) return;
    const d = down; down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && performance.now() - d.t < 500 && target) toggle();
  };
  const onBtn = e => { e.preventDefault(); if (target) toggle(); };
  addEventListener('keydown', onKey);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  btn.addEventListener('click', onBtn);
  const offLive = pipe?.onLive?.(live => { capturing = !live; apply(); });

  // ---------- кадр ----------
  let wasPhoto = false;
  function update() {
    const e = camera.matrixWorld.elements;
    let same = true;
    for (let i = 0; i < 16 && same; i++) same = e[i] === lastCam[i];
    if (!same) { lastCam.set(e); aim(); if (level) gain(false); }
    else if (target && !walking()) aim();
    if (!level) return false;
    const photo = !!pipe?.photo;
    const exp = renderer.toneMappingExposure || 1;
    if (photo !== wasPhoto || Math.abs(exp - lastExp) > lastExp * 0.02 || group?.parent?.parent !== scene) {
      wasPhoto = photo; find(); apply();
      return !photo;
    }
    return false;
  }

  function dispose() {
    removeEventListener('keydown', onKey);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    btn.removeEventListener('click', onBtn);
    offLive?.();
    hint.remove(); btn.remove();
    ctx?.close();
  }
  return { update, toggle, setLevel, dispose,
    setNetwork(adapter) { network = adapter || null; pending = false; networkGeneration++; renderHint(); },
    snapshot: () => ({ level }),
    applyNetwork(value) { if (Number.isInteger(value?.level) && value.level >= 0 && value.level <= 3) setLevel(value.level, { authoritative: true }); },
    networkPosition() { find(); return group?.userData.hood?.center?.toArray?.() ?? null; },
    get level() { return level; }, get target() { return target; } };
}
