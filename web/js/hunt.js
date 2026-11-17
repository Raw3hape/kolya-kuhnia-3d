import { buildHuntRegions as buildRegions } from './hunt-regions.js';
import { raySphere, rayAnimalPose } from './hunt-hitboxes.js';
import { captureLocalWildlife, restoreLocalWildlife } from './hunt-session-state.js';
import { createFieldEventSimulation } from './field-events-simulation.js';
import { createFieldEventView } from './field-events-view.js';
import { collectFieldOccluders, fieldRayBlocked } from './field-events-visibility.js';
// Охота «как в тире» за балконом: кабаны (dziki) с поросятами (warchlaki) пасутся на поле и лугу под домом (больше всего —
// в 40–150 м от балкона) и на газонах справа, у дорог и парковок; над полем низко тянутся клинья больших гусей, гуси
// пасутся на поле, реже — стайки голубей и грачей, утки. Стреляют из оружия прогулки (viewmodel.js).
// Очки и серии за текущую игру, без таймера, модальных итогов и запросов таблицы рекордов.
// Настройка браузера, в код варианта не входит. api/scores.js сохранён для старых клиентов.
//
// createHunt({ THREE, scene, camera, renderer, pipe, requestRender, getState, getWalk, plan?, site? })
//   plan/site — уже загруженные plan.generated.json и site.json (иначе модуль загрузит их сам)
//   -> { update(dt) -> bool   true — нужен кадр (звери видны и двигаются); звать каждый кадр;
//        raycast(raycaster) -> { distance, point, normal, object, hit(weaponId, damage) } | null   ближайший зверь на луче;
//        noise(point, loudness = 1)   выстрел: звери слышат (кабаны настораживаются и бегут, птицы взлетают);
//        stats, enabled, setEnabled(on), dispose(),
//        award(points, point, title, sub)   очки за чужую мишень (мыши, mice.js): в текущий счёт, опыт и всплывашку; 0 — только надпись }
// addTargets({ raycast(raycaster) -> { distance, point, normal, object, hit(weaponId, damage) } | null }) -> снять()
//   другие мишени для оружия (мыши и монстры «Живого дома», life.js): raycast() охоты отдаёт ближайшее из зверей и их.
//   Работают и при выключенной охоте.
// registerHuntUI(addSection, getHunt) — раздел «Охота» во вкладке 'live' после «Оружия»; как играть — строки справки (help.js).
//
// Звери — два InstancedMesh (кабаны и птицы, по одному вызову отрисовки) + пятна тени под кабанами. Геометрия своя,
// процедурная (поза в вершинном шейдере: шаг, рысь, галоп, пасутся, тревога, падение; взмахи крыльев, полнота гуся) —
// без скелетов и без загрузки моделей. Появление и затухание — сеткой отбрасывания (без прозрачности). Шейдеры
// компилируются один раз при старте, новые звери берут свободные игровые слоты. Видимые звери занимают плотный
// префикс GPU-буферов; остальные экземпляры не отправляются на рисование. Игровые индексы остаются прежними.
// Кадры: звери видны — в кадре камеры, а из квартиры — сквозь окно или балконную дверь; иначе живут грубо (4 шага
// в секунду) и кадров не просят. Плавно (каждый кадр, в облёте — spec.orbitFps) — только пока идёт раунд, кто-то
// бежит или падает. В покое шагают в кадрах, которые и так рисуются (камера сдвинулась), а сами просят кадр лишь
// в прогулке и не чаще spec.idleFps; в облёте — ни одного своего кадра.
// Попадания: объёмы по частям тела в позе шейдера с запасом (hitPad, perMetre) и с учётом запаздывания (hit.lag).
// Фото-режим, снимок PNG и GLB: зверей нет (userData.rasterOnly, pipe.photo, pipe.onLive) — путевой трассировщик
// не умеет вершинную анимацию, а в кадре квартиры звери не нужны. Лучи сцены их не задевают (raycast пустой).
// Оси квартиры: X вдоль окон, Z от окон вглубь, Y вверх; земля y = −site.floorY; поле и луг — site.areas (spec.region).

import { addHelp } from './help.js';
import { startup } from './startup-state.js';

const SPEC_URL = new URL('../spec/hunt.json', import.meta.url);
const SITE_URL = new URL('../spec/site.json', import.meta.url);
const PLAN_URL = new URL('../spec/plan.generated.json', import.meta.url);
const PREF = 'kitchen-hunt-v1';   // { on, name, xp, best, last, board }
const TAU = Math.PI * 2;
const BIRD_KINDS = ['pigeon', 'crow', 'duck', 'goose'];   // номер вида в шейдере птиц (клюв, окрас)
const COARSE = 0.25;              // шаг жизни, пока зверей не видно, с
const HIST = 6, HIST_DT = 0.035;  // история положений зверя: 6 снимков через 35 мс (попадания «как увидел»)

const rand = (a, b) => a + Math.random() * (b - a);
const pick = r => rand(r[0], r[1]);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = hex => { const c = parseInt(hex, 16); return [c >> 16 & 255, c >> 8 & 255, c & 255].map(v => Math.pow(v / 255, 2.2)); };
const fmt = n => Math.round(n).toLocaleString('ru-RU');
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// ---------- профиль игрока и таблица (общие для охоты и панели) ----------

const DEF_PREF = { on: true, name: '', xp: 0, best: 0, last: null, board: [] };
const shared = { pref: readPref(), hunt: null };
const targets = new Set();   // addTargets: чужие мишени (life.js)
export function addTargets(t) { targets.add(t); return () => targets.delete(t); }
export function raycastExternalTargets(raycaster) {
  let best = null;
  for (const t of targets) { const hit = t.raycast(raycaster); if (hit && (!best || hit.distance < best.distance)) best = hit; }
  return best;
}
function readPref() {
  try { return { ...DEF_PREF, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { ...DEF_PREF }; }
}
function writePref() { try { localStorage.setItem(PREF, JSON.stringify(shared.pref)); } catch { /* хранилище недоступно */ } }
// Имя: без управляющих и невидимых символов, пробелы схлопнуты; та же чистка на сервере (api/scores.js)
export function cleanName(s, max = 24) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
let specPromise = null;
function loadSpec() {
  return specPromise ??= fetch(SPEC_URL).then(r => r.json());
}
// Уровень по опыту: на уровень n нужно base · (n − 1)^pow очков всего
export function levelOf(xp, L) {
  const n = Math.floor(Math.pow(Math.max(0, xp) / L.base, 1 / L.pow)) + 1;
  const a = L.base * Math.pow(n - 1, L.pow), b = L.base * Math.pow(n, L.pow);
  return { level: n, progress: (xp - a) / (b - a), next: Math.ceil(b - xp) };
}
// ---------- геометрия: кабан (модель 1.5 м, холка ~0.9 м, морда +Z, копыта y = 0) ----------

// Части: 0 туловище и голова (вес головы aW по шее), 1 голова целиком (уши), 2 хвост, 3..10 ноги (верх, низ: ПЛ, ПП, ЗЛ, ЗП), 11 клыки
const HIPS = [[0.12, 0.56, 0.2], [-0.12, 0.56, 0.2], [0.12, 0.58, -0.5], [-0.12, 0.58, -0.5]];
const KNEE_Y = 0.265;
const BIRD_BASE = Math.pow(0xd8 / 255, 2.2);   // цвет вершин тела птицы (C.body в birdGeometry)
const BOAR_SECTIONS = [   // z, центр y, полуширина, полувысота, гребень щетины
  [-0.74, 0.64, 0.05, 0.06, 0], [-0.69, 0.63, 0.15, 0.19, 0], [-0.56, 0.62, 0.21, 0.25, 0.01], [-0.36, 0.62, 0.23, 0.26, 0.02],
  [-0.14, 0.63, 0.24, 0.27, 0.03], [0.08, 0.63, 0.25, 0.28, 0.05], [0.24, 0.62, 0.235, 0.27, 0.06], [0.36, 0.6, 0.2, 0.235, 0.04],
  [0.46, 0.575, 0.165, 0.2, 0.02], [0.56, 0.53, 0.13, 0.16, 0], [0.66, 0.475, 0.09, 0.115, 0], [0.75, 0.44, 0.066, 0.076, 0],
  [0.8, 0.43, 0.058, 0.062, 0],
];
const BIRD_SECTIONS = [   // размах 1 м: z, y, полуширина, полувысота
  [-0.17, 0, 0.025, 0.02], [-0.1, 0, 0.055, 0.05], [0, 0.005, 0.065, 0.06], [0.09, 0.012, 0.05, 0.05], [0.14, 0.026, 0.034, 0.034],
  [0.18, 0.036, 0.042, 0.042], [0.215, 0.034, 0.03, 0.028],
];

function geoBuilder() {
  const P = [], C = [], A = [], W = [];
  const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
  return {
    // треугольник с одним цветом на грань (плоская заливка); w — вес головы по вершинам
    tri(a, b, c, col, part, w = [0, 0, 0], jitter = 0.08) {
      const k = 1 + (hash(a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]) - 0.5) * 2 * jitter;
      for (const [i, v] of [a, b, c].entries()) { P.push(...v); C.push(col[0] * k, col[1] * k, col[2] * k); A.push(part); W.push(w[i]); }
    },
    quad(a, b, c, d, col, part, w, jitter) { this.tri(a, b, c, col, part, w ? [w[0], w[1], w[2]] : undefined, jitter); this.tri(a, c, d, col, part, w ? [w[0], w[2], w[3]] : undefined, jitter); },
    build(THREE) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 1));
      g.setAttribute('aW', new THREE.Float32BufferAttribute(W, 1));
      g.computeVertexNormals();   // без индексов — нормаль грани: низкополигональная плоская заливка
      return g;
    },
  };
}
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

// Лофт по сечениям: кольца по N точек, сверху вниз; colorAt(x, y, z, k) -> цвет грани; weight(z) — вес головы
function loft(B, sections, N, e, colorAt, part, weight = () => 0, capColors = []) {
  const rings = sections.map(([z, cy, hw, hh, ridge = 0]) => {
    const r = [];
    for (let k = 0; k < N; k++) {
      const t = k / N * TAU, s = Math.sin(t), c = Math.cos(t);
      r.push([hw * spow(s, e), cy + hh * spow(c, e) * (c < 0 ? 0.92 : 1) + (k === 0 ? ridge : 0), z]);
    }
    return r;
  });
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1];
    for (let k = 0; k < N; k++) {
      const a = r0[k], b = r0[(k + 1) % N], c = r1[(k + 1) % N], d = r1[k];
      const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
      B.quad(a, d, c, b, colorAt(...m, k), part, [weight(a[2]), weight(d[2]), weight(c[2]), weight(b[2])]);
    }
  }
  // торцы веером
  [[rings[0], -1, capColors[0]], [rings[rings.length - 1], 1, capColors[1]]].forEach(([r, dir, col]) => {
    const z = r[0][2], cy = r.reduce((s, v) => s + v[1], 0) / N, ctr = [0, cy, z + dir * 0.012];
    for (let k = 0; k < N; k++) {
      const a = r[k], b = r[(k + 1) % N];
      if (dir < 0) B.tri(ctr, a, b, col || colorAt(...ctr, k), part, [weight(z), weight(z), weight(z)]);
      else B.tri(ctr, b, a, col || colorAt(...ctr, k), part, [weight(z), weight(z), weight(z)]);
    }
  });
}
// Конус/призма от p0 к p1 (радиусы r0, r1), n граней
function limb(B, p0, p1, r0, r1, n, col, part, w = 1, capCol = col) {
  const ring = (p, r, off) => Array.from({ length: n }, (_, k) => { const t = (k + off) / n * TAU; return [p[0] + Math.sin(t) * r, p[1], p[2] + Math.cos(t) * r]; });
  const a = ring(p0, r0, 0), b = ring(p1, r1, 0), W = [w, w, w, w];
  for (let k = 0; k < n; k++) B.quad(a[k], b[k], b[(k + 1) % n], a[(k + 1) % n], col, part, W);
  for (let k = 0; k < n; k++) B.tri(p1, b[(k + 1) % n], b[k], capCol, part, [w, w, w]);
}

