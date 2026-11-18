import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServiceLevel, moveServicePlayer, normalizeServiceInput } from '../web/js/service-level-simulation.js';
import { createRoomAuthority } from '../web/js/multiplayer/authority.js';
import { NETWORK_RULES, WEAPON_RULES } from '../web/js/multiplayer/rules.js';

const readSpec = name => JSON.parse(readFileSync(new URL(`../web/spec/${name}.json`, import.meta.url), 'utf8'));
const authored = readSpec('service-level');
const aimAt = (from, to) => Math.atan2(from.x - to.x, from.z - to.z);
const range = (from, to) => Math.hypot(from.x - to.x, from.z - to.z);
const stepSeconds = 1 / authored.simulation.tickHz;

test('shared service-level motion normalizes input and releases stale controls', () => {
  const sim = createServiceLevel({ config: authored });
  assert.equal(sim.join('a'), true);
  assert.equal(sim.join('a'), false);
  const input = normalizeServiceInput({ seq: 4, yaw: Math.PI * 2, pitch: 4, moveX: 4, moveZ: 4, fire: 1 });
  assert.deepEqual(input, { seq: 4, yaw: 0, pitch: Math.PI / 2, moveX: 1, moveZ: 1, fire: false, trigger: null, weapon: null, aiming: false, reload: false, interact: false });
  const origin = sim.snapshot().players[0];
  const prediction = moveServicePlayer(sim.world, origin, input, 0.1, authored);
  assert.ok(Math.abs(range(origin, prediction) - authored.player.speed * 0.1) < 1e-8);
  assert.equal(sim.input('a', input), true);
  assert.equal(sim.input('a', { seq: 4, moveZ: -1 }), false);
  sim.tick(0.1);
  const authoritative = sim.snapshot().players[0];
  assert.ok(range(prediction, authoritative) < 0.001);
  assert.ok(authoritative.x > 0 && authoritative.z < 0);

  sim.input('a', null);
  sim.tick(0.2);
  assert.equal(range(authoritative, sim.snapshot().players[0]), 0);
  sim.input('a', { seq: 5, moveZ: 1 });
  for (let i = 0; i < 4; i++) sim.tick(0.2);
  const timedOut = sim.snapshot().players[0];
  sim.tick(0.2);
  assert.equal(range(timedOut, sim.snapshot().players[0]), 0);
  assert.equal(timedOut.seq, 5);
  assert.equal(sim.leave('a'), true);
  assert.equal(sim.leave('a'), false);
  assert.deepEqual(sim.snapshot().players, []);
});

test('same seed and controls produce identical JSON snapshots under different tick partitions', () => {
  const config = structuredClone(authored);
  config.director.initialPrep = 0.25;
  const one = createServiceLevel({ seed: 'partition', config });
  const two = createServiceLevel({ seed: 'partition', config });
  for (const sim of [one, two]) { sim.join('host'); sim.join('guest'); }
  for (let i = 0; i < 300; i++) {
    if (i % 3 === 0) for (const sim of [one, two]) {
      sim.input('host', { seq: i, yaw: i * 0.01, moveZ: 0.6, fire: true, reload: i % 17 === 0 });
      sim.input('guest', { seq: i, yaw: -i * 0.02, moveX: -0.5, moveZ: 0.3 });
    }
    one.tick(stepSeconds);
    two.tick(stepSeconds / 2);
    two.tick(stepSeconds / 2);
  }
  const snapshot = one.snapshot();
  assert.equal(JSON.stringify(snapshot), JSON.stringify(two.snapshot()));
  assert.equal(snapshot.players.length, 2);
  assert.ok(snapshot.enemies.length > 0);
  assert.ok(snapshot.events.every((event, i, array) => i === 0 || event.id > array[i - 1].id));
});

test('the full room enters at distinct positions without exceeding its player limit', () => {
  const sim = createServiceLevel({ seed: 'ten-player-spawn', config: authored });
  for (let i = 0; i < authored.player.maxPlayers; i++) assert.equal(sim.join('player-' + i), true);
  assert.equal(sim.join('extra'), false);
  const { players } = sim.snapshot();
  for (const a of players) for (const b of players) {
    if (a.id < b.id) assert.ok(range(a, b) >= authored.player.radius * 2 - 0.002);
  }
});

