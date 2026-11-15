// Мебель гостиной: диван, телевизор, тумба, ковёр, журнальный столик и редактор прямо в сцене.
// Размеры и стартовое состояние — web/spec/furniture.json. Диваны — реальные модели (GLB) из web/spec/sofas.json,
// ковры — из web/spec/rugs.json; без каталогов работает запасной процедурный диван и однотонный ковёр.
// Оси как везде: X вдоль окон, Z вглубь, Y вверх, метры. Состояние — поля FURN_SCHEMA + FURN_SCHEMA_2,
// позиции в метрах и градусах, округлённые до см и градуса.
// Редактор расстановки (createFurnitureEditor) двигает и эту мебель, и любую часть обстановки (decor.js):
// сдвиги обстановки он пишет в state.moves. furnitureAnchors(...) — где сейчас тумба, ТВ, столик, диван и остров
// относительно их мест по умолчанию: по ним decor.js двигает вещи с полем anchor.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { applyItem, loadMeta } from './materials.js';
import { islandBox } from './model.js';
import { tvPosterTexture } from './tv.js';
import { decorOf, decorPart, placeDecor, setDecorPose, commitDecorPart, resetDecorPart, isDecorMoved } from './decor.js';

// Спеки грузятся сами (как в main.js — относительно страницы). Нет файла — нет и того, что в нём; приложение живёт.
const getJSON = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
const [specJSON, sofasJSON, rugsJSON, kitJSON] = await Promise.all(
  ['spec/furniture.json', 'spec/sofas.json', 'spec/rugs.json', 'spec/kitchen.json'].map(getJSON));
