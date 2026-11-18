// Shared fixed-tick heightfield rider. The host and local prediction use the same
// contact model. Positions are in metres, facing 0 is downhill (-Z) and right is +X.
import { createSnowWorld } from './snow-world.js';

const TAU = 2 * Math.PI;
const EPSILON = 1e-8;
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
const finite = value => Number.isFinite(value) ? value : 0;
const wrap = value => Math.atan2(Math.sin(value), Math.cos(value));
const decay = (previous, target, speed, dt) => target + (previous - target) * Math.exp(-speed * dt);
const approachZero = (value, delta) => Math.sign(value) * Math.max(0, Math.abs(value) - delta);
const round = value => Math.round(value * 10000) / 10000;
const neutral = Object.freeze({
  seq: -1, steer: 0, push: 0, brake: 0, tuck: false, jump: false, jumpSerial: 0, spin: 0, flip: 0, lookYaw: null,
});

export function normalizeSnowInput(value) {
  if (!value || !Number.isSafeInteger(value.seq) || value.seq < 0) return null;
  return {
    seq: value.seq,
    steer: clamp(finite(value.steer), -1, 1),
    push: clamp(finite(value.push), -1, 1),
    brake: value.brake === true ? 1 : clamp(finite(value.brake), 0, 1),
    tuck: value.tuck === true,
    jump: value.jump === true,
    jumpSerial: Number.isSafeInteger(value.jumpSerial) && value.jumpSerial > 0 ? value.jumpSerial : 0,
    spin: clamp(finite(value.spin), -1, 1),
    flip: clamp(finite(value.flip), -1, 1),
    lookYaw: Number.isFinite(value.lookYaw) ? wrap(value.lookYaw) : null,
  };
}

function gearDistance(rider, world, anchor) {
  return Math.hypot(rider.x - world.start.x - anchor.x, rider.z - world.start.z - anchor.z);
}

export function nearSnowGear(world, rider, config) {
  if (rider?.phase !== 'walk') return null;
  let nearest = null, distance = config.station.reach;
  for (const [id, anchor] of Object.entries(config.station.options)) {
    const gap = gearDistance(rider, world, anchor);
    if (gap <= distance) { nearest = id; distance = gap; }
  }
  return nearest;
}

function makeRider(world, id, x, z) {
  return {
    id, x, z, y: world.height(x, z), vx: 0, vy: 0, vz: 0, equipment: null, phase: 'walk',
    yaw: 0, lean: 0, pitch: 0, speed: 0, distance: 0, surface: 'groomed', skid: 0,
    airTime: 0, spin: 0, flip: 0, spinRate: 0, flipRate: 0, tricks: 0, score: 0, ack: -1,
    jumpHeld: false, jumpSerial: 0, jumpBuffer: 0, recovery: 0,
  };
}

function equip(rider, equipment, config) {
  Object.assign(rider, { equipment, phase: 'ride', yaw: 0, lean: 0, pitch: 0,
    vx: 0, vy: 0, vz: -config.station.launchSpeed, speed: config.station.launchSpeed, jumpBuffer: 0 });
}

function walk(world, rider, input, dt, config) {
  const { station } = config;
  if (input.lookYaw !== null) rider.yaw = input.lookYaw;
  const c = Math.cos(rider.yaw), s = Math.sin(rider.yaw);
  const scale = station.walkSpeed / Math.max(1, Math.hypot(input.push, input.steer));
  const vx = (input.steer * c - input.push * s) * scale;
  const vz = (-input.steer * s - input.push * c) * scale;
  const nextX = rider.x + vx * dt, nextZ = rider.z + vz * dt;
  const over = Math.max(1, Math.hypot(nextX - world.start.x, nextZ - world.start.z) / station.walkRadius);
  rider.x = world.start.x + (nextX - world.start.x) / over;
  rider.z = world.start.z + (nextZ - world.start.z) / over;
  rider.y = world.height(rider.x, rider.z);
  Object.assign(rider, { vx, vz, speed: Math.hypot(vx, vz) });
}

