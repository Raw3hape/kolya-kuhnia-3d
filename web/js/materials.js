// Материалы: загрузка текстур с кешем и сборка PBR-материала из записи каталога.
// Вся геометрия имеет UV в метрах (см. model.js → boxUV), поэтому repeat = 1 / size.
// Сгенерированные текстуры (gen: true) несут meta.json {size, sizeV, rough}.
//
//   applyItem(mat, item, extra, { later, label }) — запись каталога на материал (label — подпись на экране загрузки,
//                            loading.js track); makeMat(opts); loadMeta(id); setAnisotropy(a)
//   onTexturesChanged(fn) — карты сменились без участия вызывающего (полный размер доехал): перерисовать кадр
//   setTextureQuality(q)  — качество растра (render.js QUALITY): какой размер текстур держать, уже наложенные
//                            материалы догружаются до него на месте
//
// Размеры текстур (tools/make_web_assets.py, список папок — textures/sizes.json): 512 — первый кадр и любой новый
// выбор (видно сразу), следом полный для качества: 1k у «Эконома» и «Быстрого», оригинал (2k) у «Высокого» и «Ультра».
// Полный размер до первого вида не грузится (loading.js whenRoom): сначала всё видимое маленьким.
// later: true — материал не в первом виде (ванная): грузится только после первого вида.
// applyItem возвращается, когда на материале есть первая (маленькая) версия; полная доезжает сама.
//
// JPG декодируются вне главного потока (ImageBitmap): смена материала не стоит 30–60 мс декодирования на карту
// в момент первой отрисовки. Кеш исходников — последние IMAGE_CACHE путей: дальше память держат только
// текстуры, которые сейчас на материалах (их GPU-копию освобождает dispose в applyItem).
// Заливка на видеокарту — бюджетом кадра в render.js (материал помечается needsUpdate, render.js льёт его карты).
import * as THREE from 'three';
import { assetUrl, assetIndex, track, whenRoom, isRoomReady, retry } from './loading.js';
import { startup } from './startup-state.js';

const IMAGE_CACHE = 36;   // ≈ 12 наборов цвет/нормаль/шероховатость (маленькие и полные)
// Переворот — при декодировании (flipY у ImageBitmap в WebGL не работает); цвет без пересчёта профилей,
// как у TextureLoader для карт данных; для цветовых карт браузер не трогает и sRGB (у наших JPG нет ICC).
const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
const imageCache = new Map();   // путь -> Promise<Texture>, порядок — давность использования
const metaCache = new Map();    // id -> Promise<meta|null>
let maxAniso = 8;

// Размер по качеству: '512' | '1k' | 'full' (оригинал)
const TIER_OF = { eco: '512', fast: '1k', high: 'full', ultra: 'full' };
let tier = '512';
// Список уровней и meta.json текстур сборка кладёт в страницу (loading.js assetIndex): без запросов; локально — файлы
const sizes = assetIndex('sizes') ? Promise.resolve(assetIndex('sizes'))
  : fetch(assetUrl('textures/sizes.json')).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
const FULL_LABEL = 'Текстуры в полном размере';
const live = new Map();   // материал -> аргументы последнего applyItem (для смены размера по качеству)

export function setAnisotropy(a) { maxAniso = a; }
// Карты материала сменились сами (догрузился полный размер, фоновый материал): кадр перерисовать (main.js)
let changed = () => {};
export function onTexturesChanged(fn) { changed = fn; }

export function setTextureQuality(q) {
  const t = TIER_OF[q] || 'full';
  if (t === tier) return;
  tier = t;
  for (const [mat, a] of live) applyItem(mat, a.item, a.extra, a.opts);
}

async function pathOf(dir, map, t) {
  const has = (await sizes)[dir]?.includes(t);
  return `textures/${dir}/${has ? `${t}/` : ''}${map}.jpg`;
}

function baseTexture(path, srgb, later, label) {
  let p = imageCache.get(path);
  if (p) { imageCache.delete(path); imageCache.set(path, p); return p; }
  p = track(retry(() => loader.loadAsync(assetUrl(path))), { later, label, url: path }).then(bitmap => {
    const t = new THREE.Texture(bitmap);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  });
  p.catch(() => imageCache.delete(path));   // неудачную загрузку можно повторить
  imageCache.set(path, p);
  while (imageCache.size > IMAGE_CACHE) imageCache.delete(imageCache.keys().next().value);
  return p;
}

