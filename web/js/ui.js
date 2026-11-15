// Панель настроек. Декларативный реестр «вкладка → раздел → контролы»; сама ничего не знает о 3D.
//
// Раздел:  addSection({ id, tab, title, order, open, feature, focus: [slotId…], summary(s, info), elId, controls: [...] })
//   tab — 'mat' | 'kitchen' | 'furniture' | 'light' | 'view'; order — место во вкладке (меньше — выше);
//   feature — раздел виден, только когда модуль подключён (initUI({ features }) или ui.enable(name));
//   раздел с тем же id заменяет встроенный (так модуль подменяет заглушку настоящими контролами).
// Контрол: { type, key, label, hint, def, src, options, visible(s, has, info), feature, focus: [...] } +
//   slot      — материал из catalog.SLOTS (key = id слота): строка-сводка, внутри фильтр и сетка миниатюр;
//   swatches  — сетка образцов из options ({ id, name, note, tex | color });
//   products  — карточки реальных вещей из options ({ id, name, brand, price_pln, size: [ш, в, г] в метрах, thumb, url, note }):
//               миниатюра (путь от web/), название, бренд, размер в см, цена в zł, ссылка в магазин.
//               Вариант с id 'none' («Нет») — узкая первая строка. Пример:
//               { type: 'products', key: 'd_room2_bed', label: 'Кровать', def: 'malm-160', options: [{ id: 'none', name: 'Нет' }, …] }
//   chips/seg — выбор из options ({ id, name }); seg с подписью встаёт в строку;
//   select    — выпадающий список; toggle — переключатель (values: [выкл, вкл], если значения не true/false);
//   slider    — min, max, step, format(v), presets: [{ label, value }], input(v)/commit(v) вместо setState;
//   button    — label (строка или (s, info) => строка), primary, value(s, info) -> аргумент действия;
//               run(s, info) — вместо действия вызвать функцию модуля напрямую (модуль без ui.on, напр. seats.js);
//   readout   — value (строка или (s, info) => строка) либо info[key]; style: 'dims' | 'hint' | 'keys'; link: { label, run };
//   progress  — info[key] = { passes, target, running }; format(p) -> подпись;
//   group     — рамка с вложенными controls.
// Откуда значение (src): 'state' — поле состояния, меняется через setState и попадает в отмену/код;
//   'pref' — настройка этого браузера (localStorage); 'info' — живое значение модуля (ui.info({...})).
//   Либо свои get(s, info) / set(v, s). Изменение pref/info и нажатие кнопки уходят в ui.on(key, fn),
//   иначе в api.actions[key], иначе во встроенное действие (snapshot, glb, quality, theme).
// Сам раздел умеет: сводку в свёрнутом виде (без summary — по выбранным вариантам), точку «изменено» и ссылку
//   «Сбросить раздел» (значения из initUI({ defaults }), иначе из def контрола), поиск по вариантам во вкладках с поиском.
// Клавиатура: в группе выбора одна остановка Tab, стрелки/Home/End — по вариантам, Пробел/Enter — выбрать;
//   1–5 — вкладки, / — поиск, ⌘Z / ⇧⌘Z — отмена и возврат.
import { NAV_HINT } from './nav.js';
import { SLOTS, MATERIALS, OPTIONS, PRESETS, FLOOR_CATS, resolveItem } from './catalog.js';
import { LAMP_OPTIONS, DIM } from './lamps.js';
import { formatSun } from './site.js';

export const TABS = [
  { id: 'mat',       title: 'Материалы',    short: 'Материалы', icon: 'swatch',  search: 'Найти: дуб, микроцемент, Carrea…' },
  { id: 'kitchen',   title: 'Кухня',        short: 'Кухня',     icon: 'kitchen', search: 'Найти: дуб, кварц, латунь…' },
  { id: 'furniture', title: 'Мебель',       short: 'Мебель',    icon: 'sofa',    search: 'Найти: IKEA, кровать, стеллаж…',
    empty: 'Здесь появятся диван, ТВ, тумба, ковёр и журнальный столик.' },
  { id: 'light',     title: 'Свет',         short: 'Свет',      icon: 'bulb' },
  { id: 'view',      title: 'Вид и рендер', short: 'Вид',       icon: 'camera' },
];

const extra = [];      // разделы, добавленные модулями через addSection
let live = null;       // панель после initUI: новый раздел встраивается сразу
export function addSection(def) { extra.push(def); live?.remount(); }

// ---------- мелочи ----------

