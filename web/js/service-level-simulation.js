// Shared fixed-step simulation for solo play and the multiplayer room authority.
import { DEFAULT_MAZE_WEAPON, weaponById, WEAPONS } from './weapon-catalog.js';
import { refillMagazine } from './multiplayer/rules.js';
import { seededRandom } from './network-objects.js';
import { createServiceLevelWorld, SERVICE_LEVEL_HEIGHT, SERVICE_LEVEL_ORIGIN } from './service-level-world.js';

const PI = Math.PI;
const TAU = PI * 2;
const TIME_EPSILON = 1e-7;
const SHOT_BUFFER_SECONDS = 0.15;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => Number.isFinite(value) ? value : 0;
const round = value => Math.round(value * 1000) / 1000;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const face = (a, b) => Math.atan2(a.x - b.x, a.z - b.z);
const cellKey = ({ x, z }) => `${x}:${z}`;
const direction = yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const playing = player => !player.downed;

export function normalizeServiceInput(value) {
  if (!value || !Number.isSafeInteger(value.seq) || value.seq < 0) return null;
  return {
    seq: value.seq,
    moveX: clamp(finite(value.moveX), -1, 1),
    moveZ: clamp(finite(value.moveZ), -1, 1),
    yaw: ((finite(value.yaw) % TAU + PI) % TAU + TAU) % TAU - PI,
    pitch: clamp(finite(value.pitch), -PI / 2, PI / 2),
    fire: value.fire === true,
    trigger: Number.isSafeInteger(value.trigger) && value.trigger > 0 ? value.trigger : null,
    weapon: weaponById(value.weapon).id === value.weapon ? value.weapon : null,
    aiming: value.aiming === true,
    reload: value.reload === true,
    interact: value.interact === true,
  };
}

export function moveServicePlayer(world, player, input, seconds, config) {
  if (player.downed || player.reviving || !input) return { x: player.x, z: player.z };
  const forward = direction(input.yaw);
  const { moveX, moveZ } = input;
  const magnitude = Math.max(1, Math.hypot(moveX, moveZ));
  const meters = config.player.speed * seconds / magnitude;
  return world.move(player.x, player.z,
    (forward.x * moveZ - forward.z * moveX) * meters,
    (forward.z * moveZ + forward.x * moveX) * meters,
    config.player.radius);
}

function sphereHit(start, aim, x, y, z, radius) {
  const dx = x - start.x, dy = y - start.y, dz = z - start.z;
  const along = dx * aim.x + dy * aim.y + dz * aim.z;
  if (along < 0) return Infinity;
  const discriminant = radius * radius + along * along - dx * dx - dy * dy - dz * dz;
  return discriminant >= 0 ? Math.max(0, along - Math.sqrt(discriminant)) : Infinity;
}

function endpoint(start, aim, meters) {
  return { toX: start.x + aim.x * meters, toY: start.y + aim.y * meters, toZ: start.z + aim.z * meters };
}

function structureDistance(world, start, aim, max) {
  let bound = max;
  if (aim.y > TIME_EPSILON) bound = Math.min(bound, (SERVICE_LEVEL_HEIGHT - start.y) / aim.y);
  if (aim.y < -TIME_EPSILON) bound = Math.min(bound, -start.y / aim.y);
  const horizontal = Math.hypot(aim.x, aim.z);
  if (horizontal < TIME_EPSILON) return bound;
  return world.rayDistance(start.x, start.z, aim.x, aim.z, bound * horizontal) / horizontal;
}

function waveRoster({ count, mix }, teamSize, teamBonus, random) {
  const total = Math.round(count * (1 + (teamSize - 1) * teamBonus));
  const weights = Object.entries(mix);
  const sum = weights.reduce((weight, [, n]) => weight + n, 0);
  const roster = [];
  let used = 0, scaled = 0;
  for (const [type, weight] of weights) {
    scaled += weight * total / sum;
    const quota = Math.round(scaled);
    while (used < quota) { roster.push(type); used++; }
  }
  for (let i = roster.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [roster[i], roster[j]] = [roster[j], roster[i]];
  }
  return roster;
}

