// Сцена, свет, камеры, состояние и связь с панелью.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createPipeline } from './render.js';

import { MATERIALS, OPTIONS, PRESETS, findMat, resolveItem, slotById } from './catalog.js';
import { applyItem, makeMat, setAnisotropy } from './materials.js';
import * as model from './model.js';
import { initUI, addSection } from './ui.js';
import { buildFurniture, placeFurniture, furnitureKey, createFurnitureEditor, registerFurnitureUI,
  furnitureResetPatch, FURN_SPEC, FURN_DEFAULTS, FURN_SCHEMA, FURN_SCHEMA_2, preloadSofas, normalizeFurniture, furnitureAnchors } from './furniture.js';
import { initWalk } from './walk.js';
import { initDoors } from './doors.js';
import { createSeats, registerSeatsUI } from './seats.js';
import { createTV } from './tv.js';
import { createViewmodel, registerViewmodelUI } from './viewmodel.js';
import { createHunt, registerHuntUI } from './hunt.js';
import { buildDecor, placeDecor, disposeDecor, normalizeMoves, decorKey, registerDecorUI, DECOR_SCHEMA, DECOR_DEFAULTS } from './decor.js';
import { createNav } from './nav.js';
import { buildLamps, LAMP_DEFAULTS, LAMP_SCHEMA, LAMP_SCHEMA_ROOMS, LAMP_ROOM_DEFAULTS, DIM, NIGHT_SCALE } from './lamps.js';
import { createLighting, lightTimePatch } from './lighting.js';
import { createCutaway } from './cutaway.js';
import { initMinimap } from './minimap.js';
import { sunFor, buildContext } from './site.js';
import { buildBath } from './bath.js';

const [plan, kit, viewSpec, site, bathSpec] = await Promise.all([
  fetch('spec/plan.generated.json').then(r => r.json()),
  fetch('spec/kitchen.json').then(r => r.json()),
  fetch('spec/views.json').then(r => r.json()),
  fetch('spec/site.json').then(r => r.json()),
  fetch('spec/bath.json').then(r => r.json()),   // ванная как на объекте: плитка, душ, унитаз (bath.js)   // дом на карте, куда смотрят окна, этаж (tools/fetch_site.py)
]);
const H = plan.ceiling;

// ---------- состояние и его код для ссылки (#v3-…) ----------
// Код — номера вариантов по порядку SCHEMA. Порядок не менять, новые поля только в конец SCHEMA_V3.
// В v3 хвост необязателен: код, записанный до добавления новых полей, читается, недостающее берётся по умолчанию.

