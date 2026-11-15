// Настоящее солнце Варшавы и окружение дома (spec/site.json, его пишет tools/fetch_site.py).
//
//   sunFor('2026-11-15', 14, site)  -> { az, el, azAbs, ... }  az в соглашении приложения:
//                                      0 = прямо из окна, + = вправо, если смотреть наружу
//   sunTimes('2026-11-15', site)    -> { sunrise, noon, sunset }  местные часы (дробные)
//   formatSun('2026-11-15', 14, site) -> «Варшава, 15 ноября, 14:00 · солнце 18° над горизонтом»
//   buildContext(site, THREE)       -> THREE.Group: земля, дороги, свой дом вокруг квартиры, соседи
//
// Оси квартиры: X вдоль окон, Z от окон вглубь, Y вверх, метры; пол квартиры y = 0, земля y = −floorY.
// Модуль не импортирует three: THREE передаётся аргументом (так его можно проверять в node).

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

// ---------- окружение ----------

// Цвета простых материалов (без текстур фото): ноябрьская Варшава
const COLORS = {
  ground: 0x6c7049, field: 0x8c7b5a, grass: 0x667444, dirt: 0x86745f, paved: 0x8d8c88,
  road: 0x4a4b4d, path: 0xa29d93, own: 0xdcd6cc, roof: 0x7f7c78, balcony: 0xbdb8b0,
};
const WIN = { tile: 2.4, w: 1.3, sill: 0.9, head: 2.2 };   // окна на фасадах: шаг 2.4 м, проём 1.3 × 1.3

// Фасад с рядами окон: белый (цвет даёт материал), окна тёмные; 1 повтор = шаг окон × этаж
function windowTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 128, 128);
  const H = 3.1, px = v => v * 128;
  x.fillStyle = '#4b5159';
  x.fillRect(px((WIN.tile - WIN.w) / 2 / WIN.tile), px(1 - WIN.head / H), px(WIN.w / WIN.tile), px((WIN.head - WIN.sill) / H));
  x.fillStyle = '#e9e5de';   // плита перекрытия чуть светлее
  x.fillRect(0, px(1 - 0.12), 128, px(0.12));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

// Накопитель треугольников одного материала (без индексов, плоские нормали; b.color — цвет вершин, если задан)
function bucket() { return { pos: [], nrm: [], uv: [], col: [], color: null }; }
function tri(b, a, c, d, n, ua, uc, ud) {
  b.pos.push(...a, ...c, ...d); b.nrm.push(...n, ...n, ...n);
  b.uv.push(...(ua || [0, 0]), ...(uc || [0, 0]), ...(ud || [0, 0]));
  if (b.color) b.col.push(...b.color, ...b.color, ...b.color);
}

// Горизонтальный многоугольник на высоте y, лицом вверх (up) или вниз; uv = метры / uvScale
function cap(THREE, b, poly, y, up, uvScale = 1) {
  const pts = poly.map(([x, z]) => new THREE.Vector2(x, z));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) {
    let A = poly[i], B = poly[j], C = poly[k];
    const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);   // y-компонента нормали
    if ((ny > 0) !== up) [B, C] = [C, B];
    const v = p => [p[0], y, p[1]], u = p => [p[0] / uvScale, p[1] / uvScale];
    tri(b, v(A), v(B), v(C), [0, up ? 1 : -1, 0], u(A), u(B), u(C));
  }
}

// Призма: стены (uv: u — метры вдоль фасада / шаг окон, v — этажи от vBase) + крыша + дно.
// Глухой фасад: storey = h / 0.25, тогда вся стена ложится в полосу текстуры ниже подоконника.
function prism(THREE, walls, roofs, poly, y0, y1, storey = 3, vBase = y0) {
  if (poly.length < 3 || y1 <= y0) return;
  const s = Math.sign(signedArea(poly)) || 1;
  let run = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
    if (L < 1e-3) continue;
    const n = [s * dz / L, 0, -s * dx / L];
    const u0 = run / WIN.tile, u1 = (run + L) / WIN.tile; run += L;
    const v0 = (y0 - vBase) / storey, v1 = (y1 - vBase) / storey;
    const P0 = [p[0], y0, p[1]], P1 = [q[0], y0, q[1]], P2 = [q[0], y1, q[1]], P3 = [p[0], y1, p[1]];
    const t0 = [u0, v0], t1 = [u1, v0], t2 = [u1, v1], t3 = [u0, v1];
    if (s > 0) { tri(walls, P0, P2, P1, n, t0, t2, t1); tri(walls, P0, P3, P2, n, t0, t3, t2); }
    else { tri(walls, P0, P1, P2, n, t0, t1, t2); tri(walls, P0, P2, P3, n, t0, t2, t3); }
  }
  cap(THREE, roofs, poly, y1, true, 4);
  cap(THREE, roofs, poly, y0, false, 4);
}

// Полоса дороги по ломаной: стыки «в ус», длина уса ограничена
function strip(b, line, w, y) {
  const h = w / 2, n = line.length;
  if (n < 2) return;
  const nor = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = line[i + 1][0] - line[i][0], dz = line[i + 1][1] - line[i][1], L = Math.hypot(dx, dz) || 1;
    nor.push([-dz / L, dx / L]);
  }
  const off = line.map((p, i) => {
    const a = nor[Math.max(0, i - 1)], c = nor[Math.min(n - 2, i)];
    let mx = a[0] + c[0], mz = a[1] + c[1];
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = h / Math.max(0.5, mx * c[0] + mz * c[1]);
    return [[p[0] + mx * k, y, p[1] + mz * k], [p[0] - mx * k, y, p[1] - mz * k]];
  });
  const up = [0, 1, 0];
  for (let i = 0; i < n - 1; i++) {
    const [a, b2] = off[i], [c, d] = off[i + 1];
    // порядок вершин — лицом вверх при любом направлении линии
    const ny = (c[2] - a[2]) * (b2[0] - a[0]) - (c[0] - a[0]) * (b2[2] - a[2]);
    if (ny > 0) { tri(b, a, c, b2, up); tri(b, b2, c, d, up); } else { tri(b, a, b2, c, up); tri(b, b2, d, c, up); }
  }
}

