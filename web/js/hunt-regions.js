// Pure shared habitat geometry: browser and authoritative server use the same site.
export function buildHuntRegions(site, rules, home, random = Math.random) {
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rand = (a, b) => a + random() * (b - a);
const FOOT = new Set(['footway', 'cycleway', 'path', 'pedestrian']);   // дорожки кабанам не помеха, дороги — да
function inPoly(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function segDist(ax, az, bx, bz, x, z) {
  const dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}
function ringDist(p, x, z) {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, segDist(p[j][0], p[j][1], p[i][0], p[i][1], x, z));
  return d;
}
function bboxOf(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, x1, z0, z1 };
}
const centroid = p => [p.reduce((s, v) => s + v[0], 0) / p.length, p.reduce((s, v) => s + v[1], 0) / p.length];

// Угодье: объединение многоугольников минус запреты (blocked). home — середина балкона: точки выбираются с весом
// по расстоянию от него (spec.region.near — основная полоса, ближе и дальше — реже).
//   inside(x, z), safe(x, z, m), clear(x0, z0, x1, z1) — путь по прямой без запретов,
//   point({ near: [x, z], r, far }) -> [x, z] (рядом с near — только куда дойти по прямой), dist(x, z)
function makeRegion(kind, polys, R, blocked, home, margin) {
  const box = bboxOf(polys.flat());
  const inside = (x, z) => {
    if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) return false;
    let ok = false;
    for (let i = 0; i < polys.length && !ok; i++) ok = inPoly(polys[i], x, z);
    return ok && !blocked(x, z);
  };
  // внутри с запасом m: точка и четыре соседние
  const safe = (x, z, m = margin) => inside(x, z) && inside(x + m, z) && inside(x - m, z) && inside(x, z + m) && inside(x, z - m);
  const clear = (x0, z0, x1, z1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 1.5);
    for (let i = 1; i < n; i++) if (!inside(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n)) return false;
    return true;
  };
  const dist = (x, z) => Math.hypot(x - home[0], z - home[1]);
  const weight = d => (d > R.maxDist ? 0.02 : d < R.near[0] ? R.closeWeight : d > R.near[1] ? R.farWeight : 1);
  // far — пополнение: за основной полосой (приходят издалека)
  const point = ({ near = null, r = Infinity, far = false } = {}) => {
    const local = near && r < Infinity;
    let any = null;
    for (let i = 0; i < 400; i++) {
      const x = local ? near[0] + rand(-r, r) : rand(box.x0, box.x1), z = local ? near[1] + rand(-r, r) : rand(box.z0, box.z1);
      if (!safe(x, z) || local && !clear(near[0], near[1], x, z)) continue;
      any ??= [x, z];
      const d = dist(x, z);
      if (random() < (far ? (d > R.near[1] ? 1 : 0.03) : weight(d))) return [x, z];
    }
    return any ?? (local ? [near[0], near[1]] : [(box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2]);
  };
  // площадь свободной части (оценка по выборке)
  let free = 0;
  for (let i = 0; i < 400; i++) if (safe(rand(box.x0, box.x1), rand(box.z0, box.z1))) free++;
  const area = free / 400 * (box.x1 - box.x0) * (box.z1 - box.z0);
  return { kind, polys, inside, safe, clear, point, dist, box, area, ok: polys.length > 0 && free > 0 };
}

// Все угодья: поле с лугами перед домом и «город» справа — открытая земля и газоны между дорогами, парковками,
// домами и заборами (spec.region.city.box). Запреты города заранее растрированы сеткой 1 м: проверка — один взгляд в массив.
function buildRegions(site, R, home) {
  const own = site.own?.footprint ?? [];
  const ownOff = (x, z) => inPoly(own, x, z) || ringDist(own, x, z) < R.keepOut;
  const front = p => { const [cx, cz] = centroid(p); return cz < 0 && Math.hypot(cx - home[0], cz - home[1]) < R.radius; };   // перед домом
  const fieldPolys = (site.areas ?? []).filter(a => R.kinds.includes(a.kind) && front(a.poly)).map(a => a.poly);
  const out = [];
  const field = makeRegion('field', fieldPolys, R, ownOff, home, R.margin);
  if (field.ok) out.push(field);
  const C = R.city;
  if (!C) return out;
  const [x0, x1, z0, z1] = C.box, pad = 12;
  const touches = pts => { const o = bboxOf(pts); return o.x1 > x0 - pad && o.x0 < x1 + pad && o.z1 > z0 - pad && o.z0 < z1 + pad; };
  const segs = [];   // [ax, az, bx, bz, запас]
  const addLine = (line, r) => { for (let i = 0; i < line.length - 1; i++) if (touches([line[i], line[i + 1]])) segs.push([line[i][0], line[i][1], line[i + 1][0], line[i + 1][1], r]); };
  for (const r of site.roads ?? []) if (!FOOT.has(r.kind)) addLine(r.line, r.w / 2 + C.roadPad);
  for (const f of site.fences ?? []) addLine(f.line, 0.8);
  const lots = (site.areas ?? []).filter(a => !C.kinds.includes(a.kind) && !R.kinds.includes(a.kind) && touches(a.poly)).map(a => a.poly);   // парковки, площадки
  const blds = (site.neighbours ?? []).map(n => n.poly).filter(touches);
  const W = Math.ceil(x1 - x0), H = Math.ceil(z1 - z0), mask = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + i + 0.5, z = z0 + j + 0.5;
    if (Math.hypot(x - home[0], z - home[1]) > C.maxDist || ownOff(x, z) || fieldPolys.some(p => inPoly(p, x, z))) continue;
    let ok = true;
    for (let k = 0; k < segs.length && ok; k++) { const s = segs[k]; if (segDist(s[0], s[1], s[2], s[3], x, z) < s[4]) ok = false; }
    for (let k = 0; k < lots.length && ok; k++) if (inPoly(lots[k], x, z)) ok = false;
    for (let k = 0; k < blds.length && ok; k++) if (inPoly(blds[k], x, z) || ringDist(blds[k], x, z) < C.buildingPad) ok = false;
    if (ok) mask[j * W + i] = 1;
  }
  const blocked = (x, z) => !mask[Math.floor(z - z0) * W + Math.floor(x - x0)];
  const city = makeRegion('city', [[[x0, z0], [x1, z0], [x1, z1], [x0, z1]]], R, blocked, home, C.margin);
  if (city.ok && city.area >= C.minArea) out.push(city);
  return out;
}

  return buildRegions(site, rules, home);
}
