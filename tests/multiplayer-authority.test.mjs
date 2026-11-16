import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoomAuthority, sanitizeObjects } from '../web/js/multiplayer/authority.js';
import { NETWORK_RULES as R, WEAPON_RULES } from '../web/js/multiplayer/rules.js';
import { WALK } from '../web/js/multiplayer/collision.js';
import { actionDuration, sampleAvatarAction, selectAvatarPresentation } from '../web/js/multiplayer/action-contract.js';

const read = name => JSON.parse(readFileSync(new URL(`../web/spec/${name}.json`, import.meta.url)));
const plan = read('plan.generated'), site = read('site'), huntSpec = read('hunt');
const aim = (from, to) => { const d = to.map((v, i) => v - from[i]), n = Math.hypot(...d); return d.map(v => v / n); };

function fixture(options = {}) {
  let wallTime = 0, requestSeq = 0;
  const packets = [], commands = new Map();
  const spec = options.oneBoar ? { ...huntSpec, boars: { ...huntSpec.boars, count: 1 }, birds: { ...huntSpec.birds, flocks: [] } } : huntSpec;
  const room = createRoomAuthority({ roomId: 'test-room', plan, site, huntSpec: spec, seed: 17, now: () => wallTime,
    send(link, packet) { packets.push({ link, packet: structuredClone(packet) }); } });
  const last = (link, type) => packets.findLast(entry => entry.link === link && entry.packet.type === type)?.packet;
  room.connect('local', { type: 'create', version: R.version, name: 'Владелец', apartment: { floorA: 1 }, ...options.geometry });
  const host = last('local', 'welcome'); assert(host, 'host should create an actual-plan room');
  function join(link, extra = {}) {
    room.connect(link, { type: 'join', version: R.version, name: link, ...extra });
    return last(link, 'welcome');
  }
  function action(link, value, trusted) {
    const requestId = `test-${++requestSeq}`;
    room.receive(link, { type: 'action', action: { ...value, requestId } }, trusted);
    return last(link, 'result');
  }
  function tick(seconds = 1 / 60) { wallTime += seconds * 1000; room.step(seconds); }
  function move(link, dx, dz, dt = 1 / 60) {
    const seq = (commands.get(link) || 0) + 1; commands.set(link, seq);
    tick(dt);
    action(link, { kind: 'inputs', inputs: [{ seq, dt, dx, dz, yaw: 0, pitch: 0 }] });
  }
  return { room, host, join, action, tick, move, last, packets, player: id => room.snapshot().players.find(p => p.id === id) };
}

test('host and nine guests receive distinct characters; player eleven is rejected', () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) assert(f.join(`guest-${i}`));
  const s = f.room.snapshot();
  assert.equal(s.players.length, 10);
  assert.equal(new Set(s.players.map(p => p.avatar)).size, 10);
  for (const a of s.players) for (const b of s.players) if (a.id < b.id)
    assert(Math.hypot(a.x - b.x, a.z - b.z) >= WALK.radius * 2 - 0.002, 'spawn must not overlap bodies');
  f.join('eleventh'); assert.equal(f.last('eleventh', 'error').error, 'room_full');
  f.room.dispose();
});

test('guest cannot mutate apartment, geometry, damage reset or host ambient state', () => {
  const f = fixture(); f.join('guest');
  const before = f.room.snapshot();
  for (const action of [{ kind: 'apartment', apartment: { floorA: 9 } }, { kind: 'geometry', objects: [] }, { kind: 'clear' }, { kind: 'ambient', ambient: { water: true } }])
    assert.equal(f.action('guest', action).ok, false);
  const after = f.room.snapshot();
  assert.deepEqual(after.apartment, before.apartment); assert.equal(after.revision, before.revision); assert.equal(after.epoch, before.epoch); assert.equal(after.ambient, null);
  assert.equal(f.action('local', { kind: 'apartment', apartment: { floorA: 3 } }).ok, true);
  assert.equal(f.room.snapshot().apartment.floorA, 3);
  assert.equal(f.action('local', { kind: 'ambient', ambient: { water: true } }).ok, true);
  assert.deepEqual(f.room.snapshot().ambient, { water: true });
  f.room.dispose();
});

test('exclusive item race has one winner; switching item and disconnect release it', () => {
  const f = fixture({ geometry: { items: [{ id: 'phone', position: [WALK.start.x, 1.2, WALK.start.z] }, { id: 'newspaper', position: [WALK.start.x, 1.2, WALK.start.z] }] } });
  const guest = f.join('guest');
  assert.equal(f.action('local', { kind: 'claim', id: 'phone' }).ok, true);
  assert.equal(f.action('guest', { kind: 'claim', id: 'phone' }).ok, false);
  assert.equal(f.room.snapshot().items.phone, f.host.id);
  assert.equal(f.action('local', { kind: 'claim', id: 'newspaper' }).ok, true);
  assert.equal(f.room.snapshot().items.phone, null); assert.equal(f.room.snapshot().items.newspaper, f.host.id);
  assert.equal(f.action('guest', { kind: 'claim', id: 'phone' }).ok, true);
  f.room.disconnect('guest'); assert.equal(f.room.snapshot().items.phone, null);
  assert(!f.room.snapshot().players.some(p => p.id === guest.id));
  f.room.dispose();
});

