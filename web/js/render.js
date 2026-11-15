// Рендер: растровая цепочка по качеству (fast / high / ultra) и фото-режим с трассировкой пути.
// Фото-режим копит проходы, пока камера и сцена неподвижны; invalidate() начинает кадр заново.
//
// Договорённости со сценой (их соблюдают main.js, lamps.js и остальные):
//   слой камеры не совпадает (вырез, слой 1) или userData.shadowOnly — в фото не видно камере, но свет и тени держит;
//   userData.glass у меша — стекло: в фото настоящее пропускание, тень не отбрасывает;
//   userData.passLight у меша и светящиеся материалы (emissiveIntensity > 0) — свет проходит сквозь (плафон вокруг лампы);
//   userData.rasterOnly у источника — подсветка-обманка для растра, в фото не участвует.
// Лак (clearcoat) в фото отключён: в связке three-gpu-pathtracer 0.0.23 + three r169 он даёт чёрную поверхность.
// Обходы ошибок трассировщика 0.0.23 (номера материалов, сжатая геометрия, кубы в материалах) — в tracerView и fixMaterialIndex.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// pr — [мин, макс] плотности пикселей; shadow — карта тени солнца; ao — выборки GTAO; autoPhoto — мс покоя до фото
export const QUALITY = {
  fast:  { pr: [1, 1],   msaa: 0, post: false, shadow: 2048 },
  high:  { pr: [1, 1.6], msaa: 4, post: true,  shadow: 4096, ao: 16, pd: { radius: 6, rings: 2, samples: 16 } },
  ultra: { pr: [1.5, 2], msaa: 8, post: true,  shadow: 8192, ao: 32, pd: { radius: 8, rings: 3, samples: 24 }, autoPhoto: 1000 },
};
const TONE = { neutral: 'NeutralToneMapping', agx: 'AgXToneMapping', aces: 'ACESFilmicToneMapping' };
const SETTLE = 150;          // мс тишины после изменения, прежде чем трассировать
const METER_AT = 8;          // на каком проходе замерять яркость фото (среднее уже без смещения, шум терпим)
const SUN_CAP = 100;         // яркость панорамы выше 100 × среднего — это солнце, его даёт DirectionalLight
const CAPTURE_TIMEOUT = 180e3;
// Пикселей за один кадр трассировки: ~40 мс на M5 Pro в квартире, на слабой карте в разы дольше. Браузер
// сбрасывает WebGL, если кадр идёт ~2 с, поэтому кадр делится на плитки, а не трассируется целиком.
const TILE_PIXELS = 100e3;