function boarGeometry(THREE) {
  const B = geoBuilder();
  const C = {
    back: lin('2c2520'), body: lin('463b32'), belly: lin('54483b'), cheek: lin('5c534b'), snout: lin('2a2321'),
    disc: lin('5e4a47'), leg: lin('2b241f'), hoof: lin('141110'), ear: lin('342b25'), tusk: lin('e6dcc6'),
  };
  const headW = z => smooth(0.3, 0.47, z);
  loft(B, BOAR_SECTIONS, 12, 0.78, (x, y, z) => {
    if (z > 0.7) return C.snout;
    if (z > 0.44 && z < 0.66 && y < 0.58 && Math.abs(x) > 0.07) return C.cheek;
    if (y > 0.8) return C.back;
    if (y < 0.45) return C.belly;
    return C.body;
  }, 0, headW, [C.back, C.disc]);
  // уши — треугольные пирамидки, назад и вбок
  for (const s of [1, -1]) {
    const base = [[s * 0.05, 0.72, 0.53], [s * 0.11, 0.69, 0.5], [s * 0.07, 0.7, 0.45]], tip = [s * 0.14, 0.86, 0.42];
    for (let k = 0; k < 3; k++) { const a = base[k], b = base[(k + 1) % 3]; B.tri(a, b, tip, C.ear, 1, [1, 1, 1]); B.tri(b, a, tip, C.ear, 1, [1, 1, 1]); }
    limb(B, [s * 0.055, 0.42, 0.715], [s * 0.085, 0.51, 0.69], 0.012, 0.003, 4, C.tusk, 11, 1);
  }
  // хвост с кисточкой
  limb(B, [0, 0.71, -0.72], [0, 0.5, -0.8], 0.018, 0.01, 4, C.leg, 2, 0);
  limb(B, [0, 0.52, -0.795], [0, 0.44, -0.81], 0.025, 0.004, 4, C.back, 2, 0);
  // ноги: бедро (часть внутри туловища), голень, копыто
  HIPS.forEach(([x, y, z], i) => {
    const rear = i >= 2, up = 3 + 2 * i, lo = up + 1;
    limb(B, [x, y + 0.04, z - (rear ? 0.02 : 0)], [x, KNEE_Y, z + (rear ? 0.03 : 0)], rear ? 0.11 : 0.075, 0.05, 6, C.leg, up, 0);
    limb(B, [x, KNEE_Y + 0.01, z + (rear ? 0.03 : 0)], [x, 0.045, z - (rear ? 0.03 : 0)], 0.045, 0.035, 6, C.leg, lo, 0);
    limb(B, [x, 0.05, z - (rear ? 0.03 : 0)], [x, 0, z - (rear ? 0.02 : -0.01)], 0.036, 0.045, 6, C.hoof, lo, 0, C.hoof);
  });
  return B.build(THREE);
}

// Птица с размахом 1 м: части 0 тело, 1/2 левое крыло (внутр./внешн., +X), 3/4 правое, 5 клюв
function birdGeometry(THREE) {
  const B = geoBuilder();
  const C = { body: [BIRD_BASE, BIRD_BASE, BIRD_BASE], belly: lin('f0f0ec'), tip: lin('5a5a5a'), wing: lin('c8c8c8'), tail: lin('9a9a9a') };
  loft(B, BIRD_SECTIONS, 6, 1, (x, y, z) => (y < -0.01 ? C.belly : C.body), 0, () => 0, [C.tail, C.body]);
  limb(B, [0, 0.032, 0.21], [0, 0.028, 0.275], 0.016, 0.002, 4, C.body, 5, 0);
  B.quad([-0.035, 0, -0.15], [0.035, 0, -0.15], [0.09, -0.005, -0.3], [-0.09, -0.005, -0.3], C.tail, 0, null, 0.03);
  for (const s of [1, -1]) {
    const pIn = s > 0 ? 1 : 3, pOut = pIn + 1, f = v => [s * v[0], v[1], v[2]];
    const sh = [[0.04, 0.02, 0.06], [0.04, 0.02, -0.08]], el = [[0.25, 0.02, 0.045], [0.25, 0.02, -0.075]], tip = [0.5, 0.02, -0.07], tb = [0.43, 0.02, -0.1];
    const q = s > 0 ? (a, b, c, d, col, p) => B.quad(f(a), f(b), f(c), f(d), col, p, null, 0.04) : (a, b, c, d, col, p) => B.quad(f(d), f(c), f(b), f(a), col, p, null, 0.04);
    q(sh[0], el[0], el[1], sh[1], C.wing, pIn);
    q(el[0], tip, tb, el[1], C.tip, pOut);
  }
  return B.build(THREE);
}

// ---------- шейдеры ----------

const COMMON_GLSL = `
attribute float aPart; attribute float aW; attribute vec4 aMot; attribute vec4 aSt;
uniform float uTime;
varying vec3 vHObj; varying float vHPart; varying vec4 vHSt;
mat2 hRot( float a ) { float c = cos( a ), s = sin( a ); return mat2( c, s, -s, c ); }`;
// поворот в плоскости (y, z) вокруг оси X и в плоскости (x, y) вокруг оси Z
const ROT_GLSL = `
void hRotX( inout vec3 p, inout vec3 n, vec3 piv, float a ) { mat2 m = hRot( a ); p.yz = m * ( p.yz - piv.yz ) + piv.yz; n.yz = m * n.yz; }
void hRotZ( inout vec3 p, inout vec3 n, vec3 piv, float a ) { mat2 m = hRot( a ); p.xy = m * ( p.xy - piv.xy ) + piv.xy; n.xy = m * n.xy; }`;

// aMot: фаза шага, аллюр 0..3 (стоит, шаг, рысь, галоп), пасётся 0..1, тревога 0..1
// aSt: падение 0..1, растворение 0..1, поросёнок 0/1, вспышка попадания 0..1
const BOAR_VERT = `
attribute float aSeed;
uniform vec3 uHip[ 4 ];
void hDeform( inout vec3 p, inout vec3 n ) {
	float ph = aMot.x, g = aMot.y, part = aPart;
	float amp = 0.32 * clamp( g, 0.0, 1.0 ) + 0.1 * clamp( g - 1.0, 0.0, 1.0 ) + 0.22 * clamp( g - 2.0, 0.0, 1.0 );
	float gf = clamp( g - 2.0, 0.0, 1.0 );
	float seed = aSeed * 1.7;
	if ( part > 10.5 ) p = mix( p, vec3( 0.0, 0.5, 0.62 ), aSt.z );   // у поросят клыков нет
	if ( part > 2.5 && part < 10.5 ) {
		float li = floor( ( part - 3.0 ) * 0.5 ), lower = mod( part - 3.0, 2.0 );
		vec3 hip = uHip[ int( li ) ];
		float diag = li < 0.5 ? 0.0 : li < 1.5 ? 0.5 : li < 2.5 ? 0.5 : 0.0;
		float gal = li < 0.5 ? 0.0 : li < 1.5 ? 0.12 : li < 2.5 ? 0.58 : 0.46;
		float t = PI2 * ( ph + mix( diag, gal, gf ) );
		float swing = amp * sin( t ), bend = amp * 1.4 * max( 0.0, cos( t ) );
		if ( lower > 0.5 ) hRotX( p, n, vec3( hip.x, ${KNEE_Y.toFixed(3)}, hip.z ), bend );
		hRotX( p, n, hip, -swing );
	}
	vec3 neck = vec3( 0.0, 0.62, 0.36 );
	float w = part > 0.5 && part < 1.5 || part > 10.5 ? 1.0 : aW;
	if ( w > 0.0 ) {
		vec3 q = neck + ( p - neck ) * mix( 1.0, 1.22, aSt.z * w ), qn = n;   // у поросят голова крупнее
		float root = aMot.z * 0.09 * sin( uTime * 7.0 + seed );
		hRotX( q, qn, neck, aMot.z * 0.72 + root - aMot.w * 0.32 + gf * 0.12 );
		p = mix( p, q, w ); n = normalize( mix( n, qn, w ) );
	}
	if ( part > 1.5 && part < 2.5 ) hRotZ( p, n, vec3( 0.0, 0.7, -0.72 ), sin( uTime * 9.0 + seed ) * 0.45 * ( 0.35 + aMot.w ) );
	p.y += amp * 0.07 * sin( 2.0 * PI2 * ph );
	hRotX( p, n, vec3( 0.0, 0.55, 0.0 ), gf * 0.1 * sin( PI2 * ph ) );
	if ( aSt.x > 0.0 ) hRotZ( p, n, vec3( 0.25, 0.0, 0.0 ), -aSt.x * 1.45 );   // падает на бок
}`;
// aMot: фаза взмаха, размах взмаха (рад), сложены 0..1, клюёт 0..1; aSt: полнота тела, растворение, вид, вспышка
const BIRD_VERT = `
void hDeform( inout vec3 p, inout vec3 n ) {
	float part = aPart, fat = aSt.x > 0.0 ? aSt.x : 1.0;
	if ( part < 0.5 || part > 4.5 ) {
		if ( part < 0.5 ) p.xy *= mix( fat, 1.0, smoothstep( 0.08, 0.15, p.z ) );   // толстое тело (гусь), шея и голова — как были
		if ( p.z > 0.12 ) { p.z += ( fat - 1.0 ) * 0.12; p.y += ( fat - 1.0 ) * 0.03; }   // и шея длиннее
		if ( p.z > 0.12 ) { p.y -= aMot.w * 0.06; p.z += aMot.w * 0.02; }
		return;
	}
	float side = part < 2.5 ? 1.0 : -1.0, outer = mod( part, 2.0 ) < 0.5 ? 1.0 : 0.0;
	float t = PI2 * aMot.x, fold = aMot.z;
	p.x = side * 0.04 + ( p.x - side * 0.04 ) * ( 1.0 - 0.8 * fold );
	p.z -= fold * abs( p.x ) * 0.6; p.y += fold * 0.02;
	if ( outer > 0.5 ) hRotZ( p, n, vec3( side * 0.25 * ( 1.0 - 0.8 * fold ), 0.02, 0.0 ), side * aMot.y * 0.7 * sin( t - 0.9 ) );
	hRotZ( p, n, vec3( side * 0.04, 0.02, 0.0 ), side * ( aMot.y * sin( t ) + 0.1 * ( 1.0 - fold ) ) );
}`;