test('seats have exclusive ownership, preserve handheld items and release on stand/disconnect', () => {
  const seat = { id: 'test-chair', position: [WALK.start.x - 0.8, 0.45, WALK.start.z], yaw: 0, eyeY: 1.17, stand: [WALK.start.x, WALK.start.z] };
  const f = fixture({ geometry: { seats: [seat], items: [{ id: 'phone', position: [WALK.start.x, 1.2, WALK.start.z] }] } });
  assert.equal(f.action('local', { kind: 'claim', id: 'phone' }).ok, true);
  assert.equal(f.action('local', { kind: 'sit', id: seat.id }).ok, true);
  const guest = f.join('guest');
  assert.equal(f.room.snapshot().seats[seat.id], f.host.id);
  assert.equal(f.player(f.host.id).held, 'phone');
  assert.equal(f.action('guest', { kind: 'sit', id: seat.id }).ok, false);
  const sitting = f.player(f.host.id);
  f.move('local', 0.1, 0, 0.05);
  assert.equal(f.player(f.host.id).x, sitting.x, 'seated body ignores movement commands');
  assert.equal(f.action('local', { kind: 'stand' }).ok, true);
  assert.equal(f.room.snapshot().seats[seat.id], null); assert.equal(f.player(f.host.id).seat, null);
  assert.equal(f.action('guest', { kind: 'sit', id: seat.id }).ok, true);
  f.room.disconnect('guest'); assert.equal(f.room.snapshot().seats[seat.id], null);
  assert(!f.room.snapshot().players.some(p => p.id === guest.id));
  f.room.dispose();
});

test('resume preserves identity, cannot steal the owner role, and obeys a full room', () => {
  const f = fixture(), guest = f.join('old');
  f.room.disconnect('old');
  const resumed = f.join('new', { token: guest.token }); assert.equal(resumed.id, guest.id);
  f.join('thief', { token: f.host.token }); assert.equal(f.last('thief', 'error').error, 'host_reserved');
  f.room.disconnect('new');
  for (let i = 0; i < 9; i++) assert(f.join(`full-${i}`));
  f.join('resume-full', { token: guest.token }); assert.equal(f.last('resume-full', 'error').error, 'room_full');
  f.room.dispose();
});

test('a duplicate connection cannot create a blocking ghost body', () => {
  const f = fixture(); f.join('guest'); f.join('guest');
  assert.equal(f.room.size, 2); assert.equal(f.last('guest', 'error').error, 'connection_exists');
  f.room.dispose();
});

test('movement is speed bounded and cannot tunnel through a thin wall or another body', () => {
  const f = fixture();
  let p = f.player(f.host.id), x = p.x, z = p.z;
  f.move('local', 1000, 0, 0.05); p = f.player(f.host.id);
  assert(Math.hypot(p.x - x, p.z - z) <= WALK.run * 0.05 + 0.002);
  f.action('local', { kind: 'geometry', collision: { extra: [{ x0: p.x + 0.4, x1: p.x + 0.42, z0: p.z - 2, z1: p.z + 2 }] } });
  const wallX = p.x + 0.4;
  for (let i = 0; i < 30; i++) f.move('local', 0.05, 0);
  assert(f.player(f.host.id).x <= wallX - WALK.radius + 0.002);
  const guest = f.join('guest'); assert(guest);
  const target = f.player(guest.id);
  for (let i = 0; i < 40; i++) {
    p = f.player(f.host.id); const d = aim([p.x, 0, p.z], [target.x, 0, target.z]);
    f.move('local', d[0] * 0.05, d[2] * 0.05);
  }
  p = f.player(f.host.id);
  assert(Math.hypot(p.x - target.x, p.z - target.z) >= WALK.radius * 2 - 0.002);
  f.room.dispose();
});

test('door checks the swept arc against all players, not only the final leaf', () => {
  const f = fixture(), p = f.player(f.host.id);
  const hinge = [p.x - 0.5, p.z - 0.5];
  const door = { id: 'sweep-test', open: false,
    closed: { ax: hinge[0], az: hinge[1], bx: hinge[0] + 1, bz: hinge[1], h: 0.02 },
    opened: { ax: hinge[0], az: hinge[1], bx: hinge[0], bz: hinge[1] + 1, h: 0.02 } };
  assert.equal(f.action('local', { kind: 'geometry', doors: { doors: [door], blockers: [] } }).ok, true);
  assert.equal(f.action('local', { kind: 'door', id: door.id, open: true }).ok, false, 'player lies on middle of swing arc');
  assert.equal(f.room.snapshot().doors[door.id], false);
  f.room.dispose();
});

test('malformed commands and prototype weapon names do not corrupt a room', () => {
  const f = fixture(); f.join('guest');
  for (const packet of [null, [], {}, { type: 'action', action: null }, { type: 'action', action: { kind: 'shoot', weapon: 'pistol', rays: [null] } }])
    assert.doesNotThrow(() => f.room.receive('guest', packet));
  for (const weapon of ['__proto__', 'constructor', 'toString']) assert.equal(f.action('guest', { kind: 'weapon', weapon }).ok, false);
  assert.equal(f.action('guest', { kind: 'inputs', inputs: [{ seq: 1, dt: 0.05, dx: NaN, dz: 0, yaw: 0, pitch: 0 }] }).ok, true);
  const s = f.room.snapshot(); assert(s.players.every(p => [p.x, p.y, p.z].every(Number.isFinite)));
  assert.doesNotThrow(() => f.action('local', { kind: 'geometry', collision: { extra: 'bad' }, doors: { doors: {} }, items: {} }));
  f.room.dispose();
});