export const FURN_SPEC = specJSON;
// Каталоги: порядок записей задаёт номер в коде ссылки — новые модели только в конец файла.
export const SOFA_CATALOG = (sofasJSON?.sofas ?? []).filter(e => e?.id && e.model && e.size?.w && e.size?.d);
export const RUG_CATALOG = (rugsJSON?.rugs ?? []).filter(e => e?.id && e.sizes?.length);
// meta.json ковра решает раскладку текстуры: whole — один раз на весь ковёр, size/sizeV — плитка в метрах.
const rugTexId = e => (e?.tex ? String(e.tex).replace(/^textures\//, '').replace(/\/+$/, '') : null);
const RUG_META = new Map(await Promise.all(RUG_CATALOG.map(async e => [e.id, rugTexId(e) ? await loadMeta(rugTexId(e)) : null])));

// ---------- варианты ----------
// Номер варианта в коде ссылки = индекс в списке: новые варианты только в конец списка.

export const FURN_OPTIONS = {
  sofa: [
    { id: 'straight3',   name: 'Прямой, 3 места' },
    { id: 'straight2',   name: 'Прямой, 2 места' },
    { id: 'corner-l',    name: 'Угловой, оттоманка слева' },
    { id: 'corner-r',    name: 'Угловой, оттоманка справа' },
    { id: 'modular-low', name: 'Низкий модульный' },
    { id: 'none',        name: 'Без дивана' },
  ],
  // normal — процедурная фактура (см. fabricNormal), tile — её повтор в метрах
  sofaFabric: [
    { id: 'boucle-white',      name: 'Букле белое',       color: '#ebe6dc', rough: 0.95, sheen: 0.7, sheenRough: 0.8,  sheenColor: '#ffffff', normal: 'boucle',  tile: 0.08, ns: 0.9,  legs: 'oak' },
    { id: 'linen-sand',        name: 'Лён песочный',      color: '#c9b89a', rough: 0.9,  sheen: 0.5, sheenRough: 0.6,  sheenColor: '#f2e8d6', normal: 'weave',   tile: 0.05, ns: 0.45, legs: 'oak' },
    { id: 'felt-grey',         name: 'Серый фетр',        color: '#8b8c8a', rough: 0.95, sheen: 0.4, sheenRough: 0.8,  sheenColor: '#cfcfcc', normal: 'felt',    tile: 0.06, ns: 0.35, legs: 'black' },
    { id: 'graphite',          name: 'Графит',            color: '#3c3e41', rough: 0.9,  sheen: 0.6, sheenRough: 0.55, sheenColor: '#8d9298', normal: 'weave',   tile: 0.05, ns: 0.45, legs: 'black' },
    { id: 'olive',             name: 'Олива',             color: '#6b6943', rough: 0.9,  sheen: 0.55, sheenRough: 0.55, sheenColor: '#b9b58e', normal: 'weave',  tile: 0.05, ns: 0.45, legs: 'oak' },
    { id: 'terracotta-velvet', name: 'Терракотовый велюр', color: '#a3492f', rough: 0.75, sheen: 1.0, sheenRough: 0.3,  sheenColor: '#e8a184', normal: 'velvet', tile: 0.03, ns: 0.15, legs: 'oak' },
    { id: 'cognac-leather',    name: 'Коньячная кожа',    color: '#86471f', rough: 0.42, sheen: 0,   clearcoat: 0.3, clearcoatRough: 0.35,       normal: 'leather', tile: 0.14, ns: 0.35, legs: 'black' },
  ],
  tv: [
    { id: 'wall',  name: 'На стене' },
    { id: 'stand', name: 'На подставке' },
    { id: 'none',  name: 'Без ТВ' },
  ],
  tvSize: [
    { id: '55', name: '55″' }, { id: '65', name: '65″' }, { id: '75', name: '75″' }, { id: '85', name: '85″' },
  ],
  tvOn: [{ id: 'off', name: 'Выключен' }, { id: 'on', name: 'Включён' }],
  tvLink: [{ id: 'on', name: 'ТВ и тумба вместе' }, { id: 'off', name: 'Отдельно' }],
  console: [
    { id: 'low-long', name: 'Низкая длинная' },
    { id: 'floating', name: 'Подвесная' },
    { id: 'legs',     name: 'На ножках' },
    { id: 'none',     name: 'Без тумбы' },
  ],
  // Отделка тумбы и столика. fronts — общий материал фасадов кухни (M.fronts).
  consoleFinish: [
    { id: 'oak',      name: 'Дуб',               item: { tex: 'oak_veneer_02', size: 1.0, rough: 0.5 } },
    { id: 'walnut',   name: 'Орех',              item: { tex: 'natural_walnut_veneer', size: 1.0, rough: 0.45 } },
    { id: 'white',    name: 'Белая матовая',     item: { color: '#ecebe6', rough: 0.85 } },
    { id: 'graphite', name: 'Графит матовый',    item: { color: '#3a3b3d', rough: 0.75 } },
    { id: 'fronts',   name: 'Как фасады кухни' },
  ],
  rug: [
    { id: 'none',       name: 'Без ковра' },
    { id: 'wool-light', name: 'Шерсть, светлый', color: '#e4ddcf' },
    { id: 'wool-grey',  name: 'Шерсть, серый',   color: '#9a9893' },
  ],
  rugSize: [{ id: '240x170', name: '240 × 170' }, { id: '300x200', name: '300 × 200' }, { id: '340x240', name: '340 × 240' }],
  table: [
    { id: 'none',  name: 'Без столика' },
    { id: 'round', name: 'Круглый' },
    { id: 'oval',  name: 'Овальный' },
    { id: 'rect',  name: 'Прямоугольный' },
  ],
};

// Варианты из каталогов. Первые записи (none, basic, default) — свои, дальше каталог по порядку.
const sizeId = (w, d) => `${Math.round(w * 100)}x${Math.round(d * 100)}`;
const BASIC_RUG_SIZES = Object.values(FURN_SPEC?.rug?.sizes ?? {}).map(([w, d]) => ({ w, d }));
const uniq = list => [...new Map(list.map(o => [o.id, o])).values()];
FURN_OPTIONS.sofaModel = [
  { id: 'none', name: 'Без дивана' }, { id: 'basic', name: 'Схема (без модели)' },
  ...SOFA_CATALOG.map(e => ({ id: e.id, name: e.name })),
];
FURN_OPTIONS.sofaCover = uniq([{ id: 'default', name: 'Как у модели' }, ...SOFA_CATALOG.flatMap(e => (e.covers ?? []).map(c => ({ id: c.id, name: c.name })))]);
FURN_OPTIONS.sofaSnap = [{ id: 'island', name: 'Спинкой к острову' }, { id: 'free', name: 'Свободно' }];
FURN_OPTIONS.rugModel = [
  { id: 'none', name: 'Без ковра' }, { id: 'basic', name: 'Однотонный' },
  ...RUG_CATALOG.map(e => ({ id: e.id, name: e.name })),
];
FURN_OPTIONS.rugDim = uniq([{ id: 'default', name: 'Как у ковра' },
  ...[...BASIC_RUG_SIZES, ...RUG_CATALOG.flatMap(e => e.sizes)].map(z => ({ id: sizeId(z.w, z.d), name: `${Math.round(z.w * 100)} × ${Math.round(z.d * 100)}` }))]);

// Стартовое состояние: furniture.json → defaults; значения 'auto' считаются по каталогам и острову.
const ISL = { len: kitJSON?.island?.length ?? 1.8, h: kitJSON?.worktop?.height ?? 0.9 };
const backOf = e => e.backH ?? e.size.h ?? 0.85;
function autoSofa() {   // ширина ближе всего к длине острова, спинка не выше острова
  const fit = SOFA_CATALOG.filter(e => backOf(e) <= ISL.h + 0.005);
  const pool = fit.length ? fit : SOFA_CATALOG;
  return pool.slice().sort((a, b) => Math.abs(a.size.w - ISL.len) - Math.abs(b.size.w - ISL.len))[0]?.id ?? 'basic';
}
function autoRug(def) {
  const e = RUG_CATALOG[0], [tw, td] = def.rugTarget ?? [2.4, 1.7];
  const sizes = e ? e.sizes : BASIC_RUG_SIZES;
  const z = sizes.slice().sort((a, b) => (Math.abs(Math.max(a.w, a.d) - tw) + Math.abs(Math.min(a.w, a.d) - td)) - (Math.abs(Math.max(b.w, b.d) - tw) + Math.abs(Math.min(b.w, b.d) - td)))[0];
  return { rugModel: e?.id ?? 'basic', rugDim: z ? sizeId(z.w, z.d) : 'default', rugRot: z && z.w < z.d ? 90 : 0 };
}
function makeDefaults() {
  const d = { ...(FURN_SPEC?.defaults ?? { sofa: 'none', tv: 'none', console: 'none', rug: 'none', table: 'none', sofaModel: 'none', rugModel: 'none' }) };
  if (d.sofaModel === 'auto') d.sofaModel = autoSofa();
  if (d.rugModel === 'auto' || d.rugDim === 'auto' || d.rugRot === 'auto') {
    const a = autoRug(d);
    for (const k of ['rugModel', 'rugDim', 'rugRot']) if (d[k] === 'auto') d[k] = a[k];
  }
  delete d.rugTarget;
  return Object.freeze(d);
}
export const FURN_DEFAULTS = makeDefaults();

const ids = list => list.map(o => o.id);
// Для кода ссылки в main.js: дописать в конец схемы. Порядок не менять, новые поля только в конец.
export const FURN_SCHEMA = [
  ['sofa', ids(FURN_OPTIONS.sofa)], ['sofaFabric', ids(FURN_OPTIONS.sofaFabric)],
  ['sofaX', 'cm'], ['sofaZ', 'cm'], ['sofaRot', 'deg'],
  ['tv', ids(FURN_OPTIONS.tv)], ['tvSize', ids(FURN_OPTIONS.tvSize)], ['tvY', 'cm'], ['tvAlong', 'cm'],
  ['tvOn', ids(FURN_OPTIONS.tvOn)], ['tvLink', ids(FURN_OPTIONS.tvLink)],
  ['console', ids(FURN_OPTIONS.console)], ['consoleFinish', ids(FURN_OPTIONS.consoleFinish)],
  ['consoleW', 'cm'], ['consoleAlong', 'cm'],
  ['rug', ids(FURN_OPTIONS.rug)], ['rugSize', ids(FURN_OPTIONS.rugSize)],
  ['table', ids(FURN_OPTIONS.table)], ['tableX', 'cm'], ['tableZ', 'cm'], ['tableRot', 'deg'],
];
// Вторая очередь полей (реальные диваны, ковёр отдельным предметом). FURN_SCHEMA выше не менять:
// в main.js за ним стоят sunDate/sunTime, поэтому эти поля дописываются в самый конец кода ссылки.
// Старые поля sofa/sofaFabric теперь — форма и ткань схемы-дивана (sofaModel = basic), rug — цвет однотонного ковра,
// rugSize не используется (размер — rugDim).
export const FURN_SCHEMA_2 = [
  ['sofaModel', ids(FURN_OPTIONS.sofaModel)], ['sofaCover', ids(FURN_OPTIONS.sofaCover)], ['sofaSnap', ids(FURN_OPTIONS.sofaSnap)],
  ['rugModel', ids(FURN_OPTIONS.rugModel)], ['rugDim', ids(FURN_OPTIONS.rugDim)],
  ['rugX', 'cm'], ['rugZ', 'cm'], ['rugRot', 'deg'],
];
// Поля, от которых зависит только положение: их меняет placeFurniture без пересборки геометрии.
export const FURN_PLACE_KEYS = ['sofaX', 'sofaZ', 'sofaRot', 'sofaSnap', 'tvY', 'tvAlong', 'tvLink', 'consoleAlong',
  'tableX', 'tableZ', 'tableRot', 'rugX', 'rugZ', 'rugRot'];
const FURN_KEYS = [...FURN_SCHEMA, ...FURN_SCHEMA_2].map(([k]) => k);
export function furnitureKey(state) {
  const S = norm(state);
  return FURN_KEYS.filter(k => !FURN_PLACE_KEYS.includes(k)).map(k => S[k]).join('|');
}

// Позиции по умолчанию — для кнопки «Всё на место» (setState(furnitureResetPatch())): мебель и вся обстановка.
export function furnitureResetPatch() {
  return { ...Object.fromEntries(FURN_PLACE_KEYS.filter(k => k in FURN_DEFAULTS).map(k => [k, FURN_DEFAULTS[k]])), moves: '' };
}

/**
 * Разделы вкладки «Мебель» для новой панели (ui.js → addSection). id совпадают с заглушками панели
 * (sofa, tv, media, rug, arrange) и заменяют их. Всё, кроме furnEdit/furnReset, — поля state.
 * Действия: 'furnEdit' (toggle, src: info) → editor.enable/disable; 'furnReset' → setState(furnitureResetPatch()).
 */
export function registerFurnitureUI(addSection) {
  const D = FURN_DEFAULTS, cm = v => `${Math.round(v * 100)} см`, dg = v => `${Math.round(v)}°`;
  const name = (k, id) => opt(k, id)?.name ?? '';
  const ch = key => FURN_OPTIONS[key].map(({ id, name: n }) => ({ id, name: n }));
  const has = (k, none = 'none') => st => (st[k] ?? D[k]) !== none;
  const base = { tab: 'furniture', feature: 'furniture' };
  // Диван: карточки моделей (миниатюра models/sofas/<id>/thumb.jpg), обивки своей модели, посадка к острову
  const zl = p => (p ? `${p.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(p) ? 0 : 2 })} zł` : '');   // 99,99 zł как у IKEA
  const card = (e, note) => ({ id: e.id, name: e.name, note, tex: `../models/sofas/${e.id}` });   // ui ищет textures/<tex>/thumb.jpg
  const isl = st => (kitJSON ? islandBox(kitJSON, st) : null);
  const fit = st => {
    const dm = sofaDims({ ...D, ...st }), i = isl(st);
    if (!dm) return '';
    const len = i ? i.z1 - i.z0 : ISL.len, cmr = v => Math.round(v * 100);
    const over = dm.backH > ISL.h + 0.005 ? ' · спинка выше острова' : '';
    return `Ширина ${cmr(dm.w)} · остров ${cmr(len)} · спинка ${cmr(dm.backH)} / остров ${cmr(ISL.h)} см${over}`;
  };
  const model = st => st.sofaModel ?? D.sofaModel;
  const snapped = st => (st.sofaSnap ?? D.sofaSnap) === 'island';
  const anySofa = st => model(st) !== 'none';
  addSection({ ...base, id: 'sofa', title: 'Диван', order: 10, open: true, focus: ['sofa'],
    summary: st => { const e = sofaEntry({ sofaModel: model(st) }); return e ? [e.name, coverOf(e, st.sofaCover)?.name].filter(Boolean).join(' · ') : name('sofaModel', model(st)); },
    controls: [
      { type: 'swatches', key: 'sofaModel', label: 'Модель', def: D.sofaModel, options: [
        { id: 'none', name: 'Без дивана' },
        { id: 'basic', name: 'Схема', note: 'простая форма, если модели не подходят', color: '#c9b89a' },
        ...SOFA_CATALOG.map(e => card(e, [`${Math.round(e.size.w * 100)} × ${Math.round(e.size.d * 100)} см`, zl(e.pricePLN), e.brand].filter(Boolean).join(' · '))),
      ] },
      { type: 'readout', key: 'sofaInfo', style: 'dims', visible: st => !!sofaEntry({ sofaModel: model(st) }),
        value: st => { const e = sofaEntry({ sofaModel: model(st) }), c = coverOf(e, st.sofaCover);
          if (!e) return '';
          return [`${e.brand ? e.brand + ' ' : ''}${e.name}`, e.article && `арт. ${e.article}`, zl(c?.pricePLN || e.pricePLN), e.fitNote].filter(Boolean).join(' · '); } },
      { type: 'readout', key: 'sofaFit', style: 'dims', visible: anySofa, value: fit },
      // обивки: по одному ряду на модель (список вариантов в панели статичный)
      ...SOFA_CATALOG.filter(e => e.covers?.length).map(e => ({
        type: 'swatches', id: `sofaCover-${e.id}`, key: 'sofaCover', label: 'Обивка', def: e.covers[0].id,
        options: e.covers.map(c => ({ id: c.id, name: c.name, color: c.color, note: [c.leather ? 'кожа' : '', zl(c.pricePLN)].filter(Boolean).join(' · ') })),
        get: st => coverOf(e, st.sofaCover)?.id, visible: st => model(st) === e.id })),
      { type: 'chips', key: 'sofa', label: 'Форма', def: D.sofa, options: ch('sofa').filter(o => o.id !== 'none'), visible: st => model(st) === 'basic' },
      { type: 'swatches', key: 'sofaFabric', label: 'Обивка', def: D.sofaFabric, options: FURN_OPTIONS.sofaFabric.map(({ id, name: n, color }) => ({ id, name: n, color })), visible: st => model(st) === 'basic' },
      { type: 'toggle', key: 'sofaSnap', label: 'Прижать к острову', def: D.sofaSnap, values: ['free', 'island'], visible: anySofa },
      { type: 'slider', key: 'sofaRot', label: 'Поворот', def: D.sofaRot, min: -180, max: 165, step: 15, format: dg, visible: st => anySofa(st) && !snapped(st),
        presets: [{ label: 'К ТВ', value: 0 }, { label: '90°', value: 90 }, { label: '−90°', value: -90 }] },
      { type: 'group', label: 'Точно', visible: st => anySofa(st) && !snapped(st), controls: [
        { type: 'slider', key: 'sofaX', label: 'От острова к ТВ', def: D.sofaX, min: 0.6, max: 5.6, step: 0.01, format: cm },
        { type: 'slider', key: 'sofaZ', label: 'От окна вглубь', def: D.sofaZ, min: 0.4, max: 3.3, step: 0.01, format: cm },
      ] },
    ] });
  addSection({ ...base, id: 'tv', title: 'Телевизор', order: 20, focus: ['tv'],
    summary: st => has('tv')(st) ? `${name('tvSize', st.tvSize ?? D.tvSize)} · ${name('tv', st.tv ?? D.tv).toLowerCase()}` : name('tv', 'none'),
    controls: [
      { type: 'seg', key: 'tv', label: 'Крепление', def: D.tv, options: ch('tv') },
      { type: 'seg', key: 'tvSize', label: 'Диагональ', def: D.tvSize, options: ch('tvSize'), visible: has('tv') },
      { type: 'slider', key: 'tvY', label: 'Центр экрана от пола', def: D.tvY, min: 0.6, max: 1.8, step: 0.01, format: cm,
        visible: st => (st.tv ?? D.tv) === 'wall' || ((st.tv ?? D.tv) === 'stand' && (st.console ?? D.console) === 'none') },
      { type: 'slider', key: 'tvAlong', label: 'Вдоль стены', def: D.tvAlong, min: 0.3, max: 3.4, step: 0.01, format: cm, visible: has('tv') },
      { type: 'toggle', key: 'tvOn', label: 'Экран включён', def: D.tvOn, values: ['off', 'on'], visible: has('tv') },
      { type: 'toggle', key: 'tvLink', label: 'Двигать вместе с тумбой', def: D.tvLink, values: ['off', 'on'], visible: st => has('tv')(st) && has('console')(st) },
    ] });
  addSection({ ...base, id: 'media', title: 'Тумба под ТВ', order: 30, focus: ['console'],
    summary: st => has('console')(st) ? `${name('console', st.console ?? D.console)} · ${name('consoleFinish', st.consoleFinish ?? D.consoleFinish).toLowerCase()}` : name('console', 'none'),
    controls: [
      { type: 'chips', key: 'console', label: 'Вид', def: D.console, options: ch('console') },
      { type: 'chips', key: 'consoleFinish', label: 'Отделка (и столика)', def: D.consoleFinish, options: ch('consoleFinish'), visible: st => has('console')(st) || has('table')(st) },
      { type: 'slider', key: 'consoleW', label: 'Длина', def: D.consoleW, min: FURN_SPEC?.consoleW?.min ?? 1.2, max: FURN_SPEC?.consoleW?.max ?? 2.8, step: FURN_SPEC?.consoleW?.step ?? 0.1, format: cm, visible: has('console') },
      { type: 'slider', key: 'consoleAlong', label: 'Вдоль стены', def: D.consoleAlong, min: 0.3, max: 3.4, step: 0.01, format: cm,
        visible: st => has('console')(st) && (st.tvLink ?? D.tvLink) === 'off' },
    ] });
  // Ковёр: карточки (миниатюра textures/rugs/<id>/thumb.jpg, иначе сама текстура), размеры с ценой, двигается в 3D
  const rugM = st => st.rugModel ?? D.rugModel;
  const dimName = z => `${Math.round(z.w * 100)} × ${Math.round(z.d * 100)}`;
  const rugTex = e => String(e.tex || `textures/rugs/${e.id}/`).replace(/^textures\//, '').replace(/\/+$/, '');
  addSection({ ...base, id: 'rug', title: 'Ковёр и столик', order: 40, focus: ['rug', 'table'],
    summary: st => [rugEntry({ rugModel: rugM(st) })?.name ?? name('rugModel', rugM(st)), name('table', st.table ?? D.table)].join(' · '),
    controls: [
      { type: 'swatches', key: 'rugModel', label: 'Ковёр', def: D.rugModel, options: [
        { id: 'none', name: 'Без ковра' },
        { id: 'basic', name: 'Однотонный', color: opt('rug', 'wool-light').color },
        ...RUG_CATALOG.map(e => ({ id: e.id, name: e.name, tex: rugTex(e), note: [e.brand, PILE_NAME[e.pile]].filter(Boolean).join(' · ') })),
      ] },
      { type: 'readout', key: 'rugInfo', style: 'dims', visible: st => !!rugEntry({ rugModel: rugM(st) }),
        value: st => { const S = { ...D, ...st }, e = rugEntry(S), z = rugSizeOf(S);
          if (!e) return '';
          return [`${e.brand ? e.brand + ' ' : ''}${e.name}`, e.article && `арт. ${e.article}`, zl(z.pricePLN)].filter(Boolean).join(' · '); } },
      ...RUG_CATALOG.map(e => ({
        type: 'chips', id: `rugDim-${e.id}`, key: 'rugDim', label: 'Размер, см', def: sizeId(e.sizes[0].w, e.sizes[0].d),
        options: e.sizes.map(z => ({ id: sizeId(z.w, z.d), name: [dimName(z), zl(z.pricePLN)].filter(Boolean).join(' · ') })),
        get: st => { const z = rugSizeOf({ ...D, ...st, rugModel: e.id }); return sizeId(z.w, z.d); }, visible: st => rugM(st) === e.id })),
      { type: 'chips', key: 'rug', label: 'Цвет', def: D.rug, options: ch('rug').filter(o => o.id !== 'none'), visible: st => rugM(st) === 'basic' },
      { type: 'chips', id: 'rugDim-basic', key: 'rugDim', label: 'Размер, см', def: BASIC_RUG_SIZES[0] ? sizeId(BASIC_RUG_SIZES[0].w, BASIC_RUG_SIZES[0].d) : 'default',
        options: BASIC_RUG_SIZES.map(z => ({ id: sizeId(z.w, z.d), name: dimName(z) })),
        get: st => { const z = rugSizeOf({ ...D, ...st, rugModel: 'basic' }); return sizeId(z.w, z.d); }, visible: st => rugM(st) === 'basic' },
      { type: 'slider', key: 'rugRot', label: 'Поворот ковра', def: D.rugRot, min: -180, max: 165, step: 15, format: dg, visible: st => rugM(st) !== 'none',
        presets: [{ label: 'Вдоль дивана', value: 0 }, { label: 'Поперёк', value: 90 }] },
      { type: 'readout', key: 'rugHint', style: 'hint', visible: st => rugM(st) !== 'none', value: 'Положение — «Двигать мебель» и перетащить ковёр в 3D.' },
      { type: 'chips', key: 'table', label: 'Журнальный столик', def: D.table, options: ch('table') },
      { type: 'slider', key: 'tableRot', label: 'Поворот столика', def: D.tableRot, min: -180, max: 165, step: 15, format: dg, visible: st => has('table')(st) && (st.table ?? D.table) !== 'round' },
    ] });
  addSection({ ...base, id: 'arrange', title: 'Расстановка', order: 50, open: true,
    controls: [
      { type: 'toggle', key: 'furnEdit', src: 'info', label: 'Двигать мебель' },
      { type: 'readout', key: 'furnHint', style: 'keys', visible: (st, _, i) => !!i?.furnEdit,
        value: 'Двигается всё: мебель и любая вещь в комнатах. Тяните сам предмет или стрелки. Настенное едет по стене, '
          + 'мелочи — по полке и встают на ту, куда перенесли. R — повернуть, T — двигать, Shift — без привязки, Esc — готово.' },
      { type: 'button', key: 'furnReset', action: 'furnReset', label: 'Всё на место' },
    ] });
}

// Состояние мебели: недостающие поля — из умолчаний (старые ссылки без мебели).
function norm(state = {}) {
  const S = {};
  for (const k of Object.keys(FURN_DEFAULTS)) S[k] = state[k] ?? FURN_DEFAULTS[k];
  return S;
}
const opt = (key, id) => FURN_OPTIONS[key].find(o => o.id === id) || FURN_OPTIONS[key][0];

// ---------- мелочи ----------

const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = v => Math.round(v * 100) / 100;
const normDeg = d => { let a = ((Math.round(d) % 360) + 360) % 360; if (a >= 180) a -= 360; return a; };   // [−180, 180)
const _v = new THREE.Vector3();
function yawOf(o) { _v.set(0, 0, 1).applyQuaternion(o.quaternion); return Math.atan2(_v.x, _v.z); }

// UV в метрах по доминирующей нормали: ткань и шпон лежат в реальном масштабе (как boxUV в model.js).
function metreUV(g, ox = 0, oy = 0, oz = 0) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i) + ox, y = p.getY(i) + oy, z = p.getZ(i) + oz;
    if (ax >= ay && ax >= az) { uv[2 * i] = z; uv[2 * i + 1] = y; }
    else if (ay >= az) { uv[2 * i] = x; uv[2 * i + 1] = z; }
    else { uv[2 * i] = x; uv[2 * i + 1] = y; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Мягкая коробка для подушек: скруглённые рёбра + «пухлость» граней (crown, м).
// В отличие от RoundedBoxGeometry, у граней есть внутренние вершины, поэтому подушка выгибается.
function softBox(w, h, d, r, { crown = 0, k = 3, m = 4 } = {}) {
  const hw = [w / 2, h / 2, d / 2];
  r = Math.max(0.002, Math.min(r, hw[0] - 1e-4, hw[1] - 1e-4, hw[2] - 1e-4));
  const n = 2 * k + m;
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const map = (u, a) => {                 // u ∈ [−0.5, 0.5]; первые и последние k шагов — полоса скругления
    const i = (u + 0.5) * n;
    if (i <= k) return -a + r * (i / k);
    if (i >= n - k) return a - r * ((n - i) / k);
    return -a + r + 2 * (a - r) * ((i - k) / m);
  };
  const p = g.attributes.position, v = new THREE.Vector3(), q = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(map(p.getX(i), hw[0]), map(p.getY(i), hw[1]), map(p.getZ(i), hw[2]));
    q.set(clamp(v.x, r - hw[0], hw[0] - r), clamp(v.y, r - hw[1], hw[1] - r), clamp(v.z, r - hw[2], hw[2] - r));
    dir.subVectors(v, q);
    const len = dir.length();
    if (len > 1e-9) { dir.multiplyScalar(1 / len); v.copy(q).addScaledVector(dir, r); }
    if (crown && len > 1e-9) {
      const a = Math.abs(dir.x) >= Math.abs(dir.y) && Math.abs(dir.x) >= Math.abs(dir.z) ? 0 : (Math.abs(dir.y) >= Math.abs(dir.z) ? 1 : 2);
      const u = [v.x / hw[0], v.y / hw[1], v.z / hw[2]];
      let f = 1;
      for (let j = 0; j < 3; j++) if (j !== a) f *= Math.max(0, 1 - u[j] * u[j]);
      v.addScaledVector(dir, crown * f);
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const out = mergeVertices(g, 1e-5);
  g.dispose();
  out.computeVertexNormals();
  return out;
}

// Твёрдая коробка с тонкой фаской (мебельные щиты, корпус ТВ).
function hardBox(w, h, d, r = 0.003) {
  return r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
}

// Меш детали: метровые UV с учётом положения (ткань непрерывна между деталями), тени, слот для клика.
function part(geo, mat, x, y, z, ctx, { cast = true, receive = true, uv = true } = {}) {
  if (uv) metreUV(geo, x, y, z);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = receive;
  m.userData.slot = ctx.slot; m.userData.furnId = ctx.id;
  m.name = `${ctx.id}_${ctx.n++}`;
  ctx.group.add(m);
  return m;
}
function itemGroup(id) {
  const g = new THREE.Group(); g.name = id;
  g.userData = { furnId: id, isItem: true, footprint: [] };
  return g;
}

// ---------- материалы ----------
// Свои материалы кешируются на весь сеанс (пересборка их не трогает). Имена с префиксом furn_ — для Blender.

const MATS = new Map();
const READY = new Map();   // материал → промис загрузки текстур (не в userData: его пишет GLTFExporter)
function cached(key, make) { if (!MATS.has(key)) { const m = make(); m.name = key; MATS.set(key, m); } return MATS.get(key); }
const physical = o => new THREE.MeshPhysicalMaterial(o);

// Процедурная карта нормалей ткани (бесшовная): weave — полотняное плетение, boucle — петли, felt — войлок,
// velvet — тонкий ворс, leather — кожа. Генерится один раз на сорт.
const NORMALS = new Map();
function fabricNormal(kind, tile) {
  const key = `${kind}|${tile}`;
  if (NORMALS.has(key)) return NORMALS.get(key);
  const N = kind === 'boucle' ? 256 : 128;
  let seed = 1234567 + kind.length * 7919;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const noise = period => {               // бесшовный value noise с периодом period клеток на тайл
    const grid = Float32Array.from({ length: period * period }, rnd);
    return (x, y) => {
      const fx = (x / N) * period, fy = (y / N) * period, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const g = (a, b) => grid[((b % period) + period) % period * period + ((a % period) + period) % period];
      const a = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * sx, b = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const h = new Float32Array(N * N);
  if (kind === 'weave') {
    const n1 = noise(32);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const over = ((x >> 2) + (y >> 2)) & 1;
      h[y * N + x] = (over ? Math.sin(Math.PI * ((x & 3) + 0.5) / 4) : Math.sin(Math.PI * ((y & 3) + 0.5) / 4)) + (n1(x, y) - 0.5) * 0.4;
    }
  } else if (kind === 'boucle') {
    const n1 = noise(16);
    for (let i = 0; i < N * N; i++) h[i] = n1(i % N, (i / N) | 0) * 0.3;
    for (let l = 0; l < 1500; l++) {
      const cx = rnd() * N, cy = rnd() * N, rr = 2 + rnd() * 2.5, R = Math.ceil(rr + 2);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy), x = (Math.floor(cx) + dx + N) % N, y = (Math.floor(cy) + dy + N) % N;
        const v = Math.exp(-((d - rr) ** 2) / 1.1);
        if (v > h[y * N + x]) h[y * N + x] = v;
      }
    }
  } else {
    const o = kind === 'leather' ? [noise(8), noise(16), noise(32)] : [noise(16), noise(32), noise(64)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0;
      o.forEach((f, i) => { const s = f(x, y); v += (kind === 'leather' ? 1 - Math.abs(s * 2 - 1) : s) / (i + 1); });
      h[y * N + x] = v;
    }
  }
  const strength = { weave: 2.2, boucle: 2.5, felt: 1.6, velvet: 0.8, leather: 1.4 }[kind] ?? 1.5;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
  const H = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const nx = (H(x - 1, y) - H(x + 1, y)) * strength, ny = (H(x, y + 1) - H(x, y - 1)) * strength, l = Math.hypot(nx, ny, 1);
    const i = (y * N + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  t.repeat.set(1 / tile, 1 / tile); t.anisotropy = 4;
  NORMALS.set(key, t);
  return t;
}

function fabricMat(id) {
  const f = opt('sofaFabric', id);
  return cached(`furn_fabric_${f.id}`, () => {
    const m = physical({ color: f.color, roughness: f.rough, sheen: f.sheen, sheenRoughness: f.sheenRough ?? 0.5, sheenColor: new THREE.Color(f.sheenColor || '#000000'),
      clearcoat: f.clearcoat || 0, clearcoatRoughness: f.clearcoatRough ?? 0.3 });
    m.normalMap = fabricNormal(f.normal, f.tile); m.normalScale.set(f.ns, f.ns);
    return m;
  });
}
const metalBlack = () => cached('furn_metal_black', () => physical({ color: '#1c1c1d', roughness: 0.42, metalness: 0.6 }));
const legOak = () => cached('furn_leg_oak', () => physical({ color: '#a98159', roughness: 0.55 }));
const plinthMat = () => cached('furn_plinth', () => physical({ color: '#202021', roughness: 0.8 }));
const tvBody = () => cached('furn_tv_body', () => physical({ color: '#151517', roughness: 0.5, metalness: 0.35 }));
const gadgetMat = () => cached('furn_gadget', () => physical({ color: '#18181a', roughness: 0.35, clearcoat: 0.4 }));

// Отделка тумбы и столика: дерево с текстурой (applyItem, грузится асинхронно → ctx.ready) или краска.
function finishMat(id, ctx) {
  if (id === 'fronts' && ctx.M?.fronts) return ctx.M.fronts;
  const f = opt('consoleFinish', id === 'fronts' ? 'oak' : id);
  const key = `furn_wood_${f.id}`;
  const fresh = !MATS.has(key);
  const m = cached(key, () => physical({ color: f.item.color || '#ffffff', roughness: f.item.rough ?? 0.6 }));
  if (fresh) READY.set(m, applyItem(m, f.item).catch(() => {}));
  ctx.ready.push(READY.get(m));
  return m;
}
const isWood = id => id === 'oak' || id === 'walnut';

// Экран ТВ. В живом растре поверх него идёт настоящий YouTube (tv.js находит меш 'tv_screen' и вырезает в кадре «дыру»
// под плеер). Материал «включённого» экрана светится постером (spec/tv.json → poster): его видят фото-режим, снимок
// PNG и экспорт GLB, где iframe быть не может.
function screenMat(on) {
  const m = cached('furn_tv_screen', () => physical({ color: '#050506', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 }));
  const poster = on ? tvPosterTexture() : null;
  m.emissiveMap = poster;
  m.emissive.set(poster ? '#ffffff' : '#000000');
  m.emissiveIntensity = poster ? 1 : 0;   // яркость постера под экспозицию кадра подгоняет tv.js
  m.needsUpdate = true;
  return m;
}

// ---------- диван ----------
// Локально: начало — центр следа на полу, спинка к −Z, сидящий смотрит в +Z, длина по X (так же лежат GLB каталога).
// В мире группа повёрнута на 90° + sofaRot: при sofaRot = 0 диван смотрит в +X, на стену с ТВ.
// Левая рука сидящего — локальный +X (в мире −Z, к окну).

const sofaEntry = S => SOFA_CATALOG.find(e => e.id === S.sofaModel) || null;
const coverOf = (e, id) => e?.covers?.find(c => c.id === id) || e?.covers?.[0] || null;
const basicShape = (S, spec) => (S.sofa !== 'none' && spec.sofas[S.sofa] ? S.sofa : 'straight3');
// Габариты дивана по состоянию: { w, d, h, backH, seatH } — из каталога или из схемы.
function sofaDims(S, spec = FURN_SPEC) {
  const e = sofaEntry(S);
  if (e) return { w: e.size.w, d: e.size.d, h: e.size.h, backH: backOf(e), seatH: e.seatH };
  const s = spec?.sofas?.[basicShape(S, spec)];
  return s ? { w: s.w, d: s.d, h: s.h, backH: s.h, seatH: s.seatH } : null;
}

// GLB каталога: грузятся один раз (кеш по адресу), смена обивки и пересборка не качают заново.
let gltf = null;
const GLB = new Map();
function loadGLB(url) {
  if (!gltf) { gltf = new GLTFLoader(); gltf.setMeshoptDecoder(MeshoptDecoder); }
  if (!GLB.has(url)) {
    const p = gltf.loadAsync(url).then(r => r.scene);
    p.catch(() => GLB.delete(url));   // неудачную загрузку можно повторить
    GLB.set(url, p);
  }
  return GLB.get(url);
}
/** Заранее скачать модели (например, при открытии вкладки «Мебель»), чтобы выбор был мгновенным. */
export function preloadSofas(ids = SOFA_CATALOG.map(e => e.id)) {
  for (const id of ids) { const e = SOFA_CATALOG.find(x => x.id === id); if (e) loadGLB(e.model).catch(() => {}); }
}

// Обивка: материал `fabric` модели перекрашивается по записи обивки (цвет, ворс ткани или лоск кожи).
// Карты нормалей и шероховатости модели сохраняются; цветная карта уходит, если у обивки задан цвет.
function coverMat(e, cover, base) {
  return cached(`fabric_${e.id}_${cover?.id ?? 'base'}`, () => {
    const leather = !!cover?.leather, color = new THREE.Color(cover?.color ?? base.color ?? '#cccccc');
    const m = physical({
      color, map: cover?.color ? null : base.map ?? null,
      normalMap: base.normalMap ?? fabricNormal(leather ? 'leather' : 'weave', leather ? 0.14 : 0.05),
      roughnessMap: base.roughnessMap ?? null, aoMap: base.aoMap ?? null,
      roughness: cover?.rough ?? (leather ? 0.42 : 0.9),
      sheen: leather ? 0 : (cover?.sheen ?? 0.6), sheenRoughness: 0.6, sheenColor: color.clone().lerp(new THREE.Color('#ffffff'), 0.5),
      clearcoat: leather ? 0.3 : 0, clearcoatRoughness: 0.35,
    });
    if (base.normalMap && base.normalScale) m.normalScale.copy(base.normalScale); else m.normalScale.set(leather ? 0.35 : 0.45, leather ? 0.35 : 0.45);
    return m;
  });
}
const isFabric = m => !!m && /^fabric/i.test(m.name || '');

function buildSofa(S, c) {
  if (S.sofaModel === 'none') return null;
  const g = itemGroup('sofa'), e = sofaEntry(S);
  if (!e) { buildBasicSofa(g, S, c); return g; }
  const { w, d } = e.size, cover = coverOf(e, S.sofaCover);
  g.userData.footprint.push([-w / 2, -d / 2, w / 2, d / 2]);
  Object.assign(g.userData, { front: [0, d / 2], depth: d, model: e.id });
  const url = cover?.model || e.model;
  c.ready.push(loadGLB(url).then(tpl => {
    const inst = tpl.clone(true);
    inst.name = `sofa_${e.id}`;
    inst.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.userData.slot = 'sofa'; o.userData.furnId = 'sofa';
      o.userData.glb = true;   // геометрия общая с кешем GLB: при пересборке не освобождать (main.js rebuildFurniture)
      if (!cover?.model) {   // своя модель обивки уже окрашена, иначе перекрашиваем только fabric
        const swap = m => (isFabric(m) ? coverMat(e, cover, m) : m);
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      }
    });
    const size = new THREE.Box3().setFromObject(inst).getSize(new THREE.Vector3());
    if (Math.abs(size.x - w) > 0.05 || Math.abs(size.z - d) > 0.05) console.warn(`Диван ${e.id}: модель ${size.x.toFixed(2)}×${size.z.toFixed(2)} м, в каталоге ${w}×${d}`);
    g.add(inst);
  }).catch(err => {
    console.warn(`Диван ${e.id}: модель не загрузилась, показана схема`, err);
    // Схема встаёт в след модели: спинка там же, где была бы у модели (поза уже посчитана по её глубине)
    const fp = g.userData.footprint, dep = g.userData.depth, n = g.children.length;
    g.userData.footprint = [];
    buildBasicSofa(g, S, c);
    const shift = (g.userData.depth - dep) / 2;
    for (const o of g.children.slice(n)) o.position.z += shift;
    Object.assign(g.userData, { footprint: fp, depth: dep });
  }));
  return g;
}

// Запасной диван-схема: форма из старого поля sofa, ткань — sofaFabric.
function buildBasicSofa(g, S, c) {
  const s = c.spec.sofas[basicShape(S, c.spec)];
  g.userData.depth = s.d;
  {
    const ctx = { id: 'sofa', slot: 'sofa', group: g, n: 0 };
    const fab = fabricMat(S.sofaFabric);
    const L = s.w, D = s.d, ch = s.chaise, side = ch ? (ch.side === 'left' ? 1 : -1) : 0;
    const armP = side !== 1, armN = side !== -1;                      // подлокотники у +X и −X
    const xa = -L / 2 + (armN ? s.armW : 0), xb = L / 2 - (armP ? s.armW : 0);
    const legH = s.legH, baseTop = s.seatH - s.cushionH, zBack = -D / 2, zSeat = zBack + s.backD;
    const cx0 = !ch ? 0 : (side === 1 ? L / 2 - ch.w : -L / 2), cx1 = !ch ? 0 : (side === 1 ? L / 2 : -L / 2 + ch.w);
    const cz1 = ch ? zBack + ch.d : D / 2;
    const soft = Math.min(0.07, s.armW * 0.4);

    // Основание
    if (ch) {
      const mx0 = side === 1 ? -L / 2 : cx1, mx1 = side === 1 ? cx0 : L / 2;
      part(softBox(mx1 - mx0, baseTop - legH, D, 0.03), fab, (mx0 + mx1) / 2, (legH + baseTop) / 2, 0, ctx);
      part(softBox(ch.w, baseTop - legH, ch.d, 0.03), fab, (cx0 + cx1) / 2, (legH + baseTop) / 2, zBack + ch.d / 2, ctx);
    } else {
      part(softBox(L, baseTop - legH, D, 0.03), fab, 0, (legH + baseTop) / 2, 0, ctx);
    }
    // Подлокотники
    for (const [on, sx] of [[armP, 1], [armN, -1]]) {
      if (on) part(softBox(s.armW, s.armH - legH, D, soft, { crown: 0.008 }), fab, sx * (L / 2 - s.armW / 2), (legH + s.armH) / 2, 0, ctx);
    }
    // Спинка (каркас между подлокотниками)
    part(softBox(xb - xa, s.backFrameH - legH, s.backD, 0.05, { crown: 0.006 }), fab, (xa + xb) / 2, (legH + s.backFrameH) / 2, zBack + s.backD / 2, ctx);

    // Сиденья: обычные места + подушка оттоманки
    const gap = 0.008;
    const seatRange = ch ? (side === 1 ? [xa, cx0] : [cx1, xb]) : [xa, xb];
    const segs = [];
    const n = s.seats, cw = (seatRange[1] - seatRange[0]) / n;
    for (let i = 0; i < n; i++) segs.push([seatRange[0] + i * cw, seatRange[0] + (i + 1) * cw]);
    const seatD = D / 2 + 0.01 - zSeat;
    for (const [a, b] of segs) {
      part(softBox(b - a - gap, s.cushionH, seatD, 0.055, { crown: 0.018 }), fab, (a + b) / 2, baseTop + s.cushionH / 2, zSeat + seatD / 2, ctx);
    }
    const backSegs = [...segs];
    if (ch) {
      const [a, b] = side === 1 ? [cx0, xb] : [xa, cx1];
      const chD = cz1 + 0.01 - zSeat;
      part(softBox(b - a - gap, s.cushionH, chD, 0.055, { crown: 0.018 }), fab, (a + b) / 2, baseTop + s.cushionH / 2, zSeat + chD / 2, ctx);
      backSegs.push([a, b]);
    }
    // Подушки спинки, слегка завалены назад
    const bh = s.h - s.seatH + 0.04, bt = s.backCushionD;
    for (const [a, b] of backSegs) {
      const m = part(softBox(b - a - gap, bh, bt, 0.06, { crown: 0.02 }), fab, (a + b) / 2, s.seatH - 0.03 + bh / 2, zSeat + bt / 2 - 0.02, ctx);
      m.rotation.x = -s.backTilt;
    }
    // Опоры: ножки или утопленный цоколь
    if (s.plinth) {
      part(hardBox(L - 0.1, legH, D - 0.1, 0), plinthMat(), 0, legH / 2, 0, ctx, { cast: false });
    } else {
      const legMat = opt('sofaFabric', S.sofaFabric).legs === 'black' ? metalBlack() : legOak();
      const pts = [];
      const xs = L > 1.9 ? [-L / 2 + 0.07, 0, L / 2 - 0.07] : [-L / 2 + 0.07, L / 2 - 0.07];
      for (const x of xs) pts.push([x, zBack + 0.07], [x, D / 2 - 0.07]);
      if (ch) pts.push([cx0 + 0.07, cz1 - 0.07], [cx1 - 0.07, cz1 - 0.07]);
      for (const [x, z] of pts) part(new THREE.CylinderGeometry(0.016, 0.011, legH, 14), legMat, x, legH / 2, z, ctx);
    }
    g.userData.footprint.push([-L / 2, zBack, L / 2, D / 2]);
    if (ch) g.userData.footprint.push([cx0, D / 2, cx1, cz1]);
    g.userData.front = [0, D / 2];                   // середина переда основного блока (для замеров)
    // Подушки спинки чуть выпирают назад — сдвинуть схему, чтобы спинка не уходила в остров
    // (меряем в собственных осях: схема-замена приходит, когда диван уже поставлен)
    const pos = g.position.clone(), rot = g.rotation.clone();
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
    const back = new THREE.Box3().setFromObject(g).min.z - (g.parent ? g.parent.matrixWorld.elements[14] : 0);
    if (back < zBack - 1e-3) for (const o of g.children) o.position.z += zBack - back;
    g.position.copy(pos); g.rotation.copy(rot); g.updateMatrixWorld(true);
  }
  return g;
}

// ---------- ковёр ----------
// Отдельный предмет на полу (не коллайдер). Локально: начало — центр, ширина w по X, глубина d по Z.
// При rugRot = 0 ширина параллельна дивану со sofaRot = 0. Тонкая плита со скруглёнными углами, кант, бахрома.

const PILE = { flat: 0.005, low: 0.008, medium: 0.015, high: 0.03 };
const PILE_NAME = { flat: 'безворсовый', low: 'короткий ворс', medium: 'средний ворс', high: 'длинный ворс' };
const rugEntry = S => RUG_CATALOG.find(e => e.id === S.rugModel) || null;
// Размер ковра: точный из каталога, иначе ближайший из тех, что есть у этой модели
// (при смене ковра прежний размер может не продаваться — 170×240 у STOENSE, но не у ÄRENDE).
function nearestSize(list, dim) {
  const m = /^(\d+)x(\d+)$/.exec(dim || '');
  if (!m || !list.length) return list[0];
  const w = +m[1] / 100, d = +m[2] / 100;
  return list.slice().sort((a, b) => (Math.abs(a.w - w) + Math.abs(a.d - d)) - (Math.abs(b.w - w) + Math.abs(b.d - d)))[0];
}
function rugSizeOf(S) {
  const e = rugEntry(S), list = e ? e.sizes : BASIC_RUG_SIZES;
  return list.find(z => sizeId(z.w, z.d) === S.rugDim) || nearestSize(list, S.rugDim) || { w: 2.4, d: 1.7 };
}
// Приводит размер ковра в состоянии к продающемуся у выбранной модели (вызывает main.js в setState).
export function normalizeFurniture(state) {
  if (state.rugModel === 'none') return state;
  const z = rugSizeOf(state);
  if (z && z.w && z.d) state.rugDim = sizeId(z.w, z.d);
  return state;
}
function roundRect(w, d, r, path = new THREE.Shape()) {
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  r = Math.min(r, w / 2, d / 2);
  path.moveTo(x0 + r, y0); path.lineTo(x1 - r, y0); path.quadraticCurveTo(x1, y0, x1, y0 + r);
  path.lineTo(x1, y1 - r); path.quadraticCurveTo(x1, y1, x1 - r, y1);
  path.lineTo(x0 + r, y1); path.quadraticCurveTo(x0, y1, x0, y1 - r);
  path.lineTo(x0, y0 + r); path.quadraticCurveTo(x0, y0, x0 + r, y0);
  return path;
}
// Плоская фигура → плита толщиной h на полу (y 0..h). UV: whole — картинка на весь ковёр, иначе метры.
function slab(shape, h, w, d, whole) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    if (whole) uv.setXY(i, (x + w / 2) / w, (d / 2 - z) / d); else uv.setXY(i, x, -z);
  }
  return g;
}
// Раскладка текстуры: meta.json главнее (его пишет сборщик текстур), потом tile из rugs.json.
function rugTiling(e) {
  const m = RUG_META.get(e.id) || {}, t = e.tile;
  const tw = typeof t === 'number' ? t : t?.w ?? t?.u, td = typeof t === 'number' ? t : t?.d ?? t?.v;
  if (m.whole || (!m.size && tw == null)) return { whole: true };
  const su = m.size ?? tw ?? 1;
  return { whole: false, su, sv: m.sizeV ?? td ?? su };
}
function rugMaterial(S, c) {
  const e = rugEntry(S);
  if (!e) {   // однотонный: цвет из старого поля rug
    const f = opt('rug', S.rug === 'none' ? 'wool-light' : S.rug);
    return cached(`furn_rug_${f.id}`, () => {
      const m = physical({ color: f.color, roughness: 1, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color('#ffffff') });
      m.normalMap = fabricNormal('boucle', 0.22); m.normalScale.set(1, 1);
      return m;
    });
  }
  const key = `furn_rug_${e.id}`, fresh = !MATS.has(key);
  const m = cached(key, () => physical({ color: e.color || '#d9d3c7', roughness: 1,
    sheen: e.pile === 'medium' || e.pile === 'high' ? 0.6 : 0.3, sheenRoughness: 0.8, sheenColor: new THREE.Color('#ffffff') }));
  if (fresh && e.tex) {
    const t = rugTiling(e);
    READY.set(m, applyItem(m, { tex: rugTexId(e), size: t.whole ? 1 : t.su, sizeV: t.whole ? 1 : t.sv, rough: 1, normalScale: 1 })
      .then(() => { if (!m.map) m.color.set(e.color || '#d9d3c7'); })   // нет текстуры — остаётся цвет
      .catch(() => {}));
  }
  if (READY.has(m)) c.ready.push(READY.get(m));
  return m;
}
function buildRug(S, c) {
  if (S.rugModel === 'none') return null;
  const e = rugEntry(S), { w, d } = rugSizeOf(S);
  const g = itemGroup('rug'), ctx = { id: 'rug', slot: 'rug', group: g, n: 0 };
  g.userData.noCollide = true;
  const h = e?.height ?? PILE[e?.pile] ?? c.spec.rug?.thickness ?? 0.012, r = 0.025;
  const whole = !!e && rugTiling(e).whole;
  const mat = rugMaterial(S, c);
  part(slab(roundRect(w, d, r), h, w, d, whole), mat, 0, 0, 0, ctx, { cast: false, uv: false });
  // Кант по краю: своя полоса из записи border или тон ковра темнее
  const bw = e?.border?.w ?? 0.012, bc = e?.border?.color ?? new THREE.Color(e?.color || opt('rug', S.rug === 'none' ? 'wool-light' : S.rug).color).multiplyScalar(0.82).getHexString();
  const bcol = String(bc).startsWith('#') ? bc : `#${bc}`;
  const ring = roundRect(w, d, r);
  ring.holes.push(roundRect(w - 2 * bw, d - 2 * bw, Math.max(0.005, r - bw), new THREE.Path()));
  part(slab(ring, h + 0.0015, w, d, false), cached(`furn_rug_edge_${bcol}`, () => physical({ color: bcol, roughness: 0.95, sheen: 0.3, sheenRoughness: 0.8 })),
    0, 0, 0, ctx, { cast: false, uv: false });
  // Бахрома на коротких сторонах
  if (e?.fringe) {
    const len = typeof e.fringe === 'number' ? e.fringe : 0.06, alongX = w < d;   // короткая сторона
    const edge = alongX ? w : d, n = Math.max(2, Math.floor(edge / 0.012));
    const fm = cached('furn_rug_fringe', () => physical({ color: '#ebe4d6', roughness: 1 }));
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(alongX ? 0.004 : len, 0.002, alongX ? len : 0.004), fm, n * 2);
    const mx = new THREE.Matrix4();
    let k = 0;
    for (const sgn of [-1, 1]) for (let i = 0; i < n; i++) {
      const t = -edge / 2 + (i + 0.5) * (edge / n), off = sgn * ((alongX ? d : w) / 2 + len / 2 - 0.005);
      mx.makeTranslation(alongX ? t : off, 0.001, alongX ? off : t);
      im.setMatrixAt(k++, mx);
    }
    im.userData.slot = 'rug'; im.userData.furnId = 'rug'; im.name = 'rug_fringe'; im.receiveShadow = true;
    g.add(im);
  }
  g.userData.footprint.push([-w / 2, -d / 2, w / 2, d / 2]);
  Object.assign(g.userData, { size: [w, d], model: e?.id ?? 'basic' });
  return g;
}

