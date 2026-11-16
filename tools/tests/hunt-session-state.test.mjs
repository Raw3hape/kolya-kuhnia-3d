import test from 'node:test';
import assert from 'node:assert/strict';
import { captureLocalWildlife, restoreLocalWildlife } from '../../web/js/hunt-session-state.js';

test('leaving authoritative poses restores the actual flock used by local bird steering', () => {
  const flock = { members: [] }, bird = { active: true, f: flock, x: 3, mode: 'perch' };
  const neighbour = { active: true, f: flock, x: 5, mode: 'fly' };
  flock.members.push(bird, neighbour);
  const saved = captureLocalWildlife(flock.members, { time: 4, acc: 0.1 });
  Object.assign(bird, { f: { kind: 'local' }, x: 120, mode: 'fly', id: 'bird:0:1' });
  assert.throws(() => [...bird.f.members], TypeError, 'the reviewed regression was a missing local flock');
  assert.deepEqual(restoreLocalWildlife(saved), { time: 4, acc: 0.1 });
  assert.equal(bird.f, flock);
  assert.deepEqual([...bird.f.members], [bird, neighbour]);
  assert.equal(bird.x, 3);
  assert.equal(bird.mode, 'perch');
  assert.equal(Object.hasOwn(bird, 'id'), false);
});

test('local casualties, inactive pool entries and group identities survive multiple room sessions', () => {
  const group = { members: [] }, adult = { active: true, group, hp: 20, dead: false, phase: 1 }, spare = { active: false };
  group.members.push(adult);
  for (let session = 0; session < 2; session++) {
    const saved = captureLocalWildlife([adult, spare], { time: session * 10 });
    Object.assign(adult, { hp: 0, dead: true, phase: 70, generation: 9 });
    Object.assign(spare, { active: true, f: { kind: 'local' }, id: 'bird:20:1', x: 99 });
    const clock = restoreLocalWildlife(saved);
    assert.equal(clock.time, session * 10);
    assert.equal(adult.group.members[0], adult);
    assert.deepEqual([adult.hp, adult.dead, adult.phase], [20, false, 1]);
    assert.deepEqual(spare, { active: false });
  }
});

test('ending a room before wildlife loads needs no local state restoration', () => {
  assert.equal(restoreLocalWildlife(null), null);
});