// Материал зверя: вершинная поза, растворение сеткой, окрас (полосы поросят, клюв и голова птиц), вспышка попадания
function animalMaterial(THREE, kind, uniforms) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: kind === 'boar' ? 0.95 : 0.75, metalness: 0,
    side: kind === 'bird' ? THREE.DoubleSide : THREE.FrontSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_GLSL}\n${ROT_GLSL}\n${kind === 'boar' ? BOAR_VERT : BIRD_VERT}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n\tvec3 hP = position; hDeform( hP, objectNormal );\n\tvHObj = hP; vHPart = aPart; vHSt = aSt;')
      .replace('#include <begin_vertex>', 'vec3 transformed = hP;');
    const paint = kind === 'boar' ? `
	if ( vHSt.z > 0.5 && vHPart < 1.5 && vHObj.y > 0.44 && vHObj.z > -0.6 && vHObj.z < 0.5 ) {   // полосатые warchlaki
		float st = smoothstep( 0.3, 0.7, 0.5 + 0.5 * sin( vHObj.y * 52.0 ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.42, 0.3, 0.17 ), st * 0.75 );
	}` : `
	if ( vHPart > 4.5 ) diffuseColor.rgb = vHSt.z < 0.5 ? vec3( 0.05 ) : vHSt.z < 1.5 ? vec3( 0.01 ) : vHSt.z < 2.5 ? vec3( 0.75, 0.55, 0.06 ) : vec3( 0.8, 0.35, 0.08 );
	else if ( vHSt.z > 1.5 && vHSt.z < 2.5 && vHObj.z > 0.13 && vHPart < 0.5 ) diffuseColor.rgb = vec3( 0.02, 0.16, 0.06 );   // селезень
	else if ( vHSt.z < 0.5 && vHObj.z > 0.1 && vHObj.z < 0.17 && vHPart < 0.5 ) diffuseColor.rgb *= vec3( 0.75, 0.95, 0.85 );   // шея голубя`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHObj; varying float vHPart; varying vec4 vHSt;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	if ( vHSt.y > 0.0 && fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) < vHSt.y ) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>${paint}
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0, 0.92, 0.85 ), vHSt.w * 0.7 );`);
  };
  m.customProgramCacheKey = () => `hunt-${kind}-packed1`;
  return m;
}

// Пропуск в зондах переотражений (куб 90°) и в проходе нормалей GTAO: там поза не применяется, зверям там делать нечего
function skipInPasses(mesh) {
  let saved = null;
  mesh.onBeforeRender = (r, s, cam, geo, mat) => {
    if (!(cam.isPerspectiveCamera && cam.fov === 90 && cam.aspect === 1) && !mat.isMeshNormalMaterial && !mat.isMeshDepthMaterial) return;
    saved = mesh.count; mesh.count = 0;
  };
  mesh.onAfterRender = () => { if (saved !== null) { mesh.count = saved; saved = null; } };
}

// R = Ry(yaw) · Rx(pitch) · Rz(roll) · s, сдвиг (x, y, z) -> 16 чисел матрицы экземпляра (по столбцам). Нос модели +Z.
function writeMatrix(e, o, x, y, z, yaw, pitch, roll, s) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  e[o] = (cy * cr + sy * sp * sr) * s; e[o + 1] = cp * sr * s; e[o + 2] = (-sy * cr + cy * sp * sr) * s; e[o + 3] = 0;
  e[o + 4] = (-cy * sr + sy * sp * cr) * s; e[o + 5] = cp * cr * s; e[o + 6] = (sy * sr + cy * sp * cr) * s; e[o + 7] = 0;
  e[o + 8] = sy * cp * s; e[o + 9] = -sp * s; e[o + 10] = cy * cp * s; e[o + 11] = 0;
  e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
}

// Луч (o + t·d, |d| = 1) против сферы и капсулы -> t или −1
// ---------- угодья: поле и луг под балконом, газоны справа (site.json) ----------

// ---------- охота ----------

export function createHunt({ THREE, scene, camera, renderer, pipe, requestRender, getState, getWalk, plan = null, site = null }) {
  const canvas = renderer.domElement;
  const root = new THREE.Group();
  root.name = 'hunt';
  root.userData.rasterOnly = true;   // GLB и фото — без зверей
  root.visible = false;
  scene.add(root);
  let S = null, region = null, regions = [], home = [0, 0], ground = 0, ready = false, disposed = false;
  let enabled = shared.pref.on !== false, capturing = false;
  const uniforms = { uTime: { value: 0 }, uHip: { value: HIPS.map(h => new THREE.Vector3(...h)) } };

  // --- состояние зверей (пулы, без выделений в кадре)
  const boars = [], groups = [], birds = [], flocks = [];
  let network = false, networkSnapshot = null, previousEnabled = enabled;
  const networkTargets = new Map(), networkFlock = { kind: 'local' };
  let localWildlife = null;
  let encounters = null, encounterView = null;
  const encounterSurface = { albedo: new THREE.Color('#8c9795'), metal: true, solid: true, flesh: false };
  const eventSight = new THREE.Raycaster(), sightDirection = new THREE.Vector3(), sightCache = new Map(), sightObjects = [], sightHits = [];
  eventSight.layers.enable(1); // Cutaway walls still occlude game information.
  let sightClock = 0, sightObjectsAt = -1;
  function canSeeEncounter(point, id) {
    // An apartment camera must look through a real opening, even in cutaway mode.
    if (inFlat(camera.position) && !throughOpening(camera.position, point)) return false;
    const previous = sightCache.get(id);
    if (previous && sightClock - previous.at < 0.12 && previous.camera.distanceToSquared(camera.position) < 0.04) return previous.visible;
    sightDirection.copy(point).sub(camera.position);
    const distance = sightDirection.length();
    eventSight.set(camera.position, sightDirection.divideScalar(distance || 1)); eventSight.near = 0.03; eventSight.far = distance - 0.2;
    if (sightObjectsAt !== sightClock) { collectFieldOccluders(scene, root, sightObjects); sightObjectsAt = sightClock; }
    const blocked = fieldRayBlocked(eventSight, sightObjects, sightHits);
    sightCache.set(id, { at: sightClock, camera: camera.position.clone(), visible: !blocked });
    while (sightCache.size > 4) sightCache.delete(sightCache.keys().next().value);
    return !blocked;
  }
  let boarMesh = null, blobMesh = null, birdMesh = null;
  let boarMot, boarSt, birdMot, birdSt, boarSeed;
  // Canonical pool colors never alias the compact, camera-dependent GPU slots.
  let boarColors, birdColors;
  const owned = [];   // что освобождать в dispose

  // --- DOM: табло и всплывающие очки
  injectStyle();
  const hud = el('div', 'kh-hud kw-float', document.body,
    '<div class="kh-row"><b>Очки</b></div><div class="kh-score">0</div>');
  hud.hidden = true;
  const scoreValue = hud.querySelector('.kh-score');
  const pops = Array.from({ length: 6 }, () => { const p = el('div', 'kh-pop kw-float', document.body); p.hidden = true; return p; });
  let popI = 0, networkScore = 0, displayedScore = -1;
  const session = { score: 0, kills: 0, boars: 0, birds: 0, targets: 0, shots: 0 };
  let streak = 0, lastKill = -1e9;

  // --- видимость
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), box = new THREE.Box3(), cull = new THREE.Sphere(), samples = Array.from({ length: 9 }, () => new THREE.Vector3());
  let exterior = [], rooms = [], ceiling = 2.64;
  let acc = 0, wasSeen = false, alarm = false, time = 0;
  const offLive = pipe?.onLive?.(live => { capturing = !live; syncVisible(); });

  // --- загрузка: спецификация, план, окружение; затем геометрия и стада
  startup.track(Promise.all([loadSpec(), site || fetch(SITE_URL).then(r => r.json()), plan || fetch(PLAN_URL).then(r => r.json())]).then(([spec, st, pl]) => {
    if (disposed) return;
    S = spec; ground = -st.floorY;
    const bal = pl.balcony;
    home = bal ? [(bal.x0 + bal.x1) / 2, (bal.z0 + bal.z1) / 2] : [0, 0];
    regions = buildRegions(st, S.region, home);
    region = regions.find(r => r.kind === 'field') ?? null;
    if (!region) { console.warn('hunt: на карте нет поля и луга'); return; }
    rooms = Object.entries(pl.rooms).filter(([id]) => id !== 'shaft').flatMap(([, r]) => r.rects);
    ceiling = pl.ceiling ?? ceiling;
    exterior = pl.openings.filter(o => o.type === 'window' || /balcony/.test(o.id));
    build();
    encounters = createFieldEventSimulation({ spec: S, region, ground, seed: Math.floor(Math.random() * 0xffffffff) });
    encounterView = createFieldEventView({ THREE, parent: root, camera, ground, rules: S.events });
    ready = true;
    if (network && networkSnapshot) applyNetworkSnapshot(networkSnapshot);
    syncVisible();
    requestRender?.();
  }), { label: 'Тусовка во дворе' }).catch(err => console.warn('hunt: не загрузилось', err));

  function build() {
    const B = S.boars, nB = B.count + 8;
    const NB = S.birds.pool;
    // кабаны
    const bg = boarGeometry(THREE);
    boarMot = new THREE.InstancedBufferAttribute(new Float32Array(nB * 4), 4); boarMot.setUsage(THREE.DynamicDrawUsage);
    boarSt = new THREE.InstancedBufferAttribute(new Float32Array(nB * 4), 4); boarSt.setUsage(THREE.DynamicDrawUsage);
    boarSeed = new THREE.InstancedBufferAttribute(new Float32Array(nB), 1); boarSeed.setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('aMot', boarMot); bg.setAttribute('aSt', boarSt); bg.setAttribute('aSeed', boarSeed);
    const bm = animalMaterial(THREE, 'boar', uniforms);
    boarMesh = new THREE.InstancedMesh(bg, bm, nB);
    // пятна тени
    const blobTex = radialTexture(THREE);
    const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
    const pmat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, alphaMap: blobTex, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -24 });
    blobMesh = new THREE.InstancedMesh(pg, pmat, nB);
    // птицы
    const wg = birdGeometry(THREE);
    birdMot = new THREE.InstancedBufferAttribute(new Float32Array(NB * 4), 4); birdMot.setUsage(THREE.DynamicDrawUsage);
    birdSt = new THREE.InstancedBufferAttribute(new Float32Array(NB * 4), 4); birdSt.setUsage(THREE.DynamicDrawUsage);
    wg.setAttribute('aMot', birdMot); wg.setAttribute('aSt', birdSt);
    birdMesh = new THREE.InstancedMesh(wg, animalMaterial(THREE, 'bird', uniforms), NB);
    for (const m of [boarMesh, blobMesh, birdMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;            // видимость решает seen(); шейдер готов с первого кадра
      m.boundingBox = new THREE.Box3();   // пустой: не попадает в габариты сцены
      m.raycast = () => {};               // лучи сцены (клик, следы пуль) зверей не видят — свой raycast()
      m.userData.noPick = true;
      m.instanceMatrix.array.fill(0);
      m.count = 0;
      skipInPasses(m);
      root.add(m);
      owned.push(m.geometry, m.material);
    }
    owned.push(blobTex);
    boarMesh.setColorAt(0, new THREE.Color(1, 1, 1)); birdMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    boarMesh.instanceColor.setUsage(THREE.DynamicDrawUsage); birdMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    boarColors = new Float32Array(nB * 3).fill(1); birdColors = new Float32Array(NB * 3).fill(1);
    // у каждого зверя — короткая история положений (для попаданий с учётом запаздывания глаза и экрана)
    for (let i = 0; i < nB; i++) boars.push({ i, active: false, dead: false, hist: new Float32Array(HIST * 5), histN: 0, histT: -1 });
    for (let i = 0; i < NB; i++) birds.push({ i, active: false, dead: false, hist: new Float32Array(HIST * 5), histN: 0, histT: -1 });
    // стада: группы с вожаком-самкой, поросята при ней; часть — на газонах справа
    let left = B.count;
    while (left > 0) {
      const n = Math.min(left, Math.round(pick(B.group)));
      const reg = herdRegion();
      spawnGroup(reg, n, reg.point(), false);
      left -= n;
    }
    // птицы: местные стаи на поле и в небе над ним
    for (const f of S.birds.flocks) spawnFlock(f.species, Math.round(pick(f.n)));
    passTimer = pick(S.birds.pass.every) * 0.3;
    respawnTimer = pick(B.respawn);
  }

  // ---------- кабаны ----------

  const CALM = 0, ALERT = 1, FLEE = 2;
  let respawnTimer = 0;

  function freeBoar() { for (const b of boars) if (!b.active) return b; return null; }
  // где родиться новому стаду: газонам справа — их доля spec.region.city.share, остальное — поле
  function herdRegion() {
    const balcony = regions.find(r => r.kind === 'balcony');
    if (balcony) {
      const nearCount = boars.filter(b => b.active && !b.dead && b.group.region === balcony).length;
      if (nearCount < Math.round(S.boars.count * S.region.balcony.share)) return balcony;
    }
    const city = regions.filter(r => r.kind === 'city');
    if (!city.length) return region;
    let inCity = 0;
    for (const b of boars) if (b.active && !b.dead && b.group.region.kind === 'city') inCity++;
    const want = Math.round(S.boars.count * S.region.city.share);
    if (inCity >= want) return region;
    let s = Math.random() * city.reduce((a, r) => a + r.area, 0);
    for (const r of city) if ((s -= r.area) <= 0) return r;
    return city[0];
  }
  function spawnGroup(reg, n, [x, z], walkIn) {
    const g = { region: reg, leader: null, members: [], tx: x, tz: z, wait: 0 };
    const piglets = Math.random() < S.boars.piglets && n >= 3;
    for (let k = 0; k < n; k++) {
      const b = freeBoar(); if (!b) break;
      const pig = piglets && k > 0 && k < n - (n > 4 ? 1 : 0);
      const [px, pz] = reg.point({ near: [x, z], r: 6 });
      Object.assign(b, {
        active: true, dead: false, group: g, pig, x: px, z: pz, yaw: rand(0, TAU), speed: 0, want: 0, turn: 0,
        mode: CALM, t: 0, hp: pig ? S.boars.hp.piglet : S.boars.hp.adult,
        scale: pig ? pick(S.boars.size.piglet) : pick(S.boars.size.adult),
        phase: Math.random(), gait: 0, graze: 0, alert: 0, fall: 0, fade: 1, flash: 0, deadT: 0, born: true,
        grazeT: rand(2, 8), zig: 1, zigT: 0, react: -1, tx: 0, tz: 0, ox: rand(-4, 4), oz: rand(-5, 1), seen: 0, histN: 0, histT: -1,
      });
      if (pig) { b.ox *= 0.4; b.oz = rand(-2.5, -0.8); }
      const c = pig ? [1.9 * rand(0.95, 1.05), 1.45, 1.0] : [rand(0.85, 1.18), rand(0.85, 1.12), rand(0.82, 1.1)];
      boarColors.set(c, b.i * 3);
      g.members.push(b);
      if (!g.leader && !pig) g.leader = b;
    }
    if (!g.members.length) return;
    g.leader ??= g.members[0];
    if (walkIn) { const [hx, hz] = reg.point(); g.tx = hx; g.tz = hz; g.wait = 0; }
    if (reg.kind === 'balcony') pickTarget(g, g.leader);
    groups.push(g);
  }

  function alertBoar(b, x, z, t) { if (b.mode === CALM) { b.mode = ALERT; b.t = t; } b.tx = x; b.tz = z; }
  function fleeBoar(b, x, z, delay = 0, gallop = true) {
    if (b.dead) return;
    alarm = true;
    b.tx = x; b.tz = z; b.wantGallop = gallop || b.mode === FLEE;
    if (b.mode === FLEE) { b.t = Math.max(b.t, pick(S.boars.trotTime) + pick(S.boars.gallopTime) * 0.6); b.gallop = Math.max(b.gallop, pick(S.boars.gallopTime) * 0.7); return; }
    if (b.react < 0 || b.react > delay) b.react = delay;
  }
  function startFlee(b) {
    b.react = -1;
    if (b.dead) return;
    b.mode = FLEE; b.gallop = b.wantGallop ? pick(S.boars.gallopTime) : 0; b.t = b.gallop + pick(S.boars.trotTime); b.zigT = 0;
    for (const m of b.group.members) if (m !== b && !m.dead && m.mode !== FLEE) fleeBoar(m, b.tx, b.tz, rand(0.12, 0.5), b.wantGallop);
  }

  // желаемое направление -> поворот с ограничением, обход края угодья, скорость
  function steerBoar(b, dx, dz, want, turnRate, dt) {
    const reg = b.group.region;
    if (dx || dz) {
      let yaw = Math.atan2(dx, dz);
      const look = 3 + b.speed * 0.7;
      if (!reg.safe(b.x + Math.sin(yaw) * look, b.z + Math.cos(yaw) * look, 1)) {
        let found = false;
        for (let k = 2; k <= 13 && !found; k++) {
          const y = yaw + (k & 1 ? -1 : 1) * (k >> 1) * 0.5;
          if (reg.safe(b.x + Math.sin(y) * look, b.z + Math.cos(y) * look, 1)) { yaw = y; found = true; }
        }
        if (!found) yaw += Math.PI;
      }
      const d = angDiff(b.yaw, yaw), step = turnRate * dt;
      b.turn = clamp(d, -step, step); b.yaw += b.turn;
    } else b.turn = 0;
    const acc = want > b.speed ? (want > 5 ? 14 : 3) : 8;
    b.speed += clamp(want - b.speed, -acc * dt, acc * dt);
    const nx = b.x + Math.sin(b.yaw) * b.speed * dt, nz = b.z + Math.cos(b.yaw) * b.speed * dt;
    if (reg.inside(nx, nz)) { b.x = nx; b.z = nz; } else b.speed *= 0.5;
  }

  function stepBoars(dt, cam, walk) {
    const B = S.boars, nearMax = S.region.near[1];
    // центры групп для сплочённости при бегстве
    for (const g of groups) {
      g.cx = 0; g.cz = 0; g.n = 0;
      for (const m of g.members) if (!m.dead) { g.cx += m.x; g.cz += m.z; g.n++; }
      if (g.n) { g.cx /= g.n; g.cz /= g.n; }
      if (g.leader.dead) g.leader = g.members.find(m => !m.dead && !m.pig) || g.members.find(m => !m.dead) || g.leader;
    }
    const sightOn = walk?.active && walk.moving;
    for (const b of boars) {
      if (!b.active) continue;
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 5);
      if (b.dead) { stepDead(b, dt, B); continue; }
      if (b.born) { b.fade = Math.max(0, b.fade - dt / B.fadeTime); if (!b.fade) b.born = false; }   // появляется из ряби, а не вдруг
      if (b.react >= 0) { b.react -= dt; if (b.react < 0) startFlee(b); }
      const g = b.group, lead = g.leader;
      let dx = 0, dz = 0, want = 0, turn = 1.6, graze = 0, alert = 0;
      if (b.mode === CALM) {
        // зрение: человек движется на балконе близко — уходят
        if (sightOn) {
          const d = Math.hypot(b.x - cam.x, b.z - cam.z);
          if (d < B.sight) { b.seen += dt; if (b.seen > 0.6) { fleeBoar(b, cam.x, cam.z, 0, false); b.seen = 0; } }
          else b.seen = 0;
        }
        if (b === lead) {
          const d = Math.hypot(g.tx - b.x, g.tz - b.z);
          if (g.wait > 0) { g.wait -= dt; graze = 1; if (g.wait <= 0) pickTarget(g, b); }
          else if (d < 2) g.wait = g.region.kind === 'balcony' ? pick(S.region.balcony.roam.wait) : rand(6, 18);
          else { dx = g.tx - b.x; dz = g.tz - b.z; want = g.jog ? S.region.balcony.roam.jogSpeed : d > 50 ? B.speed.walk * 2.2 : B.speed.walk; }
        } else {
          // за вожаком со своим смещением (в осях вожака)
          const c = Math.cos(lead.yaw), s = Math.sin(lead.yaw);
          const px = lead.x + b.ox * c + b.oz * s, pz = lead.z - b.ox * s + b.oz * c;
          const d = Math.hypot(px - b.x, pz - b.z);
          b.grazeT -= dt;
          if (d > (b.pig ? 1.5 : 3)) { dx = px - b.x; dz = pz - b.z; want = d > 10 ? B.speed.trot * 0.8 : B.speed.walk * (b.pig ? 1.4 : 1.1); }
          else if (b.grazeT < 0) { b.grazeT = rand(3, 9); b.ox += rand(-1.5, 1.5); b.oz += rand(-1.5, 1.5); b.ox = clamp(b.ox, -5, 5); b.oz = clamp(b.oz, -6, 2); }
          else graze = 1;
        }
      } else if (b.mode === ALERT) {
        b.t -= dt; alert = 1;
        dx = b.tx - b.x; dz = b.tz - b.z; turn = 2.5;   // морду к шуму
        if (b.t <= 0) b.mode = CALM;
      } else {
        b.t -= dt; b.gallop -= dt; alert = 1; turn = 4.5;
        // от угрозы, держась своих, зигзагами; уже далеко от балкона — вбок, а не дальше (их должно быть видно)
        let ax = b.x - b.tx, az = b.z - b.tz; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
        dx = ax; dz = az;
        const rx = b.x - home[0], rz = b.z - home[1], rl = Math.hypot(rx, rz) || 1;
        if (rl > nearMax * 0.8) {
          const out = (dx * rx + dz * rz) / rl;
          if (out > 0) { dx -= rx / rl * out * 1.2; dz -= rz / rl * out * 1.2; }
          if (Math.hypot(dx, dz) < 0.3) { dx += -rz / rl * b.zig; dz += rx / rl * b.zig; }
        }
        if (g.n > 1) { const cx = g.cx - b.x, cz = g.cz - b.z, cl = Math.hypot(cx, cz); if (cl > 4) { dx += cx / cl * 0.45; dz += cz / cl * 0.45; } }
        if (b.gallop > 0) {
          b.zigT -= dt;
          if (b.zigT <= 0) { b.zig = -b.zig; b.zigT = rand(0.45, 1.1); }
          const a = b.zig * 0.6, c = Math.cos(a), s = Math.sin(a);
          const qx = dx * c + dz * s, qz = -dx * s + dz * c; dx = qx; dz = qz;
          want = b.pig ? B.speed.pigletGallop : B.speed.gallop * (0.85 + 0.15 * Math.sin(b.i));
        } else want = B.speed.trot;
        // бег кончился — стадо сбивается в кучу у вожака и скоро снова пасётся
        if (b.t <= 0) { b.mode = CALM; if (b === lead) { g.tx = b.x; g.tz = b.z; g.wait = pick(B.regroup); } }
      }
      steerBoar(b, dx, dz, want, turn, dt);
      // поза
      const v = b.speed, gait = v < 0.05 ? 0 : v < 1.4 ? v / 1.4 : v < 5 ? 1 + (v - 1.4) / 3.6 : 2 + Math.min(1, (v - 5) / 4);
      b.gait = gait;
      const stride = gait < 1 ? 0.9 : gait < 2 ? 0.9 + 0.5 * (gait - 1) : 1.4 + 1.4 * (gait - 2);
      b.phase = (b.phase + v / (stride * b.scale) * dt) % 1;
      b.graze += ((graze && v < 0.3 ? 1 : 0) - b.graze) * Math.min(1, dt * 2.5);
      b.alert += (alert - b.alert) * Math.min(1, dt * 4);
    }
    // расталкивание: не стоять друг в друге
    for (let i = 0; i < boars.length; i++) {
      const a = boars[i]; if (!a.active || a.dead) continue;
      for (let j = i + 1; j < boars.length; j++) {
        const b = boars[j]; if (!b.active || b.dead || b.group.region !== a.group.region) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, r = 0.75 * (a.scale + b.scale);
        if (d2 > r * r || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (r - d) * 0.5 / d;
        const ax = a.x - dx * push, az = a.z - dz * push, bx = b.x + dx * push, bz = b.z + dz * push;
        if (a.group.region.inside(ax, az)) { a.x = ax; a.z = az; }
        if (b.group.region.inside(bx, bz)) { b.x = bx; b.z = bz; }
      }
    }
    // пополнение стада: с дальнего края угодья
    let alive = 0;
    for (const b of boars) if (b.active && !b.dead) alive++;
    if (alive < B.count) {
      respawnTimer -= dt;
      if (respawnTimer <= 0) {
        respawnTimer = pick(B.respawn);
        const reg = herdRegion();
        spawnGroup(reg, Math.min(B.count - alive, Math.round(pick(B.group))), reg.point({ far: true }), true);
      }
    }
    for (let i = groups.length - 1; i >= 0; i--) if (!groups[i].members.length) groups.splice(i, 1);
  }
  // куда идти пастись: рядом (до 35 м), с весом к основной полосе расстояний; ушли далеко — назад, ближе к балкону
  function pickTarget(g, lead) {
    const far = g.region.dist(lead.x, lead.z) > S.region.near[1];
    const roam = g.region.kind === 'balcony' ? S.region.balcony.roam : null;
    const [x, z] = far ? g.region.point() : g.region.point({ near: [lead.x, lead.z], r: roam?.radius ?? 35 });
    g.tx = x; g.tz = z; g.jog = !!roam && Math.random() < roam.jogChance;
  }
  function stepDead(b, dt, B) {
    b.deadT += dt; b.speed = 0; b.gait = 0; b.alert = 0;
    b.fall = Math.min(1, b.fall + dt * 2.6);
    b.phase = (b.phase + dt * Math.max(0, 1.2 - b.deadT) * 2) % 1;   // пара судорожных взмахов ногами — и тишина
    b.gait = Math.max(0, 1.2 - b.deadT) * 0.8;
    if (b.deadT > B.corpse) b.fade = Math.min(1, (b.deadT - B.corpse) / B.fadeTime);
    if (b.fade >= 1) { b.active = false; b.dead = false; const g = b.group; const k = g.members.indexOf(b); if (k >= 0) g.members.splice(k, 1); }
  }

  // ---------- птицы ----------

  let passTimer = 0;
  function freeBird() { for (const b of birds) if (!b.active && b.f?.kind !== 'local') return b; return null; }   // у местных стай свои места
  function spawnFlock(sp, n, pass = null) {
    const f = { sp, kind: pass ? 'pass' : 'local', members: [], mode: 'ground', t: rand(10, 40), cx: 0, cz: 0, alt: 0, ang: 0, R: 0, lx: 0, lz: 0, n,
      px: 0, py: 0, pz: 0, dx: 0, dz: 0, travelled: 0, panic: 0, respawn: 0 };
    const spec = S.species[sp];
    if (pass) Object.assign(f, pass, { mode: 'pass' });
    else { const [x, z] = region.point(); f.lx = x; f.lz = z; f.cx = x; f.cz = z; }
    for (let k = 0; k < n; k++) {
      const b = freeBird(); if (!b) break;
      initBird(b, f, k, spec);
      f.members.push(b);
    }
    flocks.push(f);
    return f;
  }
  function initBird(b, f, k, spec) {
    const perch = f.mode === 'ground';
    Object.assign(b, {
      active: true, dead: false, f, sp: f.sp, kind: BIRD_KINDS.indexOf(f.sp), k, scale: spec.span * rand(0.92, 1.08),
      x: f.lx + rand(-4, 4), y: perch ? ground : f.kind === 'pass' ? f.py : ground + 20, z: f.lz + rand(-4, 4), vx: 0, vy: 0, vz: 0, yaw: rand(0, TAU), pitch: 0, roll: 0,
      mode: perch ? 'perch' : 'fly', phase: Math.random(), amp: 0, fold: perch ? 1 : 0, peck: 0, peckT: rand(0.5, 3), glide: 0,
      off: k / Math.max(1, f.n) * TAU + rand(-0.3, 0.3), offR: rand(0.7, 1.3), offY: rand(-3, 3), delay: 0, fade: 0, flash: 0, deadT: 0,
      lsx: rand(-4, 4) * Math.max(1, spec.span), lsz: rand(-4, 4) * Math.max(1, spec.span), fat: spec.fat ?? 1, histN: 0, histT: -1,
    });
    if (f.kind === 'local' && !region.inside(b.x, b.z)) { b.x = f.lx; b.z = f.lz; }
    const c = lin(spec.color).map(v => v / BIRD_BASE);   // цвет вершин тела -> оперение вида
    birdColors.set([c[0] * rand(0.9, 1.1), c[1] * rand(0.9, 1.1), c[2] * rand(0.9, 1.1)], b.i * 3);
  }
  function spawnPass() {
    const P = S.birds.pass, sp = P.species[Math.floor(Math.random() * P.species.length)];
    // низкий ленивый клин поперёк вида с балкона: заходит сбоку за P.from метров и уходит на столько же за другой край
    const side = Math.random() < 0.5 ? -1 : 1, z = home[1] - pick(P.dist), y = ground + pick(P.alt), ang = rand(-0.2, 0.2);
    const dx = -side * Math.cos(ang), dz = Math.sin(ang), x = home[0] + side * P.from;
    spawnFlock(sp, Math.round(pick(P.n)), { px: x, py: y, pz: z, dx, dz, travelled: 0, lx: x, lz: z });
  }
  function takeOff(f, tx, tz) {
    if (f.kind !== 'local') return;
    f.mode = 'circle'; f.t = rand(15, 35);
    const B = S.birds;
    let cx, cz;
    if (tx != null) {   // прочь от выстрела
      const ax = f.lx - tx, az = f.lz - tz, l = Math.hypot(ax, az) || 1;
      [cx, cz] = region.point({ near: [f.lx + ax / l * rand(30, 70), f.lz + az / l * rand(30, 70)], r: 40 });
    } else [cx, cz] = region.point();
    const spec = S.species[f.sp];
    f.cx = cx; f.cz = cz; f.alt = pick(spec.alt ?? B.alt); f.R = rand(18, 40) * Math.max(1, spec.span * 0.8); f.ang = Math.random() * TAU; f.angV = spec.speed * 0.75 / f.R * (Math.random() < 0.5 ? 1 : -1);
    for (const b of f.members) if (!b.dead && b.mode !== 'fly') {
      b.mode = 'fly'; b.delay = rand(0, 0.35); b.vy = rand(2.5, 4.5);
      if (tx != null) { const ax = b.x - tx, az = b.z - tz, l = Math.hypot(ax, az) || 1; b.vx = ax / l * 4; b.vz = az / l * 4; }
    }
  }
  function stepBirds(dt) {
    const B = S.birds;
    passTimer -= dt;
    if (passTimer <= 0) { passTimer = pick(B.pass.every); if (freeCount(birds) >= B.pass.n[1]) spawnPass(); }
    for (const f of flocks) {
      const spec = S.species[f.sp];
      if (f.kind === 'local') {
        f.t -= dt;
        if (f.mode === 'ground' && f.t <= 0) takeOff(f);
        else if (f.mode === 'circle') {
          f.ang += f.angV * dt;
          if (f.t <= 0) { f.mode = 'land'; const [x, z] = region.point({ near: [f.cx, f.cz], r: 60 }); f.lx = x; f.lz = z; f.t = 40; }
        } else if (f.mode === 'land') {
          let all = true; for (const b of f.members) if (!b.dead && b.mode !== 'perch') all = false;
          if (all || f.t <= 0) { f.mode = 'ground'; f.t = rand(20, 55); }
        }
        // пополнение стаи: прилетают издалека
        let alive = 0; for (const b of f.members) if (!b.dead) alive++;
        if (alive < f.n) {
          f.respawn -= dt;
          if (f.respawn <= 0) {
            f.respawn = pick(B.respawn);
            const b = f.members.find(m => !m.active) || freeBird();
            if (b) {
              if (!f.members.includes(b)) f.members.push(b);
              initBird(b, f, f.members.indexOf(b), spec);
              const a = rand(0, TAU); b.x = f.cx + Math.cos(a) * 250; b.z = f.cz + Math.sin(a) * 250; b.y = ground + 45; b.mode = 'fly'; b.fold = 0;
              if (f.mode === 'ground') b.mode = 'land';
            }
          }
        }
      } else {
        const sp = spec.speed * (f.panic > 0 ? 1.35 : 1);
        f.panic = Math.max(0, f.panic - dt);
        f.px += f.dx * sp * dt; f.pz += f.dz * sp * dt; f.travelled += sp * dt;
        if (f.panic > 0) f.py = Math.min(f.py + 3 * dt, ground + B.pass.alt[1] + 15);   // испуг — набирают высоту
      }
    }
    // птицы
    for (const b of birds) {
      if (!b.active) continue;
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 5);
      const f = b.f, spec = S.species[b.sp];
      if (b.dead) {
        if (b.y > ground + 0.04) {
          b.vy -= 9.8 * dt; b.vx *= 1 - dt * 0.6; b.vz *= 1 - dt * 0.6;
          b.x += b.vx * dt; b.y = Math.max(ground + 0.04, b.y + b.vy * dt); b.z += b.vz * dt;
          b.roll += dt * 9; b.pitch += dt * 5; b.amp = 0.4; b.phase = (b.phase + dt * 6) % 1;
        } else { b.amp = 0; b.fold = 0.4; b.roll = 1.4; b.pitch = 0; b.deadT += dt; }
        if (b.deadT > B.corpse) b.fade = Math.min(1, (b.deadT - B.corpse) / B.fadeTime);
        if (b.fade >= 1) { b.active = false; if (f.kind === 'pass') { const k = f.members.indexOf(b); if (k >= 0) f.members.splice(k, 1); } }
        continue;
      }
      if (b.delay > 0) { b.delay -= dt; continue; }
      if (b.mode === 'perch') {
        b.fold = Math.min(1, b.fold + dt * 3); b.amp = 0; b.y = ground; b.pitch = 0; b.roll = 0;
        b.peckT -= dt;
        if (b.peckT <= 0) { b.peckT = rand(0.6, 3.5); if (Math.random() < 0.3) b.yaw += rand(-1.2, 1.2); }
        b.peck = b.peckT < 0.35 ? Math.sin(b.peckT / 0.35 * Math.PI) : 0;
        if (f.kind === 'local' && f.mode === 'circle') { b.mode = 'fly'; b.vy = rand(2.5, 4); }
        continue;
      }
      // цель полёта
      let tx, ty, tz, arrive = false;
      if (f.kind === 'pass') {
        const rank = Math.ceil(b.k / 2), side = b.k % 2 ? 1 : -1, jit = f.panic > 0 ? 3 : 0, sp = spec.span;
        // клин: каждый следующий — назад и вбок от направляющего, шаг по размаху крыльев
        tx = f.px - f.dx * rank * 1.5 * sp + -f.dz * side * rank * 1.05 * sp + Math.sin(time * 1.3 + b.k) * jit;
        tz = f.pz - f.dz * rank * 1.5 * sp + f.dx * side * rank * 1.05 * sp + Math.cos(time * 1.1 + b.k) * jit;
        ty = f.py + Math.sin(time * 0.7 + b.k) * 0.4;
        if (f.travelled > 2 * B.pass.from) { b.active = false; const k = f.members.indexOf(b); if (k >= 0) f.members.splice(k, 1); continue; }
      } else if (f.mode === 'circle') {
        const a = f.ang + b.off;
        tx = f.cx + Math.cos(a) * f.R * b.offR; tz = f.cz + Math.sin(a) * f.R * b.offR; ty = ground + f.alt + b.offY;
      } else {
        tx = f.lx + b.lsx; tz = f.lz + b.lsz; ty = ground; arrive = true; b.mode = 'land';
      }
      // рулёжка: к цели, расталкивание соседей по стае
      let dx = tx - b.x, dy = ty - b.y, dz = tz - b.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      let sp = spec.speed * (f.kind === 'pass' ? (f.panic > 0 ? 1.35 : 1) * clamp(d / 6, 0.85, 1.25) : 1);
      if (arrive) sp = Math.min(sp, Math.max(1.2, d * 0.9));
      let wx = dx / d * sp, wy = dy / d * sp, wz = dz / d * sp;
      const sep = Math.max(2.2, spec.span * spec.span);
      for (const o of f.members) {
        if (o === b || o.dead || !o.active) continue;
        const ox = b.x - o.x, oy = b.y - o.y, oz = b.z - o.z, q = ox * ox + oy * oy + oz * oz;
        if (q < sep && q > 1e-4) { const k = (sep - q) * 1.5 / sep * 2.2; wx += ox * k; wy += oy * k; wz += oz * k; }
      }
      const k = Math.min(1, dt * (arrive ? 2.2 : 1.6));
      const pvx = b.vx, pvz = b.vz;
      b.vx += (wx - b.vx) * k; b.vy += (wy - b.vy) * k; b.vz += (wz - b.vz) * k;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < ground) b.y = ground;
      const h = Math.hypot(b.vx, b.vz);
      if (h > 0.3) {
        const yaw = Math.atan2(b.vx, b.vz), turnRate = angDiff(Math.atan2(pvx, pvz), yaw) / Math.max(dt, 1e-3);
        b.yaw = yaw; b.roll += (clamp(-turnRate * 0.35, -0.8, 0.8) - b.roll) * Math.min(1, dt * 4);
      }
      b.pitch = clamp(-Math.atan2(b.vy, Math.max(h, 0.5)), -0.6, 0.6);
      // взмахи: при наборе высоты и на малой скорости чаще, иногда планирует
      b.glide -= dt;
      if (b.glide < -rand(1.5, 4)) b.glide = rand(0.6, 2.2);
      const climb = b.vy > 0.6 || arrive || h < spec.speed * 0.7;
      const ampT = climb || b.glide <= 0 || b.sp === 'pigeon' && !arrive && b.glide <= 0.3 ? 0.85 : 0.08;
      b.amp += (ampT - b.amp) * Math.min(1, dt * 5);
      b.phase = (b.phase + spec.flap * (climb ? 1.25 : 1) * dt) % 1;
      b.fold = Math.max(0, b.fold - dt * 3);
      if (arrive && b.y <= ground + 0.15 && Math.hypot(dx, dz) < 1.2) { b.mode = 'perch'; b.vx = b.vy = b.vz = 0; b.y = ground; }
    }
    for (let i = flocks.length - 1; i >= 0; i--) {
      const f = flocks[i];
      if (f.kind === 'pass' && !f.members.length) flocks.splice(i, 1);
    }
  }
  const freeCount = list => { let n = 0; for (const b of list) if (!b.active) n++; return n; };

  // ---------- запись в буферы ----------

  function writeBuffers() {
    const E = boarMesh.instanceMatrix.array, L = blobMesh.instanceMatrix.array, M = boarMot.array, T = boarSt.array;
    const C = boarMesh.instanceColor.array, seeds = boarSeed.array;
    let boarCount = 0, birdCount = 0;
    box.makeEmpty();
    for (const b of boars) {
      if (!b.active) continue;
      expand(b.x, ground, b.z, 1.2 * b.scale);
      // Pack only visible actors: a zero matrix still executes every vertex.
      cull.center.set(b.x, ground + 0.6 * b.scale, b.z); cull.radius = 1.2 * b.scale;
      if (!frustum.intersectsSphere(cull)) continue;
      const slot = boarCount++, o = slot * 16, q = slot * 4, color = slot * 3, palette = b.i * 3;
      writeMatrix(E, o, b.x, ground, b.z, b.yaw, 0, 0, b.scale);
      const bs = b.scale * (1 - b.fade);
      writeMatrix(L, o, b.x, ground + 0.02, b.z, b.yaw, 0, 0, 1);
      L[o] *= bs * 0.75; L[o + 2] *= bs * 0.75; L[o + 8] *= bs * 1.55; L[o + 10] *= bs * 1.55;
      M[q] = b.phase; M[q + 1] = b.gait; M[q + 2] = b.graze; M[q + 3] = b.alert;
      T[q] = b.fall; T[q + 1] = b.fade; T[q + 2] = b.pig ? 1 : 0; T[q + 3] = b.flash;
      C[color] = boarColors[palette]; C[color + 1] = boarColors[palette + 1]; C[color + 2] = boarColors[palette + 2];
      seeds[slot] = b.i; // Shader phase stays tied to the canonical animal, not the packed slot.
    }
    const W = birdMesh.instanceMatrix.array, BM = birdMot.array, BS = birdSt.array, BC = birdMesh.instanceColor.array;
    for (const b of birds) {
      if (!b.active) continue;
      if (b.f.kind === 'local' || Math.abs(b.x - home[0]) < 250) expand(b.x, b.y, b.z, b.scale);
      cull.center.set(b.x, b.y, b.z); cull.radius = b.scale;
      if (!frustum.intersectsSphere(cull)) continue;
      const slot = birdCount++, o = slot * 16, q = slot * 4, color = slot * 3, palette = b.i * 3;
      writeMatrix(W, o, b.x, b.y + (b.mode === 'perch' ? 0.07 * b.scale : 0), b.z, b.yaw, b.pitch, b.roll, b.scale);
      BM[q] = b.phase; BM[q + 1] = b.amp; BM[q + 2] = b.fold; BM[q + 3] = b.peck;
      BS[q] = b.fat; BS[q + 1] = b.fade; BS[q + 2] = b.kind; BS[q + 3] = b.flash;
      BC[color] = birdColors[palette]; BC[color + 1] = birdColors[palette + 1]; BC[color + 2] = birdColors[palette + 2];
    }
    boarMesh.count = blobMesh.count = boarCount; birdMesh.count = birdCount;
    boarMesh.instanceMatrix.needsUpdate = blobMesh.instanceMatrix.needsUpdate = birdMesh.instanceMatrix.needsUpdate = true;
    boarMot.needsUpdate = boarSt.needsUpdate = birdMot.needsUpdate = birdSt.needsUpdate = true;
    boarMesh.instanceColor.needsUpdate = birdMesh.instanceColor.needsUpdate = boarSeed.needsUpdate = true;
    uniforms.uTime.value = time;
  }
  function boundsOnly() {   // габарит стада без записи в буферы (пока зверей не видно)
    box.makeEmpty();
    for (const b of boars) if (b.active) expand(b.x, ground, b.z, 1.2 * b.scale);
    for (const b of birds) if (b.active && (b.f.kind === 'local' || Math.abs(b.x - home[0]) < 250)) expand(b.x, b.y, b.z, b.scale);
  }
  function expand(x, y, z, r) {
    const n = box.min, m = box.max;
    if (box.isEmpty()) { n.set(x - r, y - r, z - r); m.set(x + r, y + r, z + r); return; }
    if (x - r < n.x) n.x = x - r; if (y - r < n.y) n.y = y - r; if (z - r < n.z) n.z = z - r;
    if (x + r > m.x) m.x = x + r; if (y + r > m.y) m.y = y + r; if (z + r > m.z) m.z = z + r;
  }

  // ---------- видимость ----------

  function inFlat(p) {
    if (p.y > ceiling) return false;
    for (const r of rooms) if (p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1) return true;
    return false;
  }
  // из квартиры: проходит ли луч камера -> s сквозь окно или балконную дверь
  function throughOpening(c, s) {
    for (const o of exterior) {
      const X = o.along === 'x', plane = X ? (o.z0 + o.z1) / 2 : (o.x0 + o.x1) / 2;
      const a = X ? c.z : c.x, b = X ? s.z : s.x;
      if ((a - plane) * (b - plane) >= 0) continue;
      const t = (plane - a) / (b - a), u = X ? c.x + (s.x - c.x) * t : c.z + (s.z - c.z) * t, y = c.y + (s.y - c.y) * t;
      if (u >= (X ? o.x0 : o.z0) && u <= (X ? o.x1 : o.z1) && y >= (o.sill ?? 0) && y <= o.head) return true;
    }
    return false;
  }
  function seen(walk) {
    if (!root.visible || box.isEmpty()) return false;
    camera.updateMatrixWorld();
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    if (!frustum.intersectsBox(box)) return false;
    const c = camera.position;
    if (!walk?.active || !inFlat(c)) return true;   // облёт (вырез может открыть стену), балкон, площадка
    const n = box.min, m = box.max;
    samples[0].set((n.x + m.x) / 2, (n.y + m.y) / 2, (n.z + m.z) / 2);
    for (let i = 0; i < 8; i++) samples[i + 1].set(i & 1 ? m.x : n.x, i & 2 ? m.y : n.y, i & 4 ? m.z : n.z);
    for (const s of samples) if (throughOpening(c, s)) return true;
    return false;
  }
  function syncVisible() {
    const v = ready && enabled && !pipe?.photo && !capturing;
    if (v === root.visible) return false;
    root.visible = v;
    return true;
  }
  function syncWildlifeVisible(visible) {
    const changed = boarMesh.visible !== visible || birdMesh.visible !== visible;
    boarMesh.visible = blobMesh.visible = birdMesh.visible = visible;
    if (!visible) boarMesh.count = blobMesh.count = birdMesh.count = 0;
    return changed;
  }

  // ---------- кадр ----------

  function update(dt = 1 / 60) {
    if (!ready || disposed) return false;
    sightClock += dt;
    syncHud();
    if (!network && enabled) encounters.step(dt);
    const eventFrame = encounterView.update(network ? networkSnapshot?.encounters : encounters.snapshot(), {
      visible: enabled && !pipe?.photo && !capturing, walking: !!getWalk?.()?.active, dt, network,
      canSee: canSeeEncounter });
    if (network) {
      if (!networkSnapshot) return false;
      const k = 1 - Math.exp(-18 * Math.min(0.1, dt));
      for (const [a, target] of networkTargets) {
        a.x += (target.x - a.x) * k; a.y += (target.y - a.y) * k; a.z += (target.z - a.z) * k;
        a.yaw += Math.atan2(Math.sin(target.yaw - a.yaw), Math.cos(target.yaw - a.yaw)) * k;
        for (const key of ['phase', 'gait', 'graze', 'alert', 'fall', 'fade', 'amp', 'fold', 'peck', 'pitch', 'roll'])
          if (Number.isFinite(target[key])) a[key] += (target[key] - a[key]) * k;
        a.flash = Math.max(0, a.flash - dt * 4);
      }
      time += dt;
      let need = syncVisible();
      boundsOnly();
      const visible = seen(getWalk?.());
      need = syncWildlifeVisible(visible) || need;
      wasSeen = visible;
      // Authority keeps every animal alive. A guest looking at an interior
      // needs no instance uploads or invisible, uncullable wildlife draw calls.
      if (!visible) return need || eventFrame;
      writeBuffers();
      return true;
    }
    const walk = getWalk?.();
    let need = syncVisible();
    if (!enabled) return need;
    time += dt;
    acc += dt;
    const vis = !pipe?.photo && seen(walk);
    need = syncWildlifeVisible(vis) || need;
    if (!vis) {
      wasSeen = false;
      if (acc >= COARSE) { step(acc, walk); acc = 0; boundsOnly(); }
      return need || eventFrame;
    }
    if (!alarm) {
      // покой (пасутся, летят): шаг в кадре, который и так рисуется (камера сдвинулась), иначе редко — в прогулке
      // spec.idleFps и свой кадр, в облёте раз в COARSE и без своего кадра (рендер по требованию)
      const moved = camMoved() || !wasSeen, walking = !!walk?.active;
      if (!moved && acc < (walking ? 1 / S.idleFps : COARSE)) return need || eventFrame;
      step(Math.min(acc, COARSE), walk); acc = 0;
      writeBuffers(); wasSeen = true;
      return need || walking || eventFrame;
    }
    // раунд, бегство, падение подстреленного: плавно (в облёте — не чаще spec.orbitFps)
    if (!walk?.active && wasSeen && acc < 1 / S.orbitFps) return need || eventFrame;
    step(Math.min(acc, 0.1), walk); acc = 0;
    writeBuffers();
    wasSeen = true;
    return true;
  }
  function step(dt, walk) {
    const cam = camera.position;
    for (let t = dt; t > 1e-6; t -= 0.1) { const h = Math.min(0.1, t); stepBoars(h, cam, walk); stepBirds(h); }
    recordAll();
    alarm = busy();
  }
  // кто-то бежит, падает или стая шарахнулась — нужны плавные кадры
  function busy() {
    for (const b of boars) if (b.active && (b.dead ? b.deadT < 1.5 : b.mode === FLEE)) return true;
    for (const b of birds) if (b.active && b.dead && b.y > ground + 0.04) return true;
    for (const f of flocks) if (f.panic > 0) return true;
    return false;
  }
  const lastCam = new Float64Array(16);
  function camMoved() {
    const e = camera.matrixWorld.elements;
    let moved = camera.projectionMatrix.elements[0] !== lastCam[15];
    for (let i = 0; i < 15; i++) if (e[i] !== lastCam[i]) { moved = true; lastCam[i] = e[i]; }
    lastCam[15] = camera.projectionMatrix.elements[0];
    return moved;
  }

  // ---------- выстрел: слух ----------

  function noise(point, loudness = 1) {
    if (network) return;
    if (!ready || !enabled) return;
    session.shots++;
    const B = S.boars, px = point.x, pz = point.z;
    for (const b of boars) {
      if (!b.active || b.dead) continue;
      const d = Math.hypot(b.x - px, b.z - pz);
      if (d < B.panic * loudness) fleeBoar(b, px, pz, 0.05 + d / 340 + Math.random() * 0.25);
      else if (d < B.hear * loudness) { if (b.mode !== CALM) fleeBoar(b, px, pz, rand(0.1, 0.5)); else alertBoar(b, px, pz, rand(1.5, 3)); }
    }
    for (const f of flocks) {
      if (f.kind === 'pass') { if (Math.hypot(f.px - px, f.pz - pz) < 200 * loudness) f.panic = 6; continue; }
      const d = Math.hypot((f.mode === 'circle' ? f.cx : f.lx) - px, (f.mode === 'circle' ? f.cz : f.lz) - pz);
      if (d < S.birds.hear * loudness && f.mode !== 'circle') takeOff(f, px, pz);
      else if (d < S.birds.hear * loudness * 0.6 && f.mode === 'circle') { takeOff(f, px, pz); }
    }
  }

  // ---------- выстрел: попадание ----------
  // Объёмы попадания — по позе, как её рисует шейдер (голова опущена/поднята, бег), в мировых осях зверя, с запасом:
  // части × spec.*.hitPad и ещё spec.hit.perMetre метра на метр дальности (далёкий зверь — пара пикселей). Луч проверяет
  // нынешнее положение и снимки за последние spec.hit.lag с: стрелок жмёт по тому, что видел кадр-два назад.

  const tmpP = new THREE.Vector3();
  let hitZone = null;   // зона последнего попадания в boarPose/birdPose (без выделений на выстрел)
  // Луч (o, d — мир) против кабана в положении (x, z, yaw) -> расстояние или −1; зону пишет в hitZone
  // снимок положения раз в HIST_DT: [x, y, z, yaw, время] × HIST, новый — первым
  function record(a, y) {
    if (time - a.histT < HIST_DT) return;
    a.histT = time;
    const h = a.hist;
    h.copyWithin(5, 0, (HIST - 1) * 5);
    h[0] = a.x; h[1] = y; h[2] = a.z; h[3] = a.yaw; h[4] = time;
    if (a.histN < HIST) a.histN++;
  }
  function recordAll() {
    for (const b of boars) if (b.active && !b.dead) record(b, ground);
    for (const b of birds) if (b.active && !b.dead) record(b, b.y);
  }
  // нынешняя поза, затем снимки не старше lag -> расстояние или −1 (зона — в hitZone)
  function poseHit(a, bird, ox, oy, oz, dx, dy, dz, pad) {
    const test = pose => { const h = rayAnimalPose(a, bird, [ox, oy, oz], [dx, dy, dz], S, ground, pad, pose); hitZone = h?.zone ?? null; return h?.distance ?? -1; };
    let t = test(a);
    if (t >= 0) return t;
    const h = a.hist, lag = S.hit.lag;
    for (let k = 0; k < a.histN; k++) {
      const o = k * 5, age = time - h[o + 4];
      if (age > lag) break;
      if (age < HIST_DT * 0.5) continue;
      t = test({ x: h[o], y: h[o + 1], z: h[o + 2], yaw: h[o + 3] });
      if (t >= 0) return t;
    }
    return -1;
  }
  // ближайшее на луче: звери охоты и чужие мишени (addTargets)
  function raycast(raycaster) {
    let best = raycastAnimals(raycaster);
    if (enabled && !network && encounters) {
      const origin = raycaster.ray.origin.toArray(), direction = raycaster.ray.direction.toArray();
      const hit = encounters.raycast(origin, direction, Number.isFinite(raycaster.far) ? raycaster.far : 800);
      if (hit && (!best || hit.distance < best.distance)) {
        let used = false;
        best = { ...hit, point: new THREE.Vector3(...hit.point), normal: new THREE.Vector3(...hit.normal),
          object: encounterView.root, surface: encounterSurface,
          hit(weapon) {
            if (used || network) return null; used = true;
            const result = encounters.hit({ origin, direction, weapon, range: raycaster.far });
            if (result?.killed) api.award(result.points, new THREE.Vector3(...result.point), result.cargo ? 'Пирог сбит!' : S.events.types[result.species].name);
            else if (result) popup(new THREE.Vector3(...result.point), `${result.hp} / ${result.maxHp}`, 'прочность');
            return result;
          } };
      }
    }
    if (network) return best;
    for (const t of targets) { const h = t.raycast(raycaster); if (h && (!best || h.distance < best.distance)) best = h; }
    return best;
  }
  function raycastAnimals(raycaster) {
    if (!ready || !enabled || !root.visible) return null;
    const r = raycaster.ray, ox = r.origin.x, oy = r.origin.y, oz = r.origin.z;
    const dl = Math.hypot(r.direction.x, r.direction.y, r.direction.z) || 1;
    const dx = r.direction.x / dl, dy = r.direction.y / dl, dz = r.direction.z / dl;
    const near = raycaster.near ?? 0, far = raycaster.far ?? Infinity, lag = S.hit.lag, per = S.hit.perMetre;
    let best = null, bz = null, bt = far;
    for (const b of boars) {
      if (!b.active || b.dead) continue;
      const s = b.scale, cy = ground + 0.55 * s, pad = Math.hypot(b.x - ox, cy - oy, b.z - oz) * per;
      const reach = 1.05 * s * S.boars.hitPad + pad + b.speed * lag;
      // быстрая проверка: сфера вокруг зверя; заодно пуля мимо в паре метров пугает
      const t0 = raySphere(ox, oy, oz, dx, dy, dz, b.x, cy, b.z, Math.max(reach, 3.5 * Math.max(s, 0.6)));
      if (t0 < 0 || t0 > bt) continue;
      const t = raySphere(ox, oy, oz, dx, dy, dz, b.x, cy, b.z, reach) < 0 ? -1 : poseHit(b, false, ox, oy, oz, dx, dy, dz, pad);
      if (t < 0) { fleeBoar(b, ox, oz, rand(0.05, 0.2)); continue; }
      if (t < near || t >= bt) continue;
      bt = t; best = b; bz = hitZone;
    }
    let bird = false;
    for (const b of birds) {
      if (!b.active || b.dead) continue;
      const pad = Math.hypot(b.x - ox, b.y - oy, b.z - oz) * per;
      const reach = 0.6 * b.scale * S.birds.hitPad + pad + Math.hypot(b.vx, b.vy, b.vz) * lag;
      if (raySphere(ox, oy, oz, dx, dy, dz, b.x, b.y, b.z, reach) < 0) continue;
      const t = poseHit(b, true, ox, oy, oz, dx, dy, dz, pad);
      if (t < 0 || t < near || t >= bt) continue;
      bt = t; best = b; bz = hitZone; bird = true;
    }
    if (!best) return null;
    const point = new THREE.Vector3(ox + dx * bt, oy + dy * bt, oz + dz * bt);
    const a = best, zone = bz;
    const normal = new THREE.Vector3(-dx, -dy, -dz);
    let used = false;
    // This custom hit uses the canonical animal slot, never the packed GPU slot.
    return {
      distance: bt, point, normal, object: bird ? birdMesh : boarMesh, instanceId: a.i, animalId: a.id, zone, animal: bird ? a.sp : a.pig ? 'piglet' : 'boar',
      hit(weaponId, damage) {
        if (network) return null;
        if (used) return null;
        used = true;
        return applyHit(a, bird, zone, weaponId, damage, point, bt);
      },
    };
  }

  function applyHit(a, bird, zone, weaponId, damage, point, dist) {
    if (!a.active || a.dead) return null;
    const Sc = S.score;
    const dmg = (damage ?? S.damage[weaponId] ?? S.damage.default) * (zone === 'head' ? 2.5 : zone === 'heart' ? 2 : zone === 'legs' ? 0.7 : 1);
    a.flash = 1;
    if (!bird) {
      a.hp -= dmg;
      if (a.hp > 0) { fleeBoar(a, camera.position.x, camera.position.z, 0); startFlee(a); a.gallop += 1.5; return { killed: false, zone }; }
    }
    // убит
    const moving = bird ? a.mode !== 'perch' && a.y > ground + 0.5 : a.speed > 3;
    a.dead = true; a.deadT = 0; a.fall = 0; a.fade = 0; a.born = false; alarm = true;
    if (bird) { a.vx *= 0.4; a.vz *= 0.4; a.vy = Math.min(a.vy, 1); a.mode = 'fall'; }
    else { for (const m of a.group.members) if (m !== a && !m.dead) fleeBoar(m, camera.position.x, camera.position.z, rand(0.05, 0.3)); }
    const key = bird ? a.sp : a.pig ? 'piglet' : 'boar';
    const base = S.species[key].points;
    const zoneK = zone === 'head' ? Sc.head : zone === 'heart' ? Sc.heart : zone === 'legs' ? Sc.legs : 1;
    const distK = clamp(1 + (dist - Sc.distance.from) / Sc.distance.per, 1, Sc.distance.max);
    const now = performance.now() / 1000;
    streak = now - lastKill < Sc.combo.window ? streak + 1 : 1; lastKill = now;
    const comboK = Math.min(Sc.combo.max, 1 + Sc.combo.step * (streak - 1));
    const pts = Math.round(base * zoneK * distK * comboK * (moving ? Sc.running : 1) / 5) * 5;
    session.score += pts; session.kills++; if (bird) session.birds++; else session.boars++;
    shared.pref.xp += pts; writePref();
    const tags = [zone === 'head' ? 'в голову' : zone === 'heart' ? 'в сердце' : null, `${Math.round(dist)} м`,
      moving ? (bird ? 'влёт' : 'на бегу') : null, streak > 1 ? `серия ×${comboK.toFixed(2).replace(/\.?0+$/, '')}` : null].filter(Boolean);
    popup(point, `+${fmt(pts)}`, `${S.species[key].name} · ${tags.join(' · ')}`);
    syncHud();
    return { killed: true, points: pts, zone };
  }

  // A continuous session score: no deadline, result modal or leaderboard requests.
  function syncHud() {
    hud.hidden = !enabled || !getWalk?.()?.active || !!pipe?.photo || capturing;
    const points = network ? networkScore : session.score;
    if (points !== displayedScore) { scoreValue.textContent = fmt(points); displayedScore = points; }
  }

  function popup(point, big, small) {
    const v = tmpP.copy(point).project(camera);
    if (v.z > 1) return;
    const r = canvas.getBoundingClientRect();
    const p = pops[popI = (popI + 1) % pops.length];
    p.innerHTML = '';
    p.append(Object.assign(document.createElement('b'), { textContent: big }), Object.assign(document.createElement('span'), { textContent: small }));
    p.style.left = `${r.left + (v.x + 1) / 2 * r.width}px`;
    p.style.top = `${r.top + (1 - v.y) / 2 * r.height}px`;
    p.hidden = false; p.classList.remove('go'); void p.offsetWidth; p.classList.add('go');
    clearTimeout(p._t); p._t = setTimeout(() => { p.hidden = true; }, 1600);
  }

  function setNetwork(on) {
    const next = !!on;
    if (network === next) return;
    encounterView?.update(null, { visible: false });
    sightCache.clear();
    if (next) { previousEnabled = enabled; enabled = true; networkScore = 0; hud.hidden = true; }
    else {
      const clock = restoreLocalWildlife(localWildlife);
      if (clock) { time = clock.time; acc = clock.acc; alarm = clock.alarm; wasSeen = clock.wasSeen; }
      // GPU prefixes still contain the network view; rebuild even for an
      // unchanged camera before the next solo idle tick, using local bounds.
      wasSeen = false; boundsOnly();
      localWildlife = null;
      enabled = previousEnabled; networkSnapshot = null; networkTargets.clear();
    }
    network = next;
    syncVisible(); requestRender?.();
  }

  function applyNetworkSnapshot(snapshot, playerScore) {
    if (Number.isFinite(playerScore)) networkScore = Math.max(0, playerScore);
    if (!snapshot || !Array.isArray(snapshot.animals)) return;
    networkSnapshot = snapshot;
    if (!network || !ready) return;
    localWildlife ??= captureLocalWildlife([...boars, ...birds], { time, acc, alarm, wasSeen });
    time = Number(snapshot.time) || 0;
    networkTargets.clear();
    for (const a of [...boars, ...birds]) a.active = false;
    for (const pose of snapshot.animals) {
      const pool = pose.kind === 'boar' ? boars : pose.kind === 'bird' ? birds : null;
      const a = pool?.[pose.i];
      if (!a || ![pose.x, pose.y, pose.z, pose.yaw, pose.scale].every(Number.isFinite)) continue;
      const fresh = a.id !== pose.id;
      if (fresh) Object.assign(a, pose);
      a.active = pose.active !== false; a.dead = !!pose.dead; a.id = pose.id; a.generation = pose.generation;
      a.hp = pose.hp; a.scale = pose.scale; a.pig = !!pose.pig; a.flash = Math.max(a.flash ?? 0, pose.flash ?? 0);
      a.histN = 0; a.histT = -1;
      if (pose.kind === 'bird') {
        a.f = networkFlock; a.sp = pose.sp; a.kind = pose.birdKind; a.fat = pose.fat ?? 1;
        a.mode = pose.dead ? 'fall' : (pose.fold ?? 0) > 0.5 ? 'perch' : 'fly';
        a.vx = a.vy = a.vz = 0;
      }
      networkTargets.set(a, pose);
    }
    // Present once in the animation frame, not again at every snapshot receipt.
    // Bounds stay current so newly arriving animals become visible immediately.
    boundsOnly(); syncVisible();
  }

  function setEnabled(on) {
    if (network) return;
    enabled = !!on; shared.pref.on = enabled; writePref();
    syncVisible(); requestRender?.();
  }

  function dispose() {
    disposed = true;
    localWildlife = null; networkSnapshot = null; networkTargets.clear();
    offLive?.();
    encounterView?.dispose();
    scene.remove(root);
    for (const o of owned) o.dispose?.();
    for (const m of [boarMesh, blobMesh, birdMesh]) m?.dispose?.();
    hud.remove(); pops.forEach(p => p.remove());
    if (shared.hunt === api) shared.hunt = null;
  }

  const api = {
    update, raycast, noise, dispose, setEnabled, setNetwork, applyNetworkSnapshot,
    applyNetworkHit(hit, { local = false } = {}) {
      if (!network || !local || !hit?.point) return;
      const p = new THREE.Vector3(...hit.point);
      if (hit.points > 0) popup(p, `+${fmt(hit.points)}`, hit.cargo ? 'Пирог сбит!' : S?.events?.types?.[hit.species]?.name ?? S?.species?.[hit.species]?.name ?? 'Попадание');
      else popup(p, hit.event ? `${hit.hp} / ${hit.maxHp}` : 'Попадание', hit.event ? 'прочность' : hit.zone === 'head' ? 'в голову' : '');
    },
    award(points, point, title, sub = '') {
      if (network) return;
      if (points > 0 && S) {
        session.score += points; session.kills++; session.targets++;
        shared.pref.xp += points; writePref();
        syncHud();
      }
      if (point) popup(point, points > 0 ? `+${fmt(points)}` : title, points > 0 ? [title, sub].filter(Boolean).join(' · ') : sub);
    },
    get enabled() { return enabled; },
    get stats() {
      let boarsAlive = 0, birdsAlive = 0;
      for (const b of boars) if (b.active && !b.dead) boarsAlive++;
      for (const b of birds) if (b.active && !b.dead) birdsAlive++;
      const p = shared.pref;
      return { ready, visible: root.visible && wasSeen, score: network ? networkScore : session.score, kills: session.kills, boars: session.boars, birds: session.birds, shots: session.shots,
        alive: { boars: boarsAlive, birds: birdsAlive, flocks: flocks.length }, xp: p.xp, best: p.best,
        level: S ? levelOf(p.xp, S.levels).level : 1 };
    },
    // для проверок из консоли: звери и их состояние
    get debug() { return { boars, birds, flocks, groups, region, regions, home, box, spawnPass, encounters, encounterView }; },
  };
  shared.hunt = api;
  return api;
}

// ---------- раздел панели ----------

addHelp(
  { mode: 'walk', topic: 'hunt', order: 83, text: 'на поле иногда появляются POLICJA, трактор с пирогом, дрон и самолёт. Дым — цель повреждена; добейте до взрыва. В комнате урон общий' },
  { mode: 'walk', topic: 'hunt', order: 80, text: 'охота: кабаны и птицы на поле за балконом. Выйти на балкон (дверь — E), 3 — автомат' },
  { mode: 'walk', topic: 'hunt', order: 81, text: 'очки за текущую игру — справа сверху. Без таймера и окон рекордов' },
  { mode: 'walk', topic: 'hunt', order: 82, text: 'в голову ×2, в сердце ×1,5; на бегу, влёт, издалека и сериями больше. Кабана в бок обычно с двух попаданий' },
);

export function registerHuntUI(addSection, getHunt) {
  addSection({
    id: 'hunt', tab: 'live', title: 'Охота', order: 40, feature: 'walk',
    summary: () => 'Очки за текущую игру',
    controls: [
      { type: 'toggle', key: 'huntOn', label: 'Кабаны, птицы и пасхалки за балконом',
        get: () => getHunt()?.enabled ?? shared.pref.on !== false,
        set: v => { const h = getHunt(); if (h) h.setEnabled(v); else { shared.pref.on = !!v; writePref(); } } },
      { type: 'readout', key: 'huntSession', style: 'hint', value: () => 'Очки накапливаются за текущую игру. Таймера и окна рекордов нет.' },
      { type: 'help', topic: 'hunt' },
    ],
  });
}

// ---------- мелочи ----------

function el(tag, cls, parent, html = '') {
  const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; parent.appendChild(e); return e;
}
function radialTexture(THREE) {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  r.addColorStop(0, '#fff'); r.addColorStop(0.55, '#888'); r.addColorStop(1, '#000');
  g.fillStyle = r; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}
let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const s = document.createElement('style'); s.id = 'hunt-css'; s.textContent = HUNT_CSS; document.head.appendChild(s);
}
// Токены --kw-* даёт .kw-float (minimap.js). Табло — справа сверху свободной части холста (панель справа не закрывает).
const HUNT_CSS = `
.kh-hud { position: fixed; z-index: 5; top: calc(64px + env(safe-area-inset-top, 0px)); right: max(14px, env(safe-area-inset-right, 0px));
  min-width: 100px; box-sizing: border-box; padding: 9px 11px 10px; border: 1px solid var(--kw-line); border-radius: 4px; background: var(--kw-sheet);
  color: var(--kw-ink); box-shadow: var(--kw-shadow); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  font: 12px/1.35 var(--f-body, "Inter", Arial, sans-serif); pointer-events: none; font-variant-numeric: tabular-nums; }