// photoPixels — сколько пикселей трассировать (больше — растягивается): 1,5 Мп ≈ 1,5 прохода/с на M5 Pro
export function createPipeline({ THREE, renderer, scene, camera, maxSamples = 1024, autoExposure = true, photoPixels = 1.5e6 }) {
  const canvas = renderer.domElement;
  let quality = 'high', q = QUALITY.high;
  let size = { w: 1, h: 1, dpr: 1 };
  let composer = null;

  // ---------- растр ----------

  function buildComposer() {
    if (composer) { composer.passes.forEach(p => p.dispose()); composer.dispose(); composer = null; }
    if (!q.post) return;
    const samples = Math.min(q.msaa, renderer.capabilities.maxSamples);
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples }));
    composer.addPass(new RenderPass(scene, camera));
    // AO под интерьер 2.64 м: радиус 45 см ловит углы и стыки мебели, не темнит стены целиком
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.blendIntensity = 0.9;
    ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: q.ao });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, ...q.pd });
    composer.addPass(ao);
    // Свечение только у очень ярких точек (лампы, блик солнца): порог в линейной яркости до экспозиции
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.15, 0.35, 2.0));
    composer.addPass(new OutputPass());
  }

  function drawRaster() {
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  function applySize(prOverride) {
    const pr = prOverride ?? Math.min(q.pr[1], Math.max(q.pr[0], size.dpr));
    renderer.setPixelRatio(pr);
    renderer.setSize(size.w, size.h, false);
    if (composer) { composer.setPixelRatio(pr); composer.setSize(size.w, size.h); }
  }

  // Карты теней по качеству: солнце — q.shadow, точечные и споты — вчетверо меньше (не больше 2048)
  function applyShadowSizes() {
    const max = Math.min(q.shadow, renderer.capabilities.maxTextureSize);
    scene.traverse(o => {
      if (!o.isLight || !o.castShadow || !o.shadow) return;
      const s = o.isDirectionalLight ? max : Math.min(2048, max / 4);
      if (o.shadow.mapSize.x === s) return;
      o.shadow.mapSize.set(s, s);
      o.shadow.map?.dispose(); o.shadow.map = null;
    });
  }

  // ---------- состояние кадра ----------

  let lastChange = performance.now();
  let rasterDirty = true, sceneDirty = true;
  let explicit = false, autoSuppressed = false;
  let pt = null, ptLoading = null, ptFailed = false, broken = false, lost = false, matteOK = false;
  const onLost = () => { lost = true; waiters.splice(0).forEach(w => w.resolve()); report(0, 'error'); };
  const onRestored = () => { lost = false; disposeTracer(); setQuality(quality); };   // трассировщик заново при следующем фото
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  let announced = false, gain = 1, metering = false, rasterPx = null;   // gain — множитель экспозиции фото
  let balance = null;   // множители RGB баланса белого фото (Vector3 в шейдере вывода)
  let progressCb = null, lastReport = '';
  const waiters = [];

  function invalidate() {
    lastChange = performance.now();
    rasterDirty = sceneDirty = true;
    autoSuppressed = broken = false;
    applyShadowSizes();
  }

  function report(samples, phase) {
    const key = samples + phase;
    if (key === lastReport) return;
    lastReport = key;
    progressCb?.(samples, { phase, target: maxSamples, exposure: gain });
  }

  // пока сцена не пересобрана, накопленное относится к прошлому кадру и не считается
  const tracedSamples = () => (pt && !sceneDirty ? Math.floor(pt.samples) : 0);

  function render() {
    if (document.hidden || lost) return;   // вкладка скрыта или WebGL сброшен — GPU не трогаем
    const now = performance.now(), quiet = now - lastChange;
    const done = tracedSamples();
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (ptFailed || broken || lost || done >= waiters[i].n || now > waiters[i].until) waiters.splice(i, 1)[0].resolve();
    }
    const want = !ptFailed && !broken && (explicit || (!!q.autoPhoto && !autoSuppressed && quiet >= q.autoPhoto));
    if (want && !pt) loadTracer();
    if (!want || !pt || quiet < SETTLE) {
      if (rasterDirty) { rasterDirty = false; drawRaster(); }
      report(0, want ? (pt ? 'waiting' : 'loading') : 'idle');
      return;
    }
    if (sceneDirty) {
      // один кадр на показ «собирается»: следующая сборка BVH может занять секунду
      if (!announced) { announced = true; report(0, 'building'); return; }
      announced = false; sceneDirty = false;
      try { flushTracer(); } catch (err) {
        // сцену не удалось собрать: показываем растр, следующая попытка — после изменения сцены
        console.warn('render.js: сцена для фото не собралась', err);
        broken = rasterDirty = true;
        report(0, 'error');
        return;
      }
    }
    if (pt.samples < maxSamples) {
      pt.renderSample();
      if (metering && pt.samples >= METER_AT) meterPhoto();
    }
    const n = tracedSamples();
    report(n, n >= maxSamples ? 'done' : 'tracing');
  }

  // ---------- трассировщик ----------

  function loadTracer() {
    if (ptLoading) return;
    ptLoading = import('three-gpu-pathtracer').then(({ WebGLPathTracer }) => {
      pt = new WebGLPathTracer(renderer);
      matteOK = patchMatte(pt._pathTracer.material);
      if (!matteOK) console.warn('render.js: патч «стена-невидимка» не применился, вырезанные стены в фото исключены');
      // интерьер светится отражённым светом; 5 отскоков против 8 — на 30 % быстрее, недобор света снимает экспозиция
      pt.bounces = 5;
      pt.transmissiveBounces = 6;        // два стекла пакета — четыре поверхности
      pt.filterGlossyFactor = 0.5;       // меньше светлячков на глянце
      pt.minSamples = METER_AT + 2;      // показать фото уже с замеренной экспозицией
      pt.renderDelay = 0;                // паузу держит SETTLE
      pt.fadeDuration = 300;
      pt.rasterizeSceneCallback = () => drawRaster();
      pt.renderToCanvasCallback = (target, r, quad) => {
        const exposure = r.toneMappingExposure, autoClear = r.autoClear;
        r.toneMappingExposure = exposure * gain; r.autoClear = false;
        quad.render(r);
        r.toneMappingExposure = exposure; r.autoClear = autoClear;
      };
      balance = patchBalance(THREE, pt._quad.material);
      if (!balance) console.warn('render.js: баланс белого фото не подключился');
      sceneDirty = true;
    }).catch(err => {
      console.warn('render.js: трассировщик не загрузился', err);
      ptFailed = true;
      report(0, 'error');
    });
  }

  function flushTracer() {
    const view = tracerView(THREE, scene, camera, { matte: matteOK, environment: tracerEnvironment() });
    try {
      const n = view.textureSources;   // массив текстур трассировщика: 16 МБ на слой при 2048
      pt.textureSize.set(n <= 32 ? 2048 : 1024, n <= 32 ? 2048 : 1024);
      pt.renderScale = Math.min(1, Math.sqrt(photoPixels / (canvas.width * canvas.height)));
      const side = Math.max(2, Math.ceil(Math.sqrt(canvas.width * canvas.height * pt.renderScale ** 2 / TILE_PIXELS)));
      pt.tiles.set(side, side);          // один проход = side² кадров: каждый кадр короткий
      pt.setScene(scene, camera);
      if (!fixMaterialIndex(THREE, pt)) console.warn('render.js: номера материалов трассировщика не сошлись');
    } finally { view.restore(); }
    metering = autoExposure;
    if (autoExposure) rasterPx = measure(null);
  }

  // Экспозиция и баланс белого фото подгоняются под растр. Сравнение — в сжатых яркостях y/(1+y), как их
  // видит глаз после экспозиции: иначе среднее решают пересвеченные окна, а не комната.
  // Яркость: растр светлее за счёт зондов-переотражений и подсветки-обманки; предел −1…+3 ступени.
  // Цвет: в закрытой комнате свет много раз отражается от тёплых стен и дуба и желтеет сильнее,
  // чем в растре; камера сняла бы это балансом белого.
  function meterPhoto() {
    metering = false;
    const p = measure(pt.target.texture), e = renderer.toneMappingExposure;
    const r = perceived(rasterPx, e);
    let lo = Math.log(0.5), hi = Math.log(8);
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (perceived(p, e * Math.exp(mid)).lum < r.lum) lo = mid; else hi = mid;
    }
    gain = Math.exp((lo + hi) / 2);
    if (!balance) return;
    const q = perceived(p, e * gain);
    const k = [0, 1, 2].map(c => THREE.MathUtils.clamp((r.rgb[c] / Math.max(1e-6, r.lum)) / Math.max(1e-6, q.rgb[c] / q.lum), 0.6, 1.6));
    const y = 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
    balance.set(k[0] / y, k[1] / y, k[2] / y);
  }

  // Окружение для трассировщика — исходная панорама (PMREM он не читает) без диска солнца
  const envCache = new WeakMap();
  function tracerEnvironment() {
    const src = [scene.environment, scene.background]
      .find(t => t?.isDataTexture && t.mapping === THREE.EquirectangularReflectionMapping);
    if (!src) return null;
    if (!envCache.has(src)) envCache.set(src, withoutSun(THREE, src));
    return envCache.get(src);
  }

  // ---------- замер: линейные пиксели сетки 96 точек в ширину ----------

  let meter = null;
  function measure(texture) {
    const w = 96, h = Math.max(1, Math.round(96 / camera.aspect));
    if (!meter) {
      meter = {
        rt: new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType }),
        quad: new FullScreenQuad(new THREE.ShaderMaterial({
          uniforms: { map: { value: null } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texelFetch(map, ivec2(vUv * vec2(textureSize(map, 0))), 0); }',
        })),
      };
    }
    if (meter.rt.width !== w || meter.rt.height !== h) meter.rt.setSize(w, h);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(meter.rt);
    if (texture) { meter.quad.material.uniforms.map.value = texture; meter.quad.render(renderer); }
    else renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    const px = new Float32Array(w * h * 4);
    renderer.readRenderTargetPixels(meter.rt, 0, 0, w, h, px);
    return px;
  }

  // ---------- снимок ----------

  const toBlob = () => new Promise(res => canvas.toBlob(res, 'image/png'));

  async function capture(minSamples = 0) {
    if (!minSamples || ptFailed) {   // растр с удвоенной плотностью
      applySize(Math.max(2, renderer.getPixelRatio()));
      drawRaster();
      const blob = await toBlob();
      applySize(); invalidate();
      return blob;
    }
    const entered = !explicit;
    if (entered) enterPhoto();
    // не меньше 16 проходов: к этому времени растр под фото уже полностью растворился
    const n = Math.min(Math.max(16, minSamples), maxSamples);
    await new Promise(resolve => waiters.push({ n, until: performance.now() + CAPTURE_TIMEOUT, resolve }));
    if (lost) { if (entered) exitPhoto(); return null; }
    if (ptFailed || broken || !pt) { if (entered) exitPhoto(); return capture(0); }
    pt.pausePathTracing = true;      // перерисовать накопленное без нового прохода и сразу прочитать холст
    pt.renderSample();
    const blob = toBlob();
    pt.pausePathTracing = false;
    if (entered) exitPhoto();
    return blob;
  }

  // У WebGLPathTracer 0.0.23 dispose() сломан (обращается к несуществующему полю) — освобождаем по частям
  function disposeTracer() {
    if (!pt) return;
    const m = pt._pathTracer.material;
    for (const u of Object.values(m.uniforms)) u.value?.dispose?.();
    m.dispose();
    pt._pathTracer.dispose(); pt._lowResPathTracer.dispose(); pt._quad.dispose();
    pt = null; ptLoading = null; balance = null; sceneDirty = true;
  }

  function dispose() {
    exitPhoto();
    disposeTracer();
    if (composer) { composer.passes.forEach(p => p.dispose()); composer.dispose(); composer = null; }
    if (meter) { meter.rt.dispose(); meter.quad.dispose(); meter.quad.material.dispose(); meter = null; }
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  }

  // ---------- интерфейс ----------

  function enterPhoto() { explicit = true; lastChange = performance.now() - SETTLE; }
  function exitPhoto() { explicit = false; autoSuppressed = true; rasterDirty = true; report(0, 'idle'); }

  function setQuality(name) {
    quality = QUALITY[name] ? name : 'high';
    q = QUALITY[quality];
    buildComposer();
    applySize();
    invalidate();
  }

  function setToneMapping(name) {
    renderer.toneMapping = THREE[TONE[name] || TONE.neutral];
    rasterDirty = true;
  }

  setToneMapping('neutral');   // Khronos PBR Neutral: цвета материалов до ~0.8 не сдвигаются, мягкое плечо в светах
  setQuality('high');

  return {
    render,
    invalidate,
    setSize(w, h, dpr = window.devicePixelRatio) { size = { w, h, dpr }; applySize(); invalidate(); },
    setQuality,
    setToneMapping,
    enterPhoto,
    exitPhoto,
    capture,
    dispose,
    onProgress(cb) { progressCb = cb; },
    get quality() { return quality; },
    get photo() { return explicit; },
    get samples() { return tracedSamples(); },
  };
}

