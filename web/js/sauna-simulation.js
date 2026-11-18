// The room authority and solo player resolve the same floor, pool transitions
// and seat reservations. Presentation can use the same movement and aim query.
import { createSaunaLayout } from './sauna-layout.js';
import { isFree, moveCircle } from './multiplayer/collision.js';
import { NETWORK_RULES } from './multiplayer/rules.js';

export const SAUNA_RULES = Object.freeze({
  tickHz: 60, maxFrame: 0.1, inputTimeout: 0.32,
  radius: 0.25, walkSpeed: 2.55, wadeSpeed: 1.45, swimSpeed: 1.4,
  eyeHeight: 1.64, seatedEye: 0.73, reclinedEye: 0.43, swimEye: 0.32,
  seatReach: 2.2, seatAimRadius: 0.46, seatAimLift: 0.12, seatTurn: 1.22, settlePitch: 0.06,
  wadeDepth: 0.08, swimDepth: 0.98, swimEyeBlend: 0.52,
  spawnRadius: 1.65, standRadius: 0.85,
});

const EPSILON = 1e-8;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const round = value => Math.round(value * 1000) / 1000;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const smooth = k => k * k * (3 - 2 * k);
const lerp = (a, b, t) => a + (b - a) * t;

const contains = (rect, x, z) => x >= rect[0] && x <= rect[2] && z >= rect[1] && z <= rect[3];
const box = ([x0, z0, x1, z1]) => ({ x0, z0, x1, z1 });

export function compileSaunaLayout(config) {
  const design = createSaunaLayout(config);
  const rules = { ...SAUNA_RULES, ...config.simulation };
  const [x0, z0, x1, z1] = design.bounds;
  const margin = rules.radius * 2;
  const bounds = [
    [x0 - margin, z0 - margin, x0, z1 + margin],
    [x1, z0 - margin, x1 + margin, z1 + margin],
    [x0, z0 - margin, x1, z0],
    [x0, z1, x1, z1 + margin],
  ];
  const poolWalls = design.pools.flatMap(({ rect: [a, b, c, d], steps, rim }) => [
    [a - rim, b, a, d],
    [c, b, c + rim, d],
    [a, b - rim, c, b],
    ...(!steps ? [[a, d, c, d + rim]] : []),
  ]);
  return {
    ...design, rules,
    // Keep the dry apron outside the visible pool lip. Each basin has a
    // walkable south stair run, with the other three sides retaining water.
    collision: { boxes: [...bounds, ...design.obstacles, ...poolWalls].map(box) },
    seatById: new Map(design.seats.map(seat => [seat.id, seat])),
  };
}

export function normalizeSaunaInput(value) {
  if (!value || !Number.isSafeInteger(value.seq) || value.seq < 0) return null;
  return {
    seq: value.seq,
    moveX: clamp(finite(value.moveX), -1, 1),
    moveZ: clamp(finite(value.moveZ), -1, 1),
    yaw: wrap(finite(value.yaw)),
    pitch: clamp(finite(value.pitch), -Math.PI / 2, Math.PI / 2),
  };
}

function floorAt(layout, x, z) {
  const pool = layout.pools.find(item => contains(item.rect, x, z));
  const { rules } = layout;
  if (!pool) return { y: 0, eyeY: rules.eyeHeight, pose: 'walk', swimming: false };
  const deck = pool.rect[3];
  const descend = pool.steps > 0 ? clamp((deck - z) / pool.steps, 0, 1) : 1;
  const y = (pool.surface - pool.depth) * descend;
  const depth = pool.surface - y;
  const swimming = depth >= rules.swimDepth;
  const blend = smooth(clamp((depth - (rules.swimDepth - rules.swimEyeBlend / 2)) / rules.swimEyeBlend, 0, 1));
  return {
    y, swimming, pose: swimming ? 'swim' : depth >= rules.wadeDepth ? 'wade' : 'walk',
    eyeY: lerp(y + rules.eyeHeight, pool.surface + rules.swimEye, blend),
  };
}

export function moveSaunaPlayer(layout, player, input, dt, bodies = []) {
  const { rules } = layout;
  const seat = layout.seatById.get(player.seat);
  const yaw = wrap(finite(input?.yaw, player.yaw));
  const pitch = clamp(finite(input?.pitch, player.pitch), -Math.PI / 2, Math.PI / 2);
  if (seat) {
    return {
      ...player, bodyYaw: seat.yaw,
      yaw: wrap(seat.yaw + clamp(wrap(yaw - seat.yaw), -rules.seatTurn, rules.seatTurn)),
      pitch, speed: 0,
    };
  }
  const seconds = clamp(finite(dt), 0, rules.maxFrame);
  const moveX = clamp(finite(input?.moveX), -1, 1), moveZ = clamp(finite(input?.moveZ), -1, 1);
  let { x, z } = player;
  if (seconds > EPSILON && (moveX || moveZ)) {
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const speed = player.swimming ? rules.swimSpeed : player.pose === 'wade' ? rules.wadeSpeed : rules.walkSpeed;
    const travel = speed * seconds / Math.max(1, Math.hypot(moveX, moveZ));
    ({ x, z } = moveCircle({ x, z }, (cos * moveX - sin * moveZ) * travel,
      (-sin * moveX - cos * moveZ) * travel, layout.collision, bodies, rules.radius));
  }
  return {
    ...player, x, z, yaw, pitch, bodyYaw: yaw,
    ...floorAt(layout, x, z),
    speed: seconds > EPSILON ? Math.hypot(x - player.x, z - player.z) / seconds : 0,
  };
}

