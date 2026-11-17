import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartySimulation } from '../../web/js/party-state.js';
import { createSocialSimulation, socialLocations } from '../../web/js/social-state.js';

// Reading the presentation must never change the authoritative snapshot. Check
// after each mutation, rather than only after a whole gameplay sequence.
function observe(sim) {
  const expected = sim.snapshot();
  assert.deepEqual(structuredClone(sim.presentation()), expected);
  assert.deepEqual(sim.snapshot(), expected);
  assert(Object.isFrozen(sim.presentation()));
  return sim.presentation();
}
function mutate(sim, fn) { const result = fn(); observe(sim); return result; }
function advance(sim, seconds, players) {
  for (let left = seconds; left > 1e-8; left -= .05) mutate(sim, () => sim.step(Math.min(.05, left), players));
}
const partySpec = { fridge: { position: [0, 1, 0] }, rules: { sips: 1, sipSeconds: .5, effectSeconds: 2,
  respawnSeconds: 3, persistentDebris: false, maxFlightSeconds: 1 }, items: [
  { id: 'beer', kind: 'beer', position: [0, 1, 0] },
  { id: 'other', kind: 'beer', position: [.1, 1, 0] },
  { id: 'energy', kind: 'energy', variant: 'green', position: [.2, 1, 0] },
  { id: 'vape', kind: 'vape', position: [.3, 1, 0] },
  { id: 'hookah', kind: 'hookah', position: [.4, 0, 0] }
] };
const a = { id: 'a', position: [0, 1.4, 0] }, b = { id: 'b', position: [.1, 1.4, 0] };
const partyItem = (view, id) => view.items.find(item => item.id === id);

test('party presentation caches idle stock without clones and keeps snapshot/result copies mutable and detached', () => {
  const sim = createPartySimulation({ spec: partySpec }), view = observe(sim), stock = view.items, boosts = view.boosts;
  assert(Object.isFrozen(stock)); assert(Object.isFrozen(stock[0].position));
  assert.throws(() => { stock[0].position[0] = 99; }, TypeError);
  const originalClone = globalThis.structuredClone; let clones = 0;
  try {
    globalThis.structuredClone = value => { clones++; return originalClone(value); };
    for (let i = 0; i < 100; i++) { sim.step(.01, [a]); assert.equal(sim.presentation(), view); assert.equal(view.items, stock); assert.equal(view.boosts, boosts); }
    assert.equal(clones, 0, 'ready stock should incur no detached-copy work on idle frames');
  } finally { globalThis.structuredClone = originalClone; }
  observe(sim); assert(view.time > 0);
  const result = mutate(sim, () => sim.command(a, 'take', 'beer'));
  assert(result.ok); result.item.position[0] = 99; result.item.action.kind = 'tampered'; observe(sim);
  assert.equal(partyItem(view, 'beer').position[0], 0);
  assert.equal(partyItem(view, 'other'), stock[1], 'unchanged items retain their detached copies');
  assert.equal(stock[0].status, 'ready', 'old copies never become live simulation structures');
  const saved = sim.snapshot(); saved.items[0].position[0] = 123; assert.equal(partyItem(view, 'beer').position[0], 0);
});