// ---------- телевизор ----------
// Локально: начало — центр экрана, экран смотрит в +Z, ширина по X.

function tvDims(S) {
  const diag = Number(S.tvSize) * 0.0254, k = Math.hypot(16, 9);
  return { pw: diag * 16 / k, ph: diag * 9 / k };
}
function buildTV(S, c) {
  const t = c.spec.tv, g = itemGroup('tv'), ctx = { id: 'tv', slot: 'tv', group: g, n: 0 };
  const { pw, ph } = tvDims(S), b = t.bezel, body = tvBody();
  part(hardBox(pw + 2 * b, ph + 2 * b, t.depth, 0.004), body, 0, 0, 0, ctx);
  const screen = part(new THREE.PlaneGeometry(pw, ph), screenMat(S.tvOn === 'on'), 0, 0, t.depth / 2 + 0.0004, ctx, { cast: false, uv: false });
  screen.name = 'tv_screen'; screen.userData.tvScreen = true;   // ищут tv.js (плеер) и seats.js (взгляд с дивана)
  part(hardBox(pw * 0.62, ph * 0.6, t.backDepth, 0.01), body, 0, -ph * 0.08, -t.depth / 2 - t.backDepth / 2, ctx);
  const bottom = -(ph / 2 + b);
  if (S.tv === 'stand') {
    // Подставка-пьедестал по центру; без тумбы — напольная стойка (высоту подгоняет placeFurniture)
    part(hardBox(0.07, t.standH + 0.04, 0.03, 0.006), metalBlack(), 0, bottom - t.standH / 2 + 0.02, -0.01, ctx);
    const base = part(hardBox(0.36, 0.012, 0.24, 0.004), metalBlack(), 0, bottom - t.standH + 0.006, 0, ctx);
    if (S.console === 'none') {
      const col = part(new THREE.BoxGeometry(0.06, 1, 0.04), metalBlack(), 0, 0, -0.03, ctx, { uv: false });
      metreUV(col.geometry); col.name = 'tv_floor_column';
      base.geometry.dispose(); base.geometry = metreUV(hardBox(0.6, 0.015, t.floorStandD, 0.005));
      base.name = 'tv_floor_base';
      g.userData.footprint.push([-0.3, -t.floorStandD / 2, 0.3, t.floorStandD / 2]);
    }
  }
  Object.assign(g.userData, { halfW: pw / 2 + b, halfH: ph / 2 + b });
  return g;
}
// Напольная стойка: колонна от пола до низа ТВ, плита на полу (ty — высота центра экрана в мире).
function fitFloorStand(tv, ty) {
  const col = tv.getObjectByName('tv_floor_column'), base = tv.getObjectByName('tv_floor_base');
  if (!col) return;
  const hh = tv.userData.halfH, len = Math.max(0.05, ty - hh);
  col.scale.y = len; col.position.y = -hh - len / 2;
  if (base) base.position.y = -ty + 0.0075;
}