function boarShot(f, link, playerId, shotId) {
  const p = f.player(playerId), animal = f.room.snapshot().hunt.animals[0];
  const origin = [p.x, p.y + WALK.height / 100 * WALK.eyeRatio, p.z];
  const direction = aim(origin, [animal.x, animal.y + animal.scale * 0.6, animal.z]);
  return { kind: 'shoot', weapon: 'bolt', shotId, origin, direction, rays: [{ direction }] };
}

test('simultaneous shooters produce one wildlife death and one score award; duplicate shot is rejected', () => {
  const f = fixture({ oneBoar: true }), guest = f.join('guest');
  const shot = boarShot(f, 'local', f.host.id, 'one-kill');
  assert.equal(f.action('local', shot, { worldTrace: [[]] }).ok, true);
  assert.equal(f.action('local', shot, { worldTrace: [[]] }).ok, false);
  assert.equal(f.action('guest', boarShot(f, 'guest', guest.id, 'second-shooter'), { worldTrace: [[]] }).ok, true);
  const s = f.room.snapshot(); assert.equal(s.hunt.animals.filter(a => a.dead).length, 1);
  assert.equal(s.players.reduce((n, p) => n + p.kills, 0), 1); assert.equal(f.player(f.host.id).kills, 1); assert(f.player(f.host.id).score > 0);
  f.room.dispose();
});

test('trusted exact world trace overrides broad boxes; a nearer animal protects farther surfaces', () => {
  const f = fixture({ oneBoar: true }), shot = boarShot(f, 'local', f.host.id, 'exact');
  const far = shot.origin.map((v, i) => v + shot.direction[i] * 700);
  assert.equal(f.action('local', { kind: 'geometry', objects: [{ id: 'far-glass', unitId: 'far-unit', glass: true, breakable: 'glass', bounds: [...far.map(v => v - 1), ...far.map(v => v + 1)] }] }).ok, true);
  assert.equal(f.action('local', shot, { worldTrace: [[{ objectId: 'far-glass', point: far, normal: shot.direction.map(v => -v), distance: 700 }]] }).ok, true);
  const s = f.room.snapshot(); assert.equal(s.hunt.animals[0].dead, true); assert(!s.broken.includes('far-unit'));
  f.room.dispose();
});

test('planar screens and mirrors remain collision targets, and late opaque geometry blocks wildlife', () => {
  const normalized = sanitizeObjects([
    { id: 'screen', bounds: [0, 1, 2, 1, 2, 2] },
    { id: 'mirror', bounds: [3, 0, 0, 3, 2, 1], breakable: 'glass' },
    { id: 'degenerate-line', bounds: [0, 0, 0, 0, 0, 1] },
  ]);
  assert.equal(normalized.length, 2);
  for (const object of normalized) assert([0, 1, 2].every(axis => object.bounds[axis + 3] > object.bounds[axis]));
  const f = fixture({ oneBoar: true }), shot = boarShot(f, 'local', f.host.id, 'late-opaque');
  const point = shot.origin.map((value, i) => value + shot.direction[i] * 0.25);
  assert.equal(f.action('local', shot, { worldTrace: [[{ objectId: 'not-yet-in-manifest', kind: 'surface', point,
    normal: shot.direction.map(value => -value), distance: 0.25 }]] }).ok, true);
  assert.equal(f.room.snapshot().hunt.animals[0].dead, false);
  assert.equal(f.player(f.host.id).kills, 0);
  f.room.dispose();
});

test('breaking a parent retains dependent destruction in persistent late-join state', () => {
  const f = fixture(), p = f.player(f.host.id);
  const origin = [p.x, 1.68, p.z], direction = [0, 0, 1], point = [p.x, 1.68, p.z + 0.5];
  f.action('local', { kind: 'geometry', objects: [{ id: 'jar', unitId: 'jar-unit', breakable: 'glass', glass: true,
    bounds: [p.x - 0.1, 1.4, p.z + 0.4, p.x + 0.1, 1.9, p.z + 0.6], dependentIds: ['jar-contents'] }] });
  assert.equal(f.action('local', { kind: 'shoot', weapon: 'pistol', shotId: 'jar-shot', origin, direction, rays: [{ direction }] },
    { worldTrace: [[{ objectId: 'jar', point, normal: [0, 0, -1], distance: 0.5 }]] }).ok, true);
  assert.deepEqual(new Set(f.room.snapshot().broken), new Set(['jar-unit', 'jar-contents']));
  const guest = f.join('late'); assert.deepEqual(new Set(guest.snapshot.broken), new Set(['jar-unit', 'jar-contents']));
  f.room.dispose();
});

test('external targets clip wildlife; private completion derives points and awards one kill once', () => {
  const f = fixture({ oneBoar: true }), shot = boarShot(f, 'local', f.host.id, 'mouse-shot');
  const external = { animalId: 'mouse:1', species: 'mouse', running: true, distance: 0.5,
    point: shot.origin.map((v, i) => v + shot.direction[i] * 0.5), normal: shot.direction.map(v => -v) };
  assert.equal(f.action('local', shot, { worldTrace: [[]], externalTrace: [external] }).ok, true);
  assert.equal(f.room.snapshot().hunt.animals[0].dead, false);
  assert.equal(f.room.completeExternal(shot.shotId, [{ animalId: external.animalId, killed: true, points: 999999 }], f.host.id), true);
  assert.equal(f.player(f.host.id).score, 375); assert.equal(f.player(f.host.id).kills, 1);
  assert.equal(f.room.completeExternal(shot.shotId, [{ animalId: external.animalId, killed: true }], f.host.id), false);
  assert.equal(f.action('local', { kind: 'completeExternal', shotId: shot.shotId }).ok, false);
  f.room.dispose();
});