test('party presentation tracks every command, transfer/release, home, boost expiry, break/respawn and reset boundary', () => {
  const sim = createPartySimulation({ spec: partySpec }); observe(sim);
  const command = (actor, verb, id, direction) => mutate(sim, () => sim.command(actor, verb, id, direction));
  assert(command(a, 'fridge').ok); assert(command(a, 'take', 'energy').ok); advance(sim, .7, [a, b]);
  assert(command(a, 'sip', 'energy').ok); assert.equal(sim.presentation().boosts.length, 1);
  assert(!command(a, 'sip', 'energy').ok); advance(sim, .6, [a, b]);
  assert(command(a, 'crush', 'energy').ok); advance(sim, .7, [a, b]);
  assert(mutate(sim, () => sim.transfer('a', 'b', 'energy', [a, b])).ok);
  mutate(sim, () => sim.release('b')); assert.equal(partyItem(sim.presentation(), 'energy').status, 'resting');
  advance(sim, 1, [a, b]); assert.equal(sim.presentation().boosts.length, 0);
  assert(command(a, 'take', 'vape').ok); advance(sim, .7, [a, b]); assert(command(a, 'puff', 'vape').ok);
  assert(mutate(sim, () => sim.setHome('vape', [1, 1, 0]))); assert(command(a, 'return', 'vape').ok);
  assert.deepEqual(partyItem(sim.presentation(), 'vape').position, [1, 1, 0]);
  assert(!mutate(sim, () => sim.setHome('missing', [0, 1, 0])));
  assert(command(a, 'take', 'hookah').ok); advance(sim, .7, [a]); assert(command(a, 'puff', 'hookah').ok);
  mutate(sim, () => sim.step(.05, [{ ...a, position: [10, 1, 0] }])); assert.equal(partyItem(sim.presentation(), 'hookah').owner, null);
  assert(mutate(sim, () => sim.breakItem('beer', [1, .05, 0]))); assert(!mutate(sim, () => sim.breakItem('beer')));
  advance(sim, 3.1, [a]); assert.equal(partyItem(sim.presentation(), 'beer').status, 'ready');
  mutate(sim, () => sim.setCollision(() => null)); mutate(sim, () => sim.reset()); assert.equal(sim.presentation().fridgeOpen, false);
  assert.equal(sim.presentation().items.every(item => item.status === 'ready'), true);
});

test('party flying/restore presentation remains exact while the saved solo flight stays detached', () => {
  const sim = createPartySimulation({ spec: partySpec, collision: () => null });
  mutate(sim, () => sim.command(a, 'take', 'beer'));
  mutate(sim, () => sim.command(a, 'throw', 'beer', [0, 0, -1])); advance(sim, .15, [a]);
  const savedSolo = sim.snapshot(), savedCopy = structuredClone(savedSolo), oldFlight = partyItem(sim.presentation(), 'beer');
  advance(sim, .2, [a]); assert.notDeepEqual(partyItem(sim.presentation(), 'beer').position, oldFlight.position);
  assert.deepEqual(savedSolo, savedCopy); assert(mutate(sim, () => sim.restore(savedSolo)));
  savedSolo.items[0].flight.velocity[0] = 999; assert.notEqual(partyItem(sim.presentation(), 'beer').flight.velocity[0], 999);
  assert(!mutate(sim, () => sim.restore({ time: -1, items: [] })));
  advance(sim, 1.1, [a]); assert.equal(partyItem(sim.presentation(), 'beer').status, 'ready', 'expired unsurfaced flight is recycled');
  mutate(sim, () => sim.setCollision(() => ({ point: [0, .05, 0] })));
  mutate(sim, () => sim.command(a, 'take', 'beer')); mutate(sim, () => sim.command(a, 'throw', 'beer', [0, -1, 0]));
  advance(sim, .05, [a]); assert.equal(partyItem(sim.presentation(), 'beer').status, 'broken');
});

test('party dirty cohort uses one clone while preserving frozen old records and generic restored fields/cycles', () => {
  const spec = { rules: { maxFlightSeconds: 5 }, items: Array.from({ length: 11 }, (_, index) => ({
    id: `beer-${index}`, kind: 'beer', position: [0, 100, 0]
  })) }, sim = createPartySimulation({ spec, collision: () => null }), saved = sim.snapshot();
  for (const item of saved.items.slice(0, 10)) {
    item.status = 'flying'; item.flight = { from: [0, 100, 0], velocity: [1, 1, 0], at: 0 };
    item.extra = { value: item.id, date: new Date(42), set: new Set([item.id]), nested: { values: [1, 2] } };
    item.extra.self = item.extra;
  }
  assert(sim.restore(saved)); const old = observe(sim).items, originalClone = globalThis.structuredClone;
  let clones = 0, next;
  try {
    globalThis.structuredClone = value => { clones++; return originalClone(value); };
    sim.step(1 / 60, []); next = sim.presentation().items;
    assert.equal(clones, 1, 'ten dirty records share one structuredClone invocation');
  } finally { globalThis.structuredClone = originalClone; }
  observe(sim); assert.equal(next[10], old[10]);
  for (let index = 0; index < 10; index++) {
    assert.notEqual(next[index], old[index]); assert.equal(old[index].position[0], 0);
    assert(Object.isFrozen(next[index])); assert(Object.isFrozen(next[index].extra));
    assert(Object.isFrozen(next[index].extra.nested.values)); assert.equal(next[index].extra.self, next[index].extra);
    assert.deepEqual(next[index].extra.date, new Date(42)); assert.deepEqual(next[index].extra.set, new Set([`beer-${index}`]));
    assert.throws(() => { next[index].extra.nested.values[0] = 9; }, TypeError);
  }
  // Non-plain unknown values retain generic detached-clone semantics too.
  next[0].extra.set.add('presentation-only'); assert(!sim.snapshot().items[0].extra.set.has('presentation-only'));
});