// ---------- подготовка сцены для трассировщика (временная, откатывается restore) ----------

// Трассировщик не знает слоёв и инстансов и берёт свойства прямо из материалов.
// На время setScene: скрытые от камеры меши получают «матовых двойников» (камера смотрит сквозь, свет держат),
// стекло — двойника с пропусканием, плафоны — двойника без тени; инстансы разворачиваются в обычные меши;
// подсветка-обманка и выключенные источники прячутся; окружение подменяется панорамой без солнца.
const twins = new Map();      // `${uuid}|${flags}` -> материал-двойник (только данные, в растре не рисуется)
const proxies = new WeakMap(); // InstancedMesh -> развёрнутый меш

const HIDDEN = 1, GLASS = 2, PASS = 4, COAT = 8, FLAT = 16;
// Трассировщик копирует ВСЕ текстуры материала в плоский массив; кубы (envMap зеркала) и массивы туда не лезут
const flatOnly = t => !(t.isCubeTexture || t.isDataArrayTexture || t.isData3DTexture);

export function tracerView(THREE, scene, camera, { matte = true, environment = null } = {}) {
  const undo = [], added = [], sources = new Set(), used = new Set();
  const set = (o, k, v) => { undo.push([o, k, o[k]]); o[k] = v; };
  const hasDeep = m => { for (const k in m) if (m[k]?.isTexture && !flatOnly(m[k])) return true; return false; };
  const glows = m => m.emissiveIntensity > 0 && m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0;

  const twin = (m, flags) => {
    for (const k in m) if (m[k]?.isTexture && flatOnly(m[k])) sources.add(m[k].source.uuid);
    if (!flags) return m;
    const id = `${m.uuid}|${flags}`;
    used.add(id);
    let t = twins.get(id);
    if (t) t.copy(m); else twins.set(id, t = m.clone());
    if (flags & HIDDEN) t.matte = true;
    if ((flags & GLASS) && 'transmission' in t) {
      // цвет растрового стекла — тёмный оттенок отражения при opacity ~0.1; в трассировке цвет красит прошедший свет
      // thickness 0 и attenuationDistance ∞ — тонкая плёнка: свет проходит без смещения и поглощения
      Object.assign(t, { transparent: false, opacity: 1, transmission: 1, thickness: 0, attenuationDistance: Infinity, ior: 1.5, metalness: 0 });
      t.color.setRGB(0.96, 0.98, 0.98);
      t.roughness = Math.min(t.roughness, 0.05);
    }
    if (flags & PASS) t.castShadow = false;
    if (flags & COAT) t.clearcoat = 0;
    if (flags & FLAT) for (const k in t) if (t[k]?.isTexture && !flatOnly(t[k])) t[k] = null;
    return t;
  };

  const dress = o => {
    const hidden = o.userData.shadowOnly || !o.layers.test(camera.layers);
    if (hidden && !matte) { set(o, 'visible', false); return; }
    if (needsPlain(o.geometry)) set(o, 'geometry', traceable(THREE, o.geometry));
    const base = (hidden ? HIDDEN : 0) | (o.userData.glass ? GLASS | PASS : 0) | (o.userData.passLight ? PASS : 0);
    const pick = m => twin(m, base | (glows(m) ? PASS : 0) | (m.clearcoat > 0 ? COAT : 0) | (hasDeep(m) ? FLAT : 0));
    const mat = Array.isArray(o.material) ? o.material.map(pick) : pick(o.material);
    if (Array.isArray(mat) ? mat.some((m, i) => m !== o.material[i]) : mat !== o.material) set(o, 'material', mat);
  };

  const edits = [];
  // Источники: трассировщик смотрит только на visible самого источника, поэтому прячем и те, что внутри скрытых групп
  const lights = (o, shown) => {
    shown = shown && o.visible;
    if (o.isLight && o.visible && (!shown || o.userData.rasterOnly || !(o.intensity > 0))) edits.push(() => set(o, 'visible', false));
    o.children.forEach(c => lights(c, shown));
  };
  lights(scene, true);
  scene.traverseVisible(o => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh) {
      const p = expand(THREE, o);
      edits.push(() => { set(o, 'visible', false); scene.add(p); added.push(p); dress(p); });
      return;
    }
    edits.push(() => dress(o));
  });
  edits.forEach(f => f());   // правки после обхода, чтобы не менять дерево на ходу
  set(scene, 'environment', environment);   // PMREM трассировщик не читает: без панорамы — без окружения
  for (const id of twins.keys()) if (!used.has(id)) twins.delete(id);

  return {
    textureSources: sources.size,
    restore() {
      for (let i = undo.length - 1; i >= 0; i--) { const [o, k, v] = undo[i]; o[k] = v; }
      added.forEach(p => scene.remove(p));
    },
  };
}

