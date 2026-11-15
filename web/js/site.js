// Настоящее солнце Варшавы и окружение дома (spec/site.json, его пишет tools/fetch_site.py).
//
//   sunFor('2026-11-15', 14, site)  -> { az, el, azAbs, ... }  az в соглашении приложения:
//                                      0 = прямо из окна, + = вправо, если смотреть наружу
//   sunTimes('2026-11-15', site)    -> { sunrise, noon, sunset }  местные часы (дробные)
//   formatSun('2026-11-15', 14, site) -> «Варшава, 15 ноября, 14:00 · солнце 18° над горизонтом»
//   seasonFor('2026-11-15')         -> { leaf, turn, young }  листва 0..1, пожелтение 0..1, весенняя зелень 0..1
//   buildContext(site, THREE, { date }) -> THREE.Group окружения:
//     земля и площадки (текстуры web/textures/site/, сезонная трава, поле с бороздами и всходами), дороги
//     с разметкой, тротуары, бордюры; свой дом; соседи с окнами по этажам, крышами, балконами (в радиусе
//     деталей); заборы, фонари, машины (web/models/site/cars.glb); деревья и кусты экземплярами по видам.
//     group.setSeason(dateISO) -> true, если вид поменялся (листва, трава, поле): нужен новый кадр.
//     group.ready -> Promise: текстуры и машины загружены.
//   Вечером (тёмное небо панорамы у горизонта) сами зажигаются окна соседей и фонари; дальнее тонет в дымке
//   цвета этого же неба. Мелочь (деревья, машины, решётки) не попадает в кубы зондов переотражений lighting.js.
//
// Оси квартиры: X вдоль окон, Z от окон вглубь, Y вверх, метры; пол квартиры y = 0, земля y = −floorY.
// three не импортируется статически: THREE передаётся аргументом (модуль проверяется в node);
// загрузчик GLB машин подгружается динамически и только в браузере.

const RAD = Math.PI / 180;
const WARSAW = { lat: 52.2002, lon: 20.9392, windowBearingDeg: 180, city: 'Варшава' };
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
  'сентября', 'октября', 'ноября', 'декабря'];

// ---------- время: Europe/Warsaw, летнее время ЕС ----------

// Последнее воскресенье месяца (month 1..12) -> число месяца
function lastSunday(y, month) {
  const d = new Date(Date.UTC(y, month, 0));
  return d.getUTCDate() - d.getUTCDay();
}

// Летнее время (CEST, UTC+2): с последнего воскресенья марта 01:00 UTC до последнего воскресенья октября 01:00 UTC
function isCEST(utcMs) {
  const y = new Date(utcMs).getUTCFullYear();
  return utcMs >= Date.UTC(y, 2, lastSunday(y, 3), 1) && utcMs < Date.UTC(y, 9, lastSunday(y, 10), 1);
}

// Местное время Варшавы ('2026-11-15', 14.5) -> миллисекунды UTC и пояс
export function warsawToUTC(dateISO, hours) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d) + hours * 3600e3;
  const summer = base - 2 * 3600e3;
  if (isCEST(summer)) return { utcMs: summer, tz: 'CEST', offset: 2 };
  return { utcMs: base - 3600e3, tz: 'CET', offset: 1 };
}

// ---------- положение солнца: алгоритм NOAA (точность ~0.01° в 1800–2100 гг.) ----------

export function solarPosition(utcMs, lat, lon) {
  const jd = utcMs / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const yv = Math.tan(eps * RAD / 2) ** 2;
  const eqTime = 4 / RAD * (yv * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
    + 4 * e * yv * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * yv * yv * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));   // минуты
  const minUTC = ((utcMs / 60000) % 1440 + 1440) % 1440;
  const tst = ((minUTC + eqTime + 4 * lon) % 1440 + 1440) % 1440;
  const ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZ = Math.min(1, Math.max(-1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha)));
  const elTrue = 90 - Math.acos(cosZ) / RAD;
  const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180 + 360) % 360;
  // Атмосферная рефракция (NOAA): солнце у горизонта видно чуть выше геометрического
  let r = 0;
  const t = Math.tan(elTrue * RAD);
  if (elTrue > 85) r = 0;
  else if (elTrue > 5) r = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  else if (elTrue > -0.575) r = 1735 + elTrue * (-518.2 + elTrue * (103.4 + elTrue * (-12.79 + elTrue * 0.711)));
  else r = -20.772 / t;
  return { az, el: elTrue + r / 3600, elTrue, decl: decl / RAD, eqTime };
}

const wrap180 = a => ((a + 180) % 360 + 360) % 360 - 180;

// Солнце для местных даты и часа. az/el — в соглашении приложения (ползунки sunAz/sunEl), azAbs — компас.
export function sunFor(dateISO, hours, site = WARSAW) {
  const lat = site.lat ?? WARSAW.lat, lon = site.lon ?? WARSAW.lon;
  const { utcMs, tz, offset } = warsawToUTC(dateISO, hours);
  const p = solarPosition(utcMs, lat, lon);
  const az = wrap180(p.az - (site.windowBearingDeg ?? WARSAW.windowBearingDeg));
  return {
    az, el: p.el, azAbs: p.az, elTrue: p.elTrue,
    up: p.el > 0,                       // над горизонтом
    inFront: p.el > 0 && Math.abs(az) < 90,   // светит в окна (а не с другой стороны дома)
    tz, offset, utc: new Date(utcMs).toISOString(),
  };
}

// Восход, полдень и закат (местные часы; null, если солнце не встаёт/не заходит)
export function sunTimes(dateISO, site = WARSAW) {
  const lat = site.lat ?? WARSAW.lat, lon = site.lon ?? WARSAW.lon;
  const el = h => solarPosition(warsawToUTC(dateISO, h).utcMs, lat, lon).elTrue + 0.833;   // верхний край диска
  let noon = 12, best = -1e9;
  for (let h = 9; h <= 15; h += 0.25) { const v = el(h); if (v > best) { best = v; noon = h; } }
  for (let s = 0.125; s > 1e-4; s /= 2) {   // уточнение максимума
    if (el(noon + s) > el(noon)) noon += s; else if (el(noon - s) > el(noon)) noon -= s;
  }
  const cross = (a, b) => {
    if (el(a) * el(b) > 0) return null;
    for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (el(a) * el(m) <= 0) b = m; else a = m; }
    return (a + b) / 2;
  };
  return { sunrise: cross(0, noon), noon, sunset: cross(noon, 24) };
}

const hhmm = h => {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// Подпись для панели: «Варшава, 15 ноября, 14:00 · солнце 18° над горизонтом»
export function formatSun(dateISO, hours, site = WARSAW, sun = sunFor(dateISO, hours, site)) {
  const [, m, d] = dateISO.split('-').map(Number);
  const head = `${site.city ?? WARSAW.city}, ${d} ${MONTHS[m - 1]}, ${hhmm(hours)}`;
  const el = Math.round(sun.el);
  if (sun.el <= 0) return `${head} · солнце за горизонтом`;
  return `${head} · солнце ${el}° над горизонтом${sun.inFront ? '' : ', с другой стороны дома'}`;
}

// ---------- сезон ----------

const clamp01 = v => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

function dayOfYear(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5 + 1;
}

// Листва на дату (Варшава): leaf — доля листьев 0..1, turn — пожелтение 0..1, young — свежая весенняя зелень.
// Распускаются 18 апреля — 18 мая, желтеют 19 сентября — 23 октября, опадают 15 октября — 18 ноября.
// shift — сдвиг в днях (у каждого дерева свой, чтобы осенью они менялись не разом).
export function seasonFor(dateISO, shift = 0) {
  const d = dayOfYear(dateISO) + shift;
  const ramp = (a, b) => clamp01((d - a) / (b - a));
  return { leaf: ramp(108, 138) * (1 - ramp(288, 322)), turn: ramp(262, 296), young: 1 - ramp(128, 165) };
}

// Ключевые кадры по дню года: трава (насыщенность, тон RGB) и поле (всходы crop, спелость gold, борозды furrow).
// Поле к югу — озимые: пашня в сентябре, редкие всходы с октября, зелень весной, золото в июле, стерня в августе.
const GRASS_KEYS = [[0, 0.45, 0.78, 0.76, 0.62], [70, 0.45, 0.8, 0.78, 0.62], [110, 1.1, 0.95, 1.05, 0.82],
  [165, 1.0, 1.0, 1.0, 0.88], [225, 0.85, 1.06, 0.98, 0.74], [285, 0.8, 0.95, 0.93, 0.74], [330, 0.55, 0.76, 0.76, 0.6],
  [367, 0.45, 0.78, 0.76, 0.62]];
const FIELD_KEYS = [[0, 0.18, 0, 0.3], [85, 0.25, 0, 0.2], [125, 0.95, 0, 0], [175, 1, 0.35, 0], [198, 1, 1, 0],
  [212, 0.7, 1, 0], [245, 0.35, 0.8, 0.2], [262, 0, 0, 1], [295, 0.06, 0, 0.8], [367, 0.18, 0, 0.3]];
function keyed(keys, d) {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= d) i++;
  const a = keys[i], b = keys[i + 1], t = clamp01((d - a[0]) / (b[0] - a[0]));
  return a.slice(1).map((v, k) => lerp(v, b[k + 1], t));
}

// ---------- окружение: константы ----------

const TEX_DIR = 'textures/site/', CARS_URL = 'models/site/cars.glb';
const TEX_M = { grass: 3, meadow: 3, soil: 4, asphalt: 4, paving: 2, bark: 1.5 };   // метров на повтор (SOURCE.md)
const TEX_SCATTER = new Set(['grass', 'meadow', 'soil']);   // без рисунка: повтор можно сбивать поворотом
const HAZE_M = 3300;        // дымка: на этом расстоянии воздух берёт 1 − 1/e (видимость ~10 км)
const GROUND_R = 2900;      // земля до дальней плоскости камеры (camera.far 3000)
const DETAIL_R = 150;       // по умолчанию, если в site.json нет detailRadius
const PARAPET = 0.6;
const RAIL_H = 1.1;

// Фасады: плитки атласа 4×4 (жилые — палитры польских новостроек; glass — офис; panel — сэндвич-панели залов).
// up — плитка этажей, gr — партера, bay — шаг окон, м. Плитка = один шаг окон × один этаж.
const STYLES = {
  white: { up: 0, gr: 1, bay: 2.7 }, grey: { up: 2, gr: 3, bay: 2.7 }, sand: { up: 4, gr: 5, bay: 2.6 },
  brick: { up: 6, gr: 7, bay: 2.7 }, panel: { up: 8, gr: 8, bay: 6 }, glass: { up: 10, gr: 11, bay: 3 },
  house: { up: 12, gr: 13, bay: 3.2 }, plain: { up: 14, gr: 14, bay: 4 },
};
const SHOPS = new Set(['retail', 'supermarket', 'commercial']);   // партер — витрина (плитка 9)
const RESIDENTIAL = new Set(['white', 'grey', 'sand', 'brick']);
const OWN_STYLE = 'white';

