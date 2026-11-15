// Дневной свет квартиры в растре: солнце, небо из окон, переотражения по комнатам.
//
//   const lighting = createLighting({ THREE, scene, renderer, plan, M, getState, camera, requestRender });
//   lighting.apply(mode, state)  — режим day / overcast / evening, солнце state.sunAz/sunEl/sunUp, экспозиция
//   lighting.update()            — каждый кадр до рендера; true = нужен новый кадр (досчитались переотражения)
//   lighting.invalidate()        — сцена изменилась (материалы, мебель): пересчитать переотражения
//   lighting.ready               — Promise: дневная панорама загружена
//   lighting.lights, .sun, .setQuality(q), .dispose()
//
// Как устроено (почему так, а не «один свет на всю сцену»):
// 1. Зоны. Квартира делится на герметичные по свету зоны: открытое пространство (кухня-гостиная, холл, шахта),
//    комната 2, комната 3, ванная, плюс каждый проём (окно, дверь) — своя тонкая зона. 0 — улица.
//    Зона фрагмента ищется по мировой точке, сдвинутой на 4 см по нормали (грань стены попадает в свою комнату).
// 2. Маска источников. three не умеет «свет только для этих объектов», поэтому в шейдер всех материалов
//    вставлена маска: источник светит только в своей зоне и в примыкающих проёмах. Так свет окна комнаты 2
//    не проходит сквозь стены на кухню, точечные светильники холла — в комнату 3 и т. п. Солнце не маскируется:
//    его держат тени (стены, потолок и плита над ним отбрасывают тень, даже когда вырез их прячет).
// 3. Небо из окна — RectAreaLight в плоскости стекла каждого наружного проёма. Его яркость и цвет — среднее
//    той же панорамы HDRI, что видна в окне (без солнечного диска, с учётом балкона сверху). Светит только в свою комнату.
// 4. Переотражения — зонды освещённости (SH, как LightProbe) по сетке в каждой зоне. Они снимаются кубическими
//    рендерами всей квартиры со ВСЕМИ стенами и потолками (слои 0 и 1), поэтому вырез и снятый потолок на свет
//    не влияют. Четыре прохода = четыре отскока. Это заменяет и сырой IBL внутри (он светил сквозь потолок
//    одинаково везде, даже в ванной без окна), и прежний bounce-прямоугольник над кухней, и hemi.
//    Отражения панорамы внутри помещений нормируются по зонду (normalized reflections): пол комнаты отражает
//    комнату по яркости и цвету, а не голубое небо.
// 5. Снаружи (фасад, балкон, торцы стен при взгляде сверху, окружение) — обычный IBL панорамы, как раньше.
//
// Обманки помечены userData.rasterOnly (render.js не берёт их в фото): окна-прямоугольники.
// Физические источники для трассировщика — солнце и панорама.
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { sunFor, sunTimes } from './site.js';

// ---------- настройки ----------

const ENV_INTENSITY = { day: 0.75, overcast: 1.0, evening: 0.1 };
const BG_INTENSITY = { day: 1.0, overcast: 0.75, evening: 0.35 };
// Экспозиция «глаза» в помещении: внутри в 10–30 раз темнее, чем на улице, глаз и камера это компенсируют.
// Подобрано замером в приложении: средняя яркость кадра в комнате ~165–185 из 255 (днём), как у прежнего света.
const EXPOSURE_IN = { day: 6, overcast: 6, evening: 0.8 };
// Камера снаружи или над квартирой: половина поправки (в стопах), чтобы фасад и окружение не выгорали.
const OUTSIDE_STOPS = 0.5;
const ABOVE_ADAPT = 0.75;   // камера над срезанным потолком смотрит в комнаты: доля «внутренней» поправки экспозиции
const GLASS_T = 0.8;           // пропускание стеклопакета
const SUN_LUX = 3.2;           // солнце при высоте ~43° (масштаб сцены, как раньше)
const PROBE_Y = 1.2, PROBE_STEP = 1.5, PROBE_MARGIN = 0.55, PROBE_MIN_AREA = 0.9;
const FACE = 32;               // сторона грани кубического снимка зонда
const PROBES_PER_FRAME = 3;    // 18 маленьких рендеров за кадр во время пересчёта (больше — риск потери WebGL)
const BOUNCES = 4;
const CELL = 0.2;              // шаг сетки освещённости, м
const MAX_BOX = 32, MAX_ZONE = 16, MASK_W = 64;
const OPEN_ROOMS = ['kitchen_living', 'hall', 'shaft'];
// Баланс белого переотражений: глаз в комнате подстраивается под тёплый отскок от дубового пола и стен,
// поэтому цвет отражённого света приглушается (1 — физически, 0 — серый). Иначе белый потолок выходит персиковым.
const GI_SAT = 0.3;
const MIRROR_FACE = 256;       // сторона грани куб-зонда зеркала   // одна зона: между ними нет дверей

// ---------- режим и время суток ----------

// «Вечер» — значит солнце под горизонтом, «День» и «Пасмурно» — над ним. Вызывать в setState после Object.assign:
//   Object.assign(state, lightTimePatch(patch, state, site));
// Двигали время — меняется режим; выбрали режим (или дату, или открыли ссылку) — время переезжает:
// вечер — на 45 мин после заката этой даты, день — на час после восхода или до заката (ближе к прежнему времени).
export function lightTimePatch(patch, state, site) {
  const date = state.sunDate, t = state.sunTime ?? 14;
  if (!date || !state.light) return {};
  const up = sunFor(date, t, site).up, evening = state.light === 'evening';
  if (evening !== up) return {};   // и так согласовано
  if ('sunTime' in patch && !('light' in patch)) return { light: up ? 'day' : 'evening' };
  const st = sunTimes(date, site), q = h => Math.min(22, Math.max(4, Math.round(h * 4) / 4));
  const sunrise = st.sunrise ?? 6, sunset = st.sunset ?? 18, noon = st.noon ?? 12;
  if (evening) return { sunTime: q(sunset + 0.75) };
  return { sunTime: q(t > noon ? sunset - 1 : sunrise + 1) };
}

// ---------- зоны ----------