export function createServiceLevel({ seed = 1, config }) {
  if (!config?.waves?.length || !config.player || !config.enemies) {
    throw new Error('Service level requires an authored spec');
  }
  const { waves, enemies: types, simulation, player: rules, director, perks } = config;
  const scatter = seededRandom(`${seed}:weapons`);
  const stepSeconds = 1 / simulation.tickHz;
  const world = createServiceLevelWorld(seed), random = seededRandom(`${seed}:director`);
  const players = new Map(), enemies = new Map(), events = [];
  let phase = 'prep', wave = 1, timeLeft = director.initialPrep, tickNumber = 0, time = 0, accumulator = 0;
  let eventId = 0, enemyId = 0, queue = [], spawnClock = 0, spawnIndex = 0;
  let upgrade = null, reloadFactor = 1, damageFactor = 1, maxHp = rules.maxHp;

  function event(type, payload = {}) {
    events.push({ id: ++eventId, type, time, ...payload });
    if (events.length > simulation.maxEvents) events.shift();
  }

  function entryPoint() {
    const others = [...players.values()];
    const anchor = others.find(playing) ?? others[0];
    if (!anchor) return SERVICE_LEVEL_ORIGIN;
    const diagonal = 1 / Math.SQRT2;
    const options = [[1, 0], [-1, 0], [0, 1], [0, -1],
      [diagonal, diagonal], [-diagonal, diagonal], [diagonal, -diagonal], [-diagonal, -diagonal]];
    const activeEnemies = [...enemies.values()];
    for (let ring = 1; ring <= rules.spawnRings; ring++) {
      for (const [dx, dz] of options) {
        const meters = rules.spawnSpace * ring;
        const point = world.move(anchor.x, anchor.z, dx * meters, dz * meters, rules.radius);
        if (others.every(other => distance(point, other) >= rules.radius * 2) &&
          activeEnemies.every(enemy => distance(point, enemy) >= rules.spawnSpace)) return point;
      }
    }
    return { x: anchor.x, z: anchor.z };
  }

  const newLoadout = () => Object.fromEntries(WEAPONS.filter(w => w.mag)
    .map(w => [w.id, { mag: w.mag, reserve: w.reserve }]));

  function join(id, selected = DEFAULT_MAZE_WEAPON) {
    if (typeof id !== 'string' || !id || players.has(id) || players.size >= rules.maxPlayers) return false;
    const { x, z } = entryPoint();
    const weapon = weaponById(selected);
    players.set(id, { id, x, z, yaw: 0, pitch: 0, hp: maxHp,
      weapon: weapon.id, loadout: newLoadout(), aiming: false, firing: false, trigger: 0, bloom: 0,
      downed: false, seq: -1, input: null, inputTime: 0, reviveProgress: 0, reviving: null,
      readyAt: 0, pendingShot: 0, shotAt: -Infinity, shotWeapon: null, reloadAt: 0, hurtAt: 0, kills: 0 });
    return true;
  }

  function leave(id) {
    if (!players.delete(id)) return false;
    for (const player of players.values()) if (player.reviving === id) player.reviving = null;
    return true;
  }

  function input(id, value) {
    const player = players.get(id);
    if (!player) return false;
    if (value === null) { player.input = null; player.pendingShot = 0; player.reviving = null; return true; }
    const prepared = normalizeServiceInput(value);
    if (!prepared || prepared.seq <= player.seq) return false;
    player.input = prepared;
    player.inputTime = time;
    player.seq = prepared.seq;
    return true;
  }

  function getInput(player) {
    return time - player.inputTime <= simulation.inputTimeout ? player.input : null;
  }

  function beginWave() {
    phase = 'combat';
    timeLeft = 0;
    spawnClock = 0;
    spawnIndex = 0;
    queue = waveRoster(waves[wave - 1], Math.max(1, [...players.values()].filter(playing).length), director.teamBonus, random);
    event('waveStart', { wave });
  }

  function terminal(next) {
    phase = next;
    timeLeft = 0;
    queue = [];
    enemies.clear();
    event('outcome', { phase });
  }

  function clearWave() {
    event('waveClear', { wave });
    if (wave >= waves.length) { terminal('victory'); return; }
    wave++;
    phase = 'prep';
    timeLeft = director.betweenWaves;
    const perk = perks.find(perk => perk.wave === wave);
    if (perk) {
      upgrade = perk.id;
      reloadFactor *= perk.reloadFactor ?? 1;
      damageFactor *= perk.damageFactor ?? 1;
      maxHp += perk.healthBonus ?? 0;
      event('upgrade', { upgrade, wave });
    }
    for (const player of players.values()) {
      player.hp = player.downed ? rules.reviveHealth : Math.min(maxHp, player.hp + rules.waveHeal + (perk?.healthBonus ?? 0));
      player.loadout = newLoadout();
      player.downed = false;
      player.reviving = null;
      player.reviveProgress = 0;
      player.reloadAt = 0;
    }
  }

  function spawnPoint(anchor, living, fallback = false) {
    const center = world.cellAt(anchor.x, anchor.z);
    const frontier = [{ ...center, hops: 0 }];
    const visited = new Set([cellKey(center)]);
    const hidden = [], visible = [], activeEnemies = [...enemies.values()];
    const maxCells = fallback ? director.spawnFallbackCells : director.spawnMaxCells;
    const maxMeters = fallback ? director.spawnFallbackMeters : director.spawnMaxMeters;
    for (let i = 0; i < frontier.length; i++) {
      const cell = frontier[i];
      if (cell.hops < maxCells) {
        for (const next of world.neighbours(cell.x, cell.z)) {
          const id = cellKey(next);
          if (!visited.has(id)) { visited.add(id); frontier.push({ ...next, hops: cell.hops + 1 }); }
        }
      }
      if (cell.hops < director.spawnMinCells) continue;
      const point = world.cellCenter(cell.x, cell.z);
      const meters = distance(point, anchor);
      if (meters > maxMeters || living.some(player => distance(point, player) < director.spawnMinMeters)) continue;
      if (activeEnemies.some(enemy => distance(point, enemy) < director.spawnGap)) continue;
      const inSight = living.some(player => world.hasLineOfSight(player.x, player.z, point.x, point.z));
      (inSight ? visible : hidden).push(point);
    }
    const choices = hidden.length ? hidden : visible;
    return choices.length ? choices[Math.floor(random() * choices.length)] : null;
  }

  function spawnThreats(living, dt) {
    spawnClock -= dt;
    const limit = Math.min(director.aliveCap, director.aliveBase + living.length * director.alivePerPlayer);
    if (spawnClock > 0 || !queue.length || enemies.size >= limit) return;
    const anchor = living[spawnIndex++ % living.length];
    const point = spawnPoint(anchor, living) ?? spawnPoint(anchor, living, true);
    spawnClock = waves[wave - 1].spawnEvery;
    if (!point) return;
    const type = queue.pop(), maxHp = Math.round(types[type].hp * waves[wave - 1].health);
    const id = ++enemyId;
    enemies.set(id, { id, type, ...point, yaw: face(point, anchor), hp: maxHp, maxHp,
      state: 'chase', timer: 0, flashAt: -Infinity, staggerAt: 0, recoveryAt: 0, routeAt: 0, rehomeAt: 0,
      route: [], routeCell: null, unreachable: 0, blocked: 0, forceRoute: false, victims: null });
  }

  function startReload(player, weapon, ammo) {
    if (!ammo || player.reloadAt || ammo.mag >= weapon.mag || (!ammo.reserve && !weapon.infiniteReserve)) return;
    if (player.shotWeapon === weapon.id && time + TIME_EPSILON < player.shotAt + (weapon.cycle ?? 0)) return;
    player.pendingShot = 0;
    player.reloadAt = time + weapon.reload * reloadFactor;
    event('reload', { playerId: player.id, weapon: weapon.id });
  }

  function shoot(player, weapon, ammo, controls) {
    if (!ammo || player.reloadAt || time + TIME_EPSILON < player.readyAt) return;
    player.pendingShot = 0;
    if (!ammo.mag) { startReload(player, weapon, ammo); return; }
    player.shotAt = time;
    player.shotWeapon = weapon.id;
    player.readyAt = time + Math.max(1 / weapon.rate, weapon.cycle ?? 0);
    ammo.mag--;
    const cosPitch = Math.cos(player.pitch), sinPitch = Math.sin(player.pitch);
    const heading = direction(player.yaw);
    const spread = weapon.spread;
    const moving = !!(controls?.moveX || controls?.moveZ);
    const cone = (player.aiming ? spread.ads : spread.hip) + (moving ? spread.move * (player.aiming ? .5 : 1) : 0) + player.bloom;
    player.bloom = Math.min(spread.max, player.bloom + spread.bloom * (player.aiming ? .3 : 1));
    const start = { x: player.x, y: rules.eyeHeight, z: player.z };
    const rays = [], hits = new Map();
    for (let i = 0; i < weapon.pellets; i++) {
      const radius = cone * Math.sqrt(scatter()), angle = scatter() * TAU;
      const horizontal = radius * Math.cos(angle), vertical = radius * Math.sin(angle);
      const aim = {
        x: heading.x * (cosPitch - sinPitch * vertical) - heading.z * horizontal,
        y: sinPitch + cosPitch * vertical,
        z: heading.z * (cosPitch - sinPitch * vertical) + heading.x * horizontal,
      };
      const length = Math.hypot(aim.x, aim.y, aim.z);
      aim.x /= length; aim.y /= length; aim.z /= length;
      let meters = structureDistance(world, start, aim, weapon.range), hit;
      for (const enemy of enemies.values()) {
        const type = types[enemy.type];
        const candidate = sphereHit(start, aim, enemy.x, type.hitHeight, enemy.z, type.hitRadius);
        if (candidate < meters) { meters = candidate; hit = enemy; }
      }
      const end = endpoint(start, aim, meters);
      rays.push([round(end.toX), round(end.toY), round(end.toZ)]);
      if (hit) {
        const entry = hits.get(hit);
        if (entry) entry.pellets++;
        else hits.set(hit, { end, pellets: 1 });
      }
    }
    event('shot', { playerId: player.id, weapon: weapon.id, ...start, rays });
    for (const [hit, { end, pellets }] of hits) applyHit(player, hit, end, Math.round(weapon.damage * damageFactor * pellets));
  }

  function applyHit(player, hit, end, damage) {
    hit.hp = Math.max(0, hit.hp - damage);
    hit.flashAt = time;
    event('hit', { enemyId: hit.id, playerId: player.id, x: end.toX, y: end.toY, z: end.toZ, damage });
    if (!hit.hp) {
      enemies.delete(hit.id);
      player.kills++;
      event('defeatEnemy', { enemyId: hit.id, x: hit.x, y: types[hit.type].hitHeight, z: hit.z });
      return;
    }
    const type = types[hit.type];
    if (time < hit.staggerAt || hit.state === 'attack') return;
    hit.staggerAt = time + type.staggerCooldown;
    hit.state = 'stagger';
    hit.timer = type.stagger;
    hit.recoveryAt = Math.max(hit.recoveryAt, time + type.stagger);
  }

  function hurt(player, amount) {
    if (player.downed || player.hurtAt > time) return;
    player.hp = Math.max(0, player.hp - amount);
    player.hurtAt = time + rules.hurtGrace;
    event('hurt', { playerId: player.id, amount });
    if (player.hp) return;
    player.downed = true;
    player.pendingShot = 0;
    player.reviving = null;
    player.reloadAt = 0;
    event('down', { playerId: player.id });
  }

  function updatePlayers(dt) {
    const reviveAssignments = new Map();
    const downed = [...players.values()].filter(player => player.downed);
    for (const player of players.values()) {
      const controls = getInput(player);
      player.reviving = null;
      if (controls) { player.yaw = controls.yaw; player.pitch = controls.pitch; }
      if (player.downed) continue;
      if (phase === 'combat' && controls?.interact) {
        const target = downed.find(other => distance(player, other) <= rules.reviveRadius &&
          world.hasLineOfSight(player.x, player.z, other.x, other.z));
        if (target) {
          player.reviving = target.id;
          if (!reviveAssignments.has(target.id)) reviveAssignments.set(target.id, player);
        }
      }
      if (controls && !player.reviving && (controls.moveX || controls.moveZ)) {
        Object.assign(player, moveServicePlayer(world, player, controls, dt, config));
      }
      if (phase !== 'combat' && phase !== 'prep') continue;
      if (controls?.weapon && controls.weapon !== player.weapon) {
        player.weapon = controls.weapon;
        player.pendingShot = 0;
        player.reloadAt = 0;
        player.bloom = 0;
      }
      const weapon = weaponById(player.weapon), ammo = player.loadout[weapon.id];
      player.aiming = !!(ammo && controls?.aiming && !player.reloadAt);
      player.bloom = Math.max(0, player.bloom - (weapon.spread?.recover ?? 0) * dt);
      if (player.reloadAt && player.reloadAt <= time + TIME_EPSILON) {
        refillMagazine(ammo, weapon);
        player.reloadAt = 0;
      }
      const pressed = controls?.fire && (!player.firing || (controls.trigger !== null && controls.trigger > player.trigger));
      player.firing = controls?.fire ?? false;
      if (player.firing && controls.trigger !== null) player.trigger = Math.max(player.trigger, controls.trigger);
      if (controls?.reload) startReload(player, weapon, ammo);
      if (pressed && !player.reloadAt && !player.reviving) player.pendingShot = time + SHOT_BUFFER_SECONDS;
      if (!player.reviving && (player.pendingShot > time || (weapon.action === 'auto' && player.firing))) {
        shoot(player, weapon, ammo, controls);
      }
    }
    for (const target of downed) {
      const helper = reviveAssignments.get(target.id);
      if (!helper) { target.reviveProgress = Math.max(0, target.reviveProgress - dt / rules.reviveSeconds); continue; }
      target.reviveProgress += dt / rules.reviveSeconds;
      if (target.reviveProgress + TIME_EPSILON < 1) continue;
      target.downed = false;
      target.hp = rules.reviveHealth;
      target.hurtAt = time + rules.hurtGrace * 2;
      target.reviveProgress = 0;
      helper.reviving = null;
      event('revive', { playerId: target.id, byId: helper.id });
    }
  }

  function closestThreatTarget(enemy, living) {
    let wanted = living[0], best = distance(enemy, wanted);
    for (let i = 1; i < living.length; i++) {
      const radius = distance(enemy, living[i]);
      if (radius < best) { wanted = living[i]; best = radius; }
    }
    return { wanted, best };
  }

  function resolveEnemyAttack(enemy, type, living) {
    const heading = direction(enemy.yaw), aim = { ...heading, y: 0 };
    const start = { x: enemy.x, y: type.attackHeight, z: enemy.z };
    let meters = world.rayDistance(start.x, start.z, aim.x, aim.z, type.attackRange);
    if (type.attack === 'pulse') {
      let player = null;
      for (const other of living) {
        if (other.downed) continue;
        const candidate = sphereHit(start, aim, other.x, start.y, other.z, rules.radius + type.attackRadius);
        if (candidate < meters) { meters = candidate; player = other; }
      }
      if (player) hurt(player, type.damage);
    }
    enemy.state = 'attack';
    enemy.timer = type.attackDuration;
    enemy.recoveryAt = time + type.attackDuration + type.recovery;
    enemy.victims = type.attack === 'lunge' ? new Set() : null;
    event('enemyAttack', { enemyId: enemy.id, ...start, ...endpoint(start, aim, meters) });
  }

  function chase(enemy, target, meters, type, dt, living) {
    const visible = world.hasLineOfSight(enemy.x, enemy.z, target.x, target.z);
    if (visible && meters <= type.attackRange && enemy.recoveryAt <= time) {
      enemy.yaw = face(enemy, target);
      enemy.state = 'windup';
      enemy.timer = type.windup;
      enemy.blocked = 0;
      return;
    }
    if (visible && meters <= type.attackRange) return;
    const direct = visible && !enemy.forceRoute;
    let goal = target;
    if (!direct) {
      const targetCell = cellKey(world.cellAt(target.x, target.z));
      // A forced route must finish crossing its current room before a timed
      // replan can send the unit back to the same room's center.
      const refresh = !enemy.forceRoute || !enemy.route.length || enemy.blocked > director.blockingSeconds;
      if (enemy.routeCell !== targetCell || (refresh && time >= enemy.routeAt)) {
        enemy.route = world.path(enemy.x, enemy.z, target.x, target.z, enemy.forceRoute);
        enemy.routeAt = time + director.ordinaryRepath + random() * director.repathJitter;
        enemy.routeCell = targetCell;
      }
      while (enemy.route.length && distance(enemy, enemy.route[0]) <= type.radius * 0.5) enemy.route.shift();
      goal = enemy.route[0];
    }
    if (goal) {
      enemy.yaw = face(enemy, goal);
      const step = Math.min(distance(enemy, goal), type.speed * waves[wave - 1].tempo * dt);
      const heading = direction(enemy.yaw);
      const point = world.move(enemy.x, enemy.z, heading.x * step, heading.z * step, type.radius);
      if (distance(enemy, point) < step * 0.2) {
        enemy.blocked += dt;
        if (enemy.blocked > director.blockingSeconds) {
          if (!enemy.forceRoute) { enemy.forceRoute = true; enemy.routeAt = 0; }
          enemy.unreachable += dt;
        }
      } else {
        enemy.blocked = 0;
        enemy.unreachable = 0;
        if (direct || enemy.route.length < 2) enemy.forceRoute = false;
      }
      Object.assign(enemy, point);
    } else enemy.unreachable += dt;
    if (enemy.rehomeAt > time || (enemy.unreachable < director.unreachableSeconds && meters < director.rehomeDistance)) return;
    if (visible || living.some(player => player !== target && world.hasLineOfSight(enemy.x, enemy.z, player.x, player.z))) return;
    enemy.rehomeAt = time + director.rehomeEvery;
    const location = spawnPoint(target, living);
    if (location) Object.assign(enemy, location, { route: [], routeAt: 0, unreachable: 0, blocked: 0, forceRoute: false });
  }

  function updateEnemies(dt, living) {
    for (const enemy of enemies.values()) {
      const viable = living.filter(playing);
      if (!viable.length) break;
      const type = types[enemy.type], { wanted, best } = closestThreatTarget(enemy, viable);
      enemy.timer -= dt * waves[wave - 1].tempo;
      if (enemy.state === 'windup') {
        if (enemy.timer <= TIME_EPSILON) resolveEnemyAttack(enemy, type, viable);
        continue;
      }
      if (enemy.state === 'attack' && enemy.victims) {
        const heading = direction(enemy.yaw), step = type.attackSpeed * dt * waves[wave - 1].tempo;
        Object.assign(enemy, world.move(enemy.x, enemy.z, heading.x * step, heading.z * step, type.radius));
        for (const other of viable) {
          if (enemy.victims.has(other.id) || distance(enemy, other) > type.attackRadius + rules.radius ||
            !world.hasLineOfSight(enemy.x, enemy.z, other.x, other.z)) continue;
          enemy.victims.add(other.id);
          hurt(other, type.damage);
        }
      }
      if (enemy.state !== 'chase' && enemy.timer > TIME_EPSILON) continue;
      enemy.state = 'chase';
      chase(enemy, wanted, best, type, dt, viable);
    }
  }

  function advance(dt) {
    tickNumber++;
    time = tickNumber * stepSeconds;
    while (events.length && events[0].time < time - simulation.eventSeconds) events.shift();
    updatePlayers(dt);
    if (phase === 'prep') {
      timeLeft = Math.max(0, timeLeft - dt);
      if (timeLeft <= TIME_EPSILON) beginWave();
    }
    if (phase !== 'combat') return;
    const living = [...players.values()].filter(playing);
    if (!living.length) { terminal('defeat'); return; }
    spawnThreats(living, dt);
    updateEnemies(dt, living);
    if (living.every(player => player.downed)) terminal('defeat');
    else if (!queue.length && !enemies.size) clearWave();
  }

  function tick(seconds) {
    if (!players.size) return;
    accumulator += clamp(finite(seconds), 0, simulation.maxFrameSeconds);
    while (accumulator + TIME_EPSILON >= stepSeconds) {
      accumulator -= stepSeconds;
      advance(stepSeconds);
    }
  }

  function snapshot() {
    return { seed, tick: tickNumber, phase, wave, totalWaves: waves.length, timeLeft: round(timeLeft),
      remaining: queue.length + enemies.size, upgrade,
      players: Array.from(players.values(), player => {
        const weapon = weaponById(player.weapon), ammo = player.loadout[weapon.id];
        return {
          id: player.id, x: round(player.x), z: round(player.z), yaw: round(player.yaw), pitch: round(player.pitch),
          hp: player.hp, maxHp, weapon: weapon.id, ammo: ammo?.mag ?? 0, capacity: weapon.mag ?? 0,
          reserve: ammo?.reserve ?? 0, infiniteReserve: !!weapon.infiniteReserve, downed: player.downed, aiming: player.aiming,
          seq: player.seq, reviving: player.reviving, reviveProgress: round(clamp(player.reviveProgress, 0, 1)),
          reloadLeft: round(Math.max(0, player.reloadAt - time)), reloadDuration: round((weapon.reload ?? 0) * reloadFactor),
          shotAge: player.shotWeapon === weapon.id ? round(Math.min(60, time - player.shotAt)) : 60, kills: player.kills,
        };
      }),
      enemies: Array.from(enemies.values(), enemy => ({
        id: enemy.id, type: enemy.type, x: round(enemy.x), z: round(enemy.z), yaw: round(enemy.yaw),
        hp: enemy.hp, maxHp: enemy.maxHp, hit: round(clamp(1 - (time - enemy.flashAt) / simulation.hitFlashSeconds, 0, 1)), state: enemy.state,
      })),
      events: events.map(({ time: ignored, ...entry }) => Object.fromEntries(
        Object.entries(entry).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value]))),
    };
  }

  return { world, join, leave, input, tick, snapshot };
}
