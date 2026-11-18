// Pure alpine height field. Coordinates and derivatives are in metres.
// The same function drives ground patches, snow feel and the room's collision.
export const SNOW_START = Object.freeze({ x: 0, y: 0, z: 0 });
export const SNOW_TILE = 64;
const DEFAULTS = Object.freeze({ baseGrade: 0.30, plateau: 6, runIn: 12, minWidth: 21, maxWidth: 38, recoveryWidth: 106 });
const TAU = Math.PI * 2;
const DERIVATIVE_STEP = 0.22;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => k * k * (3 - 2 * k);
const between = (lo, hi, x) => smooth(clamp((x - lo) / (hi - lo), 0, 1));

export function snowHash(x, z, seed = 0) {
  let bits = Math.imul(x | 0, 0x45d9f3b) ^ Math.imul(z | 0, 0x27d4eb2d) ^ seed;
  bits = Math.imul(bits ^ (bits >>> 16), 0x21f0aaad);
  bits = Math.imul(bits ^ (bits >>> 15), 0x735a2d97);
  return ((bits ^ (bits >>> 15)) >>> 0) / 4294967296;
}

function noise(x, z, key) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const dx = smooth(x - ix), dz = smooth(z - iz);
  return lerp(
    lerp(snowHash(ix, iz, key), snowHash(ix + 1, iz, key), dx),
    lerp(snowHash(ix, iz + 1, key), snowHash(ix + 1, iz + 1, key), dx), dz);
}

// Continuous grade throughout each turn-in. This primitive is integrated to
// keep the plateau and slope tangent continuous across the run-in.
function runDistance(d, plateau, stretch) {
  const u = (d - plateau) / stretch;
  if (u <= 0) return 0;
  if (u >= 1) return d - plateau - stretch / 2;
  return stretch * (u ** 3 - u ** 4 / 2);
}

