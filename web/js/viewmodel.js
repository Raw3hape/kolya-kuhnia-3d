// Руки с оружием в прогулке «по приколу» (вид от первого лица, как в шутерах). Настройка браузера, в код варианта не входит.
// Модели: web/models/viewmodel/ (SOURCE.md): стволы Quaternius (CC0) и процедурные перчатки с рукавами, грузятся при первом выборе.
// Рисуется поверх растра своей камерой со своим углом обзора (render.js setOverlay): в стены не проваливается,
// в фото-режим, снимок и GLB не попадает. Свет вспышки живёт только в сцене рук: свет и тени квартиры не трогает.
//
// createViewmodel({ THREE, scene, camera, renderer, pipe, canvas, requestRender, getDoors, getSeats })
//   getDoors()?.target / getSeats()?.target — дверь или сиденье под прицелом: тогда клик открывает/сажает, а не стреляет;
//   getSeats()?.active — сидим: оружие можно показывать, но не стрелять кликом по экрану ТВ
//   -> { update(dt, { active, moving, running }) -> bool (true — нужен кадр), setWeapon(id), setSound(on),
//        weapon, sound, armed (оружие сейчас в руках: клик стреляет), shots, dispose() }
// registerViewmodelUI(addSection, getVM) — раздел «Оружие» во вкладке 'view' сразу после «Прогулки».
// Ввод в прогулке: 1 — убрать, 2 — пистолет, 3 — автомат (E занята: дверь, сесть; подсказку клавиш показывает walk.js). Мышь: клик — выстрел, перетаскивание —
// взгляд, как раньше; автомат стреляет очередью, пока кнопка зажата без движения или в захвате мыши (двойной клик).
// Телефон: касания только для взгляда, стреляет экранная кнопка.
// Покой: покачивание дыхания затухает за VM.settle секунд, дальше update() возвращает false и кадров не просит.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// pos — место центра рукояти в пространстве камеры рук (м): вправо, вверх, вперёд = −z; yaw — доворот к центру экрана,
// pitch — подъём ствола, рад.
// rate — выстрелов в секунду; kick — откат (back — назад, м; pitch — подброс, рад); flash — размер вспышки, м.
export const WEAPONS = [
  { id: 'none', name: 'Нет' },
  { id: 'pistol', name: 'Пистолет', file: 'pistol.glb', pos: [0.1, -0.112, -0.42], yaw: 0.16, auto: false, rate: 6,
    kick: { back: 0.045, pitch: 0.2 }, flash: 0.13, sound: { gain: 1, cutoff: 3200, decay: 0.16, thump: 150 } },
  { id: 'rifle', name: 'Автомат', file: 'rifle.glb', pos: [0.14, -0.2, -0.56], yaw: 0.03, pitch: 0.05, auto: true, rate: 10,
    kick: { back: 0.026, pitch: 0.06 }, flash: 0.2, sound: { gain: 0.8, cutoff: 2400, decay: 0.12, thump: 110 } },
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
};
const PREF = 'kitchen-viewmodel-v1';   // { weapon, sound }
const MODELS = new URL('../models/viewmodel/', import.meta.url);
const byId = id => WEAPONS.find(w => w.id === id) || WEAPONS[0];

function readPref() {
  try { return { weapon: 'none', sound: true, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { weapon: 'none', sound: true }; }
}
function writePref(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* хранилище недоступно */ } }
const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const coarse = () => { try { return matchMedia('(hover: none), (pointer: coarse)').matches; } catch { return false; } };