test('a teammate can revive under pressure and an unattended solo player reaches defeat', () => {
  const config = structuredClone(authored);
  config.director.initialPrep = 0.2;
  config.director.teamBonus = 0;
  config.waves = [{ ...config.waves[0], count: 1 }];
  // One short lunge can down one stationary player regardless of which entrance the foe uses.
  Object.assign(config.enemies.stamper, {
    damage: 100, attackRange: 0.55, attackRadius: 0.12, attackSpeed: 2.4, attackDuration: 0.2, recovery: 99,
  });
  const duo = createServiceLevel({ seed: 'revive:0', config });
  const solo = createServiceLevel({ seed: 'revive:0', config });
  duo.join('a');
  duo.join('b');
  solo.join('a');
  let revived, partiallyRevived = false;
  for (let i = 0; i < 400 && !revived; i++) {
    const state = duo.snapshot();
    const down = state.players.find(player => player.downed);
    const helper = state.players.find(player => !player.downed);
    if (down) {
      partiallyRevived ||= down.reviveProgress > 0 && down.reviveProgress < 1;
      duo.input(helper.id, { seq: i, yaw: aimAt(helper, down), interact: true });
    }
    duo.tick(0.05);
    solo.tick(0.05);
    revived = duo.snapshot().events.find(event => event.type === 'revive');
  }
  assert.ok(partiallyRevived);
  assert.ok(revived && revived.playerId !== revived.byId);
  assert.equal(duo.snapshot().players.find(player => player.id === revived.playerId).hp, config.player.reviveHealth);
  for (let i = 0; i < 300 && solo.snapshot().phase !== 'defeat'; i++) solo.tick(0.05);
  assert.equal(solo.snapshot().phase, 'defeat');
  assert.equal(solo.snapshot().players[0].hp, 0);
  assert.equal(solo.snapshot().remaining, 0);
});

test('the authored ten-wave solo campaign is winnable with actual movement, aiming and ammo', () => {
  const sim = createServiceLevel({ seed: 'campaign-test', config: authored });
  const { world } = sim;
  sim.join('test');
  const seenWaves = new Set(), upgrades = new Set(), enemies = new Set(), events = new Set();
  for (let i = 0; i < 7200; i++) {
    const state = sim.snapshot(), player = state.players[0];
    seenWaves.add(state.wave);
    if (state.upgrade) upgrades.add(state.upgrade);
    for (const enemy of state.enemies) enemies.add(enemy.type);
    for (const event of state.events) events.add(event.type);
    if (state.phase === 'victory' || state.phase === 'defeat') break;
    const controls = { seq: i, yaw: player.yaw, reload: player.ammo === 0 };
    const foes = state.enemies.sort((a, b) => range(a, player) - range(b, player));
    const target = foes.find(enemy => world.hasLineOfSight(player.x, player.z, enemy.x, enemy.z));
    if (target) {
      const meters = range(target, player);
      const elevation = authored.enemies[target.type].hitHeight - authored.player.eyeHeight;
      Object.assign(controls, { yaw: aimAt(player, target), pitch: Math.atan2(elevation, meters),
        fire: true, moveZ: meters < 4 ? -1 : 0 });
    } else if (foes.length) {
      const waypoint = world.path(player.x, player.z, foes[0].x, foes[0].z)[0];
      if (waypoint) Object.assign(controls, { yaw: aimAt(player, waypoint), moveZ: 1 });
    }
    sim.input('test', controls);
    sim.tick(0.05);
  }
  const state = sim.snapshot();
  assert.equal(state.phase, 'victory');
  assert.deepEqual([...seenWaves], authored.waves.map((_, i) => i + 1));
  assert.deepEqual([...upgrades], authored.perks.map(perk => perk.id));
  assert.deepEqual([...enemies].sort(), Object.keys(authored.enemies).sort());
  for (const type of ['hit', 'defeatEnemy', 'shot', 'enemyAttack', 'reload', 'waveClear', 'outcome']) assert.ok(events.has(type), type);
  assert.equal(state.players[0].kills, authored.waves.reduce((count, wave) => count + wave.count, 0));
  assert.equal(state.remaining, 0);
});