function buildZones(plan) {
  const H = plan.ceiling;
  const zones = [{ id: 'outside', kind: 'outside', bit: 1, rooms: [] }];
  const roomZone = {};
  const addZone = z => { z.index = zones.length; zones.push(z); return z; };
  const open = addZone({ id: 'open', kind: 'room', rooms: OPEN_ROOMS.filter(r => plan.rooms[r]) });
  for (const r of open.rooms) roomZone[r] = open.index;
  for (const r of Object.keys(plan.rooms)) if (!(r in roomZone)) roomZone[r] = addZone({ id: r, kind: 'room', rooms: [r] }).index;

  const roomBoxes = [];
  for (const [r, room] of Object.entries(plan.rooms)) for (const q of room.rects) {
    roomBoxes.push({ x0: q.x0, z0: q.z0, x1: q.x1, z1: q.z1, y0: -0.02, y1: H + 0.02, zone: roomZone[r] });
  }
  const zoneAt = (x, y, z, list = roomBoxes) => list.find(b => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1)?.zone ?? 0;

  const openingBoxes = [];
  for (const o of plan.openings) {
    const z = addZone({ id: o.id, kind: 'opening', exterior: o.type !== 'interior', rooms: [] });
    // по обе стороны проёма: какие зоны он соединяет
    const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, y = Math.min(1, (o.sill + o.head) / 2);
    const side = o.along === 'x' ? [[cx, cz - 0.6], [cx, cz + 0.6]] : [[cx - 0.6, cz], [cx + 0.6, cz]];
    z.adj = [...new Set(side.map(([x, zz]) => zoneAt(x, y, zz)))];
    z.inner = z.adj.find(a => a > 0) ?? 0;
    openingBoxes.push({ x0: o.x0, z0: o.z0, x1: o.x1, z1: o.z1, y0: o.sill - 0.02, y1: o.head + 0.02, zone: z.index });
  }
  if (zones.length > MAX_ZONE) console.warn('lighting: зон больше', MAX_ZONE);
  zones.forEach((z, i) => { z.bit = 1 << i; });
  // проёмы — первыми: они тонкие и лежат на границе комнат
  const boxes = [...openingBoxes, ...roomBoxes].slice(0, MAX_BOX);
  const lookup = (x, y, z) => zoneAt(x, y, z, boxes);

  // какие ячейки сетки зона принимает при сглаживании и в какие зоны светят её источники
  for (const z of zones) {
    if (z.kind === 'room') {
      z.accept = z.bit;
      const ops = zones.filter(o => o.kind === 'opening' && o.adj.includes(z.index));
      z.lampMask = z.bit | ops.reduce((m, o) => m | o.bit, 0) | (ops.some(o => o.exterior) ? 1 : 0);
      z.windowMask = z.bit | ops.reduce((m, o) => m | o.bit, 0);
      z.envKeep = 0;
    } else if (z.kind === 'opening') {
      z.accept = z.bit | z.adj.reduce((m, a) => m | (a > 0 ? zones[a].bit : 0), 0);
      z.envKeep = z.exterior ? 0.35 : 0;
    } else { z.accept = 1; z.envKeep = 1; }
  }

  // зонды: сетка в каждом прямоугольнике комнаты
  const probes = [];
  for (const z of zones) if (z.kind === 'room') {
    for (const r of z.rooms) for (const q of plan.rooms[r].rects) {
      const w = q.x1 - q.x0, d = q.z1 - q.z0;
      if (w * d < PROBE_MIN_AREA || Math.min(w, d) < 0.35) continue;
      const steps = (a0, a1) => {
        const L = a1 - a0, n = Math.max(1, Math.round((L - 2 * PROBE_MARGIN) / PROBE_STEP) + 1);
        return n === 1 ? [(a0 + a1) / 2] : Array.from({ length: n }, (_, i) => a0 + PROBE_MARGIN + i * (L - 2 * PROBE_MARGIN) / (n - 1));
      };
      for (const x of steps(q.x0, q.x1)) for (const zz of steps(q.z0, q.z1)) probes.push({ x, y: PROBE_Y, z: zz, zone: z.index });
    }
  }
  return { zones, boxes, probes, lookup, H };
}

// ---------- сферические гармоники ----------

const SH_K = [0.282095, 0.488603, 0.488603, 0.488603, 1.092548, 1.092548, 0.315392, 1.092548, 0.546274];
function shBasis(x, y, z, out) {
  out[0] = SH_K[0]; out[1] = SH_K[1] * y; out[2] = SH_K[2] * z; out[3] = SH_K[3] * x;
  out[4] = SH_K[4] * x * y; out[5] = SH_K[5] * y * z; out[6] = SH_K[6] * (3 * z * z - 1);
  out[7] = SH_K[7] * x * z; out[8] = SH_K[8] * (x * x - y * y);
  return out;
}
// Освещённость по SH (та же формула, что shGetIrradianceAt в three)
export function shIrradiance(sh, x, y, z) {
  const c = [0.886227, 2 * 0.511664 * y, 2 * 0.511664 * z, 2 * 0.511664 * x, 2 * 0.429043 * x * y, 2 * 0.429043 * y * z,
    0.743125 * z * z - 0.247708, 2 * 0.429043 * x * z, 0.429043 * (x * x - y * y)];
  const r = [0, 0, 0];
  for (let j = 0; j < 9; j++) for (let k = 0; k < 3; k++) r[k] += sh[j * 3 + k] * c[j];
  return r;
}

// ---------- панорама: SH окружения и карта неба для окон ----------

function analyseHDR(THREE, tex, sunUV, capSun) {
  const { data, width: W, height: H } = tex.image;
  const ch = data.length / (W * H);
  const half = data instanceof Uint16Array, f = THREE.DataUtils.fromHalfFloat;
  const read = i => (half ? f(data[i]) : data[i]);
  const step = Math.max(1, Math.round(W / 512));
  // солнечный диск: всё ярче 30 медиан в пределах 6° от солнца панорамы
  const lums = [];
  for (let r = 0; r < H; r += step * 4) for (let c = 0; c < W; c += step * 4) { const i = (r * W + c) * ch; lums.push(0.2126 * read(i) + 0.7152 * read(i + 1) + 0.0722 * read(i + 2)); }
  lums.sort((a, b) => a - b);
  const cap = 30 * lums[lums.length >> 1];
  const sunPsi = (sunUV.u - 0.5) * 2 * Math.PI, sunEl = (sunUV.v - 0.5) * Math.PI;
  const sunDir = [Math.cos(sunEl) * Math.cos(sunPsi), Math.sin(sunEl), Math.cos(sunEl) * Math.sin(sunPsi)];
  const cosSun = Math.cos(THREE.MathUtils.degToRad(6));

  const sh = new Float32Array(27), b = new Array(9);
  const GW = 64, GH = 32, grid = new Float32Array(GW * GH * 4);   // rgb + вес
  let wsum = 0;
  for (let r = 0; r < H; r += step) {
    const v = 1 - (r + 0.5) / H, el = (v - 0.5) * Math.PI, ce = Math.cos(el), se = Math.sin(el);
    const gr = Math.min(GH - 1, Math.floor((1 - v) * GH));
    for (let c = 0; c < W; c += step) {
      const psi = ((c + 0.5) / W - 0.5) * 2 * Math.PI;
      const x = ce * Math.cos(psi), y = se, z = ce * Math.sin(psi);
      const i = (r * W + c) * ch;
      let R = read(i), G = read(i + 1), B = read(i + 2);
      shBasis(x, y, z, b);
      for (let j = 0; j < 9; j++) { sh[j * 3] += R * b[j] * ce; sh[j * 3 + 1] += G * b[j] * ce; sh[j * 3 + 2] += B * b[j] * ce; }
      wsum += ce;
      if (capSun) {
        const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const nearSun = x * sunDir[0] + y * sunDir[1] + z * sunDir[2] > cosSun;
        if (nearSun && Y > cap) continue;              // диск солнца — это DirectionalLight
        if (Y > cap) { const k = cap / Y; R *= k; G *= k; B *= k; }
      }
      const gi = (gr * GW + Math.min(GW - 1, Math.floor((c / W) * GW))) * 4;
      grid[gi] += R * ce; grid[gi + 1] += G * ce; grid[gi + 2] += B * ce; grid[gi + 3] += ce;
    }
  }
  const norm = 4 * Math.PI / wsum;
  for (let j = 0; j < 27; j++) sh[j] *= norm;
  for (let i = 0; i < GW * GH; i++) { const w = grid[i * 4 + 3] || 1; grid[i * 4] /= w; grid[i * 4 + 1] /= w; grid[i * 4 + 2] /= w; }
  // среднее земли (нижняя полусфера) — для подсвеченного снизу потолка балкона
  let g = [0, 0, 0], gw = 0;
  for (let r = GH / 2; r < GH; r++) for (let c = 0; c < GW; c++) { const i = (r * GW + c) * 4, w = grid[i + 3] ? 1 : 0; g[0] += grid[i] * w; g[1] += grid[i + 1] * w; g[2] += grid[i + 2] * w; gw += w; }
  g = g.map(x => x / Math.max(1, gw));
  return { sh, sky: { grid, GW, GH, ground: g } };
}