// Геометрия, которую трассировщик прочтёт правильно. Он копирует сырые массивы атрибутов: сжатый GLB
// (Int16 normalized) становится мешем в десятки километров, чередованный массив читается вперемешку,
// а цвет RGB не сливается с его RGBA по умолчанию. Всё это переводим в обычный Float32.
const plain = new WeakMap();   // геометрия -> { key, geometry }
const needsPlain = g => g.attributes.color?.itemSize === 3 ||
  Object.values(g.attributes).some(a => !flat32(a));
const flat32 = a => !a.normalized && !a.isInterleavedBufferAttribute && a.array instanceof Float32Array;
function traceable(THREE, g) {
  const key = Object.values(g.attributes).map(a => a.version).join();
  let e = plain.get(g);
  if (!e || e.key !== key) {
    e?.geometry.dispose();
    const out = g.clone();
    for (const [name, a] of Object.entries(g.attributes)) {
      const size = name === 'color' ? 4 : a.itemSize;
      if (size === a.itemSize && flat32(a)) continue;
      const f = new Float32Array(a.count * size);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) f[i * size + c] = c < a.itemSize ? a.getComponent(i, c) : 1;
      out.setAttribute(name, new THREE.BufferAttribute(f, size));
    }
    plain.set(g, e = { key, geometry: out });
  }
  return e.geometry;
}