const $ = (sel, el = document) => el.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const ICONS = {
  swatch: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>',
  kitchen: '<path d="M2 9h16"/><rect x="3" y="9" width="14" height="8" rx="1"/><path d="M10 9v8M6 6h2M12 6h2"/>',
  sofa: '<path d="M4 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3"/><path d="M2 11a2 2 0 0 1 4 0v2h8v-2a2 2 0 0 1 4 0v4H2z"/><path d="M4 15v2M16 15v2"/>',
  bulb: '<path d="M7.5 14.5h5M8.5 17h3"/><path d="M10 3a5 5 0 0 0-3 9v2.5h6V12a5 5 0 0 0-3-9z"/>',
  camera: '<path d="M3 7h3l1.5-2h5L14 7h3v9H3z"/><circle cx="10" cy="11.5" r="3"/>',
  undo: '<path d="M8 5 4 9l4 4"/><path d="M4 9h8a4 4 0 0 1 0 8H9"/>',
  redo: '<path d="m12 5 4 4-4 4"/><path d="M16 9H8a4 4 0 0 0 0 8h3"/>',
  copy: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7"/>',
  chev: '<path d="m6 8 4 4 4-4"/>',
  search: '<circle cx="9" cy="9" r="5"/><path d="m13 13 4 4"/>',
  close: '<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>',
  ab: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M10 4v12"/><path d="M5.5 12.5 7 7.5l1.5 5M6 11h2"/>',
  side: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M12 4v12"/>',
  ext: '<path d="M11 4h5v5"/><path d="m16 4-7 7"/><path d="M14 12v3.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H8"/>',
  none: '<circle cx="10" cy="10" r="6"/><path d="m5.8 14.2 8.4-8.4"/>',
  box: '<path d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5z"/><path d="m3.5 6.5 6.5 3.5 6.5-3.5M10 10v7"/>',
  reset: '<path d="M4 10a6 6 0 1 0 2-4.5"/><path d="M4 3.5V7h3.5"/>',
};
const icon = n => {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ico" viewBox="0 0 20 20" aria-hidden="true">${ICONS[n]}</svg>`;
  return t.content.firstChild;
};
const cm = m => `${Math.round(m * 100)} см`;
const pct = v => `${Math.round(v * 100)} %`;
const norm = t => String(t ?? '').toLowerCase().replace(/ё/g, 'е');
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
// Состояние фото-рендера (info.photo из main.js): строка для раздела «Рендер» и плашки поверх сцены
const photoStatus = p => {
  const n = `${p.passes} ${plural(p.passes, 'проход', 'прохода', 'проходов')}`;
  if (p.phase === 'error') return 'Фото недоступно, показан обычный рендер';
  if (p.phase === 'loading') return 'Загружаю трассировщик…';
  if (p.phase === 'building' || p.phase === 'waiting') return 'Сцена собирается…';
  if (!p.running) return p.passes ? `Выключен на ${n}` : 'Выключен. Включается только кнопкой, сам не запускается';
  return p.phase === 'done' ? `Кадр готов: ${n}` : `Кадр собирается: ${n}`;
};
const titleOf = it => (it.note ? `${it.name} · ${it.note}` : it.name);
const optName = (list, id) => list?.find(o => o.id === id)?.name ?? '';
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl+';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// дата состояния солнца: 'YYYY-MM-DD' <-> номер дня в году (год берётся из даты)
const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const doyOf = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5); };
const isoOf = (doy, year) => new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayLabel = (doy, year) => { const d = new Date(Date.UTC(year, 0, doy)); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const hhmm = x => { const m = Math.round(x * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

const STORE = 'kitchen-variants-v1';   // список сохранённых: коды v1–v3, decode понимает все
const PREFS = 'kitchen-ui-v1';         // вкладка, открытые разделы, тема, качество, панель
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* хранилище недоступно */ } };

// Образец материала: миниатюра (если её нет — сама текстура), оттенок поверх, либо цвет краски.
function fillSwatch(el, it) {
  const key = it ? `${it.tex || ''}|${it.tint || ''}|${it.color || ''}` : '-';
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  el.replaceChildren();
  el.style.background = '';
  if (!it || (!it.tex && !it.color)) { el.style.background = 'var(--wall-swatch)'; return; }
  if (!it.tex) { el.style.background = it.color; return; }
  if (it.tint) el.style.background = it.tint;
  el.append(h('img', { src: `textures/${it.tex}/thumb.jpg`, alt: '', loading: 'lazy', decoding: 'async', class: it.tint ? 'tinted' : null,
    onerror: e => { const img = e.currentTarget; if (img.src.endsWith('thumb.jpg')) img.src = `textures/${it.tex}/color.jpg`; } }));
}
// Сведения о материале для фильтров: вид покрытия, бренд и цена. Берутся из полей kind/brand/price_pln,
// а у реальных товаров — из note вида «Carrea · 60×60 · 129 zł/m²» (бренд — первая часть, цена — число перед zł).
const TYPES_ORDER = ['wood', 'concrete', 'tile', 'stone'];
const priceOf = it => {
  if (it.price_pln != null) return Number(it.price_pln);
  const m = /(\d[\d\s]*(?:[.,]\d+)?)\s*zł/.exec(it.note || '');
  return m ? Number(m[1].replace(/\s/g, '').replace(',', '.')) : null;
};
const metaOf = it => {
  if (it._meta) return it._meta;
  const note = it.note || '', shop = it.cat === 'shop' || /zł/.test(note);
  return (it._meta = {
    type: it.kind || (it.cat === 'shop' ? 'tile' : it.cat) || '',   // магазинная плитка без вида — керамогранит
    brand: it.brand || (shop ? note.split(' · ')[0].trim() : ''),
    price: priceOf(it),
    unit: /zł\s*\/\s*m/.test(note) ? '/м²' : '',
  });
};
const zl = p => `${Number(p).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} zł`;
function swatch(it, onclick) {
  const img = h('span', { class: 'sw-img' });
  if (it.id !== 'same') fillSwatch(img, it);
  const m = it.id === 'same' ? null : metaOf(it);
  const b = h('button', { type: 'button', class: 'sw', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-id': String(it.id), 'data-cat': it.cat || '',
    'aria-label': titleOf(it), 'data-tip': it.name, 'data-tip2': it.note || null, onclick },
  img, it.id === 'same' ? h('span', { class: 'sw-same' }, '=') : null,
  it.id === 'none' && !it.tex && !it.color ? h('span', { class: 'sw-none' }, icon('none')) : null,
  m?.price != null ? h('span', { class: 'sw-price', 'aria-hidden': 'true' }, zl(m.price).replace(' zł', '')) : null);
  b._img = img;
  return b;
}
const catName = id => FLOOR_CATS.find(c => c.id === id)?.name || '';   // 'all' — «Все»
const matches = (o, words) => {
  const m = metaOf(o);
  const t = norm(`${o.name} ${o.note || ''} ${o.brand || ''} ${catName(o.cat)} ${catName(m.type)} ${o.id} ${o.color && !o.tex ? 'краска' : ''}`);
  return words.every(w => t.includes(w));
};
// Группа выбора — одна остановка Tab: выбранный вариант (или первый видимый) с tabindex 0, остальные −1.
const filteredOut = el => !!el.closest('.sr-hide, .flt-hide');
function fixStop(group, force = false) {
  const items = [...group.querySelectorAll('[role=radio]')];
  if (!force && items.some(b => b.tabIndex === 0 && !filteredOut(b))) return;
  const pick = items.find(b => b.getAttribute('aria-checked') === 'true' && !filteredOut(b)) || items.find(b => !filteredOut(b));
  items.forEach(b => { b.tabIndex = b === pick ? 0 : -1; });
}

// ---------- заглушки модулей в работе: ключи состояния предварительные (см. отчёт интегратору) ----------

const opt = (...pairs) => pairs.map(([id, name]) => ({ id, name }));
function moduleSections(roomW) {
  const not = (k, v) => s => (s[k] ?? '') !== v;   // поле не равно v (например, «дивана нет»)
  const FABRICS = [
    { id: 'linen', name: 'Лён светлый', color: '#d8d0c2' }, { id: 'boucle', name: 'Букле молочное', color: '#ece7de' },
    { id: 'oat', name: 'Овсяный', color: '#c9b9a0' }, { id: 'grey', name: 'Серый меланж', color: '#8e8f8c' },
    { id: 'olive', name: 'Олива', color: '#6e6f4e' }, { id: 'terra', name: 'Терракота', color: '#a9644a' },
    { id: 'navy', name: 'Тёмно-синий', color: '#2f3b4e' }, { id: 'cognac', name: 'Кожа коньяк', color: '#8a5232' },
  ];
  const along = { min: 0.3, max: Math.round((roomW - 0.3) * 100) / 100, step: 0.01, format: cm };
  return [
    { id: 'sofa', tab: 'furniture', title: 'Диван', order: 10, open: true, feature: 'furniture', focus: ['sofa'],
      summary: s => optName(OPTIONS.sofa || SOFA, s.sofaType ?? 'straight'),
      controls: [
        { type: 'chips', key: 'sofaType', label: 'Тип', def: 'straight', options: OPTIONS.sofa || SOFA },
        { type: 'swatches', key: 'sofaFabric', label: 'Обивка', def: 'linen', options: OPTIONS.fabric || FABRICS, visible: not('sofaType', 'none') },
        { type: 'slider', key: 'sofaX', label: 'Вдоль окон', def: 4.4, ...along, visible: not('sofaType', 'none') },
        { type: 'slider', key: 'sofaZ', label: 'От окон', def: 2.4, min: 0.3, max: 3.4, step: 0.01, format: cm, visible: not('sofaType', 'none') },
        { type: 'seg', key: 'sofaRot', label: 'Поворот', def: 0, options: opt([0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']), visible: not('sofaType', 'none') },
      ] },
    { id: 'tv', tab: 'furniture', title: 'Телевизор', order: 20, feature: 'furniture', focus: ['tv'],
      summary: s => optName(TV, s.tvSize ?? 55),
      controls: [
        { type: 'chips', key: 'tvSize', label: 'Диагональ', def: 55, options: TV },
        { type: 'slider', key: 'tvHeight', label: 'Центр экрана от пола', def: 1.1, min: 0.8, max: 1.6, step: 0.01, format: cm, visible: not('tvSize', 0) },
        { type: 'slider', key: 'tvPos', label: 'Вдоль стены', def: 1.8, ...along, visible: not('tvSize', 0) },
      ] },
    { id: 'media', tab: 'furniture', title: 'ТВ-тумба', order: 30, feature: 'furniture', focus: ['media'],
      summary: s => optName(MEDIA, s.mediaType ?? 'low'),
      controls: [
        { type: 'chips', key: 'mediaType', label: 'Тип', def: 'low', options: MEDIA },
        { type: 'swatches', key: 'mediaFinish', label: 'Отделка', def: 'oak-01', options: MATERIALS.fronts, visible: not('mediaType', 'none') },
        { type: 'slider', key: 'mediaW', label: 'Ширина', def: 1.8, min: 1.2, max: 3.0, step: 0.05, format: cm, visible: not('mediaType', 'none') },
      ] },
    { id: 'rug', tab: 'furniture', title: 'Ковёр и столик', order: 40, feature: 'furniture', focus: ['rug', 'coffee'],
      summary: s => [optName(RUG, s.rug ?? 'wool'), optName(COFFEE, s.coffee ?? 'round-oak')].join(' · '),
      controls: [
        { type: 'chips', key: 'rug', label: 'Ковёр', def: 'wool', options: RUG },
        { type: 'seg', key: 'rugSize', label: 'Размер', def: '200x300', options: opt(['160x230', '160×230'], ['200x300', '200×300'], ['250x350', '250×350']), visible: not('rug', 'none') },
        { type: 'chips', key: 'coffee', label: 'Журнальный столик', def: 'round-oak', options: COFFEE },
      ] },
    { id: 'arrange', tab: 'furniture', title: 'Расстановка', order: 50, open: true, feature: 'furniture',
      controls: [
        { type: 'toggle', key: 'furnEdit', src: 'info', label: 'Двигать мебель в 3D' },
        { type: 'readout', key: 'furnHint', style: 'hint', value: 'Тяните предмет мышью, Shift — поворот. Esc — готово.', visible: (s, _, i) => !!i.furnEdit },
        { type: 'button', key: 'furnReset', label: 'Расставить как было' },
      ] },
  ];
}
const SOFA = opt(['none', 'Нет'], ['straight', 'Прямой'], ['corner', 'Угловой'], ['modular', 'Модульный']);
const TV = opt([0, 'Нет'], [43, '43″'], [55, '55″'], [65, '65″'], [75, '75″']);
const MEDIA = opt(['none', 'Нет'], ['low', 'Низкая'], ['floating', 'Подвесная'], ['tall', 'Со стеллажом']);
const RUG = opt(['none', 'Нет'], ['wool', 'Шерсть светлая'], ['berber', 'Бербер'], ['jute', 'Джут'], ['grey', 'Серый']);
const COFFEE = opt(['none', 'Нет'], ['round-oak', 'Круглый дуб'], ['round-stone', 'Круглый камень'], ['rect-oak', 'Прямоугольный'], ['nesting', 'Пара столиков']);

// ---------- панель ----------

export function initUI(api) {
  const { state, kit, plan } = api;
  const panel = $('#panel'), head = $('#panel-head'), body = $('#panel-body');
  const room = plan.rooms?.kitchen_living || { x0: 0, x1: 6.171 };
  const roomW = (room.x1 - (room.x0 || 0)) || 6.171;
  const features = new Set(api.features || []);
  const walkApi = () => (typeof api.walk === 'function' ? api.walk() : api.walk) || null;
  const has = f => features.has(f) || (f === 'walk' && !!walkApi()) || (f === 'render' && !!api.render);
  const info = {};
  const handlers = {};
  const prefs = readJSON(PREFS, {});
  prefs.open ||= {};
  let prefTimer = 0;
  const savePrefs = () => { clearTimeout(prefTimer); prefTimer = setTimeout(() => writeJSON(PREFS, prefs), 250); };
  let saved = readJSON(STORE, []);
  const storeSaved = list => { saved = list; writeJSON(STORE, list); };

  // --- действия и значения
  const BUILTIN = {
    quality: q => api.setQuality?.(q),
    theme: applyTheme,
    snapshot: async () => { toast('Готовлю снимок…'); const ok = await api.snapshot(); toast(ok ? 'Снимок сохранён в exports/' : 'Снимок скачан'); },
    glb: async () => { toast('Собираю GLB, это до минуты…'); const ok = await api.exportGLB(); toast(ok ? 'GLB сохранён в exports/' : 'GLB скачан'); },
  };
  function emit(name, v) {
    if (handlers[name]?.length) handlers[name].forEach(fn => fn(v, state));
    else if (api.actions?.[name]) api.actions[name](v, state);
    else BUILTIN[name]?.(v);
  }
  const getV = (c, s) => (c.get ? c.get(s, info) : c.src === 'pref' ? prefs[c.key] : c.src === 'info' ? info[c.key] : s[c.key]) ?? c.def;
  let gesture = null;   // ключ ползунка, который сейчас тянут: его шаги сливаются в один шаг отмены
  function setV(c, v, drag = false) {
    gesture = drag ? c.key : null;
    if (c.set) { c.set(v, state); update(); }
    else if (c.src === 'pref') { prefs[c.key] = v; savePrefs(); emit(c.key, v); update(); }
    else if (c.src === 'info') { info[c.key] = v; emit(c.key, v); update(); }
    else api.setState({ [c.key]: v });
  }
  const optsOf = c => (typeof c.options === 'function' ? c.options(state, has) : c.options) || [];
  const shown = (d, s) => (!d.feature || has(d.feature)) && (!d.visible || d.visible(s, has, info));

  // --- встроенные разделы
  const pair = (s, a, b) => { const x = resolveItem(s, a).name, y = resolveItem(s, b).name; return x === y ? x : `${x} · ${y}`; };
  const slots = sec => SLOTS.filter(s => s.sec === sec).map(s => ({ type: 'slot', key: s.id }));
  const sunDate = s => s.sunDate || todayISO();
  const sunYear = s => Number(sunDate(s).slice(0, 4));
  function coreSections() {
    const split = api.split || { min: 0.7, max: 5.5 };
    const ultra = has('render');
    return [
      { id: 'floor', tab: 'mat', title: 'Пол', order: 10, open: true, summary: s => pair(s, 'floorA', 'floorB'), controls: [
        { type: 'slot', key: 'floorA' }, { type: 'slot', key: 'floorB' },
        { type: 'group', id: 'split', controls: [
          { type: 'slider', key: 'split', label: 'Граница кухни и гостиной', min: split.min, max: split.max, step: 0.01, format: cm,
            // ползунок двигает только пол (api.setSplit), код в адрес и шаг отмены — по отпусканию
            input: v => api.setSplit(v), commit: v => { gesture = 'split'; api.setSplit(v, { commit: true }); } },
          { type: 'readout', key: 'splitInfo', style: 'dims', value: s => {
            const same = resolveItem(s, 'floorA').id === resolveItem(s, 'floorB').id;
            return `${cm(s.split)} от стены с мойкой · кухня ${cm(Math.max(0, s.split - kit.run.depth))}, гостиная ${cm(Math.max(0, roomW - s.split))}`
              + (same ? ' · полы одинаковые, граница не видна' : '');
          } },
          { type: 'seg', key: 'threshold', label: 'Порожек', options: OPTIONS.threshold },
          { type: 'seg', key: 'floorDir', label: 'Доска', options: OPTIONS.floorDir },
        ] },
        { type: 'slot', key: 'floorRoom2' }, { type: 'slot', key: 'floorRoom3' }, { type: 'slot', key: 'floorBath' },
      ] },
      { id: 'walls', tab: 'mat', title: 'Стены', order: 20, summary: s => pair(s, 'walls', 'wallAccent'), controls: slots('walls') },
      { id: 'doors', tab: 'mat', title: 'Двери и окна', order: 30, summary: s => resolveItem(s, 'doors').name, controls: [
        ...slots('doors'),
        { type: 'readout', key: 'doorsHint', style: 'hint', value: '«Под покраску» повторяет цвет стен кухни и холла.' },
        { type: 'seg', key: 'frames', label: 'Рамы окон', options: OPTIONS.frames },
      ] },
      { id: 'kitchen', tab: 'kitchen', title: 'Фасады и столешница', order: 10, open: true, summary: s => pair(s, 'fronts', 'counter'), controls: [
        ...slots('kitchen'),
        { type: 'seg', key: 'handles', label: 'Ручки', options: OPTIONS.handles },
        { type: 'chips', key: 'fridge', label: 'Холодильник', options: OPTIONS.fridge },
      ] },
      { id: 'island', tab: 'kitchen', title: 'Остров', order: 20, summary: s => `проход ${cm(s.aisle)}`, controls: [
        { type: 'readout', key: 'islandSize', style: 'head', value: '180 × 60 × 90 см',
          link: { label: 'как в эскизе', run: () => api.setState({ aisle: kit.island.aisle, gapW: kit.island.gapToWindowWall }) } },
        { type: 'slider', key: 'aisle', label: 'Проход до кухни', min: 0.85, max: 1.6, step: 0.01, format: cm },
        { type: 'slider', key: 'gapW', label: 'Отступ от оконной стены', min: 0.1, max: 1.2, step: 0.01, format: cm },
        { type: 'readout', key: 'island', src: 'info', style: 'dims' },
      ] },
      { id: 'daylight', tab: 'light', title: 'Солнце и небо', order: 10, open: true,
        summary: s => (has('sun') ? `${hhmm(s.sunTime ?? 14)} · ` : '') + optName(OPTIONS.light, s.light), controls: [
        { type: 'seg', key: 'light', label: 'Режим', options: OPTIONS.light },
        { type: 'slider', key: 'sunDate', label: 'Дата', feature: 'sun', min: 1, max: 365, step: 1,
          get: s => doyOf(sunDate(s)), set: v => api.setState({ sunDate: isoOf(v, sunYear(state)) }), format: v => dayLabel(v, sunYear(state)),
          presets: [{ label: 'Сегодня', value: () => doyOf(todayISO()) }, { label: '21 марта', value: 80 }, { label: '21 июня', value: 172 }, { label: '21 декабря', value: 355 }] },
        { type: 'slider', key: 'sunTime', label: 'Время', feature: 'sun', def: 14, min: 4, max: 22, step: 0.25, format: hhmm,
          presets: [{ label: '9:00', value: 9 }, { label: '13:00', value: 13 }, { label: '17:00', value: 17 }, { label: '20:00', value: 20 }] },
        { type: 'readout', key: 'sunInfo', feature: 'sun', style: 'dims', value: s => formatSun(sunDate(s), s.sunTime ?? 14) },
        { type: 'slider', key: 'sunAz', label: 'Солнце: направление', min: -70, max: 70, step: 1,
          format: v => `${v > 0 ? 'справа' : v < 0 ? 'слева' : 'прямо'} ${Math.abs(Math.round(v))}°`, visible: (s, f) => !f('sun') && s.light === 'day' },
        { type: 'slider', key: 'sunEl', label: 'Солнце: высота', min: 6, max: 62, step: 1, format: v => `${Math.round(v)}°`, visible: (s, f) => !f('sun') && s.light === 'day' },
        { type: 'slider', key: 'exposure', label: 'Экспозиция', min: 0.5, max: 1.8, step: 0.01, format: v => v.toFixed(2) },
      ] },
      { id: 'lamps', elId: 'sec-lamps', tab: 'light', title: 'Светильники', order: 20, open: true, focus: ['lamps', 'pendants'],
        summary: s => `${optName(LAMP_OPTIONS.lampsOn, s.lampsOn)} · ${optName(LAMP_OPTIONS.lampTemp, s.lampTemp)}`, controls: [
        { type: 'chips', key: 'ceilingKitchen', label: 'Потолок кухни', options: LAMP_OPTIONS.ceilingKitchen },
        { type: 'chips', key: 'ceilingLiving', label: 'Потолок гостиной', options: LAMP_OPTIONS.ceilingLiving },
        { type: 'chips', key: 'ceilingHall', label: 'Потолок холла', options: LAMP_OPTIONS.ceilingHall },
        { type: 'chips', key: 'ceilingRoom2', label: 'Потолок комнаты 2', options: LAMP_OPTIONS.ceilingRoom2 },
        { type: 'chips', key: 'ceilingRoom3', label: 'Потолок комнаты 3', options: LAMP_OPTIONS.ceilingRoom3 },
        { type: 'chips', key: 'pendants', label: 'Над островом', options: LAMP_OPTIONS.pendants },
        { type: 'toggle', key: 'plinthLed', label: 'Подсветка цоколя', values: ['off', 'on'] },
        { type: 'seg', key: 'lampFinish', label: 'Корпуса', options: LAMP_OPTIONS.lampFinish },
        { type: 'seg', key: 'lampTemp', label: 'Цвет света', options: LAMP_OPTIONS.lampTemp, hint: '2700 K — тёплый, 3000 K — мягкий, 4000 K — нейтральный' },
        { type: 'seg', key: 'lampsOn', label: 'Включены', options: LAMP_OPTIONS.lampsOn },
        { type: 'slider', key: 'lampDim', label: 'Яркость', min: DIM.min, max: DIM.max, step: 0.01, format: pct, visible: s => s.lampsOn !== 'off' },
      ] },
      { id: 'render', tab: 'view', title: 'Рендер и экспорт', order: 10, open: true, controls: [
        { type: 'seg', key: 'quality', src: 'pref', def: 'high', label: 'Качество',
          options: opt(['fast', 'Быстрое'], ['high', 'Высокое'], ...(ultra ? [['ultra', 'Ультра']] : [])) },
        { type: 'button', key: 'photo', feature: 'render', primary: true, value: (s, i) => !i.photo?.running,
          label: (s, i) => (i.photo?.running ? 'Выключить фото-рендер' : 'Включить фото-рендер') },
        { type: 'progress', key: 'photo', id: 'photoProgress', feature: 'render', format: photoStatus },
        { type: 'button', key: 'snapshot', label: 'Снимок PNG', primary: !ultra, visible: () => api.canExport },
        { type: 'button', key: 'glb', label: 'Модель GLB для Blender', visible: () => api.canExport },
      ] },
      { id: 'camera', tab: 'view', title: 'Камера', order: 15, summary: () => 'мышь и клавиши', controls: [
        { type: 'readout', key: 'navHint', style: 'hint', value: NAV_HINT.split(' · ').join('\n') },
      ] },
      { id: 'walk', tab: 'view', title: 'Прогулка', order: 20, feature: 'walk', summary: () => (walkApi()?.active ? 'идёт' : walkApi()?.personHeight ? `рост ${Math.round(walkApi().personHeight)} см` : ''), controls: [
        { type: 'toggle', key: 'walking', label: 'Пройтись от первого лица', get: () => !!walkApi()?.active, set: () => walkApi()?.toggle() },
        { type: 'slider', key: 'personHeight', label: 'Рост', min: 150, max: 200, step: 1, def: 180,
          get: () => walkApi()?.personHeight, set: v => walkApi()?.setPersonHeight(v),
          format: v => `${Math.round(v)} см · глаза на ${Math.round((walkApi()?.eyeHeight ?? 1.68) * 100)} см` },
        { type: 'readout', key: 'walkKeys', style: 'hint', value: 'WASD или стрелки — шаг, Shift — быстрее, мышь — взгляд. F — войти, Esc — выйти.' },
      ] },
      { id: 'interface', tab: 'view', title: 'Интерфейс', order: 90, controls: [
        { type: 'seg', key: 'theme', src: 'pref', def: 'auto', label: 'Тема', options: opt(['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']) },
        { type: 'readout', key: 'shortcuts', style: 'keys',
          value: `1–5 — вкладки, / — поиск\n${MOD}Z — отменить, ⇧${MOD}Z — вернуть\nСтрелки — по вариантам, Пробел — выбрать\nC — переключить A/B\nF — прогулка, Esc — закрыть` },
        { type: 'readout', key: 'clickHint', style: 'hint', value: 'Нажмите на поверхность в 3D, чтобы открыть её материалы.' },
      ] },
    ];
  }

  // --- построители контролов
  const labelOf = c => c.label || c.key;
  const ctlId = c => `ctl-${c.id || c.key}`;
  // выбор в группе; tabindex переезжает на выбранный, пока фокус не внутри группы (иначе он там, куда ушли стрелками)
  const radioSync = (btns, v, group = btns[0]?.closest('[role=radiogroup]')) => {
    v = String(v);
    let changed = false;
    for (const b of btns) {
      const on = b.dataset.id === v;
      if (b.classList.contains('on') !== on) changed = true;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    }
    if (group) fixStop(group, changed && !group.contains(document.activeElement));
  };

  const TYPES = {
    slot: buildSlot,
    swatches(c) {
      const opts = optsOf(c);
      const btns = opts.map(it => swatch(it, () => setV(c, it.id)));
      const el = h('div', { class: 'ctl', id: ctlId(c) }, c.label ? h('span', { class: 'ctl-label' }, c.label) : null,
        h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': labelOf(c) }, btns));
      return { el, sync: s => radioSync(btns, getV(c, s)), filter: words => filterItems(el, btns, opts, words) };
    },
    products: buildProducts,
    chips: buildChoice,
    seg: buildChoice,
    select(c) {
      const opts = optsOf(c), id = `in-${c.id || c.key}`;
      const sel = h('select', { id, onchange: e => setV(c, opts[e.target.selectedIndex].id) }, opts.map(o => h('option', { value: String(o.id) }, o.name)));
      const el = h('div', { class: 'ctl inline', id: ctlId(c) }, h('label', { class: 'ctl-label', for: id }, labelOf(c)), sel);
      return { el, sync: s => { sel.value = String(getV(c, s)); } };
    },
    toggle(c) {
      const id = `in-${c.id || c.key}`;
      const inp = h('input', { id, type: 'checkbox', role: 'switch', onchange: e => setV(c, c.values ? c.values[+e.target.checked] : e.target.checked) });
      const el = h('label', { class: 'ctl tgl', id: ctlId(c), for: id }, h('span', {}, labelOf(c)), inp);
      return { el, sync: s => { const v = getV(c, s); inp.checked = c.values ? v === c.values[1] : !!v; } };
    },
    slider(c) {
      const id = `in-${c.id || c.key}`;
      const fmt = c.format || (v => `${v}${c.unit ? ` ${c.unit}` : ''}`);
      const out = h('output', { for: id });
      const inp = h('input', { id, type: 'range', min: c.min, max: c.max, step: c.step ?? 1 });
      const show = v => {
        out.textContent = fmt(v);
        inp.setAttribute('aria-valuetext', out.textContent);
        inp.style.setProperty('--p', `${((v - c.min) / (c.max - c.min)) * 100}%`);
      };
      inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (c.input) c.input(v); else setV(c, v, true); show(v); });
      inp.addEventListener('change', () => c.commit?.(parseFloat(inp.value)));
      const marks = c.presets && h('div', { class: 'marks' }, c.presets.map(p =>
        h('button', { type: 'button', class: 'mark', onclick: () => setV(c, typeof p.value === 'function' ? p.value() : p.value) }, p.label)));
      const el = h('div', { class: 'ctl rng', id: ctlId(c) }, h('div', { class: 'rng-head' }, h('label', { for: id }, labelOf(c)), out), inp, marks);
      return { el, sync: s => { const v = Number(getV(c, s)); if (Math.abs(parseFloat(inp.value) - v) > 1e-9) inp.value = v; show(v); } };
    },
    button(c) {
      const b = h('button', { type: 'button', class: `btn${c.primary ? ' primary' : ''}`, id: ctlId(c),
        onclick: () => (c.run ? c.run(state, info) : emit(c.action || c.key, c.value?.(state, info))) });
      return { el: b, sync: s => { b.textContent = typeof c.label === 'function' ? c.label(s, info) : c.label; b.disabled = !!c.disabled?.(s, info); } };
    },
    readout(c) {
      const txt = h('span', { class: 'ro-text' });
      const el = h('div', { class: `ctl ro ${c.style || ''}`, id: ctlId(c) }, txt,
        c.link ? h('button', { type: 'button', class: 'link', onclick: () => c.link.run(state) }, c.link.label) : null);
      return { el, sync: s => { const v = typeof c.value === 'function' ? c.value(s, info) : c.value ?? info[c.key]; txt.textContent = v ?? ''; return !!v; } };
    },
    progress(c) {
      const fill = h('i'), txt = h('span');
      const el = h('div', { class: 'ctl prog', id: ctlId(c) }, h('div', { class: 'bar' }, fill), txt);
      return { el, sync: () => {
        const p = info[c.key];
        if (!p) return false;
        const f = p.target ? Math.min(1, p.passes / p.target) : null;
        el.classList.toggle('indet', f == null && !!p.running);
        fill.style.width = f == null ? '' : `${(f * 100).toFixed(1)}%`;
        txt.textContent = c.format ? c.format(p) : '';
        return true;
      } };
    },
    group(c, sec) {
      const kids = c.controls.map(k => build(k, sec)).filter(Boolean);
      return { el: h('div', { class: 'grp-box', id: ctlId(c) }, c.label ? h('span', { class: 'grp-label' }, c.label) : null, kids.map(k => k.el)),
        kids, sync: s => kids.forEach(k => syncCtl(k, s)) };
    },
  };

  function buildChoice(c) {
    const seg = c.type === 'seg';
    const btns = optsOf(c).map(o => h('button', { type: 'button', class: seg ? null : 'chip', role: 'radio', 'aria-checked': 'false', tabindex: '-1',
      'data-id': String(o.id), onclick: () => setV(c, o.id) }, o.name));
    const el = h('div', { class: `ctl${seg && c.label ? ' inline' : ''}`, id: ctlId(c) },
      c.label ? h('span', { class: 'ctl-label' }, c.label) : null,
      h('div', { class: seg ? 'seg' : 'chips', role: 'radiogroup', 'aria-label': labelOf(c) }, btns),
      c.hint ? h('p', { class: 'hint' }, c.hint) : null);
    return { el, sync: s => radioSync(btns, getV(c, s)) };
  }

  // Поиск по вариантам контрола: прячет не совпавшие, весь контрол — если совпадений нет. Возвращает число совпадений.
  function filterItems(el, items, opts, words) {
    if (!words.length) { el.classList.remove('sr-hide'); items.forEach(x => x.classList.remove('sr-hide')); return 0; }
    let n = 0;
    opts.forEach((o, i) => {
      const hit = o.id !== 'none' && o.id !== 'same' && matches(o, words);
      items[i].classList.toggle('sr-hide', !hit);
      n += hit;
    });
    el.classList.toggle('sr-hide', !n);
    const g = el.querySelector('[role=radiogroup]');
    if (g) fixStop(g, true);
    return n;
  }

  // Карточки реальных вещей: миниатюра, название, бренд и размер, цена, ссылка в магазин. «Нет» — узкая строка.
  function buildProducts(c) {
    const opts = optsOf(c);
    const hits = [], links = [];
    const cards = opts.map(o => {
      const pick = () => setV(c, o.id);
      if (o.id === 'none') {
        const b = h('button', { type: 'button', class: 'pc-hit', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-id': 'none', onclick: pick },
          icon('none'), h('span', { class: 'pc-name' }, o.name || 'Нет'));
        hits.push(b); links.push(null);
        return h('div', { class: 'pc pc-none' }, b);
      }
      const dims = Array.isArray(o.size) ? `${o.size.map(v => Math.round(v * 100)).join('×')} см` : '';
      const price = o.price_pln != null && o.price_pln !== '' ? zl(o.price_pln) : '';
      const img = h('span', { class: `pc-img${o.thumb ? '' : ' noimg'}` }, icon('box'),
        o.thumb ? h('img', { src: o.thumb, alt: '', loading: 'lazy', decoding: 'async', onerror: e => e.currentTarget.parentNode.classList.add('noimg') }) : null);
      const b = h('button', { type: 'button', class: 'pc-hit', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-id': String(o.id), onclick: pick,
        'aria-label': [o.name, o.brand, dims && `ширина, высота, глубина ${dims}`, price, o.note].filter(Boolean).join(', '),
        'data-tip': o.note ? o.name : null, 'data-tip2': o.note || null },
      img, h('span', { class: 'pc-name' }, o.name),
      h('span', { class: 'pc-meta' }, [o.brand, dims].filter(Boolean).join(' · ')),
      h('span', { class: 'pc-price' }, price || '\u00a0'));
      let host = '';
      try { host = o.url ? new URL(o.url).hostname.replace(/^www\./, '') : ''; } catch { /* кривая ссылка — без кнопки */ }
      const link = host ? h('a', { class: 'pc-link', href: o.url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1',
        'aria-label': `«${o.name}» на ${host}`, 'data-tip': 'Открыть в магазине', 'data-tip2': host }, icon('ext')) : null;
      hits.push(b); links.push(link);
      return h('div', { class: 'pc', 'data-id': String(o.id) }, b, link);
    });
    const grid = h('div', { class: 'products', role: 'radiogroup', 'aria-label': labelOf(c) }, cards);
    const el = h('div', { class: 'ctl', id: ctlId(c) }, c.label ? h('span', { class: 'ctl-label' }, c.label) : null, grid,
      c.hint ? h('p', { class: 'hint' }, c.hint) : null);
    return { el, sync: s => {
      const v = String(getV(c, s));
      radioSync(hits, v, grid);
      links.forEach((a, i) => { if (a) a.tabIndex = hits[i].dataset.id === v ? 0 : -1; });
    }, filter: words => filterItems(el, cards, opts, words) };
  }

  // Слот материала: строка «зона · материал», внутри фильтр по виду покрытия и сетка (строится при первом открытии)
  function buildSlot(c) {
    const slot = SLOTS.find(x => x.id === c.key);
    if (!slot) return null;
    if (slot.locked) {
      const it = MATERIALS[slot.group][0];
      const mini = h('span', { class: 'mini' }); fillSwatch(mini, it);
      const el = h('div', { class: 'slot locked', id: `sec-${slot.id}`, 'data-tip': it.name, 'data-tip2': 'уже уложен, не меняется' },
        mini, h('span', { class: 'locked-text' }, slot.lockedText || slot.label));
      return { el, sync() {}, filter: w => { el.classList.toggle('sr-hide', w.length > 0); return 0; } };
    }
    const list = MATERIALS[slot.group].filter(m => !m.legacy);   // legacy — только для старых кодов ссылок
    const opts = slot.same ? [{ id: 'same', name: slot.sameName }, ...list] : list;
    const mini = h('span', { class: 'mini' }), cur = h('span', { class: 'current' });
    const headBtn = h('button', { type: 'button', class: 'slot-head', 'aria-expanded': 'false', 'aria-controls': `slotb-${slot.id}` },
      mini, h('span', { class: 'slot-label' }, slot.short || slot.label), cur, icon('chev'));
    const inner = h('div', { class: 'slot-body' });
    const fold = h('div', { class: 'fold', id: `slotb-${slot.id}`, inert: true }, h('div', { class: 'fold-in' }, inner));
    const el = h('div', { class: 'slot', id: `sec-${slot.id}` }, headBtn, fold);
    const key = `slot:${slot.id}`;
    // Фильтр сетки: вид покрытия, бренд (или «все магазины»), порядок по цене. Помнится для слота в этом браузере.
    let sws = null, sel = null, grid = null, catBtns = [], brandSel = null, sortSel = null, countEl = null, emptyEl = null, searching = false;
    const real = opts.filter(o => o.id !== 'same');
    const flt = { type: 'all', brand: '', sort: '', ...(prefs.flt?.[slot.id] || {}) };
    const fltOn = () => flt.type !== 'all' || !!flt.brand;
    const passes = o => o.id === 'same' || searching || ((flt.type === 'all' || metaOf(o).type === flt.type)
      && (!flt.brand || (flt.brand === '*' ? !!metaOf(o).brand : metaOf(o).brand === flt.brand)));
    const applyFilter = (remember = true) => {
      if (!sws) return;
      radioSync(catBtns, flt.type);
      if (brandSel) brandSel.value = flt.brand;
      if (sortSel) {
        sortSel.value = flt.sort;
        const k = flt.sort === 'up' ? 1 : flt.sort === 'down' ? -1 : 0;
        const order = k ? [...sws].sort((a, b) => {
          if (a._opt.id === 'same') return -1;
          if (b._opt.id === 'same') return 1;
          const pa = metaOf(a._opt).price, pb = metaOf(b._opt).price;
          return (pa == null) - (pb == null) || (pa - pb) * k || a._i - b._i;
        }) : sws;
        grid.append(...order);
      }
      let n = 0;
      for (const b of sws) { const ok = passes(b._opt); b.classList.toggle('flt-hide', !ok); if (ok && b._opt.id !== 'same') n++; }
      if (countEl) countEl.textContent = fltOn() && !searching ? `${n} из ${real.length}` : `${real.length} ${plural(real.length, 'вариант', 'варианта', 'вариантов')}`;
      if (emptyEl) emptyEl.hidden = n > 0;
      if (!grid.contains(document.activeElement)) fixStop(grid, true);
      if (remember) { (prefs.flt ||= {})[slot.id] = { ...flt }; savePrefs(); }
    };
    const syncGrid = s => {
      const val = String(s[slot.id]);
      if (sel?.dataset.id !== val) {
        sel?.classList.remove('on'); sel?.setAttribute('aria-checked', 'false');
        sel = sws.find(b => b.dataset.id === val) || null;
        sel?.classList.add('on'); sel?.setAttribute('aria-checked', 'true');
        if (!grid.contains(document.activeElement)) fixStop(grid, true);
      }
      if (slot.same) fillSwatch(sws[0]._img, resolveItem({ ...s, [slot.id]: 'same' }, slot.id));
    };
    const build = () => {
      if (sws) return;
      sws = opts.map((it, i) => Object.assign(swatch(it, () => setV(c, it.id)), { _opt: it, _i: i }));
      grid = h('div', { class: `swatches${real.length > 30 ? ' many' : ''}`, role: 'radiogroup', 'aria-label': slot.label }, sws);
      if (real.length > 12) {
        const types = TYPES_ORDER.filter(t => real.some(o => metaOf(o).type === t));
        if (types.length > 1) {
          catBtns = ['all', ...types].map(t => h('button', { type: 'button', role: 'radio', tabindex: '-1', 'data-id': t,
            'aria-label': `${catName(t)}: ${t === 'all' ? real.length : real.filter(o => metaOf(o).type === t).length}`,
            onclick: () => { flt.type = t; applyFilter(); } }, catName(t)));
          inner.append(h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Вид покрытия' }, catBtns));
        }
        const brands = [...new Set(real.map(o => metaOf(o).brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        const priced = real.filter(o => metaOf(o).price != null).length;
        const tools = [];
        if (brands.length) {
          brandSel = h('select', { class: 'mini-sel', 'aria-label': 'Бренд', onchange: e => { flt.brand = e.target.value; applyFilter(); } },
            h('option', { value: '' }, 'Все бренды'),
            h('option', { value: '*' }, `Только из магазинов · ${real.filter(o => metaOf(o).brand).length}`),
            brands.map(b => h('option', { value: b }, `${b} · ${real.filter(o => metaOf(o).brand === b).length}`)));
          tools.push(brandSel);
        }
        if (priced >= 4) {
          sortSel = h('select', { class: 'mini-sel', 'aria-label': 'Порядок по цене', onchange: e => { flt.sort = e.target.value; applyFilter(); } },
            h('option', { value: '' }, 'По каталогу'), h('option', { value: 'up' }, 'Дешевле'), h('option', { value: 'down' }, 'Дороже'));
          tools.push(sortSel);
        }
        countEl = h('span', { class: 'grid-count', 'aria-live': 'polite' });
        inner.append(h('div', { class: 'grid-tools' }, tools, countEl));
        if (!brands.includes(flt.brand) && flt.brand !== '*') flt.brand = '';
      }
      emptyEl = h('p', { class: 'grid-empty', hidden: true }, 'С таким фильтром ничего нет. ',
        h('button', { type: 'button', class: 'link', onclick: () => { Object.assign(flt, { type: 'all', brand: '' }); applyFilter(); } }, 'Показать все'));
      inner.append(grid, emptyEl);
      applyFilter(false);
      syncGrid(state);
    };
    const setOpen = (open, remember = true) => {
      if (open) build();
      el.classList.toggle('open', open);
      headBtn.setAttribute('aria-expanded', String(open));
      fold.inert = !open;
      if (remember) { prefs.open[key] = open; savePrefs(); }
    };
    headBtn.addEventListener('click', () => setOpen(!el.classList.contains('open')));
    if (prefs.open[key]) setOpen(true, false);
    return {
      el, open: setOpen,
      sync(s) {
        const it = opts.find(o => o.id === s[slot.id]);
        const res = resolveItem(s, slot.id);
        cur.replaceChildren(...(it ? [it.name, it.note && it.id !== 'same' ? h('small', {}, ` · ${it.note}`) : null] : []).filter(Boolean));
        cur.title = res ? titleOf(res) : '';
        fillSwatch(mini, res);
        if (sws) syncGrid(s);
      },
      filter(words) {
        if (!words.length) {
          el.classList.remove('sr-hide');
          sws?.forEach(b => b.classList.remove('sr-hide'));
          if (searching) { searching = false; applyFilter(false); }
          setOpen(!!prefs.open[key], false);
          return 0;
        }
        const hits = new Set(real.filter(o => matches(o, words)).map(o => String(o.id)));
        el.classList.toggle('sr-hide', !hits.size);
        if (hits.size) {
          setOpen(true, false);
          searching = true; applyFilter(false);   // при поиске фильтр не мешает: ищем по всему слоту
          for (const b of sws) b.classList.toggle('sr-hide', !hits.has(b.dataset.id));
          if (countEl) countEl.textContent = `${hits.size} из ${real.length}`;
          if (emptyEl) emptyEl.hidden = true;
          fixStop(grid, true);
        }
        return hits.size;
      },
    };
  }

  const focusMap = new Map();
  function build(c, sec) {
    const inst = TYPES[c.type]?.(c, sec);
    if (!inst) return null;
    inst.def = c;
    for (const k of [c.key, c.id, ...(c.focus || [])]) if (k && !focusMap.has(k)) focusMap.set(k, { el: inst.el, sec, ctl: inst });
    return inst;
  }
  function syncCtl(inst, s) {
    if (!shown(inst.def, s)) { inst.el.hidden = true; return; }
    inst.el.hidden = inst.sync(s) === false;
  }

  // Контролы раздела по порядку, с вложенными группами
  const flatCtls = list => list.flatMap(k => (k.def.type === 'group' ? [k, ...flatCtls(k.kids || [])] : [k]));
  const RESETTABLE = new Set(['slot', 'swatches', 'products', 'chips', 'seg', 'select', 'toggle', 'slider']);
  // по умолчанию: initUI({ defaults }), иначе первое готовое сочетание («Как в эскизе»), иначе def контрола
  const defaultOf = c => {
    if (api.defaults && c.key in api.defaults) return api.defaults[c.key];
    if (PRESETS[0] && c.key in PRESETS[0].state) return PRESETS[0].state[c.key];
    return c.get || c.set ? undefined : c.def;
  };
  // {ключ: значение по умолчанию} для полей раздела, которые сейчас отличаются; видимые контролы важнее скрытых
  function resetPatch(sec, s) {
    const patch = {}, seen = new Set();
    const list = flatCtls(sec.ctls).filter(k => RESETTABLE.has(k.def.type) && !k.def.src && k.def.key && !SLOTS.find(x => x.id === k.def.key)?.locked);
    list.sort((a, b) => shown(b.def, s) - shown(a.def, s));
    for (const k of list) {
      const key = k.def.key;
      if (seen.has(key)) continue;
      seen.add(key);
      const def = defaultOf(k.def);
      if (def !== undefined && (s[key] ?? def) !== def) patch[key] = def;
    }
    return patch;
  }
  // Сводка свёрнутого раздела без своей summary: выбранные варианты первых двух видимых контролов выбора
  // («Нет» пропускается; если выбрано только «Нет» — так и пишем)
  function autoSummary(sec, s) {
    const out = [];
    let none = '';
    for (const k of flatCtls(sec.ctls)) {
      if (out.length >= 2) break;
      const c = k.def;
      if (!shown(c, s)) continue;
      if (['chips', 'seg', 'swatches', 'products', 'select'].includes(c.type)) {
        const v = getV(c, s), n = optName(optsOf(c), v);
        if (String(v) === 'none') none ||= n;
        else if (n) out.push(n);
      } else if (c.type === 'slot') out.push(resolveItem(s, c.key)?.name || '');
      else if (c.type === 'toggle' && (c.values ? getV(c, s) === c.values[1] : !!getV(c, s))) out.push(labelOf(c));
    }
    return out.filter(Boolean).join(' · ') || none;
  }

  function buildSection(d) {
    const sec = { def: d, ctls: [] };
    const inner = h('div', { class: 'sec-body' });
    let row = null;   // подряд идущие кнопки встают в один ряд
    for (const c of d.controls || []) {
      const inst = build(c, sec);
      if (!inst) continue;
      if (c.type === 'button') { if (!row) inner.append(row = h('div', { class: 'btns' })); row.append(inst.el); }
      else { row = null; inner.append(inst.el); }
      sec.ctls.push(inst);
    }
    // «Сбросить раздел»: поля состояния раздела, у которых известно значение по умолчанию
    const resetBtn = h('button', { type: 'button', class: 'reset', 'data-tip': 'Вернуть значения по умолчанию', 'data-tip2': `как в «${PRESETS[0]?.name || 'исходном'}»`,
      onclick: () => {
        const patch = resetPatch(sec, state);
        if (!Object.keys(patch).length) return;
        api.setState(patch);
        toast(`«${d.title}»: сброшено`, { label: 'Отменить', run: undo });
      } }, icon('reset'), 'Сбросить раздел');
    const foot = h('div', { class: 'sec-foot' }, resetBtn);
    inner.append(foot);
    const sum = h('span', { class: 'sec-sum' });
    const headBtn = h('button', { type: 'button', class: 'sec-head', 'aria-controls': `grpb-${d.id}` },
      h('span', { class: 'sec-title' }, d.title), sum, icon('chev'));
    const fold = h('div', { class: 'fold', id: `grpb-${d.id}` }, h('div', { class: 'fold-in' }, inner));
    sec.el = h('section', { class: 'sec', id: d.elId || `grp-${d.id}`, 'aria-label': d.title }, h('h3', {}, headBtn), fold);
    sec.userOpen = () => prefs.open[d.id] ?? !!d.open;
    sec.setOpen = (open, remember = true) => {
      sec.el.classList.toggle('open', open);
      headBtn.setAttribute('aria-expanded', String(open));
      fold.inert = !open;
      if (remember) { prefs.open[d.id] = open; savePrefs(); }
    };
    // Alt-клик: открыть только этот раздел вкладки
    headBtn.addEventListener('click', e => {
      if (e.altKey) sections.forEach(x => x.def.tab === d.tab && x !== sec && x.setOpen(false));
      sec.setOpen(e.altKey || !sec.el.classList.contains('open'));
    });
    sec.setOpen(sec.userOpen(), false);
    sec.sync = s => {
      sec.el.hidden = !shown(d, s);
      if (sec.el.hidden) return;
      for (const c of sec.ctls) syncCtl(c, s);
      sum.textContent = d.summary ? d.summary(s, info) : autoSummary(sec, s);
      const changed = Object.keys(resetPatch(sec, s)).length > 0;
      foot.hidden = !changed;
      sec.el.classList.toggle('changed', changed);
    };
    for (const k of d.focus || []) if (!focusMap.has(k)) focusMap.set(k, { el: sec.el, sec });
    return sec;
  }

  // --- шапка: вариант, отмена, A/B, код, вкладки, поиск
  const vname = h('span', { class: 'name' });
  const vbtn = h('button', { type: 'button', id: 'variant-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'variant-pop', onclick: () => (pop.hidden ? openPop() : closePop()) },
    h('span', { class: 'v-text' }, h('span', { class: 'cap' }, 'Вариант'), vname), icon('chev'));
  const undoBtn = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Отменить', 'data-tip': 'Отменить', 'data-tip2': `${MOD}Z`, onclick: () => undo() }, icon('undo'));
  const redoBtn = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Вернуть', 'data-tip': 'Вернуть', 'data-tip2': `⇧${MOD}Z`, onclick: () => redo() }, icon('redo'));
  const abStart = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Сравнить A/B', 'data-tip': 'Сравнить два варианта',
    'data-tip2': 'запомнить текущий как A', onclick: () => startAB() }, icon('ab'));
  const abA = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => switchAB('A') }, 'A');
  const abB = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => switchAB('B') }, 'B');
  const abPill = h('div', { class: 'ab', role: 'group', 'aria-label': 'Сравнение A/B, клавиша C', hidden: true }, abA, abB,
    h('button', { type: 'button', class: 'ab-x', 'aria-label': 'Закончить сравнение', 'data-tip': 'Закончить сравнение', onclick: () => stopAB() }, icon('close')));
  const hideBtn = h('button', { type: 'button', class: 'ibtn hide-btn', 'aria-label': 'Скрыть панель', 'data-tip': 'Скрыть панель', onclick: () => setPanelOpen(false) }, icon('side'));
  const codeTxt = h('span');
  const codeBtn = h('button', { type: 'button', id: 'code-btn', 'data-tip': 'Скопировать код варианта', 'data-tip2': 'по нему вариант откроется у любого', onclick: copyCode }, codeTxt, icon('copy'));
  const tabBtns = {};
  const tabBar = h('div', { id: 'tabs', role: 'tablist', 'aria-label': 'Разделы' }, TABS.map((t, i) => (tabBtns[t.id] = h('button', {
    type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `pane-${t.id}`, 'aria-selected': 'false', 'data-tip': t.title, 'data-tip2': `клавиша ${i + 1}`,
    onclick: () => setTab(t.id) }, icon(t.icon), h('span', {}, t.short)))));
  const search = h('input', { type: 'search', id: 'mat-search', placeholder: 'Найти: дуб, микроцемент, Carrea…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Поиск материала' });
  const searchCount = h('span', { id: 'search-count', 'aria-live': 'polite' });
  const searchRow = h('div', { id: 'search-row' }, icon('search'), search, searchCount);
  const pop = h('div', { id: 'variant-pop', class: 'pop', role: 'dialog', 'aria-label': 'Сочетания и варианты', hidden: true });
  head.replaceChildren(
    h('div', { class: 'head-row' }, vbtn, undoBtn, redoBtn, abStart, abPill, hideBtn),
    h('div', { class: 'head-row code-row' }, codeBtn),
    tabBar, searchRow, h('i', { id: 'busy-bar' }), pop);

  const grabTitle = h('span');
  const grab = h('button', { type: 'button', id: 'sheet-grab', 'aria-expanded': 'false', 'aria-controls': 'panel-body' }, h('i'), grabTitle);
  panel.prepend(grab);
  const toggleBtn = $('#panel-toggle');
  toggleBtn.replaceChildren(icon('side'), h('span', {}, 'Панель'));
  toggleBtn.addEventListener('click', () => setPanelOpen(true));
  const badge = h('div', { id: 'ab-badge', hidden: true, 'aria-hidden': 'true' }, h('b'), h('span', {}, 'C — переключить'));
  const tip = h('div', { id: 'tip', role: 'tooltip' });
  // Плашка фото-рендера: пока трассировка идёт, на экране всегда видно, что она идёт, и как её выключить
  const photoTxt = h('span');
  const photoBadge = h('div', { id: 'photo-badge', role: 'status', hidden: true }, h('i'), h('b', {}, 'Фото-рендер'), photoTxt,
    h('button', { type: 'button', onclick: () => emit('photo', false) }, 'Выключить'));
  document.body.append(badge, tip, photoBadge);

  // --- вкладки
  const panes = {}, empties = {}, scrolls = {};
  for (const t of TABS) {
    panes[t.id] = h('div', { class: 'pane', id: `pane-${t.id}`, role: 'tabpanel', 'aria-labelledby': `tab-${t.id}`, hidden: true });
    empties[t.id] = h('p', { class: 'empty' });
    body.append(panes[t.id]);
  }
  const TAB = id => TABS.find(t => t.id === id);
  let tab = null;
  function setTab(id) {
    if (!panes[id]) return;
    if (tab) scrolls[tab] = body.scrollTop;
    tab = id; prefs.tab = id; savePrefs();
    for (const t of TABS) {
      const on = t.id === id;
      tabBtns[t.id].setAttribute('aria-selected', String(on));
      tabBtns[t.id].tabIndex = on ? 0 : -1;
      panes[t.id].hidden = !on;
    }
    searchRow.hidden = !TAB(id).search;
    if (TAB(id).search) search.placeholder = TAB(id).search;
    grabTitle.textContent = TAB(id).title;
    update();
    body.scrollTop = scrolls[id] || 0;
  }
  tabBar.addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    const i = (TABS.findIndex(t => t.id === tab) + d + TABS.length) % TABS.length;
    setTab(TABS[i].id); tabBtns[TABS[i].id].focus(); e.preventDefault();
  });

  let sections = [];
  function remount() {
    const byId = new Map();
    for (const d of [...coreSections(), ...moduleSections(roomW), ...extra]) byId.set(d.id, d);
    sections = []; focusMap.clear();
    for (const t of TABS) panes[t.id].replaceChildren();
    for (const d of [...byId.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50))) {
      if (!panes[d.tab]) continue;
      const sec = buildSection(d);
      sections.push(sec); panes[d.tab].append(sec.el);
    }
    for (const t of TABS) panes[t.id].append(empties[t.id]);
    if (query) applySearch(); else update();
  }

  // --- обновление: шапка и только открытая вкладка (остальные — при переключении)
  let raf = 0;
  const scheduleUpdate = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); };
  const presetOn = (p, s) => Object.entries(p.state).every(([k, v]) => s[k] === v);
  function update(s = state) {
    if (!tab) return;
    const code = api.encode(s);
    codeTxt.textContent = code;
    const p = PRESETS.find(x => presetOn(x, s));
    vname.textContent = p?.name || saved.find(v => v.code === code)?.name || 'Свой вариант';
    undoBtn.disabled = !undoStack.length; redoBtn.disabled = !redoStack.length;
    abStart.hidden = !!ab; abPill.hidden = !ab; badge.hidden = !ab;
    const ph = info.photo;
    photoBadge.hidden = !ph?.running;
    if (ph?.running) { photoBadge.classList.toggle('done', ph.phase === 'done'); photoTxt.textContent = photoStatus(ph); }
    if (ab) {
      for (const [b, side] of [[abA, 'A'], [abB, 'B']]) { b.classList.toggle('on', ab.side === side); b.setAttribute('aria-pressed', String(ab.side === side)); }
      badge.firstChild.textContent = ab.side;
    }
    let any = false;
    for (const sec of sections) {
      if (sec.def.tab !== tab) continue;
      sec.sync(s);
      any ||= !sec.el.hidden && !sec.el.classList.contains('sr-hide');
    }
    const t = TAB(tab);
    empties[tab].hidden = any;
    empties[tab].textContent = query && t.search ? `Ничего не нашлось: «${search.value.trim()}»` : t.empty || '';
  }

  // --- поиск материалов (во всех вкладках с поиском сразу)
  let query = '';
  function applySearch() {
    const words = query ? query.split(/\s+/) : [];
    let total = 0;
    for (const sec of sections) {
      if (!TAB(sec.def.tab).search) continue;
      let n = 0;
      for (const c of sec.ctls) {
        if (c.filter) n += c.filter(words);
        else c.el.classList.toggle('sr-hide', words.length > 0);
      }
      sec.el.classList.toggle('sr-hide', words.length > 0 && !n);
      sec.setOpen(words.length ? n > 0 : sec.userOpen(), false);
      if (sec.def.tab === tab) total += n;
    }
    searchCount.textContent = words.length ? String(total) : '';
    update();
  }
  search.addEventListener('input', () => { query = norm(search.value.trim()); applySearch(); });
  const clearSearch = () => { if (!search.value) return; search.value = ''; query = ''; applySearch(); };

  // --- отмена и возврат: снимки состояния; шаги одного ползунка подряд сливаются
  const undoStack = [], redoStack = [];
  let base = null, restoring = false, lastGesture = null, lastT = 0;
  const snap = s => ({ ...s });
  const sameState = (a, b) => { for (const k in a) if (a[k] !== b[k]) return false; for (const k in b) if (!(k in a)) return false; return true; };
  function track(s) {
    if (!base || restoring) { base = snap(s); gesture = null; return; }
    if (sameState(base, s)) { gesture = null; return; }
    const now = performance.now();
    if (!(gesture && gesture === lastGesture && now - lastT < 1000)) {
      undoStack.push(base);
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
    }
    lastGesture = gesture; lastT = now; gesture = null;
    base = snap(s);
  }
  function restore(from, to, msg, action) {
    if (!from.length) return;
    to.push(snap(state));
    const s = from.pop();
    restoring = true;
    try { api.setState(s); } finally { restoring = false; }
    toast(msg, action);
  }
  const undo = () => restore(undoStack, redoStack, 'Отменено', { label: 'Вернуть', run: () => redo() });
  const redo = () => restore(redoStack, undoStack, 'Возвращено');

  // --- сравнение A/B: две ячейки, открытая правится вживую
  let ab = null;
  function startAB() {
    ab = { A: snap(state), B: null, side: 'B' };
    toast('A запомнен. Меняйте дальше — это B. Переключение: кнопки A/B или C');
    update();
  }
  function switchAB(side) {
    if (!ab || ab.side === side) return;
    ab[ab.side] = snap(state); ab.side = side;
    api.setState({ ...ab[side] });
  }
  function stopAB() { ab = null; update(); toast('Сравнение закончено, остаётся то, что на экране'); }

  // --- всплывающее окно вариантов: сочетания, мои варианты, код
  function openCode(code) {
    const s = api.decode(code);
    if (s) { api.setState(s); closePop(); } else toast('Код не читается');
  }
  const popItem = (name, on, run) => h('button', { type: 'button', class: 'pop-item', 'aria-current': on ? 'true' : null, onclick: run }, h('span', {}, name), on ? h('span', { class: 'tick' }, '✓') : null);
  function renderPop() {
    const code = api.encode(state);
    const nameIn = h('input', { type: 'text', placeholder: 'Название варианта', maxlength: 40, autocomplete: 'off', 'aria-label': 'Название варианта' });
    const codeIn = h('input', { type: 'text', class: 'mono', value: code, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Код варианта', onfocus: e => e.target.select() });
    pop.replaceChildren(
      h('p', { class: 'pop-h' }, 'Готовые сочетания'),
      ...PRESETS.map(p => popItem(p.name, presetOn(p, state), () => { api.setState({ ...p.state }); closePop(); })),
      h('p', { class: 'pop-h' }, 'Мои варианты'),
      ...(saved.length ? saved.map(v => h('div', { class: 'pop-row' },
        popItem(v.name, v.code === code, () => openCode(v.code)),
        h('button', { type: 'button', class: 'ibtn', 'aria-label': `Удалить «${v.name}»`, 'data-tip': 'Удалить', onclick: () => {
          storeSaved(saved.filter(x => x.name !== v.name)); renderPop(); update();
        } }, icon('close'))))
        : [h('p', { class: 'pop-empty' }, 'Сохраните текущий вариант, чтобы вернуться к нему. Хранится в этом браузере.')]),
      h('form', { class: 'pop-form', onsubmit: e => {
        e.preventDefault();
        const name = nameIn.value.trim() || `Вариант ${saved.length + 1}`;
        storeSaved([...saved.filter(v => v.name !== name), { name, code: api.encode(state) }]);
        toast(`Сохранено: ${name}`); renderPop(); update();
      } }, nameIn, h('button', { type: 'submit', class: 'btn' }, 'Сохранить')),
      h('p', { class: 'pop-h' }, 'Код варианта'),
      h('form', { class: 'pop-form', onsubmit: e => { e.preventDefault(); openCode(codeIn.value); } }, codeIn, h('button', { type: 'submit', class: 'btn' }, 'Открыть')),
    );
  }
  function openPop() {
    renderPop();
    pop.hidden = false;
    pop.style.top = `${vbtn.offsetTop + vbtn.offsetHeight + 6}px`;
    vbtn.setAttribute('aria-expanded', 'true');
    pop.querySelector('.pop-item')?.focus();
  }
  function closePop(focusBack = true) {
    if (pop.hidden) return;
    pop.hidden = true;
    vbtn.setAttribute('aria-expanded', 'false');
    if (focusBack) vbtn.focus();
  }
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !vbtn.contains(e.target)) closePop(false); });
  async function copyCode() {
    const code = api.encode(state);
    try { await navigator.clipboard.writeText(code); toast('Код варианта скопирован'); }
    catch { openPop(); const inp = pop.querySelector('.mono'); inp.focus(); inp.select(); }
  }

  // --- подсказки: одна плашка на всю панель
  let tipT = 0, tipFor = null;
  function showTip(el) {
    tipFor = el;
    tip.replaceChildren(el.dataset.tip, ...(el.dataset.tip2 ? [h('small', {}, el.dataset.tip2)] : []));
    tip.classList.add('on');
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, th = tip.offsetHeight;
    const x = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    const y = r.top - th - 8 < 8 ? r.bottom + 8 : r.top - th - 8;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  function hideTip() { clearTimeout(tipT); tipFor = null; tip.classList.remove('on'); }
  panel.addEventListener('pointerover', e => {
    const el = e.target.closest('[data-tip]');
    if (el === tipFor) return;
    clearTimeout(tipT);
    if (!el || e.pointerType === 'touch') { hideTip(); return; }
    if (tip.classList.contains('on')) showTip(el); else tipT = setTimeout(() => showTip(el), 350);
  });
  panel.addEventListener('pointerleave', hideTip);
  panel.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el && e.target.matches(':focus-visible')) showTip(el); else hideTip(); });
  panel.addEventListener('focusout', hideTip);
  body.addEventListener('scroll', hideTip, { passive: true });

  // стрелки внутри групп выбора (образцы, карточки, чипы, сегменты): двигают фокус, Пробел/Enter выбирает
  body.addEventListener('keydown', e => {
    const dir = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 'down', ArrowUp: 'up', Home: 'home', End: 'end' }[e.key];
    const group = dir && e.target.closest?.('[role=radiogroup]');
    if (!group || e.target.getAttribute('role') !== 'radio') return;
    const items = [...group.querySelectorAll('[role=radio]')].filter(b => b.closest('[role=radiogroup]') === group && b.offsetParent !== null);
    const i = items.indexOf(e.target);
    if (i < 0) return;
    let j = i;
    if (dir === 'home') j = 0;
    else if (dir === 'end') j = items.length - 1;
    else if (typeof dir === 'number') j = i + dir;
    else {
      // колонка по экрану: ближайший по X элемент в соседнем ряду
      const r = e.target.getBoundingClientRect(), cx = r.left + r.width / 2;
      const rows = items.map(b => b.getBoundingClientRect());
      const cand = items.map((b, k) => ({ k, r: rows[k] })).filter(x => (dir === 'down' ? x.r.top > r.top + 2 : x.r.top < r.top - 2));
      if (cand.length) {
        const rowTop = dir === 'down' ? Math.min(...cand.map(x => x.r.top)) : Math.max(...cand.map(x => x.r.top));
        j = cand.filter(x => Math.abs(x.r.top - rowTop) < 2)
          .reduce((a, x) => (Math.abs(x.r.left + x.r.width / 2 - cx) < Math.abs(a.r.left + a.r.width / 2 - cx) ? x : a)).k;
      }
    }
    j = Math.min(items.length - 1, Math.max(0, j));
    group.querySelectorAll('[role=radio]').forEach(b => { b.tabIndex = b === items[j] ? 0 : -1; });
    items[j].focus();
    items[j].scrollIntoView({ block: 'nearest' });
    e.preventDefault();
  });

  // --- открытие панели: справа на компьютере, шторка снизу уже 800 px
  const mq = matchMedia('(max-width: 800px)');
  let open = false;
  function setPanelOpen(v) {
    open = v;
    panel.classList.toggle('open', v);
    document.body.classList.toggle('panel-open', v && !mq.matches);
    grab.setAttribute('aria-expanded', String(v));
    toggleBtn.setAttribute('aria-expanded', String(v));
    toggleBtn.hidden = v || mq.matches;
    head.inert = body.inert = !v;
    if (!v) { closePop(false); hideTip(); }
    if (!mq.matches) { prefs.panel = v; savePrefs(); }
  }
  mq.addEventListener('change', () => setPanelOpen(!mq.matches && prefs.panel !== false));
  // шторка: тап по ручке — открыть/закрыть, потянуть — то же жестом
  let drag = null, dragged = false;
  grab.addEventListener('pointerdown', e => { drag = { y: e.clientY, moved: false }; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 6) { drag.moved = true; panel.classList.add('dragging'); }
    if (drag.moved) panel.style.setProperty('--drag', `${open ? Math.max(0, dy) : Math.min(0, dy)}px`);
  });
  const endDrag = e => {
    if (!drag) return;
    const dy = e.clientY - drag.y, moved = drag.moved;
    drag = null;
    panel.classList.remove('dragging'); panel.style.removeProperty('--drag');
    if (!moved) return;
    dragged = true;
    if (open && dy > 60) setPanelOpen(false); else if (!open && dy < -30) setPanelOpen(true);
  };
  grab.addEventListener('pointerup', endDrag);
  grab.addEventListener('pointercancel', endDrag);
  grab.addEventListener('click', () => { if (dragged) { dragged = false; return; } setPanelOpen(!open); });

  // --- клавиатура
  const typing = el => el?.matches?.('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable="true"]');
  addEventListener('keydown', e => {
    const walking = document.body.classList.contains('kw-walking');
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      if (typing(e.target)) return;   // в поле ввода — его собственная отмена
      e.preventDefault();
      if (e.code === 'KeyY' || e.shiftKey) redo(); else undo();
      return;
    }
    if (e.key === 'Escape') {
      if (walking) return;   // из прогулки выводит walk.js
      if (!pop.hidden) closePop();
      else if (e.target === search && search.value) clearSearch();
      else if (mq.matches && open) setPanelOpen(false);
      else if (panel.contains(document.activeElement)) document.activeElement.blur();
      return;
    }
    if (typing(e.target) || mod || e.altKey || walking) return;
    const n = /^[1-9]$/.test(e.key) ? TABS[e.key - 1] : null;
    if (n) { setTab(n.id); if (!open) setPanelOpen(true); e.preventDefault(); }
    else if (e.key === '/' && TAB(tab).search) { if (!open) setPanelOpen(true); search.focus(); search.select(); e.preventDefault(); }
    else if (e.code === 'KeyC' && ab && !e.repeat) switchAB(ab.side === 'A' ? 'B' : 'A');
  });

  // прогулка включается и клавишей F в walk.js: следим за классом body, чтобы переключатель не отставал
  new MutationObserver(scheduleUpdate).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // --- ракурсы
  const viewBar = $('#views');
  const markView = id => viewBar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === id));
  viewBar.append(...api.views.map(v => h('button', { type: 'button', 'data-view': v.id, onclick: () => { api.goView(v.id); markView(v.id); } }, v.name)));
  markView('hall');
  // На узком окне полоса ракурсов по центру наезжает на «Прогулку» и план слева внизу:
  // тогда ставим её сразу правее этого блока и даём ширину до панели (лишнее прокручивается).
  function fitViewBar() {
    viewBar.style.transition = 'none';   // меряем конечное положение, а не середину анимации
    viewBar.style.left = viewBar.style.maxWidth = viewBar.style.transform = '';
    requestAnimationFrame(() => { viewBar.style.transition = ''; });
    const dock = document.getElementById('kw-dock');
    if (!dock || getComputedStyle(viewBar).display === 'none') return;
    const v = viewBar.getBoundingClientRect(), d = dock.getBoundingClientRect();
    const sameRow = d.width > 0 && d.bottom > v.top && d.top < v.bottom;
    if (!sameRow || v.left >= d.right + 8) return;
    const panel = $('#panel'), pr = panel && document.body.classList.contains('panel-open') ? panel.getBoundingClientRect().left : innerWidth;
    viewBar.style.transform = 'none';
    viewBar.style.left = Math.round(d.right + 10) + 'px';
    viewBar.style.maxWidth = Math.max(160, Math.round(pr - d.right - 24)) + 'px';
  }
  addEventListener('resize', fitViewBar);
  new MutationObserver(() => requestAnimationFrame(fitViewBar)).observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true });
  setTimeout(fitViewBar, 300);

  // --- всплывающее сообщение
  const toastEl = $('#toast');
  let tt = 0;
  function toast(msg, action) {
    toastEl.replaceChildren(h('span', {}, msg), action ? h('button', { type: 'button', class: 'toast-act', onclick: () => { toastEl.hidden = true; action.run(); } }, action.label) : null);
    toastEl.hidden = false; clearTimeout(tt); tt = setTimeout(() => { toastEl.hidden = true; }, action ? 5000 : 2600);
  }

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  // --- запуск
  if (prefs.quality === 'ultra' && !has('render')) delete prefs.quality;
  applyTheme(prefs.theme);
  if (prefs.quality && prefs.quality !== 'high') emit('quality', prefs.quality);
  remount();
  setTab(TAB(prefs.tab) ? prefs.tab : 'mat');
  setPanelOpen(!mq.matches && prefs.panel !== false);

  const ALIAS = { floor: 'floorA', bath: 'wallsBath' };
  const handle = {
    addSection,
    // main.js зовёт после каждого setState: запись в отмену + перерисовка
    sync(s) { track(s); update(s); },
    update,
    // быстрый путь ползунка границы пола
    syncSplit(s) { for (const k of ['split', 'splitInfo']) { const f = focusMap.get(k); if (f?.ctl) syncCtl(f.ctl, s); } },
    setIslandInfo(b) {
      const behind = roomW - b.x1, toShaft = 2.769 - b.z1;
      info.island = `Проход ${cm(b.x0 - kit.run.depth)} · за островом до стены ${cm(behind)} · до оконной стены ${cm(b.z0)} · торец до линии шахты ${cm(toShaft)}`;
      scheduleUpdate();
    },
    // клик по поверхности в 3D: вкладка, раздел, строка, прокрутка, вспышка
    focusSlot(id) {
      const f = focusMap.get(ALIAS[id] || id);
      if (!f || !shown(f.sec.def, state)) return;
      clearSearch();
      setTab(f.sec.def.tab);
      const wasOpen = f.sec.el.classList.contains('open') && (!f.ctl?.open || f.el.classList.contains('open'));
      f.sec.setOpen(true);
      f.ctl?.open?.(true);
      if (!open) setPanelOpen(true);
      setTimeout(() => {
        f.el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
        f.el.classList.remove('flash'); void f.el.offsetWidth; f.el.classList.add('flash');
      }, wasOpen || reduced() ? 0 : 240);
    },
    setBusy(b) { document.body.classList.toggle('busy', b); panel.classList.toggle('busy', b); },
    ready() { document.body.classList.add('ready'); },
    // для модулей
    info(patch) { Object.assign(info, patch); scheduleUpdate(); return handle; },
    on(name, fn) { (handlers[name] ||= []).push(fn); if (name !== 'open' && prefs[name] !== undefined) fn(prefs[name], state); return handle; },
    enable(...names) { names.forEach(n => features.add(n)); remount(); return handle; },
    connect(mods) { Object.assign(api, mods); remount(); return handle; },
    pref: key => prefs[key],
    setTab, toast, undo, redo,
  };
  live = { remount };
  return handle;
}
