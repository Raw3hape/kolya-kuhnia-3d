// Следы выстрелов в прогулке: дырка от пули на поверхности и короткий всплеск пыли, щепок и искр; посуда, фрукты,
// стёкла и зеркала бьются (breakables.js, mirrors.js), экраны трескаются, но продолжают показывать видео.
// Зовёт viewmodel.js на каждый выстрел; в код варианта не входит, живёт до «Убрать следы и осколки» или перезагрузки.
//
// createImpacts({ THREE, scene, camera, renderer, pipe, requestRender, getSound })
//   -> { shoot({ spread, pellets, range, hunt, weapon, damage }) -> сколько пуль попало в зверей (hunt.js)
//          лучи из камеры через центр экрана (прицел): pellets штук (дробь — много), каждый со своим отклонением в конусе
//          spread (рад) в осях экрана: пуля — гуще к центру (радиус ∝ случайному числу), дробь — равномерно по кругу;
//          дальность range, м; hunt — объект охоты или null: hunt.raycast(raycaster) -> { distance, point, normal,
//          hit(weapon, damage) } | null — спрашивается первым на каждую пулю (звери, мыши); зверь ближе стены —
//          hit(weapon, damage) и брызги без следа (цвет — hit.surface { albedo, solid }, без него красные), иначе след;
//        update(dt) -> bool   true, пока летят частицы и осколки или меняется видимость следов (в покое — false, ноль работы);
//        clear() — убрать следы и трещины, вернуть разбитое целым; holes (следов сейчас), broken (разбито), dispose() }
//   getSound() -> bool — звук включён (звон и хруст разбитого).
//
// Луч: только видимое на слое 0 (вырез прячет стены на слой 1); userData.shadowOnly и невидимые материалы — мимо.
// Стекло (userData.glass) пропускает пулю, но само разбивается (breakables.shatterPane; userData.shatter = false — нет).
// Попадание: свой обработчик меша (breakables.shotHandlers — зеркала) → вещь, которая бьётся (breakables.breakAt) →
// экран (userData.tvScreen, userData.screen или материал 'screen' моделей; стекло телефона над экраном) — трещина-паутина
// на экране, видео под ней играет: трещина — прозрачный квад перед экраном, через «дыру» tv.js её видно; трещин сколько
// угодно, старые уходят после IMP.maxCracks → иначе дырка. Листья и прочее вырезанное по альфе — без следа, с частицами.
// На узком (корешок, кромка) след уменьшается, пока не влезет (IMP.minSize); не влезает и он — только частицы.
// След: квадрат с холщовой текстурой (тёмная дыра, светлый сколотый край, трещины, копоть), лежит на 0,4 мм над
// поверхностью с polygonOffset. Он ребёнок задетого меша (матрица считается в его координатах, любой масштаб): дверь
// уносит след с собой, пересобранная мебель — забирает. Освещается как поверхность (MeshStandardMaterial, тень,
// маска зон lighting.js ставится сама). Край подкрашен по цвету поверхности: на светлом — чуть темнее, на тёмном
// дереве — светлый скол. Не больше IMP.max следов, старые уходят первыми; геометрия и материалы общие.
// Метки следа: userData.rasterOnly (в GLB не нужен — см. отчёт интегратору), userData.noPick; raycast пустой,
// пустой boundingBox — следы не попадают ни в чужие лучи, ни в габариты мебели и коллизии прогулки.
// Фото-режим и снимок PNG: следы и частицы прячутся (pipe.photo каждый кадр, pipe.onLive на время снимка).
// Частицы: щепки — инстансы тетраэдров, пыль — инстансы плоскостей к камере (оба освещены, как сцена; пыль не идёт в AO),
// искры и вспышка попадания — одно облако точек с аддитивным смешением. Всё живёт не дольше IMP.life.
import { createBreakables, shotHandlers, networkDamageResetters } from './breakables.js';
import { stableObjectId, indexNetworkObjects, collectNetworkObjects, isTransient, seededRandom } from './network-objects.js';
import { createNetworkRaycastAcceleration } from './network-raycast.js';
import { afterRoom } from './loading.js';
import { AIM_NDC } from './weapon-aim.js';

const IMP = {
  max: 200,               // следов всего
  size: [0.05, 0.065],    // сторона квадрата следа, м (дыра ~1,5 см, сколотый край ~2,5–3 см, копоть шире)
  minSize: 0.012,         // на узком (корешок книги, кромка, рама) след уменьшается шагами ×0.7, пока не влезет, но не мельче этого
  lift: 0.0004,           // над поверхностью, м
  life: 0.6,              // самая долгая частица, с
  gravity: 9.8,
  pool: { chips: 160, dust: 96, sparks: 96 },
  sparkGain: 6,           // яркость искр относительно белого при экспозиции 1
  maxCracks: 80,          // трещин на экранах всего
  crack: [0.05, 0.32],    // сторона квадрата трещины, м (не больше 0,6 меньшей стороны экрана)
  crackGain: 0.55,        // яркость трещины относительно белого при экспозиции 1 (светлые изломы на видео)
};
const ATLAS = 2;          // текстура следа — 2×2 варианта
const CELL = 128;         // пикселей на вариант
const CRACK_CELL = 256;   // пикселей на вариант трещины

const rand = (a, b) => a + Math.random() * (b - a);