// ---------- тумба ----------
// Локально: начало — центр следа на полу, фасад в +Z, длина по X. Середина открыта под приставку/ресивер.

function consoleTop(S, spec) {
  const c = spec.consoles[S.console];
  return c ? (c.base === 'wall' ? c.mountY + c.h : c.h) : 0;
}
function buildConsole(S, c) {
  const k = c.spec.consoles[S.console];
  const g = itemGroup('console'), ctx = { id: 'console', slot: 'console', group: g, n: 0 };
  const mat = finishMat(S.consoleFinish, c);
  const W = clamp(S.consoleW, c.spec.consoleW.min, c.spec.consoleW.max), D = k.d, t = 0.018;
  const y0 = k.base === 'wall' ? k.mountY : k.baseH, top = consoleTop(S, c.spec), ih = top - y0 - 2 * t;
  part(hardBox(W, t, D, 0.003), mat, 0, top - t / 2, 0, ctx);                       // крышка
  part(hardBox(W, t, D, 0.003), mat, 0, y0 + t / 2, 0, ctx);                        // дно
  for (const sx of [-1, 1]) part(hardBox(t, ih, D, 0.002), mat, sx * (W / 2 - t / 2), y0 + t + ih / 2, 0, ctx);
  part(hardBox(W - 2 * t, ih, 0.008, 0), mat, 0, y0 + t + ih / 2, -D / 2 + 0.004, ctx, { cast: false });   // задняя стенка
  // Секции: перегородки, фасады без ручек (нажимные), средняя секция открытая
  // нечётное число секций (3 или 5), чтобы открытая была ровно посередине
  const n = clamp(2 * Math.round((W / 0.55 - 1) / 2) + 1, 3, 5), sw = (W - 2 * t - (n - 1) * t) / n, open = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const x0 = -W / 2 + t + i * (sw + t);
    if (i > 0) part(hardBox(t, ih, D - t - 0.01, 0), mat, x0 - t / 2, y0 + t + ih / 2, -t / 2, ctx);
    if (i === open) {
      part(hardBox(Math.min(0.28, sw - 0.06), 0.06, 0.22, 0.01), gadgetMat(), x0 + sw / 2, y0 + t + 0.03, -D / 2 + 0.16, ctx);
    } else {
      part(hardBox(sw - 0.006, ih - 0.006, t, 0.002), mat, x0 + sw / 2, y0 + t + ih / 2, D / 2 - t / 2, ctx);
    }
  }
  // Опора
  if (k.base === 'plinth') part(hardBox(W - 0.06, y0, D - 0.08, 0), plinthMat(), 0, y0 / 2, -0.01, ctx, { cast: false });
  if (k.base === 'legs') {
    const lm = isWood(S.consoleFinish) ? mat : metalBlack();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(new THREE.CylinderGeometry(0.016, 0.011, y0, 14), lm, sx * (W / 2 - 0.08), y0 / 2, sz * (D / 2 - 0.07), ctx);
  }
  g.userData.footprint.push([-W / 2, -D / 2, W / 2, D / 2]);
  Object.assign(g.userData, { halfW: W / 2, top, depth: D, wallGap: k.wallGap });
  return g;
}

