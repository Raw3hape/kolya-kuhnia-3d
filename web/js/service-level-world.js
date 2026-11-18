// Seeded office floorplan shared by clients, collision and the session host.
// Regions independently connect every cell. Adjacent regions share a seeded border passage.
export const SERVICE_LEVEL_ORIGIN = Object.freeze({ x: 0, z: 0 });
export const SERVICE_LEVEL_CELL_SIZE = 4.8;
export const SERVICE_LEVEL_HEIGHT = 2.63;
export const SERVICE_LEVEL_REGION_SIZE = 4;
export const SERVICE_LEVEL_WALL_THICKNESS = 0.16;

const CELL = SERVICE_LEVEL_CELL_SIZE;
const REGION = SERVICE_LEVEL_REGION_SIZE;
const REGION_CELLS = REGION ** 2;
const HALF_WALL = SERVICE_LEVEL_WALL_THICKNESS / 2;
const CACHE_SIZE = 96;
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const X_AXIS = 0;
const Z_AXIS = 1;
const EPSILON = 1e-7;

function mix(value) {
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

function seedOf(value) {
  if (typeof value === 'number') return value >>> 0;
  let seed = 0x811c9dc5;
  for (const char of String(value ?? 'service-level')) {
    seed = Math.imul(seed ^ char.codePointAt(0), 0x01000193);
  }
  return seed >>> 0;
}

export function serviceLevelHash(seed, x, z, channel = 0) {
  return mix(seed ^ Math.imul(x, 0x7feb352d) ^ Math.imul(z, 0x846ca68b) ^ Math.imul(channel, 0x9e3779b9));
}

const key = (x, z) => x + ',' + z;
const cellIndex = (position) => Math.floor(position / CELL + 0.5);
const regionIndex = (cell) => Math.floor(cell / REGION);
const cellAt = (x, z) => ({ x: cellIndex(x), z: cellIndex(z) });
const cellCenter = (x, z) => ({ x: x * CELL, z: z * CELL });

function entranceWidth(x, z, axis) {
  if (axis !== Z_AXIS || x !== 0 || z < -2 || z > 0) return 0;
  return z === -2 ? CELL : z === -1 ? 2.85 : 3.04;
}

function widthFor(hash) {
  const type = (hash >>> 12) % 16;
  if (type < 2) return CELL;
  if (type < 6) return 2.76;
  if (type < 11) return 2.14;
  return 1.6;
}

function buildRegion(seed, rx, rz) {
  const openings = new Float32Array(REGION_CELLS * 2);
  const parent = Array.from({ length: REGION_CELLS }, (_, i) => i);
  const edges = [];
  function addEdge(x, z, axis, step) {
    const id = z * REGION + x;
    const wx = rx * REGION + x;
    const wz = rz * REGION + z;
    const entrance = entranceWidth(wx, wz, axis);
    const hash = serviceLevelHash(seed, wx, wz, axis + 1);
    edges.push({ a: id, b: id + step, axis, rank: entrance ? -1 : hash,
      width: entrance || widthFor(hash) });
  }
  for (let z = 0; z < REGION; z += 1) {
    for (let x = 0; x < REGION; x += 1) {
      if (x < REGION - 1) addEdge(x, z, X_AXIS, 1);
      if (z < REGION - 1) addEdge(x, z, Z_AXIS, REGION);
    }
  }
  function root(id) {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]];
      id = parent[id];
    }
    return id;
  }
  edges.sort((a, b) => a.rank - b.rank);
  for (const edge of edges) {
    const a = root(edge.a), b = root(edge.b);
    if (a === b && (edge.rank % 7) > 1) continue;
    parent[b] = a;
    openings[edge.a * 2 + edge.axis] = edge.width;
  }
  return { rx, rz, openings, cells: new Array(REGION_CELLS) };
}

function segmentsFor(cx, cz, axis, opening, offset) {
  if (opening >= CELL - EPSILON) return [];
  const boundary = ((axis === X_AXIS ? cx : cz) + 0.5) * CELL;
  const center = (axis === X_AXIS ? cz : cx) * CELL;
  const start = center - CELL / 2;
  const end = center + CELL / 2;
  const doorway = center + offset;
  const spans = opening > 0
    ? [[start, doorway - opening / 2], [doorway + opening / 2, end]]
    : [[start, end]];
  return spans.map(([low, high]) => axis === X_AXIS
    ? { minX: boundary - HALF_WALL, maxX: boundary + HALF_WALL, minZ: low, maxZ: high }
    : { minX: low, maxX: high, minZ: boundary - HALF_WALL, maxZ: boundary + HALF_WALL });
}