test('damage journal and ambient state are bounded by UTF-8 bytes', () => {
  const f = fixture({ oneBoar: true }), p = f.player(f.host.id), id = `glass-${'x'.repeat(390)}`;
  const origin = [p.x, 1.68, p.z], direction = [0, 1, 0], point = [p.x, 2.18, p.z];
  f.action('local', { kind: 'geometry', objects: [{ id, unitId: id, glass: true, bounds: [p.x - 0.1, 2.1, p.z - 0.1, p.x + 0.1, 2.3, p.z + 0.1] }] });
  for (let i = 0; i < 60; i++) {
    if (!f.player(f.host.id).ammo.rifle.mag) {
      assert.equal(f.action('local', { kind: 'reload', weapon: 'rifle' }).ok, true);
      for (let n = 0; n < 50; n++) f.tick(0.05);
    }
    for (let n = 0; n < 3; n++) f.tick(0.04);
    assert.equal(f.action('local', { kind: 'shoot', weapon: 'rifle', shotId: `journal-${i}`, origin, direction, rays: [{ direction }] },
      { worldTrace: [[{ objectId: id, point, normal: [0, -1, 0], distance: 0.5 }]] }).ok, true);
  }
  const effects = f.room.snapshot().effects;
  assert(effects.length < 60, 'byte cap should trim before the 192-shot count cap');
  assert(Buffer.byteLength(JSON.stringify(effects)) <= R.maxEffectsBytes);
  assert.equal(f.action('local', { kind: 'ambient', ambient: { text: 'Ж'.repeat(R.maxAmbientBytes) } }).ok, false);
  f.room.dispose();
});

test('shared media, hood and newspaper state enforce ownership and persist through return/late join', () => {
  const meta = { media: { phone: ['videoOne', 'videoTwo', 'videoTri'], tv: ['publicOne', 'publicTwo'] },
    newspaperPages: [4, 3], hoodPosition: [WALK.start.x, 2, WALK.start.z] };
  const f = fixture({ geometry: { interactionMeta: meta,
    interactions: { hood: { level: 2 }, 'media:phone': { index: 1, playing: true }, 'media:tv': { index: 0, playing: true }, newspaper: { issue: 1, page: 2 } },
    items: [{ id: 'phone', position: [WALK.start.x, 1.2, WALK.start.z] }, { id: 'newspaper', position: [WALK.start.x, 1.2, WALK.start.z] }] } });
  f.join('guest');
  assert.equal(f.room.snapshot().interactions['media:phone'].videoId, 'videoTwo');
  assert.equal(f.action('local', { kind: 'interaction', id: 'media:phone', value: { index: 2 } }).ok, false, 'only the holder changes the shared phone');
  assert.equal(f.action('guest', { kind: 'claim', id: 'phone' }).ok, true);
  assert.equal(f.action('guest', { kind: 'interaction', id: 'media:phone', value: { index: 2, playing: true, volume: 0 } }).ok, true);
  assert.equal(f.action('guest', { kind: 'interaction', id: 'media:phone', value: { index: 999 } }).ok, false);
  assert.equal(f.action('guest', { kind: 'interaction', id: 'newspaper', value: { issue: 0, page: 1 } }).ok, false);
  assert.equal(f.action('local', { kind: 'claim', id: 'newspaper' }).ok, true);
  assert.equal(f.action('local', { kind: 'interaction', id: 'newspaper', value: { issue: 0, page: 3 } }).ok, true);
  assert.equal(f.action('local', { kind: 'interaction', id: 'newspaper', value: { issue: 0, page: 4 } }).ok, false);
  assert.equal(f.action('local', { kind: 'release', id: 'newspaper' }).ok, true);
  assert.deepEqual(f.room.snapshot().interactions.newspaper, { issue: 1, page: 0 });
  assert.equal(f.action('guest', { kind: 'interaction', id: 'hood', value: { level: 3 }, expectedLevel: 2 }).ok, true);
  assert.equal(f.action('local', { kind: 'interaction', id: 'hood', value: { level: 0 }, expectedLevel: 2 }).ok, false, 'stale local level cannot overwrite a newer shared toggle');
  assert.equal(f.action('guest', { kind: 'release', id: 'phone' }).ok, true);
  const late = f.join('late-interactions').snapshot;
  assert.deepEqual(late.interactions['media:phone'], { index: 2, videoId: 'videoTri', playing: true });
  assert.deepEqual(late.interactions.hood, { level: 3 });
  assert.deepEqual(late.interactions.newspaper, { issue: 1, page: 0 });
  f.room.dispose();
});