export function createImpacts({ THREE, scene, camera, renderer, pipe, requestRender, getSound = () => true }) {
  let effectRandom = Math.random;
  const rand = (a, b) => a + effectRandom() * (b - a);
  const V3 = () => new THREE.Vector3();
  const ray = new THREE.Raycaster();
  ray.layers.set(0);
  ray.near = 0.02;
  const noRaycast = () => {};

  // ---------- следы ----------
  const holeTex = makeHoleAtlas(THREE);
  const quads = [];
  for (let i = 0; i < ATLAS * ATLAS; i++) {
    const g = new THREE.PlaneGeometry(1, 1), uv = g.attributes.uv, cx = i % ATLAS, cy = Math.floor(i / ATLAS);
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / ATLAS, (cy + uv.getY(k)) / ATLAS);
    g.computeBoundingSphere();
    g.boundingBox = new THREE.Box3();   // пустой: Box3.setFromObject (габариты мебели, коллизии прогулки) след не видит
    quads.push(g);
  }
  const mats = new Map();   // оттенок края -> материал
  function holeMaterial(tint) {
    const key = tint.getHexString();
    let m = mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: holeTex, color: tint, roughness: 0.95, metalness: 0, transparent: true,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      mats.set(key, m);
    }
    return m;
  }
  let holes = [];           // по возрасту, старые первыми
  let hidden = false, capturing = false;
  const inScene = o => { while (o) { if (o === scene) return true; o = o.parent; } return false; };
  const shown = o => { for (let x = o; x && x !== scene; x = x.parent) if (!x.visible) return false; return true; };   // разбитое в этом же выстреле

  // ---------- цвет поверхности: цвет материала × средний цвет карты ----------
  const avgCache = new WeakMap();
  const probe = document.createElement('canvas'); probe.width = probe.height = 8;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  function mapAverage(tex) {
    const src = tex?.source;
    if (!src?.data) return null;
    if (avgCache.has(src)) return avgCache.get(src);
    let c = null;
    try {
      probeCtx.clearRect(0, 0, 8, 8);
      probeCtx.drawImage(src.data, 0, 0, 8, 8);
      const d = probeCtx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const k = 4 / d.length / 255;
      c = new THREE.Color().setRGB(r * k, g * k, b * k, THREE.SRGBColorSpace);
    } catch { c = null; }   // сжатая или данные-текстура: только цвет материала
    avgCache.set(src, c);
    return c;
  }
  function surface(hit) {
    let m = hit.object.material;
    if (Array.isArray(m)) m = m[hit.face?.materialIndex ?? 0] ?? m[0];
    const albedo = m?.color ? m.color.clone() : new THREE.Color(0.6, 0.6, 0.6);
    const avg = mapAverage(m?.map);
    if (avg) albedo.multiply(avg);
    // вырезанное по альфе (листья) и полупрозрачное: квадрат следа повис бы в воздухе — только частицы
    return { albedo, metal: (m?.metalness ?? 0) > 0.5, cutout: !!m && (m.alphaTest > 0 || m.transparent) };
  }
  const FRESH = new THREE.Color(0.82, 0.76, 0.66);   // свежий скол: светлое дерево, штукатурка изнутри
  function rimTint(albedo) {
    const L = 0.2126 * albedo.r + 0.7152 * albedo.g + 0.0722 * albedo.b;
    const t = albedo.clone().multiplyScalar(0.85).lerp(FRESH, THREE.MathUtils.clamp((0.45 - L) * 2, 0, 0.75));
    // квантование: на сотни следов — десяток материалов
    return t.setRGB(Math.round(t.r * 16) / 16, Math.round(t.g * 16) / 16, Math.round(t.b * 16) / 16);
  }

  const mtx = new THREE.Matrix4(), inv = new THREE.Matrix4(), nm = new THREE.Matrix3();
  const q = new THREE.Quaternion(), qs = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);
  // край листа, полки, рамы: четыре коротких луча по краю скола должны лечь на ту же плоскость, иначе след повис бы в воздухе
  const probeRay = new THREE.Raycaster(), t1 = V3(), t2 = V3(), from = V3(), back = V3();
  probeRay.layers.set(0);
  function fits(o, p, n, r) {
    t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    t2.crossVectors(n, t1);
    probeRay.near = 0; probeRay.far = 0.04;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      from.copy(p).addScaledVector(t1, a * r).addScaledVector(t2, b * r).addScaledVector(n, 0.02);
      probeRay.set(from, back.copy(n).negate());
      const h = probeRay.intersectObject(o, true)[0];
      if (!h || Math.abs(h.distance - 0.02) > 0.006) return false;
    }
    return true;
  }
  function addHole(hit, n, albedo) {
    const parent = hit.object;
    parent.updateWorldMatrix(true, false);
    if (Math.abs(parent.matrixWorld.determinant()) < 1e-12) return;
    let s = rand(IMP.size[0], IMP.size[1]);
    // проверка по всей вещи: книга, рама, фасад в модели бывают из нескольких мешей (обложка, корешок, страницы)
    const whole = parent.parent && !parent.parent.isScene ? parent.parent : parent;
    while (!fits(whole, hit.point, n, s * 0.28)) { s *= 0.7; if (s < IMP.minSize) return; }
    q.setFromUnitVectors(Z, n);
    qs.setFromAxisAngle(n, effectRandom() * Math.PI * 2);
    mtx.compose(hit.point.clone().addScaledVector(n, IMP.lift), qs.multiply(q), new THREE.Vector3(s, s, s));
    const d = new THREE.Mesh(quads[(effectRandom() * quads.length) | 0], holeMaterial(rimTint(albedo)));
    d.matrixAutoUpdate = false;
    d.matrix.copy(inv.copy(parent.matrixWorld).invert().multiply(mtx));
    d.castShadow = false; d.receiveShadow = true;
    d.raycast = noRaycast;
    d.renderOrder = 1;
    d.visible = !hidden;
    Object.assign(d.userData, { impact: true, rasterOnly: true, noPick: true });
    parent.add(d);
    holes = holes.filter(h => inScene(h));   // ушли вместе с пересобранной мебелью
    holes.push(d);
    while (holes.length > IMP.max) holes.shift().removeFromParent();
    return d;
  }

  // ---------- трещины на экранах (видео под ними играет) ----------
  const crackTex = makeCrackAtlas(THREE);
  const crackMat = new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  let cracks = [], crackExp = -1;
  const SCREEN = 'screen';
  const hasScreen = o => { let f = false; o.traverse(x => { if (!f && x.isMesh && x.material?.name === SCREEN) f = true; }); return f; };
  function isScreen(o) {
    if (o.userData.tvScreen || o.userData.screen) return true;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m?.name === SCREEN) return true;
    // стекло телефона лежит поверх экрана: тоже экран, если рядом в модели есть меш с материалом 'screen'
    return m?.name === 'glass' && !!o.parent && hasScreen(o.parent);
  }
  const sz3 = V3(), bb = new THREE.Box3();
  function addCrack(hit, n) {
    const parent = hit.object;
    parent.updateWorldMatrix(true, false);
    if (Math.abs(parent.matrixWorld.determinant()) < 1e-12) return;
    // размер — по экрану: на телефоне паутина меньше, чем на ТВ
    const g = parent.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    bb.copy(g.boundingBox).applyMatrix4(parent.matrixWorld).getSize(sz3);
    const dims = [sz3.x, sz3.y, sz3.z].sort((a, b) => b - a);
    const s = Math.max(IMP.crack[0] * 0.4, Math.min(rand(IMP.crack[0], IMP.crack[1]), dims[1] * 0.6));
    q.setFromUnitVectors(Z, n);
    qs.setFromAxisAngle(n, effectRandom() * Math.PI * 2);
    mtx.compose(hit.point.clone().addScaledVector(n, 0.0015), qs.multiply(q), new THREE.Vector3(s, s, s));
    const d = new THREE.Mesh(quads[(effectRandom() * quads.length) | 0], crackMat);   // атлас трещин тоже 2×2
    d.matrixAutoUpdate = false;
    d.matrix.copy(inv.copy(parent.matrixWorld).invert().multiply(mtx));
    d.castShadow = false; d.receiveShadow = false;
    d.raycast = noRaycast;
    d.renderOrder = 4;   // поверх экрана и его «дыры»
    d.visible = !hidden;
    Object.assign(d.userData, { impact: true, rasterOnly: true, noPick: true });
    parent.add(d);
    cracks = cracks.filter(h => inScene(h));
    cracks.push(d);
    while (cracks.length > IMP.maxCracks) cracks.shift().removeFromParent();
    return d;
  }

  // ---------- то, что бьётся ----------
  const breaks = createBreakables({ THREE, scene, camera, pipe, requestRender, getSound, burst: (p, n, dir, surf) => burst(p, n, dir, surf) });
  const pendingEffects = [], appliedShots = new Set(), brokenIds = new Set();
  const networkDamageEvents = new Map();
  let damageJournalSignature = '';
  let network = false, pendingAt = 0;
  const acceleration = createNetworkRaycastAcceleration({ THREE, scene });
  afterRoom(() => acceleration.start());

  function clear() {
    pendingEffects.length = 0; appliedShots.clear(); brokenIds.clear();
    networkDamageEvents.clear(); damageJournalSignature = '';
    for (const h of holes) h.removeFromParent();
    for (const c of cracks) c.removeFromParent();
    holes = []; cracks = [];
    breaks.restore();
    requestRender?.();
  }

  // ---------- частицы ----------
  const dummy = new THREE.Object3D();
  const chipsGeo = new THREE.TetrahedronGeometry(1, 0);
  const chipsMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const chips = new THREE.InstancedMesh(chipsGeo, chipsMat, IMP.pool.chips);
  chips.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(IMP.pool.chips * 3), 3);

  const dustGeo = new THREE.PlaneGeometry(1, 1);
  const dustFade = new THREE.InstancedBufferAttribute(new Float32Array(IMP.pool.dust), 1);
  dustGeo.setAttribute('aFade', dustFade);
  const dustTex = makeSoftDot(THREE);
  const dustMat = new THREE.MeshStandardMaterial({ alphaMap: dustTex, transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
  // прозрачность каждого облачка — свой атрибут (lighting.js дописывает свой патч поверх этого)
  dustMat.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float aFade;\nvarying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFade = aFade;');
    sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n\tdiffuseColor.a *= vFade;');
  };
  dustMat.customProgramCacheKey = () => 'impact-dust';
  const dust = new THREE.InstancedMesh(dustGeo, dustMat, IMP.pool.dust);
  dust.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(IMP.pool.dust * 3), 3);
  // проход нормалей GTAO (render.js) рисует сцену подменённым материалом и прозрачность не знает: облачко дало бы
  // квадратный ореол затенения. В чужом материале схлопываем инстансы в точку (матрица модели считается после хука).
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), keep = new THREE.Matrix4();
  dust.onBeforeRender = (r, sc, cam, geo, mat) => { if (mat !== dustMat) { keep.copy(dust.matrixWorld); dust.matrixWorld.copy(zero); } };
  dust.onAfterRender = (r, sc, cam, geo, mat) => { if (mat !== dustMat) dust.matrixWorld.copy(keep); };

  const N = IMP.pool.sparks;
  const sparkGeo = new THREE.BufferGeometry();
  const sPos = new THREE.BufferAttribute(new Float32Array(N * 3), 3), sCol = new THREE.BufferAttribute(new Float32Array(N * 3), 3), sSize = new THREE.BufferAttribute(new Float32Array(N), 1);
  sparkGeo.setAttribute('position', sPos); sparkGeo.setAttribute('aColor', sCol); sparkGeo.setAttribute('aSize', sSize);
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 }, uGain: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aColor; attribute float aSize; uniform float uScale; varying vec3 vColor;
      void main() { vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv; gl_PointSize = max(1.5, aSize * uScale / -mv.z); }`,
    // яркость делится на экспозицию сцены (uGain): искра одинаково яркая днём и вечером
    fragmentShader: `uniform float uGain; varying vec3 vColor;
      void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 1.5);
        gl_FragColor = vec4(vColor * uGain, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);

  for (const o of [chips, dust, sparks]) {
    o.frustumCulled = false; o.visible = false; o.raycast = noRaycast;
    o.castShadow = false;
    Object.assign(o.userData, { impact: true, rasterOnly: true, noPick: true });
    scene.add(o);
  }
  chips.receiveShadow = true;
  dust.renderOrder = 2; sparks.renderOrder = 3;   // искры и вспышка поверх облачка, иначе пыль их гасит

  // пулы: { p, v, age, life, size, color, … }; живые — age < life
  const pool = n => Array.from({ length: n }, () => ({ p: V3(), v: V3(), age: 1, life: 0, size: 0, c: new THREE.Color(), axis: V3(), spin: 0, drag: 0, g: 0, floor: -Infinity }));
  const P = { chips: pool(IMP.pool.chips), dust: pool(IMP.pool.dust), sparks: pool(N) };
  const head = { chips: 0, dust: 0, sparks: 0 };
  let alive = 0;
  function emit(kind, init) {
    const arr = P[kind], e = arr[head[kind]];
    head[kind] = (head[kind] + 1) % arr.length;
    if (e.age >= e.life) alive++;
    e.age = 0; init(e);
  }
  const rnd = V3(), refl = V3();
  const randomUnit = v => v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();

  function burst(point, n, dir, { albedo, metal, solid, flesh = false }) {
    refl.copy(dir).addScaledVector(n, -2 * dir.dot(n));
    const floor = point.y > -0.1 ? Math.min(point.y, 0) + 0.003 : -Infinity;   // внутри квартиры пол — y = 0
    const chipC = rimTint(albedo).lerp(albedo, 0.4);
    if (solid) for (let i = 0, k = metal ? 3 : 7; i < k; i++) emit('chips', e => {
      e.p.copy(point).addScaledVector(n, 0.004);
      e.v.copy(n).multiplyScalar(rand(1.2, 2.8)).addScaledVector(randomUnit(rnd), 1.3).addScaledVector(refl, 0.5);
      e.life = rand(0.35, IMP.life); e.size = rand(0.0018, 0.0045); e.c.copy(chipC).multiplyScalar(rand(0.8, 1.1));
      randomUnit(e.axis); e.spin = rand(10, 30); e.drag = 0.6; e.g = IMP.gravity; e.floor = floor;
    });
    if (solid) for (let i = 0, k = metal ? 2 : 5; i < k; i++) emit('dust', e => {
      e.p.copy(point).addScaledVector(n, 0.01);
      e.v.copy(n).multiplyScalar(rand(0.3, 1.0)).addScaledVector(randomUnit(rnd), 0.35);
      e.life = rand(0.4, IMP.life); e.size = rand(0.02, 0.035); e.c.copy(albedo).lerp(new THREE.Color(0.55, 0.53, 0.5), 0.3);
      e.spin = rand(-2, 2); e.drag = 5; e.g = 0.5; e.floor = -Infinity;
    });
    if (flesh) return;   // зверь: только капли и облачко, без искр и вспышки
    for (let i = 0, k = metal ? 8 : 3; i < k; i++) emit('sparks', e => {
      e.p.copy(point).addScaledVector(n, 0.003);
      e.v.copy(refl).multiplyScalar(rand(1, 3)).addScaledVector(n, rand(0.5, 2)).addScaledVector(randomUnit(rnd), 1.5);
      e.life = rand(0.12, 0.3); e.size = rand(0.006, 0.012); e.c.setRGB(1, rand(0.55, 0.8), rand(0.2, 0.4));
      e.drag = 1; e.g = IMP.gravity; e.floor = floor;
    });
    // вспышка попадания: одна крупная точка на пару кадров
    emit('sparks', e => { e.p.copy(point).addScaledVector(n, 0.01); e.v.set(0, 0, 0); e.life = 0.07; e.size = 0.08; e.c.setRGB(1, 0.8, 0.55); e.drag = 0; e.g = 0; e.floor = -Infinity; });
  }

  // ---------- выстрел ----------
  // списки переиспользуются: на выстрел — ни одного нового массива, кроме того, что создаёт сам three.js на попадание
  const centre = AIM_NDC, nrm = V3(), list = [], hits = [], ax = V3(), ay = V3();
  const FLESH = { albedo: new THREE.Color(0.32, 0.04, 0.03), metal: false, solid: true, flesh: true };
  // мишень сама говорит, из чего она (hit.surface: мышь — пыль, монстр — без крови): те же крошки и облачко её цвета,
  // без искр и вспышки; без подсказки — красные брызги зверя. Кэш — без новых объектов на выстрел
  const surfCache = new WeakMap();
  const beastSurf = s => {
    if (!s?.albedo) return FLESH;
    let v = surfCache.get(s);
    if (!v) surfCache.set(s, v = { albedo: s.albedo, metal: !!s.metal, solid: s.solid !== false, flesh: s.flesh !== false });
    return v;
  };
  const collect = o => {
    if (!o.isMesh || o.userData.impact || o.userData.shadowOnly) return;
    for (let x = o; x && x !== scene; x = x.parent) if (isTransient(x)) return;
    const m = o.material, m0 = Array.isArray(m) ? m[0] : m;
    if (!m0 || m0.visible === false || m0.colorWrite === false || (m0.transparent && m0.opacity < 0.05 && !o.userData.glass)) return;
    list.push(o);
  };
  const traceEnd = V3();
  const carSurface = { albedo: new THREE.Color(.44, .50, .54), solid: true, metal: true };
  function vehicleBurst(point, normal, direction, destroyed) {
    burst(point, normal, direction, carSurface);
    if (destroyed) for (let i = 0; i < 14; i++) emit('sparks', e => {
      e.p.copy(point).addScaledVector(normal, .035);
      e.v.copy(randomUnit(rnd)).multiplyScalar(rand(2, 6)).addScaledVector(normal, 2);
      e.life = rand(.18, .42); e.size = rand(.011, .024); e.c.setRGB(1, rand(.24, .55), .09);
      e.drag = 1.5; e.g = IMP.gravity; e.floor = -Infinity;
    });
  }
  function vehicleImpact(hit, rayDirection) {
    const direction = new THREE.Vector3().fromArray(rayDirection);
    const normal = hit.normal ? new THREE.Vector3().fromArray(hit.normal) : direction.clone().negate();
    vehicleBurst(new THREE.Vector3().fromArray(hit.point), normal, direction, hit.destroyed);
    requestRender?.();
  }

  function shoot({ spread = 0, pellets = 1, range = 100, hunt = null, weapon = '', damage = 0, onRay } = {}) {
    list.length = 0;
    scene.traverseVisible(collect);
    ray.far = range;
    let struck = 0;
    for (let i = 0; i < pellets; i++) {
      ray.setFromCamera(centre, camera);
      if (spread > 0) {
        const a = Math.random() * Math.PI * 2, u = Math.random(), r = Math.tan(spread) * (pellets > 1 ? Math.sqrt(u) : u);
        ax.setFromMatrixColumn(camera.matrixWorld, 0); ay.setFromMatrixColumn(camera.matrixWorld, 1);
        ray.ray.direction.addScaledVector(ax, Math.cos(a) * r).addScaledVector(ay, Math.sin(a) * r).normalize();
      }
      // звери (и всё, что отдаёт hunt.raycast) — первыми: их луч не зависит от сцены
      const beast = hunt?.raycast?.(ray) ?? null;
      hits.length = 0;
      ray.intersectObjects(list, false, hits);
      let hit = null;
      for (const h of hits) if (shown(h.object) && !h.object.userData.glass) { hit = h; break; }
      // стекло до цели (или до зверя) бьётся, пуля летит дальше
      const stop = Math.min(hit ? hit.distance : Infinity, beast ? beast.distance : Infinity);
      for (const h of hits) {
        if (h.distance >= stop) break;
        if (!h.object.userData.glass || !shown(h.object)) continue;
        if (breaks.handle(h, ray.ray.direction) == null) breaks.shatterPane(h, ray.ray.direction);
      }
      if (beast && beast.distance < (hit ? hit.distance : Infinity)) {
        const result = beast.hit?.(weapon, damage);
        struck++;
        nrm.copy(beast.normal ?? ray.ray.direction).normalize();
        if (nrm.dot(ray.ray.direction) > 0) nrm.negate();
        if (beast.vehicle) vehicleBurst(beast.point, nrm, ray.ray.direction, result?.destroyed);
        else burst(beast.point, nrm, ray.ray.direction, beastSurf(beast.surface));
        onRay?.(ray.ray.origin, ray.ray.direction, beast.point, beast.vehicle && !result?.ok ? null : result);
        continue;
      }
      onRay?.(ray.ray.origin, ray.ray.direction, hit?.point ?? ray.ray.at(range, traceEnd));
      if (!hit) continue;
      // нормаль в мире (неравномерный масштаб — через матрицу нормалей), к стрелку
      const o = hit.object;
      if (hit.face) {
        mtx.copy(o.matrixWorld);
        if (o.isInstancedMesh && hit.instanceId != null) { o.getMatrixAt(hit.instanceId, inv); mtx.multiply(inv); }
        nrm.copy(hit.face.normal).applyMatrix3(nm.getNormalMatrix(mtx)).normalize();
      } else nrm.copy(ray.ray.direction).negate();
      if (nrm.dot(ray.ray.direction) > 0) nrm.negate();
      const surf = surface(hit);
      // свой обработчик (зеркало) или вещь, которая бьётся: без следа, с крошкой
      if (breaks.handle(hit, ray.ray.direction) || breaks.breakAt(hit, ray.ray.direction, surf)) {
        burst(hit.point, nrm, ray.ray.direction, { ...surf, solid: true });
        continue;
      }
      const screen = isScreen(o);
      if (screen) addCrack(hit, nrm);
      else if (!surf.cutout) addHole(hit, nrm, surf.albedo);
      burst(hit.point, nrm, ray.ray.direction, { ...surf, solid: !screen });
    }
    list.length = 0;   // не держим ссылки на меши до следующего выстрела
    requestRender?.();
    return struck;
  }

  function resolveNetworkSurfaces(origin, direction, range = 800, prepared = false) {
    if (!prepared) { list.length = 0; scene.updateMatrixWorld(true); scene.traverseVisible(collect); }
    ray.set(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize()); ray.far = range;
    hits.length = 0; ray.intersectObjects(list, false, hits);
    const effects = [], visited = new Set();
    for (const hit of hits) {
      if (!shown(hit.object)) continue;
      const id = stableObjectId(hit.object);
      if (!id || visited.has(id)) continue;
      visited.add(id);
      if (hit.face) {
        mtx.copy(hit.object.matrixWorld);
        if (hit.object.isInstancedMesh && hit.instanceId != null) { hit.object.getMatrixAt(hit.instanceId, inv); mtx.multiply(inv); }
        nrm.copy(hit.face.normal).applyMatrix3(nm.getNormalMatrix(mtx)).normalize();
      } else nrm.copy(ray.ray.direction).negate();
      if (nrm.dot(ray.ray.direction) > 0) nrm.negate();
      const glass = !!hit.object.userData.glass;
      if (glass && hit.object.userData.shatter === false) continue;
      effects.push({ kind: glass ? 'glass' : 'surface', objectId: id,
        point: hit.point.toArray(), normal: nrm.toArray(), distance: hit.distance });
      if (!glass || effects.length >= 16) break;
    }
    if (!prepared) list.length = 0;
    return effects;
  }

  // Capture actual scattered rays without mutating the apartment. The authority
  // validates these surface observations and independently raycasts wildlife.
  function captureShot({ spread = 0, pellets = 1, range = 100, weapon = '' } = {}) {
    list.length = 0; scene.updateMatrixWorld(true); scene.traverseVisible(collect); ray.far = range;
    const origin = camera.position.toArray(), rays = [];
    for (let i = 0; i < Math.min(9, pellets); i++) {
      ray.setFromCamera(centre, camera);
      if (spread > 0) {
        const a = Math.random() * Math.PI * 2, u = Math.random(), r = Math.tan(spread) * (pellets > 1 ? Math.sqrt(u) : u);
        ax.setFromMatrixColumn(camera.matrixWorld, 0); ay.setFromMatrixColumn(camera.matrixWorld, 1);
        ray.ray.direction.addScaledVector(ax, Math.cos(a) * r).addScaledVector(ay, Math.sin(a) * r).normalize();
      }
      const direction = ray.ray.direction.toArray();
      rays.push({ direction, effects: resolveNetworkSurfaces(origin, direction, range, true) });
    }
    ray.setFromCamera(centre, camera); list.length = 0;
    return { weapon, origin, direction: ray.ray.direction.toArray(), rays };
  }

  function applyEffect(effect, direction, seed, replay = false, index = null, eventId = null) {
    const object = (index ?? indexNetworkObjects(scene)).get(effect.objectId);
    if (!object) return false;
    if (effect.material === 'glass' && !object.userData.glass && !breaks.breakableOf(object) && !shotHandlers.has(object)) {
      object.userData.networkMirror = true;
      return false;
    }
    if (!effect.point || !effect.normal) return true;
    const hit = { object, point: new THREE.Vector3(...effect.point), distance: effect.distance ?? 0 },
      dir = new THREE.Vector3(...direction), normal = new THREE.Vector3(...effect.normal).normalize();
    if (!shown(object) && !object.userData.mirrorGlass) return true;
    const record = networkDamageEvents.get(eventId), previousRandom = effectRandom;
    effectRandom = seededRandom(seed);
    if (networkDamageResetters.has(object)) record?.mirrors.add(effect.objectId);
    try { breaks.withSeed(seed, () => {
      const surf = surface(hit);
      if (effect.kind === 'glass') { if (breaks.handle(hit, dir) == null) breaks.shatterPane(hit, dir); return; }
      if (breaks.handle(hit, dir) || breaks.breakAt(hit, dir, surf)) {
        if (!replay) burst(hit.point, normal, dir, { ...surf, solid: true });
      } else {
        const screen = isScreen(object);
        const decal = screen ? addCrack(hit, normal) : !surf.cutout ? addHole(hit, normal, surf.albedo) : null;
        if (decal) record?.decals.add(decal);
        if (!replay) burst(hit.point, normal, dir, { ...surf, solid: !screen });
      }
    }, { replay, eventId }); } finally { effectRandom = previousRandom; }
    return true;
  }

  function applyNetworkShot(shot, { replay = false } = {}) {
    const id = shot.shotId ?? shot.id;
    if (id && appliedShots.has(id) && (!replay || networkDamageEvents.has(id))) return false;
    if (id) { appliedShots.add(id); while (appliedShots.size > 512) appliedShots.delete(appliedShots.values().next().value); }
    networkDamageEvents.set(id, { shot, decals: new Set(), mirrors: new Set() });
    const index = indexNetworkObjects(scene);
    for (let ri = 0; ri < (shot.rays?.length ?? 0); ri++) {
      const r = shot.rays[ri];
      for (let ei = 0; ei < (r.effects?.length ?? 0); ei++) {
        const effect = r.effects[ei], seed = `${id}:${ri}:${ei}`;
        if (!['surface', 'glass'].includes(effect.kind)) continue;
        if (!applyEffect(effect, r.direction, seed, replay, index, id) && pendingEffects.length < 3072)
          pendingEffects.push({ effect, direction: r.direction, seed, replay: true, eventId: id });
      }
    }
    requestRender?.(); return true;
  }

  function applyBroken(ids = []) {
    for (const id of ids) brokenIds.add(id);
    breaks.applyBroken(brokenIds);
  }

  function reconcileNetworkDamage(effects = [], broken = []) {
    const keys = effects.map(shot => shot.shotId ?? shot.id), next = new Set(keys);
    const signature = keys.join('|');
    const latest = effects.length ? Math.max(...effects.map(shot => Number(shot.id) || 0)) : Infinity;
    const hasEvicted = [...networkDamageEvents].some(([id, record]) => !next.has(id) && Number(record.shot.id) <= latest);
    if (signature !== damageJournalSignature || hasEvicted || effects.some(shot => !networkDamageEvents.has(shot.shotId ?? shot.id))) {
      const affectedMirrors = new Set();
      for (const [id, record] of networkDamageEvents) {
        // A live reliable event can arrive just before its corresponding snapshot.
        if (next.has(id) || Number(record.shot.id) > latest) continue;
        for (const decal of record.decals) decal.removeFromParent();
        for (const objectId of record.mirrors) affectedMirrors.add(objectId);
        breaks.forgetNetworkEvent(id); networkDamageEvents.delete(id);
      }
      holes = holes.filter(inScene); cracks = cracks.filter(inScene);
      for (let i = pendingEffects.length - 1; i >= 0; i--) if (!networkDamageEvents.has(pendingEffects[i].eventId)) pendingEffects.splice(i, 1);
      for (const shot of effects) if (!networkDamageEvents.has(shot.shotId ?? shot.id)) applyNetworkShot(shot, { replay: true });
      if (affectedMirrors.size) {
        const index = indexNetworkObjects(scene);
        breaks.resetNetworkDamage(affectedMirrors, index);
        // Only aggregate mirror textures need reconstruction. Individual bullet
        // holes and screen cracks were removed directly through owned references.
        for (const shot of effects) {
          const id = shot.shotId ?? shot.id;
          for (let ri = 0; ri < (shot.rays?.length ?? 0); ri++) {
            const ray = shot.rays[ri];
            for (let ei = 0; ei < (ray.effects?.length ?? 0); ei++) {
              const effect = ray.effects[ei];
              if (affectedMirrors.has(effect.objectId)) applyEffect(effect, ray.direction, `${id}:${ri}:${ei}`, true, index, id);
            }
          }
        }
      }
      damageJournalSignature = signature; requestRender?.();
    }
    applyBroken(broken);
  }

  // ---------- кадр ----------
  const camQ = new THREE.Quaternion(), qa = new THREE.Quaternion(), buf = new THREE.Vector2(), dv = V3();
  const offSnap = pipe?.onLive?.(live => { capturing = !live; syncHidden(); if (live) requestRender?.(); });
  function syncHidden() {
    const h = !!pipe?.photo || capturing;
    if (h === hidden) return false;
    hidden = h;
    for (const d of holes) d.visible = !h;
    for (const d of cracks) d.visible = !h;
    return true;
  }

  function step(arr, dt, write) {
    let j = 0;
    for (const e of arr) {
      if (e.age >= e.life) continue;
      e.age += dt;
      if (e.age >= e.life) { alive--; continue; }
      e.v.multiplyScalar(Math.exp(-e.drag * dt));
      e.v.y -= e.g * dt;
      e.p.addScaledVector(e.v, dt);
      if (e.p.y < e.floor) { e.p.y = e.floor; e.v.y *= -0.3; e.v.x *= 0.6; e.v.z *= 0.6; }
      write(e, j++);
    }
    return j;
  }

  function update(dt = 1 / 60) {
    acceleration.update();
    const now = performance.now();
    if (network && now - pendingAt >= 500) {
      pendingAt = now;
      const index = pendingEffects.length ? indexNetworkObjects(scene) : null;
      for (let i = pendingEffects.length - 1; i >= 0; i--) {
        const p = pendingEffects[i];
        if (!networkDamageEvents.has(p.eventId) || applyEffect(p.effect, p.direction, p.seed, p.replay, index, p.eventId)) pendingEffects.splice(i, 1);
      }
      if (brokenIds.size) breaks.applyBroken(brokenIds);
    }
    let changed = syncHidden();
    if (breaks.update(dt)) changed = true;
    // трещина одинаково светлая днём и вечером: яркость делится на экспозицию кадра
    if (cracks.length && renderer.toneMappingExposure !== crackExp) {
      crackExp = renderer.toneMappingExposure;
      crackMat.color.setScalar(IMP.crackGain / Math.max(1e-3, crackExp));
    }
    if (!alive) {
      if (chips.visible || dust.visible || sparks.visible) { chips.visible = dust.visible = sparks.visible = false; changed = true; }
      return changed;
    }
    dt = Math.min(Math.max(dt, 1e-4), 0.05);
    camera.getWorldQuaternion(camQ);
    chips.count = step(P.chips, dt, (e, i) => {
      const k = e.age / e.life, s = e.size * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      dummy.position.copy(e.p); dummy.quaternion.setFromAxisAngle(e.axis, e.spin * e.age); dummy.scale.setScalar(Math.max(s, 1e-5));
      dummy.updateMatrix(); chips.setMatrixAt(i, dummy.matrix); chips.setColorAt(i, e.c);
    });
    dust.count = step(P.dust, dt, (e, i) => {
      const k = e.age / e.life, s = e.size * (1 + 2.5 * Math.sqrt(k));
      qa.setFromAxisAngle(Z, e.spin * e.age);
      dummy.position.copy(e.p); dummy.quaternion.copy(camQ).multiply(qa); dummy.scale.setScalar(s);
      dummy.updateMatrix(); dust.setMatrixAt(i, dummy.matrix); dust.setColorAt(i, e.c);
      dustFade.setX(i, 0.85 * Math.min(1, k * 12) * (1 - k) ** 1.5);
    });
    const ns = step(P.sparks, dt, (e, i) => {
      const k = e.age / e.life;
      sPos.setXYZ(i, e.p.x, e.p.y, e.p.z);
      dv.set(e.c.r, e.c.g, e.c.b).multiplyScalar(1 - k * k);
      sCol.setXYZ(i, dv.x, dv.y, dv.z);
      sSize.setX(i, e.size * (1 - 0.5 * k));
    });
    sparkGeo.setDrawRange(0, ns);
    for (const a of [chips.instanceMatrix, chips.instanceColor, dust.instanceMatrix, dust.instanceColor, dustFade, sPos, sCol, sSize]) a.needsUpdate = true;
    const h = renderer.getDrawingBufferSize(buf).y;
    sparkMat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    sparkMat.uniforms.uGain.value = IMP.sparkGain / Math.max(1e-3, renderer.toneMappingExposure);
    chips.visible = chips.count > 0 && !hidden;
    dust.visible = dust.count > 0 && !hidden;
    sparks.visible = ns > 0 && !hidden;
    return true;
  }

  function dispose() {
    acceleration.dispose();
    clear();
    offSnap?.();
    for (const o of [chips, dust, sparks]) o.removeFromParent();
    quads.forEach(g => g.dispose());
    mats.forEach(m => m.dispose());
    breaks.dispose();
    [crackTex, crackMat, holeTex, dustTex, chipsGeo, chipsMat, dustGeo, dustMat, sparkGeo, sparkMat].forEach(x => x.dispose());
    chips.dispose(); dust.dispose();
  }

  return {
    shoot, vehicleImpact, captureShot, resolveNetworkSurfaces, applyNetworkShot, applyBroken, reconcileNetworkDamage, update, clear, dispose,
    setNetwork(on) { network = !!on; },
    get raycastStatus() { return acceleration.status; },
    get networkDamage() { return { events: networkDamageEvents.size, holes: holes.filter(inScene).length, cracks: cracks.filter(inScene).length, pending: pendingEffects.length }; },
    collectNetworkObjects: () => collectNetworkObjects(scene, THREE, { breakableOf: breaks.breakableOf, dependentIdsOf: breaks.dependentIdsOf }),
    get brokenIds() { return breaks.brokenIds; },
    get holes() { return holes.filter(inScene).length + cracks.filter(inScene).length; },
    get broken() { return breaks.broken; },
  };
}