// ---------- журнальный столик ----------
// Локально: начало — центр следа, длинная сторона по X. При tableRot = 0 параллелен дивану.

function buildTable(S, c) {
  const k = c.spec.tables[S.table], g = itemGroup('table'), ctx = { id: 'table', slot: 'table', group: g, n: 0 };
  const mat = finishMat(S.consoleFinish, c), th = 0.03, H = k.h;
  if (S.table === 'round') {
    const r = k.w / 2, e = 0.01, pts = [new THREE.Vector2(0, 0)];
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI; pts.push(new THREE.Vector2(r - e + Math.cos(a) * e, th / 2 + Math.sin(a) * (th / 2))); }
    pts.push(new THREE.Vector2(0, th));
    part(new THREE.LatheGeometry(pts, 64), mat, 0, H - th, 0, ctx);
    part(new THREE.CylinderGeometry(r * 0.55, r * 0.55, H - th, 48), mat, 0, (H - th) / 2, 0, ctx);
  } else if (S.table === 'oval') {
    const sh = new THREE.Shape(); sh.absellipse(0, 0, k.w / 2 - 0.006, k.d / 2 - 0.006, 0, Math.PI * 2);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: th - 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 64 });
    geo.rotateX(-Math.PI / 2);
    part(geo, mat, 0, H - th + 0.006, 0, ctx);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(new THREE.CylinderGeometry(0.014, 0.011, H - th, 12), metalBlack(), sx * k.w * 0.3, (H - th) / 2, sz * k.d * 0.24, ctx);
  } else {
    part(hardBox(k.w, th, k.d, 0.008), mat, 0, H - th / 2, 0, ctx);
    const lm = isWood(S.consoleFinish) ? mat : metalBlack();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(hardBox(0.035, H - th, 0.035, 0.004), lm, sx * (k.w / 2 - 0.05), (H - th) / 2, sz * (k.d / 2 - 0.05), ctx);
  }
  g.userData.footprint.push([-k.w / 2, -k.d / 2, k.w / 2, k.d / 2]);
  return g;
}

// ---------- геометрия плана: стена ТВ, препятствия, проверки ----------

// Комната и стена с ТВ (край комнаты по X). dir — куда «в комнату» от стены по X.
function wallOf(plan, spec) {
  const rs = plan.rooms[spec.room].rects;
  const R = { x0: Math.min(...rs.map(r => r.x0)), x1: Math.max(...rs.map(r => r.x1)), z0: Math.min(...rs.map(r => r.z0)), z1: Math.max(...rs.map(r => r.z1)) };
  const edge = spec.tvWall?.edge === 'x0' ? 'x0' : 'x1', x = R[edge], dir = edge === 'x1' ? -1 : 1;
  const on = rs.filter(r => Math.abs(r[edge] - x) < 0.01);
  return { R, x, dir, z0: Math.min(...on.map(r => r.z0)), z1: Math.max(...on.map(r => r.z1)), rotY: dir < 0 ? -Math.PI / 2 : Math.PI / 2 };
}

// Зоны открывания дверей внутрь комнаты (створка = ширина минус глухие части).
function doorSwings(plan, spec) {
  const { R } = wallOf(plan, spec), out = [];
  for (const o of plan.openings) {
    if (o.type !== 'door' && o.type !== 'interior') continue;
    if (o.room_id && o.room_id !== spec.room) continue;      // межкомнатные открываются в свою комнату
    const leaf = (o.width ?? 0) - (o.fixed_left ?? 0) - (o.fixed_right ?? 0);
    if (leaf <= 0) continue;
    if (o.along === 'x' && o.x1 > R.x0 && o.x0 < R.x1) {
      const a = o.x0 + (o.fixed_left ?? 0), b = o.x1 - (o.fixed_right ?? 0);
      if (Math.abs(o.z1 - R.z0) < 0.05) out.push({ id: o.id, x0: a, x1: b, z0: R.z0, z1: R.z0 + leaf });
      else if (Math.abs(o.z0 - R.z1) < 0.05) out.push({ id: o.id, x0: a, x1: b, z0: R.z1 - leaf, z1: R.z1 });
    } else if (o.along === 'z' && o.z1 > R.z0 && o.z0 < R.z1) {
      if (Math.abs(o.x1 - R.x0) < 0.05) out.push({ id: o.id, x0: R.x0, x1: R.x0 + leaf, z0: o.z0, z1: o.z1 });
      else if (Math.abs(o.x0 - R.x1) < 0.05) out.push({ id: o.id, x0: R.x1 - leaf, x1: R.x1, z0: o.z0, z1: o.z1 });
    }
  }
  return out;
}

// Неподвижные препятствия на полу: стены, кухонный ряд, остров, радиаторы, (зоны дверей).
// Ковру мешают только стены, кухня и остров: радиаторы висят над полом, ковёр проходит под ними.
const rugObstacles = list => list.filter(o => !/radiator/.test(o.id ?? ''));
function floorObstacles(plan, kit, state, spec, { swings = true, island = null } = {}) {
  const out = plan.walls.map(w => ({ id: 'wall', x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1 }));
  if (kit) {
    const wx = kit.run.wallX ?? 0, len = kit.run.modules.reduce((s, m) => s + m.w, 0);
    out.push({ id: 'run', x0: wx, x1: wx + kit.run.depth + (kit.worktop?.overhang ?? 0), z0: kit.run.startZ - len, z1: kit.run.startZ });
    const r = kit.radiator;
    if (r) out.push({ id: 'radiator', x0: r.centerX - r.w / 2, x1: r.centerX + r.w / 2, z0: 0, z1: 0.035 + r.depth });
  }
  const isl = island ?? (kit ? islandBox(kit, state) : null);
  if (isl) out.push({ id: 'island', x0: isl.x0, x1: isl.x1, z0: isl.z0, z1: isl.z1 });
  for (const o of spec.extraObstacles ?? []) out.push({ ...o });
  if (swings && spec.clearance?.doorSwing) out.push(...doorSwings(plan, spec));
  return out;
}

// Прямоугольник следа [x0,z0,x1,z1] в мир (поворот вокруг Y как у three: x' = x cos + z sin, z' = −x sin + z cos).
function rectCorners(r, px, pz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map(([x, z]) => [px + x * c + z * s, pz - x * s + z * c]);
}
const aabb = poly => ({ x0: Math.min(...poly.map(p => p[0])), x1: Math.max(...poly.map(p => p[0])), z0: Math.min(...poly.map(p => p[1])), z1: Math.max(...poly.map(p => p[1])) });
function worldPolys(o, pos = o.position, yaw = yawOf(o)) {
  return (o.userData.footprint || []).map(r => rectCorners(r, pos.x, pos.z, yaw));
}

// Минимальный сдвиг, выталкивающий повёрнутый прямоугольник из прямоугольника по осям (SAT), или null.
function pushOut(poly, b) {
  const box = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
  const axes = [[1, 0], [0, 1]];
  for (let i = 0; i < 2; i++) {
    const ex = poly[i + 1][0] - poly[i][0], ez = poly[i + 1][1] - poly[i][1], l = Math.hypot(ex, ez) || 1;
    axes.push([-ez / l, ex / l]);
  }
  let best = null;
  for (const [ax, az] of axes) {
    const pa = poly.map(p => p[0] * ax + p[1] * az), pb = box.map(p => p[0] * ax + p[1] * az);
    const amin = Math.min(...pa), amax = Math.max(...pa), bmin = Math.min(...pb), bmax = Math.max(...pb);
    const ov = Math.min(amax - bmin, bmax - amin);
    if (ov <= 1e-6) return null;
    if (!best || ov < best.ov) best = { ov, ax, az, sign: (amin + amax) / 2 < (bmin + bmax) / 2 ? -1 : 1 };
  }
  return [best.ax * best.ov * best.sign, best.az * best.ov * best.sign];
}

// Сдвигает предмет (pos — {x,z}) так, чтобы его след был внутри комнаты и не заходил в препятствия.
function resolveFloor(footprint, pos, yaw, R, obstacles, margin = 0) {
  for (let it = 0; it < 8; it++) {
    let moved = false;
    for (const r of footprint) {
      for (const o of obstacles) {
        const poly = rectCorners(r, pos.x, pos.z, yaw), mtv = pushOut(poly, o);
        if (mtv && Math.hypot(mtv[0], mtv[1]) > 1e-5) { pos.x += mtv[0] * 1.0001; pos.z += mtv[1] * 1.0001; moved = true; }
      }
    }
    const all = footprint.flatMap(r => rectCorners(r, pos.x, pos.z, yaw)), b = aabb(all);
    let dx = 0, dz = 0;
    if (b.x0 < R.x0 + margin) dx = R.x0 + margin - b.x0; else if (b.x1 > R.x1 - margin) dx = R.x1 - margin - b.x1;
    if (b.z0 < R.z0 + margin) dz = R.z0 + margin - b.z0; else if (b.z1 > R.z1 - margin) dz = R.z1 - margin - b.z1;
    if (dx || dz) { pos.x += dx; pos.z += dz; moved = true; }
    if (!moved) break;
  }
  return pos;
}

// Заходит ли след в препятствия или за стены комнаты.
function collides(footprint, pos, yaw, R, obstacles) {
  for (const r of footprint) {
    const poly = rectCorners(r, pos.x, pos.z, yaw), b = aabb(poly);
    if (b.x0 < R.x0 - 1e-4 || b.x1 > R.x1 + 1e-4 || b.z0 < R.z0 - 1e-4 || b.z1 > R.z1 + 1e-4) return true;
    for (const o of obstacles) if (pushOut(poly, o)) return true;
  }
  return false;
}

// Допустимые положения центра вдоль стены (интервалы по Z) для предмета шириной 2·half в полосе X [xa, xb].
function alongAllowed(half, xa, xb, W, obstacles, margin) {
  let iv = [[W.z0 + half + margin, W.z1 - half - margin]];
  for (const o of obstacles) {
    if (!(o.x0 < xb && o.x1 > xa)) continue;
    const fa = o.z0 - half, fb = o.z1 + half;
    iv = iv.flatMap(([a, b]) => (fb <= a || fa >= b) ? [[a, b]] : [[a, Math.min(b, fa)], [Math.max(a, fb), b]].filter(([p, q]) => q - p > -1e-9));
  }
  return iv.filter(([a, b]) => b >= a);
}
const intersectIv = (A, B) => A.flatMap(([a, b]) => B.map(([c, d]) => [Math.max(a, c), Math.min(b, d)])).filter(([a, b]) => b >= a);
function clampIv(iv, v, fallback) {
  if (!iv.length) return fallback;
  let best = v, bd = Infinity;
  for (const [a, b] of iv) { const c = clamp(v, a, b), d = Math.abs(c - v); if (d < bd) { bd = d; best = c; } }
  return best;
}
// Препятствия на стене ТВ: стены/радиаторы на полу (для тумбы) и проёмы в самой стене (для ТВ).
function wallObstacles(plan, spec) {
  const holes = plan.openings.map(o => ({ id: o.id, x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1 }));
  return { floor: [...plan.walls.map(w => ({ x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1 })), ...(spec.extraObstacles ?? [])], holes };
}

// Положения ТВ и тумбы у стены. При связке (tvLink или ТВ на подставке) ведущее значение — tvAlong.
function wallPoses(S, spec, W, items, obs) {
  const tv = items.tv, cons = items.console, t = spec.tv, m = spec.clearance?.wallMargin ?? 0.02;
  const out = {};
  const linked = S.tvLink === 'on' || (S.tv === 'stand' && !!cons);
  let ivC = null, ivT = null;
  if (cons) {
    const gap = cons.userData.wallGap, d = cons.userData.depth;
    out.cx = W.x + W.dir * (gap + d / 2);
    const xs = [W.x + W.dir * gap, W.x + W.dir * (gap + d)].sort((a, b) => a - b);
    ivC = alongAllowed(cons.userData.halfW, xs[0], xs[1], W, obs.floor, m);
  }
  if (tv) {
    const xs = [W.x + W.dir * 0.15, W.x + W.dir * -0.05].sort((a, b) => a - b);
    ivT = alongAllowed(tv.userData.halfW, xs[0], xs[1], W, obs.holes, m);
  }
  const mid = (W.z0 + W.z1) / 2;
  if (linked && cons && tv) { out.cz = out.tz = clampIv(intersectIv(ivC, ivT), S.tvAlong, mid); }
  else {
    if (cons) out.cz = clampIv(ivC, linked ? S.tvAlong : S.consoleAlong, mid);
    if (tv) out.tz = clampIv(ivT, S.tvAlong, mid);
  }
  if (tv) {
    const hh = tv.userData.halfH;
    if (S.tv === 'stand' && cons) {
      out.tx = out.cx; out.ty = cons.userData.top + t.standH + hh;
    } else if (S.tv === 'stand') {
      out.tx = W.x + W.dir * (t.floorStandD / 2 + 0.05); out.ty = clamp(S.tvY, Math.max(t.yMin, hh + 0.3), t.yMax);
    } else {
      out.tx = W.x + W.dir * (t.mountGap + t.backDepth + t.depth / 2);
      out.ty = clamp(S.tvY, Math.max(t.yMin, hh + 0.05), t.yMax);
      if (cons && Math.abs(out.tz - out.cz) < tv.userData.halfW + cons.userData.halfW) {
        out.ty = Math.max(out.ty, cons.userData.top + (spec.clearance?.tvAboveConsole ?? 0.06) + hh);
      }
    }
  }
  return out;
}

// ---------- сборка и расстановка ----------

const RESULTS = new WeakMap();   // группа → результат сборки (в userData нельзя: GLTFExporter пишет его в extras)

/**
 * Собирает мебель по состоянию. spec — FURN_SPEC (или null → он же), M — материалы main.js (нужен M.fronts),
 * plan/kit — как в main.js. Возвращает { group, items: {sofa, tv, console, rug, table}, colliders, ready }.
 * ready — промис загрузки текстур дерева (после него перерисовать кадр).
 */
export function buildFurniture(spec, state = {}, M = {}, plan = null, kit = null) {
  spec = spec || FURN_SPEC;
  const group = new THREE.Group(); group.name = 'furniture';
  const out = { group, items: { sofa: null, tv: null, console: null, rug: null, table: null }, colliders: [], ready: Promise.resolve() };
  RESULTS.set(group, out);
  if (!spec?.sofas) return out;
  const S = norm(state), ready = [], c = { spec, M, ready }, it = out.items;
  it.sofa = buildSofa(S, c);
  it.rug = buildRug(S, c);
  if (S.console !== 'none' && spec.consoles[S.console]) it.console = buildConsole(S, c);
  if (S.tv !== 'none') it.tv = buildTV(S, c);
  if (S.table !== 'none' && spec.tables[S.table]) it.table = buildTable(S, c);
  for (const k of ['rug', 'sofa', 'console', 'tv', 'table']) if (it[k]) group.add(it[k]);
  out.ready = Promise.all(ready).then(() => undefined);
  if (plan) placeFurniture(out, state, plan, kit, spec);
  return out;
}