test('shared public media auto-next is host-only and stale end callbacks cannot skip another video', () => {
  const f = fixture({ geometry: { interactionMeta: { media: { tv: ['publicOne', 'publicTwo', 'publicTri'] } } } }); f.join('guest');
  assert.equal(f.action('guest', { kind: 'interaction', id: 'media:tv', value: { index: 1 }, automatic: true, expectedIndex: 0 }).ok, false);
  assert.equal(f.action('guest', { kind: 'interaction', id: 'media:tv', value: { index: 1 }, expectedIndex: 0 }).ok, true);
  assert.equal(f.action('local', { kind: 'interaction', id: 'media:tv', value: { index: 2 }, automatic: true, expectedIndex: 0 }).ok, false);
  assert.equal(f.action('local', { kind: 'interaction', id: 'media:tv', value: { index: 2, playing: false }, automatic: true, expectedIndex: 1 }).ok, true);
  assert.deepEqual(f.room.snapshot().interactions['media:tv'], { index: 2, videoId: 'publicTri', playing: false });
  assert.equal(f.action('guest', { kind: 'interaction', id: 'media:unknown', value: { index: 0 } }).ok, false);
  assert.equal(f.action('guest', { kind: 'interaction', id: 'media:tv', value: { index: 0, playing: 'yes' } }).ok, false);
  f.room.dispose();
});

const advance = (f, seconds) => { for (let left = seconds; left > 1e-8; left -= 0.05) f.tick(Math.min(left, 0.05)); };
function visualShot(f, weapon, shotId) {
  const p = f.player(f.host.id), direction = [0, 0, 1];
  return { kind: 'shoot', weapon, shotId, origin: [p.x, p.y + WALK.height / 100 * WALK.eyeRatio, p.z], direction, rays: [{ direction }] };
}

test('host and guest can reload every weapon beyond the original finite supply', () => {
  for (const actor of ['local', 'guest']) for (const [weapon, rule] of Object.entries(WEAPON_RULES)) {
    if (!rule.mag) continue;
    const f = fixture(); const guest = f.join('guest'); const id = actor === 'local' ? f.host.id : guest.id;
    assert.equal(f.action(actor, { kind: 'weapon', weapon }).ok, true);
    const cycles = Math.ceil(rule.reserve / rule.mag) + 2;
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (let bullet = 0; bullet < rule.mag; bullet++) {
        f.room.receive('local', { type: 'ping' }); f.room.receive('guest', { type: 'ping' });
        advance(f, Math.max(1 / rule.rate, rule.cycle || 0) + 0.03);
        const p = f.player(id), direction = [0, 0, 1];
        assert.equal(f.action(actor, { kind: 'shoot', weapon, shotId: `${weapon}-${cycle}-${bullet}`,
          origin: [p.x, p.y + WALK.height / 100 * WALK.eyeRatio, p.z], direction, rays: [{ direction }] }, { worldTrace: [[]] }).ok, true);
      }
      assert.equal(f.player(id).ammo[weapon].mag, 0);
      assert.equal(f.action(actor, { kind: 'reload', weapon }).ok, true);
      f.room.receive('local', { type: 'ping' }); f.room.receive('guest', { type: 'ping' }); advance(f, rule.reload + 0.05);
      assert.equal(f.player(id).ammo[weapon].mag, rule.mag);
      assert.equal(f.player(id).ammo[weapon].reserve, rule.reserve);
    }
    const later = f.join('late-observer'); assert.equal(later.snapshot.players.find(p => p.id === id).ammo[weapon].mag, rule.mag);
    f.room.dispose();
  }
});

test('avatar aiming is finite and clamped, including seated inputs; stale input cannot change it', () => {
  const seat = { id: 'visual-chair', position: [WALK.start.x - 0.8, 0.45, WALK.start.z], yaw: 0, eyeY: 1.17, stand: [WALK.start.x, WALK.start.z] };
  const f = fixture({ geometry: { seats: [seat] } });
  const input = (seq, aiming, extra = {}) => f.action('local', { kind: 'input', seq, dt: 0.05, dx: 0, dz: 0, yaw: 0, pitch: 0, aiming, ...extra });
  const original = f.player(f.host.id);
  assert.equal(original.aiming, 0); assert.equal(original.action, null); assert.equal(original.shotAge, null);
  assert.equal(original.grounded, true); assert.equal(original.verticalSpeed, 0);
  input(1, 12); assert.equal(f.player(f.host.id).aiming, 1);
  input(2, NaN); input(3, Infinity); assert.equal(f.player(f.host.id).aiming, 1);
  input(3, 0); assert.equal(f.player(f.host.id).aiming, 1, 'replayed input cannot reset aim');
  input(4, -4); assert.equal(f.player(f.host.id).aiming, 0);
  assert.equal(f.action('local', { kind: 'sit', id: seat.id }).ok, true);
  const sitting = f.player(f.host.id); assert.equal(sitting.action.kind, 'sit');
  input(5, 0.65, { weapon: 'pistol', dx: 999, jump: true });
  const aimed = f.player(f.host.id);
  assert.equal(aimed.aiming, 0.65); assert.equal(aimed.x, sitting.x); assert.equal(aimed.z, sitting.z);
  assert.equal(aimed.verticalSpeed, 0); assert.equal(aimed.action.kind, 'draw');
  assert.equal(f.action('local', { kind: 'stand' }).ok, true); assert.equal(f.player(f.host.id).action.kind, 'stand');
  f.room.dispose();
});