function beginFlight(rider, lift, emit) {
  Object.assign(rider, { phase: 'air', vy: rider.vy + lift, airTime: 0,
    spin: 0, flip: 0, spinRate: 0, flipRate: 0, jumpBuffer: 0, skid: 0 });
  emit?.('jump', rider, { speed: round(rider.speed) });
}

function crash(rider, config, emit, reason, details = {}) {
  Object.assign(rider, { phase: 'crashed', recovery: config.motion.crashDelay,
    vx: 0, vy: 0, vz: 0, speed: 0, lean: 0, skid: 0, jumpBuffer: 0 });
  emit?.('crash', rider, { reason, ...details });
}

function recover(world, rider, dt, config, emit) {
  rider.recovery = Math.max(0, rider.recovery - dt);
  if (rider.recovery > EPSILON) return;
  const section = world.course(rider.z);
  const edge = section.width * 0.65;
  const slip = clamp(rider.x - section.x, -edge, edge);
  rider.x = section.x + slip;
  if (world.obstacle?.(rider.x, rider.z, config.motion.bodyRadius)) rider.x = section.x;
  rider.y = world.height(rider.x, rider.z);
  Object.assign(rider, { phase: 'ride', yaw: 0, pitch: 0, spin: 0, flip: 0, airTime: 0, skid: 0,
    vx: 0, vz: -config.station.launchSpeed, vy: 0, speed: config.station.launchSpeed, recovery: 0 });
  emit?.('recover', rider);
}

function accumulate(rider, dx, dz) {
  rider.x += dx; rider.z += dz;
  rider.distance += Math.hypot(dx, dz);
}

function ground(world, rider, input, dt, config, sample, emit) {
  const { motion, snow } = config, gear = config.gear[rider.equipment];
  const surface = world.sample(rider.x, rider.z, sample);
  const { dx, dz } = surface;
  const load = motion.gravity / Math.hypot(1, dx, dz);
  const gravity = load * load / motion.gravity;
  const snowType = snow[surface.snow] ?? snow.groomed;
  rider.surface = surface.snow;
  rider.lean = decay(rider.lean, input.steer, motion.edgeResponse, dt);
  const carve = Math.min(gear.maxTurn, motion.lowSpeedTurn + rider.speed / gear.sidecut);
  rider.yaw = wrap(rider.yaw - rider.lean * carve * dt);

  const s = Math.sin(rider.yaw), c = Math.cos(rider.yaw);
  const vx = rider.vx - dx * gravity * dt, vz = rider.vz - dz * gravity * dt;
  let forward = -s * vx - c * vz;
  const lateral = c * vx - s * vz;
  const grip = gear.grip * snowType.grip;
  const edge = grip * load * (1 + Math.abs(rider.lean) * motion.edgeGain);
  const latDrag = decay(lateral, 0, motion.tractionResponse + input.brake * motion.tractionResponse, dt);
  const side = approachZero(lateral, Math.min(edge * dt, Math.abs(lateral - latDrag)));
  const lostSide = lateral * lateral - side * side;
  const keep = clamp(grip * motion.carveEnergy * (1 - input.brake), 0, 1);
  if (forward > 0) forward = Math.sqrt(forward * forward + lostSide * keep);
  const push = Math.max(0, 1 - Math.abs(forward) / motion.pushFadeSpeed);
  forward += input.push * push * gear.push * (1 - input.brake) * dt;
  const drag = input.tuck ? motion.tuckDrag : motion.drag;
  const resistance = snowType.glide * gear.glide * load + Math.abs(forward) ** 2 * drag + input.brake * gear.brake;
  forward = clamp(approachZero(forward, resistance * dt), -motion.maxBackSpeed, motion.maxSpeed);
  const speedScale = Math.max(1, Math.hypot(forward, side) / motion.maxSpeed);
  rider.vx = (-s * forward + c * side) / speedScale;
  rider.vz = (-c * forward - s * side) / speedScale;
  rider.speed = Math.hypot(rider.vx, rider.vz);
  rider.skid = clamp(Math.abs(lateral) / 7 + input.brake * Math.min(1, rider.speed / 3), 0, 1);
  rider.vy = dx * rider.vx + dz * rider.vz;
  rider.pitch = Math.atan2(rider.vy, Math.max(1, rider.speed));

  if (rider.jumpBuffer > 0 && rider.speed >= motion.minJumpSpeed) {
    // The contact normal, rather than world-up, sets the direction of the push.
    const impulse = gear.jump * load / motion.gravity;
    rider.vx -= dx * impulse; rider.vz -= dz * impulse;
    beginFlight(rider, impulse, emit);
    return;
  }
  const mx = rider.vx * dt, mz = rider.vz * dt;
  const nextHeight = world.height(rider.x + mx, rider.z + mz);
  const flightHeight = rider.y + rider.vy * dt - motion.gravity * dt * dt * 0.5;
  if (rider.speed >= motion.naturalAirSpeed && flightHeight - nextHeight > motion.naturalAirGap) {
    beginFlight(rider, 0, emit);
    return;
  }
  if (world.obstacle?.(rider.x + mx, rider.z + mz, motion.bodyRadius)) {
    crash(rider, config, emit, 'obstacle');
    return;
  }
  accumulate(rider, mx, mz);
  rider.y = nextHeight;
}

