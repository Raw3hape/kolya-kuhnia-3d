import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRoomAuthority } from '../web/js/multiplayer/authority.js';
import { NETWORK_RULES } from '../web/js/multiplayer/rules.js';

const read = name => JSON.parse(readFileSync(new URL(`../web/spec/${name}.json`, import.meta.url)));
const snowSpec = read('snow');

function apartment({ courier = false } = {}) {
  const plan = read('plan.generated');
  const entry = plan.openings.find(opening => opening.type === 'entry');
  const x = (entry.x0 + entry.x1) / 2;
  const socialSpec = read('social'), snapshots = new Map(), replies = new Map(), welcome = new Map(), sequences = new Map();
  socialSpec.rules.firstDelivery = courier ? 0.05 : 10_000;
  let now = 0, serial = 0;
  const room = createRoomAuthority({
    plan, snowSpec, socialSpec, serviceSpec: read('service-level'), site: read('site'), huntSpec: read('hunt'),
    partySpec: read('party'), roomId: 'adventures-test', seed: courier ? 0 : 6, now: () => now,
    send(link, packet) {
      if (packet.type === 'snapshot') snapshots.set(link, packet);
      else if (packet.type === 'result') replies.set(link, packet);
      else if (packet.type === 'welcome') welcome.set(link, packet);
    },
  });
  room.connect('local', { type: 'create', version: NETWORK_RULES.version, name: 'Host', apartment: {},
    doors: { doors: [{ id: entry.id, open: false,
      closed: { ax: entry.x0, az: entry.z0, bx: entry.x1, bz: entry.z0, h: 0.03 },
      opened: { ax: entry.x0, az: entry.z0, bx: entry.x0, bz: entry.z0 + entry.width, h: 0.03 },
    }] } });
  room.connect('guest', { type: 'join', version: NETWORK_RULES.version, name: 'Guest' });

  function action(link, value) {
    room.receive(link, { type: 'action', action: { ...value, requestId: 'adventure-test-' + ++serial } });
    return replies.get(link)?.ok;
  }

  function step(count = 1) {
    for (let i = 0; i < count; i++) {
      now += 50;
      for (const link of welcome.keys()) room.receive(link, { type: 'ping', clientTime: now });
      room.step(0.05);
    }
  }

  const id = link => welcome.get(link).id;
  const player = link => room.snapshot().players.find(member => member.id === id(link));
  function walk(link, targetX, targetZ) {
    for (let i = 0; i < 60; i++) {
      const p = player(link);
      const dx = targetX - p.x, dz = targetZ - p.z, gap = Math.hypot(dx, dz);
      if (gap < 0.003) return;
      step();
      const factor = Math.min(1, 0.13 / gap);
      const seq = (sequences.get(link) || 0) + 1;
      sequences.set(link, seq);
      assert(action(link, { kind: 'input', seq, dt: 0.05, dx: dx * factor, dz: dz * factor, yaw: Math.PI, pitch: 0 }));
    }
    assert.fail('Apartment approach did not reach the destination');
  }

  const hall = link => { walk(link, x, 3.97); walk(link, x, entry.z0 - 0.35); };
  const cross = link => walk(link, x, entry.z1 + 0.04);
  const retreat = link => walk(link, x, entry.z0 - 0.35);
  const door = (link, open) => action(link, { kind: 'door', id: entry.id, open });
  const adventure = (link, verb, value = {}) => action(link, { kind: 'adventure', verb, ...value });
  const route = () => room.snapshot().doorJourney;
  return { room, snapshots, id, step, door, route, adventure, hall, cross, retreat, player, action };
}