test('accepted equip and shot drive cues; duplicate equip, rejected shot and forged pose cannot restart them', () => {
  const f = fixture();
  assert.equal(f.action('local', { kind: 'weapon', weapon: 'bolt' }).ok, true);
  const draw = f.player(f.host.id).action; assert.equal(draw.kind, 'draw'); assert.equal(draw.targetId, 'bolt');
  f.tick(0.05); f.action('local', { kind: 'weapon', weapon: 'bolt' }); assert.deepEqual(f.player(f.host.id).action, draw);
  const shot = visualShot(f, 'bolt', 'visual-bolt-1'); assert.equal(f.action('local', shot, { worldTrace: [[]] }).ok, true);
  const fired = f.player(f.host.id); assert.equal(fired.action.kind, 'fire'); assert.equal(fired.action.duration, WEAPON_RULES.bolt.cycle); assert.equal(fired.shotAge, 0);
  const cue = fired.action; assert.equal(f.action('local', shot).ok, false); assert.deepEqual(f.player(f.host.id).action, cue);
  advance(f, 0.7); assert.equal(f.action('local', visualShot(f, 'bolt', 'too-early')).ok, false);
  assert.deepEqual(f.player(f.host.id).action, cue);
  advance(f, 0.1); assert.equal(f.action('local', visualShot(f, 'bolt', 'after-cycle'), { worldTrace: [[]] }).ok, true);
  const current = f.player(f.host.id).action;
  assert.equal(f.action('local', { kind: 'pose', action: { kind: 'reload', at: 999, duration: 999 }, aiming: 1 }).ok, false);
  assert.deepEqual(f.player(f.host.id).action, current);
  f.room.dispose();
});

test('reload progress and late-join state use room time; invalid reloads create no cue', () => {
  const f = fixture({ geometry: { items: [{ id: 'phone', position: [WALK.start.x, 1.2, WALK.start.z] }] } });
  assert.equal(f.action('local', { kind: 'reload', weapon: 'pistol' }).ok, false);
  f.action('local', { kind: 'weapon', weapon: 'pistol' });
  assert.equal(f.action('local', visualShot(f, 'pistol', 'visual-reload'), { worldTrace: [[]] }).ok, true);
  f.action('local', { kind: 'weapon', weapon: 'rifle' });
  const draw = f.player(f.host.id).action;
  assert.equal(f.action('local', { kind: 'reload', weapon: 'pistol' }).ok, false); assert.deepEqual(f.player(f.host.id).action, draw);
  f.action('local', { kind: 'weapon', weapon: 'pistol' });
  assert.equal(f.action('local', { kind: 'reload', weapon: 'pistol' }).ok, true);
  const reloading = f.player(f.host.id); assert.equal(reloading.reloading, true); assert.equal(reloading.reloadProgress, 0);
  assert.equal(reloading.action.kind, 'reload'); assert.equal(reloading.action.duration, WEAPON_RULES.pistol.reload);
  assert.equal(f.action('local', { kind: 'reload', weapon: 'pistol' }).ok, false);
  advance(f, WEAPON_RULES.pistol.reload / 2);
  const mid = f.player(f.host.id); assert(Math.abs(mid.reloadProgress - 0.5) < 0.002);
  const late = f.join('visual-late').snapshot, remote = late.players.find(p => p.id === f.host.id);
  assert.deepEqual(remote.action, mid.action); assert.equal(remote.reloading, true); assert.equal(remote.reloadProgress, mid.reloadProgress);
  const pose = sampleAvatarAction(remote, late.time + 0.05, late.time);
  assert.equal(pose.reloading, true); assert(pose.reloadProgress > mid.reloadProgress);
  assert.equal(pose.action.kind, 'reload'); assert(Math.abs(pose.actionTime - (late.time - remote.action.at + 0.05)) < 1e-6);
  advance(f, WEAPON_RULES.pistol.reload / 2 + 0.05);
  const done = f.player(f.host.id); assert.equal(done.reloading, false); assert.equal(done.reloadProgress, 0); assert.equal(done.ammo.pistol.mag, WEAPON_RULES.pistol.mag);
  const completionTime = f.room.snapshot().time;
  const justBeforeEnd = sampleAvatarAction(done, completionTime - 0.1, completionTime);
  assert.equal(justBeforeEnd.reloading, true, 'a completed next snapshot cannot finish the interpolated reload early');
  assert(justBeforeEnd.reloadProgress > 0.9 && justBeforeEnd.reloadProgress < 1);
  assert.equal(f.action('local', { kind: 'claim', id: 'phone' }).ok, true);
  const pickup = f.player(f.host.id).action;
  assert.equal(f.action('local', { kind: 'reload', weapon: 'pistol' }).ok, false); assert.deepEqual(f.player(f.host.id).action, pickup);
  f.room.dispose();
});

test('pickup, drop, interaction and replayed requests retain only authoritative target cues', () => {
  const f = fixture({ geometry: {
    items: [{ id: 'newspaper', position: [WALK.start.x, 1.2, WALK.start.z] }],
    interactionMeta: { newspaperPages: [3], hoodPosition: [WALK.start.x + 0.8, 1.5, WALK.start.z] },
  } });
  assert.equal(f.action('local', { kind: 'claim', id: 'newspaper' }).ok, true);
  let p = f.player(f.host.id); assert.equal(p.action.kind, 'pickup'); assert.equal(p.action.targetId, 'newspaper'); assert(p.action.target.every(Number.isFinite));
  assert.equal(f.action('local', { kind: 'interaction', id: 'newspaper', value: { issue: 0, page: 1 } }).ok, true);
  p = f.player(f.host.id); assert.equal(p.action.kind, 'page'); assert.equal(p.action.targetId, 'newspaper');
  assert.equal(f.action('local', { kind: 'release', id: 'newspaper' }).ok, true);
  p = f.player(f.host.id); assert.equal(p.held, null); assert.equal(p.action.kind, 'drop'); assert.equal(p.action.targetId, 'newspaper');
  assert.equal(sampleAvatarAction(p, f.room.snapshot().time).interaction.targetId, 'newspaper');
  const request = { type: 'action', action: { kind: 'interaction', id: 'hood', value: { level: 1 }, requestId: 'same-hood-request' } };
  f.room.receive('local', request); const used = f.player(f.host.id).action; assert.equal(used.kind, 'use'); assert.equal(used.targetId, 'hood');
  f.tick(0.05); f.room.receive('local', { ...request, action: { ...request.action, value: { level: 2 } } });
  assert.equal(f.last('local', 'result').error, 'replayed_request'); assert.equal(f.room.snapshot().interactions.hood.level, 1); assert.deepEqual(f.player(f.host.id).action, used);
  f.action('local', { kind: 'interaction', id: 'hood', value: { level: 1 } }); assert.deepEqual(f.player(f.host.id).action, used, 'same accepted state does not replay reach');
  f.room.dispose();
});