function flightContact(world, rider, mx, my, mz) {
  if (rider.y + my > world.height(rider.x + mx, rider.z + mz)) return 1;
  // Bracket the first intersection within this bounded step. Sampling the same
  // height function as terrain avoids gaps at tile and LOD boundaries.
  let lo = 0, hi = 1;
  for (let i = 0; i < 6; i++) {
    const t = (lo + hi) * 0.5;
    const y = world.height(rider.x + mx * t, rider.z + mz * t);
    if (rider.y + my * t > y) lo = t;
    else hi = t;
  }
  return hi;
}

function land(world, rider, dt, config, sample, emit) {
  const { motion, snow } = config;
  const ground = world.sample(rider.x, rider.z, sample);
  const { dx, dz } = ground;
  const impact = Math.max(0, (dx * rider.vx + dz * rider.vz - rider.vy) / Math.hypot(1, dx, dz));
  const flipError = Math.abs(wrap(rider.flip));
  const travelYaw = Math.atan2(-rider.vx, -rider.vz);
  const relativeYaw = wrap(rider.yaw - travelYaw);
  const normalHeadingError = Math.abs(relativeYaw);
  const switchLanding = config.gear[rider.equipment].switchLanding && normalHeadingError > Math.PI * 0.5;
  const headingError = switchLanding ? Math.PI - normalHeadingError : normalHeadingError;
  rider.y = ground.height;
  rider.surface = ground.snow;
  const details = { speed: round(rider.speed), rotation: round(rider.spin), flips: round(rider.flip),
    airTime: round(rider.airTime), impact: round(impact) };
  const realLanding = rider.airTime > motion.smallFlightTime;
  if (realLanding && (impact > motion.maxImpact * (snow[ground.snow] ?? snow.groomed).impact ||
    flipError > motion.maxFlipError ||
    (rider.speed > motion.dangerousLandingSpeed && headingError > motion.maxHeadingError))) {
    crash(rider, config, emit, 'landing', details);
    return;
  }
  const spinTurns = Math.floor((Math.abs(rider.spin) + 0.45) / TAU);
  const flips = Math.round(Math.abs(rider.flip) / TAU);
  const large = rider.airTime >= motion.bigAirTime;
  const bonus = spinTurns * motion.spinScore + flips * motion.flipScore + Number(large) * motion.bigAirScore;
  rider.score += bonus;
  rider.tricks += spinTurns + flips + Number(large);
  if (rider.speed > motion.minJumpSpeed) {
    // A board can land switch. Its geometric heading is the travel direction;
    // allowing the reversed landing avoids penalizing a clean 180.
    rider.yaw = decay(travelYaw + relativeYaw, travelYaw, 17, dt + (switchLanding ? 0.18 : 0));
  }
  rider.pitch = Math.atan2(dx * rider.vx + dz * rider.vz, Math.max(1, rider.speed));
  const retain = 1 - clamp(impact / (motion.maxImpact * 4), 0, 0.28);
  Object.assign(rider, { phase: 'ride', airTime: 0, spin: 0, flip: 0, spinRate: 0, flipRate: 0,
    vx: rider.vx * retain, vz: rider.vz * retain, vy: (dx * rider.vx + dz * rider.vz) * retain,
    speed: rider.speed * retain });
  if (realLanding || bonus > 0) emit?.('land', rider, { ...details, bonus, switch: switchLanding });
}