test('the same open door gives both clients the same snow seed and separate equipment', t => {
  const f = apartment();
  t.after(() => f.room.dispose());
  const route = f.route();
  assert.equal(route.mode, 'snow');
  assert.equal(f.adventure('local', 'enter', route), false, 'the doorway cannot be skipped');
  f.hall('local');
  assert(f.door('local', true));
  assert.deepEqual(f.route(), route);
  f.cross('local');
  assert(f.adventure('local', 'enter', route));
  f.hall('guest'); f.cross('guest');
  assert(f.adventure('guest', 'enter', route));
  assert.equal(f.adventure('guest', 'equip', { equipment: 'ski' }), false);
  assert.equal(f.player('local').destination, 'snow');
  assert.equal(f.player('guest').destination, 'snow');

  let seq = 0;
  for (let i = 0; i < 38; i++) {
    for (const [link, gear] of [['local', 'ski'], ['guest', 'board']]) {
      const p = f.room.snapshot().snowLevel.players.find(player => player.id === f.id(link));
      const point = snowSpec.station.options[gear];
      const dx = point.x - p.x, dz = point.z - p.z;
      const distance = Math.max(0.15, Math.hypot(dx, dz));
      assert(f.adventure(link, 'input', { input: { seq: ++seq, push: -dz / distance, steer: dx / distance, lookYaw: 0 } }));
    }
    f.step();
  }
  assert(f.adventure('local', 'equip', { equipment: 'ski' }));
  assert(f.adventure('guest', 'equip', { equipment: 'board' }));
  for (let i = 0; i < 45; i++) {
    const input = { seq: ++seq, push: 1, tuck: true };
    assert(f.adventure('local', 'input', { input }));
    assert(f.adventure('guest', 'input', { input }));
    f.step();
  }

  const shared = f.snapshots.get('local').snowLevel;
  assert.deepEqual(shared, f.snapshots.get('guest').snowLevel);
  assert.equal(shared.seed, route.seed);
  assert.deepEqual(shared.players.map(player => player.equipment), ['ski', 'board']);
  assert(shared.players.every(player => player.z < -12 && player.speed > 5));
  assert(f.adventure('guest', 'leave'));
  assert.deepEqual(f.room.snapshot().snowLevel.players.map(player => player.id), [f.id('local')]);
  f.room.disconnect('local');
  assert.equal(f.room.snapshot().snowLevel, null);
});

test('closing rerolls once, isolates two concurrently running destinations and rejects stale entry', t => {
  const f = apartment();
  t.after(() => f.room.dispose());
  const snow = f.route();
  f.hall('local'); assert(f.door('local', true)); f.cross('local');
  assert(f.adventure('local', 'enter', snow));

  f.hall('guest'); assert(f.door('guest', false));
  const service = f.route();
  assert.equal(service.mode, 'service');
  assert.equal(service.revision, snow.revision + 1);
  assert.notEqual(service.seed, snow.seed);
  f.door('guest', false);
  assert.deepEqual(f.route(), service);
  assert(f.door('guest', true)); f.cross('guest');
  assert.equal(f.adventure('guest', 'enter', snow), false);
  assert.equal(f.adventure('guest', 'enter', { ...service, seed: snow.seed }), false);
  assert(f.adventure('guest', 'enter', service));
  assert.equal(f.adventure('guest', 'equip', { equipment: 'board' }), false);
  f.step(5);
  const snapshot = f.room.snapshot();
  assert.equal(snapshot.snowLevel.seed, snow.seed);
  assert.equal(snapshot.serviceLevel.seed, service.seed);
  assert.deepEqual(snapshot.snowLevel.players.map(player => player.id), [f.id('local')]);
  assert.deepEqual(snapshot.serviceLevel.players.map(player => player.id), [f.id('guest')]);
});

test('a courier draw waits for the door, reserves the opening and preserves received pizza on close', t => {
  const f = apartment({ courier: true });
  t.after(() => f.room.dispose());
  const route = f.route();
  assert.equal(route.mode, 'courier');
  f.hall('local');
  assert.equal(f.room.snapshot().social.courier, null, 'automatic delivery is disabled');
  assert(f.door('local', true));
  f.cross('local');
  f.step(20);
  const before = f.room.snapshot();
  assert.equal(before.social.landingReserved, true);
  assert.equal(before.social.courier.phase, 'offering');
  assert.equal(f.adventure('local', 'enter', route), false);
  assert.equal(f.adventure('local', 'enter', { ...route, mode: 'snow' }), false);
  assert.equal(f.room.snapshot().snowLevel, null);
  assert.equal(f.room.snapshot().serviceLevel, null);
  assert.equal(f.player('local').destination, undefined);
  assert.deepEqual(f.route(), route);

  assert(f.action('local', { kind: 'social', verb: 'receive' }));
  const pizza = f.room.snapshot().social.pizza.id;
  f.retreat('local');
  assert(f.door('local', false));
  f.step(20);
  const after = f.room.snapshot();
  assert.equal(after.social.courier, null);
  assert.equal(after.social.landingReserved, false);
  assert.equal(after.social.pizza.id, pizza);
  assert.equal(after.social.pizza.owner, f.id('local'));
  assert.equal(f.player('local').held, 'pizza');
  assert.equal(f.route().mode, 'snow');
  assert.equal(f.route().revision, route.revision + 1);
});
