// Руки с оружием в прогулке «по приколу» (вид от первого лица, как в шутерах). Настройка браузера, в код варианта не входит.
// Модели: web/models/viewmodel/ (SOURCE.md): пистолет и автомат Quaternius (CC0), винтовка времён Первой мировой и двустволка
// процедурные (tools/viewmodel/procedural.py); перчатки и рукава процедурные. Грузятся при первом выборе.
// Рисуется поверх растра своей камерой со своим углом обзора (render.js setOverlay): в стены не проваливается,
// в фото-режим, снимок и GLB не попадает. Свет вспышки живёт только в сцене рук: свет и тени квартиры не трогает.
// Попадания (impacts.js): лучи из центра экрана с текущим разбросом, дырка на поверхности и всплеск; зверь (hunt.js) ближе
// стены — получает урон, вместо дырки брызги.
//
// createViewmodel({ THREE, scene, camera, renderer, pipe, canvas, requestRender, getDoors, getSeats, getWalk, getHunt })
//   getDoors()?.target / getSeats()?.target — дверь или сиденье под прицелом: тогда клик открывает/сажает, а не стреляет;
//   getSeats()?.active — сидим: оружие можно показывать, но не стрелять кликом по экрану ТВ;
//   getWalk() — прогулка (walk.js): setZoom(k) — увеличение в прицеле, kick(up, side, keep) — отдача взгляда, walking;
//   getHunt() — охота (hunt.js) или null: на выстрел noise(точка, громкость 0–1), на каждую пулю raycast(raycaster).
//   -> { update(dt, { active, moving, running }) -> bool (true — нужен кадр), setWeapon(id), setSound(on), setAim(on), reload(),
//        link({ getWalk, getHunt }) — подключить позже (проверки из консоли до того, как main.js их передаст),
//        clearHoles() — убрать следы попаданий, holes, weapon, sound, armed (оружие в руках: клик стреляет),
//        ammo ({ mag, reserve } у текущего), busy (перезарядка/затвор: null или вид действия), aiming (0–1), spread (рад),
//        shots, dispose() }
// registerViewmodelUI(addSection, getVM) — раздел «Оружие» во вкладке 'view' сразу после «Прогулки».
// Ввод в прогулке: 1 — убрать, 2 — пистолет, 3 — автомат, 4 — винтовка, 5 — двустволка; R — перезарядка
// (E занята: дверь, сесть; подсказку клавиш показывает walk.js). Мышь: ЛКМ — выстрел (без прицела: клик, перетаскивание —
// взгляд), ПКМ зажать — прицел (оружие к глазу, обзор уже, мышь медленнее, перетаскивание ведёт взгляд); в прицеле и в захвате
// мыши (двойной клик) ЛКМ стреляет сразу, автомат — очередью, пока зажата. Телефон: касания — взгляд, справа кнопки огня
// и прицела, нажатие на счётчик патронов — перезарядка. Пустой магазин: щелчок и сама начинается перезарядка.
// Патроны: магазин и запас у каждого оружия свои; выход из прогулки всё пополняет.
// Покой: покачивание дыхания затухает за VM.settle секунд, дальше update() возвращает false и кадров не просит.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { createImpacts } from './impacts.js';

// pos — место центра рукояти в пространстве камеры рук (м): вправо, вверх, вперёд = −z; yaw — доворот к центру экрана,
// pitch — подъём ствола, рад.
// action: semi | auto | bolt (затвор после каждого выстрела, зарядка обоймой) | break (переломка).
// rate — выстрелов в секунду; mag/reserve — патронов в магазине и в запасе; reload — перезарядка, с;
// damage — урон за попадание (одной пули, дробины), range — дальность, м; pellets — дробин в выстреле; loud — громкость для зверей 0–1.
// spread, рад: hip — от бедра, ads — в прицеле, move/run — добавка на ходу/бегом, bloom — рост за выстрел, max — потолок роста,
//   recover — спад роста, рад/с. recoil — взгляд: up/side, рад, keep — доля, что остаётся. kick — руки: back, м; pitch, рад.
// ads: zoom — во сколько раз уже обзор, time — подъём к глазу, с; eye — от глаза до целика, м; sight — целик и мушка в осях модели.
// parts (винтовка): ось затвора, шар рукояти относительно оси, окно ствольной коробки — в осях модели, м.
export const WEAPONS = [
  { id: 'none', name: 'Нет' },
  { id: 'pistol', name: 'Пистолет', file: 'pistol.glb', pos: [0.1, -0.112, -0.42], yaw: 0.16, action: 'semi', rate: 6,
    mag: 12, reserve: 48, reload: 1.5, damage: 34, range: 150, loud: 0.6,
    spread: { hip: 0.012, ads: 0.003, move: 0.01, run: 0.03, bloom: 0.012, max: 0.05, recover: 0.08 },
    recoil: { up: 0.022, side: 0.008, keep: 0.2 }, kick: { back: 0.045, pitch: 0.2 },
    ads: { zoom: 1.25, time: 0.16, eye: 0.36, sight: [[0, 0.0878, 0.0], [0, 0.0894, -0.148]] },
    flash: 0.13, sound: { gain: 1, cutoff: 3200, decay: 0.16, thump: 150 } },
  { id: 'rifle', name: 'Автомат', file: 'rifle.glb', pos: [0.14, -0.2, -0.56], yaw: 0.03, pitch: 0.05, action: 'auto', rate: 10,
    mag: 30, reserve: 120, reload: 2.2, damage: 28, range: 400, loud: 0.8,
    spread: { hip: 0.02, ads: 0.004, move: 0.012, run: 0.035, bloom: 0.007, max: 0.045, recover: 0.05 },
    recoil: { up: 0.009, side: 0.006, keep: 0.45 }, kick: { back: 0.026, pitch: 0.06 },
    ads: { zoom: 1.6, time: 0.22, eye: 0.24, sight: [[0, 0.178, -0.05], [0, 0.1917, -0.446]] },   // целик-короб без прорези: смотрим поверх него на мушку
    flash: 0.2, sound: { gain: 0.8, cutoff: 2400, decay: 0.12, thump: 110 } },
  { id: 'bolt', name: 'Винтовка', file: 'bolt.glb', pos: [0.16, -0.2, -0.58], yaw: 0.07, pitch: 0.03, action: 'bolt', rate: 1.5,
    mag: 5, reserve: 30, clip: 5, cycle: 0.8, damage: 120, range: 800, loud: 1,
    spread: { hip: 0.03, ads: 0.0004, move: 0.02, run: 0.05, bloom: 0, max: 0, recover: 1 },
    recoil: { up: 0.05, side: 0.012, keep: 0.15 }, kick: { back: 0.06, pitch: 0.12 },
    ads: { zoom: 2.4, time: 0.3, eye: 0.48, sight: [[0, 0.091, -0.28], [0, 0.091, -0.784]] },
    parts: { pivot: [0, 0.055, 0], knob: [0.05, -0.028, 0.014], port: [0, 0.075, -0.13], lift: 1.25, travel: 0.085 },
    flash: 0.24, sound: { gain: 1.2, cutoff: 2600, decay: 0.3, thump: 85 } },
  { id: 'shotgun', name: 'Двустволка', file: 'shotgun.glb', pos: [0.13, -0.15, -0.42], yaw: 0.05, pitch: 0.03, action: 'break', rate: 4,
    mag: 2, reserve: 24, reload: 2.0, pellets: 9, damage: 14, range: 70, loud: 0.9,
    spread: { hip: 0.05, ads: 0.035, move: 0.01, run: 0.02, bloom: 0, max: 0, recover: 1 },
    recoil: { up: 0.045, side: 0.015, keep: 0.2 }, kick: { back: 0.055, pitch: 0.14 },
    ads: { zoom: 1.3, time: 0.22, eye: 0.3, sight: [[0, 0.075, -0.14], [0, 0.040, -0.832]] },   // глаз над планкой, выше кулака: смотрим вдоль планки на мушку
    flash: 0.28, sound: { gain: 1.25, cutoff: 2000, decay: 0.28, thump: 75 } },
];
const VM = {
  fovV: 50,          // вертикальный угол камеры рук (на портретном экране — так, чтобы по ширине было столько же)
  raise: 0.35,       // руки поднимаются при входе и смене оружия, с
  settle: 2.5,       // через сколько секунд покоя затихает дыхание
  hold: 180,         // мс удержания без движения мыши, после которых автомат начинает очередь
  drag: 5,           // px: дальше — это взгляд, не выстрел
  flashTime: 0.05,   // с
  volume: 0.22,      // общая громкость выстрела
  light: 1.3,        // яркость подсветки рук относительно экспозиции сцены
  adsSway: 0.15,     // покачивание и инерция рук в прицеле — доля от обычного
  adsVm: 0.5,        // насколько сужается обзор камеры рук в прицеле (доля от корня увеличения сцены)
  dry: 0.25,         // щелчок пустого не чаще, с
};
const PREF = 'kitchen-viewmodel-v1';   // { weapon, sound }
const MODELS = new URL('../models/viewmodel/', import.meta.url);
const byId = id => WEAPONS.find(w => w.id === id) || WEAPONS[0];

