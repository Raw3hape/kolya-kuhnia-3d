// Экраны с настоящим YouTube: ТВ в гостиной, ноутбук в кабинете (мемы), телефон на острове (Shorts) — список экранов,
// их видео и настройки в web/spec/tv.json (screens[]). Новый экран — запись в spec, код не меняется.
//
// Как это устроено («дыра в холсте»):
//   - Плеер YouTube (IFrame API, youtube-nocookie.com) ОДИН на всю сцену: создаётся при первом показе экрана и дальше
//     живёт всё время, без звука (иначе браузер не даст автозапуск), без кнопок, без перехвата мыши и клавиатуры.
//     Играет на экране, который сейчас крупнее всех в кадре (видим, к нам лицом, ближе maxDist, не за стеной или дверью);
//     перешли к другому экрану — плеер переключается на его список (каждый экран помнит своё видео и место в нём).
//     Ни один экран не в кадре — плеер через pauseAfterSec на паузе: в другой комнате ноутбук ничего не стоит.
//   - Плеер лежит в слое ПОД прозрачным WebGL-холстом и после каждого кадра встаёт в плоскость экрана (CSS3DRenderer):
//     у ТВ — меш 'tv_screen' из furniture.js (размер из PlaneGeometry), у ноутбука и телефона — часть обстановки
//     (decor.js, ищется по модели) и прямоугольник rect в координатах модели: экран едет за перетаскиванием и пересборкой.
//   - Материал экрана, на котором играет плеер, в живом растре пишет в кадр прозрачность (альфа 0), всё, что стоит перед
//     экраном, — непрозрачно: остров, диван или рука честно закрывают видео. Остальные экраны рисуются как есть (постер или
//     тёмное стекло). Холст three r169 всегда с альфа-каналом, цепочка render.js альфу хранит.
//   - Где iframe быть не может (фото-режим с трассировкой, снимок PNG, экспорт GLB/Blender), дыры нет: ТВ светится постером
//     (spec → poster, его ставит furniture.js), ноутбук и телефон — тёмный экран модели; на время снимка render.js
//     выключает дыру (pipe.onLive).
//   - Телефон можно взять в прогулке (handheld.js: E или клик по нему). В руке слой плеера поднимается НАД холстом и
//     висит перед камерой (внизу по центру, как в руке), телефон на острове прячется; звук включён, листать — колесо, ↑↓,
//     свайп; положить — E, Q, Esc или кнопка. Оружие при этом убирается (viewmodel.setWeapon('none')).
//
// createTV({ THREE, scene, camera, renderer, canvas, pipe, getState, requestRender, getWalk?, getVM? })
//   -> { sync()            звать после каждого отрисованного кадра (дёшево: матрицы и пара проверок; луч к стенам — только
//                          когда сдвинулась камера),
//        setAudio(on, id?) звук экрана id (по умолчанию 'tv'; включает сидение на диване — жест пользователя),
//        step(id, d)       следующее/предыдущее видео экрана, hold(on) — взять/положить телефон,
//        link({ getWalk, getVM }) — подключить позже (проверки из консоли),
//        dispose(), status — что где играет (для проверки из консоли) }
//   getWalk() — прогулка (walk.js, нужен walking), getVM() — оружие (viewmodel.js: weapon, setWeapon). Без них телефон не берётся.
// tvPosterTexture() — текстура постера ТВ для материала экрана (furniture.js), одна на сеанс.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { decorPart } from './decor.js';
import { createHandheld } from './handheld.js';
import { addHelp } from './help.js';

addHelp({ mode: 'walk', keys: [], text: 'телевизор, ноутбук в комнате 3 и телефон на острове показывают YouTube; звук ТВ — когда сидите на диване', order: 75 });

