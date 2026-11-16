// Порядок загрузки и прогресс: сначала то, что видно с первого ракурса, остальное — потом и фоном.
//
//   track(promise, { later, label, url, weight }) — учесть загрузку в прогрессе:
//        later: true — фоновая (в счёт идёт после первого вида); label — что это человеческими словами
//        («Кухня», «Мебель гостиной», «Спальня»), экран загрузки показывает подписи того, что грузится сейчас;
//        url — путь файла (как для assetUrl): по нему вес в прогрессе — настоящий размер из сборки (weightOf);
//        weight — вес явно (КБ), если адреса нет. Без подписи — «Материалы и вещи».
//   whenRoom                   — Promise: первый вид готов (main.js зовёт roomReady()); фоновые загрузки ждут его
//   afterRoom(fn)              — запустить fn после первого вида (отложенные загрузки: дальние комнаты, ванная)
//   roomReady(), isRoomReady() — первый кадр готов: открыть deferred-ресурсы, НЕ убирать заставку
//   assetUrl(path)             — адрес файла с версией сборки (?v=<хеш папки>), см. ниже
//   assetIndex(key)            — данные, вложенные сборкой в страницу (id="asset-index"): 'sizes' — textures/sizes.json,
//                                'meta' — { id: meta.json } всех текстур. Локально — undefined: модуль читает файл сам.
//   weightOf(path)             — примерный размер файла, КБ (по сборке; локально — по типу файла)
//   retry(load, tries = 3)     — повторить оборванную загрузку (load — функция, возвращающая Promise)
//   FIRST_ROOMS, inFirstView(x, y, z, r) — что видно с первого ракурса (комнаты; шар в кадре стартовой камеры,
//                                проверку задаёт main.js через setFirstView): это грузится до заставки, остальное — после
//
// Событие для экрана загрузки (ловит index.html и ui.js), на window:
//   kitchen:progress  detail { phase, loaded, total, done, weight, labels }
//   phase 'start'   — грузится первый вид; 'room' — открыть отложенную работу;
//         'details' — догружается остальное фоном; 'done' — всё (дальше событий нет; загрузки по действиям
//         пользователя показывает ui.setBusy)
//   loaded/total — файлов этого этапа; done/weight — КБ этого этапа (total и weight растут, пока узнаём, что нужно:
//   полоса на экране поэтому никогда не идёт назад — это забота показа); labels — подписи того, что грузится сейчас,
//   самое тяжёлое из оставшегося — первым.
//
// Версии файлов: tools/build_static.mjs кладёт в dist/index.html <script type="application/json" id="asset-versions">
// { "<папка>": "<хеш содержимого>/<средний размер файла, КБ>" } для textures/ и models/. Адрес с ?v= Vercel отдаёт
// с кешем на год (vercel.json): после обновления файла меняется хеш его папки, а значит и адрес — старый кеш не мешает.
// Локально (tools/serve.py) карты нет: адреса без версии, вес — по типу файла.

import { startup } from './startup-state.js';
export const PROGRESS = 'kitchen:progress';

const inline = id => { try { return JSON.parse(document.getElementById(id)?.textContent || 'null'); } catch { return null; } };
const VERSIONS = inline('asset-versions') || {};
const INDEX = inline('asset-index') || {};
const folderOf = path => path.slice(0, path.lastIndexOf('/'));
export function assetUrl(path) {
  const v = VERSIONS[folderOf(path)]?.split('/')[0];
  return v ? `${path}?v=${v}` : path;
}
export const assetIndex = key => INDEX[key];

// Вес файла в прогрессе, КБ: средний размер файлов его папки из сборки, иначе — типичный для такого файла
const TYPICAL = { hdr: 300, glb: 60, jpg: 45, png: 45, webp: 30, json: 2 };
export function weightOf(path) {
  const kb = Number(VERSIONS[folderOf(String(path).split('?')[0])]?.split('/')[1]);
  if (kb > 0) return kb;
  return TYPICAL[String(path).split('?')[0].split('.').pop()] ?? 40;
}

