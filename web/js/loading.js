// Порядок загрузки и прогресс: сначала то, что видно с первого ракурса, остальное — потом и фоном.
//
//   track(promise, { later })  — учесть загрузку в прогрессе (later: true — фоновая, после первого кадра)
//   whenRoom                   — Promise: первый вид готов (main.js зовёт roomReady()); фоновые загрузки ждут его
//   afterRoom(fn)              — запустить fn после первого вида (отложенные загрузки: дальние комнаты, ванная)
//   roomReady(), isRoomReady() — main.js: первый кадр нарисован, можно убирать заставку
//   assetUrl(path)             — адрес файла с версией сборки (?v=<хеш папки>), см. ниже
//   retry(load, tries = 3)     — повторить оборванную загрузку (load — функция, возвращающая Promise)
//   FIRST_ROOMS, inFirstView(x, y, z, r) — что видно с первого ракурса (комнаты; шар в кадре стартовой камеры,
//                                проверку задаёт main.js через setFirstView): это грузится до заставки, остальное — после
//
// Событие для экрана загрузки (ловит ui.js), на window:
//   kitchen:progress  detail { phase, loaded, total }
//   phase 'start'   — грузится первый вид: loaded/total — файлов этого этапа (total может расти, пока узнаём, что нужно)
//         'room'    — первый вид готов и нарисован: заставку можно убрать
//         'details' — догружается остальное (дальние комнаты, полные текстуры); loaded/total — по всем файлам
//         'done'    — всё догружено; дальше событий нет (загрузки по действиям пользователя показывает ui.setBusy)
//
// Версии файлов: tools/build_static.mjs кладёт в dist/index.html <script type="application/json" id="asset-versions">
// { "<папка>": "<хеш содержимого>" } для textures/ и models/. Адрес с ?v= Vercel отдаёт с кешем на год
// (vercel.json): после обновления файла меняется хеш его папки, а значит и адрес — старый кеш не мешает.
// Локально (tools/serve.py) карты нет: адреса без версии.

export const PROGRESS = 'kitchen:progress';

const VERSIONS = (() => {
  try { return JSON.parse(document.getElementById('asset-versions')?.textContent || '{}'); } catch { return {}; }
})();
export function assetUrl(path) {
  const v = VERSIONS[path.slice(0, path.lastIndexOf('/'))];
  return v ? `${path}?v=${v}` : path;
}

let phase = 'start', loaded = 0, total = 0, stage = 0;   // stage: 0 — первый вид, 1 — остальное
let resolveRoom;
export const whenRoom = new Promise(r => { resolveRoom = r; });

function emit() {
  dispatchEvent(new CustomEvent(PROGRESS, { detail: { phase, loaded, total } }));
}
let doneTimer = 0;
function checkDone() {
  clearTimeout(doneTimer);
  // «Готово» — когда за полсекунды не появилось новых загрузок (одна часто тянет за собой следующую)
  if (phase === 'details' && loaded >= total) doneTimer = setTimeout(() => { if (loaded >= total && phase === 'details') { phase = 'done'; emit(); } }, 500);
}

export function track(promise, { later = false } = {}) {
  if (phase === 'done') return promise;
  if (later && phase === 'start') {   // фоновая: в счёт идёт с этапа details
    whenRoom.then(() => track(promise));
    return promise;
  }
  total++;
  if (phase !== 'start') emit();
  const own = stage;   // загрузка первого вида, закончившаяся после него, в счёт «остального» не идёт
  const fin = () => { if (own !== stage || phase === 'done') return; loaded++; emit(); checkDone(); };
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

export function afterRoom(fn) { return whenRoom.then(fn); }
export const isRoomReady = () => phase !== 'start';

export function roomReady() {
  if (phase !== 'start') return;
  phase = 'room'; emit();
  phase = 'details'; loaded = total = 0; stage = 1;
  resolveRoom();
  queueMicrotask(() => { emit(); checkDone(); });
}

queueMicrotask(emit);   // phase 'start', 0 / 0 — модули начали грузиться

// Комнаты, видные с первого ракурса (холл, кухня-гостиная, шахта и балкон за стеклом): их обстановка грузится до
// первого кадра, остальных (спальня, кабинет, ванная) — после него.
export const FIRST_ROOMS = new Set(['kitchen_living', 'hall', 'shaft', 'balcony']);
let firstView = () => true;
export function setFirstView(fn) { firstView = fn; }
export const inFirstView = (x, y, z, r) => firstView(x, y, z, r);