// Площадки: текстура, порядок слоёв (больше — выше), тон sRGB, «сезонная трава»
const AREA = {
  field: { tex: 'soil', k: 1, tint: 0xffffff },
  meadow: { tex: 'meadow', k: 2, tint: 0xccd2b0, season: true },
  grass: { tex: 'grass', k: 3, tint: 0xffffff, season: true },
  garden: { tex: 'grass', k: 3, tint: 0xe0e8c8, season: true },
  wood: { tex: 'meadow', k: 4, tint: 0x9a9070, season: true },
  scrub: { tex: 'meadow', k: 4, tint: 0xc8bc98, season: true },
  dirt: { tex: 'soil', k: 5, tint: 0xd8c8b0 },
  pitch: { tex: 'grass', k: 6, tint: 0x9ec08a },
  paved: { tex: 'paving', k: 7, tint: 0xffffff },
  parking: { tex: 'asphalt', k: 7, tint: 0xd8d8d8 },
  playground: { tex: 'soil', k: 8, tint: 0xd06a4a },
};
const ROAD_K = 9, PATH_K = 10, BLOB_K = 11;
const FOOT = new Set(['footway', 'cycleway', 'path', 'pedestrian']);
const MARKED = { primary: 2, primary_link: 1, secondary: 2, secondary_link: 1, tertiary: 1, tertiary_link: 1, trunk: 2 };

// Деревья: размеры в долях высоты. crown — полуоси кроны [гориз., верт.] и высота центра; trunk — где начинается крона;
// excurrent — ствол идёт до макушки (берёза, тополь, сосна); a1 — наклон скелетных ветвей от вертикали, °.
const TREES = {
  linden: { trunk: 0.3, crown: [0.33, 0.37, 0.6], n1: 7, a1: [30, 58], n2: 4, n3: 3, r0: 0.026, card: 0.15, cards: 3,
    bark: 0x6f665d, green: 0x4f7a2c, autumn: [0xcaa53a, 0xd5b544, 0xb99434], leaf: 'broad' },
  maple: { trunk: 0.26, crown: [0.4, 0.36, 0.58], n1: 6, a1: [38, 66], n2: 4, n3: 3, r0: 0.03, card: 0.16, cards: 3,
    bark: 0x5f5952, green: 0x47702a, autumn: [0xdc862e, 0xc94c2a, 0xd9b43c, 0xe39c32], leaf: 'broad' },
  birch: { excurrent: true, trunk: 0.22, crown: [0.22, 0.42, 0.58], n1: 11, a1: [42, 70], n2: 3, n3: 3, r0: 0.018,
    card: 0.11, cards: 3, droop: 0.35, bark: 0xd9d5cb, green: 0x5d8a36, autumn: [0xe3bf3e, 0xdab43a], leaf: 'broad' },
  poplar: { excurrent: true, trunk: 0.12, crown: [0.13, 0.46, 0.54], n1: 14, a1: [10, 24], n2: 3, n3: 2, r0: 0.02,
    card: 0.09, cards: 3, bark: 0x6a6660, green: 0x4a7230, autumn: [0xb99c3c, 0xc4a640], leaf: 'broad' },
  pine: { excurrent: true, trunk: 0.6, crown: [0.24, 0.2, 0.8], n1: 9, a1: [60, 95], n2: 3, n3: 2, r0: 0.022,
    card: 0.12, cards: 4, bark: 0x8a5f43, green: 0x34502c, evergreen: true, leaf: 'needle' },
  shrub: { stems: 6, lowpoly: true, trunk: 0, crown: [0.62, 0.48, 0.52], a1: [12, 40], n2: 3, n3: 0, r0: 0.03, card: 0.32, cards: 4,
    bark: 0x5d5148, green: 0x52782f, autumn: [0x8a6a3a, 0x9c7a3c, 0x7c6234], leaf: 'broad' },
};

// ---------- мелочи ----------

function rng(seed) {   // mulberry32: одна и та же раскладка при каждой загрузке
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

// Накопитель треугольников: позиции, нормали, uv и любые свои атрибуты (значение задаётся set() до вершин)
class Geo {
  constructor(extra = {}) {
    this.size = { position: 3, normal: 3, uv: 2, ...extra };
    this.a = Object.fromEntries(Object.keys(this.size).map(k => [k, []]));
    this.cur = {};
  }
  set(k, v) { this.cur[k] = v; return this; }
  vert(p, n, uv) {
    const a = this.a;
    a.position.push(p[0], p[1], p[2]); a.normal.push(n[0], n[1], n[2]); a.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
    for (const k in this.size) if (k !== 'position' && k !== 'normal' && k !== 'uv') a[k].push(...this.cur[k]);
  }
  tri(p, q, r, n, u, v, w) { this.vert(p, n, u); this.vert(q, n, v); this.vert(r, n, w); }
  // четырёхугольник p0 p1 p2 p3 против часовой при взгляде со стороны нормали
  quad(p0, p1, p2, p3, n, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    this.tri(p0, p1, p2, n, uv[0], uv[1], uv[2]); this.tri(p0, p2, p3, n, uv[0], uv[2], uv[3]);
  }
  get empty() { return !this.a.position.length; }
  geometry(THREE) {
    const g = new THREE.BufferGeometry();
    for (const [k, n] of Object.entries(this.size)) g.setAttribute(k, new THREE.Float32BufferAttribute(this.a[k], n));
    g.computeBoundingSphere();
    return g;
  }
}

function meshOf(THREE, geo, material, name, { cast = false, receive = true } = {}) {
  if (!geo || geo.empty) return null;
  const m = new THREE.Mesh(geo.geometry(THREE), material);
  m.name = name; m.castShadow = cast; m.receiveShadow = receive;
  m.userData.context = true;
  return m;
}

// Горизонтальный многоугольник на высоте y, лицом вверх (up) или вниз; uv = метры
function cap(THREE, g, poly, y, up) {
  const pts = poly.map(([x, z]) => new THREE.Vector2(x, z));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) {
    let A = poly[i], B = poly[j], C = poly[k];
    const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
    if ((ny > 0) !== up) [B, C] = [C, B];
    const v = p => [p[0], y, p[1]];
    g.tri(v(A), v(B), v(C), [0, up ? 1 : -1, 0], A, B, C);
  }
}

// Стены призмы наружу: u — метры вдоль фасада / шаг окон, v — номер этажа от vBase
function walls(g, poly, y0, y1, bay, storey, vBase) {
  const s = Math.sign(signedArea(poly)) || 1;
  let run = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
    if (L < 1e-3) continue;
    const n = [s * dz / L, 0, -s * dx / L];
    const u0 = run / bay, u1 = (run + L) / bay; run += L;
    const v0 = (y0 - vBase) / storey, v1 = (y1 - vBase) / storey;
    const P0 = [p[0], y0, p[1]], P1 = [q[0], y0, q[1]], P2 = [q[0], y1, q[1]], P3 = [p[0], y1, p[1]];
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    if (s > 0) g.quad(P0, P3, P2, P1, n, [uv[0], uv[3], uv[2], uv[1]]); else g.quad(P0, P1, P2, P3, n, uv);
  }
}

// Миттер-смещение ломаной на d (влево по ходу при d > 0); длина уса ограничена
function offsetLine(line, d) {
  const n = line.length, nor = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = line[i + 1][0] - line[i][0], dz = line[i + 1][1] - line[i][1], L = Math.hypot(dx, dz) || 1;
    nor.push([-dz / L, dx / L]);
  }
  return line.map((p, i) => {
    const a = nor[Math.max(0, i - 1)], c = nor[Math.min(n - 2, i)];
    let mx = a[0] + c[0], mz = a[1] + c[1];
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = d / Math.max(0.5, mx * c[0] + mz * c[1]);
    return [p[0] + mx * k, p[1] + mz * k];
  });
}

// Лента вдоль ломаной на высоте y: uv = (метры поперёк от оси, метры вдоль), лицом вверх
function ribbon(g, line, w, y) {
  if (line.length < 2) return;
  const L = offsetLine(line, w / 2), R = offsetLine(line, -w / 2);
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const ds = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
    const a = [L[i][0], y, L[i][1]], b = [R[i][0], y, R[i][1]], c = [R[i + 1][0], y, R[i + 1][1]], d = [L[i + 1][0], y, L[i + 1][1]];
    const uv = [[w / 2, s], [-w / 2, s], [-w / 2, s + ds], [w / 2, s + ds]];
    // порядок вершин — лицом вверх при любом направлении линии
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (ny > 0) g.quad(a, b, c, d, [0, 1, 0], uv); else g.quad(a, d, c, b, [0, 1, 0], [uv[0], uv[3], uv[2], uv[1]]);
    s += ds;
  }
}

// Вертикальная стенка вдоль ломаной от y0 до y1 (двусторонний материал), u — метры вдоль / step
function fenceWall(g, line, y0, y1, step) {
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const p = line[i], q = line[i + 1], ds = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (ds < 1e-3) continue;
    const n = [-(q[1] - p[1]) / ds, 0, (q[0] - p[0]) / ds];
    g.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], n,
      [[s / step, 0], [(s + ds) / step, 0], [(s + ds) / step, 1], [s / step, 1]]);
    s += ds;
  }
}

// Брусок вдоль отрезка: ширина w, от y0 до y1 (верх и две боковины; торцы не нужны)
function bar(g, p, q, w, y0, y1) {
  const ds = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (ds < 1e-3) return;
  const nx = -(q[1] - p[1]) / ds * w / 2, nz = (q[0] - p[0]) / ds * w / 2;
  const P = (o, s, y) => [o[0] + nx * s, y, o[1] + nz * s];
  g.quad(P(p, -1, y1), P(p, 1, y1), P(q, 1, y1), P(q, -1, y1), [0, 1, 0]);
  g.quad(P(p, 1, y0), P(q, 1, y0), P(q, 1, y1), P(p, 1, y1), [nx / (w / 2), 0, nz / (w / 2)]);
  g.quad(P(q, -1, y0), P(p, -1, y0), P(p, -1, y1), P(q, -1, y1), [-nx / (w / 2), 0, -nz / (w / 2)]);
}

