// Обстановка комнат: прихожая, спальня, кабинет, стеллажи гостиной, кухня, стена ТВ — реальные вещи (IKEA и др.),
// каждую можно убрать («Нет») или заменить другой. Каталог: web/spec/decor/index.json -> web/spec/decor/<zone>.json,
// модели и миниатюры web/models/decor/<zone>/<id>/ (контракт: web/models/decor/README.md, конвейер tools/decor/).
// Место по умолчанию задаёт каталог (pos/rot); каждую часть можно перетащить в редакторе мебели (furniture.js),
// сдвиги хранятся в state.moves (хвост ссылки после «~», формат ниже) и не трогают позиционный код SCHEMA_V3.
//
// DECOR_SCHEMA   — [[key, ids[]], …] поля кода варианта: key = d_<zone>_<slot>; порядок — зоны по index.json,
//                  слоты по порядку в файле зоны, опции по порядку в слоте. Это хвост SCHEMA_V3 в main.js:
//                  новые зоны, слоты и опции только в КОНЕЦ, ничего не переставлять и не удалять.
// DECOR_DEFAULTS — { key: id } из "default" слота (нет или неизвестен — первая опция, то есть «Нет») и moves: ''.
// DECOR_ZONES    — разобранный каталог (для проверок и консоли).
// buildDecor(state, plan, M, anchors?) -> { group, colliders: [THREE.Box3], seats, parts: Map<pkey, holder>, near, ready }
//                  GLB грузятся лениво (только выбранные) и кешируются между пересборками (клоны делят геометрию
//                  и материалы шаблона: пересборка не парсит GLB и не создаёт материалов).
//                  Зоны комнат первого вида (loading.js FIRST_ROOMS) грузятся сразу (near — их промис), остальные —
//                  после первого кадра (ready — всё).
//                  seats — [{ id, label, x, y, z, yaw, root }] места частей с полем seat, в координатах квартиры:
//                  точка на сиденье, yaw — куда смотрит сидящий (радианы вокруг +Y, 0 = +Z), root — часть сцены.
// placeDecor(decor, state, anchors?, { live }?) — только положения (сдвиги, опоры): без пересборки, без загрузок.
//                  live: true — во время перетаскивания, без пересчёта столкновений и мест (их обновит setState).
// updateDecor(decor, dt) -> bool — каждый кадр: вещи, доехавшие после первого вида, вырастают (true — нужен кадр).
// disposeDecor(decor) — освободить своё (геометрию габаритов-заглушек); геометрию шаблонов GLB не трогает.
// decorOf(group) -> результат buildDecor по группе 'decor'; decorPart(holder) -> сведения о части (для редактора).
// setDecorPose(decor, holder, x, y, z, yaw) — поставить часть (редактор, во время перетаскивания); то, что на ней
//                  стоит (книги на полке, лампа на тумбочке), едет следом.
// commitDecorPart(decor, holder, moves, on?) -> новая строка moves с текущим положением части.
//                  on — на чём она теперь стоит: pkey другой части, id опоры (console|tv|island|table|sofa), '0' — ни на чём;
//                  не задано — как было.
// resetDecorPart(moves, pkey) -> moves без этой части. normalizeMoves(str) -> чистая строка (для decode).
// decorKey(state) -> строка; меняется только вместе с выбором опций — тогда main.js пересобирает обстановку.
// decorSeason(dateISO) -> 'summer' | 'winter' — сезон по дате; sceneSeason(state) — с учётом выбора владельца
//                  state.balconySeason ('auto' | 'summer' | 'winter', варианты SEASON_OPTIONS).
// registerDecorUI(addSection) — по разделу на зону во вкладке «Мебель» (id decor-<zone>), в разделе по выбору
//                  товара на слот: миниатюра, имя, бренд, цена, размер, ссылка в магазин; у балкона сверху «Сезон».
// Поля-настройки в файлах зон ({ "id", "field" }) — места в коде варианта для полей сцены, см. FIELDS ниже.
//
// Опоры (anchor на части): "console" | "tv" | "island" | "table" | "sofa". pos/rot части — абсолютные для положения
// этой вещи ПО УМОЛЧАНИЮ; сдвинули вещь (ползунки, редактор, остров ползунками кухни) — часть едет следом.
// anchors = furnitureAnchors(...) из furniture.js: { <id>: { cur, def } | null }, кадр = { x, y, z, r } (r — yaw).
// null — вещи сейчас нет (без тумбы): часть на ней не показывается. anchors не передан — опоры не применяются.
// span { z0, z1 } у опоры (ТВ, тумба) — концы стены: часть, что вылезла бы за них, не показывается.
// Носитель: часть, стоящая на другой части или в ней (книги в стеллаже, постель на матрасе, лампа на тумбочке —
// по габаритам моделей в положении по умолчанию), едет вместе с ней. Перетащили на другую полку или вещь —
// носитель меняется (поле on записи сдвига).
//
// Сезон (season на части): "summer" | "winter" — часть видна только в этот сезон сцены: sceneSeason(state) —
// «Лето»/«Зима» по выбору (state.balconySeason) или «По дате» (по умолчанию, decorSeason(state.sunDate):
// ноябрь–март — зима, апрель–октябрь — лето). Модели обоих сезонов грузятся при сборке, смена даты только
// (и смена выбора) прячет/показывает части в placeDecor (main.js уже зовёт его из setState): без пересборки, без загрузок, без шейдеров;
// спрятанная часть не сталкивается и не даёт места. decorKey сезон не включает. Сдвиги и носители работают как обычно.
//
// Код сдвигов (state.moves): записи через '~', отсортированы по ключу; запись = <pkey>_<dx>_<dz>_<dy>_<dr>_<on>,
// pkey = <zone>.<slot>.<option>.<номер части>; dx, dz, dy — мм, dr — градусы, целые в base36 со знаком;
// хвостовые нули и пустое on опускаются. Сдвиг — в «раскладке по умолчанию»: в координатах квартиры, как если бы
// носитель или опора стояли на своём месте по умолчанию. Неизвестные ключи (опция удалена) безвредно лежат в строке.
import * as THREE from 'three';
import { assignNetworkObjectIds } from './network-objects.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assetUrl, track, retry, afterRoom, isRoomReady, FIRST_ROOMS, inFirstView } from './loading.js';   // сначала комнаты первого вида, остальное фоном
import { LAMP_OPTIONS, LAMP_DEFAULTS, useDecorZones } from './lamps.js';   // поле hallGlow (FIELDS), подсветка вещей прихожей