const plan = { openings: [{ type: 'entry', id: 'entry', x0: -.4, x1: .4, z0: 0, z1: .2 }] };
const socialSpec = { rules: { reach: 2.2, eatSeconds: .1, slices: 2, firstDelivery: .1, deliveryEvery: 1,
  courierWait: .5, bellEvery: .2, emptySeconds: .2, showerSeconds: .2, showerReach: 1.6 },
  pizza: { size: .38, deliveryInset: .55 },
  courier: { outside: .25, arriveSeconds: .1, handoffSeconds: .15, thanksSeconds: .1, leaveSeconds: .1,
    clearSeconds: .1, sideStep: .8, offerStep: .08, boxOffset: [0, 1.16, -.42] },
  radio: { position: [0, 1, -.55], yaw: 0, volume: .45, stations: [{}, {}] } };
function socialFixture() {
  let open = false;
  const home = socialLocations(plan, socialSpec).delivery, bounds = [-.6, 0, -1.1, .6, .6, .1];
  const people = ['a', 'b'].map((id, i) => ({ id, x: i * .1, z: home[2], eyeY: 1.68, yaw: 0 }));
  const sim = createSocialSimulation({ spec: socialSpec, plan, isEntryOpen: () => open,
    validatePlacement: () => ({ id: 'table', bounds }) });
  const command = (verb, extra = {}, person = people[0]) => mutate(sim, () => sim.command(person, { verb, ...extra }));
  return { sim, home, bounds, people, command, open(value) { open = value; observe(sim); },
    deliver() { advance(sim, .25, people); this.open(true); advance(sim, .05, people); assert(command('receive')); advance(sim, .2, people); assert(command('return')); } };
}

test('social presentation tracks courier, delivery transfer, disconnect, pizza commands, support reconciliation and eating', () => {
  const f = socialFixture(), { sim, command, people } = f; observe(sim);
  advance(sim, .25, people); assert.equal(sim.presentation().courier.phase, 'waiting');
  assert(!command('receive')); f.open(true); advance(sim, .05, people); assert(command('receive'));
  mutate(sim, () => sim.releaseItem('a')); assert.equal(sim.presentation().pizza.location, 'courier');
  assert(command('receive', {}, people[1])); advance(sim, .2, people);
  assert(mutate(sim, () => sim.transfer('b', 'a', 'pizza')).ok); assert(!mutate(sim, () => sim.transfer('b', 'a', 'pizza')).ok);
  advance(sim, .05, [{ ...people[0], x: .2 }, people[1]]); assert(command('return'));
  assert(command('take')); assert(command('place', { point: [0, .608, -.55] }));
  const before = sim.presentation().pizza; assert(Object.isFrozen(before.support.bounds));
  mutate(sim, () => sim.reconcileSupport(() => f.bounds)); assert.equal(sim.presentation().pizza, before);
  const moved = f.bounds.map((n, i) => i === 0 || i === 3 ? n + .2 : n);
  mutate(sim, () => sim.reconcileSupport(() => moved)); assert.equal(sim.presentation().pizza.position[0], .2);
  assert.deepEqual(before.position, [0, .608, -.55]);
  mutate(sim, () => sim.reconcileSupport(() => null)); assert.equal(sim.presentation().pizza.support, null);
  assert(command('open')); assert(command('eat')); assert(!command('eat')); advance(sim, .15, people); assert(command('eat'));
  advance(sim, .3, people); assert.equal(sim.presentation().pizza, null);
  f.open(false); advance(sim, .3, people); assert.equal(sim.presentation().courier, null); assert.equal(sim.presentation().landingReserved, false);
});