const SPEC = await fetch('spec/tv.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
const EDGE = 0.004;           // м: плеер шире экрана на 4 мм с каждой стороны (за рамкой) — без щелей по краю дыры
const YT_PLAYING = 1, YT_ENDED = 0, YT_BUFFERING = 3;
const rad = THREE.MathUtils.degToRad;
const ONE = new THREE.Vector3(1, 1, 1);

function parseScreen(s) {
  const videos = (Array.isArray(s?.videos) ? s.videos : []).filter(v => v?.id);
  if (!s?.id || !videos.length || !(s.mesh || (s.decorModel && s.material && s.rect))) return null;
  const r = s.rect, local = new THREE.Matrix4();
  if (r) local.compose(new THREE.Vector3(...r.center), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r.rot.map(rad))), ONE);
  return {
    ...s, videos, local, meshName: s.mesh || null, w: r?.size[0] ?? 0, h: r?.size[1] ?? 0, px: Number(s.px) || 1280, crop: Math.max(1, Number(s.crop) || 1),
    // дальше — состояние в сеансе: что нашли в сцене, где экран, какое видео и с какого места
    HOLE: { value: 0 }, mesh: null, holder: null, group: null, none: false,
    world: new THREE.Matrix4(), center: new THREE.Vector3(), normal: new THREE.Vector3(), radius: 0, dist: Infinity, score: 0,
    idx: 0, t: 0, failed: 0, audio: false,
  };
}
const SCREENS = (SPEC?.screens ?? []).map(parseScreen).filter(Boolean);
const byId = id => SCREENS.find(s => s.id === id) ?? null;

let posterTex = null;
export function tvPosterTexture() {
  const poster = byId('tv')?.poster;
  if (!posterTex && poster) {
    posterTex = new THREE.TextureLoader().load(poster);
    posterTex.colorSpace = THREE.SRGBColorSpace;
  }
  return posterTex;
}

// YouTube IFrame API грузится один раз на страницу
let apiPromise = null;
function loadAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = () => { apiPromise = null; s.remove(); reject(new Error('iframe_api')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

// Материал экрана: в живом растре с дырой — прозрачный чёрный (альфа 0). Патч дописывается к чужому (lighting.js),
// а не заменяет его; uniform — свой у каждого экрана.
const patched = new WeakSet();
function patchHole(m, HOLE) {
  if (!m || patched.has(m)) return false;
  patched.add(m);
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) {
    prev?.call(this, sh, r);
    sh.uniforms.tvHole = HOLE;
    sh.fragmentShader = 'uniform float tvHole;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
      '#include <dithering_fragment>\n\tif ( tvHole > 0.5 ) gl_FragColor = vec4( 0.0 );');
  };
  m.customProgramCacheKey = function () { return (prevKey === THREE.Material.prototype.customProgramCacheKey ? '' : prevKey.call(this)) + '|tv-hole'; };
  m.needsUpdate = true;
  return true;
}

const gate = (when, S) => { for (const k in when) { const v = String(when[k]); if (v[0] === '!' ? S[k] === v.slice(1) : S[k] !== v) return false; } return true; };
const isAttached = (o, scene) => { while (o.parent) o = o.parent; return o === scene; };
const visibleChain = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
function findByMaterial(o, name) {
  if (o.isMesh && o.material?.name === name) return o;
  for (const c of o.children) { const m = findByMaterial(c, name); if (m) return m; }
  return null;
}