// Поза в прицеле: целик и мушка на оси камеры рук, целик — в eye метрах перед глазом
function adsPose(w) {
  const [r, f] = w.ads.sight;
  const rx = Math.atan((f[1] - r[1]) / (f[2] - r[2])), c = Math.cos(rx), s = Math.sin(rx);
  return { x: -r[0], y: -(r[1] * c - r[2] * s), z: -w.ads.eye - (r[1] * s + r[2] * c), rx };
}
const ADS = new Map(WEAPONS.filter(w => w.ads).map(w => [w.id, adsPose(w)]));

function readPref() {
  try { return { weapon: 'none', sound: true, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { weapon: 'none', sound: true }; }
}
function writePref(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* хранилище недоступно */ } }
const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const coarse = () => { try { return matchMedia('(hover: none), (pointer: coarse)').matches; } catch { return false; } };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const win = (x, a, b, c, d) => ss(a, b, x) * (1 - ss(c, d, x));            // 0 → 1 → 0 со ступенями
const bump = (x, a, b) => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)));
const rand = (a, b) => a + Math.random() * (b - a);

export function createViewmodel({ THREE, scene, camera, renderer, pipe, canvas, requestRender, getDoors, getSeats, getWalk, getHunt }) {
  const aimed = () => !!(getDoors?.()?.target || getSeats?.()?.target);   // клик достаётся двери или сиденью
  const seated = () => !!getSeats?.()?.active;
  const pref = readPref();
  let weapon = byId(pref.weapon).id, sound = pref.sound !== false;

  // ---------- сцена рук ----------
  const vmScene = new THREE.Scene();
  const vmCam = new THREE.PerspectiveCamera(VM.fovV, 1, 0.01, 5);
  const hemi = new THREE.HemisphereLight('#f4f1ea', '#4e4a45', 1.7);
  const key = new THREE.DirectionalLight('#fff4e6', 2.2); key.position.set(-0.6, 1, 0.5);
  const rim = new THREE.DirectionalLight('#dfe8ff', 0.8); rim.position.set(1, 0.3, -1);
  const BASE = { hemi: hemi.intensity, key: key.intensity, rim: rim.intensity };
  const rig = new THREE.Group();
  vmScene.add(hemi, key, rim, rig);

  // вспышка: спрайт с лучами + короткий свет, оба у дула
  const flashTex = makeFlashTexture(THREE);
  const flashMat = new THREE.SpriteMaterial({ map: flashTex, color: new THREE.Color(3.2, 2.3, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true });
  // дуло из глаз закрыто затвором: вспышка рисуется поверх ствола и чуть впереди дула
  const flashSprite = new THREE.Sprite(flashMat); flashSprite.visible = false; flashSprite.renderOrder = 10; flashSprite.position.z = -0.02;
  const flashLight = new THREE.PointLight('#ffb36b', 0, 0.8, 2);   // всегда в сцене: число источников не меняется, шейдеры не пересобираются

  // модель: { root, muzzle, n: { bolt, hand_r, clip, barrels, shells }, base: исходные положения подвижных узлов }
  const models = {};
  let loader = null;
  function load(id) {
    const w = byId(id);
    if (!w.file || models[id]) return;
    if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
    models[id] = loader.loadAsync(new URL(w.file, MODELS).href).then(g => {
      const root = g.scene;
      root.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        const m = o.material;
        // без карты окружения металл чернеет: держим его полуматовым
        if (m.metalness > 0.3) m.metalness = 0.3;
        if (m.roughness < 0.45) m.roughness = 0.45;
      });
      const n = {}, base = {};
      for (const name of ['bolt', 'hand_r', 'clip', 'barrels', 'shells']) {
        const o = root.getObjectByName(name);
        if (!o) continue;
        n[name] = o; base[name] = { p: o.position.clone(), r: o.rotation.clone() };
      }
      if (n.clip) n.clip.visible = false;
      if (n.shells) n.shells.visible = false;
      const muzzle = root.getObjectByName('muzzle') || root;
      models[id] = { root, muzzle, n, base };
      if (id === weapon) mount();
      return models[id];
    }).catch(err => { console.warn('viewmodel.js: модель не загрузилась', w.file, err); delete models[id]; });
  }

  let mounted = null;    // id смонтированной модели
  function mount() {
    const m = models[weapon];
    if (mounted === weapon && m?.root?.parent === rig) return;
    rig.clear(); mounted = null;
    if (!m?.root) return;
    rig.add(m.root);
    m.muzzle.add(flashSprite, flashLight);
    mounted = weapon;
    raise = 0; quiet = 0;
    requestRender?.();
  }

  // ---------- патроны ----------
  const ammo = {};
  const refill = () => { for (const w of WEAPONS) if (w.mag) ammo[w.id] = { mag: w.mag, reserve: w.reserve }; };
  refill();

  // ---------- состояние анимации ----------
  let shown = false, wasActive = false, raise = 1, quiet = 0, bobAmp = 0, phase = 0, lagX = 0, lagY = 0;
  let rec = 0, recV = 0, recYaw = 0, flash = 0, lastShot = -1e9, lastDry = -1e9, holding = false, spd = 0, shots = 0;
  let aimHeld = false, adsK = 0, adsE = 0, zoomSet = 1, bloom = 0, mvNow = false, runNow = false;
  let act = null;        // { kind: mag | cycle | load | break, t, dur, ev: [[t, fn]], i, load? } — перезарядка или затвор
  const lastPos = new THREE.Vector3(), fwd = new THREE.Vector3(), ear = new THREE.Vector3();
  let lastYaw = null, lastPitch = 0;
  const W = () => byId(weapon);
  const impacts = createImpacts({ THREE, scene, camera, renderer, pipe, requestRender });
  const ap = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };   // добавка позы от действия (перезарядка, затвор)

  // частицы попаданий живут и после выхода из прогулки, поэтому считаются отдельно от рук
  function update(dt = 1 / 60, opts) {
    const fx = impacts.update(dt);
    return hands(dt, opts) || fx;
  }

  function hands(dt = 1 / 60, { active = false, moving = false, running = false } = {}) {
    if (active !== wasActive) {
      wasActive = active;
      if (!active) { refill(); act = null; bloom = 0; hud(); }   // игрушка, а не наказание: вышел — всё полное
    }
    const want = active && weapon !== 'none';
    if (want && !models[weapon]) load(weapon);
    if (want && mounted !== weapon && models[weapon]?.root) mount();
    const show = want && mounted === weapon;
    if (show !== shown) {
      shown = show;
      if (!show) { stopHold(); aimHeld = false; adsK = adsE = 0; act = null; lastYaw = null; setZoom(1); syncDom(); return true; }   // ещё кадр — убрать руки
      raise = 0; quiet = 0; lastPos.copy(camera.position);
      syncDom();
    }
    if (!show) return false;
    dt = Math.min(Math.max(dt, 1e-4), 0.1);
    const w = W();

    // движение: из walk (moving/running) или по скорости камеры, если walk их пока не отдаёт
    const v = Math.hypot(camera.position.x - lastPos.x, camera.position.z - lastPos.z) / dt;
    lastPos.copy(camera.position);
    spd += ((v < 8 ? v : 0) - spd) * Math.min(1, dt * 10);   // скачок (телепорт) не считается шагом
    const mv = moving || spd > 0.35, run = running || spd > 2.2;
    mvNow = mv; runNow = run;

    // поворот взгляда -> инерция рук
    camera.getWorldDirection(fwd);
    const yaw = Math.atan2(-fwd.x, -fwd.z), pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    let dYaw = 0, dPitch = 0;
    if (lastYaw != null) { dYaw = Math.atan2(Math.sin(yaw - lastYaw), Math.cos(yaw - lastYaw)); dPitch = pitch - lastPitch; }
    lastYaw = yaw; lastPitch = pitch;
    const lk = 1 - Math.exp(-10 * dt);
    lagX += (THREE.MathUtils.clamp((dYaw / dt) * 0.012, -0.035, 0.035) - lagX) * lk;
    lagY += (THREE.MathUtils.clamp(-(dPitch / dt) * 0.010, -0.025, 0.025) - lagY) * lk;

    // действие (перезарядка, затвор): события по времени, в конце — снова можно стрелять
    if (act) {
      act.t += dt;
      while (act && act.i < act.ev.length && act.ev[act.i][0] <= act.t) act.ev[act.i++][1]();
      if (act && act.t >= act.dur) { act = null; hud(); }
    }
    if (holding && w.action === 'auto') fire();

    // прицел: к глазу, пока держим ПКМ (перезарядка опускает оружие; затвор передёргивается, не отрываясь от глаза)
    const adsWant = aimHeld && raise >= 1 && !seated() && (!act || act.kind === 'cycle') ? 1 : 0;
    if (adsK !== adsWant) adsK = adsWant > adsK ? Math.min(1, adsK + dt / w.ads.time) : Math.max(0, adsK - dt / (w.ads.time * 0.8));
    adsE = adsK * adsK * (3 - 2 * adsK);
    setZoom(1 + (w.ads.zoom - 1) * adsE);
    document.body.classList.toggle('kvm-ads', adsE > 0.5);
    bloom = Math.max(0, bloom - w.spread.recover * dt);

    // шаг: амплитуда тянется к цели, фаза идёт, пока идём
    const bt = mv ? (run ? 1.7 : 1) : 0;
    bobAmp += (bt - bobAmp) * (1 - Math.exp(-6 * dt));
    if (bobAmp > 1e-3) phase += dt * (run ? 12.5 : 8.5);
    // откат: пружина с лёгким перелётом, мелкими шагами (dt бывает до 0,1 с)
    for (let h = dt; h > 0; h -= 1 / 240) {
      const s = Math.min(h, 1 / 240);
      recV += (-320 * rec - 26 * recV) * s; rec += recV * s;
    }
    raise = Math.min(1, raise + dt / VM.raise);
    flash = Math.max(0, flash - dt);
    const busy = mv || Math.abs(dYaw) + Math.abs(dPitch) > 1e-4 || holding || flash > 0 || raise < 1 || act || bloom > 0 || (adsK > 0 && adsK < 1);
    quiet = busy ? 0 : quiet + dt;
    const breath = Math.max(0, 1 - quiet / VM.settle);

    // покой: всё затихло — обнуляем и кадров не просим
    const still = !busy && breath === 0 && bobAmp < 1e-3 && Math.abs(lagX) + Math.abs(lagY) < 2e-5 && Math.abs(rec) + Math.abs(recV) < 1e-4;
    if (still) {
      if (bobAmp || lagX || lagY || rec || recV) { bobAmp = lagX = lagY = rec = recV = 0; pose(0); return true; }
      return false;
    }
    pose(breath);
    return true;
  }

  function setZoom(z) {
    if (Math.abs(z - zoomSet) < 1e-4) return;
    zoomSet = z;
    getWalk?.()?.setZoom?.(z);
  }

  // ---------- поза ----------
  const v3 = new THREE.Vector3();
  function pose(breath) {
    const w = W(), m = models[weapon], t = performance.now() / 1000, A = ADS.get(w.id), a = adsE;
    const e = 1 - (1 - raise) ** 3, h = 1 - a * (1 - VM.adsSway);
    const bx = Math.sin(phase) * 0.011 * bobAmp, by = (Math.cos(2 * phase) - 1) * 0.0065 * bobAmp;
    const br = Math.sin(t * 1.6) * 0.0018 * breath, bs = Math.sin(t * 0.8) * 0.0012 * breath;
    animate(w, m);
    const L = THREE.MathUtils.lerp;
    rig.position.set(
      L(w.pos[0], A.x, a) + (bx + lagX + bs) * h + ap.x,
      L(w.pos[1], A.y, a) + (by + lagY + br) * h + ap.y - (1 - e) * 0.22,
      L(w.pos[2], A.z, a) + rec * w.kick.back * (1 - 0.4 * a) + ap.z);
    rig.rotation.set(
      L(w.pitch || 0, A.rx, a) + rec * w.kick.pitch * (1 - 0.6 * a) - (1 - e) * 0.7 + lagY * 2 * h + ap.rx,
      L(w.yaw, 0, a) + (lagX * 2.5 + recYaw * rec) * h + ap.ry,
      (Math.sin(phase) * 0.025 * bobAmp - lagX * 1.5) * h + ap.rz, 'YXZ');
    flashSprite.visible = flash > 0;
    flashLight.intensity = flash > 0 ? 3 * (flash / VM.flashTime) : 0;
    crosshair();
    if (act) hudProgress();
  }

  // Действие -> добавка позы рук (ap) и положения подвижных узлов модели (затвор, правая рука, обойма, стволы, патроны)
  function animate(w, m) {
    ap.x = ap.y = ap.z = ap.rx = ap.ry = ap.rz = 0;
    if (!m?.n) return;
    const { n, base } = m;
    if (n.bolt) boltPose(w, m, 0, 0, 0, 0);
    if (n.barrels) { n.barrels.rotation.x = base.barrels.r.x; n.shells.visible = false; }
    if (!act) return;
    const t = act.t, k = t / act.dur;
    if (act.kind === 'mag') {
      // наклонить к себе, выбить магазин, новый — шлепком, передёрнуть затвор
      const tilt = win(k, 0, 0.16, 0.84, 1), rack = bump(k, 0.71, 0.82);
      ap.rz = 0.5 * tilt - 0.1 * rack; ap.rx = 0.22 * tilt; ap.x = -0.035 * tilt;
      ap.y = -0.035 * tilt + 0.014 * bump(k, 0.2, 0.32) - 0.03 * win(k, 0.3, 0.38, 0.5, 0.58) + 0.02 * bump(k, 0.57, 0.67);
      ap.z = 0.035 * rack;
    } else if (act.kind === 'cycle') {
      // рука к рукояти, вверх, назад, вперёд, вниз, рука на шейку
      const hand = win(t, 0, 0.13, 0.62, 0.78);
      boltPose(w, m, win(t, 0.1, 0.2, 0.56, 0.66), win(t, 0.22, 0.34, 0.4, 0.52), hand, 0);
      ap.rz = 0.1 * hand; ap.rx = 0.03 * hand; ap.y = -0.012 * hand;
    } else if (act.kind === 'load') {
      // затвор открыт, патроны по одному или обоймой (большой палец давит сверху), затвор закрыт — обойма слетает
      const L = act.load, tc = L.To + L.Tl;
      const hand = win(t, 0, 0.12, tc + 0.32, tc + 0.45);
      let push = 0;
      if (L.clip) push = ss(L.To + 0.5, L.To + 0.85, t);
      else if (t > L.To && t < tc) { const f = (t - L.To) / 0.5; push = bump(f - Math.floor(f), 0.3, 0.8); }
      boltPose(w, m, win(t, 0.04, 0.14, tc + 0.2, tc + 0.3), win(t, 0.16, 0.36, tc + 0.02, tc + 0.18), hand,
        win(t, L.To - 0.08, L.To + 0.12, tc - 0.12, tc + 0.02), push);
      if (n.clip) {
        n.clip.visible = L.clip && t > L.To - 0.08 && t < tc + 0.06;
        n.clip.position.copy(base.clip.p);
        n.clip.position.y += 0.07 * (1 - ss(L.To - 0.08, L.To + 0.3, t)) - 0.035 * push;
      }
      ap.rz = 0.22 * hand; ap.rx = 0.1 * hand; ap.x = -0.04 * hand;
    } else if (act.kind === 'break') {
      // переломить, гильзы назад-вверх, два новых патрона в патронники, закрыть
      const open = win(t, 0.05, 0.25, 1.45, 1.65);
      n.barrels.rotation.x = base.barrels.r.x - 0.6 * open;
      const out = t > 0.22 && t < 0.45, inn = t > 0.75 && t < 1.2;
      n.shells.visible = out || inn;
      n.shells.position.copy(base.shells.p);
      if (out) { const f = ss(0.22, 0.45, t); n.shells.position.z += -0.07 + 0.35 * f; n.shells.position.y += 0.12 * f; }
      if (inn) { const f = ss(0.75, 1.1, t); n.shells.position.z += 0.12 - 0.19 * f; n.shells.position.y += 0.05 * (1 - f); }
      ap.rx = 0.25 * open; ap.rz = 0.2 * open; ap.x = -0.03 * open; ap.y = -0.02 * open;
    }
  }

  // Затвор винтовки: lift — поднят (0–1), slide — отведён (0–1); правая рука: hand — доля пути от шейки,
  // port — доля пути от рукояти затвора к окну коробки, push — нажим большим пальцем вниз
  function boltPose(w, m, lift, slide, hand, port, push = 0) {
    const { n, base } = m, P = w.parts;
    const a = P.lift * lift, dz = P.travel * slide;
    n.bolt.rotation.set(base.bolt.r.x, base.bolt.r.y, base.bolt.r.z + a);
    n.bolt.position.set(base.bolt.p.x, base.bolt.p.y, base.bolt.p.z + dz);
    if (!n.hand_r) return;
    const [kx, ky, kz] = P.knob, c = Math.cos(a), s = Math.sin(a);
    // кулак обхватывает шар чуть ниже и позади
    v3.set(P.pivot[0] + kx * c - ky * s + 0.004, P.pivot[1] + kx * s + ky * c - 0.022, P.pivot[2] + kz + dz + 0.012);
    const px = P.port[0] + 0.012, py = P.port[1] + 0.03 - 0.03 * push, pz = P.port[2] + 0.05;
    v3.x += (px - v3.x) * port; v3.y += (py - v3.y) * port; v3.z += (pz - v3.z) * port;
    n.hand_r.position.copy(base.hand_r.p).addScaledVector(v3, hand);
  }

  // ---------- выстрел ----------
  const audio = createShotSound();
  const mech = name => { if (sound) audio.mech(name); };
  function spreadNow() {
    const sp = W().spread;
    if (!sp) return 0;   // «без оружия»: разброса нет
    return sp.hip + (sp.ads - sp.hip) * adsE + (runNow ? sp.run : mvNow ? sp.move : 0) * (1 - 0.5 * adsE) + bloom;
  }
  function fire() {
    const w = W(), now = performance.now();
    if (!w.rate || !shown || raise < 0.7 || aimed() || seated() || act) return false;   // «без оружия» не стреляет
    if (now - lastShot < 1000 / w.rate) return false;
    const a = ammo[w.id];
    if (a.mag <= 0) { dry(); return false; }
    lastShot = now; shots++; a.mag--;
    const hunt = getHunt?.() ?? null;
    hunt?.noise?.(ear.copy(camera.position), w.loud);
    impacts.shoot({ spread: spreadNow(), pellets: w.pellets || 1, range: w.range, hunt, weapon: w.id, damage: w.damage });
    bloom = Math.min(w.spread.max, bloom + w.spread.bloom);
    const r = w.recoil, k = 1 - 0.25 * adsE;
    getWalk?.()?.kick?.(r.up * k * rand(0.85, 1.15), r.side * k * rand(-1, 1), r.keep);
    recV += 26 * (0.85 + Math.random() * 0.3);
    recYaw = (Math.random() - 0.5) * 0.25;
    flash = VM.flashTime;
    const s = w.flash * (0.8 + Math.random() * 0.4);
    flashSprite.scale.set(s, s, s);
    flashMat.rotation = Math.random() * Math.PI * 2;
    quiet = 0;
    if (sound) audio.play(w.sound);
    if (w.action === 'bolt') begin('cycle', w.cycle, [[0.14, () => mech('boltUp')], [0.27, () => mech('boltBack')], [0.42, () => mech('boltFwd')], [0.6, () => mech('boltDown')]], -0.12);
    if (!a.mag) holding = false;
    hud();
    requestRender?.();
    return true;
  }
  // пустой: щелчок и сама начинается перезарядка (если есть запас)
  function dry() {
    const now = performance.now();
    if (now - lastDry < VM.dry * 1000) return;
    lastDry = now; holding = false;
    mech('empty');
    if (!reload()) hud(true);
  }

  function begin(kind, dur, ev, t = 0, extra = null) {
    act = { kind, t, dur, ev, i: 0, load: extra };
    quiet = 0; holding = false;
    hud();
    requestRender?.();
  }
  function reload() {
    const w = W(), a = ammo[w.id];
    if (!shown || act || !a || a.mag >= w.mag || a.reserve <= 0) return false;
    const n = Math.min(w.mag - a.mag, a.reserve);
    const fill = () => { a.mag += n; a.reserve -= n; hud(); };
    if (w.action === 'bolt') {
      const clip = a.mag === 0 && n === w.clip, To = 0.45, Tl = clip ? 1.2 : 0.5 * n, tc = To + Tl;
      const ev = [[0.06, () => mech('boltUp')], [0.22, () => mech('boltBack')]];
      if (clip) ev.push([To + 0.3, () => mech('clip')], [To + 0.75, () => { mech('shell'); fill(); }]);
      else for (let i = 0; i < n; i++) ev.push([To + 0.5 * i + 0.4, () => { mech('shell'); a.mag++; a.reserve--; hud(); }]);
      ev.push([tc + 0.06, () => mech('boltFwd')], [tc + 0.24, () => mech('boltDown')]);
      begin('load', tc + 0.45, ev, 0, { To, Tl, clip });
    } else if (w.action === 'break') {
      begin('break', w.reload, [[0.12, () => mech('open')], [0.95, () => mech('shell')], [1.08, () => { mech('shell'); fill(); }], [1.55, () => mech('close')]]);
    } else {
      const D = w.reload;
      begin('mag', D, [[0.22 * D, () => mech('magOut')], [0.6 * D, () => { mech('magIn'); fill(); }], [0.74 * D, () => mech('rack')]]);
    }
    return true;
  }

  // мышь и перо: кнопки по маске buttons (вторая кнопка при уже зажатой первой приходит pointermove, а не pointerdown);
  // без прицела и захвата клик стреляет, перетаскивание — взгляд; в прицеле и в захвате ЛКМ стреляет сразу
  let press = null, holdTimer = 0, btns = 0;
  const locked = () => document.pointerLockElement === canvas;
  function stopHold() { holding = false; clearTimeout(holdTimer); press = null; }
  function trigger(e) {
    if (!shown || aimed() || seated()) return;   // клик открывает дверь / сажает; сидя не стреляем
    if (sound) audio.unlock();
    const auto = W().action === 'auto';
    if (locked() || aimHeld) { press = { started: true }; fire(); holding = auto; return; }
    press = { x: e.clientX, y: e.clientY, moved: false, started: false };
    if (auto) holdTimer = setTimeout(() => { if (press && !press.moved) { press.started = true; holding = true; fire(); } }, VM.hold);
  }
  function release() {
    if (press && !press.moved && !press.started) fire();
    stopHold();
  }
  function setAim(on) {
    aimHeld = !!on && shown && !seated();
    syncDom();
    requestRender?.();
  }
  const onPointer = e => {
    if (e.pointerType === 'touch') { if (e.type === 'pointerdown') { touchSeen = true; syncDom(); } return; }   // касание — только взгляд
    const b = e.type === 'pointercancel' ? 0 : e.buttons & 3, ch = b ^ btns;
    btns = b;
    if (ch & 2) setAim(!!(b & 2));
    if (ch & 1) { if (b & 1) trigger(e); else release(); }
    else if (press && !press.started && e.type === 'pointermove' && Math.hypot(e.clientX - press.x, e.clientY - press.y) > VM.drag) {
      press.moved = true; clearTimeout(holdTimer);
    }
  };
  const onBlur = () => { btns = 0; stopHold(); if (aimHeld) setAim(false); };
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.addEventListener(t, onPointer);
  addEventListener('blur', onBlur);

  // клавиши 1–5 и R в прогулке (панель в прогулке цифры не перехватывает)
  const KEYS = {};
  WEAPONS.forEach((w, i) => { KEYS['Digit' + (i + 1)] = KEYS['Numpad' + (i + 1)] = w.id; });
  const onKey = e => {
    if (e.repeat || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!document.body.classList.contains('kw-walking')) return;
    if (e.code === 'KeyR') { if (shown) { reload(); e.preventDefault(); } return; }
    if (!KEYS[e.code]) return;
    setWeapon(KEYS[e.code]); e.preventDefault();
  };
  addEventListener('keydown', onKey);

  // ---------- разметка: кнопки огня и прицела (телефон), прицельная метка с разбросом, счётчик патронов ----------
  let touchSeen = false;
  injectStyle();
  const fireBtn = floatButton('kvm-fire', 'Выстрел', '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 1.5v6M13 18.5v6M1.5 13h6M18.5 13h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="13" cy="13" r="1.8" fill="currentColor"/></svg>');
  const aimBtn = floatButton('kvm-aim', 'Прицел', '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M2 8V3.5A1.5 1.5 0 0 1 3.5 2H8M14 2h4.5A1.5 1.5 0 0 1 20 3.5V8M20 14v4.5a1.5 1.5 0 0 1-1.5 1.5H14M8 20H3.5A1.5 1.5 0 0 1 2 18.5V14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11 7.5v7M7.5 11h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
  let btnId = null;
  fireBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btnId = e.pointerId;
    try { fireBtn.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    if (sound) audio.unlock();
    fire(); holding = W().action === 'auto';
    requestRender?.();
  });
  const btnUp = e => { if (e.pointerId === btnId) { btnId = null; holding = false; } };
  fireBtn.addEventListener('pointerup', btnUp);
  fireBtn.addEventListener('pointercancel', btnUp);
  aimBtn.addEventListener('pointerdown', e => { e.preventDefault(); setAim(!aimHeld); });

  const cross = document.createElement('div');
  cross.className = 'kvm-cross kw-float'; cross.hidden = true; cross.setAttribute('aria-hidden', 'true');
  cross.innerHTML = '<i></i><i></i><i></i><i></i>';
  document.body.appendChild(cross);
  let crossGap = -1;
  function crosshair() {
    // зазор = текущий разброс на экране: тангенс угла к тангенсу половины обзора × половина высоты
    const g = 3 + (Math.tan(spreadNow()) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * canvas.clientHeight / 2;
    if (Math.abs(g - crossGap) < 0.4) return;
    crossGap = g;
    cross.style.setProperty('--g', g.toFixed(1) + 'px');
  }

  const hudEl = document.createElement('button');
  hudEl.type = 'button'; hudEl.className = 'kvm-hud kw-float'; hudEl.hidden = true;
  hudEl.title = 'Перезарядить (R)';
  hudEl.innerHTML = '<span class="kvm-hud-name"></span><span class="kvm-hud-ammo"><b></b><span></span></span><span class="kvm-hud-note"></span><i class="kvm-hud-bar"></i>';
  const [hName, hAmmo, hNote, hBar] = [hudEl.children[0], hudEl.children[1], hudEl.children[2], hudEl.children[3]];
  hudEl.addEventListener('click', () => { if (sound) audio.unlock(); reload(); });
  document.body.appendChild(hudEl);
  let hudKey = '';
  function hud(empty = false) {
    const w = W(), a = ammo[w.id];
    if (!a) return;
    const note = act && act.kind !== 'cycle' ? 'Перезарядка…' : a.mag === 0 ? (a.reserve ? 'R — перезарядить' : 'Патроны кончились') : '';
    const k = `${w.id}|${a.mag}|${a.reserve}|${note}|${empty}`;
    if (k === hudKey) return;
    hudKey = k;
    hName.textContent = w.name;
    hAmmo.children[0].textContent = a.mag;
    hAmmo.children[1].textContent = '/ ' + a.reserve;
    hNote.textContent = note;
    hudEl.classList.toggle('low', a.mag <= Math.ceil(w.mag / 4));
    hudEl.classList.toggle('busy', !!act && act.kind !== 'cycle');
    hudEl.setAttribute('aria-label', `${w.name}: ${a.mag} в магазине, ${a.reserve} в запасе${note ? '. ' + note : ''}`);
    if (empty) { hudEl.classList.remove('shake'); void hudEl.offsetWidth; hudEl.classList.add('shake'); }
    if (!act) hBar.style.transform = '';
  }
  function hudProgress() { if (act.kind !== 'cycle') hBar.style.transform = `scaleX(${Math.min(1, Math.max(0, act.t / act.dur)).toFixed(3)})`; }

  // классы на body (ui.js следит за ними) и видимость плавающих элементов
  function syncDom() {
    for (const w of WEAPONS) document.body.classList.toggle('kvm-w-' + w.id, w.id !== 'none' && weapon === w.id);
    if (!shown) document.body.classList.remove('kvm-ads');
    const touch = touchSeen || coarse();
    fireBtn.hidden = aimBtn.hidden = !(shown && touch);
    aimBtn.classList.toggle('on', aimHeld);
    aimBtn.setAttribute('aria-pressed', String(aimHeld));
    cross.hidden = hudEl.hidden = !shown;
    if (shown) { hudKey = ''; hud(); crossGap = -1; crosshair(); }
  }
  syncDom();

  // ---------- слой поверх растра ----------
  let rt = null, quad = null;
  const size = new THREE.Vector2(), clear = new THREE.Color();
  let vmShift = 0;   // px кадра: сдвиг рук влево от открытой панели
  pipe?.setOverlay?.({
    active: () => shown,
    draw() {
      renderer.getDrawingBufferSize(size);
      if (!rt) {
        rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples) });
        quad = new FullScreenQuad(new THREE.ShaderMaterial({
          uniforms: { map: { value: rt.texture } }, transparent: true, depthTest: false, depthWrite: false,
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          // в цели цвет «умножен» на покрытие (сглаженные края): делим обратно, тон и sRGB — как у сцены
          fragmentShader: `uniform sampler2D map; varying vec2 vUv;
            void main() { vec4 t = texture2D(map, vUv); if (t.a < 0.002) discard;
              gl_FragColor = vec4(t.rgb / t.a, min(t.a, 1.0));
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
        }));
      } else if (rt.width !== size.x || rt.height !== size.y) rt.setSize(size.x, size.y);
      const aspect = size.x / Math.max(1, size.y);
      // в прицеле камера рук тоже чуть «уже» (VM.adsVm — доля от корня увеличения): мушка и прорезь крупнее
      const fovV = VM.fovV / (1 + (Math.sqrt(W().ads?.zoom || 1) - 1) * VM.adsVm * adsE);
      const fov = aspect >= 1 ? fovV : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fovV / 2)) / aspect));
      // открытая боковая панель закрывает правую часть холста: руки сдвигаются в середину свободной части
      // (как плавающие кнопки, --shift в index.html); в прицеле — к центру экрана, где метка и луч
      const panel = document.body.classList.contains('panel-open') ? document.getElementById('panel')?.getBoundingClientRect() : null;
      const freeShift = panel && panel.left > innerWidth / 2 ? (canvas.clientWidth - panel.left) / 2 : 0;
      const shift = Math.round(freeShift * (1 - adsE) * size.x / Math.max(1, canvas.clientWidth));
      if (vmCam.aspect !== aspect || vmCam.fov !== fov || vmShift !== shift) {
        vmCam.aspect = aspect; vmCam.fov = fov; vmShift = shift;
        if (shift) vmCam.setViewOffset(size.x, size.y, shift, 0, size.x, size.y); else vmCam.clearViewOffset();
        vmCam.updateProjectionMatrix();
      }
      // руки освещены «как глаз видит»: свет делится на экспозицию сцены, днём и вечером одинаково
      const k = VM.light / Math.max(1e-3, renderer.toneMappingExposure);
      hemi.intensity = BASE.hemi * k; key.intensity = BASE.key * k; rim.intensity = BASE.rim * k;
      const prevRT = renderer.getRenderTarget(), ac = renderer.autoClear, ca = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.render(vmScene, vmCam);
      renderer.setRenderTarget(null);
      renderer.autoClear = false;
      quad.render(renderer);
      renderer.autoClear = ac;
      renderer.setClearColor(clear, ca);
      renderer.setRenderTarget(prevRT);
    },
  });

  // ---------- интерфейс ----------
  function setWeapon(id) {
    const w = byId(id);
    if (w.id === weapon) return;
    weapon = w.id; stopHold(); act = null; bloom = 0; adsK = adsE = 0;
    writePref({ weapon, sound });
    if (weapon !== 'none') { load(weapon); mount(); }
    syncDom();
    requestRender?.();
  }
  function setSound(on) { sound = !!on; writePref({ weapon, sound }); }
  function link(o = {}) {
    if (o.getWalk) getWalk = o.getWalk;
    if (o.getHunt) getHunt = o.getHunt;
  }

  function dispose() {
    stopHold();
    setZoom(1);
    pipe?.setOverlay?.(null);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.removeEventListener(t, onPointer);
    removeEventListener('blur', onBlur);
    removeEventListener('keydown', onKey);
    fireBtn.remove(); aimBtn.remove(); cross.remove(); hudEl.remove();
    for (const w of WEAPONS) document.body.classList.remove('kvm-w-' + w.id);
    document.body.classList.remove('kvm-ads');
    for (const m of Object.values(models)) m?.root?.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    flashTex.dispose(); flashMat.dispose();
    rt?.dispose(); quad?.material.dispose(); quad?.dispose();
    audio.dispose();
    impacts.dispose();
  }

  return {
    update, setWeapon, setSound, setAim, reload, link, dispose,
    clearHoles: impacts.clear,
    get holes() { return impacts.holes; },
    get weapon() { return weapon; },
    get sound() { return sound; },
    get armed() { return shown && !seated(); },
    get ammo() { const a = ammo[weapon]; return a ? { ...a } : null; },
    get busy() { return act?.kind ?? null; },
    get aiming() { return adsE; },
    get spread() { return spreadNow(); },
    get shots() { return shots; },   // счётчик выстрелов для проверок из консоли
  };
}

// ---------- панель ----------
export function registerViewmodelUI(addSection, getVM) {
  const cur = () => getVM()?.weapon ?? readPref().weapon;
  const set = id => { const vm = getVM(); if (vm) vm.setWeapon(id); else writePref({ ...readPref(), weapon: id }); };
  addSection({
    id: 'weapon', tab: 'view', title: 'Оружие в прогулке', order: 21, feature: 'walk',
    summary: () => { const w = byId(cur()); return w.id === 'none' ? '' : w.name.toLowerCase(); },
    controls: [
      { type: 'chips', key: 'vmWeapon', label: 'В руках', options: WEAPONS.map(({ id, name }) => ({ id, name })), get: cur, set },
      { type: 'toggle', key: 'vmSound', label: 'Звук выстрела', visible: () => cur() !== 'none',
        get: () => getVM()?.sound ?? readPref().sound !== false,
        set: v => { const vm = getVM(); if (vm) vm.setSound(v); else writePref({ ...readPref(), sound: !!v }); } },
      { type: 'button', key: 'vmClearHoles', label: 'Убрать следы', run: () => getVM()?.clearHoles() },
      { type: 'readout', key: 'vmKeys', style: 'hint',
        value: 'Видно только в прогулке. 1 — убрать, 2 — пистолет, 3 — автомат, 4 — винтовка, 5 — двустволка. Клик — выстрел, у автомата зажать. Правая кнопка — прицел (оружие к глазу, обзор уже). R — перезарядка, патроны пополняются при выходе из прогулки. Двойной клик — захват мыши. На телефоне — кнопки огня и прицела, счётчик патронов — перезарядка.' },
    ],
  });
}

// ---------- мелочи ----------

// Звук: синтетический выстрел (щелчок шума через затухающий фильтр + глухой удар) и механика — короткие щелчки шума
// через полосовой фильтр: [задержка с, частота Гц, длительность с, громкость]. Контекст звука — только после жеста.
const MECH = {
  empty: [[0, 3800, 0.012, 0.5]],
  magOut: [[0, 1400, 0.02, 0.6], [0.05, 900, 0.03, 0.4]],
  magIn: [[0, 1100, 0.025, 0.8], [0.03, 2600, 0.015, 0.6]],
  rack: [[0, 2200, 0.05, 0.5], [0.09, 1800, 0.03, 0.8]],
  boltUp: [[0, 2000, 0.02, 0.5]],
  boltBack: [[0, 1500, 0.06, 0.6]],
  boltFwd: [[0, 1600, 0.05, 0.6], [0.05, 2400, 0.015, 0.7]],
  boltDown: [[0, 2600, 0.015, 0.6]],
  clip: [[0, 3000, 0.04, 0.4], [0.06, 2500, 0.04, 0.4], [0.12, 2800, 0.03, 0.4]],
  shell: [[0, 900, 0.03, 0.6]],
  open: [[0, 1300, 0.03, 0.7], [0.04, 700, 0.05, 0.5]],
  close: [[0, 1000, 0.03, 0.9], [0.02, 2400, 0.012, 0.6]],
};
function createShotSound() {
  let ctx = null, noise = null;
  const ensure = () => {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  };
  const ready = () => { const c = ensure(); if (c?.state === 'suspended') c.resume().catch(() => {}); return c; };
  return {
    unlock: ready,
    play({ gain, cutoff, decay, thump }) {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      const out = c.createGain(); out.gain.value = VM.volume * gain; out.connect(c.destination);
      const src = c.createBufferSource(); src.buffer = noise;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(cutoff, t); lp.frequency.exponentialRampToValueAtTime(250, t + decay);
      const ng = c.createGain(); ng.gain.setValueAtTime(1, t); ng.gain.exponentialRampToValueAtTime(0.001, t + decay);
      src.connect(lp).connect(ng).connect(out);
      src.start(t, Math.random() * 0.3); src.stop(t + decay + 0.02);
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(thump, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const og = c.createGain(); og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(og).connect(out); o.start(t); o.stop(t + 0.15);
      src.onended = () => out.disconnect();
    },
    mech(name) {
      const c = ready(), ticks = MECH[name];
      if (!c || !ticks) return;
      const t0 = c.currentTime;
      const out = c.createGain(); out.gain.value = VM.volume * 0.9; out.connect(c.destination);
      let end = 0;
      for (const [at, f, dur, g] of ticks) {
        const t = t0 + at, src = c.createBufferSource(); src.buffer = noise;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3;
        const env = c.createGain(); env.gain.setValueAtTime(g, t); env.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(bp).connect(env).connect(out);
        src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.01);
        end = Math.max(end, at + dur);
      }
      setTimeout(() => out.disconnect(), (end + 0.1) * 1000);
    },
    dispose() { ctx?.close().catch(() => {}); ctx = null; },
  };
}

// Текстура вспышки: мягкое ядро и шесть лучей, рисуется на холсте один раз
function makeFlashTexture(THREE) {
  const n = 128, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'), c = n / 2;
  const core = g.createRadialGradient(c, c, 0, c, c, c * 0.55);
  core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.35, 'rgba(255,220,150,0.9)'); core.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = core; g.fillRect(0, 0, n, n);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, L = c * (i % 2 ? 0.7 : 0.95);
    g.save(); g.translate(c, c); g.rotate(a);
    const ray = g.createLinearGradient(0, 0, L, 0);
    ray.addColorStop(0, 'rgba(255,230,170,0.9)'); ray.addColorStop(1, 'rgba(255,150,50,0)');
    g.fillStyle = ray; g.beginPath(); g.moveTo(0, -c * 0.07); g.lineTo(L, 0); g.lineTo(0, c * 0.07); g.closePath(); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function floatButton(cls, label, svg) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls + ' kw-float'; b.hidden = true;
  b.setAttribute('aria-label', label);
  b.innerHTML = svg;
  b.addEventListener('contextmenu', e => e.preventDefault());
  document.body.appendChild(b);
  return b;
}

// Кнопки огня и прицела — справа внизу, напротив джойстика прогулки; счётчик патронов — правый нижний угол свободной
// от панели части (--shift из index.html); метка разброса — четыре чёрточки вокруг точки прицела walk.js.
// Токены --kw-* задаёт .kw-float в minimap.js.
function injectStyle() {
  if (document.getElementById('kvm-style')) return;
  const s = document.createElement('style'); s.id = 'kvm-style';
  s.textContent = `
.kvm-fire, .kvm-aim { position: fixed; z-index: 5; display: grid; place-items: center; padding: 0; cursor: pointer; border-radius: 50%;
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; border: 1px solid var(--kw-line);
  box-shadow: var(--kw-shadow); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.kvm-fire { right: max(20px, calc(env(safe-area-inset-right, 0px) + 12px)); bottom: calc(96px + env(safe-area-inset-bottom, 0px));
  width: 76px; height: 76px; color: var(--kw-accent-ink); background: color-mix(in srgb, var(--kw-accent) 88%, transparent); }
.kvm-aim { right: max(108px, calc(env(safe-area-inset-right, 0px) + 100px)); bottom: calc(106px + env(safe-area-inset-bottom, 0px));
  width: 56px; height: 56px; color: var(--kw-ink); background: color-mix(in srgb, var(--kw-sheet) 88%, transparent); }
.kvm-aim.on { color: var(--kw-accent-ink); background: var(--kw-accent); border-color: var(--kw-accent); }
.kvm-fire:active, .kvm-aim:active { transform: scale(0.94); }
.kvm-fire:focus-visible, .kvm-aim:focus-visible, .kvm-hud:focus-visible { outline: 2px solid var(--kw-accent); outline-offset: 3px; }
.kvm-fire[hidden], .kvm-aim[hidden], .kvm-hud[hidden], .kvm-cross[hidden] { display: none; }
.kvm-cross { position: fixed; z-index: 5; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; --g: 6px; transition: opacity 0.12s ease; }
.kvm-cross i { position: absolute; background: var(--kw-sheet); box-shadow: 0 0 0 1px color-mix(in srgb, var(--kw-ink) 75%, transparent); border-radius: 1px; opacity: 0.85; }
.kvm-cross i:nth-child(1), .kvm-cross i:nth-child(2) { width: 2px; height: 7px; left: -1px; }
.kvm-cross i:nth-child(3), .kvm-cross i:nth-child(4) { width: 7px; height: 2px; top: -1px; }
.kvm-cross i:nth-child(1) { bottom: var(--g); } .kvm-cross i:nth-child(2) { top: var(--g); }
.kvm-cross i:nth-child(3) { right: var(--g); } .kvm-cross i:nth-child(4) { left: var(--g); }
body.kvm-ads .kvm-cross { opacity: 0; }
.kvm-hud { position: fixed; z-index: 5; right: calc(var(--shift, 0px) * 2 + max(16px, env(safe-area-inset-right, 0px))); bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  display: grid; justify-items: end; gap: 3px; min-width: 104px; padding: 8px 12px 10px; overflow: hidden; cursor: pointer; text-align: right;
  border: 1px solid var(--kw-line); border-radius: 4px; background: var(--kw-sheet); color: var(--kw-ink); box-shadow: var(--kw-shadow);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font: 500 11px/1.2 var(--f-body, "Inter", "Helvetica Neue", Arial, sans-serif); }
.kvm-hud-name { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--kw-muted); }
.kvm-hud-ammo { display: flex; align-items: baseline; gap: 5px; font-family: var(--f-data, ui-monospace, Menlo, monospace); font-variant-numeric: tabular-nums; }
.kvm-hud-ammo b { font-size: 24px; line-height: 1; font-weight: 600; }
.kvm-hud-ammo span { font-size: 13px; color: var(--kw-muted); }
.kvm-hud.low .kvm-hud-ammo b { color: var(--kw-accent); }
.kvm-hud-note { font-size: 11px; color: var(--kw-accent); }
.kvm-hud-note:empty { display: none; }
.kvm-hud-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--kw-accent); transform: scaleX(0); transform-origin: left; }
.kvm-hud:not(.busy) .kvm-hud-bar { display: none; }
.kvm-hud.shake { animation: kvm-shake 0.28s ease; }
@keyframes kvm-shake { 25% { translate: -3px 0; } 75% { translate: 3px 0; } }
@media (min-width: 761px) and (max-width: 1099px) { .kvm-hud { bottom: calc(72px + env(safe-area-inset-bottom, 0px)); } }
@media (hover: none), (pointer: coarse) { .kvm-hud { right: max(20px, calc(env(safe-area-inset-right, 0px) + 12px)); bottom: calc(184px + env(safe-area-inset-bottom, 0px)); } }
@media (max-width: 760px) { body:has(#panel.open) :is(.kvm-fire, .kvm-aim, .kvm-hud) { display: none; } }
@media (prefers-reduced-motion: reduce) { .kvm-hud.shake { animation: none; } .kvm-cross { transition: none; } }`;
  document.head.appendChild(s);
}
