import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPartySimulation, createPartyGround } from '../../web/js/party-state.js';
import { createRoomAuthority } from '../../web/js/multiplayer/authority.js';
import { NETWORK_RULES as R } from '../../web/js/multiplayer/rules.js';
import { WALK } from '../../web/js/multiplayer/collision.js';
const spec = { rules: { sips: 5, sipSeconds: 1, puffSeconds: 2, reach: 2, respawnSeconds: 3 }, items: [
  { id: 'beer-0', kind: 'beer', position: [0, 1, 0] }, { id: 'beer-1', kind: 'beer', position: [0.1, 1, 0] },
  { id: 'vape', kind: 'vape', position: [0.2, 1, 0] }, { id: 'hookah', kind: 'hookah', position: [0.3, 0, 0] }] };
const actor = { id: 'a', position: [0, 1.4, 0] }, other = { id: 'b', position: [0, 1.4, 0] };
const step = (sim, seconds, players) => { for (let t = 0; t < seconds - 1e-8; t += 0.05) sim.step(Math.min(0.05, seconds - t), players); };
const item = (sim, id = 'beer-0') => sim.snapshot().items.find(i => i.id === id);

test('five separate accepted sips consume one bottle, cooldown rejects spamming and a sixth sip', () => {
  const sim = createPartySimulation({ spec });
  assert(sim.command(actor, 'take', 'beer-0').ok); step(sim, 0.7);
  for (let i = 1; i <= 5; i++) {
    assert(sim.command(actor, 'sip', 'beer-0').ok); assert.equal(item(sim).sips, i);
    assert(!sim.command(actor, 'sip', 'beer-0').ok); step(sim, 1.1);
  }
  assert.equal(item(sim).sips, 5); assert(!sim.command(actor, 'sip', 'beer-0').ok);
  assert(sim.command(actor, 'throw', 'beer-0', [0, 0, -1]).ok);
  assert.equal(item(sim).owner, null); assert.equal(item(sim).status, 'flying');
});

test('exclusive ownership, reach, release, disconnect and hose distance preserve invariants', () => {
  const sim = createPartySimulation({ spec });
  assert(!sim.command({ id: 'far', position: [5, 1, 0] }, 'take', 'beer-0').ok);
  assert(sim.command(actor, 'take', 'beer-0').ok); assert(!sim.command(other, 'take', 'beer-0').ok);
  assert(!sim.command(other, 'throw', 'beer-0', [0, 0, -1]).ok);
  assert(sim.command(actor, 'take', 'vape').ok); assert.equal(item(sim).status, 'ready'); assert.equal(sim.held('a').id, 'vape');
  sim.release('a'); assert.equal(sim.held('a'), null);
  assert(sim.command(actor, 'take', 'hookah').ok); step(sim, 0.7);
  assert(sim.command(actor, 'puff', 'hookah').ok);
  sim.step(0.05, [{ ...actor, position: [9, 1, 0] }]); assert.equal(sim.held('a'), null);
  assert(!sim.command(actor, 'take', '__proto__').ok);
});

test('swept flight hits a thin obstacle, shatters once and preserves glass for late joiners and the entire room', () => {
  const collision = (from, to) => from[2] > -0.4 && to[2] <= -0.4 ? { point: [0, 1.2, -0.4] } : null;
  const sim = createPartySimulation({ spec, collision });
  sim.command(actor, 'take', 'beer-0'); sim.command(actor, 'throw', 'beer-0', [0, 0, -1]); step(sim, 0.2);
  assert.equal(item(sim).status, 'broken'); assert.equal(item(sim).breakSerial, 1); assert.equal(item(sim).position[2], -0.4);
  const peer = createPartySimulation({ spec }); assert(peer.restore(sim.snapshot())); assert.deepEqual(peer.snapshot(), sim.snapshot());
  assert(!sim.breakItem('beer-0')); step(sim, 120); assert.equal(item(sim).status, 'broken'); assert.equal(item(sim).breakSerial, 1);
  assert(!sim.command(actor, 'take', 'beer-0').ok); const late=createPartySimulation({spec});assert(late.restore(sim.snapshot()));assert.deepEqual(late.snapshot(),sim.snapshot());
  sim.reset();assert.equal(item(sim).status,'ready');assert.equal(item(sim).sips,0);
});

test('concurrent throws share one simulation clock and home changes preserve owned progress', () => {
  const sim = createPartySimulation({ spec });
  sim.command(actor, 'take', 'beer-0'); sim.command(actor, 'throw', 'beer-0', [0, -1, 0]);
  sim.command(other, 'take', 'beer-1'); sim.command(other, 'throw', 'beer-1', [0, 1, 0]);
  step(sim, 0.3); assert(Math.abs(sim.snapshot().time - 0.3) < 1e-8); assert.equal(item(sim).status, 'broken'); assert.equal(item(sim, 'beer-1').status, 'flying');
  assert(sim.setHome('vape', [1, 1, 0])); assert.deepEqual(item(sim, 'vape').position, [1, 1, 0]);
  assert(!sim.restore({ time: 1, items: [{ ...item(sim), position: [NaN, 0, 0] }] }));
});