body.panel-open .kh-hud { top: calc(14px + env(safe-area-inset-top, 0px)); right: calc(var(--panel-w, 376px) + 28px); }   /* закрытая панель — кнопка «Панель» сверху справа, табло под ней */
.kh-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.kh-row b { font: 600 11px/1 var(--f-display, inherit); letter-spacing: 0.07em; text-transform: uppercase; color: var(--kw-muted); }
.kh-score { font: 600 26px/1.15 var(--f-display, inherit); margin: 3px 0 1px; }
.kh-pop { position: fixed; z-index: 6; transform: translate(-50%, -100%); pointer-events: none; text-align: center; white-space: nowrap;
  color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.65), 0 0 10px rgba(0,0,0,0.35); font: 12px/1.25 var(--f-body, "Inter", Arial, sans-serif); }
.kh-pop b { display: block; font: 700 22px/1.1 var(--f-display, inherit); color: #ffd36b; }
.kh-pop.go { animation: khPop 1.5s cubic-bezier(.2,.7,.3,1) forwards; }
@keyframes khPop { 0% { opacity: 0; transform: translate(-50%, -70%) scale(0.8); } 12% { opacity: 1; transform: translate(-50%, -100%) scale(1.05); }
  70% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -190%) scale(1); } }
.kh-hud[hidden], .kh-pop[hidden] { display: none; }
@media (max-width: 760px) {
  body.panel-open .kh-hud { right: max(14px, env(safe-area-inset-right, 0px)); }
  .kh-hud { width: 112px; top: var(--kw-dock-top, calc(120px + env(safe-area-inset-top, 0px))); }   /* под карточкой заголовка, справа от плана */
  body:has(#panel.open) .kh-hud { display: none; }
}
@media (prefers-reduced-motion: reduce) { .kh-pop.go { animation-duration: 0.01s; } }
`;
