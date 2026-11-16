// Shared, bounded field encounters. Only the solo simulation or room authority
// advances this clock. Renderers never roll dice or award damage themselves.
import { seededRandom } from './network-objects.js';
import { WEAPON_RULES } from './multiplayer/rules.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const vector = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
const turn = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
export const EVENT_KINDS = ['police', 'tractor', 'drone', 'plane'];
// Smooth pursuit path, shared by both simulations; no renderer or wall clock.
export function sampleFieldRoute(route, t) {
  const f = clamp(t, 0, 0.999999) * (route.length - 1), i = Math.floor(f), u = f - i;
  const a = route[Math.max(0, i - 1)], b = route[i], c = route[i + 1], d = route[Math.min(route.length - 1, i + 2)];
  return [0, 1].map(k => 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * u + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u * u + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u * u * u));
}

// Each shape follows the model, in local coordinates (+Z = nose).
export const EVENT_SHAPES = {
  police: [[0, 0.85, 0, 1.12, 0.8, 2.45]],
  tractor: [[0, 1.2, 0.7, 1.3, 1.35, 2], [0, 0.7, -3.6, 1.45, 0.45, 1.5]],
  drone: [[0, 0, 0, 1.6, 0.45, 1.6], [0, -0.9, 0, 0.65, 0.65, 0.65]],
  plane: [[0, 0, 0, 0.85, 0.9, 3.5], [0, 0.1, 0, 5.3, 0.22, 1.25]],
};