// ---------- каталог ----------
// Файлы пишут несколько агентов одновременно: битый или отсутствующий файл зоны — зоны просто нет
// (перечитывается при перезагрузке страницы). Свежесть — заголовками сервера (serve.py no-store, Vercel перепроверяет),
// без cache: 'no-cache' в запросе: так он совпадает с <link rel=preload> сборки (tools/build_static.mjs).
// Сетевой сбой — до трёх попыток: пропавшая зона сдвинула бы поля всех следующих зон в коде варианта.
async function getJSON(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch { /* обрыв соединения — повторить */ }
    await new Promise(res => setTimeout(res, 300 * (i + 1)));
  }
  return null;
}
const INDEX = await getJSON('spec/decor/index.json');
const ZONE_IDS = (Array.isArray(INDEX?.zones) ? INDEX.zones : []).filter(z => typeof z === 'string' && /^[a-z0-9]+$/.test(z));
const vec = (v, n) => (Array.isArray(v) && v.length === n && v.every(Number.isFinite) ? v : null);

export const ANCHORS = ['console', 'tv', 'island', 'table', 'sofa'];
const MOUNTS = ['floor', 'wall', 'surface'];
// Сезон части по дате сцены: ноябрь–март — 'winter', апрель–октябрь — 'summer' (нет даты — по сегодняшней).
const SEASONS = ['summer', 'winter'];
export function decorSeason(dateISO) {
  const m = Number(String(dateISO ?? '').slice(5, 7)) || new Date().getMonth() + 1;
  return m >= 11 || m <= 3 ? 'winter' : 'summer';
}
// Выбор владельца (state.balconySeason): 'auto' — по дате сцены, 'summer' | 'winter' — всегда этот сезон.
export const SEASON_OPTIONS = [
  { id: 'auto', name: 'По дате' }, { id: 'summer', name: 'Лето' }, { id: 'winter', name: 'Зима' },
];
/** Сезон частей с полем season для этого состояния: выбор владельца или по дате сцены. */
export const sceneSeason = state => (SEASONS.includes(state?.balconySeason) ? state.balconySeason : decorSeason(state?.sunDate));