const ids = list => list.map(o => o.id);
const slotIds = id => { const s = slotById(id); return s.same ? ['same', ...ids(MATERIALS[s.group])] : ids(MATERIALS[s.group]); };
const SCHEMA_V2 = [
  ...['floorA', 'floorB', 'floorRoom2', 'floorRoom3',
      'walls', 'wallAccent', 'wallsRoom2', 'wallsRoom3', 'wallsBath',
      'counter', 'fronts', 'island', 'islandTop', 'backsplash', 'metal', 'doors'].map(k => [k, slotIds(k)]),
  ...['light', 'floorDir', 'frames', 'handles', 'pendants', 'threshold', 'fridge'].map(k => [k, ids(OPTIONS[k])]),
  ['aisle', 'cm'], ['gapW', 'cm'], ['split', 'cm'], ['sunAz', 'deg'], ['sunEl', 'deg'], ['exposure', 'pct'],
];
// v3 = v2 + светильники (lamps.js) + мебель (furniture.js); дальше сюда же в конец добавляются новые поля.
const SCHEMA_V3 = [...SCHEMA_V2, ...LAMP_SCHEMA, ...FURN_SCHEMA, ['sunDate', 'doy'], ['sunTime', 'q15'], ...FURN_SCHEMA_2, ...LAMP_SCHEMA_ROOMS, ...DECOR_SCHEMA];
// Дата хранится днём года (год текущий), время — шагом 15 минут.
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const doyOf = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5); };
const isoOfDoy = n => { const d = new Date(Date.UTC(new Date().getFullYear(), 0, n)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
// Старый формат v1: списки на момент v1 (только чтение сохранённых вариантов и ссылок).
const V1 = {
  floor: ['oak-light', 'oak-nat', 'herring', 'microcem', 'terrazzo-f', 'marble-f', 'travert-f'],
  walls: ['white-warm', 'white-cool', 'greige', 'cashmere', 'sage-w', 'clay-w', 'stone-grey', 'limewash', 'microcem-w'],
  stone: ['calacatta-rust', 'carrara', 'statuario', 'grey-vein', 'nero', 'travertine', 'terrazzo', 'quartz-w', 'compact-b', 'oak-top', 'steel-top'],
  fronts: ['oak-01', 'oak-white', 'oak-grey', 'walnut', 'oak-black', 'p-white', 'p-cashmere', 'p-sage', 'p-olive', 'p-terra', 'p-navy', 'p-graphite'],
};
const SCHEMA_V1 = [
  ['floor', V1.floor], ['walls', V1.walls], ['counter', V1.stone], ['fronts', V1.fronts],
  ['island', ['same', ...V1.fronts]], ['islandTop', ['same', ...V1.stone]],
  ['backsplash', ['none', 'slab', 'tiles-v']], ['metal', ['black', 'steel', 'brass', 'gun']],
  ['light', ['day', 'overcast', 'evening']], ['floorDir', ['z', 'x']], ['frames', ['white', 'anthracite']],
  ['handles', ['none', 'bar']], ['pendants', ['off', 'dome', 'globe']],
  ['aisle', 'cm'], ['gapW', 'cm'], ['sunAz', 'deg'], ['sunEl', 'deg'], ['exposure', 'pct'],
];

const BATH_FLOOR = MATERIALS.bathFloor[0].id;   // пол ванной уже уложен, в код не входит
const SPLIT = { min: 0.7, max: 5.5 };
const clampSplit = v => Math.min(SPLIT.max, Math.max(SPLIT.min, Number(v) || 2.6));
const DEFAULT = {
  ...PRESETS[0].state, floorBath: BATH_FLOOR, light: 'day', floorDir: 'z',
  aisle: kit.island.aisle, gapW: kit.island.gapToWindowWall, sunAz: 25, sunEl: 40, exposure: 1.0,
  ...LAMP_DEFAULTS, ...LAMP_ROOM_DEFAULTS, ...FURN_DEFAULTS, ...DECOR_DEFAULTS, sunDate: todayISO(), sunTime: 14,
};
export const state = { ...DEFAULT };

function encode(s) {
  return 'v3-' + SCHEMA_V3.map(([k, t]) => {
    if (t === 'cm') return Math.round(s[k] * 100);
    if (t === 'deg') return Math.round(s[k]) + 180;
    if (t === 'pct') return Math.round(s[k] * 100);
    if (t === 'doy') return doyOf(s[k]);
    if (t === 'q15') return Math.round(s[k] * 4);
    return Math.max(0, t.indexOf(s[k]));
  }).join('-') + (s.moves ? '~' + s.moves : '');
}
function decodeWith(schema, parts) {
  const s = {};
  schema.forEach(([k, t], i) => {
    const n = parseInt(parts[i + 1], 10);
    if (Number.isNaN(n)) return;
    if (t === 'cm') s[k] = n / 100;
    else if (t === 'deg') s[k] = n - 180;
    else if (t === 'pct') s[k] = n / 100;
    else if (t === 'doy') s[k] = isoOfDoy(n);
    else if (t === 'q15') s[k] = n / 4;
    else if (t[n] != null) s[k] = t[n];
  });
  return s;
}
function decode(code) {
  const raw = String(code || '').trim().replace(/^#/, ''), cut = raw.indexOf('~');
  const moves = cut < 0 ? '' : normalizeMoves(raw.slice(cut + 1));   // сдвиги вещей (decor.js), хвост после «~»
  const parts = (cut < 0 ? raw : raw.slice(0, cut)).split('-');
  const v3 = parts[0] === 'v3' && parts.length > SCHEMA_V2.length && parts.length <= SCHEMA_V3.length + 1;
  if (v3 || (parts[0] === 'v2' && parts.length === SCHEMA_V2.length + 1)) {
    const s = decodeWith(v3 ? SCHEMA_V3 : SCHEMA_V2, parts);
    if (s.split != null) s.split = clampSplit(s.split);
    s.moves = moves;
    return s;
  }
  if (parts[0] === 'v1' && parts.length === SCHEMA_V1.length + 1) {
    const { floor, ...s } = decodeWith(SCHEMA_V1, parts);
    // в v1 был один пол и не было зон: всё новое — как в эскизе
    return {
      floorRoom2: 'same', floorRoom3: 'same', wallAccent: 'same', wallsRoom2: 'same', wallsRoom3: 'same',
      wallsBath: DEFAULT.wallsBath, doors: DEFAULT.doors, split: DEFAULT.split, threshold: 'none', fridge: 'under', moves: '',
      ...(floor ? { floorA: floor, floorB: floor } : {}), ...s,
    };
  }
  return null;
}
export { encode, decode };

// ---------- рендер ----------

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 3000);   // дальние дома до 2 км
camera.layers.set(0);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.screenSpacePanning = true;

// Растр, качество и фото-режим (трассировка пути) живут в render.js; тон-маппинг ставит он же.
const pipe = createPipeline({ THREE, renderer, scene, camera });

// ---------- материалы слотов ----------

const paint = (c, r = 0.9) => makeMat({ color: c, roughness: r });
const M = {
  floorA: makeMat(), floorB: makeMat(), floorRoom2: makeMat(), floorRoom3: makeMat(), floorBath: makeMat(),
  walls: makeMat(), wallAccent: makeMat(), wallsRoom2: makeMat(), wallsRoom3: makeMat(), wallsBath: makeMat(),
  doors: makeMat(), threshold: makeMat(), fridge: makeMat(), vent: makeMat({ color: '#2a2a2b', roughness: 0.6 }),
  counter: makeMat(), fronts: makeMat(), island: makeMat(),
  islandTop: makeMat(), backsplash: makeMat(), metal: makeMat(),
  ceiling: makeMat(), sink: makeMat(), frame: paint('#f2f2f0', 0.4), handle: makeMat(),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x1c2224, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 }),
  sill: paint('#f4f3f0', 0.45), skirting: paint('#f4f3f0', 0.5), balcony: paint('#9a9792', 0.85), facade: paint('#d9d6cf', 0.9),
  railing: paint('#2f3133', 0.5), door: paint('#3b3c3e', 0.55), radiator: paint('#202122', 0.5),
  panelRad: paint('#f2f2f0', 0.35), cord: paint('#1a1a1a', 0.6), lampShade: makeMat({ color: '#1d1d1d', roughness: 0.4, side: THREE.DoubleSide }),
  hob: new THREE.MeshPhysicalMaterial({ roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 }),
};
for (const [k, m] of Object.entries(M)) m.name = k;
M.carcass = M.fronts; M.plinth = M.fronts; M.islandCarcass = M.island;
M.hob.map = hobTexture();
applyItem(M.ceiling, { color: '#eeede3', rough: 0.95, normal: 'white_stucco', normalScale: 0.12, size: 1.6 });

function hobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#0b0b0c'; x.fillRect(0, 0, 512, 512);
  x.strokeStyle = 'rgba(200,200,200,0.35)'; x.lineWidth = 3;
  for (const [cx, cy, r] of [[150, 150, 95], [370, 140, 70], [140, 370, 70], [370, 370, 100]]) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke(); }
  x.fillStyle = 'rgba(220,220,220,0.45)';
  for (let i = 0; i < 6; i++) x.fillRect(200 + i * 22, 480, 10, 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- геометрия ----------

const shell = model.buildShell(plan, M);
scene.add(shell.group);
scene.add(model.buildFixtures(plan, kit, M));
// Двери: отдельной функцией, если model.js её даёт (иначе они уже внутри buildShell)
const doorsOut = model.buildDoors?.(plan, M);
const doorsGroup = doorsOut?.isObject3D ? doorsOut : doorsOut?.group;
if (doorsGroup) scene.add(doorsGroup);
let kitchen = null;
let floors = null;
const cutMeshes = [...shell.walls];
doorsGroup?.traverse(o => { if (o.userData.cutaway && !cutMeshes.includes(o)) cutMeshes.push(o); });
const aboveMeshes = [];
scene.traverse(o => { if (o.userData.cut === 'above') aboveMeshes.push(o); });
// Ванная как на объекте (плитка 15×7,5, душ, инсталляция, тумба) — bath.js, размеры в spec/bath.json
const bath = buildBath(plan, bathSpec, M, state);
scene.add(bath.group);
cutMeshes.push(...bath.cut);
aboveMeshes.push(...bath.above);
bath.ready?.then(requestRender);
// Окружение по OpenStreetMap: свой дом (этажи выше дают тень), соседи, поле, дороги
const context = buildContext(site, THREE, { date: state.sunDate });   // сезон (листва, трава, поле) — по дате солнца
scene.add(context);
context.ready.then(() => { lighting.invalidate(); requestRender(); });
context.traverse(o => { if (o.userData.cut === 'above') aboveMeshes.push(o); });

function rebuildKitchen() {
  if (kitchen) {
    scene.remove(kitchen.group);
    kitchen.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  kitchen = model.buildKitchen(kit, state, M);
  kitchen.group.traverse(o => { if (o.material === M.hob) remapHob(o); });
  scene.add(kitchen.group);
  ui?.setIslandInfo(kitchen.island);
  requestRender();
}
// Полы по зонам: пересобираются при сдвиге границы плитки/дерева и при смене порожка
function rebuildFloors() {
  if (!model.buildFloors) return;
  if (floors) {
    scene.remove(floors);
    floors.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  floors = model.buildFloors(plan, state, M);
  if (floors) scene.add(floors);
  requestRender();
}
function remapHob(mesh) {
  const uv = mesh.geometry.attributes.uv;
  // верхняя грань коробки (индексы 8..11): растянуть карту на всю панель
  const q = [[0, 1], [1, 1], [0, 0], [1, 0]];
  for (let v = 0; v < 4; v++) uv.setXY(8 + v, q[v][0], q[v][1]);
}

// ---------- свет ----------

// Солнце, небо, свет из окон и отражённый свет по комнатам — lighting.js.
// Каждый источник светит только в своей комнате (и соседних через проёмы), сквозь стены не протекает.
const lighting = createLighting({ THREE, scene, renderer, plan, M, camera, controls, requestRender, getState: () => state });

// Мебель гостиной (диван, ТВ, тумба, ковёр, столик) — furniture.js. Положение меняется без пересборки.
let furn = null;
function rebuildFurniture() {
  if (furn) { scene.remove(furn.group); furn.group.traverse(o => { if (!o.userData.glb) o.geometry?.dispose(); }); }   // общие GLB не трогать
  furn = buildFurniture(FURN_SPEC, state, M, plan, kit);
  scene.add(furn.group);
  furn.ready?.then(requestRender);
}

// Обстановка остальных комнат (спальня, кабинет, стеллажи, прихожая) — decor.js, каталог spec/decor/
let decor = null;
function rebuildDecor() {
  if (decor?.group) { scene.remove(decor.group); disposeDecor(decor); }
  decor = buildDecor(state, plan, M, furnitureAnchors(furn, state, plan, kit));
  if (decor?.group) scene.add(decor.group);
  decor?.ready?.then(() => { lighting.invalidate(); requestRender(); });
}

// Свет в ванной включается вместе с лампами и с той же яркостью
// Ванная без окна: в режиме «Вечером» её свет горит и днём (в тёмную ванную никто не заходит без света).
// Лампа ванной в масштабе остальных светильников (NIGHT_SCALE, lamps.js). Днём экспозиция «глаза» ×6
// (lighting.js, EXPOSURE_IN) рассчитана на комнаты с окнами; ванная без окна светит только лампой,
// поэтому днём лампа ослаблена так, чтобы кадр выглядел как вечером (0.8 / 6). «Вечером» = горит всегда.
const BATH_DAY_GAIN = 0.8 / 6;
function syncBathLight() {
  const on = state.lampsOn === 'on' || state.lampsOn === 'auto';
  const gain = state.light === 'evening' ? 1 : BATH_DAY_GAIN;
  bath.setLight(on, NIGHT_SCALE * (state.lampDim ?? 0.8) * gain);
}

// Светильники (типы по зонам, подвесы, подсветка цоколя) — lamps.js
let lamps = null;
function rebuildLamps() {
  if (lamps) {
    scene.remove(lamps.group); lamps.dispose();
    const old = new Set(lamps.above);
    aboveMeshes.splice(0, aboveMeshes.length, ...aboveMeshes.filter(m => !old.has(m)));
  }
  lamps = buildLamps(plan, kit, state, M, kitchen.island);
  scene.add(lamps.group);
  aboveMeshes.push(...lamps.above);
  syncBathLight();
  requestRender();
}

function applyLight() {
  lamps?.update(state, state.light);
  syncBathLight();
  lighting.apply(state.light, state);
  requestRender();
}

// ---------- применение состояния ----------

// Холодильник отдельностоящий: корпус в тон металла (латунь — тёплая белая эмаль, латунный шкаф был бы кичем)
const FRIDGE_BODY = {
  steel: { color: '#c9cbcd', rough: 0.32, metal: 1 },
  black: { color: '#1f1f20', rough: 0.5, metal: 0.3 },
  gun:   { color: '#5a5c5f', rough: 0.38, metal: 1 },
  brass: { color: '#ebe7df', rough: 0.4 },
};
const FLOOR_SLOTS = ['floorA', 'floorB', 'floorRoom2', 'floorRoom3'];
const PLAIN_SLOTS = ['floorBath', 'walls', 'wallAccent', 'wallsRoom2', 'wallsRoom3', 'wallsBath', 'doors',
  'counter', 'fronts', 'island', 'islandTop', 'metal'];
let busy = 0;

async function applyMaterials() {
  // Доски в текстурах лежат вдоль u. Поворот «к окнам» добавляется к собственному повороту материала (ёлочка 45°).
  const dirRot = state.floorDir === 'z' ? Math.PI / 2 : 0;
  const jobs = FLOOR_SLOTS.map(k => {
    const it = resolveItem(state, k);
    return applyItem(M[k], it, { rotation: (it.rotation || 0) + (it.rotate ? Math.PI / 2 : 0) + dirRot, rotate: false });
  });
  for (const k of PLAIN_SLOTS) jobs.push(applyItem(M[k], resolveItem(state, k)));
  const bs = findMat('backsplash', state.backsplash);
  if (bs.tex) jobs.push(applyItem(M.backsplash, bs));
  const metal = findMat('metal', state.metal);
  jobs.push(applyItem(M.threshold, { color: metal.color, rough: Math.max(0.35, metal.rough ?? 0.4), metal: metal.metal ?? 1 }));
  jobs.push(applyItem(M.fridge, FRIDGE_BODY[state.metal] || FRIDGE_BODY.steel));
  jobs.push(applyItem(M.handle, state.frames === 'white' ? { color: '#e9e9e7', rough: 0.35 } : { color: '#2b2c2e', rough: 0.4 }));
  jobs.push(applyItem(M.sink, state.metal === 'black' ? { color: '#232324', rough: 0.55 } : { color: '#bfc1c3', rough: 0.3, metal: 1 }));
  M.frame.color.set(state.frames === 'white' ? '#f1f1ef' : '#34363a');
  M.lampShade.color.set(state.metal === 'brass' ? metal.color : (state.metal === 'steel' ? '#d6d6d4' : '#1d1d1d'));
  M.lampShade.metalness = state.metal === 'black' ? 0.2 : 1;
  if (busy++ === 0) ui?.setBusy(true);
  try { await Promise.all(jobs); }
  finally { if (--busy === 0) ui?.setBusy(false); }
  lighting.invalidate();   // цвет стен и пола меняет отражённый свет
  requestRender();
}

let lastKitchenKey = '', lastFloorsKey = '', lastLampsKey = '', lastFurnKey = '', lastDecorKey = null;
export async function setState(patch, { push = true } = {}) {
  Object.assign(state, patch);
  Object.assign(state, lightTimePatch(patch, state, site));   // «Вечер» = после заката этой даты, ночь в «День» не попадает
  state.split = clampSplit(state.split);
  state.floorBath = BATH_FLOOR;
  if (findMat('bathWalls', state.wallsBath).legacy) state.wallsBath = 'flugger-white-03';   // стены ванной теперь только краска
  // Солнце: настоящее положение над Варшавой на дату и время (site.js), в тех же sunAz/sunEl, что раньше
  const sp = sunFor(state.sunDate, state.sunTime, site);
  state.sunAz = sp.az; state.sunEl = Math.max(sp.el, 0.5); state.sunUp = sp.up;
  if (context.setSeason(state.sunDate)) requestRender();
  normalizeFurniture(state);   // размер ковра — из тех, что есть у выбранной модели
  state.lampDim = THREE.MathUtils.clamp(Number(state.lampDim) || LAMP_DEFAULTS.lampDim, DIM.min, DIM.max);
  const kitchenKey = [state.aisle, state.gapW, state.handles, state.backsplash, state.fridge].join('|');
  const kitchenChanged = kitchenKey !== lastKitchenKey;
  if (kitchenChanged) { lastKitchenKey = kitchenKey; rebuildKitchen(); }
  const lampsKey = [state.aisle, state.gapW, state.pendants, state.ceilingKitchen, state.ceilingLiving, state.ceilingHall, state.plinthLed, state.fridge, state.ceilingRoom2, state.ceilingRoom3].join('|');
  if (kitchenChanged || lampsKey !== lastLampsKey) { lastLampsKey = lampsKey; rebuildLamps(); }
  const furnKey = furnitureKey(state);
  if (furnKey !== lastFurnKey) { lastFurnKey = furnKey; rebuildFurniture(); }
  else placeFurniture(furn, state, plan, kit, FURN_SPEC);
  const decKey = decorKey(state);
  if (decKey !== lastDecorKey) { lastDecorKey = decKey; rebuildDecor(); }
  else placeDecor(decor, state, furnitureAnchors(furn, state, plan, kit));
  const floorsKey = [state.split, state.threshold].join('|');
  if (floorsKey !== lastFloorsKey) { lastFloorsKey = floorsKey; rebuildFloors(); }
  applyLight();
  ui?.sync(state);
  if (push) writeHash();
  await applyMaterials();
}

// Быстрый путь для ползунка границы: только пол заново, без кухни, материалов и ссылки.
// commit (событие change, палец отпущен) — записать код в адрес.
let hashTimer = 0;
function writeHash() {
  clearTimeout(hashTimer);
  try { history.replaceState(null, '', '#' + encode(state)); } catch { /* в песочнице может быть запрещено */ }
}
export function setSplit(v, { commit = false } = {}) {
  state.split = clampSplit(v);
  const floorsKey = [state.split, state.threshold].join('|');
  if (floorsKey !== lastFloorsKey) { lastFloorsKey = floorsKey; rebuildFloors(); lighting.invalidate(); }
  ui?.syncSplit(state);
  if (commit) { writeHash(); ui?.sync(state); }
  else { clearTimeout(hashTimer); hashTimer = setTimeout(writeHash, 400); }
}

// ---------- камеры ----------

export const VIEWS = viewSpec.views;
let anim = null;
export function goView(id, instant = false) {
  if (walk?.active) walk.exit({ restore: false });
  const v = VIEWS.find(x => x.id === id) || VIEWS[0];
  const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target), fov: fovFor(v.fov || 60) };
  if (instant) { camera.position.copy(to.pos); controls.target.copy(to.target); camera.fov = to.fov; camera.updateProjectionMatrix(); requestRender(); return; }
  anim = { t0: performance.now(), dur: 900, from: { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov }, to };
  requestRender();
}
function fovFor(f) { const a = camera.aspect; return a < 1 ? Math.min(85, f * (1 + (1 - a) * 0.6)) : f; }

// ---------- вырез стен перед камерой ----------

// Изнутри прячется стена между камерой и точкой взгляда целиком (с окнами и дверями);
// снаружи стены стоят все, прячутся только потолок и этажи сверху, когда камера выше потолка. cutaway.js
const cutaway = createCutaway({ camera, controls, shell, cutMeshes, aboveMeshes, H });
function updateCutaway() { cutaway.setEnabled(!walk?.active && !seats?.active); cutaway.update(); }

// ---------- кадр ----------

let needs = true;
export function requestRender() { needs = true; }
controls.addEventListener('change', requestRender);

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  pipe.setSize(w, h, window.devicePixelRatio);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(resize).observe(canvas);

let lastFrame = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000); lastFrame = now;
  if (walk?.update()) needs = true;
  if (doors?.update(dt)) needs = true;
  if (seats?.update(dt)) needs = true;
  if (viewmodel?.update(dt, { active: !!walk?.active, moving: !!walk?.moving, running: !!walk?.running })) needs = true;
  if (hunt?.update(dt)) needs = true;
  if (nav?.update()) needs = true;
  if (anim) {
    const k = Math.min(1, (now - anim.t0) / anim.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(anim.from.pos, anim.to.pos, e);
    controls.target.lerpVectors(anim.from.target, anim.to.target, e);
    camera.fov = anim.from.fov + (anim.to.fov - anim.from.fov) * e;
    camera.updateProjectionMatrix();
    if (k >= 1) anim = null;
    needs = true;
  }
  if (!walk?.active && !seats?.active && controls.update()) needs = true;
  if (lighting.update()) needs = true;
  const dirty = needs;
  if (needs) { needs = false; updateCutaway(); pipe.invalidate(); }
  pipe.render();
  if (!dirty) return;
  tv?.sync();
  furnEditor?.renderOverlay();
  minimap?.update();
}