// Положение дивана «спинкой к острову»: спинка вплотную к стороне острова в гостиную, центр по острову, лицом к ТВ.
function islandPose(isl, depth) {
  return { x: isl.x1 + depth / 2, z: (isl.z0 + isl.z1) / 2, rot: 0 };
}

/**
 * Ставит уже собранную мебель по позициям из state (без пересборки геометрии). Диван, столик и ковёр
 * не заходят в стены, кухню и остров; ТВ и тумба держатся своей стены. sofaSnap = island — диван
 * прижат к острову (следует за ним при сдвиге острова). Обновляет furn.colliders.
 */
export function placeFurniture(furn, state, plan, kit = null, spec = FURN_SPEC) {
  if (!furn || !spec?.sofas || !plan) return furn;
  const S = norm(state), W = wallOf(plan, spec), it = furn.items;
  const fixed = floorObstacles(plan, kit, state, spec, { swings: false });
  const isl = kit ? islandBox(kit, state) : null;
  let sofa = [S.sofaX, S.sofaZ, S.sofaRot];
  if (S.sofaSnap === 'island' && isl && it.sofa) { const q = islandPose(isl, it.sofa.userData.depth ?? 0.95); sofa = [q.x, q.z, q.rot]; }
  for (const [key, x, z, rot, margin] of [['sofa', ...sofa, 0], ['table', S.tableX, S.tableZ, S.tableRot, 0], ['rug', S.rugX, S.rugZ, S.rugRot, 0.03]]) {
    const o = it[key];
    if (!o) continue;
    const yaw = rad(90 + rot), pos = { x, z };
    if (o.userData.footprint.length) resolveFloor(o.userData.footprint, pos, yaw, W.R, key === 'rug' ? rugObstacles(fixed) : fixed, margin);
    o.position.set(pos.x, 0, pos.z); o.rotation.set(0, yaw, 0);
  }
  const P = wallPoses(S, spec, W, it, wallObstacles(plan, spec));
  if (it.console) { it.console.position.set(P.cx, 0, P.cz); it.console.rotation.set(0, W.rotY, 0); }
  if (it.tv) { it.tv.position.set(P.tx, P.ty, P.tz); it.tv.rotation.set(0, W.rotY, 0); fitFloorStand(it.tv, P.ty); }
  furn.colliders = collidersOf(furn);
  return furn;
}

// Следы на полу для режима прогулки: AABB, ковёр не мешает.
function collidersOf(furn) {
  const out = [];
  for (const o of Object.values(furn.items)) {
    if (!o?.userData?.isItem || o.userData.noCollide) continue;
    for (const poly of worldPolys(o)) out.push({ id: o.userData.furnId, ...aabb(poly) });
  }
  return out;
}

// ---------- опоры для обстановки (decor.js: поле anchor части) ----------
// Кадр вещи { x, y, z, r } (r — поворот вокруг Y): диван — по высоте сиденья, тумба — передняя кромка крышки
// (смена типа тумбы меняет высоту и глубину — вещи на ней едут следом), столик — по столешнице, ТВ — центр экрана,
// остров — центр следа на полу. def — та же вещь в состоянии по умолчанию: её один раз собирают из FURN_DEFAULTS
// (геометрия сразу освобождается). У ТВ и тумбы есть span { z0, z1 } — концы стены ТВ: часть с опорой, что
// вылезла бы за конец стены, decor.js прячет. Объекты переиспользуются: зов без выделений.
const ANCHOR_ITEMS = ['sofa', 'tv', 'console', 'table'];
let DEF_FRAMES = null;
const frame = () => ({ x: 0, y: 0, z: 0, r: 0 });
const CUR_FRAMES = { sofa: frame(), tv: frame(), console: frame(), table: frame(), island: frame() };
const PAIRS = Object.fromEntries(Object.keys(CUR_FRAMES).map(k => [k, { cur: CUR_FRAMES[k], def: null, span: null }]));
const ANCHORS_OUT = {};
let SPAN_PLAN = null;
const seatHOf = S => sofaEntry(S)?.seatH ?? FURN_SPEC?.sofas?.[basicShape(S, FURN_SPEC)]?.seatH ?? 0.45;
function itemFrame(out, id, o, S) {
  if (!o) return null;
  out.x = o.position.x; out.z = o.position.z; out.r = yawOf(o);
  out.y = id === 'sofa' ? seatHOf(S) : id === 'console' ? (o.userData.top ?? 0) : id === 'table' ? (FURN_SPEC.tables?.[S.table]?.h ?? 0) : o.position.y;
  if (id === 'console') { const h = (o.userData.depth ?? 0) / 2; out.x += Math.sin(out.r) * h; out.z += Math.cos(out.r) * h; }
  return out;
}
function islandFrame(out, isl) {
  if (!isl) return null;
  out.x = (isl.x0 + isl.x1) / 2; out.z = (isl.z0 + isl.z1) / 2; out.y = 0; out.r = 0;
  return out;
}
/**
 * Опоры для decor.js: { sofa, tv, console, table, island } -> { cur, def } (вещь есть), null (вещи сейчас нет)
 * или undefined (нет её положения по умолчанию — опора не применяется). furn — результат buildFurniture
 * (положения берутся с живых объектов: годится и во время перетаскивания). Без plan — undefined.
 */
export function furnitureAnchors(furn, state, plan, kit = kitJSON) {
  if (!plan) return undefined;
  if (!DEF_FRAMES) {
    const d = FURN_SPEC?.sofas ? buildFurniture(FURN_SPEC, FURN_DEFAULTS, {}, plan, kit) : null, S = norm(FURN_DEFAULTS);
    DEF_FRAMES = { island: islandFrame(frame(), kit ? islandBox(kit, {}) : null) };
    for (const id of ANCHOR_ITEMS) DEF_FRAMES[id] = itemFrame(frame(), id, d?.items[id], S);
    d?.group.traverse(o => o.geometry?.dispose());   // модель дивана (GLB) приедет позже и в эту группу: её не трогаем
  }
  if (SPAN_PLAN !== plan) {   // концы стены ТВ — раз на план
    SPAN_PLAN = plan;
    let w = null;
    try { w = FURN_SPEC?.room && wallOf(plan, FURN_SPEC); } catch { w = null; }
    PAIRS.tv.span = PAIRS.console.span = w ? { z0: w.z0, z1: w.z1 } : null;
  }
  const S = norm(state), it = furn?.items ?? {};
  for (const id of ANCHOR_ITEMS) {
    const def = DEF_FRAMES[id], cur = def && itemFrame(CUR_FRAMES[id], id, it[id]?.visible === false ? null : it[id], S);
    if (cur) PAIRS[id].def = def;
    ANCHORS_OUT[id] = !def ? undefined : cur ? PAIRS[id] : null;
  }
  const isl = DEF_FRAMES.island && islandFrame(CUR_FRAMES.island, kit ? islandBox(kit, state) : null);
  PAIRS.island.def = DEF_FRAMES.island;
  ANCHORS_OUT.island = !DEF_FRAMES.island ? undefined : isl ? PAIRS.island : null;
  return ANCHORS_OUT;
}

// ---------- редактор в сцене ----------

const NAMES = { sofa: 'Диван', tv: 'Телевизор', console: 'Тумба', table: 'Столик', rug: 'Ковёр' };
const ROTATABLE = new Set(['sofa', 'table', 'rug']);
const MAGNET = 0.05;   // диван липнет к стороне острова и к его середине ближе 5 см
// Поля положения каждой вещи — для «На место» у выделенной
const PLACE_OF = { sofa: ['sofaX', 'sofaZ', 'sofaRot', 'sofaSnap'], table: ['tableX', 'tableZ', 'tableRot'], rug: ['rugX', 'rugZ', 'rugRot'],
  tv: ['tvY', 'tvAlong', 'consoleAlong'], console: ['consoleAlong', 'tvAlong'] };
const SUPPORT_GROUPS = new Set(['decor', 'furniture', 'kitchen', 'floors', 'fixtures', 'bath']);   // на что можно поставить вещь
const holderOf = o => { while (o) { if (decorPart(o)) return o; o = o.parent; } return null; };
const shown = o => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };

// След (прямоугольник [x0,z0,x1,z1] в координатах части) против прямоугольников по осям и границ R — без выделений.
const CR = new Float64Array(8);
function rectHits(r, px, pz, yaw, obs, R) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  CR[0] = px + r[0] * c + r[1] * s; CR[1] = pz - r[0] * s + r[1] * c;
  CR[2] = px + r[2] * c + r[1] * s; CR[3] = pz - r[2] * s + r[1] * c;
  CR[4] = px + r[2] * c + r[3] * s; CR[5] = pz - r[2] * s + r[3] * c;
  CR[6] = px + r[0] * c + r[3] * s; CR[7] = pz - r[0] * s + r[3] * c;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < 8; i += 2) { x0 = Math.min(x0, CR[i]); x1 = Math.max(x1, CR[i]); z0 = Math.min(z0, CR[i + 1]); z1 = Math.max(z1, CR[i + 1]); }
  if (x0 < R.x0 || x1 > R.x1 || z0 < R.z0 || z1 > R.z1) return true;
  for (const o of obs) {
    if (x1 <= o.x0 + 1e-6 || x0 >= o.x1 - 1e-6 || z1 <= o.z0 + 1e-6 || z0 >= o.z1 - 1e-6) continue;   // оси X и Z
    let apart = false;
    for (let k = 0; k < 2 && !apart; k++) {   // свои оси прямоугольника
      const ax = k ? s : c, az = k ? c : -s;
      let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
      for (let i = 0; i < 8; i += 2) { const p = CR[i] * ax + CR[i + 1] * az; p0 = Math.min(p0, p); p1 = Math.max(p1, p); }
      for (const bx of [o.x0, o.x1]) for (const bz of [o.z0, o.z1]) { const q = bx * ax + bz * az; q0 = Math.min(q0, q); q1 = Math.max(q1, q); }
      apart = p1 <= q0 + 1e-6 || q1 <= p0 + 1e-6;
    }
    if (!apart) return true;
  }
  return false;
}

/**
 * Редактор: клик по мебели или любой части обстановки выделяет её; тянуть мышью сам предмет или стрелки гизмо.
 * Напольное ездит по полу (стены не пускают), настенное — вдоль своей стены (в её плоскости, в пределах стены),
 * стоящее на чём-то (полка, тумба, остров, столешница) — по своей поверхности и опускается на то, что под ним.
 * Привязка 1 см и 15°, Shift — без привязки. R — вращать, T/G — двигать, Esc — снять выделение.
 * Пока тянешь, облёт выключен; в state пишется один раз, когда отпустил (setState): мебель — своими полями,
 * обстановка — строкой state.moves (decor.js). Вещи на опорах (тумба, ТВ, остров…) едут за ними сразу.
 * main должен звать editor.renderOverlay() после каждого кадра: гизмо рисуется поверх (вне GTAO
 * и вне основного raycast), подписи замеров обновляются там же.
 */