// Поля-настройки (не товары) в файлах зон: слот { "id", "field": "<ключ состояния>" } только держит МЕСТО поля
// в коде варианта (порядок слотов = порядок полей), варианты и значение по умолчанию — здесь, у владельца поля.
// Зачем: хвост SCHEMA_V3 — обстановка, а она растёт; новое поле сцены дописывается СЛОТОМ В КОНЕЦ ПОСЛЕДНЕЙ ЗОНЫ
// (сейчас balcony.json, его пишет tools/decor/balcony/compose.py), тогда старые ссылки читаются как раньше.
// Не товар: не входит в decorKey (смена не пересобирает обстановку) и не рисуется карточками.
// Слот с полем, которого нет в FIELDS, всё равно занимает своё место (иначе съехали бы поля после него).
const FIELDS = {
  balconySeason: { options: SEASON_OPTIONS, def: 'auto' },
  hallGlow: { options: LAMP_OPTIONS.hallGlow, def: LAMP_DEFAULTS.hallGlow },
};

// Место для сидения (seats.js): h — высота сиденья, depth — сдвиг от центра следа назад к спинке, label — подсказка.
const parseSeat = s => (Number.isFinite(s?.h) ? { h: s.h, depth: Number(s.depth) || 0, label: s.label || 'Сесть' } : null);

function parseOption(o) {
  if (!o?.id || typeof o.id !== 'string') return null;
  if (o.id === 'none') return { id: 'none', name: o.name || 'Нет', parts: [] };
  const parts = (Array.isArray(o.parts) ? o.parts : [])
    .map(p => (p?.model && vec(p.pos, 3)
      ? { model: p.model, pos: p.pos, rot: Number(p.rot) || 0, seat: parseSeat(p.seat), on: typeof p.on === 'string' ? p.on : null,
        anchor: ANCHORS.includes(p.anchor) ? p.anchor : null, mount: MOUNTS.includes(p.mount) ? p.mount : null,
        season: SEASONS.includes(p.season) ? p.season : null, seatTarget: p.seatTarget === true }
      : null)).filter(Boolean);
  // seat на опции — это место первой части (если у части нет своего)
  if (parts[0] && !parts[0].seat) parts[0].seat = parseSeat(o.seat);
  const size = vec(o.size, 3);
  // collide: false — опция не мешает ходить; иначе сталкивается каждая напольная часть по своей геометрии (см. FLOOR_Y)
  return { ...o, name: o.name || o.id, size, parts, collide: o.collide !== false };
}

function parseZone(zoneId, d) {
  if (!d || !Array.isArray(d.slots)) return null;
  const seen = new Set(), slots = [], seq = [];   // seq — поля кода в порядке файла: слоты-товары и поля-настройки
  for (const s of d.slots) {
    if (!s?.id || typeof s.id !== 'string' || seen.has(s.id)) continue;
    seen.add(s.id);
    if (typeof s.field === 'string') {
      seq.push({ field: s.field, ids: (FIELDS[s.field]?.options ?? []).map(o => o.id) });
      continue;
    }
    const ids = new Set(), options = [];
    for (const o of (Array.isArray(s.options) ? s.options : []).map(parseOption)) {
      if (o && !ids.has(o.id)) { ids.add(o.id); options.push(o); }
    }
    if (!options.length) continue;
    const slot = { id: s.id, label: s.label || s.id, key: `d_${zoneId}_${s.id}`, options,
      def: options.some(o => o.id === s.default) ? s.default : options[0].id };
    slots.push(slot); seq.push(slot);
  }
  return { id: zoneId, title: d.title || zoneId, room: d.room || zoneId, slots, fields: seq.filter(e => e.field).map(e => e.field), seq };
}

export const DECOR_ZONES = (await Promise.all(ZONE_IDS.map(z => getJSON(`spec/decor/${z}.json`))))
  .map((d, i) => parseZone(ZONE_IDS[i], d)).filter(z => z?.seq.length);
const SLOTS = DECOR_ZONES.flatMap(z => z.slots.map(s => ({ ...s, zone: z })));
useDecorZones(DECOR_ZONES);   // lamps.js: подсветка под вещами прихожей (поле glow опции) — до первой сборки светильников
export const DECOR_SCHEMA = DECOR_ZONES.flatMap(z => z.seq.map(e => (e.field ? [e.field, e.ids] : [e.key, e.options.map(o => o.id)])));
// moves — сдвиги частей (не поле SCHEMA_V3: main.js пишет его хвостом ссылки после «~»).
// Поля-настройки по умолчанию — всегда (даже если слот поля пропал из файла зоны).
export const DECOR_DEFAULTS = {
  ...Object.fromEntries(SLOTS.map(s => [s.key, s.def])),
  ...Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.def])),
  moves: '',
};

