// Рендер: растровая цепочка по качеству (eco / fast / high / ultra) и фото-режим с трассировкой пути.
// Фото-режим копит проходы, пока камера и сцена неподвижны; invalidate() начинает кадр заново.
//
//   const pipe = createPipeline({ THREE, renderer, scene, camera });
//   pipe.render()               — каждый кадр (рисует, только если что-то изменилось: в покое кадров нет)
//   pipe.invalidate()           — сцена или камера изменились; pipe.setQuality(q), setSize, setToneMapping
//   pipe.enterPhoto()/exitPhoto(), capture(minSamples) -> Blob PNG, onProgress(cb), onLive(fn), setOverlay(o)
//   pipe.whenDrawn()            — Promise: следующий растровый кадр нарисован (шейдеры собраны, текстуры залиты) — первый вид
//   DEFAULT_QUALITY             — качество для тех, кто его ещё не выбирал (выбор хранит ui.js в браузере): «Эконом»
//   rasterBusy(renderer)        — идёт фоновая сборка шейдеров: lighting.js в это время не снимает зонды
//   NOTICE                      — имя события на window для всплывающих сообщений (ловит ui.js)
//   QUALITY_REQUEST             — событие «сменить качество» (кнопка в подсказке о малом числе кадров; ловит ui.js)
//
// Почему не замирает:
// - Карты теней перерисовываются, только когда сдвинулся отбрасывающий тень меш или источник (refreshShadows), а не каждый кадр.
// - Без AO/свечения eco/fast рисуют прямо на холст: без двух полноэкранных HDR-целей и прохода вывода.
//   High/ultra используют композер; новые варианты программ при переключении собираются фоном.
// - Новые и изменённые материалы, смена набора источников: шейдеры собираются фоном (KHR_parallel_shader_compile),
//   до готовности держится прошлый кадр — без секундных заморозок на первой отрисовке.
// - Фото: BVH сцены (≈1,2 млн треугольников, ~5 с) строится в Web Worker; трассировщик (≈1 ГБ памяти) освобождается
//   через PHOTO_KEEP после выхода из фото.
// - Сброс WebGL (нехватка видеопамяти): сообщение, восстановление сцены, фото выключается; не вернулся — «Перезагрузить».
//
// Договорённости со сценой (их соблюдают main.js, lamps.js и остальные):
//   слой камеры не совпадает (вырез, слой 1) или userData.shadowOnly — в фото не видно камере, но свет и тени держит;
//   userData.glass у меша — стекло: в фото настоящее пропускание, тень не отбрасывает;
//   userData.passLight у меша и светящиеся материалы (emissiveIntensity > 0) — свет проходит сквозь (плафон вокруг лампы);
//   userData.rasterOnly у источника — подсветка-обманка для растра, в фото не участвует; у меша (следы пуль) —
//   только растр: в фото, PNG и GLB его нет.
// Лак (clearcoat) в фото отключён: в связке three-gpu-pathtracer 0.0.23 + three r169 он даёт чёрную поверхность.
// Обходы ошибок трассировщика 0.0.23 (номера материалов, сжатая геометрия, кубы в материалах) — в tracerView и fixMaterialIndex.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRasterBatches } from './raster-batches.js';
import { createEcoMaterials } from './eco-materials.js';

