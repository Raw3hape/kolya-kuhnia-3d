// Authoritative wildlife simulation. No DOM, renderer, wall clock or global RNG:
// the host owns this world; every guest renders its snapshots.
import { buildHuntRegions } from '../hunt-regions.js';
import { rayAnimalPose } from '../hunt-hitboxes.js';
import { seededRandom } from '../network-objects.js';
import { WEAPON_RULES } from './rules.js';
import { createFieldEventSimulation } from '../field-events-simulation.js';

const TAU = Math.PI * 2;
const BIRDS = ['pigeon', 'crow', 'duck', 'goose'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const turn = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const POSE_FIELDS = ['id', 'kind', 'i', 'generation', 'active', 'dead', 'x', 'y', 'z', 'yaw', 'pitch', 'roll', 'scale',
  'phase', 'gait', 'graze', 'alert', 'fall', 'fade', 'pig', 'flash', 'sp', 'amp', 'fold', 'peck', 'fat', 'birdKind', 'hp'];

export function createHuntSimulation({ spec, site, plan, seed = 1 }) {
  if (!spec?.boars || !site || !plan) throw new Error('Hunt simulation requires authored spec, site and plan');
  const random = seededRandom(seed), rand = (a, b) => a + random() * (b - a), pick = a => rand(a[0], a[1]);
  const home = plan.balcony ? [(plan.balcony.x0 + plan.balcony.x1) / 2, (plan.balcony.z0 + plan.balcony.z1) / 2] : [0, 0];
  const ground = -site.floorY, regions = buildHuntRegions(site, spec.region, home, random);
  if (!regions.length) throw new Error('No safe wildlife habitat in authored site');
  const encounters = createFieldEventSimulation({ spec, region: regions.find(r => r.kind === 'field'), ground, seed: `${seed}:field` });
  const animals = [], combos = new Map();
  let time = 0, historyAt = -1;

  function regionFor(a) { return regions[a.region ?? 0] ?? regions[0]; }
  function newTarget(a, radius = 12) {
    const p = regionFor(a).point({ near: [a.x, a.z], r: radius });
    a.tx = p[0]; a.tz = p[1]; a.timer = rand(3, 10);
  }
  function spawnBoar(i, previous = null) {
    const ri = regions.length > 1 && random() < (spec.region.city?.share ?? 0) ? 1 : 0;
    const reg = regions[ri], pig = random() < spec.boars.piglets;
    const p = reg.point(), generation = (previous?.generation ?? 0) + 1;
    const a = { id: `boar:${i}:${generation}`, kind: 'boar', i, generation, active: true, dead: false,
      x: p[0], y: ground, z: p[1], yaw: rand(0, TAU), scale: pick(pig ? spec.boars.size.piglet : spec.boars.size.adult),
      pig, hp: pig ? spec.boars.hp.piglet : spec.boars.hp.adult, phase: rand(0, TAU), gait: 0, graze: 1, alert: 0,
      fall: 0, fade: 0, flash: 0, pitch: 0, roll: 0, speed: 0, fear: 0, region: ri, history: [] };
    newTarget(a); return a;
  }
  function spawnBird(i, species, previous = null) {
    const reg = regions[0], p = reg.point(), sp = spec.species[species], generation = (previous?.generation ?? 0) + 1;
    const flying = random() < 0.35, alt = pick(sp.alt ?? spec.birds.alt);
    return { id: `bird:${i}:${generation}`, kind: 'bird', i, generation, active: true, dead: false,
      x: p[0], y: flying ? ground + alt : ground + 0.05, z: p[1], yaw: rand(0, TAU), pitch: 0, roll: 0,
      scale: sp.span * rand(0.92, 1.08), sp: species, birdKind: BIRDS.indexOf(species), fat: sp.fat ?? 1,
      hp: 1, phase: rand(0, TAU), amp: flying ? 1 : 0, fold: flying ? 0 : 1, peck: 0,
      fall: 0, fade: 0, flash: 0, mode: flying ? 'fly' : 'perch', fear: 0, timer: rand(5, 20),
      center: p, radius: rand(8, 20), angle: rand(0, TAU), alt, vy: 0, history: [] };
  }
  for (let i = 0; i < spec.boars.count; i++) animals.push(spawnBoar(i));
  let birdIndex = 0;
  for (const flock of spec.birds.flocks) {
    const n = Math.round(pick(flock.n));
    for (let i = 0; i < n && birdIndex < spec.birds.pool; i++) animals.push(spawnBird(birdIndex++, flock.species));
  }

  function flee(origin, loud = 1) {
    for (const a of animals) {
      if (a.dead) continue;
      const distance = Math.hypot(a.x - origin[0], a.z - origin[2]);
      const hearing = (a.kind === 'boar' ? spec.boars.hear : spec.birds.hear) * loud;
      if (distance > hearing) continue;
      a.fear = Math.max(a.fear, rand(2, 5)); a.threat = origin;
      if (a.kind === 'bird' && a.mode === 'perch') a.mode = 'fly';
    }
  }
  function advance(dt) {
    time += dt;
    for (let j = 0; j < animals.length; j++) {
      const a = animals[j];
      a.flash = Math.max(0, a.flash - dt * 4);
      if (a.dead) {
        a.deadT += dt;
        const species = a.kind === 'boar' ? spec.boars : spec.birds;
        a.fade = clamp((a.deadT - species.corpse) / species.fadeTime, 0, 1);
        if (a.kind === 'boar') { a.fall = Math.min(1, a.deadT * 3.5); a.gait = 0; }
        else { a.vy -= 9.8 * dt; a.y = Math.max(ground + 0.04, a.y + a.vy * dt); a.roll = Math.min(Math.PI * 0.5, a.roll + dt * 4); a.fold = 0.5; }
        if (a.deadT > species.corpse + species.fadeTime + a.respawn) {
          animals[j] = a.kind === 'boar' ? spawnBoar(a.i, a) : spawnBird(a.i, a.sp, a);
        }
        continue;
      }
      a.fear = Math.max(0, a.fear - dt); a.timer -= dt;
      if (a.kind === 'boar') {
        if (a.timer <= 0 || Math.hypot(a.tx - a.x, a.tz - a.z) < 0.8) newTarget(a);
        let dx = a.tx - a.x, dz = a.tz - a.z;
        const afraid = a.fear > 0;
        if (afraid && a.threat) { dx = a.x - a.threat[0]; dz = a.z - a.threat[2]; }
        const grazing = !afraid && a.timer > 6;
        const wanted = grazing ? 0 : afraid ? (a.pig ? spec.boars.speed.pigletGallop : spec.boars.speed.gallop) : spec.boars.speed.walk;
        a.speed += (wanted - a.speed) * Math.min(1, dt * 5);
        a.yaw = turn(a.yaw, Math.atan2(dx, dz), Math.min(1, dt * (afraid ? 4.5 : 1.8)));
        const nx = a.x + Math.sin(a.yaw) * a.speed * dt, nz = a.z + Math.cos(a.yaw) * a.speed * dt;
        if (regionFor(a).safe(nx, nz, a.scale * 0.3)) { a.x = nx; a.z = nz; }
        else { a.fear = 0; a.speed *= 0.25; newTarget(a, 20); a.yaw += Math.PI * dt; }
        a.phase += dt * (1 + a.speed * 2.2); a.gait = afraid ? 3 : a.speed > 0.15 ? 1 : 0;
        a.graze += ((grazing ? 1 : 0) - a.graze) * Math.min(1, dt * 4);
        a.alert += ((afraid ? 1 : 0) - a.alert) * Math.min(1, dt * 6);
      } else {
        const sp = spec.species[a.sp];
        if (a.timer <= 0) { a.mode = a.mode === 'fly' && !a.fear ? 'perch' : 'fly'; a.timer = rand(10, 30); }
        const fly = a.mode === 'fly' || a.fear > 0;
        if (fly) {
          a.angle += dt * sp.speed / a.radius;
          const nx = a.center[0] + Math.sin(a.angle) * a.radius, nz = a.center[1] + Math.cos(a.angle) * a.radius;
          a.yaw = Math.atan2(nx - a.x, nz - a.z); a.x = nx; a.z = nz;
          a.y += (ground + a.alt - a.y) * Math.min(1, dt * 1.2); a.roll = -0.18;
        } else { a.y += (ground + 0.05 - a.y) * Math.min(1, dt * 1.8); a.roll *= 0.9; }
        a.phase += dt * sp.flap * TAU; a.amp = fly ? 1 : 0; a.fold = fly ? 0 : 1;
        a.peck = fly ? 0 : Math.max(0, Math.sin(time * 2 + a.i));
      }
    }
    if (time - historyAt >= 0.05) {
      historyAt = time;
      for (const a of animals) {
        if (a.dead) continue;
        a.history.unshift({ x: a.x, y: a.y, z: a.z, yaw: a.yaw, t: time });
        while (a.history.length && time - a.history.at(-1).t > 0.25) a.history.pop();
      }
    }
  }
  function step(dt) {
    encounters.step(dt);
    for (let left = clamp(Number(dt) || 0, 0, 1); left > 1e-7;) { const h = Math.min(left, 1 / 60); advance(h); left -= h; }
  }
  function raycast(origin, direction, range = 800) {
    if (!vector(origin) || !vector(direction) || !Number.isFinite(range) || range <= 0) return null;
    const len = Math.hypot(...direction);
    if (len < 1e-6) return null;
    const d = direction.map(n => n / len);
    let best = null;
    for (const a of animals) {
      if (!a.active || a.dead) continue;
      const pad = Math.hypot(a.x - origin[0], a.y - origin[1], a.z - origin[2]) * spec.hit.perMetre;
      const test = pose => rayAnimalPose(a, a.kind === 'bird', origin, d, spec, ground, pad, pose);
      let h = test(a);
      if (!h) for (const pose of a.history) {
        if (time - pose.t > spec.hit.lag) break;
        h = test(pose); if (h) break;
      }
      if (!h || h.distance < 0.02 || h.distance > range || best && h.distance >= best.distance) continue;
      best = { animalId: a.id, distance: h.distance, zone: h.zone,
        point: origin.map((n, i) => n + d[i] * h.distance), normal: d.map(n => -n) };
    }
    const encounter = encounters.raycast(origin, direction, range);
    return encounter && (!best || encounter.distance < best.distance) ? encounter : best;
  }
  function hit({ origin, direction, weapon, range = 800, playerId = '' }) {
    const w = WEAPON_RULES[weapon];
    if (!w?.damage || !vector(origin) || !vector(direction)) return null;
    const h = raycast(origin, direction, Math.min(range, w.range));
    flee(origin);
    if (!h) return null;
    if (h.event) return encounters.hit({ origin, direction, weapon, range });
    const a = animals.find(animal => animal.id === h.animalId);
    if (!a || a.dead) return null;
    const multiplier = h.zone === 'head' ? 2.5 : h.zone === 'heart' ? 2 : h.zone === 'legs' ? 0.7 : 1;
    a.hp -= w.damage * multiplier; a.flash = 1;
    const species = a.kind === 'bird' ? a.sp : a.pig ? 'piglet' : 'boar';
    if (a.hp > 0) return { ...h, killed: false, points: 0, species };
    a.dead = true; a.deadT = 0; a.vy = a.kind === 'bird' ? -1 : 0;
    a.respawn = pick(a.kind === 'boar' ? spec.boars.respawn : spec.birds.respawn);
    const sc = spec.score, combo = combos.get(playerId) ?? { at: -Infinity, streak: 0 };
    combo.streak = time - combo.at < sc.combo.window ? combo.streak + 1 : 1; combo.at = time; combos.set(playerId, combo);
    const zoneK = h.zone === 'head' ? sc.head : h.zone === 'heart' ? sc.heart : h.zone === 'legs' ? sc.legs : 1;
    const distanceK = clamp(1 + (h.distance - sc.distance.from) / sc.distance.per, 1, sc.distance.max);
    const moving = a.kind === 'boar' ? a.speed > 3 : a.y > ground + 0.5;
    const comboK = Math.min(sc.combo.max, 1 + sc.combo.step * (combo.streak - 1));
    const points = Math.round(spec.species[species].points * zoneK * distanceK * comboK * (moving ? sc.running : 1) / 5) * 5;
    return { ...h, killed: true, points, species };
  }
  function snapshot() {
    // The renderer needs millimetres/milliradians; authoritative motion and hits retain full precision.
    const poseValue = value => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
    return { time, encounters: encounters.snapshot(), animals: animals.map(a => Object.fromEntries(POSE_FIELDS.filter(k => a[k] !== undefined).map(k => [k, poseValue(a[k])]))) };
  }
  function restore(state) {
    if (!state || !Array.isArray(state.animals) || state.animals.length > spec.boars.count + spec.birds.pool) return false;
    const restored = [], ids = new Set();
    for (const pose of state.animals) {
      if (!['boar', 'bird'].includes(pose.kind) || ![pose.x, pose.y, pose.z, pose.yaw, pose.scale].every(Number.isFinite) ||
        !Number.isInteger(pose.i) || pose.i < 0 || pose.i >= (pose.kind === 'boar' ? spec.boars.count : spec.birds.pool) ||
        !Number.isInteger(pose.generation) || pose.generation < 1 || pose.id !== `${pose.kind}:${pose.i}:${pose.generation}` ||
        ids.has(pose.id) || pose.kind === 'bird' && !BIRDS.includes(pose.sp)) return false;
      ids.add(pose.id);
      const base = pose.kind === 'boar' ? spawnBoar(pose.i) : spawnBird(pose.i, pose.sp);
      for (const key of POSE_FIELDS) if (pose[key] !== undefined) base[key] = pose[key];
      base.deadT = pose.dead ? (pose.fade ?? 0) * (pose.kind === 'boar' ? spec.boars.fadeTime : spec.birds.fadeTime) : 0;
      base.respawn = pick(pose.kind === 'boar' ? spec.boars.respawn : spec.birds.respawn);
      base.history = []; restored.push(base);
    }
    if (state.encounters && !encounters.restore(state.encounters)) return false;
    time = Number(state.time) || 0; animals.splice(0, animals.length, ...restored); historyAt = -1; return true;
  }
  return { step, snapshot, restore, raycast, hit, noise: flee, get time() { return time; } };
}