export function createSnowWorld(seed, config = {}) {
  seed >>>= 0;
  const settings = { ...DEFAULTS, ...config };
  const phase = i => snowHash(i, 0, seed) * TAU;
  const p1 = phase(1), p2 = phase(2), p3 = phase(3);
  const c1 = phase(4), c2 = phase(5), c3 = phase(6);
  const originLevels = [Math.sin(p1), Math.sin(p2), Math.sin(p3)];
  const k1 = seed ^ 0x93684a1f, k2 = seed ^ 0x10dafc7d, k3 = seed ^ 0x766da48d;
  const forest = new Map();

  function course(z, out = {}) {
    const d = -z;
    const t = runDistance(d, settings.plateau, settings.runIn);
    const steady = between(settings.plateau + 3, 94, d);
    const sin1 = Math.sin(t / 82 + p1), sin2 = Math.sin(t / 35 + p2), sin3 = Math.sin(t / 12 + p3);
    out.x = steady * (Math.sin(d / 76 + c1) * 23 + Math.sin(d / 38 + c2) * 9);
    out.y = -settings.baseGrade * t +
      (sin1 - originLevels[0]) * 7.8 + (sin2 - originLevels[1]) * 2.3 + (sin3 - originLevels[2]) * 0.52;
    out.z = z;
    out.width = lerp(settings.minWidth, settings.maxWidth, 0.5 + 0.5 * Math.sin(d / 105 + c3)) * lerp(0.85, 1, steady);
    out.grade = settings.baseGrade - Math.cos(t / 82 + p1) * (7.8 / 82) -
      Math.cos(t / 35 + p2) * (2.3 / 35) - Math.cos(t / 12 + p3) * (0.52 / 12);
    out.grade *= between(settings.plateau, settings.plateau + settings.runIn, d);
    out.zone = Math.floor(Math.max(0, d) / 240) % 3;
    out.ridgeLeft = 188 + 44 * Math.sin(d / 165 + p2);
    out.ridgeRight = 205 + 38 * Math.sin(d / 144 + c1);
    out.leftRise = 92 + 168 * Math.abs(Math.sin(d / 108 + c2)) ** 3;
    out.rightRise = 103 + 183 * Math.abs(Math.sin(d / 137 + p3)) ** 3;
    out.ramp = steady;
    return out;
  }

  function heightOnCourse(x, row) {
    const z = row.z;
    const d = -z;
    const xOffset = x - row.x, lateral = Math.abs(xOffset);
    const turnIn = row.ramp;
    const routeCulture = between(8, row.width * 1.08, lateral);
    const bankNear = between(row.width * 0.43, row.width * 1.8, lateral);
    // Short rolling rises have a flat approach and a forgiving landing.
    const lipCell = Math.floor((d + 32) / 83);
    const lipSeed = snowHash(lipCell, 421, k3);
    const lipOrigin = lipCell * 83 + (lipSeed - 0.5) * 32;
    const kickSide = (snowHash(lipCell, 91, k2) - 0.5) * row.width * 0.85;
    const lipOffset = d - lipOrigin;
    const crest = lipOffset < 0 ? between(-12, 0, lipOffset) : 1 - between(0, 6, lipOffset);
    const jump = crest * (1 - between(1, 8, Math.abs(xOffset - kickSide))) * (0.71 + lipSeed * 1.35);

    const rolling = (noise(x / 18, z / 31, k1) - 0.5) * 2.8 +
      (noise(x / 7, z / 11, k2) - 0.5) * 0.48;
    const bank = (2.9 + 2.4 * noise(x / 36, z / 62, k3)) * bankNear;
    const rockiness = between(row.width + 4, 240, lateral);
    const massif = Math.pow(noise(x / 220, z / 246, k2), 2.25);
    const ridge = 1 - Math.abs(noise(x / 65, z / 91, k1) * 2 - 1);
    const serrated = (noise(x / 19, z / 33, k3) - 0.5) * 9;
    const broken = (noise(x / 27, z / 32, k2) - 0.45) * 11 + serrated;
    const ridgeCenter = xOffset < 0 ? row.ridgeLeft : row.ridgeRight;
    const ridgeHeight = xOffset < 0 ? row.leftRise : row.rightRise;
    const shoulder = Math.max(0, 1 - Math.abs(lateral - ridgeCenter) / 150);
    const scree = Math.max(0, shoulder) ** 1.4 * (ridgeHeight + broken * 2.5);
    const mountain = scree * between(row.width, row.width + 38, lateral) + rockiness * ((massif * 275 + 54 * ridge * massif + broken) * (0.7 + 0.3 * Math.min(1, lateral / 240)));
    // The start platform stays in the threshold plane, then opens naturally.
    const intro = Math.max(turnIn, between(9, 34, lateral), between(5, 36, z));
    return row.y + intro * (rolling * (0.3 + routeCulture * 0.7) + bank + mountain) + turnIn * jump;
  }

  const row = {}, rowLo = {}, rowHi = {};
  const height = (x, z) => heightOnCourse(x, course(z, row));
  function snow(x, z, at = course(z, row)) {
    const lateral = Math.abs(x - at.x) / at.width;
    if (-z <= settings.plateau + 16) return 'groomed';
    const patch = noise(x / 9, z / 14, k3);
    if (lateral > 0.62 + 0.42 * patch || (at.zone === 1 && lateral > 0.29 && patch < 0.55)) return 'powder';
    if (patch > (at.zone === 2 ? 0.64 : 0.8) && lateral < 0.72) return 'ice';
    return 'groomed';
  }
  function sample(x, z, out = {}) {
    const here = course(z, row);
    out.height = heightOnCourse(x, here);
    const span = DERIVATIVE_STEP * 2;
    out.dx = (heightOnCourse(x + DERIVATIVE_STEP, here) - heightOnCourse(x - DERIVATIVE_STEP, here)) / span;
    out.dz = (heightOnCourse(x, course(z + DERIVATIVE_STEP, rowHi)) -
      heightOnCourse(x, course(z - DERIVATIVE_STEP, rowLo))) / span;
    out.snow = snow(x, z, here);
    return out;
  }

  function decoration(tileX, tileZ, span = SNOW_TILE) {
    const id = tileX + ':' + tileZ + ':' + span;
    const cached = forest.get(id);
    if (cached) return cached;
    const output = [];
    const stratified = 5, size = span / stratified;
    const at = {}, ground = {};
    for (let row = 0; row < stratified; row++) for (let column = 0; column < stratified; column++) {
      const a = tileX * stratified + column, b = tileZ * stratified + row;
      const f = snowHash(a, b, k1);
      const x = tileX * span + (column + 0.12 + f * 0.76) * size;
      const z = tileZ * span + (row + 0.12 + snowHash(a, b, k3) * 0.76) * size;
      const courseRow = course(z, at), lateral = Math.abs(x - courseRow.x);
      const woodland = noise(x / 94, z / 107, k3);
      const trailhead = z < -29 && z > -190;
      const forestEdge = trailhead ? Math.max(21, courseRow.width * 0.54 + 8) : courseRow.width * 0.83 + 7;
      if (lateral < forestEdge || lateral > settings.recoveryWidth * 1.65) continue;
      if (z > -29 && Math.abs(x) < 40) continue;
      const cluster = trailhead && Math.abs(lateral - forestEdge) < 18 ? 0.78 : (courseRow.zone === 2 ? 1.25 : 0.97);
      if (f + woodland < cluster) continue;
      sample(x, z, ground);
      const grade = Math.hypot(ground.dx, ground.dz);
      if (grade > 0.81) continue;
      const h = 3.0 + 9 * f * f;
      const snowcap = 0.35 + snowHash(a, b, k2) * 0.6;
      output.push({ x, y: ground.height, z, h, snowcap, rotation: woodland * TAU, radius: Math.max(0.34, h * 0.07) });
    }
    forest.set(id, output);
    if (forest.size > 112) forest.delete(forest.keys().next().value);
    return output;
  }

  // Trees are stratified well outside the primary route. The query returns the
  // deepest hit; callers can use the same trunk positions as the rendering.
  function obstacle(x, z, radius = 0.32) {
    const tx = Math.floor(x / SNOW_TILE), tz = Math.floor(z / SNOW_TILE);
    const near = 2 + radius;
    const dx = x - tx * SNOW_TILE, dz = z - tz * SNOW_TILE;
    const x0 = dx < near ? tx - 1 : tx, x1 = dx > SNOW_TILE - near ? tx + 1 : tx;
    const z0 = dz < near ? tz - 1 : tz, z1 = dz > SNOW_TILE - near ? tz + 1 : tz;
    let best = null, prevDepth = 0;
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      for (const trunk of decoration(i, j)) {
        const dist = Math.hypot(x - trunk.x, z - trunk.z);
        const depth = trunk.radius + radius - dist;
        if (depth > prevDepth) { best = trunk; prevDepth = depth; }
      }
    }
    return best;
  }

  return { seed, settings, start: SNOW_START, height, heightOnCourse, sample, course, snow, decoration, obstacle };
}
