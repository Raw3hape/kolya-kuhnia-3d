// Телевизор показывает настоящий YouTube: бесконечно, с любым ТВ, размером и местом на стене. Список видео,
// постер и настройки — web/spec/tv.json (первое видео играет, при ошибке или зависании — следующее, по кругу).
//
// Как это устроено («дыра в холсте»):
//   - Один плеер YouTube (IFrame API, youtube-nocookie.com) создаётся при первом показе ТВ и дальше живёт всё время:
//     без звука (иначе браузер не даст автозапуск), по кругу, без кнопок, без перехвата мыши и клавиатуры.
//   - Плеер лежит в слое ПОД прозрачным WebGL-холстом и каждым кадром встаёт в плоскость экрана (CSS3DRenderer,
//     мировая матрица меша 'tv_screen' из furniture.js и его размер).
//   - Материал экрана в живом растре пишет в кадр прозрачность (альфа 0), всё, что стоит перед экраном, — непрозрачно.
//     Так остров, диван или рука в прогулке честно закрывают видео. Холст three r169 всегда создаётся с альфа-каналом
//     (alpha: false у WebGLRenderer лишь красит фон непрозрачным), цепочка render.js альфу хранит.
//   - Где iframe быть не может (фото-режим с трассировкой, снимок PNG, экспорт GLB/Blender), экран светится постером
//     (spec/tv.json → poster): его ставит furniture.js; на время снимка render.js выключает «дыру» (pipe.onLive).
//
// createTV({ THREE, scene, camera, renderer, canvas, pipe, getState, requestRender })
//   -> { sync()        звать после каждого отрисованного кадра (дёшево: матрица и пара проверок),
//        setAudio(on)  звук (включает сидение на диване — жест пользователя; браузер иначе звук не даст),
//        dispose(), status — что играет сейчас (для проверки) }
// tvPosterTexture() — текстура постера для материала экрана (furniture.js), одна на сеанс.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