// Средняя яркость неба в окне: косинусное среднее по полусфере наружу (мировые оси), выше occEl — нижняя
// плоскость балкона/этажа сверху (подсвечена землёй).
function windowRadiance(sky, theta, n, occEl) {
  const { grid, GW, GH, ground } = sky;
  const acc = [0, 0, 0]; let ws = 0;
  for (let r = 0; r < GH; r++) {
    const el = (0.5 - (r + 0.5) / GH) * Math.PI, ce = Math.cos(el), se = Math.sin(el);
    for (let c = 0; c < GW; c++) {
      const psiW = ((c + 0.5) / GW - 0.5) * 2 * Math.PI - theta;
      const cos = ce * Math.cos(psiW) * n[0] + se * n[1] + ce * Math.sin(psiW) * n[2];
      if (cos <= 0) continue;
      const w = cos * ce, i = (r * GW + c) * 4;
      const L = el > occEl ? [ground[0] * 0.35, ground[1] * 0.35, ground[2] * 0.35] : [grid[i], grid[i + 1], grid[i + 2]];
      acc[0] += L[0] * w; acc[1] += L[1] * w; acc[2] += L[2] * w; ws += w;
    }
  }
  return acc.map(x => x / Math.max(ws, 1e-6));
}

// ---------- шейдер: зоны, маски источников, переотражения ----------

const GLSL_PARS = /* glsl */`
uniform vec4 rlBox[ ${MAX_BOX} ];
uniform vec4 rlBoxY[ ${MAX_BOX} ];
uniform int rlBoxCount;
uniform vec4 rlZoneInfo[ ${MAX_ZONE} ];   // x — зондов нет/есть, y — доля сырого IBL, z — принимаемые зоны (биты)
uniform sampler2D rlMaskTex;              // строка = тип источника, столбец = номер в массиве three, значение = биты зон
uniform sampler2D rlGrid;                 // сетка SH: ячейка = 10 текселей (зона, 9 коэффициентов); ниже — средние зон
uniform vec4 rlGridA;                     // x0, z0, 1/шаг, nx
uniform vec4 rlGridB;                     // nz, первая строка средних, включено, 0
uniform vec3 rlEnvSH[ 9 ];
uniform float rlGiSat;
varying vec3 vRlWorld;
#ifdef RL_LOCAL_ENV
uniform vec3 rlEnvMin, rlEnvMax, rlEnvPos;   // комната и точка съёмки куб-зонда (мир)
#endif
int rlZone = 0;
int rlZoneAt( const in vec3 p ) {
	for ( int i = 0; i < ${MAX_BOX}; i ++ ) {
		if ( i >= rlBoxCount ) break;
		vec4 b = rlBox[ i ]; vec4 y = rlBoxY[ i ];
		if ( p.x >= b.x && p.x <= b.z && p.z >= b.y && p.z <= b.w && p.y >= y.x && p.y <= y.y ) return int( y.z );
	}
	return 0;
}
float rlLightMask( const in int type, const in int idx ) {
	if ( idx >= ${MASK_W} ) return 1.0;
	int m = int( texelFetch( rlMaskTex, ivec2( idx, type ), 0 ).r );
	return float( ( m >> rlZone ) & 1 );
}
void rlGatherSH( const in int zone, const in vec3 p, out vec3 sh[ 9 ] ) {
	for ( int j = 0; j < 9; j ++ ) sh[ j ] = vec3( 0.0 );
	int accept = int( rlZoneInfo[ zone ].z );
	vec2 g = ( p.xz - rlGridA.xy ) * rlGridA.z - 0.5;
	vec2 f = fract( g );
	ivec2 c0 = ivec2( floor( g ) ), last = ivec2( int( rlGridA.w ) - 1, int( rlGridB.x ) - 1 );
	float ws = 0.0;
	for ( int k = 0; k < 4; k ++ ) {
		ivec2 o = ivec2( k & 1, k >> 1 );
		ivec2 c = clamp( c0 + o, ivec2( 0 ), last );
		float w = ( o.x == 1 ? f.x : 1.0 - f.x ) * ( o.y == 1 ? f.y : 1.0 - f.y );
		int cz = int( texelFetch( rlGrid, ivec2( c.x * 10, c.y ), 0 ).r );
		if ( ( ( accept >> cz ) & 1 ) == 0 || w <= 0.0 ) continue;
		ws += w;
		for ( int j = 0; j < 9; j ++ ) sh[ j ] += w * texelFetch( rlGrid, ivec2( c.x * 10 + 1 + j, c.y ), 0 ).rgb;
	}
	if ( ws > 1e-4 ) {
		for ( int j = 0; j < 9; j ++ ) sh[ j ] /= ws;
	} else {
		int row = int( rlGridB.y ) + zone;
		for ( int j = 0; j < 9; j ++ ) sh[ j ] = texelFetch( rlGrid, ivec2( 1 + j, row ), 0 ).rgb;
	}
}
`;

const GLSL_ZONE = /* glsl */`
vec3 rlNw = inverseTransformDirection( nonPerturbedNormal, viewMatrix );
rlZone = rlZoneAt( vRlWorld + rlNw * 0.04 );
`;

