// Обстановка комнат: прихожая, спальня, кабинет, стеллажи гостиной — реальные вещи (IKEA и др.), каждую можно
// убрать («Нет») или заменить другой. Каталог: web/spec/decor/index.json -> web/spec/decor/<zone>.json,
// модели и миниатюры web/models/decor/<zone>/<id>/ (контракт: web/models/decor/README.md, конвейер tools/decor/).
// Положения задаёт каталог (pos/rot), редактор мебели (furniture.js) их не двигает: убрать или заменить — опцией.
//
// DECOR_SCHEMA   — [[key, ids[]], …] поля кода варианта: key = d_<zone>_<slot>; порядок — зоны по index.json,
//                  слоты по порядку в файле зоны, опции по порядку в слоте. Это хвост SCHEMA_V3 в main.js:
//                  новые зоны, слоты и опции только в КОНЕЦ, ничего не переставлять и не удалять.
// DECOR_DEFAULTS — { key: id } из "default" слота (нет или неизвестен — первая опция, то есть «Нет»).
// DECOR_ZONES    — разобранный каталог (для проверок и консоли).
// buildDecor(state, plan, M) -> { group, colliders: [THREE.Box3], seats, ready: Promise }
//                  GLB грузятся лениво (только выбранные) и кешируются между пересборками.
//                  seats — [{ id, label, x, y, z, yaw }] места выбранных вещей с полем seat, в координатах квартиры:
//                  точка на сиденье, yaw — куда смотрит сидящий, радианы вокруг +Y (0 = +Z, как rot части).
// decorKey(state) -> строка; меняется только вместе с полями обстановки — тогда main.js пересобирает её.
// registerDecorUI(addSection) — по разделу на зону во вкладке «Мебель» (id decor-<zone>), в разделе по выбору
//                  товара на слот: миниатюра, имя, бренд, цена, размер, ссылка в магазин.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ---------- каталог ----------
// Файлы пишут несколько агентов одновременно: битый или отсутствующий файл зоны — зоны просто нет
// (перечитывается при перезагрузке страницы). no-cache — чтобы правка файла была видна сразу.
const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
const INDEX = await getJSON('spec/decor/index.json');
const ZONE_IDS = (Array.isArray(INDEX?.zones) ? INDEX.zones : []).filter(z => typeof z === 'string' && /^[a-z0-9]+$/.test(z));
const vec = (v, n) => (Array.isArray(v) && v.length === n && v.every(Number.isFinite) ? v : null);

// Место для сидения (seats.js): h — высота сиденья, depth — сдвиг от центра следа назад к спинке, label — подсказка.
const parseSeat = s => (Number.isFinite(s?.h) ? { h: s.h, depth: Number(s.depth) || 0, label: s.label || 'Сесть' } : null);

function parseOption(o) {
  if (!o?.id || typeof o.id !== 'string') return null;
  if (o.id === 'none') return { id: 'none', name: o.name || 'Нет', parts: [] };
  const parts = (Array.isArray(o.parts) ? o.parts : [])
    .map(p => (p?.model && vec(p.pos, 3)
      ? { model: p.model, pos: p.pos, rot: Number(p.rot) || 0, seat: parseSeat(p.seat), on: typeof p.on === 'string' ? p.on : null }
      : null)).filter(Boolean);
  // seat на опции — это место первой части (если у части нет своего)
  if (parts[0] && !parts[0].seat) parts[0].seat = parseSeat(o.seat);
  const size = vec(o.size, 3);
  // collide: false — опция не мешает ходить; иначе сталкивается каждая напольная часть по своей геометрии (см. FLOOR_Y)
  return { ...o, name: o.name || o.id, size, parts, collide: o.collide !== false };
}

function parseZone(zoneId, d) {
  if (!d || !Array.isArray(d.slots)) return null;
  const seen = new Set(), slots = [];
  for (const s of d.slots) {
    if (!s?.id || typeof s.id !== 'string' || seen.has(s.id)) continue;
    seen.add(s.id);
    const ids = new Set(), options = [];
    for (const o of (Array.isArray(s.options) ? s.options : []).map(parseOption)) {
      if (o && !ids.has(o.id)) { ids.add(o.id); options.push(o); }
    }
    if (!options.length) continue;
    slots.push({ id: s.id, label: s.label || s.id, key: `d_${zoneId}_${s.id}`, options,
      def: options.some(o => o.id === s.default) ? s.default : options[0].id });
  }
  return { id: zoneId, title: d.title || zoneId, room: d.room || zoneId, slots };
}

export const DECOR_ZONES = (await Promise.all(ZONE_IDS.map(z => getJSON(`spec/decor/${z}.json`))))
  .map((d, i) => parseZone(ZONE_IDS[i], d)).filter(z => z?.slots.length);
const SLOTS = DECOR_ZONES.flatMap(z => z.slots.map(s => ({ ...s, zone: z })));
export const DECOR_SCHEMA = SLOTS.map(s => [s.key, s.options.map(o => o.id)]);
export const DECOR_DEFAULTS = Object.fromEntries(SLOTS.map(s => [s.key, s.def]));

const optionOf = (slot, state) => slot.options.find(o => o.id === state?.[slot.key]) ?? slot.options.find(o => o.id === slot.def);