// px — бюджет пикселей кадра (плотность снижается до pr[0], если окно большое); pr — [мин, макс] плотности;
// shadow — карта тени солнца (споты — вчетверо меньше); ao — выборки GTAO (0 — без AO); bloom — свечение.
// eco («Эконом», макс. FPS): плотность ≤ 1, без AO и свечения, переотражения — один отскок.
// На eco материалы плоские; переключение вариантов программ собирается фоном.
// Трассировка (фото-режим) включается и выключается только явно (enterPhoto/exitPhoto), само качество её не включает.
export const QUALITY = {
  eco:   { px: 1.2e6, pr: [0.6, 1],  msaa: 0, shadow: 1024, ao: 0,  bloom: false },
  fast:  { px: 2.5e6, pr: [0.75, 1], msaa: 0, shadow: 2048, ao: 0,  bloom: false },
  high:  { px: 4.5e6, pr: [1, 1.6],  msaa: 4, shadow: 4096, ao: 16, bloom: true,  pd: { radius: 6, rings: 2, samples: 16 } },
  ultra: { px: 9e6,   pr: [1.5, 2],  msaa: 4, shadow: 4096, ao: 32, bloom: true,  pd: { radius: 8, rings: 3, samples: 24 } },
};
// Первое открытие — самое лёгкое: и кадр, и ассеты (текстуры 1k, панорама 1k — materials.js, lighting.js)
export const DEFAULT_QUALITY = 'eco';
export const NOTICE = 'kitchen-notice';
const notice = (msg, action = null, ms) => dispatchEvent(new CustomEvent(NOTICE, { detail: { msg, action, ms } }));
// Просьба сменить качество (detail — id из QUALITY): ui.js ставит его как выбор пользователя (настройка браузера)
export const QUALITY_REQUEST = 'kitchen-quality';
const ORDER = ['eco', 'fast', 'high', 'ultra'];
// Слежение за частотой кадров: непрерывная отрисовка (прогулка, охота, долгий облёт) дольше SLOW_WINDOW с медианой
// кадра больше SLOW_FRAME — предложить качество ниже. Один раз на каждое качество за сеанс.
const SLOW_WINDOW = 4000, SLOW_FRAME = 33;
const TONE = { neutral: 'NeutralToneMapping', agx: 'AgXToneMapping', aces: 'ACESFilmicToneMapping' };
const SETTLE = 150;          // мс тишины после изменения, прежде чем трассировать
const METER_AT = 8;          // на каком проходе замерять яркость фото (среднее уже без смещения, шум терпим)
const SUN_CAP = 100;         // яркость панорамы выше 100 × среднего — это солнце, его даёт DirectionalLight
const CAPTURE_TIMEOUT = 180e3;
const CAPTURE_PX = 12e6;     // снимок PNG растром — не больше 12 Мп (вдвое плотнее экрана, но без гигантских целей)
const PHOTO_KEEP = 20e3;     // трассировщик живёт столько после выхода из фото (повторный вход — без сборки)
const COMPILE_WAIT = 15e3;   // дольше фоновую сборку не ждём: рисуем как есть (three доберёт синхронно)
const UPLOAD_MS = 8;        // бюджет заливки текстур новых материалов на кадр (минимум одна)
const LOST_WAIT = 6e3;       // WebGL не вернулся за это время — предложить перезагрузку
// Пикселей за один кадр трассировки: ~40 мс на M5 Pro в квартире, на слабой карте в разы дольше. Браузер
// сбрасывает WebGL, если кадр идёт ~2 с, поэтому кадр делится на плитки, а не трассируется целиком.
const TILE_PIXELS = 100e3;

const busy = new WeakSet();   // рендереры, у которых идёт фоновая сборка шейдеров
export const rasterBusy = renderer => busy.has(renderer);