function meshOf(THREE, b, material, name, { cast = true, receive = true } = {}) {
  if (!b.pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  if (b.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.name = name; m.castShadow = cast; m.receiveShadow = receive;
  m.userData.context = true;
  return m;
}

// Окружение одной группой. opts: { far: true } — дальние высокие дома (до 2 км, нужен camera.far ≥ 2500)
export function buildContext(site, THREE, opts = {}) {
  const { far = true } = opts;
  const fy = site.floorY, ground = -fy;
  const group = new THREE.Group(); group.name = 'context';
  const tex = windowTexture(THREE);
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
  const flat = (color, k) => std(color, { polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k });
  const M = {
    own: std(COLORS.own, { map: tex }), neighbour: std(0xffffff, { map: tex, vertexColors: true }),
    roof: std(COLORS.roof), balcony: std(COLORS.balcony),
    ground: std(COLORS.ground), road: flat(COLORS.road, 3), path: flat(COLORS.path, 4),
    field: flat(COLORS.field, 1), grass: flat(COLORS.grass, 1), dirt: flat(COLORS.dirt, 1), paved: flat(COLORS.paved, 2),
  };
  const parts = {};
  const add = (key, mesh) => { if (mesh) { parts[key] = mesh; group.add(mesh); } };

  // Земля: круг 2.5 км, только принимает тени
  const gg = new THREE.CircleGeometry(2500, 96); gg.rotateX(-Math.PI / 2);
  const gm = new THREE.Mesh(gg, M.ground); gm.position.y = ground; gm.receiveShadow = true; gm.name = 'ground';
  add('ground', gm);

  // Поле, газоны, площадки — плоские многоугольники на земле
  const areas = {};
  for (const a of site.areas ?? []) cap(THREE, areas[a.kind] ??= bucket(), a.poly, ground, true, 20);
  for (const [k, b] of Object.entries(areas)) add(`area_${k}`, meshOf(THREE, b, M[k], `area_${k}`, { cast: false }));

  // Дороги и дорожки
  const road = bucket(), path = bucket();
  for (const r of site.roads ?? []) strip(['footway', 'cycleway', 'path'].includes(r.kind) ? path : road, r.line, r.w, ground);
  add('roads', meshOf(THREE, road, M.road, 'roads', { cast: false }));
  add('paths', meshOf(THREE, path, M.path, 'paths', { cast: false }));

  // Свой дом: этажи под квартирой, соседние квартиры на нашем этаже, этажи над ней.
  // Окна на фасаде совпадают с этажами: v считается от пола партера.
  const vBase = ground + (site.groundRise ?? 0), st = site.storeyH ?? 3;
  const own = [bucket(), bucket()], above = [bucket(), bucket()];
  for (const m of site.ownMass ?? []) {
    const [w, r] = m.part === 'above' ? above : own;
    prism(THREE, w, r, m.poly, m.y0, m.y1, st, vBase);
  }
  const bal = bucket();
  for (const b of site.ownBalconies ?? []) {
    prism(THREE, bal, bal, [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]], b.y0, b.y1);
  }
  add('own', meshOf(THREE, own[0], M.own, 'own_walls'));
  add('ownRoof', meshOf(THREE, own[1], M.roof, 'own_caps'));
  add('balconies', meshOf(THREE, bal, M.balcony, 'own_balconies'));
  // Над квартирой: при взгляде сверху прячется тем же механизмом, что и верхний балкон (cut: 'above')
  const ab = new THREE.Group(); ab.name = 'own_above'; ab.userData.cut = 'above';
  for (const [b, mat, n] of [[above[0], M.own, 'own_above_walls'], [above[1], M.roof, 'own_above_caps']]) {
    const m = meshOf(THREE, b, mat, n); if (m) { m.userData.cut = 'above'; ab.add(m); }
  }
  add('ownAbove', ab);

  // Соседи до 400 м — отбрасывают тени; дальние высокие — только силуэт на горизонте
  // цвет фасада каждого дома (sRGB из site.json) -> линейный цвет вершин
  const tone = (bk, hex) => { const c = new THREE.Color(`#${hex ?? 'cdc8bf'}`); bk.color = [c.r, c.g, c.b]; };
  const nb = [bucket(), bucket()];
  for (const b of site.neighbours ?? []) { tone(nb[0], b.c); prism(THREE, nb[0], nb[1], b.poly, ground, ground + b.h, b.plain ? b.h / 0.25 : 3, ground); }
  add('neighbours', meshOf(THREE, nb[0], M.neighbour, 'neighbours'));
  add('neighbourRoofs', meshOf(THREE, nb[1], M.roof, 'neighbour_roofs'));
  if (far) {
    const fb = [bucket(), bucket()];
    for (const b of site.far ?? []) { tone(fb[0], b.c); prism(THREE, fb[0], fb[1], b.poly, ground, ground + b.h, b.plain ? b.h / 0.25 : 3, ground); }
    add('far', meshOf(THREE, fb[0], M.neighbour, 'far', { cast: false, receive: false }));
    add('farRoofs', meshOf(THREE, fb[1], M.roof, 'far_roofs', { cast: false, receive: false }));
  }

  group.userData.parts = parts;
  group.userData.materials = M;
  return group;
}