// Open slab intersection in the horizontal plane. A ray ending on a surface
// or sliding tangentially alongside it is not blocked by that surface.
function crossesRect(x, z, dx, dz, { x0, z0, x1, z1 }, radius) {
  let enter = 0, exit = 1;
  for (const [origin, delta, lo, hi] of [
    [x, dx, x0 - radius, x1 + radius],
    [z, dz, z0 - radius, z1 + radius],
  ]) {
    if (Math.abs(delta) < EPSILON) {
      if (origin <= lo || origin >= hi) return false;
      continue;
    }
    const a = (lo - origin) / delta, b = (hi - origin) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter >= exit - EPSILON) return false;
  }
  return true;
}

function clearHorizontal(layout, x, z, toX, toZ, radius = 0, ignoreAt = null) {
  const dx = toX - x, dz = toZ - z;
  return !layout.collision.boxes.some(hit => {
    if (ignoreAt && ignoreAt.x >= hit.x0 && ignoreAt.x <= hit.x1 && ignoreAt.z >= hit.z0 && ignoreAt.z <= hit.z1) return false;
    return crossesRect(x, z, dx, dz, hit, radius);
  });
}

function ownerOf(occupied, seat) {
  return occupied instanceof Map ? occupied.get(seat) : Object.hasOwn(occupied, seat) ? occupied[seat] : null;
}

export function targetSaunaSeat(layout, player, occupied = {}) {
  if (!player || player.seat || player.pose !== 'walk' || !Number.isFinite(player.eyeY)) return null;
  const { rules } = layout;
  const yaw = finite(player.yaw), pitch = finite(player.pitch);
  const cos = Math.cos(pitch);
  const ax = -Math.sin(yaw) * cos, ay = Math.sin(pitch), az = -Math.cos(yaw) * cos;
  const { x, z, eyeY } = player;
  let hit = null, score = Infinity;
  for (const seat of layout.seats) {
    if (ownerOf(occupied, seat.id) || Math.hypot(seat.x - x, seat.z - z) > rules.seatReach) continue;
    const dx = seat.x - x, dy = seat.y + rules.seatAimLift - eyeY, dz = seat.z - z;
    const distance = Math.hypot(dx, dy, dz);
    const along = dx * ax + dy * ay + dz * az;
    const radial = Math.sqrt(Math.max(0, distance * distance - along * along));
    if (along <= EPSILON || radial > rules.seatAimRadius) continue;
    const rank = radial / Math.max(0.3, distance) + distance * 0.045;
    if (rank >= score || !clearHorizontal(layout, x, z, seat.x, seat.z, 0, seat)) continue;
    const [sx, sz] = seat.stand;
    if (Math.hypot(sx - x, sz - z) > rules.seatReach + rules.radius ||
      !clearHorizontal(layout, x, z, sx, sz)) continue;
    hit = seat;
    score = rank;
  }
  return hit;
}

function availablePoint(layout, point, clearance) {
  return contains(layout.bounds, point.x, point.z) &&
    !layout.pools.some(pool => contains(pool.rect, point.x, point.z)) &&
    isFree(point, layout.collision, clearance, layout.rules.radius);
}

function nearestDry(layout, origin, clearance, reach, visible = false) {
  const canUse = point => availablePoint(layout, point, clearance) &&
    (!visible || clearHorizontal(layout, origin.x, origin.z, point.x, point.z));
  if (canUse(origin)) return origin;
  const stride = layout.rules.radius * 0.72;
  for (let ring = stride; ring <= reach + EPSILON; ring += stride) {
    const directions = Math.ceil(2 * Math.PI * ring / stride);
    for (let i = 0; i < directions; i++) {
      const angle = 2 * Math.PI * i / directions;
      const point = { x: origin.x + Math.cos(angle) * ring, z: origin.z + Math.sin(angle) * ring };
      if (canUse(point)) return point;
    }
  }
  return null;
}