const GLSL_GI = /* glsl */`
#if defined( RE_IndirectDiffuse )
if ( rlZone > 0 && rlGridB.z > 0.5 && rlZoneInfo[ rlZone ].x > 0.5 ) {
	vec3 rlSH[ 9 ];
	rlGatherSH( rlZone, vRlWorld + rlNw * 0.04, rlSH );
	float rlKeep = rlZoneInfo[ rlZone ].y;
	vec3 rlE = max( shGetIrradianceAt( inverseTransformDirection( geometryNormal, viewMatrix ), rlSH ), vec3( 0.0 ) );
	rlE = mix( vec3( dot( rlE, vec3( 0.2126, 0.7152, 0.0722 ) ) ), rlE, rlGiSat );
	#ifdef STANDARD
		iblIrradiance = iblIrradiance * rlKeep + rlE * ( 1.0 - rlKeep );
	#else
		irradiance += rlE * ( 1.0 - rlKeep );
	#endif
	#if defined( STANDARD ) && defined( USE_ENVMAP ) && defined( RE_IndirectSpecular ) && defined( ENVMAP_TYPE_CUBE_UV )
		vec3 rlR = reflect( - geometryViewDir, geometryNormal );
		rlR = inverseTransformDirection( normalize( mix( rlR, geometryNormal, material.roughness * material.roughness ) ), viewMatrix );
		vec3 rlRoom = max( shGetIrradianceAt( rlR, rlSH ), vec3( 0.0 ) );
		rlRoom = mix( vec3( dot( rlRoom, vec3( 0.2126, 0.7152, 0.0722 ) ) ), rlRoom, rlGiSat );
		vec3 rlSky = max( shGetIrradianceAt( envMapRotation * rlR, rlEnvSH ) * envMapIntensity, vec3( 1e-3 ) );
		vec3 rlK = mix( clamp( rlRoom / rlSky, 0.0, 1.5 ), vec3( 1.0 ), rlKeep );
		radiance *= rlK;
		#ifdef USE_CLEARCOAT
			clearcoatRadiance *= rlK;
		#endif
	#endif
}
#endif
// Зеркало: отражение из куб-зонда своей комнаты с поправкой на её коробку (box projection) — без неба и солнца
#if defined( RL_LOCAL_ENV ) && defined( USE_ENVMAP ) && defined( RE_IndirectSpecular ) && defined( ENVMAP_TYPE_CUBE_UV )
{
	vec3 rlR = reflect( - geometryViewDir, geometryNormal );
	rlR = inverseTransformDirection( normalize( mix( rlR, geometryNormal, material.roughness * material.roughness ) ), viewMatrix );
	vec3 rlT = mix( ( rlEnvMin - vRlWorld ) / rlR, ( rlEnvMax - vRlWorld ) / rlR, step( vec3( 0.0 ), rlR ) );
	float rlD = max( min( min( rlT.x, rlT.y ), rlT.z ), 0.0 );
	radiance = textureCubeUV( envMap, normalize( vRlWorld + rlR * rlD - rlEnvPos ), material.roughness ).rgb * envMapIntensity;
}
#endif
`;

// Маски: тип 0 — точечные, 1 — прожекторы, 2 — направленные, 3 — прямоугольные, 4 — полусферные
function patchedLightsBegin(THREE) {
  let s = THREE.ShaderChunk.lights_fragment_begin;
  const rep = [
    ['getPointLightInfo( pointLight, geometryPosition, directLight );', '\n\t\tdirectLight.color *= rlLightMask( 0, UNROLLED_LOOP_INDEX );'],
    ['getSpotLightInfo( spotLight, geometryPosition, directLight );', '\n\t\tdirectLight.color *= rlLightMask( 1, UNROLLED_LOOP_INDEX );'],
    ['getDirectionalLightInfo( directionalLight, directLight );', '\n\t\tdirectLight.color *= rlLightMask( 2, UNROLLED_LOOP_INDEX );'],
    ['rectAreaLight = rectAreaLights[ i ];', '\n\t\trectAreaLight.color *= rlLightMask( 3, UNROLLED_LOOP_INDEX );'],
  ];
  for (const [a, b] of rep) {
    if (!s.includes(a)) { console.warn('lighting: в шейдере three нет', a); continue; }
    s = s.replace(a, a + b);
  }
  const hemi = 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );';
  if (s.includes(hemi)) s = s.replace(hemi, 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * rlLightMask( 4, UNROLLED_LOOP_INDEX );');
  return GLSL_ZONE + s;
}

// ---------- основное ----------