export function setQuality(q) {
  pipe.setQuality(q);
  lighting.setQuality(q);
  resize();
}

// ---------- клик по поверхности -> раздел панели ----------

const raycaster = new THREE.Raycaster();
raycaster.layers.set(0);
let down = null;
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  // клик в прогулке — выстрел, дверь или сиденье, а не выбор материала
  if (viewmodel?.armed || doors?.target || seats?.target) return;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hits = raycaster.intersectObjects(scene.children, true).filter(h => !h.object.userData.glass);
  // стены несут слот на каждой грани (faceSlots), остальное — один слот на меш
  const slotOf = h => h.object.userData.faceSlots?.[h.face?.materialIndex] ?? h.object.userData.slot;
  const slot = hits[0] && slotOf(hits[0]);
  if (slot) ui?.focusSlot(slot);
});

// ---------- снимок и экспорт ----------

const isFramed = (() => { try { return window.self !== window.top; } catch { return true; } })();

async function saveBlob(blob, name) {
  // Локально (tools/serve.py) файл сразу кладётся в exports/; в обычном браузере — скачивание.
  let saved = false;
  try {
    const r = await fetch(`/api/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    saved = r.ok;
  } catch { /* нет локального сервера */ }
  if (!isFramed) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  return saved;
}

function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }

export async function snapshot() {
  updateCutaway();
  const blob = await pipe.capture(pipe.photo ? 512 : 0);
  if (!blob) return false;
  return saveBlob(blob, `kitchen-${stamp()}.png`);
}

export async function exportGLB() {
  const hidden = [];
  scene.traverse(o => { if ((o.userData.shadowOnly || o.userData.rasterOnly) && o.visible) { o.visible = false; hidden.push(o); } });   // следы пуль и обманки света — не в GLB
  const parts = [shell.group, floors, doorsGroup, kitchen.group, lamps?.fixtures, furn?.group, decor?.group, bath.group, scene.getObjectByName('fixtures')].filter(Boolean);
  const glb = await new GLTFExporter().parseAsync(parts, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
  hidden.forEach(o => { o.visible = true; });
  return saveBlob(new Blob([glb], { type: 'model/gltf-binary' }), `kitchen-${encode(state).split('~')[0]}.glb`);
}

// ---------- запуск ----------

let ui = null, walk = null, minimap = null, furnEditor = null, nav = null, doors = null, viewmodel = null, seats = null, tv = null, hunt = null;
registerFurnitureUI(addSection);
registerDecorUI(addSection);
registerViewmodelUI(addSection, () => viewmodel);
registerHuntUI(addSection, () => hunt);
registerSeatsUI(addSection, () => seats);
ui = initUI({ state, defaults: DEFAULT, setState, setSplit, goView, snapshot, exportGLB, setQuality, encode, decode, views: VIEWS, canExport: !isFramed, plan, kit, split: SPLIT, walk: () => walk });

// Прогулка WASD и мини-карта. Препятствия: кухня и остров (мебель добавится сюда же).
walk = initWalk({ THREE, camera, controls, canvas, plan, requestRender, getObstacles: () => [...walk.boxesOf(kitchen?.group), ...(furn?.colliders || []), ...bath.colliders, ...(decor?.colliders || []), ...(doors?.colliders() || [])],
  onChange: () => { if (walk.active && furnEditor?.enabled) { furnEditor.disable(); ui.info({ furnEdit: false }); } requestRender(); } });

// Двери открываются взглядом + E / кликом (doors.js); руки с оружием в прогулке (viewmodel.js)
doors = initDoors({ THREE, scene, camera, canvas, plan, M, doorsGroup, shell, walk, requestRender, onChange: () => { cutaway.rebuild(); lighting.invalidate(); } });   // дверь открыта или закрыта — свет из соседних зон пересчитать
// Охота: кабаны и птицы на поле за балконом, очки и таблица рекордов (hunt.js, spec/hunt.json)
hunt = createHunt({ THREE, scene, camera, renderer, pipe, requestRender, getState: () => state, getWalk: () => walk, plan, site });
viewmodel = createViewmodel({ THREE, scene, camera, renderer, pipe, canvas, requestRender, getDoors: () => doors, getSeats: () => seats, getWalk: () => walk, getHunt: () => hunt });
// ТВ всегда показывает YouTube (tv.js, spec/tv.json); сесть на унитаз, диван, стулья (seats.js)
tv = createTV({ THREE, scene, camera, renderer, canvas, pipe, getState: () => state, requestRender });
seats = createSeats({ THREE, scene, camera, canvas, controls, plan, bathSpec, walk, requestRender, getState: () => state,
  getFurniture: () => furn, getDecor: () => decor, getDoors: () => doors, getTV: () => tv });

// Редактор мебели: перетаскивание в 3D, размеры до острова и стены
furnEditor = createFurnitureEditor({ camera, renderer, scene, controls, getState: () => state, setState, requestRender, plan, kit });
ui.enable('furniture', 'sun', 'render');
ui.on('photo', on => { if (on) pipe.enterPhoto(); else pipe.exitPhoto(); requestRender(); });
pipe.onProgress((n, { phase, target }) => ui.info({ photo: { passes: n, target, phase, running: pipe.photo } }));
// Свободная камера как в 3D-редакторах: колесо к курсору, WASD/Q/E, вращение вокруг точки под курсором
nav = createNav({ THREE, camera, controls, canvas, scene, plan, requestRender,
  isWalking: () => !!walk?.active || !!seats?.active, raycastTargets: () => scene.children });
ui.on('furnEdit', on => { if (on) furnEditor.enable(); else furnEditor.disable(); ui.info({ furnEdit: on }); requestRender(); });
ui.on('furnReset', () => setState(furnitureResetPatch()));
const flyTo = (x, z) => {
  const t = new THREE.Vector3(x, controls.target.y, z);
  anim = { t0: performance.now(), dur: 700, from: { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov },
    to: { pos: camera.position.clone().add(t.clone().sub(controls.target)), target: t, fov: camera.fov } };
  requestRender();
};
minimap = initMinimap({ plan, getCamera: () => camera, onTeleport: (x, z) => (walk.active ? walk.enter({ x, z }) : flyTo(x, z)) });

const fromHash = decode(location.hash);
await setState({ ...(fromHash || {}) }, { push: !!fromHash });
goView('hall', true);
resize();
requestAnimationFrame(frame);

lighting.ready.then(() => ui.ready());
window.addEventListener('hashchange', () => { const s = decode(location.hash); if (s) setState(s, { push: false }); });

// Для автоматических проверок из консоли
window.__kitchen = { state, setState, setSplit, goView, snapshot, exportGLB, encode, decode, scene, camera, controls, renderer, shell, M, get floors() { return floors; }, requestRender, lighting, cutaway, pipe, get furnEditor() { return furnEditor; }, get decor() { return decor; }, get doors() { return doors; }, get viewmodel() { return viewmodel; }, get walk() { return walk; }, get seats() { return seats; }, get tv() { return tv; }, get hunt() { return hunt; } };