// Коробка по центру c (x, y низа, z), размеры sx, sy, sz, поворот ry вокруг Y
function box(g, c, sx, sy, sz, ry = 0) {
  const cs = Math.cos(ry), sn = Math.sin(ry);
  const T = (x, y, z) => [c[0] + x * cs + z * sn, c[1] + y, c[2] - x * sn + z * cs];
  const R = (x, y, z) => [x * cs + z * sn, y, -x * sn + z * cs];
  const X = sx / 2, Z = sz / 2;
  g.quad(T(-X, sy, Z), T(X, sy, Z), T(X, sy, -Z), T(-X, sy, -Z), [0, 1, 0]);
  g.quad(T(-X, 0, -Z), T(X, 0, -Z), T(X, 0, Z), T(-X, 0, Z), [0, -1, 0]);
  g.quad(T(-X, 0, Z), T(X, 0, Z), T(X, sy, Z), T(-X, sy, Z), R(0, 0, 1));
  g.quad(T(X, 0, -Z), T(-X, 0, -Z), T(-X, sy, -Z), T(X, sy, -Z), R(0, 0, -1));
  g.quad(T(X, 0, Z), T(X, 0, -Z), T(X, sy, -Z), T(X, sy, Z), R(1, 0, 0));
  g.quad(T(-X, 0, -Z), T(-X, 0, Z), T(-X, sy, Z), T(-X, sy, -Z), R(-1, 0, 0));
}

// ---------- текстуры, нарисованные кодом ----------