test('two room peers cross the original apartment threshold and share one run', () => {
  const plan = readSpec('plan.generated'), door = plan.openings.find(opening => opening.type === 'entry');
  const x = (door.x0 + door.x1) / 2;
  const serviceSpec = structuredClone(authored);
  serviceSpec.director.initialPrep = 0.25;
  const packets = new Map(), ids = new Map(), sequences = new Map();
  let clock = 0, request = 0;
  const room = createRoomAuthority({
    roomId: 'service-level-test', plan, serviceSpec, site: readSpec('site'), huntSpec: readSpec('hunt'),
    partySpec: readSpec('party'), socialSpec: readSpec('social'), seed: 17, now: () => clock,
    send(link, packet) {
      packets.set(link + ':' + packet.type, packet);
      if (packet.type === 'welcome') ids.set(link, packet.id);
    },
  });
  room.connect('local', { type: 'create', version: NETWORK_RULES.version, name: 'Host', apartment: {},
    doors: { doors: [{ id: door.id, open: false,
      closed: { ax: door.x0, bx: door.x1, az: door.z0, bz: door.z0, h: 0.03 },
      opened: { ax: door.x0, bx: door.x0, az: door.z0, bz: door.z0 + door.width, h: 0.03 },
    }] },
  });
  room.connect('guest', { type: 'join', version: NETWORK_RULES.version, name: 'Guest' });
  assert.equal(ids.size, 2);
  const action = (link, value) => {
    room.receive(link, { type: 'action', action: { ...value, requestId: 'run-' + ++request } });
    return packets.get(link + ':result')?.ok;
  };
  const command = (link, verb, input) => action(link, { kind: 'adventure', verb, input, ...room.snapshot().doorJourney });
  const step = () => {
    clock += 50;
    for (const link of ids.keys()) room.receive(link, { type: 'ping', clientTime: clock });
    room.step(0.05);
  };
  const march = (link, target) => {
    for (let i = 0; i < 50; i++) {
      const player = room.snapshot().players.find(member => member.id === ids.get(link));
      const meters = range(target, player);
      if (meters < 0.002) return;
      const amount = Math.min(1, 0.13 / meters);
      const seq = (sequences.get(link) ?? 0) + 1;
      step();
      sequences.set(link, seq);
      assert.equal(action(link, { kind: 'inputs', inputs: [{ seq, dt: 0.05,
        dx: (target.x - player.x) * amount, dz: (target.z - player.z) * amount, yaw: 0, pitch: 0 }] }), true);
    }
    assert.fail('Could not reach the original apartment doorway');
  };

  try {
    assert.equal(command('local', 'enter'), false);
    const seed = room.snapshot().doorJourney.seed;
    march('local', { x, z: 3.97 });
    march('local', { x, z: door.z0 - 0.35 });
    assert.equal(action('local', { kind: 'door', id: door.id, open: true }), true);
    march('local', { x, z: door.z1 + 0.04 });
    assert.equal(command('local', 'enter'), true);
    assert.equal(room.snapshot().serviceLevel.seed, seed);
    march('guest', { x, z: 3.97 });
    march('guest', { x, z: door.z1 + 0.04 });
    assert.equal(action('guest', { kind: 'weapon', weapon: 'uzi' }), true);
    assert.equal(command('guest', 'enter'), true);
    assert.equal(room.snapshot().serviceLevel.players.find(member => member.id === ids.get('guest')).weapon, 'uzi');
    assert.equal(command('guest', 'restart'), false);
    assert.equal(command('guest', 'input', { seq: 1, moveZ: 1, yaw: 0, pitch: 0, fire: true }), true);
    for (let i = 0; i < 3; i++) step();
    const local = packets.get('local:snapshot').serviceLevel;
    const guest = packets.get('guest:snapshot').serviceLevel;
    assert.deepEqual(guest, local);
    assert.equal(guest.players.length, 2);
    assert.equal(guest.phase, 'combat');
    const guestPlayer = guest.players.find(member => member.id === ids.get('guest'));
    assert.ok(guestPlayer.z < 0);
    const shots = guest.events.filter(event => event.type === 'shot' && event.playerId === guestPlayer.id);
    assert.equal(shots.length, 2);
    assert.ok(shots.every(event => event.weapon === 'uzi' && event.rays.length === 1));
    assert.equal(guestPlayer.ammo, WEAPON_RULES.uzi.mag - shots.length);
    assert.equal(command('guest', 'leave'), true);
    assert.deepEqual(room.snapshot().serviceLevel.players.map(member => member.id), [ids.get('local')]);
    room.disconnect('local');
    assert.equal(room.snapshot().serviceLevel, null);
    assert.equal(room.snapshot().doorJourney.seed, seed);
  } finally {
    room.dispose();
  }
});


test('maze loadout keeps magazines per weapon and resolves shared pellet, trigger and reload rules', () => {
  const sim = createServiceLevel({ config: authored, seed: 73 });
  sim.join('tester', 'shotgun');
  let seq = 0;
  const active = () => sim.snapshot().players[0];
  const send = controls => {
    assert.equal(sim.input('tester', { ...controls, seq: ++seq }), true);
    sim.tick(.05);
  };
  const shotgun = WEAPON_RULES.shotgun;
  send({ fire: true, trigger: 1 });
  assert.equal(active().ammo, shotgun.mag - 1);
  const shot = sim.snapshot().events.find(event => event.type === 'shot');
  assert.equal(shot.weapon, 'shotgun');
  assert.equal(shot.rays.length, shotgun.pellets);
  assert.ok(new Set(shot.rays.map(ray => ray.join(','))).size > 1);
  for (let i = 0; i < 8; i++) send({ fire: true, trigger: 1 });
  assert.equal(active().ammo, shotgun.mag - 1, 'holding a single-shot trigger cannot fire twice');
  send({ weapon: 'uzi', fire: true, trigger: 2, aiming: true });
  assert.equal(active().weapon, 'uzi');
  assert.equal(active().aiming, true);
  assert.equal(active().ammo, WEAPON_RULES.uzi.mag - 1);
  send({ weapon: 'none' });
  assert.equal(active().capacity, 0);
  send({ weapon: 'shotgun', reload: true });
  assert.equal(active().ammo, shotgun.mag - 1);
  assert.ok(active().reloadLeft > 0);
  for (let i = 0; i <= Math.ceil(shotgun.reload / .05); i++) send({});
  assert.equal(active().ammo, shotgun.mag);
  assert.equal(active().reserve, shotgun.reserve);
  send({ weapon: 'uzi' });
  assert.equal(active().ammo, WEAPON_RULES.uzi.mag - 1);
  send({ fire: true, trigger: 3 });
  send({ weapon: 'shotgun', fire: true, trigger: 4 });
  send({ fire: false });
  assert.equal(active().ammo, shotgun.mag - 1, 'a click just after switching survives the previous weapon cooldown');
});