const optionOf = (slot, state) => slot.options.find(o => o.id === state?.[slot.key]) ?? slot.options.find(o => o.id === slot.def);

export function decorKey(state) {
  return SLOTS.map(s => optionOf(s, state).id).join('|');
}

// ---------- сдвиги: разбор и запись ----------

const PKEY = /^[a-z0-9]+\.[a-z0-9-]+\.[a-z0-9-]+\.\d{1,3}$/;
const MAX_MOVES = 600;
const b36 = n => (n ? n.toString(36) : '0');
// Строка -> Map<pkey, { dx, dz, dy, dr, on }> (мм, мм, мм, градусы; on — undefined | '0' | pkey | id опоры).
// Последний разбор кешируется: placeDecor зовётся на каждом шаге ползунка.
let parsedFor = null, parsed = new Map();
function parseMoves(str) {
  str = typeof str === 'string' ? str : '';
  if (str === parsedFor) return parsed;
  const out = new Map();
  for (const rec of str.split('~')) {
    if (out.size >= MAX_MOVES) break;
    const [key, ...f] = rec.split('_');
    if (!PKEY.test(key) || f.length > 5) continue;
    const n = f.slice(0, 4).map(v => (v === '' || v == null ? 0 : parseInt(v, 36)));
    if (!n.every(v => Number.isInteger(v) && Math.abs(v) < 1e5) || f.slice(0, 4).some(v => v && !/^-?[0-9a-z]+$/.test(v))) continue;
    const on = f[4];
    out.set(key, { dx: n[0] || 0, dz: n[1] || 0, dy: n[2] || 0, dr: n[3] || 0,
      on: on === '0' || ANCHORS.includes(on) || PKEY.test(on ?? '') ? on : undefined });
  }
  parsedFor = str; parsed = out;
  return out;
}
function serializeMoves(map) {
  const recs = [];
  for (const [k, m] of [...map].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const f = [m.dx, m.dz, m.dy, m.dr].map(b36);
    if (m.on) f.push(m.on);
    else while (f.length && f[f.length - 1] === '0') f.pop();
    if (f.length) recs.push([k, ...f].join('_'));
  }
  return recs.join('~');
}
export const normalizeMoves = str => serializeMoves(parseMoves(str));
export function resetDecorPart(moves, pkey) {
  const m = new Map(parseMoves(moves));
  m.delete(pkey);
  return serializeMoves(m);
}

// ---------- модели ----------
// Мелочь в кадре первого вида грузится после него (LOAD): заставка ждёт мебель, а не рейлинг с ложками и картины.
const SMALL_FIRST_M = 0.7;
const smallOption = o => Array.isArray(o.size) && o.size.length === 3
  && (Math.max(...o.size) < SMALL_FIRST_M || (Math.min(...o.size) < 0.06 && Math.max(...o.size) < 1));   // картина: плоская и не огромная

// GLB грузятся один раз (кеш по адресу); неудачную загрузку можно повторить при следующей пересборке.
let loader = null;
const GLB = new Map();
function loadGLB(url, label) {   // label — подпись на экране загрузки (название зоны)
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  if (!GLB.has(url)) {
    const p = track(retry(() => loader.loadAsync(assetUrl(url))), { label, url }).then(r => r.scene);
    p.catch(() => GLB.delete(url));
    GLB.set(url, p);
  }
  return GLB.get(url);
}

const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
// Столкновения: каждая часть, стоящая на полу (основание ниже FLOOR_Y), по габариту загруженной модели;
// плоское (ковёр, ниже MIN_H) не мешает ходить. Так пара тумбочек, кресло и растение в одной опции сталкиваются все.
const FLOOR_Y = 0.3, MIN_H = 0.15;

// Не загрузилась модель — светлый короб по габариту, чтобы расстановка оставалась видна.
let stubMat = null;
function stub(o) {
  stubMat ??= new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.9 });
  const [w, h, d] = o.size ?? [0.3, 0.3, 0.3];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stubMat);
  m.position.y = h / 2;
  m.userData.decorStub = true;
  return m;
}