// Холст цвета + холст маски -> DataTexture RGBA (альфа без тёмной каймы на мипах, в отличие от прозрачного canvas)
function packTexture(THREE, color, mask, { repeat = false } = {}) {
  const w = color.width, h = color.height;
  const c = color.getContext('2d').getImageData(0, 0, w, h).data;
  const m = mask ? mask.getContext('2d').getImageData(0, 0, w, h).data : null;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4, dst = y * w * 4;   // строка 0 холста — верх (v = 1)
    for (let x = 0; x < w * 4; x += 4) {
      out[dst + x] = c[src + x]; out[dst + x + 1] = c[src + x + 1]; out[dst + x + 2] = c[src + x + 2];
      out[dst + x + 3] = m ? m[src + x] : 255;
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function canvas(w, h = w) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return c;
}

// Атлас фасадов 4×4 плитки по 256 px: цвет + маска стекла (альфа). Плитка: шаг окон по ширине, этаж по высоте.
function facadeAtlas(THREE) {
  const T = 256, col = canvas(T * 4), msk = canvas(T * 4);
  const C = col.getContext('2d'), K = msk.getContext('2d');
  K.fillStyle = '#000'; K.fillRect(0, 0, T * 4, T * 4);
  const R = rng(7);
  const tile = (i, bay, storey, draw) => {
    const x0 = (i % 4) * T, y0 = Math.floor(i / 4) * T;
    const sx = T / bay, sy = T / storey;
    // прямоугольник в метрах от левого нижнего угла плитки
    const rect = (ctx, x, y, w, h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x0 + x * sx, y0 + T - (y + h) * sy, w * sx, h * sy); };
    C.save(); C.beginPath(); C.rect(x0, y0, T, T); C.clip();
    draw({ wall: (fill, noise = 10) => {
      rect(C, 0, 0, bay, storey, fill);
      for (let k = 0; k < 900; k++) {   // штукатурка неровная
        const v = (R() - 0.5) * noise;
        C.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v) / 100})`;
        C.fillRect(x0 + R() * T, y0 + R() * T, 2 + R() * 6, 2 + R() * 6);
      }
    }, rect: (x, y, w, h, fill) => rect(C, x, y, w, h, fill),
    glass: (x, y, w, h, tint = '#3e4a56', frame = '#3a3d41', fw = 0.06, split = true) => {
      rect(C, x - fw, y - fw, w + 2 * fw, h + 2 * fw, frame);
      const g = C.createLinearGradient(0, y0 + T - (y + h) * sy, 0, y0 + T - y * sy);
      g.addColorStop(0, '#8d9aa6'); g.addColorStop(0.45, tint); g.addColorStop(1, '#2a3038');
      C.fillStyle = g; C.fillRect(x0 + x * sx, y0 + T - (y + h) * sy, w * sx, h * sy);
      rect(K, x, y, w, h, '#fff');
      if (split) { rect(C, x + w / 2 - fw / 2, y, fw, h, frame); rect(K, x + w / 2 - fw / 2, y, fw, h, '#000'); }
    }, mask: (x, y, w, h) => rect(K, x, y, w, h, '#fff') });
    C.restore();
  };
  const sill = (t, x, y, w, c = '#d9d8d2') => { t.rect(x - 0.05, y - 0.06, w + 0.1, 0.06, c); t.rect(x - 0.05, y - 0.14, w + 0.1, 0.08, 'rgba(0,0,0,0.12)'); };
  const slab = (t, bay, c = 'rgba(0,0,0,0.07)') => t.rect(0, 0, bay, 0.05, c);
  // жилые: белая, серая с графитом, песочная, кирпич (верх и партер)
  const res = (i, wall, frame, opts = {}) => {
    const bay = 2.7, st = 3;
    tile(i, bay, st, t => {
      t.wall(wall); slab(t, bay);
      if (opts.french) {   // французский балкон: окно до пола, стеклянная балюстрада
        t.glass(0.65, 0.12, 1.4, 2.25, '#3b4754', frame);
        t.rect(0.6, 0.95, 1.5, 0.05, frame);
        t.rect(0.65, 0.12, 1.4, 0.83, 'rgba(160,175,180,0.35)');
      } else {
        t.glass(0.7, 0.9, 1.3, 1.45, '#3e4a56', frame); sill(t, 0.7, 0.9, 1.3);
      }
      if (opts.pilaster) t.rect(2.3, 0, 0.4, st, opts.pilaster);
    });
    tile(i + 1, bay, st, t => {
      t.wall(wall);
      t.rect(0, 0, bay, 0.55, opts.plinth ?? '#5a5d61');
      t.glass(0.7, 0.9, 1.3, 1.45, '#3e4a56', frame); sill(t, 0.7, 0.9, 1.3);
      if (opts.pilaster) t.rect(2.3, 0.55, 0.4, st, opts.pilaster);
    });
  };
  res(0, '#ecebe6', '#3a3d41');
  res(2, '#c9c8c3', '#2f3236', { french: true, pilaster: '#7a7d80' });
  res(4, '#dccfb6', '#f2f0ea', { plinth: '#8a7a64' });
  // кирпич (клинкер) с белыми окнами
  tile(6, 2.7, 3, t => {
    t.wall('#c2b8a8', 2);
    for (let r = 0; r < 40; r++) for (let k = -1; k < 14; k++) {
      const v = 0.85 + R() * 0.3, c = [154 * v, 78 * v, 54 * v].map(Math.round);
      t.rect(k * 0.25 + (r % 2) * 0.125, r * 0.075 + 0.01, 0.235, 0.062, `rgb(${c})`);
    }
    t.glass(0.7, 0.9, 1.3, 1.45, '#3e4a56', '#f0efe9'); sill(t, 0.7, 0.9, 1.3, '#9a9590');
  });
  tile(7, 2.7, 3, t => {
    t.wall('#ecebe6'); t.rect(0, 0, 2.7, 0.55, '#7b3f2d');
    t.glass(0.7, 0.9, 1.3, 1.45, '#3e4a56', '#3a3d41'); sill(t, 0.7, 0.9, 1.3);
  });
  // сэндвич-панели залов и витрина
  tile(8, 6, 3, t => {
    t.wall('#b7babc', 4);
    for (let y = 0; y < 3; y += 0.2) t.rect(0, y, 6, 0.03, 'rgba(0,0,0,0.13)');
    t.rect(5.97, 0, 0.03, 3, 'rgba(0,0,0,0.25)');
  });
  tile(9, 6, 3, t => {
    t.wall('#b7babc', 4);
    t.glass(0.25, 0.15, 5.5, 2.45, '#3c4955', '#4a4e52', 0.08, false);
    for (let x = 0.25; x < 5.8; x += 1.375) t.rect(x, 0.15, 0.06, 2.45, '#4a4e52');
    t.rect(0, 2.7, 6, 0.3, '#5b5f63');
  });
  // офис: навесная стена
  tile(10, 3, 3, t => {
    t.wall('#41464c', 2); t.rect(0, 0, 3, 0.85, '#565c63');
    t.glass(0.05, 0.9, 2.9, 2.05, '#46607a', '#2c3136', 0.05, true);
  });
  tile(11, 3, 3, t => {
    t.wall('#41464c', 2); t.glass(0.05, 0.1, 2.9, 2.85, '#3f5468', '#2c3136', 0.05, true);
  });
  // частный дом: светлая штукатурка, окно меньше, короб рольставни
  tile(12, 3.2, 3, t => {
    t.wall('#e7e1d2'); t.rect(0.95, 2.28, 1.3, 0.18, '#d5d0c6');
    t.glass(0.95, 0.95, 1.3, 1.3, '#3d4650', '#f1efe9'); sill(t, 0.95, 0.95, 1.3, '#bdb6aa');
  });
  tile(13, 3.2, 3, t => {
    t.wall('#e7e1d2'); t.rect(0, 0, 3.2, 0.45, '#8d8478'); t.rect(0.95, 2.28, 1.3, 0.18, '#d5d0c6');
    t.glass(0.95, 0.95, 1.3, 1.3, '#3d4650', '#f1efe9'); sill(t, 0.95, 0.95, 1.3, '#bdb6aa');
  });
  // глухая стена: гаражи, подстанции, сараи
  tile(14, 4, 3, t => { t.wall('#b4ada1', 16); t.rect(0, 0, 4, 0.3, 'rgba(0,0,0,0.12)'); });
  tile(15, 4, 3, t => t.wall('#ecebe6'));
  return packTexture(THREE, col, msk);
}

// Кисть листвы 512 px, 2×2 варианта: серые листья (цвет даёт экземпляр), альфа — силуэт пучка
function foliageTexture(THREE, kind) {
  const S = 512, col = canvas(S), msk = canvas(S);
  const C = col.getContext('2d'), K = msk.getContext('2d');
  const R = rng(kind === 'needle' ? 11 : kind === 'twig' ? 13 : 17);
  C.fillStyle = kind === 'twig' ? '#5a5048' : '#b4b4b4'; C.fillRect(0, 0, S, S);
  K.fillStyle = '#000'; K.fillRect(0, 0, S, S);
  for (let q = 0; q < 4; q++) {
    const cx = (q % 2) * 256 + 128, cy = Math.floor(q / 2) * 256 + 128;
    if (kind === 'twig') {   // голые ветки: ветвящиеся штрихи
      const branch = (x, y, a, len, w, depth) => {
        const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
        for (const [ctx, c] of [[C, `rgb(${70 + R() * 30},${62 + R() * 24},${55 + R() * 20})`], [K, '#fff']]) {
          ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
        }
        if (depth > 0) for (let k = 0; k < 3; k++) branch(x2, y2, a + (R() - 0.5) * 1.3, len * (0.55 + R() * 0.2), w * 0.65, depth - 1);
      };
      for (let k = 0; k < 4; k++) branch(cx + (R() - 0.5) * 30, cy + 70 + R() * 30, -Math.PI / 2 + (R() - 0.5) * 1.6, 45 + R() * 20, 3, 4);
      continue;
    }
    const n = kind === 'needle' ? 70 : 520;
    for (let i = 0; i < n; i++) {
      // плотность к центру пучка, края рваные
      const r = 118 * Math.sqrt(R()) * (0.75 + 0.25 * R()), a = R() * Math.PI * 2;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.9;
      const shade = 120 + Math.round(R() * 135 * (1 - 0.35 * r / 118));
      if (kind === 'needle') {   // пучок хвои: веер тонких штрихов от веточки
        const da = R() * Math.PI * 2;
        for (let k = 0; k < 14; k++) {
          const b = da + (k - 7) * 0.12, L = 16 + R() * 10;
          for (const [ctx, c] of [[C, `rgb(${shade},${shade},${shade})`], [K, '#fff']]) {
            ctx.strokeStyle = c; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(b) * L, y + Math.sin(b) * L); ctx.stroke();
          }
        }
        continue;
      }
      const L = 9 + R() * 8, W = L * (0.45 + R() * 0.2), rot = R() * Math.PI;
      for (const [ctx, c] of [[C, `rgb(${shade},${shade},${Math.round(shade * 0.96)})`], [K, '#fff']]) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, L / 2, W / 2, rot, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  const t = packTexture(THREE, col, msk);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Решётка: вертикальные прутья и поручень (балконы) или панель сетки (заборы)
function grilleTexture(THREE, kind) {
  const W = 256, H = 128, col = canvas(W, H), msk = canvas(W, H);
  const C = col.getContext('2d'), K = msk.getContext('2d');
  C.fillStyle = '#34373b'; C.fillRect(0, 0, W, H);
  K.fillStyle = '#000'; K.fillRect(0, 0, W, H);
  K.fillStyle = '#fff';
  if (kind === 'rail') {   // 1 повтор = 1 м × высота перил: прутья через 11 см, поручень, низ
    for (let x = 0; x < W; x += W / 9) K.fillRect(x, 0, 5, H);
    K.fillRect(0, 0, W, 10); K.fillRect(0, H - 8, W, 8);
  } else {                 // панель ограждения 2.5 м: прутья 20 × 5 см, двойная горизонталь
    for (let x = 0; x < W; x += W / 50) K.fillRect(x, 0, 2, H);
    for (let y = 4; y < H; y += 26) K.fillRect(0, y, W, 2);
    K.fillRect(0, 50, W, 5); K.fillRect(0, 0, 6, H); K.fillRect(W - 6, 0, 6, H);
  }
  const t = packTexture(THREE, col, msk, { repeat: true });
  return t;
}

// Мягкая тень-пятно под кроной
function blobTexture(THREE) {
  const S = 64, col = canvas(S), msk = canvas(S);
  col.getContext('2d').fillRect(0, 0, S, S);
  const K = msk.getContext('2d'), g = K.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#999'); g.addColorStop(1, '#000');
  K.fillStyle = g; K.fillRect(0, 0, S, S);
  return packTexture(THREE, col, msk);
}

// ---------- шейдеры: дымка, ночь, сезон ----------

// Общие для всех материалов окружения: цвет и плотность дымки (из неба панорамы), «ночь» 0..1
function sharedUniforms(THREE) {
  return {
    uHaze: { value: new THREE.Color(0.6, 0.65, 0.7) }, uHazeK: { value: 1 / HAZE_M }, uNight: { value: 0 },
  };
}

// Патч материала: свой код в вершинный и фрагментный шейдер + дымка перед тонмаппингом.
// key — уникален для каждого варианта кода (three кэширует программы по customProgramCacheKey).
function outdoor(mat, key, shared, { uniforms = {}, vPars = '', vMain = '', vAfter = [], fPars = '', fRep = [] } = {}) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, shared, uniforms);
    let v = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vOdWorld;\n${vPars}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
	vec4 odP = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		odP = instanceMatrix * odP;
	#endif
	vOdWorld = ( modelMatrix * odP ).xyz;
	${vMain}`);
    for (const [chunk, code] of vAfter) v = v.replace(chunk, `${chunk}\n${code}`);
    let f = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vOdWorld;
uniform vec3 uHaze; uniform float uHazeK; uniform float uNight;
float odHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
${fPars}`)
      .replace('#include <tonemapping_fragment>', `gl_FragColor.rgb = mix( gl_FragColor.rgb, uHaze, 1.0 - exp( - distance( vOdWorld, cameraPosition ) * uHazeK ) );
#include <tonemapping_fragment>`);
    for (const [chunk, code, mode] of fRep) {
      if (!f.includes(chunk)) { console.warn('site: в шейдере нет', chunk); continue; }
      f = f.replace(chunk, mode === 'replace' ? code : mode === 'before' ? `${code}\n${chunk}` : `${chunk}\n${code}`);
    }
    sh.vertexShader = v; sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => `outdoor-${key}`;
  return mat;
}

// Земля и площадки: крупные пятна поверх повтора (без «плитки»), сезонная насыщенность и тон
const TERRAIN_FRAG = `
#ifdef USE_MAP
	vec3 odAvg = textureLod( map, vec2( 0.5 ), 12.0 ).rgb;
	float odMean = max( odAvg.g, 0.02 );
	// дальше 30 м мелкий рисунок уходит в средний цвет текстуры: остаются макро-пятна, а не сетка повтора
	float odDist = distance( vOdWorld, cameraPosition ), odFar = 0.75 * smoothstep( 30.0, 150.0, odDist );
	float odM1 = texture2D( map, vOdWorld.xz * 0.0113 + 0.31 ).g / odMean;
	float odMacro = odM1 * texture2D( map, vOdWorld.zx * 0.0031 + 0.71 ).g / odMean;
	// второй отсчёт повёрнут и крупнее: пятнами по макро-шуму сбивает сетку повтора на траве, лугу и пашне
	vec2 odUv2 = mat2( 0.8, -0.6, 0.6, 0.8 ) * vMapUv * 0.71 + 0.37;
	vec4 odTex = mix( texture2D( map, vMapUv ), texture2D( map, odUv2 ), uScatter * smoothstep( 0.8, 1.2, odM1 ) );
	vec3 odC = mix( odTex.rgb, odAvg, odFar ) * mix( 1.0, clamp( odMacro, 0.4, 1.8 ), uMacro );
	odC = mix( vec3( dot( odC, vec3( 0.2126, 0.7152, 0.0722 ) ) ), odC, uSat ) * uTint;
	FIELD_CODE
	diffuseColor.rgb *= odC;
#endif`;
const FIELD_CODE = `
	vec2 odQ = vOdWorld.xz / 3.0;
	vec3 odCrop = mix( texture2D( uCropMap, odQ ).rgb, texture2D( uCropMap, mat2( 0.8, -0.6, 0.6, 0.8 ) * odQ * 0.71 + 0.37 ).rgb, smoothstep( 0.8, 1.2, odM1 ) );
	// у всходов повтор 3 м: в среднее уходят уже с 8 м, иначе золото и зелень поля ложатся клеткой
	odCrop = mix( odCrop, textureLod( uCropMap, vec2( 0.5 ), 12.0 ).rgb, 0.85 * smoothstep( 8.0, 60.0, odDist ) );
	float odL = dot( odCrop, vec3( 0.2126, 0.7152, 0.0722 ) );
	odCrop = mix( odCrop * vec3( 0.9, 1.0, 0.55 ), vec3( odL ) * vec3( 1.9, 1.5, 0.75 ), uGold );
	// борозды и рядки гаснут к 60 м и раньше предела Найквиста: синус под скользящим углом даёт муар клеткой
	float odF = dot( vOdWorld.xz, uFurrowDir ) / 0.75;
	float odFade = max( smoothstep( 0.08, 0.3, fwidth( odF ) ), smoothstep( 20.0, 60.0, odDist ) );
	float odS = mix( 0.5 + 0.5 * sin( odF * 6.2831 ), 0.5, odFade );
	odC *= mix( 1.0, 0.72 + 0.56 * odS, uFurrow );
	float odRows = mix( 0.55 + 0.45 * sin( odF * 6.2831 + 1.5 ), 0.75, odFade );
	odC = mix( odC, odCrop, clamp( uCrop * ( 0.6 + 0.6 * odMacro ) * mix( 1.0, odRows, 1.0 - uCrop * 0.6 ), 0.0, 1.0 ) );`;

// ---------- деревья ----------

// Одно дерево вида def высотой 1: ветки (трубки) и точки пучков листвы. Возвращает { wood: Geo, tips: [...] }
function growTree(THREE, def, seed) {
  const R = rng(seed), V = THREE.Vector3;
  const wood = new Geo();
  const tips = [];
  const [rx, ry, cy] = def.crown;
  const C = new V(0, cy, 0);
  // расстояние вдоль d от p до поверхности эллипсоида кроны (или 0, если p снаружи)
  const toCrown = (p, d) => {
    const ax = 1 / (rx * rx), ay = 1 / (ry * ry);
    const ox = p.x, oy = p.y - cy, oz = p.z;
    const A = (d.x * d.x + d.z * d.z) * ax + d.y * d.y * ay;
    const B = 2 * ((ox * d.x + oz * d.z) * ax + oy * d.y * ay);
    const Cc = (ox * ox + oz * oz) * ax + oy * oy * ay - 1;
    const disc = B * B - 4 * A * Cc;
    return disc < 0 ? 0 : Math.max(0, (-B + Math.sqrt(disc)) / (2 * A));
  };
  const RAD = def.lowpoly ? [5, 3, 3, 3] : [7, 5, 4, 3], SEG = def.lowpoly ? [3, 2, 1, 1] : [5, 3, 2, 1];
  const tube = (pts, r0, r1, radial) => {
    let ref = new V(1, 0, 0), len = 0;
    const rings = pts.map((p, i) => {
      const t = new V().subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
      if (Math.abs(ref.dot(t)) > 0.9) ref = new V(0, 0, 1);
      const nx = ref.clone().addScaledVector(t, -ref.dot(t)).normalize(), bx = new V().crossVectors(t, nx);
      if (i > 0) len += p.distanceTo(pts[i - 1]);
      const r = lerp(r0, r1, i / (pts.length - 1));
      return Array.from({ length: radial + 1 }, (_, j) => {
        const a = j / radial * Math.PI * 2, n = nx.clone().multiplyScalar(Math.cos(a)).addScaledVector(bx, Math.sin(a));
        return { p: p.clone().addScaledVector(n, r).toArray(), n: n.toArray(), uv: [j / radial, len * 6] };
      });
    });
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < radial; j++) {
      const a = rings[i][j], b = rings[i][j + 1], c = rings[i + 1][j + 1], d = rings[i + 1][j];
      wood.vert(a.p, a.n, a.uv); wood.vert(b.p, b.n, b.uv); wood.vert(c.p, c.n, c.uv);
      wood.vert(a.p, a.n, a.uv); wood.vert(c.p, c.n, c.uv); wood.vert(d.p, d.n, d.uv);
    }
  };
  const maxLevel = def.n3 ? 3 : 2;
  const branch = (p0, dir, len, rad, level, kids = true) => {
    const pts = [p0.clone()], d = dir.clone(), p = p0.clone();
    const n = SEG[level];
    for (let s = 0; s < n; s++) {
      d.x += (R() - 0.5) * 0.25; d.z += (R() - 0.5) * 0.25;
      d.y += level === 0 ? 0.3 : (def.droop && level >= 2 ? -def.droop * 0.5 : 0.08);
      d.normalize();
      p.addScaledVector(d, len / n); pts.push(p.clone());
    }
    tube(pts, rad, rad * (level === 0 ? 0.45 : 0.35), RAD[level]);
    const at = t => { const f = t * n, i = Math.min(n - 1, Math.floor(f)); return pts[i].clone().lerp(pts[i + 1], f - i); };
    if (level >= maxLevel || !kids) {
      for (let k = 0; k < def.cards; k++) tips.push(at(0.45 + 0.55 * (k + R()) / def.cards));
      return;
    }
    const count = level === 0 ? def.n1 : level === 1 ? def.n2 : def.n3;
    const t0 = level === 0 ? Math.min(0.92, def.trunk / len) : 0.3;
    for (let i = 0; i < count; i++) {
      const t = level === 0 && !def.excurrent ? lerp(t0, 1, 0.55 + 0.45 * R()) : lerp(t0, 0.97, (i + R()) / count);
      const base = at(t);
      const [a0, a1] = level === 0 ? def.a1 : [30, 60];
      const tilt = (a0 + (a1 - a0) * R()) * RAD_DEG;
      const az = i * 2.39996 + R() * 0.6;   // золотой угол
      // направление: от направления родителя наклоном tilt в сторону az
      const up = d.clone();
      const side = new V(Math.cos(az), 0, Math.sin(az)).addScaledVector(up, -up.dot(new V(Math.cos(az), 0, Math.sin(az)))).normalize();
      const cd = up.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt)).normalize();
      let cl = toCrown(base, cd);
      if (level > 0) cl = Math.min(cl * 1.05 + 0.02, len * (0.55 + 0.25 * R()));
      else cl *= 0.75 + 0.3 * R();
      if (cl < 0.015) continue;
      branch(base, cd, cl, rad * (level === 0 ? 0.42 * (1 - 0.5 * t) : 0.5), level + 1);
    }
  };
  if (def.stems) {   // куст: несколько стеблей от земли
    for (let i = 0; i < def.stems; i++) {
      const az = i * 2.39996 + R(), tilt = (def.a1[0] + (def.a1[1] - def.a1[0]) * R()) * RAD_DEG;
      const d = new V(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
      branch(new V(0, 0, 0), d, toCrown(new V(0, 0.01, 0), d) * (0.75 + 0.25 * R()), def.r0, 1);
    }
  } else {
    const top = def.excurrent ? cy + ry * 0.92 : def.trunk + 0.18;
    branch(new V(0, 0, 0), new V(0, 1, 0), top, def.r0, 0);
  }
  return { wood, tips, center: C };
}
const RAD_DEG = Math.PI / 180;