function air(world, rider, input, dt, config, sample, emit) {
  const { motion } = config, gear = config.gear[rider.equipment];
  rider.spinRate = decay(rider.spinRate, -input.spin * gear.spin, motion.airResponse, dt);
  rider.flipRate = decay(rider.flipRate, input.flip * gear.flip, motion.airResponse, dt);
  rider.spin += rider.spinRate * dt; rider.flip += rider.flipRate * dt;
  rider.yaw = wrap(rider.yaw + rider.spinRate * dt);
  rider.lean = decay(rider.lean, input.spin * 0.55, motion.edgeResponse, dt);
  const drag = 1 / (1 + rider.speed * motion.airDrag * dt);
  rider.vx *= drag; rider.vz *= drag;
  const my = (rider.vy - motion.gravity * dt * 0.5) * dt;
  rider.vy -= motion.gravity * dt;
  const mx = rider.vx * dt, mz = rider.vz * dt;
  const fraction = flightContact(world, rider, mx, my, mz);
  rider.airTime += dt * fraction;
  accumulate(rider, mx * fraction, mz * fraction);
  rider.y += my * fraction;
  rider.speed = Math.hypot(rider.vx, rider.vz);
  rider.pitch = Math.atan2(rider.vy, Math.max(1, rider.speed));
  const underfoot = world.height(rider.x, rider.z);
  const tree = world.obstacle?.(rider.x, rider.z, motion.bodyRadius);
  if (tree && rider.y < tree.y + tree.h) {
    rider.y = underfoot;
    crash(rider, config, emit, 'obstacle');
  } else if (fraction < 1 || rider.y <= underfoot) land(world, rider, dt, config, sample, emit);
}

function advance(world, rider, input, dt, config, sample, emit) {
  if ((input.jump && !rider.jumpHeld) || input.jumpSerial > rider.jumpSerial) {
    rider.jumpBuffer = config.motion.jumpBuffer;
  } else rider.jumpBuffer = Math.max(0, rider.jumpBuffer - dt);
  rider.jumpHeld = input.jump;
  rider.jumpSerial = Math.max(rider.jumpSerial, input.jumpSerial);
  if (rider.phase === 'walk') walk(world, rider, input, dt, config);
  else if (rider.phase === 'ride') ground(world, rider, input, dt, config, sample, emit);
  else if (rider.phase === 'air') air(world, rider, input, dt, config, sample, emit);
  else recover(world, rider, dt, config, emit);
  return rider;
}

// Deterministic replay for rendering. Copy the state so interpolated/predicted
// presentation cannot mutate a received authoritative snapshot.
export function stepSnowRider(world, rider, value, seconds, config) {
  const next = { ...rider };
  const input = normalizeSnowInput(value) ?? neutral;
  let left = clamp(finite(seconds), 0, config.simulation.maxFrameSeconds);
  const frame = 1 / config.simulation.tickHz, sample = {};
  while (left > EPSILON) {
    const dt = Math.min(frame, left);
    advance(world, next, input, dt, config, sample);
    left -= dt;
  }
  return next;
}

function snapshotRider(p) {
  return {
    id: p.id, phase: p.phase, equipment: p.equipment, surface: p.surface, ack: p.ack,
    x: round(p.x), y: round(p.y), z: round(p.z), vx: round(p.vx), vy: round(p.vy), vz: round(p.vz),
    yaw: round(p.yaw), pitch: round(p.pitch), lean: round(p.lean), skid: round(p.skid),
    speed: round(p.speed), distance: round(p.distance), airTime: round(p.airTime),
    spin: round(p.spin), flip: round(p.flip), spinRate: round(p.spinRate), flipRate: round(p.flipRate),
    tricks: p.tricks, score: p.score, recovery: round(p.recovery),
    jumpHeld: p.jumpHeld, jumpSerial: p.jumpSerial, jumpBuffer: round(p.jumpBuffer),
  };
}