test('grounded jump and physical landing are timestamped; airborne/replayed jump cannot restart them', () => {
  const f = fixture(), input = seq => ({ kind: 'input', seq, dt: 0.05, dx: 0, dz: 0, yaw: 0, pitch: 0, jump: true });
  assert.equal(f.action('local', input(1)).ok, true);
  const jumped = f.player(f.host.id); assert.equal(jumped.action.kind, 'jump'); assert.equal(jumped.grounded, false); assert(jumped.verticalSpeed > 0);
  f.tick(0.05); const airborne = f.player(f.host.id);
  f.action('local', input(1)); f.action('local', input(2)); assert.deepEqual(f.player(f.host.id).action, jumped.action); assert.equal(f.player(f.host.id).verticalSpeed, airborne.verticalSpeed);
  const late = f.join('jump-observer').snapshot.players.find(p => p.id === f.host.id); assert.equal(late.action.kind, 'jump'); assert.equal(late.grounded, false);
  advance(f, 1.2); const landed = f.player(f.host.id); assert.equal(landed.action.kind, 'land'); assert.equal(landed.grounded, true); assert.equal(landed.verticalSpeed, 0);
  assert(landed.action.at > jumped.action.at);
  const sampled = sampleAvatarAction(landed, f.room.snapshot().time); assert.equal(sampled.actionTime, landed.action.duration);
  assert.equal(actionDuration('reload', 'bolt'), WEAPON_RULES.bolt.reload); assert.equal(actionDuration('fire', 'bolt'), WEAPON_RULES.bolt.cycle);
  f.room.dispose();
});

test('accepted door and human media changes reach toward stable targets; automatic media has no human cue', () => {
  const x = WALK.start.x + 1.2, z = WALK.start.z + 0.3;
  const door = { id: 'visual-door', open: false, closed: { ax: x, az: z, bx: x + 0.8, bz: z, h: 0.02 }, opened: { ax: x, az: z, bx: x, bz: z + 0.8, h: 0.02 } };
  const f = fixture({ geometry: { doors: { doors: [door] }, interactionMeta: { media: { tv: ['publicOne', 'publicTwo', 'publicTri'] }, hoodPosition: [WALK.start.x + 8, 1.5, WALK.start.z] } } });
  assert.equal(f.action('local', { kind: 'door', id: door.id, open: true }).ok, true);
  let cue = f.player(f.host.id).action; assert.equal(cue.kind, 'use'); assert.equal(cue.targetId, door.id); assert.deepEqual(cue.target, [x, 1.1, z]);
  f.tick(0.05); f.action('local', { kind: 'door', id: door.id, open: true }); assert.deepEqual(f.player(f.host.id).action, cue);
  assert.equal(f.action('local', { kind: 'interaction', id: 'hood', value: { level: 2 } }).ok, false); assert.deepEqual(f.player(f.host.id).action, cue);
  assert.equal(f.action('local', { kind: 'interaction', id: 'media:tv', value: { index: 1 }, expectedIndex: 0 }).ok, true);
  cue = f.player(f.host.id).action; assert.equal(cue.kind, 'use'); assert.equal(cue.targetId, 'tv');
  f.tick(0.05); assert.equal(f.action('local', { kind: 'interaction', id: 'media:tv', value: { index: 2 }, expectedIndex: 1, automatic: true }).ok, true);
  assert.equal(f.room.snapshot().interactions['media:tv'].index, 2); assert.deepEqual(f.player(f.host.id).action, cue, 'autoplay must not animate a person pressing a button');
  f.room.dispose();
});

test('switching weapons cannot transfer a shot flash; sampler ignores future cues and preserves old snapshot defaults', () => {
  const f = fixture();
  f.action('local', { kind: 'weapon', weapon: 'rifle' }); f.action('local', visualShot(f, 'rifle', 'rifle-before-switch'), { worldTrace: [[]] });
  assert.equal(sampleAvatarAction(f.player(f.host.id), f.room.snapshot().time).shooting, true);
  f.action('local', { kind: 'weapon', weapon: 'pistol' }); const switched = f.player(f.host.id);
  assert.equal(switched.shotAge, null); assert.equal(sampleAvatarAction(switched, f.room.snapshot().time).shooting, false);
  const future = sampleAvatarAction({ weapon: 'bolt', action: { kind: 'fire', at: 2, duration: 0.8 }, shotAge: 0.1 }, 1.8, 2.1);
  assert.equal(future.action, null); assert.equal(future.shotAge, null); assert.equal(future.shooting, false);
  const old = sampleAvatarAction({ y: 0, vy: 0, weapon: 'pistol' }, NaN, Infinity);
  assert.equal(old.time, 0); assert.equal(old.aiming, 0); assert.equal(old.grounded, true); assert.equal(old.reloading, false); assert.equal(old.action, null);
  f.room.dispose();
});