// Инстансы -> один меш со всеми копиями (трассировщик берёт только геометрию и matrixWorld)
function expand(THREE, inst) {
  const key = `${inst.geometry.uuid}|${inst.instanceMatrix.version}|${inst.count}`;
  let p = proxies.get(inst);
  if (!p || p.userData.key !== key) {
    p?.geometry.dispose();
    const m4 = new THREE.Matrix4();
    const parts = [];
    for (let i = 0; i < inst.count; i++) { inst.getMatrixAt(i, m4); parts.push(inst.geometry.clone().applyMatrix4(m4)); }
    p = new THREE.Mesh(mergeGeometries(parts), inst.material);
    parts.forEach(g => g.dispose());
    p.matrixAutoUpdate = false;
    p.userData = { key };
    proxies.set(inst, p);
  }
  inst.updateWorldMatrix(true, false);
  p.matrix.copy(inst.matrixWorld);
  p.material = inst.material;
  p.layers.mask = inst.layers.mask;
  Object.assign(p.userData, { shadowOnly: inst.userData.shadowOnly, glass: inst.userData.glass, passLight: inst.userData.passLight });
  return p;
}

// Номер материала у каждой вершины. Трассировщик 0.0.23 считает его неверно у мешей с массивом материалов
// (стены: 6 граней — 6 материалов, всё после первой такой стены сдвигается) и не пересчитывает,
// если сменились только материалы. Пересчитываем сами после каждого setScene.
function fixMaterialIndex(THREE, pt) {
  const gen = pt._generator, geo = gen.geometry, mats = pt._materials;
  const meshes = gen.staticGeometryGenerator._getMeshes();
  geo.groups.splice(0, geo.groups.length - meshes.length);   // группы копятся с каждой сборкой, нужны последние
  const first = new Map();
  mats.forEach((m, i) => { if (!first.has(m)) first.set(m, i); });
  const Arr = mats.length > 65535 ? Uint32Array : mats.length > 255 ? Uint16Array : Uint8Array;
  const count = geo.attributes.position.count, index = geo.index;
  let attr = geo.attributes.materialIndex;
  if (!attr || attr.count !== count || !(attr.array instanceof Arr)) geo.setAttribute('materialIndex', attr = new THREE.BufferAttribute(new Arr(count), 1));
  let slot = 0;
  meshes.forEach((mesh, k) => {
    const G = geo.groups[k], multi = Array.isArray(mesh.material);
    const parts = multi && mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const p of parts) {
      const id = first.get(mats[slot + p.materialIndex]) ?? 0;
      for (let j = p.start, end = Math.min(G.count, p.start + p.count); j < end; j++) {
        const t = G.start + j;
        attr.array[index ? index.getX(t) : t] = id;
      }
    }
    slot += multi ? mesh.material.length : 1;
  });
  if (slot !== mats.length || meshes.length !== geo.groups.length) return false;
  attr.needsUpdate = true;
  pt._pathTracer.material.materialIndexAttribute.updateFrom(attr);
  return true;
}