export function createSnowSimulation({ seed = 1, config }) {
  if (!config?.simulation || !config?.motion || !config?.station || !config?.gear || !config?.snow) {
    throw new Error('Snow simulation requires an authored spec');
  }
  const world = createSnowWorld(seed, config.terrain);
  const riders = new Map(), events = [], sample = {};
  const { simulation, station } = config;
  const frame = 1 / simulation.tickHz;
  let tickNumber = 0, time = 0, accumulator = 0, eventId = 0;
  function emit(type, rider, extra = {}) {
    events.push({ id: ++eventId, type, playerId: rider.id, time, ...extra });
    if (events.length > simulation.maxEvents) events.shift();
  }

  function startPosition(exclude) {
    const stride = station.spawnSpacing, across = [0, -1, 1];
    const present = Array.from(riders.values(), entry => entry.rider).filter(rider => rider !== exclude);
    for (let i = 0; i < simulation.maxPlayers; i++) {
      const x = world.start.x + across[i % across.length] * stride;
      const z = world.start.z - Math.floor(i / across.length) * stride;
      const occupied = present.some(rider => Math.hypot(x - rider.x, z - rider.z) < stride * 0.7);
      if (!occupied) return { x, z };
    }
    return { x: world.start.x, z: world.start.z };
  }

  function join(id) {
    if (typeof id !== 'string' || !id || riders.has(id) || riders.size >= simulation.maxPlayers) return false;
    const p = startPosition();
    riders.set(id, { rider: makeRider(world, id, p.x, p.z), input: null, at: -Infinity });
    return true;
  }

  function select(id, equipment) {
    const entry = riders.get(id);
    if (!entry || entry.rider.phase !== 'walk' || typeof equipment !== 'string' || !Object.hasOwn(config.gear, equipment)) return false;
    const anchor = station.options[equipment];
    if (!anchor || gearDistance(entry.rider, world, anchor) > station.reach) return false;
    equip(entry.rider, equipment, config);
    entry.input = null;
    emit('equip', entry.rider, { equipment });
    return true;
  }

  function input(id, value) {
    const entry = riders.get(id);
    if (!entry) return false;
    if (value === null) { entry.input = null; return true; }
    const next = normalizeSnowInput(value);
    if (!next || next.seq <= entry.rider.ack) return false;
    entry.input = next; entry.at = time;
    entry.rider.ack = next.seq;
    return true;
  }

  function reset(id, { walk: onFoot = false } = {}) {
    const entry = riders.get(id);
    if (!entry) return false;
    const existing = entry.rider, p = startPosition(existing);
    entry.rider = makeRider(world, id, p.x, p.z);
    entry.rider.ack = existing.ack;
    entry.rider.jumpSerial = existing.jumpSerial;
    entry.input = null;
    if (!onFoot && existing.equipment) equip(entry.rider, existing.equipment, config);
    emit('reset', entry.rider, { equipment: entry.rider.equipment });
    return true;
  }

  function tick(seconds) {
    if (!riders.size) return;
    accumulator += clamp(finite(seconds), 0, simulation.maxFrameSeconds);
    while (accumulator + EPSILON >= frame) {
      accumulator -= frame;
      time = ++tickNumber * frame;
      while (events.length && events[0].time < time - simulation.eventSeconds) events.shift();
      for (const entry of riders.values()) {
        const input = time - entry.at <= simulation.inputTimeout ? entry.input ?? neutral : neutral;
        advance(world, entry.rider, input, frame, config, sample, emit);
      }
    }
  }

  function snapshot() {
    return { seed: world.seed ?? seed, tick: tickNumber,
      players: Array.from(riders.values(), entry => snapshotRider(entry.rider)),
      events: events.map(({ time: eventTime, ...event }) => ({ ...event, time: round(eventTime) })) };
  }

  return { world, join, leave: id => riders.delete(id), select, input, reset, tick, snapshot };
}