// ---------- кадры: положение { x, y, z, r } ----------
// Поза L в раскладке «носитель на месте по умолчанию (def)» -> в мир при носителе в cur, и обратно.
// Поворот вокруг Y как у three: x' = x cos + z sin, z' = −x sin + z cos.
function toFrame(out, L, cur, def) {
  const a = cur.r - def.r, c = Math.cos(a), s = Math.sin(a), dx = L.x - def.x, dz = L.z - def.z;
  out.x = cur.x + dx * c + dz * s; out.z = cur.z - dx * s + dz * c; out.y = L.y - def.y + cur.y; out.r = L.r + a;
  return out;
}
function fromFrame(out, W, cur, def) {
  const a = cur.r - def.r, c = Math.cos(a), s = Math.sin(a), dx = W.x - cur.x, dz = W.z - cur.z;
  out.x = def.x + dx * c - dz * s; out.z = def.z + dx * s + dz * c; out.y = W.y - cur.y + def.y; out.r = W.r - a;
  return out;
}
const frame = () => ({ x: 0, y: 0, z: 0, r: 0 });

// Сведения о частях — не в userData (его пишет GLTFExporter, ссылки на объекты там нельзя).
const PART = new WeakMap();
const RESULTS = new WeakMap();
export const decorPart = holder => PART.get(holder) || null;
export const decorOf = group => (group ? RESULTS.get(group) || null : null);

/**
 * Собрать обстановку по состоянию. plan и M — как у остальных модулей (здесь не нужны: всё в каталоге).
 * anchors — furnitureAnchors(...) из furniture.js (необязательно). Возвращает { group, colliders, seats, parts, ready }:
 * ready — промис загрузки выбранных моделей (после него перерисовать кадр).
 */
export function buildDecor(state, plan, M, anchors) {
  const group = new THREE.Group();
  group.name = 'decor';
  const decor = { group, colliders: [], seats: [], parts: new Map(), holders: [], ready: null, pass: 0, state, anchors, grow: [] };
  RESULTS.set(group, decor);
  const loads = [], near = [];
  for (const slot of SLOTS) {
    const o = optionOf(slot, state);
    if (!o.parts.length) continue;
    o.parts.forEach((p, i) => {
      // on: '<slot>' — часть стоит на вещи из другого слота той же зоны (лампа на тумбочке): та убрана — и её нет
      const base = p.on && slot.zone.slots.find(s => s.id === p.on);
      if (base && optionOf(base, state).id === 'none') return;
      const holder = new THREE.Group();
      holder.name = `${slot.key}_${o.id}${o.parts.length > 1 ? `_${i}` : ''}`;
      holder.userData = { decor: slot.key, zone: slot.zone.id, option: o.id };
      const pkey = `${slot.zone.id}.${slot.id}.${o.id}.${i}`;
      const info = {
        pkey, slot, option: o, index: i, onSlot: base ? base.id : null,
        label: `${slot.label}: ${o.name}${o.parts.length > 1 ? ` · часть ${i + 1}` : ''}`,
        base: { x: p.pos[0], y: p.pos[1], z: p.pos[2], r: rad(p.rot) },
        anchor: p.anchor, mount: p.mount ?? (p.pos[1] < 0.02 ? 'floor' : null), seat: p.seat, season: p.season,
        collide: o.collide, box: null, wbox: new THREE.Box3(),
        defOn: p.anchor ?? undefined,          // носитель по умолчанию: часть (pkey) или опора; уточняется после загрузки
        L: frame(), cur: frame(), carrier: null, deps: [], pass: -1, busy: false, hidden: false,
      };
      PART.set(holder, info);
      decor.parts.set(pkey, holder);
      decor.holders.push(holder);
      group.add(holder);
      const tag = obj => obj.traverse(m => {
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        m.userData.slot = slot.key;   // клик в 3D открывает этот выбор в панели (ui.focusSlot)
      });
      const attach = obj => {
        assignNetworkObjectIds(obj, `decor:${pkey}`);
        tag(obj);
        obj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(obj);   // ещё не в сцене: габарит в координатах части
        info.box = box.isEmpty() ? null : box;
        holder.add(obj);
        updateBox(holder, info);
        if (isRoomReady()) { decor.grow.push({ obj, s: obj.scale.clone(), t: 0 }); obj.scale.multiplyScalar(GROW_FROM); }   // после первого вида — вырастает
      };
      // В кадре первого вида (его комнаты и поле зрения стартовой камеры) — сразу, кроме мелочи (models/decor/props:
      // книги, вазы, растения; и вся опция меньше SMALL_FIRST_M или плоская картина) — она после первого кадра
      // и вырастает на месте (updateDecor); остальное — после первого кадра
      const sz = i === 0 && o.size ? o.size : [1.2, 1.2, 1.2];
      const first = !p.model.includes('/props/') && !smallOption(o) && FIRST_ROOMS.has(slot.zone.room)
        && inFirstView(p.pos[0], p.pos[1] + sz[1] / 2, p.pos[2], Math.hypot(...sz) / 2);
      const label = slot.zone.title;
      const load = (first ? loadGLB(p.model, label) : afterRoom(() => loadGLB(p.model, label))).then(tpl => attach(tpl.clone(true))).catch(err => {
        console.warn(`Обстановка ${slot.key}=${o.id}: модель ${p.model} не загрузилась, показан габарит`, err);
        if (i === 0) attach(stub(o));
      });
      loads.push(load);
      if (first) near.push(load);
    });
  }
  placeDecor(decor, state, anchors);
  // Модели на месте: найти носителей по габаритам и расставить ещё раз (с последними state и опорами).
  // near — комнаты первого вида (носители ищутся внутри зоны, поэтому их можно найти раньше остальных), ready — всё.
  const settle = () => { findCarriers(decor); placeDecor(decor, decor.state, decor.anchors); };
  decor.near = Promise.all(near).then(settle);
  decor.ready = Promise.all(loads).then(settle);
  return decor;
}

