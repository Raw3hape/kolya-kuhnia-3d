// Руки с оружием в прогулке «по приколу» (вид от первого лица, как в шутерах). Настройка браузера, в код варианта не входит.
// Модели: web/models/viewmodel/ (SOURCE.md, сборка tools/viewmodel/build.py): руки и оружие одним скелетом с клипами
// idle (кадр 0 — поза держания), shoot, reload; грузятся при первом выборе. Клипы ведёт время действия, а не часы:
// в покое скелет не считается. Ствол наводится в общий с выстрелом центр через muzzle (+X),
// sight_rear/sight_front задают положение у глаза. Наведение — weapon-aim.js, после расчёта камеры рук.
// Рисуется поверх растра своей камерой со своим углом обзора (render.js setOverlay): в стены не проваливается,
// в фото-режим, снимок и GLB не попадает. Свет вспышки живёт только в сцене рук: свет и тени квартиры не трогает.
// Попадания (impacts.js): лучи из центра экрана с текущим разбросом, дырка на поверхности и всплеск; зверь (hunt.js) ближе
// стены — получает урон, вместо дырки брызги. Посуда, фрукты, стёкла и зеркала бьются, экраны трескаются (breakables.js, mirrors.js).
//
// createViewmodel({ THREE, scene, camera, renderer, pipe, canvas, requestRender, getDoors, getSeats, getWalk, getHunt })
//   getDoors()?.target / getSeats()?.target — дверь или сиденье под прицелом: тогда клик открывает/сажает, а не стреляет;
//   getSeats()?.active — сидим: оружие можно показывать, но не стрелять кликом по экрану ТВ;
//   getWalk() — прогулка (walk.js): setZoom(k) — увеличение в прицеле, kick(up, side, keep) — отдача взгляда, walking;
//   getHunt() — охота (hunt.js) или null: на выстрел noise(точка, громкость 0–1), на каждую пулю raycast(raycaster).
//   -> { update(dt, { active, moving, running }) -> bool (true — нужен кадр), setWeapon(id), setSound(on), setAim(on), reload(),
//        link({ getWalk, getHunt }) — подключить позже (проверки из консоли до того, как main.js их передаст),
//        clearHoles() — убрать следы и осколки, вернуть разбитое целым; holes, broken, weapon, sound, armed (оружие в руках: клик стреляет),
//        ammo ({ mag, reserve } у текущего), busy (null | 'reload' | 'cycle' — затвор), aiming (0–1), spread (рад),
//        shots, dispose() }
// registerViewmodelUI(addSection, getVM) — раздел «Оружие» во вкладке 'live' после «Сесть»; клавиши — строки справки (help.js).
// Ввод в прогулке: 1 — убрать, 2 — пистолет, 3 — автомат, 4 — винтовка, 5 — двустволка, 6 — Uzi; R — перезарядка
// (E занята: дверь, сесть; клавиши показывает ui.js из строк справки ниже). Мышь: ЛКМ — выстрел (без прицела: клик, перетаскивание —
// взгляд), ПКМ зажать — прицел (оружие к глазу, обзор уже, мышь медленнее, перетаскивание ведёт взгляд); в прицеле и в захвате
// мыши (двойной клик) ЛКМ стреляет сразу, автомат — очередью, пока зажата. Телефон: касания — взгляд, справа кнопки огня
// и прицела, нажатие на счётчик патронов — перезарядка. Пустой магазин: щелчок и сама начинается перезарядка.
// Патроны: магазин и запас у каждого оружия свои; выход из прогулки всё пополняет.
// Покой: покачивание дыхания затухает за VM.settle секунд, дальше update() возвращает false и кадров не просит.
import { createShotRenderer } from './multiplayer/shots.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { createImpacts } from './impacts.js';
import { WEAPON_RULES, refillMagazine } from './multiplayer/rules.js';
import { addHelp } from './help.js';
import { createWeaponAim } from './weapon-aim.js';
import { WEAPONS, WEAPON_KEYS, weaponById as byId } from './weapon-catalog.js';
import { createShotSound, makeFlashTexture } from './weapon-fx.js';
import { loadWeaponModel, clipPose, disposeWeaponModel } from './weapon-models.js';

export { WEAPONS } from './weapon-catalog.js';

