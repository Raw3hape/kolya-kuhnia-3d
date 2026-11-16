import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRoomAuthority } from '../web/js/multiplayer/authority.js';
import { NETWORK_RULES as R } from '../web/js/multiplayer/rules.js';
import { WALK } from '../web/js/multiplayer/collision.js';
const read = name => JSON.parse(fs.readFileSync(new URL(`../web/spec/${name}.json`, import.meta.url)));
function fixture() {
  const plan = read('plan.generated'), spec = read('social'), packets = []; let serial = 0, clock = 0;
  // Keep all authored room/wall geometry; bring the delivery and radio to the test spawn.
  const entry = plan.openings.find(o => o.type === 'entry');
  Object.assign(entry, { x0: WALK.start.x - .45, x1: WALK.start.x + .45, z0: WALK.start.z + spec.pizza.deliveryInset, z1: WALK.start.z + .65 });
  spec.rules.firstDelivery = .05; spec.radio.position = [WALK.start.x, 1.2, WALK.start.z];
  const room = createRoomAuthority({ plan, site: read('site'), huntSpec: read('hunt'), partySpec: read('party'), socialSpec: spec, roomId: 'social-test', now: () => clock, send: (link, packet) => packets.push({ link, packet }) });
  const last = (link, type) => packets.findLast(p => p.link === link && p.packet.type === type)?.packet;
  const showerPoint = [WALK.start.x, 1.05, WALK.start.z];
  room.connect('local', { type: 'create', version: R.version, name: 'Host', apartment: {}, socialMeta: { showerPoint } });
  room.connect('guest', { type: 'join', version: R.version, name: 'Guest' });
  const id = link => last(link, 'welcome').id;
  const action = (link, value) => { room.receive(link, { type: 'action', action: { ...value, requestId: 'social-' + ++serial } }); return last(link, 'result'); };
  const step = () => { clock += 50; room.step(.05); }; step();
  return { room, spec, id, action, step, showerPoint, last };
}
test('room serializes pizza claims, keeps carry through geometry updates and releases it on disconnect', () => {
  const f = fixture(); assert(f.action('guest', { kind: 'social', verb: 'take' }).ok);
  assert.equal(f.action('local', { kind: 'social', verb: 'take' }).ok, false);
  f.step(); assert.equal(f.room.snapshot().players.find(p => p.id === f.id('guest')).held, 'pizza');
  f.action('local', { kind: 'geometry', socialMeta: { showerPoint: f.showerPoint } });
  assert.equal(f.room.snapshot().players.find(p => p.id === f.id('guest')).held, 'pizza');
  f.room.disconnect('guest'); assert.equal(f.room.snapshot().social.pizza.owner, null);
  f.room.dispose();
});
test('room rejects floating and wall placements; two actors eat different shared slices and late join agrees', () => {
  const f = fixture(); assert(f.action('local', { kind: 'social', verb: 'take' }).ok);
  assert.equal(f.action('local', { kind: 'social', verb: 'place', point: [WALK.start.x, .9, WALK.start.z] }).ok, false);
  const host = f.room.snapshot().players.find(p => p.id === f.id('local'));
  assert(f.action('local', { kind: 'social', verb: 'place', point: [host.x, .008, host.z] }).ok, JSON.stringify({ host, pizza: f.room.snapshot().social.pizza }));
  assert(f.action('local', { kind: 'social', verb: 'open' }).ok);
  assert(f.action('local', { kind: 'social', verb: 'eat' }).ok); assert(f.action('guest', { kind: 'social', verb: 'eat' }).ok);
  assert.equal(f.action('guest', { kind: 'social', verb: 'eat' }).ok, false);
  assert.equal(f.room.snapshot().social.pizza.remaining, 10);
  f.room.connect('late', { type: 'join', version: R.version, name: 'Late' });
  assert.equal(f.last('late', 'welcome').snapshot.social.pizza.remaining, 10); f.room.dispose();
});
test('radio controls and shower ownership are authoritative and bounded', () => {
  const f = fixture(); assert(f.action('guest', { kind: 'social', verb: 'radio', station: 2, playing: true, volume: .6 }).ok);
  assert.equal(f.room.snapshot().social.radio.station, 2);
  for (const extra of [{ station: -1 }, { volume: Infinity }, { playing: 'yes' }]) assert.equal(f.action('local', { kind: 'social', verb: 'radio', ...extra }).ok, false);
  assert.equal(f.action('guest', { kind: 'social', verb: 'shower', point: [0, 1, 0] }).ok, false);
  assert(f.action('guest', { kind: 'social', verb: 'shower', point: f.showerPoint }).ok);
  assert.equal(f.action('local', { kind: 'social', verb: 'shower', point: f.showerPoint }).ok, false);
  f.room.disconnect('guest'); assert.equal(f.room.snapshot().social.shower.owner, null); f.room.dispose();
});