export function createFurnitureEditor({ camera, renderer, scene, controls, getState, setState, requestRender = () => {}, plan, kit = null, spec = FURN_SPEC, onSelect = null }) {
  if (!spec?.sofas || !plan) {   // нет спеки мебели — редактор-пустышка, main не ломается
    const noop = () => {};
    return { enable: noop, disable: noop, select: noop, setMode: noop, dispose: noop, renderOverlay: noop, overlayScene: new THREE.Scene(), selected: null, enabled: false };
  }
  const canvas = renderer.domElement;
  const overlayScene = new THREE.Scene(); overlayScene.name = 'furniture-editor';
  const tc = new TransformControls(camera, canvas);
  tc.enabled = false; tc.size = 0.75; tc.setSpace('world');
  overlayScene.add(tc.getHelper());
  const W = wallOf(plan, spec), wObs = wallObstacles(plan, spec);
  const passage = spec.clearance?.passage ?? 0.9;
  const H = plan.ceiling ?? 2.64, BOUNDS = plan.bounds ?? { x0: -1e3, x1: 1e3, z0: -1e3, z1: 1e3 };
  const WALLS = plan.walls.map(w => ({ x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1 }));
  const ROOM_RECTS = Object.values(plan.rooms).flatMap(r => r.rects ?? []);
  let enabled = false, selId = null, obj = null, part = null, mode = 'translate', free = false, changed = false;
  let last = null;   // последнее допустимое положение при перетаскивании: {x, z, yaw}

  const furnGroup = () => scene.getObjectByName('furniture');
  const decorNow = () => decorOf(scene.children.find(o => o.name === 'decor'));
  const itemObj = id => {
    if (id?.startsWith('d:')) { const h = decorNow()?.parts.get(id.slice(2)); return h && h.visible ? h : null; }
    return furnGroup()?.children.find(o => o.userData.isItem && o.userData.furnId === id) || null;
  };
  const items = () => {
    const r = {};
    for (const k of ['sofa', 'tv', 'console', 'table', 'rug']) r[k] = itemObj(k);
    return r;
  };
  function islandRect() {
    if (kit) return islandBox(kit, getState());
    const box = new THREE.Box3();
    scene.traverse(o => { if (o.isMesh && o.userData.slot === 'islandTop') box.expandByObject(o); });
    return box.isEmpty() ? null : { x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z };
  }
  // Обстановка на опорах (тумба, ТВ, столик, диван) едет за мебелью прямо во время перетаскивания
  function followAnchors() {
    const d = decorNow(), f = furnGroup();
    if (d && f) placeDecor(d, getState(), furnitureAnchors(RESULTS.get(f), getState(), plan, kit ?? kitJSON), { live: true });
  }

  // --- лучи: опора под вещью и поверхность под курсором ---
  const ray = new THREE.Raycaster(); ray.layers.set(0);
  const hits = [], targets = [], skip = new Set();
  const DOWN = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3(), _n = new THREE.Vector3(), _ndc = new THREE.Vector2();
  const support = { y: 0, on: '0' };
  function collectTargets() {
    targets.length = 0;
    for (const o of scene.children) if (SUPPORT_GROUPS.has(o.name)) targets.push(o);
  }
  function skipFrom(h) {   // сама вещь и всё, что на ней стоит, — не опора
    skip.add(h);
    for (const d of decorPart(h)?.deps ?? []) skipFrom(d);
  }
  const usable = h => !h.object.userData.glass && !h.object.userData.shadowOnly && shown(h.object) && !skip.has(holderOf(h.object));
  const upward = h => !!h.face && _n.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.5;
  function onOf(o) {   // на чём стоим: часть обстановки, вещь-опора, остров или ничего
    const h = holderOf(o);
    if (h) return decorPart(h).pkey;
    for (let p = o; p; p = p.parent) {
      const f = p.userData.furnId;
      if (f && f !== 'rug') return f;
      if (p.userData.slot === 'island' || p.userData.slot === 'islandTop') return 'island';
    }
    return '0';
  }
  // Первая обращённая вверх поверхность под точкой (x, from, z); нет ничего — пол
  function supportAt(x, from, z) {
    _o.set(x, from + 0.05, z); ray.set(_o, DOWN); ray.far = from + 0.06;
    hits.length = 0; ray.intersectObjects(targets, true, hits);
    support.y = 0; support.on = '0';
    for (const h of hits) if (usable(h) && upward(h)) { support.y = h.point.y; support.on = onOf(h.object); break; }
    return support;
  }
  function cursorRay(e) {
    const r = canvas.getBoundingClientRect();
    _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(_ndc, camera); ray.far = Infinity;
    return ray;
  }

  // Как держится часть без явного mount: есть опора прямо под основанием — стоит на ней, иначе висит на стене.
  function inferMount(h, info) {
    if (info.mount) return info.mount;
    collectTargets(); skip.clear(); skipFrom(h);
    const s = supportAt(h.position.x, h.position.y - 0.04, h.position.z);   // луч от самого основания (+1 см) вниз
    info.mount = h.position.y - s.y < 0.04 ? 'surface' : 'wall';
    skip.clear();
    return info.mount;
  }

  // --- выделение и настройка гизмо ---
  const rotatable = () => (part ? part.mount !== 'wall' : ROTATABLE.has(selId));
  function configure() {
    if (!obj) return;
    const S = norm(getState());
    tc.setSpace('world');
    if (part) {
      if (part.mount === 'wall') mode = 'translate';
      tc.setMode(mode);
      if (mode === 'rotate') { tc.showX = false; tc.showY = true; tc.showZ = false; }
      else if (part.mount === 'wall') { tc.setSpace('local'); tc.showX = true; tc.showY = true; tc.showZ = false; }
      else { tc.showX = true; tc.showY = false; tc.showZ = true; }
    } else if (ROTATABLE.has(selId)) {
      tc.setMode(mode);
      if (mode === 'rotate') { tc.showX = false; tc.showY = true; tc.showZ = false; }
      else { tc.showX = true; tc.showY = false; tc.showZ = true; }
    } else {
      mode = 'translate'; tc.setMode('translate');
      tc.showX = false; tc.showZ = true;
      tc.showY = selId === 'tv' && (S.tv === 'wall' || (S.tv === 'stand' && S.console === 'none'));
    }
    tc.setTranslationSnap(free ? null : 0.01);
    tc.setRotationSnap(free ? null : rad(15));
    updateToolbar();
  }
  function attach() {
    obj = selId ? itemObj(selId) : null;
    part = obj && selId.startsWith('d:') ? decorPart(obj) : null;
    if (part) inferMount(obj, part);
    if (obj) tc.attach(obj); else { tc.detach(); selId = null; }
    configure();
  }
  function select(id) {
    if (!enabled) return;
    const next = id && itemObj(id) ? id : null;
    if (next !== selId) mode = 'translate';
    selId = next;
    attach();
    requestRender();
    onSelect?.(selId);
  }
  // После setState main пересобирает мебель или обстановку: заново найти выделенный предмет
  function resync() {
    if (!selId || tc.dragging || drag) return;
    const o = itemObj(selId);
    if (o !== obj) { if (!o) onSelect?.(null); attach(); }
  }
  function setMode(m) { if (rotatable()) { mode = m; configure(); requestRender(); } }

  // --- ограничения при перетаскивании ---
  function floorObstaclesFor(id) {
    const list = floorObstacles(plan, kit, getState(), spec, { island: islandRect(), swings: id !== 'rug' });
    if (id === 'rug') return rugObstacles(list);   // ковёр — слой пола: под мебелью, радиаторами и в зоне двери можно
    for (const o of furnGroup()?.children ?? []) {
      if (!o.userData.isItem || o.userData.noCollide || o.userData.furnId === id) continue;
      for (const poly of worldPolys(o)) list.push(aabb(poly));
    }
    return list;
  }
  function constrain() {
    if (!obj) return;
    if (part) { constrainPart(); return; }
    const S = norm(getState());
    if (ROTATABLE.has(selId)) {
      // Скольжение вдоль препятствий: из последнего допустимого положения, без «туннеля» сквозь остров
      const fp = obj.userData.footprint, obs = floorObstaclesFor(selId), ok = (x, z, a) => !collides(fp, { x, z }, a, W.R, obs);
      let yaw = yawOf(obj), x = obj.position.x, z = obj.position.z;
      if (!last) last = { x, z, yaw };
      // Магнит: диван лицом к ТВ (±2°) липнет спинкой к острову и серединой к его середине
      const isl = selId === 'sofa' && !free ? islandRect() : null;
      if (isl && Math.abs(normDeg(deg(yaw) - 90)) <= 2) {
        const q = islandPose(isl, obj.userData.depth ?? 0.95);
        if (Math.abs(x - q.x) < MAGNET) { x = q.x; yaw = rad(90); }
        if (Math.abs(z - q.z) < MAGNET) z = q.z;
      }
      if (!ok(x, z, yaw)) {
        if (Math.abs(yaw - last.yaw) > 1e-6) {          // поворот: оттолкнуть, не вышло — оставить прежний угол
          const pos = resolveFloor(fp, { x, z }, yaw, W.R, obs);
          if (ok(pos.x, pos.z, yaw)) { x = pos.x; z = pos.z; } else yaw = last.yaw;
        }
        if (!ok(x, z, yaw)) {
          if (ok(x, last.z, yaw)) z = last.z;
          else if (ok(last.x, z, yaw)) x = last.x;
          else if (ok(last.x, last.z, yaw)) { x = last.x; z = last.z; }
          else { const pos = resolveFloor(fp, { x, z }, yaw, W.R, obs); x = pos.x; z = pos.z; }   // и раньше было внутри
        }
      }
      obj.rotation.set(0, yaw, 0);
      obj.position.set(x, 0, z);
      last = { x, z, yaw };
    } else {
      const it = items(), z = obj.position.z;
      const linked = S.tvLink === 'on' || (S.tv === 'stand' && !!it.console);
      const ov = selId === 'tv' ? { tvAlong: z, tvY: obj.position.y } : (linked ? { tvAlong: z, consoleAlong: z } : { consoleAlong: z });
      const P = wallPoses({ ...S, ...ov }, spec, W, it, wObs);
      if (it.console) it.console.position.set(P.cx, 0, P.cz);
      if (it.tv) { it.tv.position.set(P.tx, P.ty, P.tz); fitFloorStand(it.tv, P.ty); }
    }
    followAnchors();
  }

  // --- части обстановки: контекст перетаскивания (готовится один раз в начале) ---
  const mv = {
    fp: [0, 0, 0, 0], bad: false, y0: 0, refY: 0, on: undefined,
    // настенное: точка стены c0, касательная t, нормаль n, допустимый сдвиг вдоль стены [s0, s1] и высота [y0, y1]
    cx: 0, cz: 0, tx: 1, tz: 0, nx: 0, nz: 1, s0: 0, s1: 0, ya: 0, yb: H,
  };
  const inRoom = (x, z) => ROOM_RECTS.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const inOpening = (x, z) => plan.openings.some(o => x >= o.x0 - 0.02 && x <= o.x1 + 0.02 && z >= o.z0 - 0.02 && z <= o.z1 + 0.02);
  function beginPart() {
    const b = part.box, yaw = yawOf(obj);
    mv.y0 = mv.refY = obj.position.y; mv.on = undefined;
    collectTargets(); skip.clear(); skipFrom(obj);
    if (b) { mv.fp[0] = b.min.x + 0.01; mv.fp[1] = b.min.z + 0.01; mv.fp[2] = b.max.x - 0.01; mv.fp[3] = b.max.z - 0.01; }
    else mv.fp.fill(0);
    mv.bad = !!b && rectHits(mv.fp, obj.position.x, obj.position.z, yaw, WALLS, BOUNDS);   // уже стоит в стене — не мешать
    last = { x: obj.position.x, z: obj.position.z, yaw };
    if (part.mount !== 'wall') return;
    // Стена: шагаем вдоль неё, пока перед ней комната, а за ней стена — не проём (дверь, окно) и не другая комната
    mv.cx = obj.position.x; mv.cz = obj.position.z;
    mv.tx = Math.cos(yaw); mv.tz = -Math.sin(yaw); mv.nx = Math.sin(yaw); mv.nz = Math.cos(yaw);
    const back = (b ? (b.max.z - b.min.z) / 2 : 0) + 0.04;
    const okAt = s => {
      const px = mv.cx + mv.tx * s, pz = mv.cz + mv.tz * s, bx = px - mv.nx * back, bz = pz - mv.nz * back;
      return inRoom(px + mv.nx * 0.03, pz + mv.nz * 0.03) && !inRoom(bx, bz) && !inOpening(bx, bz);
    };
    const reach = dir => { let s = 0; while (Math.abs(s) < 8 && okAt(s + dir * 0.01)) s += dir * 0.01; return s; };
    const lo = reach(-1), hi = reach(1), mnx = b ? b.min.x : 0, mxx = b ? b.max.x : 0;
    mv.s0 = Math.min(0, lo - mnx); mv.s1 = Math.max(0, hi - mxx);
    const h = b ? b.max.y : 0;
    mv.ya = Math.min(0, obj.position.y); mv.yb = Math.max(obj.position.y, H - h);
  }
  // Скольжение части вдоль стен из последнего допустимого положения
  const partOk = (x, z, a) => mv.bad || !rectHits(mv.fp, x, z, a, WALLS, BOUNDS);
  function constrainPart(x = obj.position.x, z = obj.position.z, y = obj.position.y, yaw = yawOf(obj)) {
    const d = decorNow();
    if (!d) return;
    if (part.mount === 'wall') {
      let s = (x - mv.cx) * mv.tx + (z - mv.cz) * mv.tz;
      s = clamp(free ? s : Math.round(s * 100) / 100, mv.s0, mv.s1);
      y = clamp(free ? y : Math.round(y * 100) / 100, mv.ya, mv.yb);
      setDecorPose(d, obj, mv.cx + mv.tx * s, y, mv.cz + mv.tz * s, yaw);
      return;
    }
    if (!partOk(x, z, yaw)) {
      if (Math.abs(yaw - last.yaw) > 1e-6 && !partOk(x, z, yaw)) yaw = last.yaw;
      if (!partOk(x, z, yaw)) {
        if (partOk(x, last.z, yaw)) z = last.z;
        else if (partOk(last.x, z, yaw)) x = last.x;
        else { x = last.x; z = last.z; }
      }
    }
    last.x = x; last.z = z; last.yaw = yaw;
    if (part.mount === 'surface') { const s = supportAt(x, mv.refY, z); y = s.y; mv.on = s.on; }
    setDecorPose(d, obj, x, y, z, yaw);
  }
  function commit() {
    if (!obj) return;
    if (part) {
      const d = decorNow();
      if (!d) return;
      const moves = commitDecorPart(d, obj, getState().moves ?? '', part.mount === 'surface' ? mv.on : undefined);
      skip.clear();
      Promise.resolve(setState({ moves })).then(() => { resync(); updateToolbar(); requestRender(); });
      return;
    }
    const S = norm(getState()), p = {};
    if (ROTATABLE.has(selId)) {
      p[selId + 'X'] = r2(obj.position.x); p[selId + 'Z'] = r2(obj.position.z);
      p[selId + 'Rot'] = normDeg(deg(yawOf(obj)) - 90);
      if (selId === 'sofa') {   // отпустил ровно у острова — снова «прижат», иначе свободно
        const isl = islandRect(), q = isl && islandPose(isl, obj.userData.depth ?? 0.95);
        const at = q && p.sofaRot === 0 && Math.abs(obj.position.x - q.x) < 0.003 && Math.abs(obj.position.z - q.z) < 0.003;
        p.sofaSnap = at ? 'island' : 'free';
      }
    } else {
      const it = items(), linked = S.tvLink === 'on' || (S.tv === 'stand' && !!it.console);
      const z = r2(obj.position.z);
      if (selId === 'tv') {
        p.tvAlong = z;
        if (S.tv === 'wall' || !it.console) p.tvY = r2(obj.position.y);
        if (linked) p.consoleAlong = z;
      } else {
        p.consoleAlong = z;
        if (linked) p.tvAlong = z;
      }
    }
    Promise.resolve(setState(p)).then(() => { resync(); requestRender(); });
  }
  function resetSelected() {
    if (part) { setState({ moves: resetDecorPart(getState().moves ?? '', part.pkey) }); return; }
    const keys = PLACE_OF[selId] ?? [];
    setState(Object.fromEntries(keys.filter(k => k in FURN_DEFAULTS).map(k => [k, FURN_DEFAULTS[k]])));
  }
  function beginMove() {
    changed = false;
    if (part) beginPart();
    else last = obj ? { x: obj.position.x, z: obj.position.z, yaw: yawOf(obj) } : null;
  }

  tc.addEventListener('change', () => requestRender());
  tc.addEventListener('objectChange', () => { changed = true; constrain(); requestRender(); });
  tc.addEventListener('dragging-changed', e => {
    if (controls) controls.enabled = !e.value;
    if (e.value) beginMove();
    else if (changed) { changed = false; commit(); }
  });

  // --- клик, перетаскивание самого предмета и клавиши ---
  const raycaster = new THREE.Raycaster(); raycaster.layers.set(0);
  let down = null, downOnGizmo = false, drag = null;
  const plane = new THREE.Plane(), grab = new THREE.Vector3(), off = new THREE.Vector3(), _p = new THREE.Vector3();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = raycaster.intersectObjects(scene.children, true).find(h => !h.object.userData.glass && !h.object.userData.shadowOnly && shown(h.object));
    if (!hit) return null;
    const f = hit.object.userData.furnId, h = !f && holderOf(hit.object);
    const id = f || (h ? `d:${decorPart(h).pkey}` : null);
    return id ? { id, point: hit.point } : null;
  }
  // Плоскость, по которой тянем: пол (горизонталь на высоте точки захвата) или стена (ТВ и тумба, настенное)
  function startDrag(e, point) {
    beginMove();
    grab.copy(point); off.copy(obj.position).sub(point);
    const wallItem = part ? part.mount === 'wall' : (selId === 'tv' || selId === 'console');
    if (!wallItem) plane.set(_n.set(0, 1, 0), -point.y);
    else if (part) plane.setFromNormalAndCoplanarPoint(_n.set(mv.nx, 0, mv.nz), point);
    else plane.setFromNormalAndCoplanarPoint(_n.set(1, 0, 0), point);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    if (controls) controls.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
  }
  function dragTo(e) {
    const r = cursorRay(e);
    if (part?.mount === 'surface') {
      // Под курсором поверхность, обращённая вверх (другая полка, тумба, столешница) — ставим на неё
      hits.length = 0; r.intersectObjects(targets, true, hits);
      const h = hits.find(usable);
      if (h && upward(h)) { mv.refY = h.point.y; constrainPart(h.point.x + off.x, h.point.z + off.z); return; }
      mv.refY = mv.y0;
    }
    if (!r.ray.intersectPlane(plane, _p)) return;
    _p.add(off);
    if (part) {
      if (part.mount !== 'wall' && !free) { _p.x = Math.round(_p.x * 100) / 100; _p.z = Math.round(_p.z * 100) / 100; }
      constrainPart(_p.x, _p.z, part.mount === 'wall' ? _p.y : obj.position.y);
      return;
    }
    if (ROTATABLE.has(selId)) {
      obj.position.x = free ? _p.x : Math.round(_p.x * 100) / 100;
      obj.position.z = free ? _p.z : Math.round(_p.z * 100) / 100;
    } else {
      obj.position.z = free ? _p.z : Math.round(_p.z * 100) / 100;
      if (tc.showY) obj.position.y = free ? _p.y : Math.round(_p.y * 100) / 100;
    }
    constrain();
  }
  function endDrag(e) {
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* не критично */ }
    if (controls) controls.enabled = true;
    const moved = drag.moved;
    drag = null;
    if (moved) commit(); else skip.clear();
  }
  // Захват — в фазе перехвата: раньше облёта (nav.js, OrbitControls), они видят controls.enabled = false
  const onDown = e => {
    down = [e.clientX, e.clientY]; downOnGizmo = !!tc.axis || tc.dragging;
    if (downOnGizmo || e.button !== 0 || drag) return;
    const hit = pick(e);
    if (!hit) return;
    if (hit.id !== selId) select(hit.id);
    if (obj) startDrag(e, hit.point);
  };
  const onMove = e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
    drag.moved = true;
    dragTo(e);
    requestRender();
  };
  const onUp = e => {
    if (drag && e.pointerId === drag.id) endDrag(e);
    if (!down) return;
    const click = Math.hypot(e.clientX - down[0], e.clientY - down[1]) <= 4 && !downOnGizmo;
    down = null;
    if (click) select(pick(e)?.id ?? null);
  };
  const typing = () => { const a = document.activeElement; return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
  const onKey = e => {
    if (e.key === 'Shift') { const f = e.type === 'keydown'; if (f !== free) { free = f; configure(); } return; }
    if (e.type !== 'keydown' || !selId || typing()) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') select(null);
    else if (k === 'r' || k === 'к') setMode('rotate');
    else if (k === 't' || k === 'е' || k === 'g' || k === 'п') setMode('translate');
  };
  const onBlur = () => { if (free) { free = false; configure(); } };

  // --- подписи замеров и панелька действий (HTML поверх холста) ---
  const NS = 'http://www.w3.org/2000/svg';
  const root = document.createElement('div');
  root.className = 'furn-editor';
  Object.assign(root.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', pointerEvents: 'none', zIndex: '15', display: 'none',
    font: '500 12px/1.25 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' });
  const svg = document.createElementNS(NS, 'svg');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible' });
  const labels = document.createElement('div');
  Object.assign(labels.style, { position: 'absolute', inset: '0' });
  const bar = document.createElement('div');
  Object.assign(bar.style, { position: 'absolute', pointerEvents: 'auto', display: 'flex', gap: '4px', alignItems: 'center', padding: '4px',
    background: 'rgba(28,28,30,0.88)', color: '#fff', borderRadius: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.25)', whiteSpace: 'nowrap', transform: 'translate(-50%, -100%)' });
  root.append(svg, labels, bar);
  document.body.appendChild(root);
  const btnStyle = on => `all:unset;cursor:pointer;padding:5px 9px;border-radius:7px;font:inherit;${on ? 'background:#fff;color:#1c1c1e' : 'color:#fff'}`;
  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'done') select(null);
    else if (b.dataset.act === 'snap') Promise.resolve(setState({ sofaSnap: 'island', sofaRot: 0 })).then(() => { resync(); requestRender(); });
    else if (b.dataset.act === 'reset') Promise.resolve(resetSelected()).then(() => { resync(); updateToolbar(); requestRender(); });
    else setMode(b.dataset.act);
  });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function updateToolbar() {
    if (!obj) { bar.innerHTML = ''; return; }
    const moved = part ? isDecorMoved(getState().moves ?? '', part.pkey) : true;
    const name = part ? part.label : NAMES[selId] || '';
    bar.innerHTML = `<span style="padding:0 6px 0 4px;opacity:.75;max-width:260px;overflow:hidden;text-overflow:ellipsis">${esc(name)}</span>`
      + `<button data-act="translate" style="${btnStyle(mode === 'translate')}">Двигать</button>`
      + (rotatable() ? `<button data-act="rotate" style="${btnStyle(mode === 'rotate')}">Повернуть</button>` : '')
      + (selId === 'sofa' && norm(getState()).sofaSnap !== 'island' ? `<button data-act="snap" style="${btnStyle(false)}">К острову</button>` : '')
      + (moved ? `<button data-act="reset" style="${btnStyle(false)}">На место</button>` : '')
      + `<span style="padding:0 6px;opacity:.55">${free ? 'без привязки' : 'Shift — без привязки'}</span>`
      + `<button data-act="done" style="${btnStyle(false)}" title="Esc">Готово</button>`;
  }

  // Ближайшие точки двух многоугольников (на полу): d, pa, pb.
  function closest(A, B) {
    let best = { d: Infinity, pa: null, pb: null };
    const seg = (p, a, b) => {
      const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1;
      const t = clamp(((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2, 0, 1);
      return [a[0] + ex * t, a[1] + ez * t];
    };
    const run = (P, Q, swap) => {
      for (const p of P) for (let i = 0; i < Q.length; i++) {
        const q = seg(p, Q[i], Q[(i + 1) % Q.length]), d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d < best.d) best = swap ? { d, pa: q, pb: p } : { d, pa: p, pb: q };
      }
    };
    run(A, B, false); run(B, A, true);
    return best;
  }
  const cm = d => `${Math.round(d * 100)} см`;
  const m1 = d => `${d.toFixed(1).replace('.', ',')} м`;
  // Замеры для выделенного предмета: [{ a: [x,y,z], b: [x,y,z], text, warn }]
  function measures() {
    const out = [], it = items(), S = norm(getState());
    if (part) {
      const b = part.wbox, yaw = yawOf(obj), nx = Math.sin(yaw) * 0.02, nz = Math.cos(yaw) * 0.02;
      const cx = (b.min.x + b.max.x) / 2 + nx, cz = (b.min.z + b.max.z) / 2 + nz;
      if (part.mount === 'wall') out.push({ a: [cx, 0, cz], b: [cx, b.min.y, cz], text: `Низ ${cm(b.min.y)} от пола` });
      else if (b.min.y > 0.02) out.push({ at: [cx, b.max.y + 0.04, cz], text: `${cm(b.min.y)} от пола` });
    } else if (selId === 'sofa' && obj.userData.front) {
      const polys = worldPolys(obj), isl = islandRect(), y = 0.02;
      if (isl) {
        const box = [[isl.x0, isl.z0], [isl.x1, isl.z0], [isl.x1, isl.z1], [isl.x0, isl.z1]];
        const best = polys.map(p => closest(p, box)).sort((a, b) => a.d - b.d)[0];
        // Вплотную — сторона острова закрыта спинкой, это не проход: без красного
        if (best?.pa && best.d < 0.005) out.push({ at: [best.pa[0], 0.5, best.pa[1]], text: 'Спинкой к острову' });
        else if (best?.pa) out.push({ a: [best.pa[0], y, best.pa[1]], b: [best.pb[0], y, best.pb[1]], text: `Проход до острова ${cm(best.d)}`, warn: best.d < passage });
      }
      const yaw = yawOf(obj), [fx, fz] = rectCorners([obj.userData.front[0], obj.userData.front[1], 0, 0], obj.position.x, obj.position.z, yaw)[0];
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      let hx = W.x, hz = fz;
      if (Math.abs(dx) > 0.3 && dx * (W.x - fx) > 0) { const t = (W.x - fx) / dx; hz = fz + dz * t; }
      out.push({ a: [fx, 0.45, fz], b: [hx, 0.45, hz], text: `До стены с ТВ ${cm(Math.hypot(hx - fx, hz - fz))}` });
    } else if (selId === 'rug') {
      const [w, d] = obj.userData.size ?? [0, 0];
      out.push({ at: [obj.position.x, 0.05, obj.position.z], text: `Ковёр ${Math.round(w * 100)} × ${Math.round(d * 100)}` });
    } else if (selId === 'table' && it.sofa?.userData.footprint.length) {
      const sp = worldPolys(it.sofa), tp = worldPolys(obj);
      const best = tp.flatMap(a => sp.map(b => closest(a, b))).sort((a, b) => a.d - b.d)[0];
      if (best?.pa) out.push({ a: [best.pa[0], 0.3, best.pa[1]], b: [best.pb[0], 0.3, best.pb[1]], text: `До дивана ${cm(best.d)}` });
    } else if (selId === 'tv' || selId === 'console') {
      const o = obj, half = o.userData.halfW, y = selId === 'tv' ? o.position.y - o.userData.halfH : o.userData.top, x = W.x + W.dir * 0.01;
      const z0 = o.position.z - half, z1 = o.position.z + half;
      if (z0 - W.z0 > 0.01) out.push({ a: [x, y, W.z0], b: [x, y, z0], text: cm(z0 - W.z0) });
      if (W.z1 - z1 > 0.01) out.push({ a: [x, y, z1], b: [x, y, W.z1], text: cm(W.z1 - z1) });
      if (selId === 'tv') {
        out.push({ a: [o.position.x, 0, o.position.z], b: [o.position.x, o.position.y, o.position.z], text: `Центр экрана ${cm(o.position.y)} от пола` });
        if (it.sofa?.userData.front) {
          const sp = it.sofa.position, d = Math.hypot(o.position.x - sp.x, o.position.z - sp.z);
          out.push({ a: [sp.x, 1.0, sp.z], b: [o.position.x, o.position.y, o.position.z], text: `До глаз ≈ ${m1(d)}` });
        }
      } else if (it.tv && S.tvLink === 'off' && Math.abs(it.tv.position.z - o.position.z) > 0.005) {
        out.push({ a: [x, y + 0.05, it.tv.position.z], b: [x, y + 0.05, o.position.z], text: `Смещение от ТВ ${cm(Math.abs(it.tv.position.z - o.position.z))}` });
      }
    }
    return out;
  }
  // Контур выделения: мебель — след на полу; часть обстановки — след на её высоте, настенная — лицевая рамка
  function outlines() {
    if (!part) return worldPolys(obj).map(poly => poly.map(([x, z]) => [x, 0.01, z]));
    const b = part.box;
    if (!b) return [];
    const pts = part.mount === 'wall'
      ? [[b.min.x, b.min.y, b.max.z], [b.max.x, b.min.y, b.max.z], [b.max.x, b.max.y, b.max.z], [b.min.x, b.max.y, b.max.z]]
      : [[b.min.x, b.min.y + 0.005, b.min.z], [b.max.x, b.min.y + 0.005, b.min.z], [b.max.x, b.min.y + 0.005, b.max.z], [b.min.x, b.min.y + 0.005, b.max.z]];
    return [pts.map(p => obj.localToWorld(_o.set(p[0], p[1], p[2])).toArray())];
  }

  const proj = new THREE.Vector3(), barBox = new THREE.Box3();
  function toScreen(p, r) {
    proj.set(p[0], p[1], p[2]).project(camera);
    if (proj.z < -1 || proj.z > 1) return null;
    return [(proj.x + 1) / 2 * r.width, (1 - proj.y) / 2 * r.height];
  }
  function updateDom() {
    if (!enabled || !obj) { root.style.display = 'none'; return; }
    const r = canvas.getBoundingClientRect();
    Object.assign(root.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    let s = '', l = '';
    // След (контур) выделенного предмета
    for (const poly of outlines()) {
      const pts = poly.map(p => toScreen(p, r));
      if (pts.every(Boolean)) s += `<polygon points="${pts.map(p => p.join(',')).join(' ')}" fill="rgba(37,99,235,0.08)" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    }
    const tag = (p, text, col) => `<div style="position:absolute;left:${p[0]}px;top:${p[1]}px;transform:translate(-50%,-50%);`
      + `background:${col};color:#fff;padding:3px 7px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)">${text}</div>`;
    for (const mm of measures()) {
      if (mm.at) { const p = toScreen(mm.at, r); if (p) l += tag(p, mm.text, '#1c1c1e'); continue; }
      const a = toScreen(mm.a, r), b = toScreen(mm.b, r);
      if (!a || !b) continue;
      const col = mm.warn ? '#d1342f' : '#1c1c1e', dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * 6, ny = dx / len * 6;
      const tick = p => `M${p[0] - nx},${p[1] - ny}L${p[0] + nx},${p[1] + ny}`;
      const path = `M${a[0]},${a[1]}L${b[0]},${b[1]}${tick(a)}${tick(b)}`;
      s += `<path d="${path}" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity="0.85"/>`
        + `<path d="${path}" stroke="${col}" stroke-width="1.5" fill="none"/>`;
      l += `<div style="position:absolute;left:${(a[0] + b[0]) / 2}px;top:${(a[1] + b[1]) / 2}px;transform:translate(-50%,-50%);`
        + `background:${col};color:#fff;padding:3px 7px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)">${mm.text}</div>`;
    }
    svg.innerHTML = s; labels.innerHTML = l;
    // Панелька над предметом
    const box = part ? part.wbox : barBox.setFromObject(obj), top = toScreen([(box.min.x + box.max.x) / 2, box.max.y + 0.1, (box.min.z + box.max.z) / 2], r);
    if (top) Object.assign(bar.style, { display: 'flex', left: `${clamp(top[0], 140, r.width - 140)}px`, top: `${clamp(top[1] - 12, 48, r.height - 8)}px` });
    else bar.style.display = 'none';
  }

  /** Рисует гизмо поверх готового кадра и обновляет подписи. Звать из main после composer.render(). */
  function renderOverlay() {
    if (!enabled) return;
    resync();
    if (obj) {
      const ac = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(null);
      renderer.clearDepth();
      renderer.render(overlayScene, camera);
      renderer.autoClear = ac;
    }
    updateDom();
  }

  function enable() {
    if (enabled) return;
    enabled = true; tc.enabled = true;
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove, true);
    canvas.addEventListener('pointerup', onUp, true);
    canvas.addEventListener('pointercancel', onUp, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    requestRender();
  }
  function disable() {
    if (!enabled) return;
    if (drag) { drag = null; skip.clear(); }
    select(null);
    enabled = false; tc.enabled = false;
    canvas.removeEventListener('pointerdown', onDown, true);
    canvas.removeEventListener('pointermove', onMove, true);
    canvas.removeEventListener('pointerup', onUp, true);
    canvas.removeEventListener('pointercancel', onUp, true);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('blur', onBlur);
    if (controls) controls.enabled = true;
    root.style.display = 'none';
    requestRender();
  }
  // TransformControls.dispose() в r169 падает (зовёт traverse у Controls), поэтому чистим сами
  function dispose() {
    disable(); tc.detach(); tc.disconnect();
    tc.getHelper().traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
    root.remove();
  }

  return {
    enable, disable, select, setMode, dispose, renderOverlay, overlayScene,
    get selected() { return selId; },
    get enabled() { return enabled; },
  };
}

// Для отладки и других модулей: результат последней сборки по группе.
export const furnitureOf = group => RESULTS.get(group) || null;
