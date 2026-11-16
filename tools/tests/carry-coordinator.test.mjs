import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarryCoordinator } from '../../web/js/carry-coordinator.js';

test('a future item family participates without adding module-specific release logic', async () => {
  const coordinator = createCarryCoordinator(), state = { phone: false, pizza: true, robot: false }, releases = [];
  for (const id of Object.keys(state)) coordinator.register(id, { held: () => state[id], release() { releases.push(id); state[id] = false; } });
  assert.equal(await coordinator.prepare('robot'), true); state.robot = true;
  assert.deepEqual(releases, ['pizza']); assert.deepEqual(state, { phone: false, pizza: false, robot: true });
  assert.equal(await coordinator.prepare('phone'), true); state.phone = true;
  assert.deepEqual(releases, ['pizza', 'robot']); assert.equal(state.robot, false);
  coordinator.dispose();
});

test('rapid concurrent pickups serialize release and preserve exactly the last acquired family', async () => {
  const coordinator = createCarryCoordinator(), state = { a: false, b: false, c: false }, order = [];
  for (const id of Object.keys(state)) coordinator.register(id, { held: () => state[id], async release() { await Promise.resolve(); order.push('release-' + id); state[id] = false; } });
  const take = async id => { const admitted = await coordinator.prepare(id); if (admitted) { state[id] = true; order.push('take-' + id); } return admitted; };
  assert.deepEqual(await Promise.all([take('a'), take('b'), take('c')]), [true, true, true]);
  assert.deepEqual(state, { a: false, b: false, c: true });
  assert.deepEqual(order, ['take-a', 'release-a', 'take-b', 'release-b', 'take-c']); coordinator.dispose();
});

test('false release acknowledgements cannot bypass retained ownership; retry recovers after a real release', async () => {
  const coordinator = createCarryCoordinator(); let held = true, canRelease = false;
  coordinator.register('old', { held: () => held, release() { if (canRelease) held = false; return { ok: true }; } });
  coordinator.register('new', { held: () => false, release() {} });
  assert.equal(await coordinator.prepare('new'), false); assert.equal(held, true);
  canRelease = true; assert.equal(await coordinator.prepare('new'), true); assert.equal(held, false); coordinator.dispose();
});

test('release failure keeps the queue usable and does not silently release the requesting family', async () => {
  const coordinator = createCarryCoordinator(); let broken = true, held = true, selfReleases = 0;
  coordinator.register('old', { held: () => held, release() { if (broken) throw Error('busy'); held = false; } });
  coordinator.register('new', { held: () => true, release() { selfReleases++; } });
  assert.equal(await coordinator.prepare('new'), false); broken = false;
  assert.equal(await coordinator.prepare('new'), true); assert.equal(selfReleases, 0); coordinator.dispose();
});

test('unregistered, duplicate and disposed families cannot start stale ownership work', async () => {
  const coordinator = createCarryCoordinator(), adapter = { held: () => false, release() {} };
  const unregister = coordinator.register('item', adapter);
  assert.throws(() => coordinator.register('item', adapter), TypeError);
  assert.equal(await coordinator.prepare('unknown'), false);
  const queued = coordinator.prepare('item'); unregister(); assert.equal(await queued, false);
  coordinator.register('item', adapter); coordinator.dispose();
  assert.equal(await coordinator.prepare('item'), false);
});