addHelp(
  { mode: 'walk', topic: 'weapon', keys: WEAPONS.slice(1).map((_, i) => String(i + 2)), text: 'пистолет, автомат, винтовка, двустволка, Uzi; 1 — убрать', touch: 'оружие — во вкладке «Прогулка» → «Оружие»', order: 100 },
  { mode: 'walk', topic: 'weapon', keys: ['клик'], text: 'выстрел, у автомата — зажать', touch: 'круглая кнопка справа — выстрел', order: 110 },
  { mode: 'walk', topic: 'weapon', keys: ['ПКМ'], text: 'прицел: оружие к глазу, обзор уже', touch: 'кнопка с рамкой — прицел', order: 120 },
  { mode: 'walk', topic: 'weapon', keys: ['R'], text: 'перезарядка; патроны пополняются при выходе из прогулки', touch: 'нажмите на счётчик патронов — перезарядка', order: 130 },
);

const VM = {
  fovV: 50,          // вертикальный угол камеры рук (на портретном экране — так, чтобы по ширине было столько же)
  raise: 0.35,       // руки поднимаются при входе и смене оружия, с
  fireRaise: 0.7,    // доля подъёма, с которой принимается выстрел
  settle: 2.5,       // через сколько секунд покоя затихает дыхание
  hold: 180,         // мс удержания без движения мыши, после которых автомат начинает очередь
  drag: 5,           // px: дальше — это взгляд, не выстрел
  flashTime: 0.05,   // с
  light: 1.3,        // яркость подсветки рук относительно экспозиции сцены
  adsSway: 0.15,     // покачивание и инерция рук в прицеле — доля от обычного
  adsVm: 0.5,        // насколько сужается обзор камеры рук в прицеле (доля от корня увеличения сцены)
  adsBloom: 0.3,     // рост разброса за выстрел в прицеле — доля от обычного
  adsRecoil: 0.45,   // отдача взгляда в прицеле — доля от обычной
  dry: 0.25,         // щелчок пустого не чаще, с
};
const PREF = 'kitchen-viewmodel-v1';   // { weapon, sound }

function readPref() {
  try { return { weapon: 'none', sound: true, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { weapon: 'none', sound: true }; }
}
function writePref(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* хранилище недоступно */ } }
const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const coarse = () => { try { return matchMedia('(hover: none), (pointer: coarse)').matches; } catch { return false; } };
const rand = (a, b) => a + Math.random() * (b - a);