// Средние сжатой яркости y/(1+y) и цвета, сжатого тем же множителем (оттенок пикселя сохраняется)
function perceived(px, exposure) {
  const rgb = [0, 0, 0];
  let lum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const y = exposure * (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]), k = exposure / (1 + y);
    lum += y / (1 + y); rgb[0] += px[i] * k; rgb[1] += px[i + 1] * k; rgb[2] += px[i + 2] * k;
  }
  const n = px.length / 4;
  return { lum: lum / n, rgb: rgb.map(v => v / n) };
}

// Копия панорамы, где всё ярче SUN_CAP × среднего (диск солнца) приглушено до порога с сохранением оттенка
export function withoutSun(THREE, src) {
  const { data, width, height } = src.image;
  const half = src.type === THREE.HalfFloatType;
  if (!half && src.type !== THREE.FloatType) return src;
  const read = half ? i => THREE.DataUtils.fromHalfFloat(data[i]) : i => data[i];
  const n = width * height, lum = new Float32Array(n);
  let logSum = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    lum[p] = 0.2126 * read(i) + 0.7152 * read(i + 1) + 0.0722 * read(i + 2);
    logSum += Math.log(1e-4 + lum[p]);
  }
  const cap = SUN_CAP * Math.exp(logSum / n);
  const out = data.slice();
  for (let p = 0; p < n; p++) {
    if (lum[p] <= cap) continue;
    const k = cap / lum[p], i = p * 4;
    for (let c = 0; c < 3; c++) out[i + c] = half ? THREE.DataUtils.toHalfFloat(read(i + c) * k) : data[i + c] * k;
  }
  const t = src.clone();
  t.source = new THREE.Source({ data: out, width, height });
  t.needsUpdate = true;
  return t;
}