function roomIndex(cx, cz, region) {
  return (cz - region.rz * REGION) * REGION + cx - region.rx * REGION;
}

function rayRect(x, z, dx, dz, wall, limit, radius) {
  let near = 0, far = limit;
  const minX = wall.minX - radius, maxX = wall.maxX + radius;
  const minZ = wall.minZ - radius, maxZ = wall.maxZ + radius;
  if (dx === 0) {
    if (x < minX || x > maxX) return limit;
  } else {
    const left = (minX - x) / dx, right = (maxX - x) / dx;
    near = Math.max(near, Math.min(left, right));
    far = Math.min(far, Math.max(left, right));
  }
  if (dz === 0) {
    if (z < minZ || z > maxZ) return limit;
  } else {
    const top = (minZ - z) / dz, bottom = (maxZ - z) / dz;
    near = Math.max(near, Math.min(top, bottom));
    far = Math.min(far, Math.max(top, bottom));
  }
  return near <= far ? near : limit;
}

export function createServiceLevelWorld(value) {
  const seed = seedOf(value);
  const cache = new Map();

  function regionAt(rx, rz) {
    const id = key(rx, rz);
    let region = cache.get(id);
    if (!region) {
      region = buildRegion(seed, rx, rz);
      cache.set(id, region);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    }
    return region;
  }

  function edgeWidth(cx, cz, axis) {
    const entrance = entranceWidth(cx, cz, axis);
    if (entrance) return entrance;
    const rx = regionIndex(cx), rz = regionIndex(cz);
    const edge = (axis === X_AXIS ? cx - rx * REGION : cz - rz * REGION);
    if (edge < REGION - 1) {
      const region = regionAt(rx, rz);
      return region.openings[roomIndex(cx, cz, region) * 2 + axis];
    }
    const row = axis === X_AXIS ? cz - rz * REGION : cx - rx * REGION;
    const sides = serviceLevelHash(seed, rx, rz, axis + 7);
    // The spawn region's northern connection has a guaranteed sight line.
    const defaultRow = axis === Z_AXIS && rx === 0 && rz === -1 ? 0 : sides % REGION;
    const extraRow = (defaultRow + 1 + ((sides >>> 4) % (REGION - 1))) % REGION;
    if (row !== defaultRow && (row !== extraRow || (sides >>> 8) % 5 > 1)) return 0;
    return Math.min(2.76, widthFor(sides));
  }

  function edgeOffset(cx, cz, axis, width) {
    if (width <= 0 || width >= CELL - EPSILON) return 0;
    if (entranceWidth(cx, cz, axis)) return cz === -1 ? -0.38 : 0.23;
    const rank = serviceLevelHash(seed, cx, cz, axis + 27) / 0x100000000;
    // Keep the room-center route clear even when the doorway is offset.
    return (2 * rank - 1) * Math.min(0.58, width / 2 - 0.53);
  }

  function room(cx, cz) {
    const region = regionAt(regionIndex(cx), regionIndex(cz));
    const index = roomIndex(cx, cz, region);
    if (region.cells[index]) return region.cells[index];
    const edges = [[cx, cz, X_AXIS], [cx, cz, Z_AXIS], [cx - 1, cz, X_AXIS], [cx, cz - 1, Z_AXIS]];
    const widths = edges.map(([x, z, axis]) => edgeWidth(x, z, axis));
    const offsets = edges.map(([x, z, axis], side) => edgeOffset(x, z, axis, widths[side]));
    const wallSegments = edges.map(([x, z, axis], side) => segmentsFor(x, z, axis, widths[side], offsets[side]));
    const data = { widths, offsets, wallSegments, walls: wallSegments.flat() };
    region.cells[index] = data;
    return data;
  }

  function neighbours(cx, cz) {
    const { widths } = room(cx, cz);
    const result = [];
    for (let i = 0; i < 4; i += 1) {
      if (widths[i] > 0) result.push({ x: cx + DIRECTIONS[i][0], z: cz + DIRECTIONS[i][1] });
    }
    return result;
  }

  function blocked(x, z, radius) {
    const minX = cellIndex(x - radius), maxX = cellIndex(x + radius);
    const minZ = cellIndex(z - radius), maxZ = cellIndex(z + radius);
    for (let cz = minZ; cz <= maxZ; cz += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        for (const wall of room(cx, cz).walls) {
          const dx = x - Math.max(wall.minX, Math.min(x, wall.maxX));
          const dz = z - Math.max(wall.minZ, Math.min(z, wall.maxZ));
          if (dx * dx + dz * dz < radius * radius) return true;
        }
      }
    }
    return false;
  }

  function move(x, z, dx, dz, radius = 0.27) {
    // Small substeps stop fast movement from crossing the thinnest walls.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (HALF_WALL + radius)));
    dx /= steps;
    dz /= steps;
    for (let step = 0; step < steps; step += 1) {
      if (dx && !blocked(x + dx, z, radius)) x += dx;
      if (dz && !blocked(x, z + dz, radius)) z += dz;
    }
    return { x, z };
  }

  function rayDistance(x, z, dirX, dirZ, maxDistance, radius = 0) {
    const length = Math.hypot(dirX, dirZ);
    if (length < EPSILON || maxDistance <= 0) return maxDistance;
    const dx = dirX / length, dz = dirZ / length;
    let cx = cellIndex(x), cz = cellIndex(z);
    const stepX = Math.sign(dx), stepZ = Math.sign(dz);
    const strideX = dx === 0 ? Infinity : CELL / Math.abs(dx);
    const strideZ = dz === 0 ? Infinity : CELL / Math.abs(dz);
    let crossingX = dx === 0 ? Infinity : ((cx + stepX / 2) * CELL - x) / dx;
    let crossingZ = dz === 0 ? Infinity : ((cz + stepZ / 2) * CELL - z) / dz;
    let distance = maxDistance;
    while (true) {
      for (const wall of room(cx, cz).walls) distance = rayRect(x, z, dx, dz, wall, distance, radius);
      if (Math.min(crossingX, crossingZ) >= distance) return distance;
      if (crossingX <= crossingZ) {
        cx += stepX;
        crossingX += strideX;
      } else {
        cz += stepZ;
        crossingZ += strideZ;
      }
    }
  }

  function hasLineOfSight(x, z, targetX, targetZ, radius = 0) {
    const dx = targetX - x, dz = targetZ - z;
    const length = Math.hypot(dx, dz);
    return rayDistance(x, z, dx, dz, length, radius) >= length;
  }

  function path(x, z, targetX, targetZ, forceCenters = false) {
    const clearance = 0.34;
    if (!forceCenters && hasLineOfSight(x, z, targetX, targetZ, clearance)) return [{ x: targetX, z: targetZ }];
    const goal = cellAt(targetX, targetZ);
    const start = cellAt(x, z);
    const queue = [{ ...start, prev: null }];
    const visited = new Set([key(start.x, start.z)]);
    const distanceToGoal = (node) => Math.abs(node.x - goal.x) + Math.abs(node.z - goal.z);
    let best = queue[0];
    let bestDistance = distanceToGoal(best);
    for (let index = 0; index < queue.length && index < 640 && bestDistance > 0; index += 1) {
      const node = queue[index];
      for (const next of neighbours(node.x, node.z)) {
        const id = key(next.x, next.z);
        if (visited.has(id)) continue;
        visited.add(id);
        next.prev = node;
        queue.push(next);
        const remaining = distanceToGoal(next);
        if (remaining >= bestDistance) continue;
        best = next;
        bestDistance = remaining;
      }
    }
    const points = bestDistance === 0 ? [{ x: targetX, z: targetZ }] : [];
    for (let step = best; step; step = step.prev) points.push(cellCenter(step.x, step.z));
    points.reverse();
    if (!forceCenters && points.length > 1 && hasLineOfSight(x, z, points[1].x, points[1].z, clearance)) points.shift();
    return points;
  }

  return { seed, cellAt, cellCenter, room, neighbours, move, rayDistance, hasLineOfSight, path };
}