test('social presentation tracks radio/shower mutations and restored solo state without changing detached snapshots', () => {
  const f = socialFixture(), { sim, command, people } = f; f.deliver();
  const idlePizza = sim.presentation().pizza;
  assert(command('radio', { playing: true, station: 1, volume: .7 })); assert(!command('radio', { station: 99 }));
  mutate(sim, () => sim.setRadioPose({ position: [0, 1, -.5], yaw: 1 })); assert.equal(sim.presentation().radio.yaw, 1);
  assert.equal(sim.presentation().pizza, idlePizza, 'unrelated entity copies are retained');
  const savedSolo = sim.snapshot(), savedCopy = structuredClone(savedSolo), oldRadio = sim.presentation().radio;
  mutate(sim, () => sim.setRadioPose(null)); assert.equal(sim.presentation().radio.playing, false); assert.equal(oldRadio.playing, true);
  assert(command('shower', { point: [0, 1, -.55] })); advance(sim, .25, people); assert.equal(sim.presentation().shower.owner, null);
  assert(command('shower', { point: [0, 1, -.55] })); mutate(sim, () => sim.release('a')); assert.equal(sim.presentation().shower.owner, null);
  assert(command('shower', { point: [0, 1, -.55] })); assert(command('shower')); assert.equal(sim.presentation().shower.owner, null);
  assert(command('take')); mutate(sim, () => sim.step(.05, [])); assert.equal(sim.presentation().pizza.owner, null);
  assert.deepEqual(savedSolo, savedCopy); mutate(sim, () => sim.restore(savedSolo)); savedSolo.radio.position[0] = 999;
  assert.equal(sim.presentation().radio.position[0], 0); assert.throws(() => { sim.presentation().radio.position[0] = 9; }, TypeError);
  mutate(sim, () => sim.restore(null));
});

test('social idle presentation advances scalar getters without cloning stable entities', () => {
  const sim = createSocialSimulation({ spec: { ...socialSpec, rules: { ...socialSpec.rules, firstDelivery: 100 } }, plan });
  const view = observe(sim), radio = view.radio, shower = view.shower;
  const originalClone = globalThis.structuredClone; let clones = 0;
  try {
    globalThis.structuredClone = value => { clones++; return originalClone(value); };
    for (let i = 0; i < 100; i++) { sim.step(.01); assert.equal(sim.presentation(), view); assert.equal(view.radio, radio); assert.equal(view.shower, shower); assert.equal(view.pizza, null); }
    assert.equal(clones, 0);
  } finally { globalThis.structuredClone = originalClone; }
  observe(sim); assert(view.time > 0);
});

test('social unclaimed departure/rescheduling, door changes and shower walkaway invalidate only changed records', () => {
  const f = socialFixture(), { sim, people, command } = f;
  advance(sim, .85, people); assert.equal(sim.presentation().courier, null); assert.equal(sim.presentation().pizza, null);
  assert.equal(sim.presentation().landingReserved, true);
  advance(sim, .2, people); assert.equal(sim.presentation().landingReserved, false);
  advance(sim, 1, people); assert.equal(sim.presentation().serial, 2);
  f.open(true); advance(sim, .05, people); assert.equal(sim.presentation().courier.phase, 'offering');
  f.open(false); advance(sim, .05, people); assert.equal(sim.presentation().courier.phase, 'waiting');
  assert(command('shower', { point: [0, 1, -.55] }));
  mutate(sim, () => sim.step(.05, [{ ...people[0], x: 10 }])); assert.equal(sim.presentation().shower.owner, null);
});