// Библиотека красит «matte» прозрачной дырой. Меняем на «камера смотрит сквозь»: первый луч проходит
// поверхность и летит дальше как первый (до 16 таких стен), остальные лучи и тени её видят.
export function patchMatte(material) {
  const fs = material.fragmentShader;
  const loop = 'for ( int i = 0; i < bounces; i ++ ) {';
  const hole = /if \( material\.matte && state\.firstRay \) \{\s*gl_FragColor = vec4\( 0\.0 \);\s*break;\s*\}/;
  if (fs.split(loop).length !== 2 || !hole.test(fs)) return false;
  material.fragmentShader = fs.replace(loop, 'int matteSkips = 0;\n' + loop).replace(hole, `if ( material.matte && state.firstRay ) {
		if ( matteSkips < 16 ) { matteSkips ++; i --; }
		ray.origin = stepRayOrigin( ray.origin, ray.direction, - surfaceHit.faceNormal, surfaceHit.dist );
		continue;
	}`);
  material.needsUpdate = true;
  return true;
}

// Баланс белого при выводе накопленного кадра: множитель RGB до тональной кривой
export function patchBalance(THREE, material) {
  const fs = material.fragmentShader;
  const fetch = 'vec4 res = texelFetch( map, ivec2( px.x, px.y ), 0 );';
  if (fs.split(fetch).length !== 2 || !fs.includes('uniform float opacity;')) return null;
  const value = new THREE.Vector3(1, 1, 1);
  material.uniforms.balance = { value };
  material.fragmentShader = fs.replace('uniform float opacity;', 'uniform float opacity;\nuniform vec3 balance;')
    .replace(fetch, fetch + '\n\t\t\t\t\tres.rgb *= balance;');
  material.needsUpdate = true;
  return value;
}