// photoPixels — сколько пикселей трассировать (больше — растягивается): 1,5 Мп ≈ 1,5 прохода/с на M5 Pro
export function createPipeline({ THREE, renderer, scene, camera, maxSamples = 1024, autoExposure = true, photoPixels = 1.5e6, quality: startQuality = DEFAULT_QUALITY }) {
  const canvas = renderer.domElement;
  const batches = createRasterBatches({ THREE, scene, renderer });
  const eco = createEcoMaterials({ THREE, scene, renderer });
  renderer.debug.checkShaderErrors = false;   // ошибки шейдеров проверяет фоновая сборка (startCompile), без журнала на каждую
  let quality = 'high', q = QUALITY.high;
  let size = { w: 1, h: 1, dpr: 1 };

  // ---------- растр: один композер на все качества ----------
  // Сцена рисуется в rtA (MSAA, глубина), проходы после неё — в rtB (без MSAA и глубины).
  const rtB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const composer = new EffectComposer(renderer, rtB);
  composer.renderTarget2.dispose();
  const rtA = composer.renderTarget2 = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 });
  composer.addPass(new RenderPass(scene, camera));
  // AO под интерьер 2.64 м: радиус 45 см ловит углы и стыки мебели, не темнит стены целиком
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.blendIntensity = 0.9;
  ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1.0 });
  composer.addPass(ao);
  // Свечение только у очень ярких точек (лампы, блик солнца): порог в линейной яркости до экспозиции
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.15, 0.35, 2.0);
  // ТВ (tv.js): альфа кадра — «дыра» под YouTube-плеер за холстом. Свечение прибавляет только цвет и альфу не трогает
  // (у штатного AdditiveBlending альфа экрана росла бы на ~0.2 и затемняла видео). GTAO и OutputPass альфу и так хранят.
  Object.assign(bloom.blendMaterial, { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let aoKey = '';

  function configureComposer() {
    const samples = Math.min(q.msaa, renderer.capabilities.maxSamples);
    if (rtA.samples !== samples) { rtA.samples = samples; rtA.dispose(); }   // цель пересоздастся при следующей отрисовке
    ao.enabled = q.ao > 0;
    bloom.enabled = q.bloom;
    const key = q.ao ? `${q.ao}|${q.pd.radius}|${q.pd.rings}|${q.pd.samples}` : aoKey;
    if (key !== aoKey) {   // выборки — это defines: пересобирается только шейдер AO, не материалы
      aoKey = key;
      ao.updateGtaoMaterial({ samples: q.ao });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, ...q.pd });
    }
  }

  function drawRaster() {
    const draw = () => {
      if (!ao.enabled && !bloom.enabled) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      composer.readBuffer = rtA; composer.writeBuffer = rtB;   // проходы меняют их местами — сцена всегда в rtA
      composer.render();
    };
    return batches.draw(() => quality === 'eco' ? eco.draw(draw) : draw());
  }

  const frameGaps = [], offered = new Set();
  let lastDraw = 0, streakStart = 0;
  function watchFrameRate(now) {
    const gap = now - lastDraw;
    lastDraw = now;
    if (gap > 250) { frameGaps.length = 0; streakStart = now; return; }   // пауза — новая серия
    frameGaps.push(gap);
    if (now - streakStart < SLOW_WINDOW) return;
    const sorted = frameGaps.slice().sort((a, b) => a - b), median = sorted[sorted.length >> 1];
    frameGaps.length = 0; streakStart = now;
    const lower = ORDER[ORDER.indexOf(quality) - 1];
    if (median <= SLOW_FRAME || !lower || offered.has(quality)) return;
    offered.add(quality);
    const fps = Math.round(1000 / median), name = { eco: 'Эконом', fast: 'Быстрое', high: 'Высокое' }[lower];
    notice(`Кадров мало: ~${fps} в секунду. Качество «${name}» будет плавнее`,
      { label: 'Переключить', run: () => dispatchEvent(new CustomEvent(QUALITY_REQUEST, { detail: lower })) }, 8000);
  }

  function applySize(prOverride) {
    const base = Math.min(q.pr[1], Math.max(q.pr[0], size.dpr));
    const pr = prOverride ?? Math.max(q.pr[0], Math.min(base, Math.sqrt(q.px / Math.max(1, size.w * size.h))));
    renderer.setPixelRatio(pr);
    renderer.setSize(size.w, size.h, false);
    if (ao.enabled || bloom.enabled) { composer.setPixelRatio(pr); composer.setSize(size.w, size.h); }
    else { composer.setPixelRatio(1); composer.setSize(1, 1); }
    // выключенные проходы не держат полноэкранных целей (AO — нормали, глубина и шум; свечение — цепочка мипов)
    if (!ao.enabled) ao.setSize(1, 1);
    if (!bloom.enabled) bloom.setSize(1, 1);
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
      renderer.shadowMap.needsUpdate = true;
    });
  }

  // ---------- тени: только когда что-то сдвинулось ----------
  // Карты теней (солнце 4096 и до пяти спотов 1024, ~0,9 млн треугольников) three по умолчанию перерисовывает
  // каждый кадр, хотя от движения камеры они не меняются: это половина времени кадра при облёте.
  // Перерисовка — когда сдвинулся, появился или пропал отбрасывающий тень меш (двери, звери в hunt.js) или источник
  // с тенью, плюс по lighting.invalidate() (смена света, мебели, материалов) и смене размеров карт.
  renderer.shadowMap.autoUpdate = false;
  let shadowSum = NaN;
  function shadowCasters() {
    scene.updateMatrixWorld();
    let sum = 0, i = 0;
    scene.traverseVisible(o => {
      if (!o.castShadow || !(o.isMesh || o.isLight)) return;
      const e = o.matrixWorld.elements, w = ++i;
      sum += w * (e[0] + 3 * e[5] + 7 * e[10] + 11 * e[12] + 13 * e[13] + 17 * e[14] + 19 * e[1] + 23 * e[8]);
      if (o.isInstancedMesh) sum += w * (o.instanceMatrix.version + 31 * o.count);
      if (o.isLight) sum += w * (o.intensity > 0 ? 37 : 41);
    });
    return sum + i * 1e-3;
  }
  function refreshShadows() {
    const s = shadowCasters();
    if (s !== shadowSum) { shadowSum = s; renderer.shadowMap.needsUpdate = true; }
  }

  // ---------- фоновая сборка шейдеров ----------
  // После invalidate() сцена сверяется (≈0,1 мс): новые материалы, сменившаяся версия (needsUpdate), набор источников.
  // Если есть новое — renderer.compile() ставит программы в фоновую сборку, кадр не рисуется, пока они не готовы.
  let seen = new WeakMap(), lightSig = '', scanNeeded = true, compile = null;
  function lightSignature() {
    const n = {};
    scene.traverseVisible(o => {
      if (!o.isLight || !o.layers.test(camera.layers)) return;
      const k = o.type + (o.castShadow ? 's' : '') + (o.map ? 'm' : '');
      n[k] = (n[k] || 0) + 1;
    });
    return Object.keys(n).sort().map(k => k + n[k]).join();
  }
  // Прозрачные двусторонние (и стекло с пропусканием) three сам рисует в два прохода, переключая side с needsUpdate:
  // их версия растёт каждый кадр без новых программ — у них считается только появление, не версия.
  const twoPass = m => m.side === THREE.DoubleSide && !m.forceSinglePass && (m.transparent || m.transmission > 0);
  // Возвращает null — нового нет; [] — сменился набор источников (собрать всё); иначе меши с новыми материалами.
  function scanScene() {
    scanNeeded = false;
    const fresh = [];
    const check = m => {
      if (!m) return false;
      const v = seen.get(m);
      if (v === m.version || (v !== undefined && twoPass(m))) return false;
      seen.set(m, m.version); return true;
    };
    scene.traverse(o => {
      if (!o.material) return;
      if (Array.isArray(o.material) ? o.material.map(check).includes(true) : check(o.material)) fresh.push(o);
    });
    const sig = lightSignature();
    if (sig !== lightSig) { lightSig = sig; return []; }
    return fresh.length ? fresh : null;
  }
  // Собирать только новое: обход всей сцены в renderer.compile — ~60 мс. Меши подаются «тенями» (Object.create)
  // без детей: их источники не попадут в сборку второй раз (иначе ключ программ был бы с лишним светом).
  const batch = new THREE.Object3D();
  // Программы собираются фоном, а текстуры новых материалов тем временем льются по UPLOAD_MS за кадр (карта 2048 —
  // 30–45 мс заливки, все сразу — сотни мс в одном кадре). Пока идёт, кадр не рисуется: на экране прошлый.
  const gl = renderer.getContext();
  function startCompile(list) {
    batch.children = list.map(o => Object.assign(Object.create(o), { children: [] }));
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rtA);   // ключ программы как у растра: в цель, без тональной кривой (так же снимают зонды)
    let materials;
    try { materials = list.length ? renderer.compile(batch, camera, scene) : renderer.compile(scene, camera); }
    finally { renderer.setRenderTarget(prev); batch.children = []; }
    const textures = new Set();
    for (const m of materials) for (const k in m) if (m[k]?.isTexture && !m[k].isRenderTargetTexture && m[k].image) textures.add(m[k]);
    const job = compile = { until: performance.now() + COMPILE_WAIT, materials, textures: [...textures] };
    busy.add(renderer);
    const poll = () => {
      if (compile !== job) return;
      for (const m of materials) {
        const prog = renderer.properties.get(m).currentProgram;
        if (prog?.isReady() === false) continue;
        // проверка ошибок three (renderer.debug.checkShaderErrors) выключена: её журнал стоит 10–30 мс на программу
        if (prog && !gl.getProgramParameter(prog.program, gl.LINK_STATUS)) console.warn('render.js: шейдер не собрался', m.name || m.type, gl.getProgramInfoLog(prog.program));
        materials.delete(m);
      }
      if (materials.size && performance.now() < job.until && !lost) { setTimeout(poll, 16); return; }
      job.programsReady = true;
    };
    poll();
  }
  // true — держать прошлый кадр (идёт сборка или заливка текстур)
  function compiling() {
    if (!compile) {
      const list = scanNeeded ? scanScene() : null;
      if (!list) return false;
      startCompile(list);
    }
    const job = compile, t0 = performance.now();   // текстуры льются, пока программы собираются в фоне
    while (job.textures.length && performance.now() - t0 < UPLOAD_MS) {
      const t = job.textures.pop(), p = renderer.properties.get(t);
      if (p.__webglTexture && p.__version === t.version) continue;
      renderer.initTexture(t);
    }
    if ((job.textures.length || !job.programsReady) && !lost) return true;
    compile = null; busy.delete(renderer); rasterDirty = true;
    return false;
  }

  // ---------- состояние кадра ----------

  let lastChange = performance.now();
  let rasterDirty = true, sceneDirty = true;
  let explicit = false;
  let pt = null, ptLoading = null, ptFailed = false, broken = false, lost = false, matteOK = false;
  let building = null, keepTimer = 0, lostTimer = 0;
  const onLost = () => {
    lost = true; compile = null; busy.delete(renderer);
    waiters.splice(0).forEach(w => w.resolve()); report(0, 'error');
    notice('Видеокарта сбросила 3D-сцену. Восстанавливаем…', null, LOST_WAIT);
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => { if (lost) notice('3D-сцена не восстановилась', { label: 'Перезагрузить', run: () => location.reload() }, 600e3); }, LOST_WAIT);
  };
  const onRestored = () => {
    lost = false; clearTimeout(lostTimer);
    const wasPhoto = explicit;
    dropTracer();   // объекты трассировщика жили в потерянном контексте
    explicit = false; report(0, 'idle');
    seen = new WeakMap(); lightSig = '';   // все программы заново — фоном
    setQuality(quality);
    notice(wasPhoto ? 'Сцена восстановлена. Фото-режим выключен: не хватило видеопамяти' : 'Сцена восстановлена');
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  let announced = false, gain = 1, metering = false, rasterPx = null;   // gain — множитель экспозиции фото
  let balance = null;   // множители RGB баланса белого фото (Vector3 в шейдере вывода)
  let progressCb = null, lastReport = '';
  const waiters = [];
  const drawnWaiters = [];   // whenDrawn()
  // Слой поверх растра (руки с оружием в прогулке, viewmodel.js): { active() -> bool, draw() }.
  // Рисуется только в живом растре: не в фото-режиме, не в capture() и не в трассировщике.
  let overlay = null;

  function invalidate() {
    lastChange = performance.now();
    rasterDirty = sceneDirty = scanNeeded = true;
    broken = false;
    applyShadowSizes();
  }

  function report(samples, phase) {
    const key = samples + phase;
    if (key === lastReport) return;
    lastReport = key;
    progressCb?.(samples, { phase, target: maxSamples, exposure: gain });
  }

  // пока сцена не пересобрана, накопленное относится к прошлому кадру и не считается
  const tracedSamples = () => (pt && !sceneDirty && !building ? Math.floor(pt.samples) : 0);

  function render() {
    if (document.hidden || lost) return;   // вкладка скрыта или WebGL сброшен — GPU не трогаем
    if (!explicit) batches.update(camera);
    if (!explicit && quality === 'eco') eco.update(camera);
    if (compiling()) return;               // шейдеры собираются фоном — на экране прошлый кадр
    const now = performance.now(), quiet = now - lastChange;
    const done = tracedSamples();
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (ptFailed || broken || lost || done >= waiters[i].n || now > waiters[i].until) waiters.splice(i, 1)[0].resolve();
    }
    const ov = !explicit && !!overlay?.active();
    const want = explicit && !ptFailed && !broken;
    if (want && !pt) loadTracer();
    if (!want || !pt || building || quiet < SETTLE) {
      if (rasterDirty) { rasterDirty = false; refreshShadows(); drawRaster(); if (ov) overlay.draw(); if (!explicit) watchFrameRate(now); drawnWaiters.splice(0).forEach(f => f()); }
      report(0, want ? (pt && !building ? 'waiting' : building ? 'building' : 'loading') : 'idle');
      return;
    }
    if (sceneDirty) {
      // один кадр на показ «собирается», дальше сборка идёт фоном (BVH — в Worker)
      if (!announced) { announced = true; report(0, 'building'); return; }
      announced = false; sceneDirty = false;
      flushTracer();
      return;
    }
    if (pt.samples < maxSamples) {
      pt.renderSample();
      if (metering && pt.samples >= METER_AT) meterPhoto();
    }
    const n = tracedSamples();
    report(n, n >= maxSamples ? 'done' : 'tracing');
  }

  // ---------- трассировщик ----------

  let bvhWorker = null, noWorker = false;
  function loadTracer() {
    if (ptLoading) return;
    ptLoading = Promise.all([import('three-gpu-pathtracer'), import('three-mesh-bvh')]).then(([{ WebGLPathTracer }, { MeshBVH, CENTER }]) => {
      pt = new WebGLPathTracer(renderer);
      if (noWorker) pt._generator.bvhOptions = { strategy: CENTER };   // ~0,7 с вместо ~5 с на главном потоке
      else { bvhWorker = createBVHWorker(THREE, MeshBVH); pt.setBVHWorker(bvhWorker); }
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

  // Сборка сцены трассировщика: геометрия и материалы — сразу (под tracerView), BVH — в Worker; когда он готов,
  // сцена «одевается» ещё раз (те же двойники) и трассировщик получает результат. Изменилась сцена за время
  // сборки — результат выбрасывается и сборка начинается заново.
  function flushTracer() {
    const gen = pt._generator, token = building = {};
    let result;
    const dressed = () => tracerView(THREE, scene, camera, { matte: matteOK, environment: tracerEnvironment() });
    const fail = err => {
      // сцену не удалось собрать: показываем растр, следующая попытка — после изменения сцены
      console.warn('render.js: сцена для фото не собралась', err);
      if (building === token) building = null;
      broken = rasterDirty = true;
      report(0, 'error');
    };
    let view = dressed();
    try {
      const n = view.textureSources;   // массив текстур трассировщика: 16 МБ на слой при 2048
      const side = n <= 12 ? 2048 : n <= 48 ? 1024 : 512;
      pt.textureSize.set(side, side);
      pt.renderScale = Math.min(1, Math.sqrt(photoPixels / (canvas.width * canvas.height)));
      const tiles = Math.max(2, Math.ceil(Math.sqrt(canvas.width * canvas.height * pt.renderScale ** 2 / TILE_PIXELS)));
      pt.tiles.set(tiles, tiles);        // один проход = tiles² кадров: каждый кадр короткий
      scene.updateMatrixWorld(true); camera.updateMatrixWorld();
      gen.setObjects(scene);
      gen._buildAsync = !!bvhWorker;
      try { result = gen.generate(); } finally { gen._buildAsync = false; }
    } catch (err) { view.restore(); fail(err); return; }
    view.restore();
    Promise.resolve(result.bvh).then(bvh => {
      if (building !== token) return;
      result.bvh = gen.bvh = bvh;
      view = dressed();   // сцена могла поменяться за время сборки — тогда sceneDirty уже стоит и следующая сборка поправит
      try {
        pt._updateFromResults(scene, camera, result);
        if (!fixMaterialIndex(THREE, pt)) console.warn('render.js: номера материалов трассировщика не сошлись');
      } finally { view.restore(); }
      building = null;
      metering = autoExposure;
      if (autoExposure) rasterPx = measure(null);
    }).catch(err => {
      if (building !== token) return;
      noWorker = true;   // дальше — синхронно и быстрой стратегией: трассировщик пересоздаётся с нуля
      dropTracer();
      fail(err);
    });
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
  const envCache = new Map();
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

  // Живой растр против снимка (tv.js): onLive(fn) — fn(false) перед снимком и fn(true) после, чтобы «дыра» под
  // YouTube-плеер не попала в PNG прозрачностью: на снимке экран показывает постер.
  const liveFns = new Set();
  async function capture(minSamples = 0) {
    liveFns.forEach(fn => fn(false));
    try { return await captureFrame(minSamples); } finally { liveFns.forEach(fn => fn(true)); }
  }

  async function captureFrame(minSamples) {
    if (!minSamples || ptFailed) {   // растр с удвоенной плотностью (не больше CAPTURE_PX)
      applySize(Math.min(Math.max(2, renderer.getPixelRatio()), Math.sqrt(CAPTURE_PX / Math.max(1, size.w * size.h))));
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
    if (ptFailed || broken || !pt) { if (entered) exitPhoto(); return captureFrame(0); }
    pt.pausePathTracing = true;      // перерисовать накопленное без нового прохода и сразу прочитать холст
    pt.renderSample();
    const blob = toBlob();
    pt.pausePathTracing = false;
    if (entered) exitPhoto();
    return blob;
  }

  // Освободить трассировщик целиком: GPU-ресурсы, сцену генератора (≈1 ГБ в куче), двойники и копии геометрии.
  // У WebGLPathTracer 0.0.23 dispose() сломан (обращается к несуществующему полю) — освобождаем по частям.
  function dropTracer() {
    clearTimeout(keepTimer);
    building = null;
    if (pt) {
      const m = pt._pathTracer.material;
      for (const u of Object.values(m.uniforms)) u.value?.dispose?.();
      m.dispose();
      pt._pathTracer.dispose(); pt._lowResPathTracer.dispose(); pt._quad.dispose();
      pt._internalBackground?.dispose?.();
      pt._generator.geometry.dispose();
      pt._generator.bvh = null;
    }
    pt = null; ptLoading = null; balance = null; sceneDirty = true;
    bvhWorker?.dispose(); bvhWorker = null;
    envCache.forEach(t => t.dispose()); envCache.clear();
    dropTracerCaches();
  }

  function dispose() {
    exitPhoto();
    dropTracer();
    composer.passes.forEach(p => p.dispose()); composer.dispose();
    batches.dispose();
    eco.dispose();
    if (meter) { meter.rt.dispose(); meter.quad.dispose(); meter.quad.material.dispose(); meter = null; }
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    clearTimeout(lostTimer);
    busy.delete(renderer);
  }

  // ---------- интерфейс ----------

  function enterPhoto() { clearTimeout(keepTimer); explicit = true; lastChange = performance.now() - SETTLE; }
  function exitPhoto() {
    explicit = false; rasterDirty = true; report(0, 'idle');
    clearTimeout(keepTimer);
    if (pt || ptLoading) keepTimer = setTimeout(() => { if (!explicit) dropTracer(); }, PHOTO_KEEP);
  }

  function setQuality(name) {
    quality = QUALITY[name] ? name : DEFAULT_QUALITY;
    q = QUALITY[quality];
    configureComposer();
    renderer.shadowMap.needsUpdate = true;
    applySize();
    invalidate();
  }

  function setToneMapping(name) {
    renderer.toneMapping = THREE[TONE[name] || TONE.neutral];
    rasterDirty = true;
  }

  setToneMapping('neutral');   // Khronos PBR Neutral: цвета материалов до ~0.8 не сдвигаются, мягкое плечо в светах
  setQuality(startQuality);

  return {
    render,
    invalidate,
    setSize(w, h, dpr = window.devicePixelRatio) { size = { w, h, dpr }; applySize(); invalidate(); },
    setQuality,
    setToneMapping,
    enterPhoto,
    exitPhoto,
    capture,
    onLive(fn) { liveFns.add(fn); return () => liveFns.delete(fn); },   // см. capture() — tv.js
    dispose,
    onProgress(cb) { progressCb = cb; },
    whenDrawn() { rasterDirty = true; return new Promise(r => drawnWaiters.push(r)); },
    setOverlay(o) { overlay = o; rasterDirty = true; },   // см. overlay выше; null — снять
    get quality() { return quality; },
    get batches() { return batches.stats; },
    get eco() { return eco.stats; },
    get photo() { return explicit; },
    get samples() { return tracedSamples(); },
  };
}

// ---------- BVH в Web Worker ----------
// Import map в воркере не действует, поэтому three-mesh-bvh грузится копией исходника с полным адресом three.
// Интерфейс — как у GenerateMeshBVHWorker из three-mesh-bvh: generate(geometry, options) -> Promise<MeshBVH>
// (массивы позиций и индексов на время сборки передаются воркеру и возвращаются обратно).
const WORKER_SRC = (three, bvh) => `
import { BufferGeometry, BufferAttribute } from '${three}';
import { MeshBVH } from '${bvh}';
onmessage = ({ data: { index, position, options } }) => {
  try {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3, false));
    if (index) g.setIndex(new BufferAttribute(index, 1, false));
    for (const gr of options.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    const bvh = new MeshBVH(g, options);
    const s = MeshBVH.serialize(bvh, { copyIndexBuffer: false });
    const transfer = [position.buffer, ...s.roots];
    if (s.index && s.index.buffer !== position.buffer) transfer.push(s.index.buffer);
    if (s.indirectBuffer) transfer.push(s.indirectBuffer.buffer);
    postMessage({ serialized: s, position }, transfer);
  } catch (err) { postMessage({ error: String(err) }); }
};`;

function createBVHWorker(THREE, MeshBVH) {
  let worker = null, urls = [];
  async function start() {
    const three = import.meta.resolve('three'), bvhUrl = import.meta.resolve('three-mesh-bvh');
    const src = (await (await fetch(bvhUrl)).text()).replaceAll(`from 'three'`, `from '${three}'`);
    const lib = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const main = URL.createObjectURL(new Blob([WORKER_SRC(three, lib)], { type: 'text/javascript' }));
    urls = [lib, main];
    return new Worker(main, { type: 'module' });
  }
  return {
    async generate(geometry, options) {
      worker ??= await start();
      const { onProgress, ...opts } = options;
      const index = geometry.index?.array ?? null, position = geometry.attributes.position.array;
      const data = await new Promise((resolve, reject) => {
        worker.onmessage = e => resolve(e.data);
        worker.onerror = e => reject(new Error(e.message || 'BVH worker'));
        worker.postMessage({ index, position, options: { ...opts, groups: geometry.groups.map(g => ({ ...g })) } },
          [position.buffer, ...(index && index.buffer !== position.buffer ? [index.buffer] : [])]);
      });
      if (data.error) throw new Error(data.error);
      const { serialized, position: back } = data;
      const bvh = MeshBVH.deserialize(serialized, geometry, { setIndex: false });
      geometry.attributes.position.array = back;
      if (serialized.index) {
        if (geometry.index) geometry.index.array = serialized.index;
        else geometry.setIndex(new THREE.BufferAttribute(serialized.index, 1, false));
      }
      geometry.boundingBox = bvh.getBoundingBox(new THREE.Box3());
      onProgress?.(1);
      return bvh;
    },
    dispose() { worker?.terminate(); worker = null; urls.forEach(u => URL.revokeObjectURL(u)); urls = []; },
  };
}

// ---------- подготовка сцены для трассировщика (временная, откатывается restore) ----------

// Трассировщик не знает слоёв и инстансов и берёт свойства прямо из материалов.
// На время setScene: скрытые от камеры меши получают «матовых двойников» (камера смотрит сквозь, свет держат),
// стекло — двойника с пропусканием, плафоны — двойника без тени; инстансы разворачиваются в обычные меши;
// подсветка-обманка и выключенные источники прячутся; окружение подменяется панорамой без солнца.
const twins = new Map();      // `${uuid}|${flags}` -> материал-двойник (только данные, в растре не рисуется)
let proxies = new WeakMap();   // InstancedMesh -> развёрнутый меш
// Двойники и копии геометрии нужны только живому трассировщику: с ним и уходят (на GPU их не было — только данные)
function dropTracerCaches() { twins.clear(); proxies = new WeakMap(); plain = new WeakMap(); }

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
let plain = new WeakMap();     // геометрия -> { key, geometry }
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