export function loadMeta(id) {
  const known = assetIndex('meta');
  if (known && !metaCache.has(id)) metaCache.set(id, Promise.resolve(known[id] ?? null));
  if (!metaCache.has(id)) {
    metaCache.set(id, fetch(assetUrl(`textures/${id}/meta.json`)).then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return metaCache.get(id);
}

async function tex(id, map, item, srgb, t, later, label) {
  const t0 = (await baseTexture(await pathOf(id, map, t), srgb, later, label)).clone();
  t0.wrapS = t0.wrapT = THREE.RepeatWrapping;
  t0.anisotropy = maxAniso;
  const su = item.size || 1, sv = item.sizeV || su;
  t0.repeat.set(1 / su, 1 / sv);
  const rot = (item.rotation || 0) + (item.rotate ? Math.PI / 2 : 0);   // собственный поворот + поворот «доской»
  if (rot) { t0.center.set(0.5, 0.5); t0.rotation = rot; }
  t0.needsUpdate = true;
  return t0;
}

// Карты записи в размере t: { map, normalMap, roughnessMap } (нет текстуры — пусто)
async function loadMaps(it, t, later, label) {
  const maps = {};
  if (it.tex) {
    if (t === '512' && tier === '512') maps.map = await tex(it.tex, 'color', it, true, t, later, label);
    else [maps.map, maps.normalMap, maps.roughnessMap] = await Promise.all([
      tex(it.tex, 'color', it, true, t, later, label), tex(it.tex, 'normal', it, false, t, later, label), tex(it.tex, 'rough', it, false, t, later, label),
    ]);
  } else if (it.normal && tier !== '512') {
    maps.normalMap = await tex(it.normal, 'normal', { size: it.size }, false, t, later, label);
  }
  return maps;
}

// Есть ли уже в кеше карты записи нужного размера (тогда маленькие не нужны)
async function cached(it, t) {
  const id = it.tex || it.normal;
  return imageCache.has(await pathOf(id, it.tex ? 'color' : 'normal', t));
}

// Применяет запись каталога к существующему материалу (материал слота один и тот же,
// меши не пересоздаются, меняются только карты и параметры). Повтор той же записи ничего не делает.
export function applyItem(mat, item, extra = {}, opts = {}) {
  return startup.track(applyItemInner(mat, item, extra, opts), { label: opts.label || 'Материалы квартиры' });
}
async function applyItemInner(mat, item, extra = {}, opts = {}) {
  const it = { ...item, ...extra };
  const key = JSON.stringify(it);
  const want = tier;
  if (mat.userData.itemKey === key && mat.userData.tier === want) return mat;
  const same = mat.userData.itemKey === key;   // та же запись, другое качество: только поменять карты
  mat.userData.itemKey = key;
  if (!live.has(mat)) mat.addEventListener('dispose', () => live.delete(mat));
  const request = { item, extra, opts };
  live.set(mat, request);
  const later = !!opts.later;
  if (later && !isRoomReady()) {   // не ждать: вызывающий (setState) не должен зависеть от фоновых материалов
    startup.track(whenRoom.then(() => { if (mat.userData.itemKey === key) { mat.userData.itemKey = ''; return applyItem(mat, item, extra, opts); } }), { label: opts.label || 'Материалы квартиры' });
    return mat;
  }
  let roughMul = 1;
  if (it.gen && it.tex) {
    const meta = await loadMeta(it.tex);
    if (meta) {
      if (meta.size) { it.size = meta.size; it.sizeV = meta.sizeV || meta.size; }
      roughMul = meta.rough ?? 1;
    }
  }
  const current = () => live.get(mat) === request;
  const put = (maps, t) => {
    if (!current() || (t !== '512' && t !== tier)) {   // пока грузили, выбрали другое (или сменили качество)
      for (const m of Object.values(maps)) m?.dispose();
      return;
    }
    for (const k of ['map', 'normalMap', 'roughnessMap']) {
      if (mat[k] && mat[k] !== maps[k]) mat[k].dispose();
      mat[k] = maps[k] || null;
    }
    mat.userData.tier = t;
    if (!same || t !== '512') setParams(mat, it, roughMul);
    mat.needsUpdate = true;
    changed();
  };
  const stage = async t => {
    // подпись: маленькие — как сказал вызывающий; полный размер после первого вида — общая «полный размер»
    try { put(await loadMaps(it, t, later || t !== '512', t === '512' || !isRoomReady() ? opts.label : FULL_LABEL), t); }
    catch (err) {
      console.warn('Нет текстуры', it.tex || it.normal, err);
      if (current()) {
        mat.userData.itemKey = '';   // при следующем выборе попробовать снова
        for (const k of ['map', 'normalMap', 'roughnessMap']) { mat[k]?.dispose(); mat[k] = null; }
        setParams(mat, it, roughMul); mat.needsUpdate = true;
      }
    }
  };
  if (!it.tex && !it.normal) { put({}, want); return mat; }
  // Сначала маленькие (видно сразу), полные — следом, и не раньше первого вида
  if (!same && want !== '512' && !(await cached(it, want))) {
    await stage('512');
    if (current()) startup.track((isRoomReady() ? Promise.resolve() : whenRoom).then(() => { if (current() && mat.userData.tier !== tier) return stage(tier); }), { label: opts.label || 'Материалы квартиры' });
    return mat;
  }
  await stage(want);
  return mat;
}

function setParams(mat, it, roughMul) {
  mat.color.set(it.tex ? (it.tint || '#ffffff') : (it.color || '#ffffff'));
  mat.roughness = it.gen ? (it.rough ?? 1) * roughMul : (it.rough ?? 0.6);
  mat.metalness = it.metal ?? 0;
  const ns = it.normalScale ?? (it.tex ? 1 : 0.2);
  mat.normalScale.set(ns, ns);
  if ('clearcoat' in mat) {
    mat.clearcoat = it.clearcoat ?? 0;
    mat.clearcoatRoughness = 0.08;
  }
}

export function makeMat(opts = {}) {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, ...opts });
}