test('room authority validates item commands, publishes carried gear, accepts one owner and releases on disconnect', () => {
  const read = name => JSON.parse(readFileSync(new URL(`../../web/spec/${name}.json`, import.meta.url)));
  const partySpec = { ...spec, items: spec.items.map(i => ({ ...i, position: [WALK.start.x, 1, WALK.start.z] })) };
  const packets = []; let requestId = 0;
  const room = createRoomAuthority({ roomId: 'party', plan: read('plan.generated'), site: read('site'), huntSpec: read('hunt'), partySpec,
    now: () => 0, send: (link, packet) => packets.push({ link, packet }) });
  const last = (link, type) => packets.findLast(p => p.link === link && p.packet.type === type)?.packet;
  room.connect('local', { type: 'create', version: R.version, apartment: {}, name: 'host', items: [{ id: 'phone', position: [WALK.start.x, 1, WALK.start.z] }] });
  const host = last('local', 'welcome').id;
  room.connect('guest', { type: 'join', version: R.version, name: 'guest' });
  const command = (link, action) => { room.receive(link, { type: 'action', action: { ...action, requestId: String(++requestId) } }); return last(link, 'result').ok; };
  assert(command('local', { kind: 'claim', id: 'phone' }));
  assert(command('local', { kind: 'party', verb: 'take', id: 'beer-0' }));
  let snapshot = room.snapshot(); assert.equal(snapshot.items.phone, null); assert.equal(snapshot.players.find(p => p.id === host).carried, 'beer');
  assert(!command('guest', { kind: 'party', verb: 'take', id: 'beer-0' }));
  assert(!command('guest', { kind: 'party', verb: 'sip', id: 'beer-0' }));
  assert(command('local', { kind: 'claim', id: 'phone' })); assert.equal(room.snapshot().party.items[0].owner, null);
  assert(command('guest', { kind: 'party', verb: 'take', id: 'beer-0' }));
  room.disconnect('guest'); assert.equal(room.snapshot().party.items[0].owner, null);
  assert(command('local', { kind: 'party', verb: 'take', id: 'vape' }));
  assert(command('local', { kind: 'clear' })); assert.equal(room.snapshot().players.find(p => p.id === host).held, null);
  room.dispose();
});


test('balcony throws cross apartment height without an aerial shatter and land on the actual outdoor ground', () => {
  const plan = { rooms: { living: { rects: [{ x0: 0, x1: 6, z0: 0, z1: 4 }] } }, balcony: { x0: 3, x1: 6, z0: -2, z1: 0 }, openings: [] };
  const floorAt = createPartyGround({ plan, site: { floorY: 9.8 } });
  assert.equal(floorAt(4, -1), 0); assert.equal(floorAt(4, -3), -9.8);
  const sim = createPartySimulation({ spec: { ...spec, items: [{ id: 'beer-0', kind: 'beer', position: [4, 0.1, -1.4] }] }, floorAt, collision: () => null });
  const player = { id: 'balcony', position: [4, 1.68, -1.4] };
  assert(sim.command(player, 'take', 'beer-0').ok); assert(sim.command(player, 'throw', 'beer-0', [0, 0, -1]).ok);
  step(sim, 0.9); assert.equal(item(sim).status, 'flying'); assert(item(sim).position[1] < 0, 'passed below apartment y=0 while outside');
  step(sim, 1); assert.equal(item(sim).status, 'broken'); assert(Math.abs(item(sim).position[1] + 9.75) < 1e-8);
  const indoor = createPartySimulation({ spec, floorAt: createPartyGround({ plan, site: { floorY: 9.8 } }) });
  indoor.command(actor, 'take', 'beer-0'); indoor.command(actor, 'throw', 'beer-0', [0, -1, 0]); step(indoor, 0.3);
  assert.equal(item(indoor).status, 'broken'); assert(Math.abs(item(indoor).position[1] - 0.05) < 1e-8);
});

test('a collision adapter with no known ground never invents an aerial bottle impact', () => {
  const sim = createPartySimulation({ spec, collision: () => null });
  sim.command(actor, 'take', 'beer-0'); sim.command(actor, 'throw', 'beer-0', [0, 0, -1]); step(sim, 1.5);
  assert.equal(item(sim).status, 'flying'); assert(item(sim).position[1] < 0);
  step(sim, 4); assert.equal(item(sim).status, 'ready'); assert.equal(item(sim).breakSerial, 0);
});