// Плоскости листвы в точках пучков: индексированная геометрия, у каждой плоскости своё случайное aRand
// (по нему сезон прореживает листву). Нормали «от центра кроны» — объёмная светотень вместо плоских карточек.
function cardGeometry(THREE, tree, def, scale, seed, fraction = 1) {
  const R = rng(seed);
  const pos = [], nrm = [], uv = [], rnd = [], idx = [];
  const V = THREE.Vector3;
  for (const tip of tree.tips) {
    if (R() > fraction) continue;
    const s = def.card * scale * (0.75 + 0.5 * R());
    const n = new V(R() - 0.5, (R() - 0.5) * 0.6, R() - 0.5).normalize();
    const t = new V().crossVectors(n, Math.abs(n.y) > 0.9 ? new V(1, 0, 0) : new V(0, 1, 0)).normalize();
    const b = new V().crossVectors(n, t);
    const rot = R() * Math.PI * 2, c = Math.cos(rot), sn = Math.sin(rot);
    const T = t.clone().multiplyScalar(c).addScaledVector(b, sn), B = b.clone().multiplyScalar(c).addScaledVector(t, -sn);
    const shade = tip.clone().sub(tree.center).multiply(new V(1, 0.7, 1)).normalize().addScaledVector(new V(0, 1, 0), 0.35).normalize();
    const q = Math.floor(R() * 4), u0 = (q % 2) * 0.5, v0 = Math.floor(q / 2) * 0.5, r = R();
    const base = pos.length / 3;
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = tip.clone().addScaledVector(T, i * s / 2).addScaledVector(B, j * s / 2);
      pos.push(p.x, p.y, p.z); nrm.push(shade.x, shade.y, shade.z);
      uv.push(u0 + (i + 1) * 0.25, v0 + (j + 1) * 0.25); rnd.push(r);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 1));
  g.setIndex(idx);
  g.userData.fullIndex = idx;
  return g;
}

// ---------- машины ----------

// cars.glb (tools/fetch_site.py --assets): меши sedan/hatchback/suv/van, цвет вершин из палитры Kenney.
// Кузов (самый частый насыщенный цвет) получает aPaint = 1 — его перекрашивает экземпляр; стёкла темнеют.
async function loadCars(THREE) {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')]);
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(CARS_URL);
  gltf.scene.updateMatrixWorld(true);
  const out = {};
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const src = o.geometry, n = src.attributes.position.count;
    const g = new THREE.BufferGeometry();
    const flat = (a, size) => {
      const f = new Float32Array(a.count * size);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) f[i * size + c] = a.getComponent(i, c);
      return new THREE.BufferAttribute(f, size);
    };
    g.setAttribute('position', flat(src.attributes.position, 3));
    g.setAttribute('normal', flat(src.attributes.normal, 3));
    const col = flat(src.attributes.color, 3);
    g.setIndex(src.index ? Array.from(src.index.array) : null);
    g.applyMatrix4(o.matrixWorld);
    // палитра записана в sRGB -> линейный цвет
    const toLin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    for (let i = 0; i < col.array.length; i++) col.array[i] = toLin(col.array[i]);
    const sat = i => { const r = col.array[i * 3], gg = col.array[i * 3 + 1], b = col.array[i * 3 + 2]; const mx = Math.max(r, gg, b); return mx > 0 ? (mx - Math.min(r, gg, b)) / mx : 0; };
    const key = i => col.array.slice(i * 3, i * 3 + 3).map(v => Math.round(v * 20)).join();
    const freq = new Map();
    for (let i = 0; i < n; i++) if (sat(i) > 0.35) freq.set(key(i), (freq.get(key(i)) ?? 0) + 1);
    const body = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const paint = new Float32Array(n), glass = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = col.array[i * 3], gg = col.array[i * 3 + 1], b = col.array[i * 3 + 2];
      if (key(i) === body) paint[i] = 1;
      else if (sat(i) < 0.35 && b > 0.35 && b >= r) { glass[i] = 1; col.array.set([0.012, 0.016, 0.022], i * 3); }
    }
    g.setAttribute('color', col);
    g.setAttribute('aPaint', new THREE.BufferAttribute(paint, 1));
    g.setAttribute('aGlass', new THREE.BufferAttribute(glass, 1));
    g.computeBoundingSphere();
    out[o.name] = g;
  });
  return out;
}

// ---------- сборка ----------

