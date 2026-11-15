// Материалы: загрузка текстур с кешем и сборка PBR-материала из записи каталога.
// Вся геометрия имеет UV в метрах (см. model.js → boxUV), поэтому repeat = 1 / size.
// Сгенерированные текстуры (gen: true) несут meta.json {size, sizeV, rough}.
//
//   applyItem(mat, item, extra) — запись каталога на материал; makeMat(opts); loadMeta(id); setAnisotropy(a)
//
// JPG декодируются вне главного потока (ImageBitmap): смена материала не стоит 30–60 мс декодирования на карту
// в момент первой отрисовки. Кеш исходников — последние IMAGE_CACHE путей: дальше память держат только
// текстуры, которые сейчас на материалах (их GPU-копию освобождает dispose в applyItem).
import * as THREE from 'three';

const IMAGE_CACHE = 24;   // ≈ 8 наборов цвет/нормаль/шероховатость
// Переворот — при декодировании (flipY у ImageBitmap в WebGL не работает); цвет без пересчёта профилей,
// как у TextureLoader для карт данных; для цветовых карт браузер не трогает и sRGB (у наших JPG нет ICC).
const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
const imageCache = new Map();   // путь -> Promise<Texture>, порядок — давность использования
const metaCache = new Map();    // id -> Promise<meta|null>
let maxAniso = 8;

export function setAnisotropy(a) { maxAniso = a; }

function baseTexture(path, srgb) {
  let p = imageCache.get(path);
  if (p) { imageCache.delete(path); imageCache.set(path, p); return p; }
  p = loader.loadAsync(path).then(bitmap => {
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
  if (!metaCache.has(id)) {
    metaCache.set(id, fetch(`textures/${id}/meta.json`).then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return metaCache.get(id);
}

async function tex(id, map, item, srgb) {
  const t = (await baseTexture(`textures/${id}/${map}.jpg`, srgb)).clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  const su = item.size || 1, sv = item.sizeV || su;
  t.repeat.set(1 / su, 1 / sv);
  const rot = (item.rotation || 0) + (item.rotate ? Math.PI / 2 : 0);   // собственный поворот + поворот «доской»
  if (rot) { t.center.set(0.5, 0.5); t.rotation = rot; }
  t.needsUpdate = true;
  return t;
}

// Применяет запись каталога к существующему материалу (материал слота один и тот же,
// меши не пересоздаются, меняются только карты и параметры). Повтор той же записи ничего не делает.
export async function applyItem(mat, item, extra = {}) {
  const it = { ...item, ...extra };
  const key = JSON.stringify(it);
  if (mat.userData.itemKey === key) return mat;
  mat.userData.itemKey = key;
  let roughMul = 1;
  if (it.gen && it.tex) {
    const meta = await loadMeta(it.tex);
    if (meta) {
      if (meta.size) { it.size = meta.size; it.sizeV = meta.sizeV || meta.size; }
      roughMul = meta.rough ?? 1;
    }
  }
  const maps = {};
  try {
    if (it.tex) {
      [maps.map, maps.normalMap, maps.roughnessMap] = await Promise.all([
        tex(it.tex, 'color', it, true), tex(it.tex, 'normal', it, false), tex(it.tex, 'rough', it, false),
      ]);
    } else if (it.normal) {
      maps.normalMap = await tex(it.normal, 'normal', { size: it.size }, false);
    }
  } catch (err) {
    console.warn('Нет текстуры', it.tex || it.normal, err);
    for (const t of Object.values(maps)) t?.dispose();
    for (const k of Object.keys(maps)) delete maps[k];
    if (mat.userData.itemKey === key) mat.userData.itemKey = '';   // при следующем выборе попробовать снова
  }
  if (mat.userData.itemKey !== key && mat.userData.itemKey !== '') {   // пока грузили, выбрали другое
    for (const t of Object.values(maps)) t?.dispose();
    return mat;
  }
  for (const k of ['map', 'normalMap', 'roughnessMap']) {
    if (mat[k] && mat[k] !== maps[k]) mat[k].dispose();
    mat[k] = maps[k] || null;
  }
  mat.color.set(it.tex ? (it.tint || '#ffffff') : (it.color || '#ffffff'));
  mat.roughness = it.gen ? (it.rough ?? 1) * roughMul : (it.rough ?? 0.6);
  mat.metalness = it.metal ?? 0;
  const ns = it.normalScale ?? (it.tex ? 1 : 0.2);
  mat.normalScale.set(ns, ns);
  if ('clearcoat' in mat) {
    mat.clearcoat = it.clearcoat ?? 0;
    mat.clearcoatRoughness = 0.08;
  }
  mat.needsUpdate = true;
  return mat;
}

export function makeMat(opts = {}) {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, ...opts });
}