export function decorKey(state) {
  return SLOTS.map(s => optionOf(s, state).id).join('|');
}

// ---------- модели ----------
// GLB грузятся один раз (кеш по адресу); неудачную загрузку можно повторить при следующей пересборке.
let loader = null;
const GLB = new Map();
function loadGLB(url) {
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  if (!GLB.has(url)) {
    const p = loader.loadAsync(url).then(r => r.scene);
    p.catch(() => GLB.delete(url));
    GLB.set(url, p);
  }
  return GLB.get(url);
}

const rad = THREE.MathUtils.degToRad;
// Столкновения: каждая часть, стоящая на полу (основание ниже FLOOR_Y), по габариту загруженной модели;
// плоское (ковёр, ниже MIN_H) не мешает ходить. Так пара тумбочек, кресло и растение в одной опции сталкиваются все.
const FLOOR_Y = 0.3, MIN_H = 0.15;
function colliderOf(holder) {
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  return box.isEmpty() || box.max.y - box.min.y < MIN_H ? null : box;
}

// Не загрузилась модель — светлый короб по габариту, чтобы расстановка оставалась видна.
let stubMat = null;
function stub(o) {
  stubMat ??= new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.9 });
  const [w, h, d] = o.size ?? [0.3, 0.3, 0.3];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stubMat);
  m.position.y = h / 2;
  return m;
}

/**
 * Собрать обстановку по состоянию. plan и M — как у остальных модулей (здесь не нужны: всё в каталоге).
 * Возвращает { group, colliders, seats, ready }: ready — промис загрузки выбранных моделей (после него перерисовать кадр).
 */
export function buildDecor(state /* , plan, M */) {
  const group = new THREE.Group();
  group.name = 'decor';
  const colliders = [], seats = [], ready = [];
  for (const slot of SLOTS) {
    const o = optionOf(slot, state);
    if (!o.parts.length) continue;
    o.parts.forEach((p, i) => {
      // on: '<slot>' — часть стоит на вещи из другого слота той же зоны (лампа на тумбочке): та убрана — и её нет
      const base = p.on && slot.zone.slots.find(s => s.id === p.on);
      if (base && optionOf(base, state).id === 'none') return;
      if (p.seat) {
        const yaw = rad(p.rot);   // локальная -Z (к спинке) в мире: (-sin, -cos)
        seats.push({ id: `${slot.key}:${o.id}:${i}`, label: p.seat.label, yaw,
          x: p.pos[0] - Math.sin(yaw) * p.seat.depth, y: p.pos[1] + p.seat.h, z: p.pos[2] - Math.cos(yaw) * p.seat.depth });
      }
      const holder = new THREE.Group();
      holder.name = `${slot.key}_${o.id}${o.parts.length > 1 ? `_${i}` : ''}`;
      holder.position.fromArray(p.pos);
      holder.rotation.y = rad(p.rot);
      holder.userData = { decor: slot.key, zone: slot.zone.id, option: o.id };
      group.add(holder);
      const collide = () => {
        if (!o.collide || p.pos[1] >= FLOOR_Y) return;
        const box = colliderOf(holder);
        if (box) colliders.push(box);
      };
      const tag = obj => obj.traverse(m => {
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        m.userData.slot = slot.key;   // клик в 3D открывает этот выбор в панели (ui.focusSlot)
      });
      ready.push(loadGLB(p.model).then(tpl => {
        const inst = tpl.clone(true);
        tag(inst);
        holder.add(inst);
        collide();
      }).catch(err => {
        console.warn(`Обстановка ${slot.key}=${o.id}: модель ${p.model} не загрузилась, показан габарит`, err);
        if (i === 0) { const s = stub(o); tag(s); holder.add(s); collide(); }
      }));
    });
  }
  return { group, colliders, seats, ready: Promise.all(ready).then(() => undefined) };
}

// ---------- панель ----------

const fmtPrice = v => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} zł`;

// Слот = контрол products из ui.js: миниатюра, имя, бренд, размер, цена, ссылка; в подсказке отделка и артикул.
const productControl = slot => ({
  type: 'products', key: slot.key, label: slot.label, def: slot.def,
  options: slot.options.map(o => ({
    id: o.id, name: o.name, brand: o.brand, price_pln: o.price_pln, size: o.size ?? undefined, thumb: o.thumb, url: o.url,
    note: [o.finish, o.article && `арт. ${o.article}`, o.note].filter(Boolean).join(' · ') || undefined,
  })),
});

export function registerDecorUI(addSection) {
  DECOR_ZONES.forEach((z, i) => {
    const chosen = st => z.slots.map(s => optionOf(s, st)).filter(o => o.id !== 'none');
    addSection({
      id: `decor-${z.id}`, tab: 'furniture', feature: 'furniture', title: z.title, order: 60 + i,
      focus: z.slots.map(s => s.key),
      summary: st => {
        const list = chosen(st), sum = list.reduce((a, o) => a + (Number(o.price_pln) || 0), 0);
        return list.length ? `${list.length} шт. · ${fmtPrice(Math.round(sum))}` : 'пусто';
      },
      controls: z.slots.map(productControl),
    });
  });
}