// Окружение одной группой. opts: { far: true } — дальние высокие дома (до 2 км, нужен camera.far ≥ 2500),
// date — исходная дата сезона (по умолчанию сегодня).
//   context.setSeason(dateISO) -> true, если вид поменялся (листва, трава, поле); перерисовать кадр
//   context.ready              -> Promise: текстуры и машины загружены (перерисовать и пересчитать свет)
//   group.userData.parts       -> меши по именам (для отладки)
export function buildContext(site, THREE, opts = {}) {
  const { far = true } = opts;
  const browser = typeof document !== 'undefined';
  const fy = site.floorY, ground = -fy;
  const detailR = site.detailRadius ?? DETAIL_R;
  const group = new THREE.Group(); group.name = 'context';
  const parts = {};
  const add = (key, mesh) => { if (mesh) { parts[key] = mesh; group.add(mesh); } return mesh; };
  const shared = sharedUniforms(THREE);
  const pending = [];

  // --- текстуры
  const texLoader = browser ? new THREE.TextureLoader() : null;
  const tex = {};
  for (const name of Object.keys(TEX_M)) {
    if (!texLoader) { tex[name] = null; continue; }
    const t = texLoader.load(`${TEX_DIR}${name}.jpg`);
    pending.push(new Promise(res => { t.image ? res() : (t.onUpdate = () => res()); }));
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    t.repeat.set(1 / TEX_M[name], 1 / TEX_M[name]);
    tex[name] = t;
  }
  const atlas = browser ? facadeAtlas(THREE) : null;

  const std = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
  const layer = k => ({ polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -2 * k });

  // --- земля и площадки
  const terrainMats = {};
  const terrain = (key, texName, tint, k, extra = {}) => {
    const u = { uMacro: { value: 0.55 }, uScatter: { value: TEX_SCATTER.has(texName) ? 1 : 0 }, uSat: { value: 1 },
      uTint: { value: new THREE.Color(1, 1, 1) }, ...extra.uniforms };
    const m = outdoor(std({ map: tex[texName], color: tint, ...(k ? layer(k) : {}) }), extra.field ? 'field' : 'terrain', shared, {
      uniforms: u,
      fPars: 'uniform float uMacro, uScatter, uSat; uniform vec3 uTint;' + (extra.field ? 'uniform sampler2D uCropMap; uniform float uCrop, uGold, uFurrow; uniform vec2 uFurrowDir;' : ''),
      fRep: [['#include <map_fragment>', TERRAIN_FRAG.replace('FIELD_CODE', extra.field ? FIELD_CODE : ''), 'replace']],
    });
    m.userData.u = u; m.userData.season = extra.season;
    terrainMats[key] = m;
    return m;
  };
  const gm = new THREE.CircleGeometry(GROUND_R, 128); gm.rotateX(-Math.PI / 2);
  { const p = gm.attributes.position, uv = gm.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i)); }
  const groundMesh = new THREE.Mesh(gm, terrain('ground', 'meadow', 0xc4c8a8, 0, { season: true }));
  groundMesh.position.y = ground; groundMesh.receiveShadow = true; groundMesh.name = 'ground';
  groundMesh.userData.context = true;
  add('ground', groundMesh);

  // направление борозд — вдоль длинной стороны самого большого поля
  const fieldPoly = (site.areas ?? []).filter(a => a.kind === 'field').sort((a, b) => Math.abs(signedArea(b.poly)) - Math.abs(signedArea(a.poly)))[0]?.poly;
  const furrow = new THREE.Vector2(1, 0);
  if (fieldPoly) {
    let best = 0;
    fieldPoly.forEach((p, i) => { const q = fieldPoly[(i + 1) % fieldPoly.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L > best) { best = L; furrow.set(-(q[1] - p[1]) / L, (q[0] - p[0]) / L); } });
  }
  const areaGeo = {};
  for (const a of site.areas ?? []) cap(THREE, areaGeo[a.kind] ??= new Geo(), a.poly, ground, true);
  for (const [kind, g] of Object.entries(areaGeo)) {
    const d = AREA[kind] ?? AREA.grass;
    const mat = terrain(kind, d.tex, d.tint, d.k, kind === 'field' ? {
      field: true, uniforms: { uCropMap: { value: tex.grass }, uCrop: { value: 0 }, uGold: { value: 0 }, uFurrow: { value: 1 }, uFurrowDir: { value: furrow } },
    } : { season: d.season });
    add(`area_${kind}`, meshOf(THREE, g, mat, `area_${kind}`));
  }

  // --- дороги (разметка в шейдере), тротуары и дорожки, бордюры
  const road = new Geo({ aRoad: 4 }), path = new Geo();
  for (const r of site.roads ?? []) {
    if (FOOT.has(r.kind)) { ribbon(path, r.line, r.w, ground); continue; }
    road.set('aRoad', [r.w / 2, MARKED[r.kind] ?? 0, 0, 0]);
    ribbon(road, r.line, r.w, ground);
  }
  const roadMat = outdoor(std({ map: tex.asphalt, color: 0xb8b8b8, roughness: 0.85, ...layer(ROAD_K) }), 'road', shared, {
    vPars: 'attribute vec4 aRoad; varying vec4 vRoad;', vMain: 'vRoad = vec4( uv, aRoad.xy );',
    fPars: 'varying vec4 vRoad;',
    fRep: [['#include <map_fragment>', `
	{
		float a = vRoad.x, s = vRoad.y, hw = vRoad.z, px = max( fwidth( a ), 1e-4 );
		float line = 1.0 - smoothstep( 0.06, 0.06 + px, abs( a ) );
		float dash = step( fract( s / 12.0 ), 0.34 );
		float m = vRoad.w > 0.5 ? line * dash : 0.0;
		if ( vRoad.w > 1.5 ) m = max( m, 1.0 - smoothstep( 0.06, 0.06 + px, abs( abs( a ) - hw + 0.4 ) ) );
		m *= clamp( 0.08 / px, 0.0, 1.0 );
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.8 ), m * 0.85 );
	}`]],
  });
  add('roads', meshOf(THREE, road, roadMat, 'roads'));
  add('paths', meshOf(THREE, path, outdoor(std({ map: tex.paving, color: 0xd6d6d2, ...layer(PATH_K) }), 'plain', shared), 'paths'));
  const kerb = new Geo();
  for (const line of site.kerbs ?? []) for (let i = 0; i < line.length - 1; i++) bar(kerb, line[i], line[i + 1], 0.16, ground, ground + 0.13);
  const concrete = outdoor(std({ color: 0xc9c6bf }), 'plain', shared);
  add('kerbs', meshOf(THREE, kerb, concrete, 'kerbs'));

  // --- свой дом: этажи под квартирой, соседние квартиры на нашем этаже, этажи над ней
  const facadeMat = outdoor(std({ map: atlas, color: 0xffffff }), 'facade', shared, {
    vPars: 'attribute vec4 aFac; varying vec4 vFac;', vMain: 'vFac = aFac;',
    fPars: 'varying vec4 vFac; uniform float uGlow;', uniforms: { uGlow: { value: 1.6 } },
    fRep: [
      ['#include <map_fragment>', `
	float odGlass = 0.0, odLit = 0.0;
#ifdef USE_MAP
	vec2 odUv = vMapUv;
	float odSt = floor( odUv.y );
	float odTile = odSt < 0.5 ? vFac.y : vFac.x;
	vec2 odLoc = fract( odUv );
	if ( odUv.y < 0.0 || odSt >= vFac.z ) odLoc.x = 0.03;   // цоколь и парапет — без окон
	vec2 odCell = vec2( mod( odTile, 4.0 ), 3.0 - floor( odTile / 4.0 ) );
	vec4 odTex = textureGrad( map, ( odCell + 0.02 + odLoc * 0.96 ) / 4.0, dFdx( odUv ) * 0.24, dFdy( odUv ) * 0.24 );
	odGlass = odTex.a;
	vec2 odId = floor( odUv ) + vFac.w;
	float odH = odHash( odId ), odH2 = odHash( odId + 17.3 );
	vec3 odC = odTex.rgb;
	odC *= mix( 1.0, 0.7 + 0.6 * odH, odGlass );
	odC = mix( odC, vec3( 0.72, 0.68, 0.6 ), odGlass * step( 0.8, odH2 ) * 0.45 );   // шторы и жалюзи
	odLit = step( 0.58, odHash( odId + 3.1 ) ) * ( 0.5 + odH2 );
	diffuseColor.rgb *= odC;
#endif`, 'replace'],
      ['#include <roughnessmap_fragment>', 'roughnessFactor = mix( roughnessFactor, 0.07, odGlass );'],
      ['#include <emissivemap_fragment>', 'totalEmissiveRadiance += odGlass * odLit * uNight * uGlow * vec3( 1.0, 0.7, 0.4 );'],
    ],
  });
  const roofMat = outdoor(std({ color: 0xffffff, vertexColors: true }), 'plain-vc', shared);
  const slabMat = outdoor(std({ color: 0xd8d5ce }), 'plain', shared);
  const railTex = browser ? grilleTexture(THREE, 'rail') : null;
  const railMat = std({ map: railTex, color: 0xffffff, roughness: 0.5, metalness: 0.3, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const fac = (g, style, levels, seed, kind) => {
    const s = STYLES[style] ?? STYLES.plain;
    g.set('aFac', [s.up, SHOPS.has(kind) ? 9 : s.gr, levels, seed]);
    return s;
  };

  const vBase = ground + (site.groundRise ?? 0), st = site.storeyH ?? 3;
  const own = [new Geo({ aFac: 4 }), new Geo({ color: 3 })], above = [new Geo({ aFac: 4 }), new Geo({ color: 3 })];
  for (const m of site.ownMass ?? []) {
    const [w, r] = m.part === 'above' ? above : own;
    const s = fac(w, OWN_STYLE, site.levels ?? 7, 11.7);
    walls(w, m.poly, m.y0, m.y1, s.bay, st, vBase);
    r.set('color', [0.33, 0.34, 0.35]);
    cap(THREE, r, m.poly, m.y1, true); cap(THREE, r, m.poly, m.y0, false);
  }
  const bal = new Geo(), rail = new Geo();
  for (const b of site.ownBalconies ?? []) {
    box(bal, [(b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2], b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
    fenceWall(rail, [[b.x0, b.z1], [b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1]], b.y1, b.y1 + RAIL_H, 1);
  }
  add('own', meshOf(THREE, own[0], facadeMat, 'own_walls', { cast: true }));
  add('ownRoof', meshOf(THREE, own[1], roofMat, 'own_caps', { cast: true }));
  add('balconies', meshOf(THREE, bal, slabMat, 'own_balconies', { cast: true }));
  add('ownRails', meshOf(THREE, rail, railMat, 'own_rails'));
  // Над квартирой: при взгляде сверху прячется тем же механизмом, что и верхний балкон (cut: 'above')
  const ab = new THREE.Group(); ab.name = 'own_above'; ab.userData.cut = 'above';
  for (const [b, mat, n] of [[above[0], facadeMat, 'own_above_walls'], [above[1], roofMat, 'own_above_caps']]) {
    const m = meshOf(THREE, b, mat, n, { cast: true }); if (m) { m.userData.cut = 'above'; ab.add(m); }
  }
  add('ownAbove', ab);

  // --- соседи: фасады по этажам, крыши (двускатные у частных домов), балконы у жилых в радиусе деталей
  const nbW = new Geo({ aFac: 4 }), nbR = new Geo({ color: 3 }), nbBal = new Geo(), nbRail = new Geo();
  const roofCol = (seed, gabled) => {
    const R = rng(seed);
    if (gabled) return [[0.22, 0.07, 0.04], [0.06, 0.06, 0.065], [0.17, 0.09, 0.06]][Math.floor(R() * 3)];
    const v = 0.16 + R() * 0.12; return [v, v, v * 1.03];
  };
  const building = (b, wallsGeo, roofGeo, detail) => {
    const seed = (b.osm ?? Math.round(b.poly[0][0] * 7 + b.poly[0][1] * 13)) % 9973;
    const plain = !!b.plain;
    const levels = b.levels ?? Math.max(1, Math.round(b.h / 3));
    const gabled = b.roof && b.roof !== 'flat' && b.poly.length === 4;
    const wallTop = ground + b.h + (plain || gabled ? 0 : PARAPET * 0.5);
    const storey = plain ? 3 : b.h / levels;
    const s = fac(wallsGeo, b.style ?? 'plain', plain ? 99 : levels, seed, b.kind);
    walls(wallsGeo, b.poly, ground, wallTop, s.bay, storey, ground);
    roofGeo.set('color', roofCol(seed, gabled));
    if (gabled) gable(roofGeo, wallsGeo, b.poly, wallTop, s.bay, storey, ground);
    else cap(THREE, roofGeo, b.poly, wallTop, true);
    if (detail && RESIDENTIAL.has(b.style) && levels >= 3) balconies(b.poly, levels, storey, s.bay, seed);
  };
  // Двускатная крыша над прямоугольником: конёк вдоль длинной стороны, уклон 35°, фронтоны — стеной
  const gable = (rg, wg, poly, y, bay, storey, base) => {
    const [a, b, c, d] = poly;
    const L1 = Math.hypot(b[0] - a[0], b[1] - a[1]), L2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const [p0, p1, p2, p3] = L1 >= L2 ? [a, b, c, d] : [b, c, d, a];   // p0p1 и p2p3 — карнизы
    const span = Math.min(L1, L2), rise = span / 2 * Math.tan(35 * RAD_DEG);
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const r0 = mid(p3, p0), r1 = mid(p1, p2), cen = mid(p0, p2);
    const P = (p, h) => [p[0], y + h, p[1]];
    const normal = (A, B, C) => {
      const u = B.map((v, i) => v - A[i]), v = C.map((x, i) => x - A[i]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1; return n.map(x => x / l);
    };
    const slope = (e0, e1, k1, k0) => {   // карниз e0 e1, конёк k1 k0; лицом вверх
      const A = P(e0, 0), B = P(e1, 0), C = P(k1, rise), D = P(k0, rise), n = normal(A, B, C);
      if (n[1] > 0) rg.quad(A, B, C, D, n); else rg.quad(A, D, C, B, n.map(x => -x));
    };
    slope(p0, p1, r1, r0); slope(p2, p3, r0, r1);
    const v0 = (y - base) / storey, v1 = (y + rise - base) / storey;
    const fronton = (e0, e1, k) => {   // треугольник стены над коротким краем, наружу
      const A = P(e0, 0), B = P(e1, 0), K = P(k, rise), n = normal(A, B, K), m = mid(e0, e1);
      const out = (m[0] - cen[0]) * n[0] + (m[1] - cen[1]) * n[2] > 0;
      const uA = [0, v0], uB = [span / bay, v0], uK = [span / 2 / bay, v1];
      if (out) wg.tri(A, B, K, n, uA, uB, uK); else wg.tri(A, K, B, n.map(x => -x), uA, uK, uB);
    };
    fronton(p1, p2, r1); fronton(p3, p0, r0);
  };
  // Балконы: на длинных фасадах (≥ 9 м) через окно, со второго этажа до последнего; плита и решётка на трёх сторонах
  const balconies = (poly, levels, storey, bay, seed) => {
    const s = Math.sign(signedArea(poly)) || 1;
    const R = rng(seed);
    const depth = 1.3 + R() * 0.3, every = 2 + Math.floor(R() * 2);
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 9) continue;
      const ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L, nx = s * uz, nz = -s * ux;
      const ang = Math.atan2(nx, nz);
      for (let k = 1; (k + 1) * bay < L; k += every) {
        const cx = p[0] + ux * (k + 0.5) * bay, cz = p[1] + uz * (k + 0.5) * bay, w = bay * 0.92;
        for (let f = 1; f < levels; f++) {
          const y = ground + f * storey;
          box(nbBal, [cx + nx * depth / 2, y - 0.18, cz + nz * depth / 2], w, 0.18, depth, ang);
          const P = (a, b) => [cx + ux * a + nx * b, cz + uz * a + nz * b];
          fenceWall(nbRail, [P(-w / 2, 0.05), P(-w / 2, depth), P(w / 2, depth), P(w / 2, 0.05)], y, y + RAIL_H, 1);
        }
      }
    }
  };
  for (const b of site.neighbours ?? []) building(b, nbW, nbR, (b.d ?? 0) <= detailR);
  add('neighbours', meshOf(THREE, nbW, facadeMat, 'neighbours', { cast: true }));
  add('neighbourRoofs', meshOf(THREE, nbR, roofMat, 'neighbour_roofs', { cast: true }));
  add('neighbourBalconies', meshOf(THREE, nbBal, slabMat, 'neighbour_balconies'));
  add('neighbourRails', meshOf(THREE, nbRail, railMat, 'neighbour_rails'));
  if (far) {
    const fw = new Geo({ aFac: 4 }), fr = new Geo({ color: 3 });
    for (const b of site.far ?? []) building(b, fw, fr, false);
    add('far', meshOf(THREE, fw, facadeMat, 'far', { receive: false }));
    add('farRoofs', meshOf(THREE, fr, roofMat, 'far_roofs', { receive: false }));
  }

  // --- заборы, стены, живые изгороди
  const fence = new Geo(), solid = new Geo({ color: 3 }), hedge = new Geo();
  for (const f of site.fences ?? []) {
    const line = f.line;
    if (f.kind === 'fence') {
      fenceWall(fence, line, ground, ground + f.h, 2.5);
      solid.set('color', [0.06, 0.065, 0.07]);
      for (let i = 0; i < line.length - 1; i++) {
        const p = line[i], q = line[i + 1], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        for (let s = 0; s <= L; s += 2.5) {
          const t = s / (L || 1);
          box(solid, [p[0] + (q[0] - p[0]) * t, ground, p[1] + (q[1] - p[1]) * t], 0.06, f.h + 0.05, 0.06);
        }
      }
    } else if (f.kind === 'hedge') {
      for (let i = 0; i < line.length - 1; i++) bar(hedge, line[i], line[i + 1], 0.9, ground, ground + f.h);
    } else {
      solid.set('color', f.kind === 'guard_rail' ? [0.45, 0.47, 0.48] : [0.5, 0.48, 0.44]);
      const [y0, w] = f.kind === 'guard_rail' ? [0.45, 0.06] : [0, 0.3];
      for (let i = 0; i < line.length - 1; i++) bar(solid, line[i], line[i + 1], w, ground + y0, ground + f.h);
    }
  }
  const fenceMat = std({ map: browser ? grilleTexture(THREE, 'fence') : null, color: 0xffffff, roughness: 0.6, metalness: 0.2, alphaTest: 0.5, side: THREE.DoubleSide });
  add('fences', meshOf(THREE, fence, fenceMat, 'fences'));
  add('walls', meshOf(THREE, solid, roofMat, 'walls'));
  const hedgeMat = outdoor(std({ color: 0x3f5a2c }), 'plain', shared);
  add('hedges', meshOf(THREE, hedge, hedgeMat, 'hedges'));

  // --- фонари: опора, кронштейн, светильник; плафон светится вечером
  const lamps = site.lamps ?? [];
  let lampLens = null;
  if (lamps.length) {
    const pole = new Geo(), lens = new Geo();
    const H = 8;
    for (let j = 0; j < 8; j++) {
      const a0 = j / 8 * Math.PI * 2, a1 = (j + 1) / 8 * Math.PI * 2;
      const P = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
      pole.quad(P(a0, 0.1, 0), P(a0, 0.06, H), P(a1, 0.06, H), P(a1, 0.1, 0), P((a0 + a1) / 2, 1, 0.005));
    }
    box(pole, [0, H - 0.25, 0.75], 0.07, 0.07, 1.5);
    box(pole, [0, H - 0.3, 1.55], 0.32, 0.12, 0.62);
    lens.quad([-0.14, H - 0.31, 1.27], [-0.14, H - 0.31, 1.83], [0.14, H - 0.31, 1.83], [0.14, H - 0.31, 1.27], [0, -1, 0]);
    const poleMat = outdoor(std({ color: 0x55595d, roughness: 0.5, metalness: 0.6 }), 'plain', shared);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, emissive: 0xffc98a, emissiveIntensity: 0, roughness: 0.4 });
    const im = (geo, mat, name) => {
      const m = new THREE.InstancedMesh(geo.geometry(THREE), mat, lamps.length);
      const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), S = new THREE.Vector3(1, 1, 1);
      lamps.forEach(([x, z, a], i) => m.setMatrixAt(i, M4.compose(new THREE.Vector3(x, ground, z), Q.setFromAxisAngle(Y, a * RAD_DEG), S)));
      m.computeBoundingSphere(); m.name = name; m.userData.context = true; m.receiveShadow = true;
      return add(name, m);
    };
    im(pole, poleMat, 'lamps');
    lampLens = im(lens, lensMat, 'lamp_lenses');
  }

  // --- деревья и кусты: на вид — по экземпляру ветвей, листвы и голых веточек; пятна тени под кронами
  const trees = site.trees ?? [], speciesNames = site.treeSpecies ?? Object.keys(TREES);
  const foliage = browser ? { broad: foliageTexture(THREE, 'broad'), needle: foliageTexture(THREE, 'needle'), twig: foliageTexture(THREE, 'twig') } : {};
  const barkMat = {}, flora = [];
  const keepDepth = (map, withKeep) => {
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
    if (withKeep) {
      m.onBeforeCompile = sh => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRand; attribute float aKeep; varying float vCut;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCut = step( aKeep, aRand );');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCut;')
          .replace('#include <alphatest_fragment>', 'if ( vCut > 0.5 ) discard;\n#include <alphatest_fragment>');
      };
      m.customProgramCacheKey = () => 'outdoor-leafdepth';
    }
    return m;
  };
  const leafMat = (map, keep) => outdoor(std({ map, color: keep ? 0xffffff : 0x8a8078, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }), keep ? 'leaf' : 'twig', shared, {
    vPars: keep ? 'attribute float aRand; attribute float aKeep; varying float vCut;' : '',
    vMain: keep ? 'vCut = step( aKeep, aRand );' : '',
    fPars: keep ? 'varying float vCut;' : '',
    fRep: [
      ...(keep ? [['#include <alphatest_fragment>', 'if ( vCut > 0.5 ) discard;', 'before']] : []),
      ['#include <normal_fragment_begin>', 'normal = normalize( vNormal ); nonPerturbedNormal = normal;'],   // нормаль кроны, не грани
    ],
  });
  const blobs = [];
  const bySpecies = new Map();
  trees.forEach((t, i) => { const sp = speciesNames[t[3]] ?? 'linden'; if (!bySpecies.has(sp)) bySpecies.set(sp, []); bySpecies.get(sp).push(i); });
  // тень в квартиру могут дать только деревья рядом с домом: у остальных видов не тратим на неё проход
  const nearHouse = i => Math.hypot(trees[i][0] - 2, trees[i][1] - 3) < 50;
  for (const [sp, list] of bySpecies) {
    const def = TREES[sp] ?? TREES.linden;
    const cast = sp !== 'shrub' && list.some(nearHouse);
    const seed = 101 + Object.keys(TREES).indexOf(sp) * 31;
    const tree = growTree(THREE, def, seed);
    const n = list.length;
    const mats = []; const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    list.forEach(i => {
      const [x, z, h] = trees[i], R = rng(i * 7919 + 13);
      const sx = h * (0.85 + 0.3 * R()), sz = h * (0.85 + 0.3 * R());
      mats.push(M4.compose(new THREE.Vector3(x, ground, z), Q.setFromAxisAngle(Y, R() * Math.PI * 2), new THREE.Vector3(sx, h, sz)).clone());
      blobs.push([x, z, def.crown[0] * h * 1.25, sp === 'shrub' ? 0.6 : 1]);
    });
    const inst = (geo, mat, name, cast) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      mats.forEach((M, k) => m.setMatrixAt(k, M));
      m.computeBoundingSphere(); m.name = name; m.castShadow = cast; m.receiveShadow = true; m.userData.context = true;
      return add(name, m);
    };
    barkMat[sp] = outdoor(std({ map: tex.bark, color: def.bark, roughness: 0.95 }), 'plain', shared);
    inst(tree.wood.geometry(THREE), barkMat[sp], `tree_${sp}_wood`, cast);
    const cards = cardGeometry(THREE, tree, def, 1, seed + 1);
    const keep = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
    cards.setAttribute('aKeep', keep);
    const leaves = inst(cards, leafMat(foliage[def.leaf] ?? null, true), `tree_${sp}_leaves`, cast);
    leaves.customDepthMaterial = keepDepth(foliage[def.leaf] ?? null, true);
    leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    let twigs = null;
    if (!def.evergreen) {
      twigs = inst(cardGeometry(THREE, tree, def, 0.85, seed + 2, 0.7), leafMat(foliage.twig ?? null, false), `tree_${sp}_twigs`, cast);
      twigs.customDepthMaterial = keepDepth(foliage.twig ?? null, false);
    }
    flora.push({ sp, def, list, leaves, keep, cards });
  }
  // пятна тени: тёмные, без записи глубины, поверх земли
  let blobMesh = null;
  if (blobs.length) {
    const q = new Geo();
    q.quad([-1, 0, 1], [1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: browser ? blobTexture(THREE) : null, transparent: true, opacity: 0.4, depthWrite: false, ...layer(BLOB_K) });
    blobMesh = new THREE.InstancedMesh(q.geometry(THREE), mat, blobs.length);
    const M4 = new THREE.Matrix4();
    blobs.forEach(([x, z, r, k], i) => blobMesh.setMatrixAt(i, M4.makeScale(r * k, 1, r * k).setPosition(x, ground + 0.02, z)));
    blobMesh.computeBoundingSphere(); blobMesh.name = 'tree_shadows'; blobMesh.userData.context = true;
    blobMesh.renderOrder = 1;
    add('treeShadows', blobMesh);
  }

  // --- машины (грузятся отдельно; до загрузки их просто нет)
  const carMat = outdoor(std({ vertexColors: true, roughness: 0.42, metalness: 0.15 }), 'car', shared, {
    vPars: 'attribute float aPaint; attribute float aGlass; varying float vGlass;',
    vMain: 'vGlass = aGlass;',
    fPars: 'varying float vGlass;',
    fRep: [['#include <roughnessmap_fragment>', 'roughnessFactor = mix( roughnessFactor, 0.05, vGlass );']],
    vAfter: [['#include <color_vertex>', `#ifdef USE_INSTANCING_COLOR
	vColor.xyz = mix( color.xyz, instanceColor.xyz, aPaint );
#endif`]],
  });
  const cars = site.cars ?? [];
  if (browser && cars.length) {
    pending.push(loadCars(THREE).then(geos => {
      const names = site.carModels ?? ['sedan', 'hatchback', 'suv', 'van'];
      const colours = (site.carColours ?? []).map(c => new THREE.Color(`#${c}`));
      names.forEach((name, mi) => {
        const list = cars.filter(c => c[3] === mi), geo = geos[name];
        if (!list.length || !geo) return;
        const m = new THREE.InstancedMesh(geo, carMat, list.length);
        const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), S = new THREE.Vector3(1, 1, 1);
        list.forEach(([x, z, a, , c], i) => {
          m.setMatrixAt(i, M4.compose(new THREE.Vector3(x, ground, z), Q.setFromAxisAngle(Y, a * RAD_DEG), S));
          m.setColorAt(i, colours[c] ?? new THREE.Color(0x888888));
        });
        m.computeBoundingSphere(); m.name = `cars_${name}`; m.receiveShadow = true; m.userData.context = true;
        add(`cars_${name}`, m);
        skipInProbes(m);
      });
    }).catch(e => console.warn('site: машины не загрузились', e)));
  }

  // --- мелкие детали не нужны зондам переотражений (lighting.js снимает их кубами 90° × 1:1): экономим кадры;
  //     листве и решёткам — ещё и проходу нормалей GTAO
  for (const k of ['kerbs', 'ownRails', 'neighbourBalconies', 'neighbourRails', 'fences', 'walls', 'hedges', 'lamps', 'lamp_lenses', 'treeShadows'])
    if (parts[k]) skipInProbes(parts[k]);
  for (const k of Object.keys(parts)) if (k.startsWith('tree_')) skipInProbes(parts[k]);

  // --- дымка и «ночь» — из неба панорамы над горизонтом (своя у дня, пасмурно и вечера)
  let skyKey = '';
  groundMesh.onBeforeRender = (renderer, scene) => {
    const bg = scene.background, key = `${bg?.uuid}|${scene.backgroundIntensity}`;
    if (key === skyKey) return;
    skyKey = key;
    const sky = horizonColor(THREE, bg);
    if (!sky) return;
    sky.multiplyScalar(scene.backgroundIntensity ?? 1);
    shared.uHaze.value.copy(sky);
    const lum = 0.2126 * sky.r + 0.7152 * sky.g + 0.0722 * sky.b;
    shared.uNight.value = clamp01((NIGHT_LUM[0] - lum) / (NIGHT_LUM[0] - NIGHT_LUM[1]));
    if (lampLens) lampLens.material.emissiveIntensity = shared.uNight.value * 6;
  };

  // --- сезон
  let seasonSig = '';
  function setSeason(dateISO) {
    const d = dayOfYear(dateISO);
    const [sat, r, g, b] = keyed(GRASS_KEYS, d);
    const [crop, gold, furrowK] = keyed(FIELD_KEYS, d);
    const sig = [sat, r, g, b, crop, gold, furrowK, ...[-8, 0, 8].map(s => { const q = seasonFor(dateISO, s); return [q.leaf, q.turn, q.young]; }).flat()]
      .map(v => v.toFixed(3)).join();
    if (sig === seasonSig) return false;
    seasonSig = sig;
    for (const m of Object.values(terrainMats)) {
      const u = m.userData.u;
      if (m.userData.season) { u.uSat.value = sat; u.uTint.value.setRGB(r, g, b); }
      if (u.uCrop) { u.uCrop.value = crop; u.uGold.value = gold; u.uFurrow.value = furrowK; }
    }
    const C = new THREE.Color(), A = new THREE.Color(), brown = new THREE.Color(0x7a5b36), spring = new THREE.Color(0x8db54a);
    let leafSum = 0;
    for (const f of flora) {
      const { def, list, leaves, keep } = f;
      let maxKeep = 0;
      list.forEach((ti, k) => {
        const R = rng(ti * 104729 + 7);
        const q = seasonFor(dateISO, (R() - 0.5) * 16);
        const evergreen = def.evergreen;
        const leaf = evergreen ? 1 : q.leaf;
        C.set(def.green).offsetHSL((R() - 0.5) * 0.03, (R() - 0.5) * 0.1, (R() - 0.5) * 0.06);
        if (!evergreen) {
          C.lerp(spring, q.young * 0.6);
          A.set(def.autumn[Math.floor(R() * def.autumn.length)]).offsetHSL((R() - 0.5) * 0.04, 0, (R() - 0.5) * 0.08);
          C.lerp(A, q.turn);
          C.lerp(brown, (1 - q.leaf) * q.turn * 0.55);
        } else C.offsetHSL(0, -0.05 * (1 - q.young), -0.02);
        leaves.setColorAt(k, C);
        keep.array[k] = leaf;
        maxKeep = Math.max(maxKeep, leaf);
        leafSum += leaf;
      });
      keep.needsUpdate = true; leaves.instanceColor.needsUpdate = true;
      leaves.visible = maxKeep > 0.01;
      // трассировщик фото не знает aKeep: оставляем в индексе только плоскости, которые могут быть видны
      const full = f.cards.userData.fullIndex, rand = f.cards.attributes.aRand.array, idx = [];
      for (let i = 0; i < full.length; i += 6) if (rand[full[i]] < maxKeep) idx.push(...full.slice(i, i + 6));
      f.cards.setIndex(idx);
    }
    if (blobMesh) blobMesh.material.opacity = 0.18 + 0.27 * (trees.length ? leafSum / trees.length : 0);
    return true;
  }
  setSeason(opts.date ?? new Date().toISOString().slice(0, 10));

  group.userData.parts = parts;
  group.setSeason = setSeason;
  group.ready = Promise.all(pending).then(() => true);
  return group;
}