export function createSaunaSimulation({ config, seed = 0 }) {
  const layout = compileSaunaLayout(config);
  const { rules } = layout;
  const players = new Map(), occupied = new Map();
  const colors = new Set(), max = NETWORK_RULES.maxPlayers;
  const step = 1 / rules.tickHz;
  let accumulator = 0, tick = 0;

  function bodiesExcept(id) {
    return [...players].filter(([actor]) => actor !== id).map(([, { player }]) =>
      ({ x: player.x, z: player.z, radius: player.seat ? rules.radius * 0.7 : rules.radius }));
  }

  function join(id, { towelSlot, avatar } = {}) {
    if (typeof id !== 'string' || !id || players.has(id) || players.size >= max) return false;
    const spawn = nearestDry(layout, { x: layout.spawn[0], z: layout.spawn[1] }, bodiesExcept(id), rules.spawnRadius, true);
    if (!spawn) return false;
    const preferred = Number.isInteger(towelSlot) && towelSlot >= 0 && towelSlot < max ? towelSlot : (seed >>> 0) % max;
    let slot = preferred;
    while (colors.has(slot)) slot = (slot + 1) % max;
    colors.add(slot);
    players.set(id, {
      player: {
        id, avatar: Number.isInteger(avatar) && avatar >= 0 && avatar < max ? avatar : slot,
        ...spawn, ...floorAt(layout, spawn.x, spawn.z),
        yaw: 0, bodyYaw: 0, pitch: 0, speed: 0, towelSlot: slot,
        seat: null, seatY: null, seq: -1,
      },
      controls: null, inputTick: 0,
    });
    return true;
  }

  function leave(id) {
    const entry = players.get(id);
    if (!entry) return false;
    const { player } = entry;
    if (player.seat) occupied.delete(player.seat);
    colors.delete(player.towelSlot);
    return players.delete(id);
  }

  function input(id, intent) {
    const entry = players.get(id);
    if (!entry) return false;
    if (intent === null) {
      entry.controls = null;
      return true;
    }
    const control = normalizeSaunaInput(intent);
    if (!control || control.seq <= entry.player.seq) return false;
    entry.player.seq = control.seq;
    entry.controls = control;
    entry.inputTick = tick;
    return true;
  }

  function sit(id, seatId, view) {
    const entry = players.get(id);
    if (!entry || !layout.seatById.has(seatId)) return false;
    const player = entry.player;
    if (player.seat === seatId) return true;
    const look = { ...player, yaw: wrap(finite(view?.yaw, entry.controls?.yaw ?? player.yaw)),
      pitch: clamp(finite(view?.pitch, entry.controls?.pitch ?? player.pitch), -Math.PI / 2, Math.PI / 2) };
    const seat = targetSaunaSeat(layout, look, occupied);
    if (seat?.id !== seatId) return false;
    const clearance = bodiesExcept(id);
    const [x, z] = seat.stand;
    if (!nearestDry(layout, { x, z }, clearance, rules.standRadius, true)) return false;
    Object.assign(player, {
      x: seat.x, z: seat.z, y: 0, yaw: seat.yaw, bodyYaw: seat.yaw,
      eyeY: seat.y + (seat.kind === 'lounger' ? rules.reclinedEye : rules.seatedEye),
      pitch: rules.settlePitch, speed: 0, seat: seat.id, seatY: seat.y, pose: seat.kind,
    });
    occupied.set(seat.id, id);
    entry.controls = null;
    return true;
  }

  function stand(id) {
    const entry = players.get(id);
    if (!entry) return false;
    const { player } = entry;
    const seat = layout.seatById.get(player.seat);
    if (!seat) return true;
    const [x, z] = seat.stand;
    const position = nearestDry(layout, { x, z }, bodiesExcept(id), rules.standRadius, true);
    if (!position) return false;
    occupied.delete(seat.id);
    Object.assign(player, position, floorAt(layout, position.x, position.z), {
      seat: null, seatY: null, bodyYaw: player.yaw, pitch: 0, speed: 0,
    });
    entry.controls = null;
    return true;
  }

  function advance(dt) {
    if (!players.size) return;
    accumulator += clamp(finite(dt), 0, rules.maxFrame);
    while (accumulator + EPSILON >= step) {
      accumulator -= step;
      tick++;
      for (const [id, entry] of players) {
        const active = (tick - entry.inputTick) * step <= rules.inputTimeout ? entry.controls : null;
        if (!active) {
          entry.player.speed = 0;
          continue;
        }
        const clearance = !entry.player.seat && (active.moveX || active.moveZ) ? bodiesExcept(id) : [];
        entry.player = moveSaunaPlayer(layout, entry.player, active, step, clearance);
      }
    }
  }

  function snapshot() {
    return {
      seed, tick,
      players: [...players.values()].map(({ player }) => ({
        ...player,
        x: round(player.x), y: round(player.y), z: round(player.z), eyeY: round(player.eyeY),
        yaw: round(player.yaw), bodyYaw: round(player.bodyYaw), pitch: round(player.pitch), speed: round(player.speed),
      })),
      seats: Object.fromEntries(occupied),
    };
  }

  return { layout, join, leave, input, tick: advance, sit, stand, snapshot };
}