export function createLighting({ THREE, scene, renderer, plan, M, getState, camera = null, controls = null, requestRender = () => {}, hdriPath = 'textures/hdri/' }) {
  RectAreaLightUniformsLib.init();
  const H = plan.ceiling;
  const Z = buildZones(plan);
  const disposables = [];

  // --- солнце: тень только по квартире с балконом, 4096 → ~3 мм на тексель
  const sun = new THREE.DirectionalLight(0xfff1dc, SUN_LUX);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.normalBias = 0.012;
  sun.shadow.camera.layers.enableAll();   // скрытые вырезом стены, потолок и плита держат тень
  scene.add(sun, sun.target);
  const b = plan.bounds, bal = plan.balcony;
  const receivers = new THREE.Box3(
    new THREE.Vector3(Math.min(b.x0, bal?.x0 ?? b.x0) - 0.3, -0.3, Math.min(b.z0, bal?.z0 ?? b.z0) - 0.3),
    new THREE.Vector3(Math.max(b.x1, bal?.x1 ?? b.x1) + 0.3, H + 0.6, b.z1 + 0.3));
  const shadowCam = new THREE.OrthographicCamera();

  // --- небо из окон: прямоугольник в плоскости стекла (рама примерно на 17 см в стене, как в model.js)
  const T_GLASS = 0.12;   // от внутренней грани стены до плоскости света
  const windows = plan.openings.filter(o => o.type !== 'entry' && o.type !== 'interior').map(o => {
    const w = o.width - 0.14, h = o.head - o.sill - (o.sill > 0 ? 0.14 : 0.11);
    const l = new THREE.RectAreaLight(0xffffff, 0, w, h);
    const yc = o.sill + (o.sill > 0 ? 0.07 : 0.035) + h / 2;
    let n;   // наружу
    if (o.along === 'x') {
      const zIn = o.z1;   // внутренняя грань проёма
      const inward = zIn > 0.5 * (o.z0 + o.z1) ? 1 : -1;
      n = [0, 0, -inward];
      l.position.set((o.x0 + o.x1) / 2, yc, Math.max(o.z0, Math.min(o.z1, 0)) - inward * T_GLASS);
      l.lookAt(l.position.x, yc, l.position.z + inward);
    } else {
      const inward = -1;   // наружные проёмы вдоль Z — на правой стене, внутрь к −X
      n = [1, 0, 0];
      const xIn = plan.rooms.room2 ? Math.max(...plan.rooms.room2.rects.map(r => r.x1)) : o.x0;
      l.position.set(xIn + T_GLASS, yc, (o.z0 + o.z1) / 2);
      l.lookAt(l.position.x + inward, yc, l.position.z);
    }
    const zone = Z.zones.find(z => z.id === o.id);
    const inner = Z.zones[zone?.inner ?? 0];
    l.name = `window_${o.id}`;
    l.userData = { rasterOnly: true, zoneMask: (inner?.windowMask ?? 0xffff) | (zone?.bit ?? 0), window: o.id };
    // этаж/балкон сверху: выше этого угла из окна видно не небо, а его нижнюю плоскость
    const covered = bal && o.along === 'x' && o.x0 < bal.x1 && o.x1 > bal.x0;
    const occEl = covered ? Math.atan2(H + 0.25 - (o.sill + o.head) / 2, Math.max(0.3, bal.z1 - bal.z0)) : Math.PI;
    scene.add(l);
    return { light: l, o, n, occEl };
  });

  // --- панорамы
  const env = {};
  const pmrem = new THREE.PMREMGenerator(renderer);
  async function loadHDR(name) {
    const [t, sunUV] = await Promise.all([
      new RGBELoader().loadAsync(`${hdriPath}${name}.hdr`),
      fetch(`${hdriPath}${name}.json`).then(r => r.json()),
    ]);
    t.mapping = THREE.EquirectangularReflectionMapping;
    const a = analyseHDR(THREE, t, sunUV, name === 'day');
    const e = { bg: t, env: pmrem.fromEquirectangular(t).texture, sunPsi: (sunUV.u - 0.5) * Math.PI * 2, ...a };
    disposables.push(t, e.env);
    return e;
  }
  const loads = ['day', 'evening', 'overcast'].map(n => loadHDR(n).then(e => { env[n] = e; if (current.mode) apply(current.mode, current.state); return e; })
    .catch(err => { console.warn('lighting: нет панорамы', n, err); }));
  const ready = loads[0];

  // --- общие юниформы шейдера
  const maskData = new Float32Array(MASK_W * 5).fill(0xffff);
  const maskTex = new THREE.DataTexture(maskData, MASK_W, 5, THREE.RedFormat, THREE.FloatType);
  maskTex.needsUpdate = true;
  const gx = Math.ceil((b.x1 - b.x0) / CELL) + 2, gz = Math.ceil((b.z1 - b.z0) / CELL) + 2;
  const gridX0 = b.x0 - CELL, gridZ0 = b.z0 - CELL;
  const nZ = Z.zones.length;
  const makeGrid = () => {
    const t = new THREE.DataTexture(new Float32Array(gx * 10 * (gz + nZ) * 4), gx * 10, gz + nZ, THREE.RGBAFormat, THREE.FloatType);
    t.needsUpdate = true; disposables.push(t); return t;
  };
  const gridShow = makeGrid(), gridBake = makeGrid();
  // зона каждой ячейки (на высоте 1 м); в проёмы ячейка попадает редко — это нормально
  const cellZone = new Int32Array(gx * gz);
  for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) cellZone[j * gx + i] = Z.lookup(gridX0 + (i + 0.5) * CELL, 1.0, gridZ0 + (j + 0.5) * CELL);
  for (const t of [gridShow, gridBake]) for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) t.image.data[((j * gx * 10) + i * 10) * 4] = cellZone[j * gx + i];

  const U = {
    rlBox: { value: Array.from({ length: MAX_BOX }, (_, i) => { const q = Z.boxes[i]; return q ? new THREE.Vector4(q.x0, q.z0, q.x1, q.z1) : new THREE.Vector4(); }) },
    rlBoxY: { value: Array.from({ length: MAX_BOX }, (_, i) => { const q = Z.boxes[i]; return q ? new THREE.Vector4(q.y0, q.y1, q.zone, 0) : new THREE.Vector4(); }) },
    rlBoxCount: { value: Z.boxes.length },
    rlZoneInfo: { value: Array.from({ length: MAX_ZONE }, (_, i) => { const z = Z.zones[i]; return z ? new THREE.Vector4(z.kind === 'outside' ? 0 : 1, z.envKeep, z.accept, 0) : new THREE.Vector4(); }) },
    rlMaskTex: { value: maskTex },
    rlGrid: { value: gridShow },
    rlGridA: { value: new THREE.Vector4(gridX0, gridZ0, 1 / CELL, gx) },
    rlGridB: { value: new THREE.Vector4(gz, gz, 0, 0) },
    rlEnvSH: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) },
    rlGiSat: { value: GI_SAT },
  };

  // --- патч материалов (один раз на материал; клоны и новые материалы подхватываются в update)
  const patched = new WeakSet();
  const lightsBegin = patchedLightsBegin(THREE);
  function inject(shader, mat) {
    Object.assign(shader.uniforms, U);
    if (mat?.userData.rlLocalEnv) Object.assign(shader.uniforms, mat.userData.rlLocalEnv.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRlWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
	vec4 rlP = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		rlP = batchingMatrix * rlP;
	#endif
	#ifdef USE_INSTANCING
		rlP = instanceMatrix * rlP;
	#endif
	vRlWorld = ( modelMatrix * rlP ).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_pars_begin>', '#include <lights_pars_begin>\n' + GLSL_PARS)
      .replace('#include <lights_fragment_begin>', lightsBegin)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + GLSL_GI);
  }
  function patch(mat) {
    if (!mat || patched.has(mat)) return;
    patched.add(mat);
    if (!(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial) || mat.isShaderMaterial) return;
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (shader, r) { prev?.call(this, shader, r); inject(shader, this); };
    mat.customProgramCacheKey = function () { return (prevKey === THREE.Material.prototype.customProgramCacheKey ? '' : prevKey.call(this)) + '|roomlight1'; };
    mat.needsUpdate = true;
  }
  // --- зеркала: свой куб-зонд комнаты вместо уличной панорамы (меш с userData.localReflection, +Z — в комнату)
  const mirrors = [];
  let mirrorsDirty = true;
  function setupMirror(mesh) {
    const mat = mesh.material;
    mesh.updateWorldMatrix(true, false);
    const c = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    // комната перед зеркалом
    const front = c.clone().addScaledVector(n, 0.25);
    const zone = Z.zones[Z.lookup(front.x, Math.min(front.y, H - 0.1), front.z)];
    const rects = zone?.kind === 'room' ? zone.rooms.flatMap(r => plan.rooms[r].rects) : [];
    if (!rects.length) { console.warn('lighting: зеркало вне комнаты', mesh.name); return; }
    const min = new THREE.Vector3(Math.min(...rects.map(q => q.x0)), 0, Math.min(...rects.map(q => q.z0)));
    const max = new THREE.Vector3(Math.max(...rects.map(q => q.x1)), H, Math.max(...rects.map(q => q.z1)));
    // точка съёмки — на полметра перед зеркалом, внутри комнаты
    const pos = c.clone().addScaledVector(n, 0.5).clamp(min.clone().addScalar(0.05), max.clone().subScalar(0.05));
    const rt = new THREE.WebGLCubeRenderTarget(MIRROR_FACE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const cam = new THREE.CubeCamera(0.03, 30, rt);
    cam.position.copy(pos);
    cam.children.forEach(k => k.layers.enableAll());   // стены и потолок, спрятанные вырезом, в отражении есть
    mat.envMap = rt.texture;
    mat.envMapIntensity = 1;
    mat.userData.rlLocalEnv = { uniforms: { rlEnvMin: { value: min }, rlEnvMax: { value: max }, rlEnvPos: { value: pos } } };
    mat.defines = { ...(mat.defines || {}), RL_LOCAL_ENV: '' };
    mat.needsUpdate = true;
    mirrors.push({ mesh, cam, rt });
    disposables.push(rt);
    mirrorsDirty = true;
  }
  function renderMirrors() {
    for (const m of mirrors) {
      const vis = m.mesh.visible;
      m.mesh.visible = false;   // не отражать само себя
      m.cam.update(renderer, scene);
      m.mesh.visible = vis;
    }
    mirrorsDirty = false;
  }

  function patchScene() {
    scene.traverse(o => {
      if (o.userData.localReflection && !mirrors.some(m => m.mesh === o)) setupMirror(o);
      if (!o.material) return;
      if (Array.isArray(o.material)) o.material.forEach(patch); else patch(o.material);
    });
  }

  // --- маски источников: тот же порядок, что у three (обход сцены, затем источники с тенью вперёд)
  const tmpV = new THREE.Vector3(), tmpD = new THREE.Vector3();
  let giActive = false;
  function lightMask(l) {
    if (l.userData.giFill) return giActive ? 0 : 0xffff;   // заливка-обманка ламп не нужна, когда считаются переотражения
    if (l.userData.zoneMask != null) return l.userData.zoneMask;
    if (l.isDirectionalLight || l.isHemisphereLight || l.isAmbientLight || l.isLightProbe) return 0xffff;
    l.getWorldPosition(tmpV);
    if (l.isSpotLight && l.target) { l.target.getWorldPosition(tmpD); tmpV.add(tmpD.sub(tmpV).setLength(0.05)); }
    if (l.isRectAreaLight) { tmpD.set(0, 0, -1).applyQuaternion(l.getWorldQuaternion(new THREE.Quaternion())); tmpV.addScaledVector(tmpD, 0.05); }
    const z = Z.zones[Z.lookup(tmpV.x, tmpV.y, tmpV.z)];
    return z?.kind === 'room' ? z.lampMask : 0xffff;
  }
  const collected = [];
  function collect(o, layers) {
    if (o.visible === false) return;
    if (o.isLight && o.layers.test(layers)) collected.push(o);
    for (const c of o.children) collect(c, layers);
  }
  const key = l => (l.castShadow ? 2 : 0) + (l.map ? 1 : 0);
  function updateMasks(cam) {
    collected.length = 0;
    collect(scene, cam.layers);
    const sorted = collected.map((l, i) => [l, i]).sort((a, c) => key(c[0]) - key(a[0]) || a[1] - c[1]).map(a => a[0]);
    const n = [0, 0, 0, 0, 0];
    let changed = false;
    const put = (t, l) => {
      const i = n[t]++;
      if (i >= MASK_W) return;
      const v = lightMask(l), k = t * MASK_W + i;
      if (maskData[k] !== v) { maskData[k] = v; changed = true; }
    };
    for (const l of sorted) {
      if (l.isPointLight) put(0, l);
      else if (l.isSpotLight) put(1, l);
      else if (l.isDirectionalLight) put(2, l);
      else if (l.isRectAreaLight) put(3, l);
      else if (l.isHemisphereLight) put(4, l);
    }
    if (changed) maskTex.needsUpdate = true;
  }
  const prevBefore = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, cam, rt) {
    prevBefore?.call(this, r, s, cam, rt);
    updateMasks(cam);
  };

  // --- переотражения: кубические снимки зондов в один атлас, SH на процессоре, сетка в текстуру
  const P = Z.probes, nP = P.length;
  const atlas = new THREE.WebGLRenderTarget(6 * FACE, FACE * nP, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  atlas.texture.colorSpace = THREE.LinearSRGBColorSpace;
  disposables.push(atlas);
  const pixels = new Float32Array(6 * FACE * FACE * nP * 4);
  const probeCam = new THREE.PerspectiveCamera(90, 1, 0.03, 400);
  probeCam.layers.enableAll();   // все стены и потолки, даже спрятанные вырезом
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const UPS = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]];
  // направления и веса пикселей грани (камера смотрит вдоль F, вправо R, вверх U)
  const faceBasis = DIRS.map((d, f) => {
    probeCam.position.set(0, 0, 0); probeCam.up.set(...UPS[f]); probeCam.lookAt(...d); probeCam.updateMatrixWorld();
    const e = probeCam.matrixWorld.elements;
    return { R: [e[0], e[1], e[2]], Up: [e[4], e[5], e[6]], F: [-e[8], -e[9], -e[10]] };
  });
  const pixDir = new Float32Array(6 * FACE * FACE * 4);
  {
    let wsum = 0;
    for (let f = 0; f < 6; f++) for (let j = 0; j < FACE; j++) for (let i = 0; i < FACE; i++) {
      const x = (i + 0.5) / FACE * 2 - 1, y = (j + 0.5) / FACE * 2 - 1, { R, Up, F } = faceBasis[f];
      let dx = F[0] + x * R[0] + y * Up[0], dy = F[1] + x * R[1] + y * Up[1], dz = F[2] + x * R[2] + y * Up[2];
      const len = Math.hypot(dx, dy, dz), w = 1 / Math.pow(1 + x * x + y * y, 1.5);
      const k = ((f * FACE + j) * FACE + i) * 4;
      pixDir[k] = dx / len; pixDir[k + 1] = dy / len; pixDir[k + 2] = dz / len; pixDir[k + 3] = w; wsum += w;
    }
    for (let k = 3; k < pixDir.length; k += 4) pixDir[k] *= 4 * Math.PI / wsum;
  }
  const basisPix = new Float32Array(6 * FACE * FACE * 9);
  { const tmp = new Array(9); for (let p = 0; p < 6 * FACE * FACE; p++) { shBasis(pixDir[p * 4], pixDir[p * 4 + 1], pixDir[p * 4 + 2], tmp); for (let j = 0; j < 9; j++) basisPix[p * 9 + j] = tmp[j] * pixDir[p * 4 + 3]; } }

  const probeSH = P.map(() => new Float32Array(27));
  const target = new Float32Array(gridShow.image.data.length);   // куда плавно идёт показ
  let bake = null, dirty = true, dirtyAt = 0, generation = 0, hasGI = false, blending = false;

  function projectProbe(p) {
    const sh = probeSH[p]; sh.fill(0);
    const rowW = 6 * FACE;
    for (let f = 0; f < 6; f++) for (let j = 0; j < FACE; j++) for (let i = 0; i < FACE; i++) {
      const src = (((p * FACE + j) * rowW) + f * FACE + i) * 4;
      const R = pixels[src], G = pixels[src + 1], B = pixels[src + 2];
      if (!(R + G + B > 0) || !Number.isFinite(R + G + B)) continue;
      const bp = ((f * FACE + j) * FACE + i) * 9;
      for (let k = 0; k < 9; k++) { const w = basisPix[bp + k]; sh[k * 3] += R * w; sh[k * 3 + 1] += G * w; sh[k * 3 + 2] += B * w; }
    }
  }
  // Сетка: в ячейке зоны — сглаживание по Шепарду её зондов; в ячейке проёма — зондов соседних комнат
  function fillGrid(out) {
    const zoneProbes = Z.zones.map(z => {
      const src = z.kind === 'opening' ? z.adj.filter(a => a > 0) : [z.index];
      return P.map((p, i) => i).filter(i => src.includes(P[i].zone));
    });
    const acc = new Float32Array(27);
    for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) {
      const zc = cellZone[j * gx + i], base = (j * gx * 10 + i * 10) * 4;
      out[base] = zc;
      const list = zoneProbes[zc] || [];
      acc.fill(0);
      if (list.length) {
        const x = gridX0 + (i + 0.5) * CELL, z = gridZ0 + (j + 0.5) * CELL;
        let ws = 0;
        for (const pi of list) {
          const d2 = (P[pi].x - x) ** 2 + (P[pi].z - z) ** 2, w = 1 / (d2 + 0.3) ** 2;
          ws += w; const s = probeSH[pi];
          for (let k = 0; k < 27; k++) acc[k] += s[k] * w;
        }
        for (let k = 0; k < 27; k++) acc[k] /= ws;
      }
      for (let k = 0; k < 9; k++) { const t = base + (1 + k) * 4; out[t] = acc[k * 3]; out[t + 1] = acc[k * 3 + 1]; out[t + 2] = acc[k * 3 + 2]; out[t + 3] = 1; }
    }
    // средние по зонам — запасной вариант для узких мест
    const mean = Z.zones.map(z => {
      const src = z.kind === 'opening' ? z.adj.filter(a => a > 0) : [z.index];
      const list = P.map((p, i) => i).filter(i => src.includes(P[i].zone));
      const m = new Float32Array(27);
      for (const pi of list) for (let k = 0; k < 27; k++) m[k] += probeSH[pi][k] / list.length;
      return m;
    });
    mean.forEach((m, zi) => {
      const base = ((gz + zi) * gx * 10) * 4;
      for (let k = 0; k < 9; k++) { const t = base + (1 + k) * 4; out[t] = m[k * 3]; out[t + 1] = m[k * 3 + 1]; out[t + 2] = m[k * 3 + 2]; out[t + 3] = 1; }
    });
  }

  const savedClear = new THREE.Color();
  function renderProbes(from, to) {
    const bg = scene.background, rt = renderer.getRenderTarget(), auto = renderer.shadowMap.autoUpdate;
    const clearA = renderer.getClearAlpha(); renderer.getClearColor(savedClear);
    const grid = U.rlGrid.value;
    scene.background = null;                  // небо в окне уже дают прямоугольники окон
    renderer.setClearColor(0x000000, 1);
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
    U.rlGrid.value = gridBake;
    U.rlGridB.value.z = 1;
    try {
      for (let p = from; p < to; p++) {
        const q = P[p];
        for (let f = 0; f < 6; f++) {
          probeCam.position.set(q.x, q.y, q.z);
          probeCam.up.set(...UPS[f]);
          probeCam.lookAt(q.x + DIRS[f][0], q.y + DIRS[f][1], q.z + DIRS[f][2]);
          probeCam.updateMatrixWorld();
          atlas.viewport.set(f * FACE, p * FACE, FACE, FACE);
          atlas.scissor.set(f * FACE, p * FACE, FACE, FACE);
          atlas.scissorTest = true;
          renderer.setRenderTarget(atlas);
          renderer.render(scene, probeCam);
        }
      }
    } finally {
      U.rlGrid.value = grid;
      U.rlGridB.value.z = hasGI ? 1 : 0;
      scene.background = bg;
      renderer.setClearColor(savedClear, clearA);
      renderer.shadowMap.autoUpdate = auto;
      renderer.setRenderTarget(rt);
    }
  }

  function stepBake(now) {
    if (dirty && now - dirtyAt > 120) {
      dirty = false; generation++;
      bake = { gen: generation, pass: 0, next: 0, reading: false };
      // первый проход — только прямой свет: сетка пересчёта обнуляется (кроме номеров зон ячеек)
      const d = gridBake.image.data;
      for (let i = 0; i < d.length; i++) if (i % 40 !== 0) d[i] = 0;
      gridBake.needsUpdate = true;
    }
    if (!bake || bake.reading) return false;
    if (bake.next < nP) {
      const to = Math.min(nP, bake.next + PROBES_PER_FRAME);
      renderProbes(bake.next, to);
      bake.next = to;
      return false;
    }
    bake.reading = true;
    const job = bake;
    atlas.scissorTest = false; atlas.viewport.set(0, 0, atlas.width, atlas.height);
    renderer.readRenderTargetPixelsAsync(atlas, 0, 0, atlas.width, atlas.height, pixels).then(() => {
      if (job !== bake || job.gen !== generation) return;
      for (let p = 0; p < nP; p++) projectProbe(p);
      fillGrid(gridBake.image.data); gridBake.needsUpdate = true;
      job.reading = false; job.pass++; job.next = 0;
      if (job.pass >= BOUNCES) {
        bake = null; mirrorsDirty = true;
        if (!hasGI) { gridShow.image.data.set(gridBake.image.data); gridShow.needsUpdate = true; hasGI = true; U.rlGridB.value.z = 1; giActive = true; }
        else { target.set(gridBake.image.data); blending = true; }
        requestRender();
      }
    }).catch(err => { console.warn('lighting: зонды не прочитались', err); bake = null; });
    return false;
  }

  function blendStep() {
    if (!blending) return false;
    const d = gridShow.image.data;
    let maxDiff = 0;
    for (let i = 0; i < d.length; i++) {
      if (i % 40 === 0) continue;   // текстель зоны ячейки
      const diff = target[i] - d[i];
      d[i] += diff * 0.3;
      maxDiff = Math.max(maxDiff, Math.abs(diff));
    }
    gridShow.needsUpdate = true;
    if (maxDiff < 1e-4) { d.set(target); blending = false; }
    return true;
  }

  // --- экспозиция: внутри — поправка «глаза», снаружи — половина
  const current = { mode: null, state: null };
  let inside = 1, lastT = 0;
  function exposure() {
    if (!current.state) return;
    const base = EXPOSURE_IN[current.mode] ?? 1;
    const k = Math.pow(base, OUTSIDE_STOPS + (1 - OUTSIDE_STOPS) * inside);
    renderer.toneMappingExposure = (current.state.exposure ?? 1) * k;
  }
  function adapt(now) {
    if (!camera) return false;
    const p = camera.position;
    // Сверху (потолок срезан) смотрим в комнаты, а не на улицу: почти полная поправка, иначе «кукольный домик» тёмный
    const look = controls?.target ?? null;
    const overRooms = p.y >= H && (!look || Z.lookup(look.x, 1.2, look.z) > 0);
    const want = p.y < H && Z.lookup(p.x, Math.max(0.1, p.y), p.z) > 0 ? 1 : (overRooms ? ABOVE_ADAPT : 0);
    const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
    if (Math.abs(want - inside) < 1e-3) { inside = want; return false; }
    inside += (want - inside) * (1 - Math.exp(-dt / 0.35));
    exposure();
    return true;
  }

  // --- применение режима
  const sunWarm = new THREE.Color(0xffb46a), sunWhite = new THREE.Color(0xfff1dc);
  function airmass(elDeg) { return 1 / (Math.sin(THREE.MathUtils.degToRad(elDeg)) + 0.50572 * Math.pow(elDeg + 6.07995, -1.6364)); }
  const meinel = el => Math.pow(0.7, Math.pow(airmass(el), 0.678));

  function fitSunShadow() {
    const s = sun.shadow.camera;
    shadowCam.position.copy(sun.position); shadowCam.up.set(0, 1, 0); shadowCam.lookAt(sun.target.position); shadowCam.updateMatrixWorld();
    const inv = shadowCam.matrixWorldInverse, v = new THREE.Vector3();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? receivers.max.x : receivers.min.x, i & 2 ? receivers.max.y : receivers.min.y, i & 4 ? receivers.max.z : receivers.min.z).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); z0 = Math.min(z0, v.z);
    }
    // ближняя плоскость — у самого солнца: этажи дома над квартирой тоже дают тень
    Object.assign(s, { left: x0, right: x1, bottom: y0, top: y1, near: 0.5, far: -z0 + 1 });
    s.updateProjectionMatrix();
    sun.shadow.bias = -0.004 / (s.far - s.near);   // ~4 мм по глубине
  }

  function apply(mode = getState?.().light ?? 'day', state = getState?.() ?? {}) {
    current.mode = mode; current.state = state;
    const e = env[mode] ?? env.day;
    const az = THREE.MathUtils.degToRad(state.sunAz ?? 25), elDeg = Math.max(0.5, state.sunEl ?? 40), el = THREE.MathUtils.degToRad(elDeg);
    let theta = 0;
    if (e) {
      scene.background = e.bg; scene.environment = e.env;
      theta = e.sunPsi - Math.atan2(-Math.cos(az), Math.sin(az));   // солнце панорамы — по направлению солнца
      scene.backgroundRotation.set(0, theta, 0);
      scene.environmentRotation.set(0, theta, 0);
      U.rlEnvSH.value.forEach((v, j) => v.set(e.sh[j * 3], e.sh[j * 3 + 1], e.sh[j * 3 + 2]));
    }
    scene.environmentIntensity = ENV_INTENSITY[mode] ?? 1;
    scene.backgroundIntensity = BG_INTENSITY[mode] ?? 1;
    scene.backgroundBlurriness = 0;

    const c = receivers.getCenter(new THREE.Vector3());
    sun.target.position.copy(c);
    sun.position.set(c.x + Math.sin(az) * Math.cos(el) * 80, c.y + Math.sin(el) * 80, c.z - Math.cos(az) * Math.cos(el) * 80);
    sun.target.updateMatrixWorld();
    sun.visible = mode === 'day' && state.sunUp !== false;
    // у горизонта солнце слабее и теплее (атмосфера, формула Мейнела)
    sun.intensity = SUN_LUX * Math.min(1, meinel(elDeg) / meinel(43));
    sun.color.copy(sunWhite).lerp(sunWarm, THREE.MathUtils.smoothstep(18 - elDeg, 0, 15));
    fitSunShadow();

    const gain = (ENV_INTENSITY[mode] ?? 1) * GLASS_T;
    for (const w of windows) {
      let L = [0.3, 0.33, 0.38];   // пока панорама грузится
      if (e) L = windowRadiance(e.sky, theta, w.n, w.occEl);
      const Y = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
      w.light.color.setRGB(L[0] / Math.max(Y, 1e-6), L[1] / Math.max(Y, 1e-6), L[2] / Math.max(Y, 1e-6), THREE.LinearSRGBColorSpace);
      w.light.intensity = Y * gain;
    }
    exposure();
    invalidate();
  }

  function invalidate() { dirty = true; dirtyAt = performance.now(); mirrorsDirty = true; requestRender(); }

  function update() {
    const now = performance.now();
    patchScene();
    let changed = adapt(now);
    stepBake(now);
    if (blendStep()) changed = true;
    // зеркала — когда переотражения досчитаны (или их ещё нет вовсе)
    if (mirrors.length && mirrorsDirty && !bake && !blending && !(dirty && hasGI)) { renderMirrors(); changed = true; }
    return changed;
  }

  function setQuality(q) {
    const s = q === 'high' || q === 'ultra' ? 4096 : 2048;
    sun.shadow.mapSize.set(s, s);
    sun.shadow.map?.dispose(); sun.shadow.map = null;
  }

  function dispose() {
    scene.onBeforeRender = prevBefore ?? (() => {});
    scene.remove(sun, sun.target, ...windows.map(w => w.light));
    for (const d of disposables) d.dispose?.();
    maskTex.dispose(); pmrem.dispose();
  }

  // для проверок из консоли / тестовой страницы
  const debug = {
    zones: Z, probes: P, get hasGI() { return hasGI; }, get baking() { return !!bake || dirty; },
    probeSH, irradianceAt(p, n = [0, 1, 0]) { return shIrradiance(probeSH[p], ...n); }, U,
  };

  return { apply, update, invalidate, setQuality, dispose, ready, sun, lights: [sun, ...windows.map(w => w.light)], windows: windows.map(w => w.light), debug };
}