// Яркость неба у горизонта, ниже которой зажигаются окна и фонари (полностью — на второй)
const NIGHT_LUM = [0.08, 0.02];

// Средний цвет неба панорамы чуть выше горизонта (линейный), или null, если панорама ещё не загружена
function horizonColor(THREE, bg) {
  const img = bg?.image;
  if (!img?.data || !img.width) return null;
  const { data, width: w, height: h } = img;
  const half = data instanceof Uint16Array, ch = data.length / (w * h);
  const get = i => half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i];
  const top = h * 0.5;   // equirect, строка 0 — зенит (RGBELoader), середина — горизонт
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.floor(top - h * 0.05); y < Math.floor(top - h * 0.01); y += 2) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * ch;
      r += get(i); g += get(i + 1); b += get(i + 2); n++;
    }
  }
  return n ? new THREE.Color(r / n, g / n, b / n) : null;
}

// Зонды переотражений lighting.js снимают сцену кубом (90°, 1:1) — мелочь окружения им не нужна;
// меши с альфа-вырезом пропускают ещё и проход нормалей GTAO. На это время меш рисует 0 экземпляров / 0 вершин.
function skipInProbes(mesh) {
  const probe = cam => cam.isPerspectiveCamera && cam.fov === 90 && cam.aspect === 1;
  // проход нормалей GTAO (render.js) рисует всё одним MeshNormalMaterial без альфа-выреза:
  // листва и решётки дали бы в AO сплошные тёмные квадраты карточек
  const cut = mesh.material.alphaTest > 0;
  let saved = null;
  mesh.onBeforeRender = (r, s, cam, geo, mat) => {
    if (!probe(cam) && !(cut && mat.isMeshNormalMaterial)) return;
    if (mesh.isInstancedMesh) { saved = mesh.count; mesh.count = 0; } else { saved = geo.drawRange.count; geo.drawRange.count = 0; }
  };
  mesh.onAfterRender = (r, s, cam, geo) => {
    if (saved === null) return;
    if (mesh.isInstancedMesh) mesh.count = saved; else geo.drawRange.count = saved;
    saved = null;
  };
}