export function createFieldEventSimulation({ spec, region, ground, seed = 1 }) {
  let randomState = Math.floor(seededRandom(seed)() * 0xffffffff) >>> 0;
  const random = () => { randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0; return randomState / 0x100000000; };
  const rules = spec?.events;
  const rand = (a, b) => a + (b - a) * random();
  const lanes = [];
  // Find long contiguous lanes in the real field, leaving room for the trailer.
  // No authored apartment coordinates, roads or buildings are crossed.
  if (rules && region) {
    const b = region.box;
    for (let z = b.z1 - 8; z > Math.max(b.z0 + 8, b.z1 - 145); z -= 9) {
      let start = null;
      for (let x = b.x0; x <= b.x1 + 2; x += 2) {
        const safe = x <= b.x1 && region.safe(x, z, 5);
        if (safe && start === null) start = x;
        if (!safe && start !== null) {
          if (x - start >= 75 && region.dist((start + x) / 2, z) > 45) lanes.push({ from: [start + 3, z], to: [x - 5, z] });
          start = null;
        }
      }
    }
  }
  const delay = value => Array.isArray(value) ? rand(...value) : Number(value) || 300;
  let time = 0, serial = 0, lastKind = null;
  let next = rules ? delay(random() < (rules.earlyChance ?? 0) ? rules.early : rules.first) : Infinity;
  let events = [];
  const history = new Map();
  const round = n => Math.round(n * 1000) / 1000;

  function spawn() {
    if (!rules || !lanes.length) return;
    const pool = EVENT_KINDS.filter(kind => kind !== lastKind);
    const kind = pool[Math.floor(random() * pool.length)], r = rules.types[kind];
    lastKind = kind;
    const lane = lanes[Math.floor(random() * Math.min(lanes.length, 8))];
    const reverse = random() < 0.5;
    let from = [...(reverse ? lane.to : lane.from)], to = [...(reverse ? lane.from : lane.to)];
    if (kind === 'plane') { const mid = (from[0] + to[0]) / 2; from[0] = mid + (reverse ? 700 : -700); to[0] = mid + (reverse ? -700 : 700); }
    const id = `field:${kind}:${++serial}`;
    let route = null, length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (kind === 'police') {
      const fractions = [0, 0.23, 0.66, 0.84, 0.52, 0.26, 0.62, 1], offsets = [0, -7, 8, -5, 10, 5, -7, 0];
      // Reduce the slalom until the full smooth path is inside the actual field.
      for (const scale of [1, 0.65, 0.3, 0]) {
        route = fractions.map((f, i) => [from[0] + (to[0] - from[0]) * f, from[1] + offsets[i] * scale]);
        if (Array.from({ length: 100 }, (_, i) => sampleFieldRoute(route, i / 99)).every(p => region.safe(...p, 2.4))) break;
      }
      length = 0; let previous = route[0];
      for (let i = 1; i <= 160; i++) { const p = sampleFieldRoute(route, i / 160); length += Math.hypot(p[0] - previous[0], p[1] - previous[1]); previous = p; }
    }
    const e = { id, kind, from: [...from], to: [...to], route, pathLength: length, progress: 0, speed: r.speed,
      age: 0, duration: length / (r.speed * (kind === 'police' ? 0.65 : 1)),
      x: from[0], y: ground + r.altitude, z: from[1], yaw: Math.atan2(to[0] - from[0], to[1] - from[1]),
      hp: r.hp, maxHp: r.hp, dead: false, deadAge: 0, flash: 0, hits: 0,
      phase: rand(0, Math.PI * 2), pitch: 0, roll: 0, drift: 0, cargoHp: r.cargoHp ?? 0, cargoMaxHp: r.cargoHp ?? 0,
      cargoDead: false, cargoAge: 0, cargoFlash: 0, crashX: 0, crashY: 0, crashZ: 0, impactAge: null };
    events.push(e);
  }
  function advance(dt) {
    time += dt;
    if (time >= next && events.length < 2) {
      spawn(); next = time + delay(rules.every);
    }
    for (const e of events) {
      e.age += dt; e.flash = Math.max(0, e.flash - dt * 5);
      e.cargoFlash = Math.max(0, e.cargoFlash - dt * 5); if (e.cargoDead) e.cargoAge += dt;
      if (e.dead) {
        e.deadAge += dt;
        const air = e.kind === 'plane' || e.kind === 'drone';
        if (air && e.impactAge === null) {
          e.x = e.crashX + Math.sin(e.yaw) * e.deadAge * (e.kind === 'plane' ? 5 : 1.5);
          e.z = e.crashZ + Math.cos(e.yaw) * e.deadAge * (e.kind === 'plane' ? 5 : 1.5);
          e.y = Math.max(ground + 0.7, e.crashY - 2 * e.deadAge - 3 * e.deadAge ** 2);
          e.roll = e.deadAge * (e.kind === 'drone' ? 5 : 0.9); e.pitch = Math.min(0.65, e.deadAge * 0.3);
          if (e.y <= ground + 0.7) e.impactAge = e.deadAge;
        }
      } else {
        const t = clamp(e.age / e.duration, 0, 1), r = rules.types[e.kind];
        if (e.route) {
          const p = sampleFieldRoute(e.route, e.progress), ahead = sampleFieldRoute(e.route, e.progress + 0.008);
          const wanted = Math.atan2(ahead[0] - p[0], ahead[1] - p[1]);
          const bend = Math.atan2(Math.sin(wanted - e.yaw), Math.cos(wanted - e.yaw));
          const speed = r.speed * clamp(1 - Math.abs(bend) * 0.45, 0.3, 1) * (0.88 + Math.sin(e.age * 0.7) * 0.12);
          e.speed += (speed - e.speed) * Math.min(1, dt * 2);
          // Advance parameter by local arc length, so hairpins slow naturally.
          const local = Math.max(5, Math.hypot(ahead[0] - p[0], ahead[1] - p[1]) / 0.008);
          let increment = Math.min(1 - e.progress, dt * e.speed / local);
          let position = sampleFieldRoute(e.route, e.progress + increment);
          // Bound real travelled distance through tight turns and end tangents.
          for (let i = 0; i < 4; i++) {
            const distance = Math.hypot(position[0] - p[0], position[1] - p[1]);
            if (distance <= e.speed * dt * 1.01) break;
            increment *= e.speed * dt / distance; position = sampleFieldRoute(e.route, e.progress + increment);
          }
          e.progress = Math.min(1, e.progress + increment); e.x = position[0]; e.z = position[1];
          e.drift += (clamp(bend, -0.55, 0.55) - e.drift) * Math.min(1, dt * 5);
          e.yaw = turn(e.yaw, wanted + e.drift * 0.6, Math.min(1, dt * 4));
        } else {
          e.x = e.from[0] + (e.to[0] - e.from[0]) * t;
          e.z = e.from[1] + (e.to[1] - e.from[1]) * t;
        }
        e.y = ground + r.altitude + (r.altitude ? Math.sin(e.age * 1.3 + e.phase) * 0.5 : Math.sin(e.age * 9) * 0.035);
        e.roll = Math.sin(e.age * (r.altitude ? 1 : 5)) * (r.altitude ? 0.08 : 0.025) + e.drift * 0.12;
        e.pitch = e.flash * Math.sin(e.age * 30) * 0.08;
        if (e.kind === 'plane') {
          const a = e.age * 0.55 + e.phase;
          e.z += (Math.sin(a) - Math.sin(e.phase)) * r.weave;
          e.y = ground + r.altitude + Math.sin(e.age * 0.45 + e.phase) * r.climb;
          e.yaw = Math.atan2(Math.sign(e.to[0] - e.from[0]) * r.speed, Math.cos(a) * r.weave * 0.55);
          e.roll = -Math.sin(a) * Math.sign(e.to[0] - e.from[0]) * 0.48;
          e.pitch = -Math.atan2(Math.cos(e.age * 0.45 + e.phase) * r.climb * 0.45, r.speed);
        }
      }
    }
    events = events.filter(e => e.dead ? e.deadAge < (e.impactAge ?? 0) + 9 : e.route ? e.progress < 1 && e.age < e.duration * 1.8 : e.age < e.duration);
    for (const e of events) {
      const poses = history.get(e.id) || [];
      if (!poses.length || time - poses[0].t > 0.04) poses.unshift({ x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, roll: e.roll, t: time });
      while (poses.length && time - poses.at(-1).t > 0.16) poses.pop(); history.set(e.id, poses);
    }
    for (const id of history.keys()) if (!events.some(e => e.id === id)) history.delete(id);
  }
  function step(dt) {
    if (!rules || !lanes.length) return;
    for (let left = clamp(Number(dt) || 0, 0, 1); left > 1e-7;) { const h = Math.min(left, 1 / 60); advance(h); left -= h; }
  }
  function raycast(origin, direction, range = 800) {
    if (!vector(origin) || !vector(direction) || !Number.isFinite(range) || range <= 0) return null;
    const length = Math.hypot(...direction); if (length < 1e-6) return null;
    const d = direction.map(n => n / length);
    let best = null;
    for (const e of events) {
      if (e.dead || e.age < 0.6 || e.duration - e.age < 0.5) continue;
      const shapes = EVENT_SHAPES[e.kind].map(shape => ({ shape, zone: 'body' }));
      if (e.kind === 'tractor' && !e.cargoDead) shapes.push({ shape: [0, 1.65, -3.6, 1.15, 0.85, 0.85], zone: 'cargo' });
      for (const pose of [e, ...(history.get(e.id) || [])]) {
        const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch), cr = Math.cos(pose.roll), sr = Math.sin(pose.roll);
        const local = a => {
          const x = a[0] * c - a[2] * s, z = a[0] * s + a[2] * c, y = a[1] * cp + z * sp;
          return [x * cr + y * sr, -x * sr + y * cr, -a[1] * sp + z * cp];
        };
        const o = local([origin[0] - pose.x, origin[1] - pose.y, origin[2] - pose.z]), v = local(d);
      for (const { shape, zone } of shapes) {
        let near = 0, far = range;
        for (let i = 0; i < 3; i++) {
          const lo = shape[i] - shape[i + 3] - 0.12, hi = shape[i] + shape[i + 3] + 0.12;
          if (Math.abs(v[i]) < 1e-8) { if (o[i] < lo || o[i] > hi) far = -1; }
          else { const a = (lo - o[i]) / v[i], b = (hi - o[i]) / v[i]; near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b)); }
        }
        if (near > far || near < 0.02 || best && best.distance <= near) continue;
        best = { animalId: e.id, species: e.kind, event: true, zone, distance: near,
          point: origin.map((n, i) => n + d[i] * near), normal: d.map(n => -n) };
      }
      }
    }
    return best;
  }
  function hit({ origin, direction, weapon, range = 800 }) {
    const w = WEAPON_RULES[weapon]; if (!w?.damage) return null;
    const h = raycast(origin, direction, Math.min(range, w.range)); if (!h) return null;
    const e = events.find(e => e.id === h.animalId);
    if (h.zone === 'cargo') {
      e.cargoHp = Math.max(0, e.cargoHp - w.damage); e.cargoFlash = 1;
      if (!e.cargoHp) { e.cargoDead = true; e.cargoAge = 0; }
      return { ...h, animalId: `${e.id}:cargo`, killed: e.cargoDead, points: e.cargoDead ? rules.types[e.kind].cargoPoints : 0,
        hp: e.cargoHp, maxHp: e.cargoMaxHp, cargo: true };
    }
    const armor = rules.types[e.kind].armor ?? 1;
    e.hp = Math.max(0, e.hp - Math.round(w.damage * armor)); e.flash = 1; e.hits++;
    if (e.hp === 0) {
      e.dead = true; e.deadAge = 0; e.crashX = e.x; e.crashY = e.y; e.crashZ = e.z;
      if (e.kind === 'police' || e.kind === 'tractor') e.impactAge = 0;
    }
    return { ...h, killed: e.dead, points: e.dead ? rules.types[e.kind].points : 0, hp: e.hp, maxHp: e.maxHp, ricochet: armor < 1 };
  }
  function snapshot() { return { time: round(time), serial, lastKind, next: round(next), randomState, events: events.map(e => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, typeof v === 'number' ? round(v) : Array.isArray(v) ? [...v] : v]))) }; }
  function restore(state) {
    if (!state || !Number.isFinite(state.time) || !Number.isInteger(state.serial) || !Number.isFinite(state.next) || !Number.isInteger(state.randomState) || !Array.isArray(state.events) || state.events.length > 2) return false;
    const ids = new Set();
    for (const e of state.events) {
      if (!EVENT_KINDS.includes(e.kind) || !new RegExp(`^field:${e.kind}:\\d+$`).test(e.id) || ids.has(e.id) ||
        ![e.x, e.y, e.z, e.yaw, e.hp, e.maxHp, e.age, e.duration, e.deadAge, e.phase, e.flash, e.hits, e.pitch, e.roll, e.crashX, e.crashY, e.crashZ].every(Number.isFinite) ||
        !Array.isArray(e.from) || !Array.isArray(e.to) || ![...e.from, ...e.to].every(Number.isFinite) || e.from.length !== 2 || e.to.length !== 2 || e.duration <= 0 || e.hp < 0 || e.hp > e.maxHp) return false;
      ids.add(e.id);
    }
    time = state.time; serial = state.serial; lastKind = EVENT_KINDS.includes(state.lastKind) ? state.lastKind : null;
    next = state.next; randomState = state.randomState >>> 0; events = structuredClone(state.events); history.clear(); return true;
  }
  return { step, raycast, hit, snapshot, restore, get lanes() { return lanes; } };
}