export function createTV({ camera, scene, renderer, canvas, pipe, getState, requestRender, getWalk, getVM }) {
  let live = true;
  const offLive = pipe.onLive(on => { live = on; if (!on) for (const s of SCREENS) s.HOLE.value = 0; });

  // ---------- слой с плеером ----------
  const layer = document.createElement('div');
  layer.className = 'tv-layer';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '-1' });
  canvas.parentElement.insertBefore(layer, canvas);   // под холстом: родитель (#stage, fixed) — свой контекст наложения
  const css = new CSS3DRenderer();
  css.domElement.style.pointerEvents = 'none';
  layer.appendChild(css.domElement);
  const cssScene = new THREE.Scene();

  // frame — объект CSS3D (экран и поле за рамкой); shell — корпус (у телефона в руке: рамка и скругления);
  // scr — сам экран: постер или чёрный фон под плеером, пока видео не пошло
  const frame = document.createElement('div');
  Object.assign(frame.style, { backfaceVisibility: 'hidden', visibility: 'hidden' });
  const shell = document.createElement('div');
  Object.assign(shell.style, { position: 'absolute', inset: '0' });
  const scr = document.createElement('div');
  Object.assign(scr.style, { position: 'absolute', overflow: 'hidden', background: '#000' });
  const notch = document.createElement('div');     // вырез камеры у телефона в руке
  Object.assign(notch.style, { position: 'absolute', background: '#000', display: 'none' });
  const host = document.createElement('div');
  scr.appendChild(host);
  shell.append(scr, notch);
  frame.appendChild(shell);
  const obj = new CSS3DObject(frame);
  frame.style.pointerEvents = 'none';            // CSS3DObject ставит auto: плеер не должен ловить мышь
  obj.matrixAutoUpdate = false;
  cssScene.add(obj);

  // ---------- плеер ----------
  let player = null, ready = false, creating = false, playerState = -1, cur = null;   // cur — чьё видео загружено
  let paused = false, everPlayed = false, stalled = 0, lastSeen = 0, sound = null, shown = false;
  const isLive = () => cur?.videos[cur.idx]?.duration === 'live';

  function createPlayer(s) {
    if (creating || player) return;
    creating = true;
    loadAPI().then(YT => {
      cur = s;
      const id = s.videos[s.idx].id;
      player = new YT.Player(host, {
        host: SPEC?.host || 'https://www.youtube-nocookie.com', videoId: id, width: '100%', height: '100%',
        playerVars: { autoplay: 1, mute: 1, loop: 1, playlist: id, controls: 0, playsinline: 1, modestbranding: 1, rel: 0,
          iv_load_policy: 3, disablekb: 1, fs: 0, cc_load_policy: 0, enablejsapi: 1, origin: location.origin },
        events: {
          onReady() { ready = true; player.mute(); sound = null; applyAudio(); if (active && active !== cur) load(active); player.playVideo(); },
          onStateChange(e) {
            playerState = e.data;
            if (e.data === YT_PLAYING) { stalled = 0; if (cur) cur.failed = 0; if (!everPlayed) { everPlayed = true; styleIframe(); } }
            if (e.data === YT_ENDED && cur) {
              if (isLive() || cur.onEnd === 'next') advance(cur, 1, false);
              else { player.seekTo(0, true); player.playVideo(); }
            }
          },
          onError(e) {   // 2 — неверный id, 5 — HTML5, 100 — удалено, 101/150 — встраивание запрещено
            console.warn(`tv.js: видео ${cur?.videos[cur.idx].id} не играет (код ${e.data}), включаю следующее`);
            if (cur) advance(cur, 1, true);
          },
        },
      });
      styleIframe();
      creating = false;
    }).catch(() => { setTimeout(() => { creating = false; }, 60e3); });   // нет сети — постер; повтор через минуту
  }

  // загрузить в плеер видео экрана s с его места; уходящий экран запоминает своё
  function load(s) {
    if (!ready) return;
    if (cur && cur !== s && !isLive()) cur.t = player.getCurrentTime?.() || 0;
    cur = s; stalled = 0;
    player.loadVideoById({ videoId: s.videos[s.idx].id, startSeconds: s.t });
    sound = null; applyAudio();
  }
  // следующее (d = 1) или предыдущее видео экрана; failed — после ошибки или зависания (круг без единого запуска — стоп)
  function advance(s, d, failed) {
    const n = s.videos.length;
    if (failed) { if (++s.failed > n) return; }
    if (n < 2) { if (ready && cur === s) { player.seekTo(0, true); player.playVideo(); } return; }
    s.idx = (s.idx + d + n) % n; s.t = 0; stalled = 0;
    if (ready && cur === s) player.loadVideoById(s.videos[s.idx].id);
  }

  // звук: у экрана, на котором сейчас играет плеер, если его разрешили (диван, телефон в руке, рядом с ноутбуком)
  function applyAudio() {
    if (!ready) return;
    const s = active && active === cur ? active : null;
    const on = !!s && (s.audio || (held && s === phone) || (s.audioNear > 0 && s.dist < s.audioNear));
    const key = on ? s.volume ?? 35 : 0;
    if (key === sound) return;
    sound = key;
    if (on) { player.unMute(); player.setVolume(key); } else player.mute();
  }

  // iframe — по размеру экрана (× crop: подрезать края), по центру; YouTube сам вписывает видео с полями
  let inner = { w: 0, h: 0 }, crop = 1;
  function styleIframe() {
    const f = player?.getIframe?.();
    if (!f) return;
    f.setAttribute('tabindex', '-1');
    f.title = 'Экран: YouTube';
    const w = inner.w * crop, h = inner.h * crop;
    Object.assign(f.style, { position: 'absolute', border: '0', pointerEvents: 'none', width: `${w}px`, height: `${h}px`,
      left: `${(inner.w - w) / 2}px`, top: `${(inner.h - h) / 2}px`, opacity: everPlayed ? '1' : '0', transition: 'opacity 0.6s' });
  }

  // разметка рамки под экран s (в руке — корпус телефона); k — метров в CSS-пикселе
  let laid = null, laidHeld = false, laidW = 0, laidH = 0, k = 1;
  function layout(s, inHand) {
    if (s === laid && inHand === laidHeld && s.w === laidW && s.h === laidH) return;
    laid = s; laidHeld = inHand; laidW = s.w; laidH = s.h;
    const H = inHand ? s.hold : null, b = H ? H.bezel : EDGE, fw = s.w + 2 * b, fh = s.h + 2 * b;
    k = fw / s.px;
    const px = m => `${m / k}px`;
    frame.style.width = px(fw); frame.style.height = px(fh);
    Object.assign(scr.style, { left: px(b), top: px(b), width: px(s.w), height: px(s.h), borderRadius: H ? px(H.screenRadius) : '0',
      background: s.poster ? `#000 url("${s.poster}") center / cover no-repeat` : '#000' });
    Object.assign(shell.style, H
      ? { background: '#0b0b0d', borderRadius: px(H.radius), boxShadow: `0 0 0 ${px(0.0009)} #3a3b40, 0 ${px(0.004)} ${px(0.012)} rgba(0,0,0,0.45)` }
      : { background: 'none', borderRadius: '0', boxShadow: 'none' });
    Object.assign(notch.style, H
      ? { display: 'block', width: px(0.017), height: px(0.0048), left: px(fw / 2 - 0.0085), top: px(b + 0.0028), borderRadius: px(0.0024) }
      : { display: 'none' });
    inner = { w: s.w / k, h: s.h / k }; crop = s.crop;
    styleIframe();
  }

  // сторож: зависло — толкнуть, не помогло — следующее видео; круг без единого запуска — ждать жеста пользователя
  const watchdog = setInterval(() => {
    if (!ready) return;
    const now = performance.now(), pauseAfter = (SPEC?.pauseAfterSec ?? 30) * 1e3;
    if (!shown && !paused && now - lastSeen > pauseAfter && playerState === YT_PLAYING) { paused = true; player.pauseVideo(); return; }
    if (!shown || paused || playerState === YT_PLAYING || playerState === YT_BUFFERING) { stalled = 0; return; }
    stalled += 5;
    const limit = SPEC?.stallSec ?? 25;
    if (stalled >= limit && cur) advance(cur, 1, true);
    else if (stalled >= limit / 2) player.playVideo();
  }, 5000);
  const onGesture = () => { if (ready && shown && playerState !== YT_PLAYING) { if (cur) cur.failed = 0; player.playVideo(); } };
  window.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
  window.addEventListener('keydown', onGesture, { capture: true, passive: true });

  // ---------- экраны в сцене ----------
  // найти меш экрана и его опору; null — экрана сейчас нет (ТВ выключен, ноутбука нет в выбранной опции)
  function decorGroup() {
    for (const c of scene.children) if (c.name === 'decor') return c;
    return null;
  }
  // меш ТВ ищется по имени, часть обстановки — по модели (пересборка обстановки = новая группа 'decor')
  function find(s, S) {
    if (s.when && !gate(s.when, S)) return (s.mesh = null);
    if (!s.decorModel) {
      if (!s.mesh || !isAttached(s.mesh, scene)) s.mesh = scene.getObjectByName(s.meshName) ?? null;
      return s.mesh;
    }
    const g = decorGroup();
    if (g !== s.group) { s.group = g; s.holder = null; s.mesh = null; s.none = false; }
    if (!g || s.none) return null;
    if (!s.holder) {
      for (const h of g.children) {
        const i = decorPart(h);
        if (i && i.option.parts[i.index]?.model === s.decorModel) { s.holder = h; break; }
      }
      if (!s.holder) { s.none = true; return null; }
    }
    if (!s.mesh && s.holder.children.length) s.mesh = findByMaterial(s.holder, s.material);   // модель грузится лениво
    return s.mesh;
  }

  // мировая матрица экрана (плоскость: центр, +Z — наружу), центр, нормаль и радиус для отсечения
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), HM = new THREE.Matrix4();
  function place(s) {
    if (s.decorModel) s.world.multiplyMatrices(s.holder.matrixWorld, s.local);
    else {
      const p = s.mesh.geometry.parameters;
      s.w = p.width; s.h = p.height;
      s.world.copy(s.mesh.matrixWorld);
    }
    s.center.setFromMatrixPosition(s.world);
    s.normal.setFromMatrixColumn(s.world, 2).normalize();
    s.radius = Math.hypot(s.w, s.h) / 2 * s.world.getMaxScaleOnAxis();
  }

  // стены и полотна дверей (их же прячет вырез — тогда слой не совпадает с камерой и луч их не видит)
  let occluders = null;
  function getOccluders() {
    if (occluders && occluders.length && isAttached(occluders[0], scene)) return occluders;
    occluders = [];
    for (const name of ['apartment', 'doors']) scene.getObjectByName(name)?.traverse(o => { if (o.isMesh && o.userData.cutaway) occluders.push(o); });
    return occluders;
  }
  const ray = new THREE.Raycaster(), hits = [];
  function occluded(s, d) {
    ray.layers.mask = camera.layers.mask;
    ray.set(camPos, _v.subVectors(s.center, camPos).divideScalar(d));
    ray.near = 0; ray.far = Math.max(0, d - 0.05);
    hits.length = 0;
    ray.intersectObjects(getOccluders(), false, hits);
    return hits.length > 0;
  }

  // кандидат: виден, к нам лицом, в кадре, не дальше maxDist (стены проверяет occluded). score — видимый размер
  // (диагональ / расстояние) с весом за близость к центру кадра
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere(), camPos = new THREE.Vector3(), M = new THREE.Matrix4();
  const viewDir = new THREE.Vector3();
  function candidate(s) {
    if (!s.mesh || !visibleChain(s.mesh) || !camera.layers.test(s.mesh.layers)) return false;
    place(s);
    const d = s.dist = camPos.distanceTo(s.center);
    if (s.maxDist && d > s.maxDist) return false;
    if (_v.subVectors(camPos, s.center).dot(s.normal) <= 0) return false;
    if (!frustum.intersectsSphere(sphere.set(s.center, s.radius))) return false;
    // ближе к центру кадра — важнее: смотрим на телефон на острове — играет он, хотя ТВ на краю кадра крупнее
    s.score = (2 * s.radius) / Math.max(0.05, d) * (0.25 + Math.max(0, -_v.dot(viewDir) / d));
    return true;
  }

  // телефон в руке: перед камерой, внизу по центру (сдвиг влево от открытой панели — как у рук с оружием)
  const phone = SCREENS.find(s => s.hold) ?? null;
  let held = false, dropping = null;
  function placeHeld(s) {
    const H = s.hold, t = Math.tan(rad(camera.fov) / 2), len = s.h + 2 * H.bezel;
    const d = len * Math.cos(rad(H.tilt)) / (H.height * 2 * t);
    let sx = 0;
    if (document.body.classList.contains('panel-open')) {
      const r = document.getElementById('panel')?.getBoundingClientRect(), cw = canvas.clientWidth;
      if (r && r.left > innerWidth / 2 && cw) sx = -(cw - r.left) / cw;
    }
    _p.set(sx * d * t * camera.aspect, H.y * d * t, -d);
    _q.setFromEuler(_e.set(rad(H.tilt), 0, rad(H.roll)));
    HM.compose(_p, _q, ONE);
    s.world.multiplyMatrices(camera.matrixWorld, HM);
  }
  function hideIsland(hide) {
    const root = phone?.holder?.children[0];
    if (root && root.visible === hide) { root.visible = !hide; requestRender(); }
  }
  function hold(on) {
    if (!phone || on === held && !dropping) return;
    dropping?.cancel(); dropping = null;
    if (on) {
      held = true; layer.style.zIndex = '1';
      hideIsland(true);
      layout(phone, true);
      shell.animate([{ transform: 'translateY(75%) rotate(-7deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      requestRender();
      return;
    }
    dropping = shell.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(75%) rotate(-7deg)', opacity: 0 }],
      { duration: 180, easing: 'ease-in' });
    dropping.onfinish = () => {
      dropping = null; held = false; layer.style.zIndex = '-1';
      hideIsland(false);
      requestRender();
    };
  }
  // листать: следующее (d = 1) или предыдущее видео; телефон — с коротким сдвигом картинки
  function step(id, d) {
    const s = byId(id);
    if (!s) return;
    advance(s, d, false);
    if (s === phone && held) scr.animate([{ transform: `translateY(${d > 0 ? 22 : -22}%)`, opacity: 0.15 }, { transform: 'none', opacity: 1 }],
      { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }

  const links = { getWalk, getVM };
  const hand = phone && createHandheld({ THREE, camera, canvas, requestRender, reach: phone.hold.reach,
    getWalk: () => links.getWalk?.(), getVM: () => links.getVM?.(),
    // на столе он спрятан, пока в руке (и пока доигрывает «положить»): видимость проверяем у держателя, не у модели
    getTarget: () => (phone.mesh && phone.holder && (!held || dropping) && visibleChain(phone.holder) ? phone.holder : null),
    getRect: () => scr.getBoundingClientRect(),
    onHold: hold, onStep: d => step(phone.id, d) });

  // ---------- кадр ----------
  let active = null, lastPick = 0, cw = 0, ch = 0;
  const lastCam = new Float64Array(16);
  function sync() {
    const S = getState();
    for (const s of SCREENS) {
      const m = find(s, S);
      if (m) {
        if (patchHole(m.material, s.HOLE)) requestRender();
        // постер (фото, снимок, GLB) светится как настоящий экран: видимая яркость не зависит от экспозиции «как глаз»
        if (m.material.emissiveMap) m.material.emissiveIntensity = (s.posterBrightness ?? 0.8) / renderer.toneMappingExposure;
      }
    }
    if (phone && held && !dropping) hideIsland(true);   // обстановку пересобрали, пока телефон в руке
    hand?.sync();

    // какой экран играет: телефон в руке или под прицелом; иначе самый крупный в кадре. Выбор (с лучами к стенам) — только когда
    // сдвинулась камера, а без движения — не чаще раза в 0,4 с (дверь закрылась, вещь переставили)
    camera.getWorldPosition(camPos);
    const now = performance.now(), e = camera.matrixWorld.elements;
    let same = now - lastPick < 400;
    for (let i = 0; i < 16 && same; i++) same = e[i] === lastCam[i];
    if (held) active = phone;
    else if (hand?.aimed && phone.mesh) { active = phone; place(phone); }   // телефон под прицелом играет, даже если ТВ крупнее
    else if (!same || (active && !active.mesh)) {
      lastCam.set(e); lastPick = now;
      camera.getWorldDirection(viewDir);
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      active = null;
      for (const s of SCREENS) {   // луч к стенам — только у того, кто иначе выиграл бы
        if (candidate(s) && (!active || s.score > active.score) && !(s.decorModel && occluded(s, s.dist))) active = s;
      }
    } else if (active) place(active);   // камера стоит, а экран могли перетащить

    if (active) {
      lastSeen = now;
      if (!player) createPlayer(active);
      else if (ready && cur !== active) load(active);
      if (paused && ready) { paused = false; player.playVideo(); }
      if (held) placeHeld(active);
      layout(active, held);
      obj.matrix.multiplyMatrices(active.world, M.makeScale(k, k, 1));
      if (canvas.clientWidth !== cw || canvas.clientHeight !== ch) { cw = canvas.clientWidth; ch = canvas.clientHeight; css.setSize(cw, ch); }
      css.render(cssScene, camera);
    }
    const show = !!active;
    if (show !== shown) { shown = show; frame.style.visibility = show ? 'visible' : 'hidden'; }
    applyAudio();
    // дыра — только в живом растре и только у экрана, на котором играет плеер (в руке дыра не нужна: слой над холстом)
    for (const s of SCREENS) {
      const h = live && s === active && !held && s.mesh ? 1 : 0;
      if (h !== s.HOLE.value) { s.HOLE.value = h; requestRender(); }
    }
  }

  function setAudio(on, id = 'tv') {
    const s = byId(id);
    if (s) s.audio = !!on;
    applyAudio();
  }

  function dispose() {
    clearInterval(watchdog);
    window.removeEventListener('pointerdown', onGesture, { capture: true });
    window.removeEventListener('keydown', onGesture, { capture: true });
    offLive();
    hand?.dispose();
    hideIsland(false);
    for (const s of SCREENS) s.HOLE.value = 0;
    player?.destroy?.();
    layer.remove();
  }

  // подключить прогулку и оружие позже (проверки из консоли до того, как main.js их передаст)
  function link(o = {}) { if (o.getWalk) links.getWalk = o.getWalk; if (o.getVM) links.getVM = o.getVM; }

  return { sync, setAudio, step, hold: on => (on ? hand?.pick() : hand?.drop()), link, dispose,
    // для проверки из консоли: __kitchen.tv.status
    get status() {
      return { screen: active?.id ?? null, loaded: cur?.id ?? null, video: cur?.videos[cur.idx]?.id, state: playerState, shown, held,
        sound: sound || 0, hole: SCREENS.filter(s => s.HOLE.value === 1).map(s => s.id), found: SCREENS.filter(s => s.mesh).map(s => s.id) };
    } };
}