export function createViewmodel({ THREE, camera, renderer, pipe, canvas, requestRender, getDoors, getSeats }) {
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

  const models = {};     // id -> { root, muzzle } | Promise
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
      const muzzle = root.getObjectByName('muzzle') || root;
      models[id] = { root, muzzle };
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

  // ---------- состояние анимации ----------
  let shown = false, raise = 1, quiet = 0, bobAmp = 0, phase = 0, lagX = 0, lagY = 0;
  let rec = 0, recV = 0, recYaw = 0, flash = 0, lastShot = -1e9, holding = false, spd = 0, shots = 0;
  const lastPos = new THREE.Vector3(), fwd = new THREE.Vector3();
  let lastYaw = null, lastPitch = 0;
  const W = () => byId(weapon);

  function update(dt = 1 / 60, { active = false, moving = false, running = false } = {}) {
    const want = active && weapon !== 'none';
    if (want && !models[weapon]) load(weapon);
    if (want && mounted !== weapon && models[weapon]?.root) mount();
    const show = want && mounted === weapon;
    if (show !== shown) {
      shown = show;
      syncDom();
      if (!show) { stopHold(); lastYaw = null; return true; }   // ещё один кадр — убрать руки с экрана
      raise = 0; quiet = 0; lastPos.copy(camera.position);
    }
    if (!show) return false;
    dt = Math.min(Math.max(dt, 1e-4), 0.1);

    // движение: из walk (moving/running) или по скорости камеры, если walk их пока не отдаёт
    const v = Math.hypot(camera.position.x - lastPos.x, camera.position.z - lastPos.z) / dt;
    lastPos.copy(camera.position);
    spd += ((v < 8 ? v : 0) - spd) * Math.min(1, dt * 10);   // скачок (телепорт) не считается шагом
    const mv = moving || spd > 0.35, run = running || spd > 2.2;

    // поворот взгляда -> инерция рук
    camera.getWorldDirection(fwd);
    const yaw = Math.atan2(-fwd.x, -fwd.z), pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    let dYaw = 0, dPitch = 0;
    if (lastYaw != null) { dYaw = Math.atan2(Math.sin(yaw - lastYaw), Math.cos(yaw - lastYaw)); dPitch = pitch - lastPitch; }
    lastYaw = yaw; lastPitch = pitch;
    const lk = 1 - Math.exp(-10 * dt);
    lagX += (THREE.MathUtils.clamp((dYaw / dt) * 0.012, -0.035, 0.035) - lagX) * lk;
    lagY += (THREE.MathUtils.clamp(-(dPitch / dt) * 0.010, -0.025, 0.025) - lagY) * lk;

    if (holding && W().auto) fire();

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
    const busy = mv || Math.abs(dYaw) + Math.abs(dPitch) > 1e-4 || holding || flash > 0 || raise < 1;
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

  function pose(breath) {
    const w = W(), t = performance.now() / 1000;
    const e = 1 - (1 - raise) ** 3;
    const bx = Math.sin(phase) * 0.011 * bobAmp, by = (Math.cos(2 * phase) - 1) * 0.0065 * bobAmp;
    const br = Math.sin(t * 1.6) * 0.0018 * breath, bs = Math.sin(t * 0.8) * 0.0012 * breath;
    rig.position.set(w.pos[0] + bx + lagX + bs, w.pos[1] + by + lagY + br - (1 - e) * 0.22, w.pos[2] + rec * w.kick.back);
    rig.rotation.set((w.pitch || 0) + rec * w.kick.pitch - (1 - e) * 0.7 + lagY * 2, w.yaw + lagX * 2.5 + recYaw * rec, Math.sin(phase) * 0.025 * bobAmp - lagX * 1.5, 'YXZ');
    flashSprite.visible = flash > 0;
    flashLight.intensity = flash > 0 ? 3 * (flash / VM.flashTime) : 0;
  }

  // ---------- выстрел ----------
  const audio = createShotSound();
  function fire() {
    const w = W(), now = performance.now();
    if (!shown || raise < 0.7 || aimed()) return false;
    if (now - lastShot < 1000 / w.rate) return false;
    lastShot = now; shots++;
    recV += 26 * (0.85 + Math.random() * 0.3);
    recYaw = (Math.random() - 0.5) * 0.25;
    flash = VM.flashTime;
    const s = w.flash * (0.8 + Math.random() * 0.4);
    flashSprite.scale.set(s, s, s);
    flashMat.rotation = Math.random() * Math.PI * 2;
    quiet = 0;
    if (sound) audio.play(w.sound);
    requestRender?.();
    return true;
  }

  // мышь: в захвате — как в шутере; без захвата клик стреляет, перетаскивание остаётся взглядом
  let press = null, holdTimer = 0;
  const locked = () => document.pointerLockElement === canvas;
  function stopHold() { holding = false; clearTimeout(holdTimer); press = null; }
  const onDown = e => {
    if (e.pointerType === 'touch') { touchSeen = true; syncDom(); return; }   // касание — только взгляд
    if (e.button !== 0 || !shown || aimed() || seated()) return;   // клик открывает дверь / сажает; сидя не стреляем
    if (sound) audio.unlock();
    if (locked()) { press = { id: e.pointerId, started: true }; fire(); holding = W().auto; return; }
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, started: false };
    if (W().auto) holdTimer = setTimeout(() => { if (press && !press.moved) { press.started = true; holding = true; fire(); } }, VM.hold);
  };
  const onMove = e => {
    if (!press || press.started || e.pointerId !== press.id) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > VM.drag) { press.moved = true; clearTimeout(holdTimer); }
  };
  const onUp = e => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.moved && !press.started) fire();
    stopHold();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', stopHold);
  addEventListener('blur', stopHold);

  // клавиши 1–3 в прогулке (панель в прогулке цифры не перехватывает)
  const KEYS = { Digit1: 'none', Digit2: 'pistol', Digit3: 'rifle', Numpad1: 'none', Numpad2: 'pistol', Numpad3: 'rifle' };
  const onKey = e => {
    if (!KEYS[e.code] || e.repeat || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!document.body.classList.contains('kw-walking')) return;
    setWeapon(KEYS[e.code]); e.preventDefault();
  };
  addEventListener('keydown', onKey);

  // кнопка огня на телефоне
  let touchSeen = false;
  injectStyle();
  const fireBtn = document.createElement('button');
  fireBtn.type = 'button'; fireBtn.className = 'kvm-fire kw-float'; fireBtn.hidden = true;
  fireBtn.setAttribute('aria-label', 'Выстрел');
  fireBtn.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 1.5v6M13 18.5v6M1.5 13h6M18.5 13h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="13" cy="13" r="1.8" fill="currentColor"/></svg>';
  document.body.appendChild(fireBtn);
  let btnId = null;
  fireBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btnId = e.pointerId;
    try { fireBtn.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    if (sound) audio.unlock();
    fire(); holding = W().auto;
    requestRender?.();
  });
  const btnUp = e => { if (e.pointerId === btnId) { btnId = null; holding = false; } };
  fireBtn.addEventListener('pointerup', btnUp);
  fireBtn.addEventListener('pointercancel', btnUp);
  fireBtn.addEventListener('contextmenu', e => e.preventDefault());

  // класс на body: показать кнопку огня и обновить панель (ui.js следит за классами body)
  function syncDom() {
    document.body.classList.toggle('kvm-w-pistol', weapon === 'pistol');
    document.body.classList.toggle('kvm-w-rifle', weapon === 'rifle');
    fireBtn.hidden = !(shown && (touchSeen || coarse()));
  }
  syncDom();

  // ---------- слой поверх растра ----------
  let rt = null, quad = null;
  const size = new THREE.Vector2(), clear = new THREE.Color();
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
      const fov = aspect >= 1 ? VM.fovV : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(VM.fovV / 2)) / aspect));
      if (vmCam.aspect !== aspect || vmCam.fov !== fov) { vmCam.aspect = aspect; vmCam.fov = fov; vmCam.updateProjectionMatrix(); }
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
    weapon = w.id; stopHold();
    writePref({ weapon, sound });
    if (weapon !== 'none') { load(weapon); mount(); }
    syncDom();
    requestRender?.();
  }
  function setSound(on) { sound = !!on; writePref({ weapon, sound }); }

  function dispose() {
    stopHold();
    pipe?.setOverlay?.(null);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', stopHold);
    removeEventListener('blur', stopHold);
    removeEventListener('keydown', onKey);
    fireBtn.remove();
    document.body.classList.remove('kvm-w-pistol', 'kvm-w-rifle');
    for (const m of Object.values(models)) m?.root?.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    flashTex.dispose(); flashMat.dispose();
    rt?.dispose(); quad?.material.dispose(); quad?.dispose();
    audio.dispose();
  }

  return {
    update, setWeapon, setSound, dispose,
    get weapon() { return weapon; },
    get sound() { return sound; },
    get armed() { return shown && !seated(); },
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
      { type: 'seg', key: 'vmWeapon', label: 'В руках', options: WEAPONS.map(({ id, name }) => ({ id, name })), get: cur, set },
      { type: 'toggle', key: 'vmSound', label: 'Звук выстрела', visible: () => cur() !== 'none',
        get: () => getVM()?.sound ?? readPref().sound !== false,
        set: v => { const vm = getVM(); if (vm) vm.setSound(v); else writePref({ ...readPref(), sound: !!v }); } },
      { type: 'readout', key: 'vmKeys', style: 'hint',
        value: 'Видно только в прогулке. 1 — убрать, 2 — пистолет, 3 — автомат. Клик — выстрел, у автомата зажать. Двойной клик — захват мыши. Клик по двери или сиденью открывает её или сажает. На телефоне — кнопка огня.' },
    ],
  });
}

