// Pure alpine height field. Coordinates and derivatives are in metres.
// The same function drives ground patches, snow feel and the room's collision.
export const SNOW_START = Object.freeze({ x: 0, y: 0, z: 0 });
export const SNOW_TILE = 64;
const DEFAULTS = Object.freeze({
  baseGrade: 0.315, plateau: 6, runIn: 16, minWidth: 64, maxWidth: 106, treeLineExtent: 360,
});
const REGION_LENGTH = 186;
const ROLLER_SPACING = 112;
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
  const p1 = phase(1), p2 = phase(2);
  const c1 = phase(4), c2 = phase(5), c3 = phase(6);
  const originLevels = [Math.sin(p1), Math.sin(p2)];
  const k1 = seed ^ 0x93684a1f, k2 = seed ^ 0x10dafc7d, k3 = seed ^ 0x766da48d;
  const forest = new Map();

  function course(z, out = {}) {
    const d = -z;
    const t = runDistance(d, settings.plateau, settings.runIn);
    const steady = between(settings.plateau + 3, 72, d);
    const region = Math.floor(t / REGION_LENGTH), regionT = t / REGION_LENGTH - region;
    const regionHeight = (snowHash(region, 472, k1) - 0.5) * 7.2;
    const fold = Math.sin(t / 91 + p1), roll = Math.sin(t / 29 + p2);
    // A seeded section envelope changes the skyline and grade without
    // carrying cumulative height state or creating a seam at region edges.
    const rim = Math.sin(Math.PI * regionT);
    out.x = steady * (Math.sin(d / 94 + c1) * 20 + Math.sin(d / 41 + c2) * 7);
    out.y = -settings.baseGrade * t + (fold - originLevels[0]) * 8.1 +
      (roll - originLevels[1]) * 2.1 + regionHeight * rim ** 4;
    out.z = z;
    out.width = lerp(settings.minWidth, settings.maxWidth, 0.5 + 0.5 * Math.sin(d / 124 + c3));
    out.grade = (settings.baseGrade - Math.cos(t / 91 + p1) * (8.1 / 91) -
      Math.cos(t / 29 + p2) * (2.1 / 29) -
      4 * Math.PI / REGION_LENGTH * regionHeight * rim ** 3 * Math.cos(Math.PI * regionT)) *
      between(settings.plateau, settings.plateau + settings.runIn, d);
    out.bowl = 1.1 + 8.2 * noise(d / 158, 14, k1);
    out.relief = 5.8 + 6.7 * noise(d / 193, 16, k2);
    out.warp = 22 * Math.sin(d / 136 + c2);
    out.ramp = steady;
    out.reverseRamp = between(5, 42, z);

    // Each roller has one compact footprint and an asymmetric runout. Its
    // position, scale and direction differ between sections of the descent.
    const roller = Math.floor((d + ROLLER_SPACING / 2) / ROLLER_SPACING);
    const variation = snowHash(roller, 421, k3);
    out.rollerOrigin = roller * ROLLER_SPACING + (variation - 0.5) * 22;
    out.rollerSide = (snowHash(roller, 91, k2) - 0.5) * out.width * 1.62;
    out.rollerRise = 1.2 + variation * 2.65;
    out.rollerBreadth = 14 + snowHash(roller, 274, k1) * 22;
    out.rollerSkew = (snowHash(roller, 38, k3) - 0.5) * 0.50;
    return out;
  }

  function heightOnCourse(x, row) {
    const offset = x - row.x, lateral = Math.abs(offset), normalized = lateral / row.width;
    const z = row.z;
    const intro = 1 - (1 - row.ramp) * (1 - between(8, 38, lateral)) * (1 - row.reverseRamp);
    if (intro === 0) return row.y;

    const diagonal = z + offset * 0.28;
    const waves = (noise((x + row.warp) / 49, diagonal / 76, k1) - 0.5) * row.relief;
    const snowRoll = (noise(x / 12, diagonal / 24, k3) - 0.5) * 0.80;
    // A broad glacial basin can open onto a nearly flat shelf. Playable
    // cross slopes blend continuously into the rougher alpine terrain.
    const bowl = between(0, 1.65, normalized) * row.bowl;
    const outerShelf = between(0.92, 2.15, normalized);
    const foothills = outerShelf ? outerShelf * (noise(x / 93, z / 132, k2) - 0.33) * 29 : 0;
    const distanceFade = between(Math.max(136, row.width * 1.72), Math.max(404, row.width * 4.4), lateral);
    let massifs = 0;
    if (distanceFade > 0) {
      const massif = noise(x / 188, (z + 0.38 * x) / 170, k2);
      const shoulders = between(0.37, 0.93, massif);
      const ridge = 1 - Math.abs(noise(x / 98, z / 132, k1) * 2 - 1);
      const spine = between(0.51, 0.90, massif) * ridge;
      const faces = (noise(x / 29, z / 45, k3) - 0.5) * 22;
      const rock = (noise(x / 9, z / 17, k2) - 0.5) * 3.9;
      massifs = distanceFade * (shoulders * 112 + spine * 196 + shoulders * (faces + rock));
    }

    let lip = 0;
    const shift = offset - row.rollerSide;
    if (Math.abs(shift) < row.rollerBreadth) {
      const at = -z - row.rollerOrigin - shift * row.rollerSkew;
      const profile = at <= 0 ? between(-25, 0, at) : 1 - between(0, 16, at);
      lip = profile * (1 - between(2, row.rollerBreadth, Math.abs(shift))) * row.rollerRise;
    }
    return row.y + intro * (waves + bowl + snowRoll + foothills + massifs) + row.ramp * lip;
  }

  const row = {}, rowLo = {}, rowHi = {};
  const height = (x, z) => heightOnCourse(x, course(z, row));
  function snow(x, z, at = course(z, row)) {
    const lateral = Math.abs(x - at.x) / at.width;
    if (-z <= settings.plateau + settings.runIn) return 'groomed';
    const patch = noise(x / 16, z / 22, k3);
    const drift = noise(x / 74, z / 112, k2);
    if (lateral > 0.62 + 0.38 * patch || (drift < 0.34 && patch < 0.46)) return 'powder';
    if (patch > 0.8 - 0.16 * drift && lateral < 1.04) return 'ice';
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
      const trailhead = z < -29 && z > -205;
      // Trees form detached pockets downwind, away from the traversable
      // expanse. Their exact positions drive both scenery and collisions.
      const minimum = courseRow.width * (trailhead ? 0.88 : 1.06);
      if (lateral < minimum || lateral > settings.treeLineExtent) continue;
      const cluster = trailhead ? 1.05 : 1.42;
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