const DEFAULT_LABEL = 'Материалы и вещи';
let phase = 'start', loaded = 0, total = 0, stage = 0;   // stage: 0 — первый вид, 1 — остальное
let done = 0, weight = 0;
const pending = new Map();   // подпись -> { n, kb }: сколько её загрузок идёт и сколько КБ осталось
const labels = () => [...pending].sort((a, b) => b[1].kb - a[1].kb).map(e => e[0]);
let resolveRoom;
export const whenRoom = new Promise(r => { resolveRoom = r; });

let queued = false;
function emit() {
  if (queued) return;   // десятки загрузок заканчиваются в одном такте — одно событие
  queued = true;
  queueMicrotask(() => {
    queued = false;
    dispatchEvent(new CustomEvent(PROGRESS, { detail: { phase, loaded, total, done: Math.round(done), weight: Math.round(weight), labels: labels() } }));
  });
}
function emitNow() { queued = false; dispatchEvent(new CustomEvent(PROGRESS, { detail: { phase, loaded, total, done: Math.round(done), weight: Math.round(weight), labels: labels() } })); }

let doneTimer = 0;
function checkDone() {
  clearTimeout(doneTimer);
  // «Готово» — когда за полсекунды не появилось новых загрузок (одна часто тянет за собой следующую)
  if (phase === 'details' && loaded >= total) doneTimer = setTimeout(() => { if (loaded >= total && phase === 'details') { phase = 'done'; emitNow(); } }, 500);
}

export function track(promise, { later = false, label = DEFAULT_LABEL, url = null, weight: w = null } = {}) {
  startup.track(promise, { label, weight: w ?? (url ? weightOf(url) : TYPICAL.jpg) });
  if (phase === 'done') return promise;
  if (later && phase === 'start') {   // фоновая: в счёт идёт с этапа details
    whenRoom.then(() => track(promise, { label, url, weight: w }));
    return promise;
  }
  const kb = w ?? (url ? weightOf(url) : TYPICAL.jpg);
  total++; weight += kb;
  const g = pending.get(label) || { n: 0, kb: 0 };
  g.n++; g.kb += kb; pending.set(label, g);
  emit();
  const own = stage;   // загрузка первого вида, закончившаяся после него, в счёт «остального» не идёт
  const fin = () => {
    if (own !== stage || phase === 'done') return;
    loaded++; done += kb;
    const g = pending.get(label);
    if (g) { g.n--; g.kb -= kb; if (g.n <= 0) pending.delete(label); }
    emit(); checkDone();
  };
  promise.then(fin, fin);
  return promise;
}

// Повтор оборванной загрузки (мобильная сеть, локальный сервер под нагрузкой): load() ещё до двух раз с паузой,
// иначе вещь/материал/небо так и останутся пустыми до перезагрузки страницы
export async function retry(load, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await load(); } catch (e) {
      if (i >= tries) throw e;
      await new Promise(r => setTimeout(r, 400 * i));
    }
  }
}

export function afterRoom(fn) { return startup.track(whenRoom.then(fn)); }
export const isRoomReady = () => phase !== 'start';

export function roomReady() {
  if (phase !== 'start') return;
  phase = 'room'; emitNow();
  phase = 'details'; loaded = total = 0; done = weight = 0; stage = 1; pending.clear();
  resolveRoom();
  queueMicrotask(() => { emit(); checkDone(); });
}

emit();   // phase 'start', 0 / 0 — модули начали грузиться

// Комнаты, видные с первого ракурса (холл, кухня-гостиная, шахта): их обстановка грузится до первого кадра,
// остальных (балкон за стеклом, спальня, кабинет, ванная) — сразу после него и вырастает на месте (decor.js).
export const FIRST_ROOMS = new Set(['kitchen_living', 'hall', 'shaft']);
let firstView = () => true;
export function setFirstView(fn) { firstView = fn; }
export const inFirstView = (x, y, z, r) => firstView(x, y, z, r);