// ---------- мелочи ----------

// Синтетический выстрел: щелчок шума через затухающий фильтр + глухой удар. Контекст звука — только после жеста.
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
  return {
    unlock() { const c = ensure(); if (c?.state === 'suspended') c.resume().catch(() => {}); },
    play({ gain, cutoff, decay, thump }) {
      const c = ensure();
      if (!c) return;
      if (c.state === 'suspended') c.resume().catch(() => {});
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

// Кнопка огня: справа внизу, напротив джойстика прогулки (токены --kw-* задаёт .kw-float в minimap.js)
function injectStyle() {
  if (document.getElementById('kvm-style')) return;
  const s = document.createElement('style'); s.id = 'kvm-style';
  s.textContent = `
.kvm-fire { position: fixed; z-index: 5; right: max(20px, calc(env(safe-area-inset-right, 0px) + 12px)); bottom: calc(96px + env(safe-area-inset-bottom, 0px));
  width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center; padding: 0; cursor: pointer;
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  color: var(--kw-accent-ink); background: color-mix(in srgb, var(--kw-accent) 88%, transparent); border: 1px solid var(--kw-line);
  box-shadow: var(--kw-shadow); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.kvm-fire:active { transform: scale(0.94); }
.kvm-fire:focus-visible { outline: 2px solid var(--kw-accent); outline-offset: 3px; }
.kvm-fire[hidden] { display: none; }
@media (max-width: 760px) { body:has(#panel.open) .kvm-fire { display: none; } }`;
  document.head.appendChild(s);
}