test('observer discrete equipment state begins with its cue; late join samples current action immediately', () => {
  const f = fixture({ geometry: { items: [{ id: 'phone', position: [WALK.start.x, 1.2, WALK.start.z] }] } });
  f.action('local', { kind: 'weapon', weapon: 'pistol' });
  const first = f.room.snapshot(), before = first.players.find(p => p.id === f.host.id);
  f.tick(0.05); f.action('local', { kind: 'claim', id: 'phone' });
  const second = f.room.snapshot(), after = second.players.find(p => p.id === f.host.id);
  const early = selectAvatarPresentation(before, after, 0.025, first.time, second.time);
  assert.equal(early.player.held, null); assert.equal(early.player.weapon, 'pistol'); assert.equal(early.snapshotTime, first.time);
  const start = selectAvatarPresentation(before, after, after.action.at, first.time, second.time);
  assert.equal(start.player.held, 'phone'); assert.equal(start.player.weapon, 'none');
  const action = sampleAvatarAction(start.player, after.action.at, start.snapshotTime);
  assert.equal(action.action.kind, 'pickup'); assert.equal(action.actionTime, 0);
  const late = selectAvatarPresentation(after, after, second.time, second.time, second.time);
  assert.equal(late.player.held, 'phone'); assert.equal(sampleAvatarAction(late.player, second.time, late.snapshotTime).action.kind, 'pickup');
  f.room.dispose();
});

test('seated look changes finite head aim only, cannot move/equip/jump or forge an action, and resets on stand', () => {
  const seat = { id: 'look-chair', position: [WALK.start.x - 0.8, 0.45, WALK.start.z], yaw: 0.2, eyeY: 1.17, stand: [WALK.start.x, WALK.start.z] };
  const f = fixture({ geometry: { seats: [seat] } });
  assert.equal(f.action('local', { kind: 'look', yaw: 1, pitch: 0, aiming: 1 }).ok, false);
  assert.equal(f.action('local', { kind: 'sit', id: seat.id }).ok, true);
  const before = f.player(f.host.id);
  assert.equal(f.action('local', { kind: 'look', yaw: 0.8, pitch: 0.3, aiming: 5, dx: 999, dz: 999, jump: true, weapon: 'rifle', action: { kind: 'fire', at: 999 } }).ok, true);
  const looked = f.player(f.host.id);
  assert.equal(looked.lookYaw, 0.8); assert.equal(looked.yaw, before.yaw); assert.equal(looked.pitch, 0.3); assert.equal(looked.aiming, 1);
  assert.deepEqual([looked.x, looked.y, looked.z, looked.verticalSpeed, looked.weapon], [before.x, before.y, before.z, before.verticalSpeed, before.weapon]);
  assert.deepEqual(looked.action, before.action);
  for (const bad of [{ yaw: NaN, pitch: 0, aiming: 0 }, { yaw: 0, pitch: Infinity, aiming: 0 }, { yaw: 0, pitch: 0, aiming: NaN }])
    assert.equal(f.action('local', { kind: 'look', ...bad }).ok, false);
  assert.deepEqual(f.player(f.host.id), looked);
  assert.equal(f.action('local', { kind: 'stand' }).ok, true);
  const stood = f.player(f.host.id);
  assert.equal(stood.yaw, looked.lookYaw, 'standing continues toward the seated viewing direction');
  assert.equal(stood.lookYaw, stood.yaw); assert.equal(stood.pitch, looked.pitch);
  f.action('local', { kind: 'input', seq: 1, dt: 0.05, dx: 0, dz: 0, yaw: 0.4, pitch: 0.1, aiming: 0 });
  const walking = f.player(f.host.id); assert.equal(walking.lookYaw, 0.4); assert.equal(walking.yaw, 0.4);
  f.room.dispose();
});

test('weapon-none emits one holster cue with departing gear for late observers', () => {
  const f = fixture();
  f.action('local', { kind: 'weapon', weapon: 'bolt' }); f.tick(0.05);
  assert.equal(f.action('local', { kind: 'weapon', weapon: 'none' }).ok, true);
  const holstered = f.player(f.host.id); assert.equal(holstered.weapon, 'none'); assert.equal(holstered.shotAge, null);
  assert.deepEqual(holstered.action, { kind: 'holster', at: 0.05, duration: 0.35, targetId: 'bolt' });
  const late = f.join('holster-observer').snapshot, remote = late.players.find(p => p.id === f.host.id);
  assert.equal(remote.weapon, 'none'); assert.equal(remote.action.targetId, 'bolt'); assert.equal(sampleAvatarAction(remote, late.time).action.kind, 'holster');
  f.tick(0.05); f.action('local', { kind: 'weapon', weapon: 'none' }); assert.deepEqual(f.player(f.host.id).action, holstered.action);
  advance(f, 0.4); const done = sampleAvatarAction(f.player(f.host.id), f.room.snapshot().time); assert.equal(done.actionTime, 0.35);
  f.room.dispose();
});
