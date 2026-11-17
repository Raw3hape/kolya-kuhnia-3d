import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { courierPose } from '../../web/js/courier-pose.js';
import { createSocialSimulation, socialLocations } from '../../web/js/social-state.js';
const read = name => JSON.parse(fs.readFileSync(new URL(`../../web/spec/${name}.json`, import.meta.url)));
const plan = read('plan.generated'), original = read('social');
const spec = { ...original, rules: { ...original.rules, firstDelivery: 0.1 } };
const home = socialLocations(plan, spec).delivery;
const player = (id = 'a', x = home[0], z = home[2]) => ({ id, x, z, y: 0, eyeY: 1.68, yaw: 0 });
function fixture({ delivered = true, ...options } = {}) {
  const sim = createSocialSimulation({ spec, plan, isEntryOpen: () => true, ...options });
  const players = [player('a'), player('b', home[0] + 0.65)]; sim.step(0.1, players);
  for (let i = 0; i < 12; i++) sim.step(.1, players);
  if (delivered) { assert(sim.command(players[0], { verb: 'receive' })); for (let i = 0; i < 7; i++) sim.step(.1, players); assert(sim.command(players[0], { verb: 'return' })); }
  return { sim, players, command: (id, verb, extra = {}) => sim.command(players.find(p => p.id === id), { verb, ...extra }) };
}
test('two simultaneous box claims have one owner; disconnect returns it to its last safe surface', () => {
  const f = fixture(); assert(f.command('a', 'take')); assert.equal(f.command('b', 'take'), false);
  f.sim.step(0.1, f.players); assert.equal(f.sim.snapshot().pizza.owner, 'a');
  f.sim.release('a'); assert.deepEqual(f.sim.snapshot().pizza.position, home); assert.equal(f.sim.snapshot().pizza.owner, null);
});
test('ten people share twelve slices without duplication, underflow or action spam', () => {
  const f = fixture(); assert(f.command('a', 'open'));
  const people = Array.from({ length: 10 }, (_, i) => player(`p${i}`));
  for (const p of people) assert(f.sim.command(p, { verb: 'eat' }));
  assert.equal(f.sim.snapshot().pizza.remaining, 2);
  for (const p of people) assert.equal(f.sim.command(p, { verb: 'eat' }), false);
  for (let i = 0; i < 12; i++) f.sim.step(0.1, people);
  assert(f.sim.command(people[0], { verb: 'eat' })); assert(f.sim.command(people[1], { verb: 'eat' }));
  assert.equal(f.sim.command(people[2], { verb: 'eat' }), false); assert.equal(f.sim.snapshot().pizza.remaining, 0);
});
test('placement rejects malformed, blocked and floating points; another player cannot move a held box', () => {
  const f = fixture({ validatePlacement: p => p[1] < 0.02 }); assert(f.command('a', 'take'));
  for (const point of [[NaN, 0, 0], [home[0], 4, home[2]], [home[0], 0.9, home[2]], [400, 0.01, 0]]) assert.equal(f.command('a', 'place', { point }), false);
  assert.equal(f.command('b', 'place', { point: home }), false); assert(f.command('a', 'place', { point: home }));
  const blocked = fixture({ delivered: false, blocked: () => true }); assert.equal(blocked.command('a', 'take'), false);
});
test('late join receives partial pizza and radio exactly; leaving the shower releases occupancy', () => {
  const f = fixture(); assert(f.command('a', 'open')); assert(f.command('b', 'eat'));
  const nearRadio = { ...player('c'), x: spec.radio.position[0], z: spec.radio.position[2] };
  assert(f.sim.command(nearRadio, { verb: 'radio', station: 2, volume: 0.7, playing: true }));
  assert.equal(f.sim.command(nearRadio, { verb: 'radio', station: 99 }), false);
  assert.equal(f.sim.command(nearRadio, { verb: 'radio', volume: NaN }), false);
  assert.equal(f.sim.command(player('far', -50, -50), { verb: 'radio', playing: true }), false);
  const fresh = fixture().sim; fresh.restore(f.sim.snapshot()); assert.deepEqual(fresh.snapshot(), f.sim.snapshot());
  const point = [home[0], 1.05, home[2]];
  assert(f.command('a', 'shower', { point })); assert.equal(f.command('b', 'shower', { point }), false);
  f.sim.release('a'); assert.equal(f.sim.snapshot().shower.owner, null);
});
test('courier carries the only box, requires an open door and serializes handoff claims', () => {
  let open = false; const f = fixture({ delivered: false, isEntryOpen: () => open });
  assert.equal(f.sim.snapshot().courier.phase, 'waiting');
  for (const verb of ['take', 'open', 'receive', 'eat']) assert.equal(f.command('a', verb), false);
  open = true; f.sim.step(.1, f.players); assert.equal(f.sim.snapshot().courier.phase, 'offering');
  assert(f.command('a', 'receive')); assert.equal(f.command('b', 'receive'), false);
  const late = createSocialSimulation({ spec, plan, isEntryOpen: () => open }); late.restore(f.sim.snapshot()); assert.deepEqual(late.snapshot(), f.sim.snapshot()); assert.equal(late.command(f.players[1], { verb: 'receive' }), false);
  assert.equal(f.command('a', 'return'), false); assert.equal(f.command('a', 'open'), false);
  const before = f.sim.snapshot().pizza.position; f.sim.step(.1, f.players);
  assert.notDeepEqual(f.sim.snapshot().pizza.position, before);
  open = false; for (let i = 0; i < 7; i++) f.sim.step(.1, f.players);
  assert.equal(f.sim.snapshot().pizza.owner, 'a'); assert(f.command('a', 'return'));
});
test('the entire pizza box stays outside the entrance as the courier moves and turns', () => {
  const entry = plan.openings.find(o => o.type === 'entry');
  const locations = socialLocations(plan, spec);
  // The lid and side panels extend a few millimetres past the nominal box size.
  const halfBox = spec.pizza.size / 2 + 0.005;
  for (const [phase, duration] of Object.entries({ arriving: spec.courier.arriveSeconds,
    waiting: 0, offering: 0, leaving: spec.courier.leaveSeconds })) {
    for (let frame = 0; frame <= 20; frame++) {
      const { box, yaw } = courierPose(spec, locations, { phase, phaseAt: 0 }, duration * frame / 20);
      const closestEdge = box[2] - halfBox * (Math.abs(Math.sin(yaw)) + Math.abs(Math.cos(yaw)));
      assert(closestEdge > entry.z1, `${phase} frame ${frame} puts the box inside the entrance`);
    }
  }
});
test('disconnect during transfer gives the same pizza back to the courier; after transfer it returns safely', () => {
  const f = fixture({ delivered: false }); const id = f.sim.snapshot().pizza.id;
  assert(f.command('a', 'receive')); f.sim.release('a');
  assert.equal(f.sim.snapshot().pizza.location, 'courier'); assert.equal(f.sim.snapshot().pizza.id, id);
  assert(f.command('b', 'receive')); for (let i = 0; i < 7; i++) f.sim.step(.1, f.players);
  f.sim.release('b'); assert.deepEqual(f.sim.snapshot().pizza.position, home);
});
test('unclaimed deliveries leave with the courier, never leave a floor duplicate, and reserve landing until the door closes', () => {
  let open = true; const f = fixture({ delivered: false, isEntryOpen: () => open });
  for (let i = 0; i < 100; i++) f.sim.step(.1, f.players); assert.equal(f.sim.snapshot().bell, 2);
  for (let i = 0; i < 800; i++) f.sim.step(.1, f.players);
  assert.equal(f.sim.snapshot().courier, null); assert.equal(f.sim.snapshot().pizza, null); assert(f.sim.reservesLanding());
  const snapshot = f.sim.snapshot(), restored = createSocialSimulation({ spec, plan, isEntryOpen: () => open }); restored.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  open = false; f.sim.step(.1, f.players); assert.equal(f.sim.reservesLanding(), false);
  for (let i = 0; i < 2200; i++) f.sim.step(.1, f.players); assert(f.sim.snapshot().courier); assert.equal(f.sim.snapshot().pizza.id, 2);
});
test('accepted delivery stops bells and never brings monsters back into an open doorway', () => {
  let open = true; const f = fixture({ isEntryOpen: () => open });
  for (let i = 0; i < 100; i++) f.sim.step(.1, f.players);
  assert.equal(f.sim.snapshot().courier, null); assert.equal(f.sim.snapshot().bell, 1); assert(f.sim.snapshot().pizza); assert(f.sim.reservesLanding());
  open = false; f.sim.step(.1, f.players); assert.equal(f.sim.reservesLanding(), false);
});
test('pizza follows a moving support and falls to the floor when that support is removed', () => {
  const bounds = [home[0] - .5, 0, home[2] - .5, home[0] + .5, .6, home[2] + .5];
  const f = fixture({ validatePlacement: () => ({ id: 'table', bounds }) });
  assert(f.command('a', 'take')); assert(f.command('a', 'place', { point: [home[0], .608, home[2]] }));
  const moved = bounds.map((n, i) => i === 0 || i === 3 ? n + .7 : n);
  f.sim.reconcileSupport(() => moved); assert.equal(f.sim.snapshot().pizza.position[0], home[0] + .7);
  f.sim.reconcileSupport(() => null); assert.equal(f.sim.snapshot().pizza.position[1], .008); assert.equal(f.sim.snapshot().pizza.support, null);
  assert.equal(f.sim.snapshot().pizza.remaining, spec.rules.slices);
});
test('radio moves with its cabinet and stops when that cabinet is removed; shower stops on walking away', () => {
  const f = fixture(), p = f.players[0];
  f.sim.setRadioPose({ position: [p.x, 1.2, p.z], yaw: 1 }); assert(f.command('a', 'radio', { playing: true }));
  f.sim.setRadioPose(null); assert.equal(f.sim.snapshot().radio.playing, false); assert.equal(f.command('a', 'radio', { playing: true }), false);
  assert(f.command('a', 'shower', { point: [p.x, 1.05, p.z] }));
  f.sim.step(.1, [{ ...p, x: p.x + 3 }]); assert.equal(f.sim.snapshot().shower.owner, null);
});