// Носитель по умолчанию: самая маленькая часть, в чьём габарите (в положении по умолчанию) стоит основание этой.
// Кандидаты — части той же опции и слота из on; без своей опоры — любые части зоны. Основание носителя строго ниже.
// Сезонная часть носит только части своего сезона.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
function findCarriers(decor) {
  const defBox = new Map();
  for (const h of decor.holders) {
    const i = PART.get(h);
    if (!i.box) continue;
    _m.compose(_p.set(i.base.x, i.base.y, i.base.z), _q.setFromAxisAngle(_up, i.base.r), _s);
    defBox.set(h, i.box.clone().applyMatrix4(_m));
  }
  const vol = b => (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
  for (const h of decor.holders) {
    const i = PART.get(h), b = i.base;
    if (b.y < 0.02) continue;
    let best = null, bv = Infinity;
    for (const [c, box] of defBox) {
      const ci = PART.get(c);
      if (c === h || ci.base.y >= b.y - 0.005 || ci.slot.zone !== i.slot.zone) continue;
      if (ci.season && ci.season !== i.season) continue;   // летняя вещь не носит зимнюю: спрятана — спрятала бы и её
      const near = ci.option === i.option || (i.onSlot && ci.slot.id === i.onSlot);
      if (!near && i.anchor) continue;
      if (b.x < box.min.x - 0.01 || b.x > box.max.x + 0.01 || b.z < box.min.z - 0.01 || b.z > box.max.z + 0.01) continue;
      if (b.y < box.min.y + 0.005 || b.y > box.max.y + 0.03) continue;
      const v = vol(box);
      if (v < bv) { bv = v; best = c; }
    }
    if (best) {
      i.defOn = PART.get(best).pkey;
      if (!i.mount) i.mount = 'surface';
    } else if (i.anchor && !i.mount) i.mount = 'surface';
  }
}

// Мировой габарит части (для столкновений и рамки выделения).
function updateBox(holder, info) {
  if (!info.box) return;
  holder.updateMatrix();
  info.wbox.copy(info.box).applyMatrix4(holder.matrix);   // группа decor в начале координат, без поворота
}

// Поза части: раскладка L = каталог + сдвиг, затем носитель (часть) или опора (вещь мебели, остров).
function resolve(decor, holder, moves, anchors) {
  const i = PART.get(holder);
  if (i.pass === decor.pass) return i;
  if (i.busy) return null;                 // цикл носителей — эту связь не использовать
  i.busy = true;
  const m = moves.get(i.pkey), b = i.base, L = i.L;
  L.x = b.x + (m ? m.dx / 1000 : 0); L.z = b.z + (m ? m.dz / 1000 : 0);
  L.y = b.y + (m ? m.dy / 1000 : 0); L.r = b.r + (m ? rad(m.dr) : 0);
  const on = m?.on ?? i.defOn;
  i.carrier = null; i.hidden = false;
  let placed = false;
  if (on && on.includes('.')) {
    const c = decor.parts.get(on), ci = c && c !== holder ? resolve(decor, c, moves, anchors) : null;
    if (ci) { toFrame(i.cur, L, ci.cur, ci.base); i.carrier = c; i.hidden = ci.hidden; ci.deps.push(holder); placed = true; }
  } else if (on && on !== '0' && anchors) {
    const a = anchors[on];
    if (a === null) i.hidden = true;       // опоры сейчас нет (без тумбы): и вещи на ней нет
    else if (a?.cur && a?.def) { toFrame(i.cur, L, a.cur, a.def); placed = true; if (a.span && outOfSpan(i, a.span)) i.hidden = true; }
  }
  if (!placed) { i.cur.x = L.x; i.cur.y = L.y; i.cur.z = L.z; i.cur.r = L.r; }
  if (i.season && i.season !== decor.season) i.hidden = true;   // не тот сезон — и то, что на ней, тоже
  i.busy = false; i.pass = decor.pass;
  return i;
}
// Габарит части по мировой Z (стена ТВ идёт вдоль Z) за пределами [z0, z1] — с допуском 1 см.
function outOfSpan(i, sp) {
  const b = i.box;
  if (!b || b.isEmpty()) return false;
  const s = Math.sin(i.cur.r), c = Math.cos(i.cur.r);
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, hx = (b.max.x - b.min.x) / 2, hz = (b.max.z - b.min.z) / 2;
  const z = i.cur.z - cx * s + cz * c, e = hx * Math.abs(s) + hz * Math.abs(c);
  return z - e < sp.z0 - 0.01 || z + e > sp.z1 + 0.01;
}
function applyPose(holder, i) {
  holder.position.set(i.cur.x, i.cur.y, i.cur.z);
  holder.rotation.set(0, i.cur.r, 0);
  holder.visible = !i.hidden;
  updateBox(holder, i);
}

/** Расставить уже собранную обстановку по state.moves и опорам. Геометрию и материалы не трогает. */
export function placeDecor(decor, state, anchors, { live = false } = {}) {
  if (!decor?.holders) return decor;
  decor.state = state;
  decor.season = sceneSeason(state);   // выбор «Лето»/«Зима» или по дате: только прячет и показывает части
  if (anchors !== undefined) decor.anchors = anchors;
  const moves = parseMoves(state?.moves);
  decor.pass++;
  for (const h of decor.holders) PART.get(h).deps.length = 0;
  for (const h of decor.holders) applyPose(h, resolve(decor, h, moves, decor.anchors));
  if (!live) collect(decor);
  return decor;
}

// Столкновения и места — по текущим положениям видимых частей.
function collect(decor) {
  const colliders = [], seats = [];
  for (const h of decor.holders) {
    const i = PART.get(h);
    if (i.hidden) continue;
    if (i.collide && i.box && i.cur.y < FLOOR_Y && i.wbox.max.y - i.wbox.min.y >= MIN_H) colliders.push(i.wbox);
    if (i.seat) {
      const yaw = i.cur.r;   // локальная −Z (к спинке) в мире: (−sin, −cos)
      seats.push({ id: `${i.slot.key}:${i.option.id}:${i.index}`, label: i.seat.label, yaw, root: h,
        x: i.cur.x - Math.sin(yaw) * i.seat.depth, y: i.cur.y + i.seat.h, z: i.cur.z - Math.cos(yaw) * i.seat.depth });
    }
  }
  decor.colliders = colliders;
  decor.seats = seats;
}

/** Во время перетаскивания: поставить часть в мир и подвинуть всё, что на ней стоит. Без выделения памяти. */
export function setDecorPose(decor, holder, x, y, z, yaw) {
  const i = PART.get(holder);
  if (!i) return;
  i.cur.x = x; i.cur.y = y; i.cur.z = z; i.cur.r = yaw;
  applyPose(holder, i);
  carry(i);
}
function carry(i) {
  for (const d of i.deps) {
    const di = PART.get(d);
    toFrame(di.cur, di.L, i.cur, i.base);
    applyPose(d, di);
    carry(di);
  }
}

/**
 * Записать текущее положение части в строку сдвигов. on — новый носитель (pkey | id опоры | '0'),
 * undefined — прежний. Возвращает новую строку для state.moves.
 */
export function commitDecorPart(decor, holder, moves, on) {
  const i = PART.get(holder);
  if (!i) return moves;
  const map = new Map(parseMoves(moves)), old = map.get(i.pkey);
  const target = on === undefined ? (old?.on ?? i.defOn) : on;
  const W = { x: holder.position.x, y: holder.position.y, z: holder.position.z, r: i.cur.r }, L = frame();
  const c = target && target.includes('.') ? decor.parts.get(target) : null, ci = c && PART.get(c);
  const a = target && !target.includes('.') && target !== '0' ? decor.anchors?.[target] : null;
  if (ci && c !== holder) fromFrame(L, W, ci.cur, ci.base);
  else if (a?.cur && a?.def) fromFrame(L, W, a.cur, a.def);
  else Object.assign(L, W);
  const wrap = v => Math.atan2(Math.sin(v), Math.cos(v));
  const rec = {
    dx: Math.round((L.x - i.base.x) * 1000), dz: Math.round((L.z - i.base.z) * 1000), dy: Math.round((L.y - i.base.y) * 1000),
    dr: Math.round(deg(wrap(L.r - i.base.r))),
    on: (target ?? '0') === (i.defOn ?? '0') ? undefined : (target ?? '0'),
  };
  if (!rec.dx && !rec.dz && !rec.dy && !rec.dr && !rec.on) map.delete(i.pkey); else map.set(i.pkey, rec);
  return serializeMoves(map);
}
/** Сдвинута ли часть (есть запись в moves). */
export const isDecorMoved = (moves, pkey) => parseMoves(moves).has(pkey);

/** Освободить своё: только геометрию заглушек. Шаблоны GLB общие для всех пересборок — их не трогать. */
// Вещь, доехавшая после первого вида, вырастает за GROW_S (масштаб от GROW_FROM): без смены материалов и шейдеров.
const GROW_S = 0.35, GROW_FROM = 0.01;
/** Каждый кадр (main.js): true — что-то ещё растёт, нужен новый кадр. */
export function updateDecor(decor, dt) {
  if (!decor?.grow?.length) return false;
  decor.grow = decor.grow.filter(g => {
    g.t = Math.min(1, g.t + dt / GROW_S);
    const k = 1 - Math.pow(1 - g.t, 3);
    g.obj.scale.copy(g.s).multiplyScalar(GROW_FROM + (1 - GROW_FROM) * k);
    return g.t < 1;
  });
  return true;
}

export function disposeDecor(decor) {
  decor?.group?.traverse(o => { if (o.userData.decorStub) o.geometry?.dispose(); });
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

// Сезон обстановки (поле balconySeason): сегмент «По дате / Лето / Зима» и строка, во что сейчас превращается «По дате».
// Смена — обычный setState: placeDecor прячет и показывает части, без пересборки и загрузок.
const SEASON_NAME = { summer: 'лето', winter: 'зима' };
const seasonControls = () => [
  { type: 'seg', key: 'balconySeason', label: 'Сезон', def: 'auto', options: SEASON_OPTIONS },
  { type: 'readout', key: 'balconySeasonInfo', style: 'hint', value: st => ((st.balconySeason ?? 'auto') === 'auto'
    ? `По дате · сейчас ${SEASON_NAME[decorSeason(st.sunDate)]}`
    : `Всегда ${SEASON_NAME[st.balconySeason] ?? ''}, дата сцены не влияет`) },
];

export function registerDecorUI(addSection) {
  DECOR_ZONES.forEach((z, i) => {
    if (!z.slots.length) return;   // зона только с полями-настройками — своего раздела нет
    const chosen = st => z.slots.map(s => optionOf(s, st)).filter(o => o.id !== 'none');
    const season = z.fields.includes('balconySeason');
    addSection({
      id: `decor-${z.id}`, tab: 'furniture', feature: 'furniture', title: z.title, order: 60 + i,
      focus: [...(season ? ['balconySeason'] : []), ...z.slots.map(s => s.key)],
      summary: st => {
        const list = chosen(st), sum = list.reduce((a, o) => a + (Number(o.price_pln) || 0), 0);
        const base = list.length ? `${list.length} шт. · ${fmtPrice(Math.round(sum))}` : 'пусто';
        return season ? `${base} · ${SEASON_NAME[sceneSeason(st)]}` : base;
      },
      controls: [...(season ? seasonControls() : []), ...z.slots.map(productControl)],
    });
  });
}