// ---------- текстуры (рисуются на холсте один раз) ----------

// Атлас 2×2 следов. RGB: дыра чёрная, край белый (его красит цвет материала), трещины и копоть тёмные; альфа — форма.
function makeHoleAtlas(THREE) {
  const n = CELL * ATLAS, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d');
  const blob = (cx, cy, r, jag, k = 14) => {
    g.beginPath();
    for (let i = 0; i <= k; i++) {
      const a = (i / k) * Math.PI * 2, rr = r * (1 + (Math.random() - 0.5) * jag);
      g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
  };
  for (let cell = 0; cell < ATLAS * ATLAS; cell++) {
    const R = CELL / 2 - 2, cx = (cell % ATLAS) * CELL + CELL / 2, cy = Math.floor(cell / ATLAS) * CELL + CELL / 2;
    g.save();
    g.beginPath(); g.rect(cx - CELL / 2 + 1, cy - CELL / 2 + 1, CELL - 2, CELL - 2); g.clip();   // поле — без заезда на соседа в мипах
    // копоть и вмятина: мягкое тёмное кольцо
    const soot = g.createRadialGradient(cx, cy, R * 0.25, cx, cy, R * 0.92);
    soot.addColorStop(0, 'rgba(26,24,22,0.6)'); soot.addColorStop(0.5, 'rgba(26,24,22,0.25)'); soot.addColorStop(1, 'rgba(26,24,22,0)');
    g.fillStyle = soot; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    // сколотый край: светлый, к дыре темнеет (стенка воронки)
    const rimR = R * rand(0.48, 0.56);
    blob(cx, cy, rimR, 0.35, 18);
    const rim = g.createRadialGradient(cx, cy, R * 0.24, cx, cy, rimR);
    rim.addColorStop(0, 'rgba(120,118,115,1)'); rim.addColorStop(0.55, 'rgba(225,223,220,1)'); rim.addColorStop(1, 'rgba(255,255,255,0.95)');
    g.fillStyle = rim; g.fill();
    // трещины от дыры
    g.strokeStyle = 'rgba(30,28,26,0.75)'; g.lineCap = 'round';
    for (let i = 0, k = 4 + ((Math.random() * 4) | 0); i < k; i++) {
      let a = Math.random() * Math.PI * 2, r = R * 0.26;
      const L = R * rand(0.6, 0.9);
      g.lineWidth = rand(0.8, 1.6);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      while (r < L) { r += R * rand(0.06, 0.12); a += rand(-0.25, 0.25); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      g.stroke();
    }
    // крошки по краю
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, r = rimR * rand(0.95, 1.25);
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(40,38,36,0.6)';
      g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rand(1, 2.5), rand(1, 2.5));
    }
    // сама дыра
    blob(cx, cy, R * rand(0.24, 0.29), 0.3, 12);
    const hole = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.29);
    hole.addColorStop(0, 'rgba(4,4,4,1)'); hole.addColorStop(0.7, 'rgba(10,9,8,1)'); hole.addColorStop(1, 'rgba(40,38,35,1)');
    g.fillStyle = hole; g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Мягкое пятно для облачка пыли (альфа-карта: читается зелёный канал)
function makeSoftDot(THREE) {
  const n = 64, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'), c = n / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(160,160,160,1)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gr; g.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(cv);
}

// Атлас 2×2 трещин экрана: паутина — лучи от точки удара, кольца между ними, в центре крошево. Белые изломы
// с тёмной тенью рядом (читаются и на светлом, и на тёмном видео); фон прозрачный.
function makeCrackAtlas(THREE) {
  const n = CRACK_CELL * ATLAS, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d');
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let cell = 0; cell < ATLAS * ATLAS; cell++) {
    const R = CRACK_CELL / 2 - 3, cx = (cell % ATLAS) * CRACK_CELL + CRACK_CELL / 2, cy = Math.floor(cell / ATLAS) * CRACK_CELL + CRACK_CELL / 2;
    g.save();
    g.beginPath(); g.rect(cx - CRACK_CELL / 2 + 1, cy - CRACK_CELL / 2 + 1, CRACK_CELL - 2, CRACK_CELL - 2); g.clip();
    const rays = [], k = 9 + ((Math.random() * 6) | 0);
    for (let i = 0; i < k; i++) {
      let a = (i / k) * Math.PI * 2 + rand(-0.25, 0.25), r = R * 0.06;
      const pts = [[cx + Math.cos(a) * r, cy + Math.sin(a) * r]], L = R * rand(0.7, 1);
      while (r < L) { r += R * rand(0.07, 0.14); a += rand(-0.12, 0.12); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      rays.push(pts);
    }
    const line = (pts, w, a) => {
      g.beginPath(); pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y));
      g.strokeStyle = `rgba(10,12,14,${a * 0.55})`; g.lineWidth = w + 1.4; g.stroke();
      g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w; g.stroke();
    };
    // кольца: между соседними лучами на нескольких радиусах, с изломом
    for (const f of [0.22, 0.4, 0.62].map(x => x * rand(0.85, 1.15))) {
      for (let i = 0; i < rays.length; i++) {
        if (Math.random() < 0.25) continue;
        const A = rays[i], B = rays[(i + 1) % rays.length];
        const pa = A[Math.min(A.length - 1, Math.round(f * (A.length - 1)))], pb = B[Math.min(B.length - 1, Math.round(f * (B.length - 1)))];
        const mx = (pa[0] + pb[0]) / 2 + rand(-3, 3), my = (pa[1] + pb[1]) / 2 + rand(-3, 3);
        line([pa, [mx, my], pb], 1, 0.75 * (1 - f * 0.6));
      }
    }
    for (const pts of rays) line(pts, rand(1.1, 1.8), 0.95);
    // крошево в центре
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.12);
    core.addColorStop(0, 'rgba(255,255,255,0.95)'); core.addColorStop(0.5, 'rgba(230,235,240,0.7)'); core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core; g.beginPath(); g.arc(cx, cy, R * 0.12, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(8,8,10,0.9)'; g.beginPath(); g.arc(cx, cy, R * 0.025, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