export function createViewmodel({ THREE, scene, camera, renderer, pipe, canvas, requestRender, getDoors, getSeats, getWalk, getHunt }) {
  const aimed = () => !!(getDoors?.()?.target || getSeats?.()?.target);   // клик достаётся двери или сиденью
  const seated = () => !!getSeats?.()?.active;
  const pref = readPref();
  let weapon = byId(pref.weapon).id, sound = pref.sound !== false;
  let networkAdapter = null;

  // ---------- сцена рук ----------
  const vmScene = new THREE.Scene();
  const vmCam = new THREE.PerspectiveCamera(VM.fovV, 1, 0.01, 5);
  const aim = createWeaponAim(THREE), restRotation = new THREE.Quaternion();
  const hemi = new THREE.HemisphereLight('#f4f1ea', '#4e4a45', 1.7);
  const key = new THREE.DirectionalLight('#fff4e6', 2.2); key.position.set(-0.6, 1, 0.5);
  const rim = new THREE.DirectionalLight('#dfe8ff', 0.8); rim.position.set(1, 0.3, -1);
  const BASE = { hemi: hemi.intensity, key: key.intensity, rim: rim.intensity };
  const rig = new THREE.Group();
  vmScene.add(hemi, key, rim, rig);

  // вспышка: спрайт с лучами + короткий свет, оба у дула
  const flashTex = makeFlashTexture(THREE);
  const flashMat = new THREE.SpriteMaterial({ map: flashTex, color: new THREE.Color(3.2, 2.3, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true });
  // дуло из глаз закрыто затвором: вспышка рисуется поверх ствола и чуть впереди дула (у пустышки muzzle ствол — её +X)
  const flashSprite = new THREE.Sprite(flashMat); flashSprite.visible = false; flashSprite.renderOrder = 10; flashSprite.position.x = 0.02;
  const flashLight = new THREE.PointLight('#ffb36b', 0, 0.8, 2);   // всегда в сцене: число источников не меняется, шейдеры не пересобираются

  // модель: { root, mixer, acts: { idle, shoot?, reload? } (действия клипов), flash (крепление вспышки у дула), ads (поза прицела) }
  const models = {};
  let disposed = false;
  function load(id) {
    const w = byId(id);
    if (!w.file || models[id]) return;
    models[id] = loadWeaponModel(THREE, w, aim).then(m => {
      if (disposed) { disposeWeaponModel(m); return; }
      models[id] = m;
      if (id === weapon) mount();
    }).catch(err => { console.warn('viewmodel.js: модель не загрузилась', w.file, err); delete models[id]; });
  }

  let mounted = null;    // id смонтированной модели
  function mount() {
    const m = models[weapon];
    if (mounted === weapon && m?.root?.parent === rig) return;
    rig.clear(); mounted = null;
    if (!m?.root) return;
    rig.add(m.root);
    m.flash.add(flashSprite, flashLight);
    clipName = null; clipPose(m, 'idle', 0);
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
  let rec = 0, recV = 0, flash = 0, lastShot = -1e9, lastDry = -1e9, holding = false, spd = 0, shots = 0;
  let aimHeld = false, adsK = 0, adsE = 0, zoomSet = 1, bloom = 0, mvNow = false, runNow = false;
  let act = null;        // { kind: reload | cycle, t, dur, ev: [[доля, звук, патроны?]], i, fill } — перезарядка или затвор
  let clipName = null, clipT = 0, clipDur = 0;   // клип, который сейчас идёт (null — поза держания)
  const lastPos = new THREE.Vector3(), fwd = new THREE.Vector3(), ear = new THREE.Vector3();
  let lastYaw = null, lastPitch = 0;
  const W = () => byId(weapon);
  const impacts = createImpacts({ THREE, scene, camera, renderer, pipe, requestRender, getSound: () => sound });

  const tracers = createShotRenderer({ THREE, scene, requestRender });
  const muzzleByShot = new Map();
  const worldMuzzle = new THREE.Vector3(), vmPoint = new THREE.Vector3();
  function muzzlePosition() {
    const muzzle = models[weapon]?.muzzle;
    if (!muzzle) return null;
    muzzle.getWorldPosition(vmPoint);
    const depth = -vmPoint.z;
    if (depth <= camera.near) return null;
    // Map the hands' separate FOV and viewport onto the visible world-camera pixel.
    camera.updateWorldMatrix(true, false);
    vmPoint.project(vmCam);
    worldMuzzle.set(vmPoint.x, vmPoint.y, 0).unproject(camera).sub(camera.position);
    worldMuzzle.multiplyScalar(depth / vmPoint.set(0, 0, -1).applyQuaternion(camera.quaternion).dot(worldMuzzle))
      .add(camera.position);
    return worldMuzzle;
  }
  function showHitMarker(destroyed) {
    if (!shown || pipe.photo) return;
    hitMarker.dataset.result = destroyed ? 'destroyed' : 'hit';
    hitAnimation?.cancel();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    hitAnimation = hitMarker.animate([
      { opacity: 1, scale: reduced ? 1 : destroyed ? 1.28 : 1.14 },
      { opacity: 1, scale: 1, offset: .34 },
      { opacity: 0, scale: 1 },
    ], { duration: destroyed ? 360 : 215 });
  }
  function showNetworkShot(shot, { local, origin }) {
    impacts.applyNetworkShot(shot);
    const range = WEAPON_RULES[shot.weapon]?.range;
    if (range) tracers.shot(shot, { origin: local ? muzzleByShot.get(shot.shotId) : origin, range });
    if (local) muzzleByShot.delete(shot.shotId);
    let confirmed = !!shot.hits?.length, destroyed = !!shot.hits?.some(hit => hit.killed);
    for (const ray of shot.rays || []) {
      const hit = ray.vehicleHit;
      if (!hit) continue;
      impacts.vehicleImpact(hit, ray.direction);
      if (hit.hp !== undefined) { confirmed = true; destroyed ||= hit.destroyed; }
    }
    if (local && confirmed) showHitMarker(destroyed);
  }

  // частицы попаданий живут и после выхода из прогулки, поэтому считаются отдельно от рук
  function update(dt = 1 / 60, opts) {
    const fx = impacts.update(dt);
    const trace = tracers.update(dt, !pipe.photo);
    return hands(dt, opts) || fx || trace;
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
      if (!show) { hitAnimation?.cancel(); stopHold(); aimHeld = false; adsK = adsE = 0; act = null; lastYaw = null; setZoom(1); syncDom(); return true; }   // ещё кадр — убрать руки
      raise = 0; quiet = 0; lastPos.copy(camera.position);
      clipName = null; clipPose(models[weapon], 'idle', 0);
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

    // действие (перезарядка, затвор): звуки и патроны по доле времени, в конце — снова можно стрелять
    if (act) {
      act.t += dt;
      while (act.i < act.ev.length && act.ev[act.i][0] * act.dur <= act.t) {
        const e = act.ev[act.i++];
        mech(e[1]);
        if (e[2]) act.fill();
      }
      if (act.t >= act.dur) { act = null; hud(); }
    }
    // клип модели идёт за своим временем; кончился — поза держания
    if (clipName) {
      clipT += dt;
      const m = models[weapon];
      if (clipT >= clipDur) { clipName = null; clipPose(m, 'idle', 0); } else clipPose(m, clipName, clipT / clipDur);
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
    syncFireReadiness();
    flash = Math.max(0, flash - dt);
    const busy = mv || Math.abs(dYaw) + Math.abs(dPitch) > 1e-4 || holding || flash > 0 || raise < 1 || act || clipName || bloom > 0 || (adsK > 0 && adsK < 1);
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
  function pose(breath) {
    const w = W(), t = performance.now() / 1000, A = models[weapon].ads, a = adsE;
    const e = 1 - (1 - raise) ** 3, h = 1 - a * (1 - VM.adsSway);
    const bx = Math.sin(phase) * 0.011 * bobAmp, by = (Math.cos(2 * phase) - 1) * 0.0065 * bobAmp;
    const br = Math.sin(t * 1.6) * 0.0018 * breath, bs = Math.sin(t * 0.8) * 0.0012 * breath;
    const L = THREE.MathUtils.lerp;
    rig.position.set(
      L(w.pos[0], A.x, a) + (bx + lagX + bs) * h,
      L(w.pos[1], A.y, a) + (by + lagY + br) * h - (1 - e) * 0.22,
      L(w.pos[2], A.z, a) + rec * w.kick.back * (1 - 0.4 * a));
    rig.rotation.set(
      -(1 - e) * 0.7,
      0,
      (w.cant ?? 0) * (1 - a) + (Math.sin(phase) * 0.025 * bobAmp - lagX * 1.5) * h, 'YXZ');
    restRotation.copy(rig.quaternion);
    flashSprite.visible = flash > 0;
    flashLight.intensity = flash > 0 ? 3 * (flash / VM.flashTime) : 0;
    crosshair();
    if (act) hudProgress();
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
    if (!readyToFire() || aimed()) return false;
    if (now - lastShot < 1000 / w.rate) return false;
    const a = ammo[w.id];
    if (a.mag <= 0) { dry(); return false; }
    lastShot = now; shots++; a.mag--;
    const hunt = getHunt?.() ?? null;
    const muzzle = muzzlePosition();
    const shot = { spread: spreadNow(), pellets: w.pellets || 1, range: w.range, weapon: w.id };
    if (networkAdapter) {
      const shotId = crypto.randomUUID();
      if (muzzle) muzzleByShot.set(shotId, muzzle.toArray());
      if (muzzleByShot.size > 64) muzzleByShot.delete(muzzleByShot.keys().next().value);
      networkAdapter.shoot?.({ ...impacts.captureShot(shot), shotId });
    } else {
      hunt?.noise?.(ear.copy(camera.position), w.loud);
      let confirmed = false, destroyed = false;
      impacts.shoot({ ...shot, hunt, damage: w.damage, onRay(origin, direction, end, targetHit) {
        if (!muzzle || vmPoint.subVectors(end, muzzle).dot(direction) > .03) tracers.trace(muzzle ?? origin, end, w.id);
        if (targetHit) { confirmed = true; destroyed ||= targetHit.destroyed || targetHit.killed; }
      } });
      if (confirmed) showHitMarker(destroyed);
    }
    bloom = Math.min(w.spread.max, bloom + w.spread.bloom * (1 - (1 - VM.adsBloom) * adsE));
    const r = w.recoil, k = 1 - (1 - VM.adsRecoil) * adsE;
    getWalk?.()?.kick?.(r.up * k * rand(0.85, 1.15), r.side * k * rand(-1, 1), r.keep);
    recV += 26 * (0.85 + Math.random() * 0.3);
    flash = VM.flashTime;
    const s = w.flash * (0.8 + Math.random() * 0.4);
    flashSprite.scale.set(s, s, s);
    flashMat.rotation = Math.random() * Math.PI * 2;
    quiet = 0;
    if (sound) audio.play(w.sound);
    if (w.action === 'bolt') begin('cycle', 'shoot', w.cycle, w.cycleEv, -0.12);
    else if (w.shot) playClip('shoot', w.shot);
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

  // клип модели на dur секунд; t < 0 — с задержкой (затвор после выстрела)
  function playClip(name, dur, t = 0) {
    if (!models[weapon]?.acts?.[name]) return;
    clipName = name; clipT = t; clipDur = dur;
  }
  // действие: клип и звуки по долям времени; fill — патроны в магазин (на событии с пометкой)
  function begin(kind, clip, dur, ev, t = 0, fill = null) {
    act = { kind, t, dur, ev, i: 0, fill };
    playClip(clip, dur, t);
    quiet = 0; holding = false;
    hud();
    requestRender?.();
  }
  function reload() {
    const w = W(), a = ammo[w.id];
    if (!shown || act || !a || a.mag >= w.mag || !w.infiniteReserve && a.reserve <= 0) return false;
    networkAdapter?.reload?.(w.id);
    begin('reload', 'reload', w.reload, w.reloadEv, 0, () => { refillMagazine(a, w); hud(); });
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
  Object.assign(KEYS, WEAPON_KEYS);
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
    if (!readyToFire()) return;
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
  const hitMarker = document.createElement('div');
  hitMarker.className = 'kvm-hit-marker';
  hitMarker.setAttribute('aria-hidden', 'true');
  hitMarker.innerHTML = '<i></i><i></i><i></i><i></i>';
  document.body.append(hitMarker);
  let hitAnimation = null;
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
    const note = act ? (act.kind === 'cycle' ? 'Передёргиваем затвор…' : 'Перезарядка…') :
      shown && (mounted !== weapon || raise < VM.fireRaise) ? 'Поднимаем оружие…' :
      a.mag === 0 ? (w.infiniteReserve || a.reserve ? 'R — перезарядить' : 'Патроны кончились') : '';
    const k = `${w.id}|${a.mag}|${a.reserve}|${note}|${empty}`;
    if (k === hudKey) return;
    hudKey = k;
    hName.textContent = w.name;
    hAmmo.children[0].textContent = a.mag;
    hAmmo.children[1].textContent = '/ ' + (w.infiniteReserve ? '∞' : a.reserve);
    hNote.textContent = note;
    hudEl.classList.toggle('low', a.mag <= Math.ceil(w.mag / 4));
    hudEl.classList.toggle('busy', !!act && act.kind !== 'cycle');
    hudEl.setAttribute('aria-label', `${w.name}: ${a.mag} в магазине, ${w.infiniteReserve ? 'бесконечный запас' : a.reserve + ' в запасе'}${note ? '. ' + note : ''}`);
    if (empty) { hudEl.classList.remove('shake'); void hudEl.offsetWidth; hudEl.classList.add('shake'); }
    if (!act) hBar.style.transform = '';
  }
  function hudProgress() { if (act.kind !== 'cycle') hBar.style.transform = `scaleX(${Math.min(1, Math.max(0, act.t / act.dur)).toFixed(3)})`; }

  // классы на body (ui.js следит за ними) и видимость плавающих элементов
  function readyToFire() {
    return !!W().rate && shown && mounted === weapon && raise >= VM.fireRaise && !act && !seated();
  }
  function syncFireReadiness() {
    const disabled = !readyToFire();
    if (fireBtn.disabled === disabled) return;
    fireBtn.disabled = disabled; fireBtn.setAttribute('aria-busy', String(disabled));
    if (shown) hud();
  }
  function syncDom() {
    for (const w of WEAPONS) document.body.classList.toggle('kvm-w-' + w.id, w.id !== 'none' && weapon === w.id);
    if (!shown) document.body.classList.remove('kvm-ads');
    const touch = touchSeen || coarse();
    fireBtn.hidden = aimBtn.hidden = !(shown && touch);
    syncFireReadiness();
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
      // Restore presentation first: repeated idle renders must not accumulate
      // rotations. Reload/cycle keep their authored handling animation; drawing
      // and recoil translate the hands while the ready barrel stays on target.
      rig.quaternion.copy(restRotation);
      if (!act) aim.align(rig, models[weapon].muzzle, vmCam, W().range);
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
    weapon = w.id; stopHold(); act = null; clipName = null; bloom = 0; adsK = adsE = 0;
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
    disposed = true;
    stopHold();
    setZoom(1);
    pipe?.setOverlay?.(null);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.removeEventListener(t, onPointer);
    removeEventListener('blur', onBlur);
    removeEventListener('keydown', onKey);
    fireBtn.remove(); aimBtn.remove(); cross.remove(); hudEl.remove(); hitAnimation?.cancel(); hitMarker.remove();
    for (const w of WEAPONS) document.body.classList.remove('kvm-w-' + w.id);
    document.body.classList.remove('kvm-ads');
    for (const m of Object.values(models)) {
      m?.mixer?.stopAllAction();
      if (m?.root) disposeWeaponModel(m);
    }
    flashTex.dispose(); flashMat.dispose();
    rt?.dispose(); quad?.material.dispose(); quad?.dispose();
    audio.dispose();
    impacts.dispose();
    tracers.dispose();
  }

  return {
    update, setWeapon, setSound, setAim, reload, link, dispose,
    get fireReady() { return readyToFire(); },
    setNetwork(adapter) { networkAdapter = adapter || null; muzzleByShot.clear(); tracers.clear(); hitAnimation?.cancel(); impacts.setNetwork(!!networkAdapter); },
    showNetworkShot, showHitMarker,
    applyBroken: impacts.applyBroken,
    reconcileNetworkDamage: impacts.reconcileNetworkDamage,
    collectNetworkObjects: impacts.collectNetworkObjects,
    resolveNetworkSurfaces: impacts.resolveNetworkSurfaces,
    applyNetworkAmmo(snapshot) {
      for (const [id, value] of Object.entries(snapshot ?? {})) {
        if (!ammo[id] || !Number.isFinite(value?.mag) || !Number.isFinite(value?.reserve)) continue;
        ammo[id] = { mag: Math.max(0, Math.floor(value.mag)), reserve: Math.max(0, Math.floor(value.reserve)) };
      }
      syncDom();
    },
    clearHoles({ remote = false } = {}) {
      if (networkAdapter && !remote) networkAdapter.clear?.(); else { impacts.clear(); tracers.clear(); hitAnimation?.cancel(); }
    },
    get brokenIds() { return impacts.brokenIds; },
    get networkRaycasts() { return impacts.raycastStatus; },
    get networkDamage() { return impacts.networkDamage; },
    get holes() { return impacts.holes; },
    get broken() { return impacts.broken; },
    get weapon() { return weapon; },
    get sound() { return sound; },
    get armed() { return shown && !seated(); },
    get ammo() { const a = ammo[weapon]; return a ? { ...a, infiniteReserve: !!W().infiniteReserve } : null; },
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
    id: 'weapon', tab: 'live', title: 'Оружие', order: 30, feature: 'walk',
    summary: () => { const w = byId(cur()); return w.id === 'none' ? '' : w.name.toLowerCase(); },
    controls: [
      { type: 'chips', key: 'vmWeapon', label: 'В руках', options: WEAPONS.map(({ id, name }) => ({ id, name })), get: cur, set },
      { type: 'toggle', key: 'vmSound', label: 'Звук выстрела', visible: () => cur() !== 'none',
        get: () => getVM()?.sound ?? readPref().sound !== false,
        set: v => { const vm = getVM(); if (vm) vm.setSound(v); else writePref({ ...readPref(), sound: !!v }); } },
      { type: 'button', key: 'vmClearHoles', label: 'Убрать следы и осколки', run: () => getVM()?.clearHoles() },
      { type: 'readout', key: 'vmBreakHint', style: 'hint', visible: () => cur() !== 'none',
        value: 'Посуда, фрукты, стёкла и зеркала бьются, экраны трескаются. Кнопка выше всё чинит.' },
      { type: 'readout', key: 'vmWhere', style: 'hint', value: 'Оружие видно только в прогулке.' },
      { type: 'help', topic: 'weapon' },
      { type: 'readout', key: 'vmCredits', style: 'hint', visible: () => cur() !== 'none',
        value: 'Модели: руки и оружие — J-Toastie, винтовка — AdamKokrito (poly.pizza, CC-BY 3.0), обрез — Quaternius (CC0).' },
    ],
  });
}

// ---------- мелочи ----------

// Звук: синтетический выстрел (щелчок шума через затухающий фильтр + глухой удар) и механика — короткие щелчки шума
// через полосовой фильтр: [задержка с, частота Гц, длительность с, громкость]. Контекст звука — только после жеста.
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
.kvm-fire { right: max(20px, calc(env(safe-area-inset-right, 0px) + 12px)); bottom: calc(var(--hud-bottom, 76px) + 20px);
  width: 76px; height: 76px; color: var(--kw-accent-ink); background: color-mix(in srgb, var(--kw-accent) 88%, transparent); }
.kvm-aim { right: max(108px, calc(env(safe-area-inset-right, 0px) + 100px)); bottom: calc(var(--hud-bottom, 76px) + 30px);
  width: 56px; height: 56px; color: var(--kw-ink); background: color-mix(in srgb, var(--kw-sheet) 88%, transparent); }
.kvm-aim.on { color: var(--kw-accent-ink); background: var(--kw-accent); border-color: var(--kw-accent); }
.kvm-fire:active, .kvm-aim:active { transform: scale(0.94); }
.kvm-fire:disabled { opacity: 0.45; cursor: wait; }
.kvm-fire:focus-visible, .kvm-aim:focus-visible, .kvm-hud:focus-visible { outline: 2px solid var(--kw-accent); outline-offset: 3px; }
.kvm-fire[hidden], .kvm-aim[hidden], .kvm-hud[hidden], .kvm-cross[hidden] { display: none; }
.kvm-cross { position: fixed; z-index: 5; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; --g: 6px; transition: opacity 0.12s ease; }
.kvm-cross i { position: absolute; background: var(--kw-sheet); box-shadow: 0 0 0 1px color-mix(in srgb, var(--kw-ink) 75%, transparent); border-radius: 1px; opacity: 0.85; }
.kvm-cross i:nth-child(1), .kvm-cross i:nth-child(2) { width: 2px; height: 7px; left: -1px; }
.kvm-cross i:nth-child(3), .kvm-cross i:nth-child(4) { width: 7px; height: 2px; top: -1px; }
.kvm-cross i:nth-child(1) { bottom: var(--g); } .kvm-cross i:nth-child(2) { top: var(--g); }
.kvm-cross i:nth-child(3) { right: var(--g); } .kvm-cross i:nth-child(4) { left: var(--g); }
body.kvm-ads .kvm-cross { opacity: 0; }
.kvm-hit-marker { position: fixed; left: 50%; top: 50%; width: 32px; height: 32px; translate: -50% -50%; z-index: 13; pointer-events: none; color: #fff4d7; opacity: 0; }
.kvm-hit-marker[data-result="destroyed"] { color: #ff5948; }
.kvm-hit-marker i { position: absolute; top: 15px; left: 15px; width: 6px; height: 2px; background: currentColor; border-radius: 1px; box-shadow: 0 0 1px 1px #20140e, 0 0 5px currentColor; transform-origin: 1px center; transform: rotate(var(--angle)) translateX(5px); }
.kvm-hit-marker[data-result="destroyed"] i { width: 8px; }
.kvm-hit-marker i:nth-child(1) { --angle: 45deg; }
.kvm-hit-marker i:nth-child(2) { --angle: 135deg; }
.kvm-hit-marker i:nth-child(3) { --angle: 225deg; }
.kvm-hit-marker i:nth-child(4) { --angle: 315deg; }
.kvm-hud { position: fixed; z-index: 5; right: calc(var(--shift, 0px) * 2 + max(16px, env(safe-area-inset-right, 0px))); bottom: var(--hud-bottom, 76px);
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
@media (hover: none), (pointer: coarse) { .kvm-hud { right: max(20px, calc(env(safe-area-inset-right, 0px) + 12px)); bottom: calc(var(--hud-bottom, 76px) + 172px); } }
@media (max-width: 800px) { body:has(#panel.open) :is(.kvm-fire, .kvm-aim, .kvm-hud) { display: none; } }
@media (prefers-reduced-motion: reduce) { .kvm-hud.shake { animation: none; } .kvm-cross { transition: none; } }`;
  document.head.appendChild(s);
}