const SPEC = await fetch('spec/tv.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
const VIDEOS = (SPEC?.videos ?? []).filter(v => v?.id);
const PX = 1280;              // ширина плеера в CSS-пикселях: от неё YouTube выбирает качество (720p)
const EDGE = 0.004;           // м: плеер шире экрана на 4 мм с каждой стороны (за рамкой) — без щелей по краю дыры
const YT_PLAYING = 1, YT_ENDED = 0, YT_BUFFERING = 3;

let posterTex = null;
export function tvPosterTexture() {
  if (!posterTex && SPEC?.poster) {
    posterTex = new THREE.TextureLoader().load(SPEC.poster);
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

export function createTV({ camera, scene, renderer, canvas, pipe, getState, requestRender }) {
  const HOLE = { value: 0 };
  let live = true;
  const offLive = pipe.onLive(on => { live = on; if (!on) HOLE.value = 0; });

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

  const frame = document.createElement('div');   // экран: постер под плеером, пока видео не пошло
  Object.assign(frame.style, { overflow: 'hidden', background: `#000 ${SPEC?.poster ? `url("${SPEC.poster}")` : ''} center / cover no-repeat`,
    backfaceVisibility: 'hidden', visibility: 'hidden' });
  const host = document.createElement('div');
  frame.appendChild(host);
  const obj = new CSS3DObject(frame);
  frame.style.pointerEvents = 'none';            // CSS3DObject ставит auto: плеер не должен ловить мышь
  obj.matrixAutoUpdate = false;
  cssScene.add(obj);

  // ---------- плеер ----------
  let player = null, ready = false, creating = false, playerState = -1, idx = 0, shown = false;
  let audio = false, paused = false, everPlayed = false, stalled = 0, failedInRow = 0, lastSeen = 0;
  const crop = Math.max(1, Number(SPEC?.crop) || 1);
  const isLive = () => VIDEOS[idx]?.duration === 'live';

  function applyAudio() {
    if (!ready) return;
    if (audio) { player.unMute(); player.setVolume(SPEC?.volume ?? 35); } else player.mute();
  }

  function createPlayer() {
    if (creating || player || !VIDEOS.length) return;
    creating = true;
    loadAPI().then(YT => {
      const id = VIDEOS[idx].id;
      player = new YT.Player(host, {
        host: SPEC?.host || 'https://www.youtube-nocookie.com', videoId: id, width: '100%', height: '100%',
        playerVars: { autoplay: 1, mute: 1, loop: 1, playlist: id, controls: 0, playsinline: 1, modestbranding: 1, rel: 0,
          iv_load_policy: 3, disablekb: 1, fs: 0, cc_load_policy: 0, enablejsapi: 1, origin: location.origin },
        events: {
          onReady() { ready = true; player.mute(); applyAudio(); player.playVideo(); },
          onStateChange(e) {
            playerState = e.data;
            if (e.data === YT_PLAYING) { stalled = 0; failedInRow = 0; if (!everPlayed) { everPlayed = true; styleIframe(); } }
            if (e.data === YT_ENDED) { if (isLive()) next(); else { player.seekTo(0, true); player.playVideo(); } }
          },
          onError(e) {   // 2 — неверный id, 5 — HTML5, 100 — удалено, 101/150 — встраивание запрещено
            console.warn(`tv.js: видео ${VIDEOS[idx].id} не играет (код ${e.data}), включаю следующее`);
            next();
          },
        },
      });
      styleIframe();
      creating = false;
    }).catch(() => { setTimeout(() => { creating = false; }, 60e3); });   // нет сети — постер; повтор через минуту
  }

  function next() {
    if (!ready || VIDEOS.length < 2) { if (ready) player.playVideo(); return; }
    failedInRow++; stalled = 0;
    idx = (idx + 1) % VIDEOS.length;
    player.loadVideoById(VIDEOS[idx].id);
  }

  // iframe — 16:9 видимой части экрана (× crop: подрезать края с надписями YouTube), по центру рамки
  let sizeKey = '', inner = { w: PX, h: PX * 9 / 16 };
  function styleIframe() {
    const f = player?.getIframe?.();
    if (!f) return;
    f.setAttribute('tabindex', '-1');
    f.title = 'ТВ: YouTube';
    const w = inner.w * crop, h = inner.h * crop;
    Object.assign(f.style, { position: 'absolute', border: '0', pointerEvents: 'none', width: `${w}px`, height: `${h}px`,
      left: `${(parseFloat(frame.style.width) - w) / 2}px`, top: `${(parseFloat(frame.style.height) - h) / 2}px`,
      opacity: everPlayed ? '1' : '0', transition: 'opacity 0.6s' });
  }

  // сторож: зависло — толкнуть, не помогло — следующее видео; круг без единого запуска — ждать жеста пользователя
  const watchdog = setInterval(() => {
    if (!ready) return;
    const now = performance.now(), pauseAfter = (SPEC?.pauseAfterSec ?? 30) * 1e3;
    if (!shown && !paused && now - lastSeen > pauseAfter && playerState === YT_PLAYING) { paused = true; player.pauseVideo(); return; }
    if (!shown || paused || playerState === YT_PLAYING || playerState === YT_BUFFERING) { stalled = 0; return; }
    stalled += 5;
    const limit = SPEC?.stallSec ?? 25;
    if (stalled >= limit && failedInRow < VIDEOS.length) next();
    else if (stalled >= limit / 2) player.playVideo();
  }, 5000);
  const onGesture = () => { if (ready && shown && playerState !== YT_PLAYING) { failedInRow = 0; player.playVideo(); } };
  window.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
  window.addEventListener('keydown', onGesture, { capture: true, passive: true });

  // ---------- экран в сцене ----------
  let screen = null, lastState = null;
  const patched = new WeakSet();
  const isAttached = o => { while (o.parent) o = o.parent; return o === scene; };
  const visibleChain = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  function findScreen(S) {
    if (S.tv === 'none') return null;
    if (screen && isAttached(screen) && S === lastState) return screen;
    lastState = S;
    if (!screen || !isAttached(screen)) screen = scene.getObjectByName('tv_screen') ?? null;
    return screen;
  }
  // Материал экрана: в живом растре с дырой — прозрачный чёрный (альфа 0); вне её — как задал furniture.js (постер)
  function patch(m) {
    if (patched.has(m)) return;
    patched.add(m);
    requestRender();
    m.onBeforeCompile = sh => {
      sh.uniforms.tvHole = HOLE;
      sh.fragmentShader = 'uniform float tvHole;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
        '#include <dithering_fragment>\n\tif ( tvHole > 0.5 ) gl_FragColor = vec4( 0.0 );');
    };
    m.customProgramCacheKey = () => 'tv-hole';
    m.needsUpdate = true;
  }

  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere(), M = new THREE.Matrix4();
  let cw = 0, ch = 0;

  function sync() {
    const S = getState(), mesh = S.tvOn === 'on' ? findScreen(S) : null;
    let show = false;
    if (mesh) patch(mesh.material);
    if (mesh && visibleChain(mesh) && camera.layers.test(mesh.layers)) {
      const g = mesh.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      show = frustum.intersectsSphere(sphere.copy(g.boundingSphere).applyMatrix4(mesh.matrixWorld));
      if (show) {
        const pw = g.parameters.width, ph = g.parameters.height;
        const fw = pw + 2 * EDGE, fh = ph + 2 * EDGE;
        const key = `${fw}|${fh}`;
        if (key !== sizeKey) {
          sizeKey = key;
          frame.style.width = `${PX}px`; frame.style.height = `${PX * fh / fw}px`;
          inner = { w: PX * pw / fw, h: PX * ph / fw };
          styleIframe();
        }
        const k = fw / PX;
        obj.matrix.multiplyMatrices(mesh.matrixWorld, M.makeScale(k, k, 1));
      }
    }
    if (show) {
      lastSeen = performance.now();
      if (!player) createPlayer();
      if (paused && ready) { paused = false; player.playVideo(); }
      if (canvas.clientWidth !== cw || canvas.clientHeight !== ch) { cw = canvas.clientWidth; ch = canvas.clientHeight; css.setSize(cw, ch); }
      css.render(cssScene, camera);
    }
    if (show !== shown) { shown = show; frame.style.visibility = show ? 'visible' : 'hidden'; }
    // постер (фото, снимок, GLB) светится как настоящий экран: видимая яркость не зависит от экспозиции «как глаз»
    if (mesh?.material.emissiveMap) mesh.material.emissiveIntensity = (SPEC?.posterBrightness ?? 0.8) / renderer.toneMappingExposure;
    // дыра — только в живом растре, при включённом ТВ на экране кадра; меняется — перерисовать
    const h = live && !!mesh ? 1 : 0;
    if (h !== HOLE.value) { HOLE.value = h; requestRender(); }
  }

  function setAudio(on) { audio = !!on; applyAudio(); }

  function dispose() {
    clearInterval(watchdog);
    window.removeEventListener('pointerdown', onGesture, { capture: true });
    window.removeEventListener('keydown', onGesture, { capture: true });
    offLive();
    HOLE.value = 0;
    player?.destroy?.();
    layer.remove();
  }

  return { sync, setAudio, dispose,
    // для проверки из консоли: __kitchen.tv.status
    get status() { return { video: VIDEOS[idx]?.id, state: playerState, shown, hole: HOLE.value === 1 }; } };
}
