import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSnowSimulation, nearSnowGear, normalizeSnowInput, stepSnowRider } from '../web/js/snow-simulation.js';

const snowSpec = JSON.parse(readFileSync(new URL('../web/spec/snow.json', import.meta.url)));
const frame = 1 / snowSpec.simulation.tickHz;

function practice({ seed = 42, config = snowSpec } = {}) {
  const sim = createSnowSimulation({ seed, config });
  const id = 'rider';
  sim.join(id);
  let seq = 0;
  const rider = () => sim.snapshot().players.find(player => player.id === id);
  function move(count, controls = {}) {
    for (let i = 0; i < count; i++) {
      assert(sim.input(id, { seq: ++seq, ...controls }));
      sim.tick(frame);
    }
    return rider();
  }

  function mount(gear) {
    const point = config.station.options[gear], p = rider();
    const dx = point.x - p.x, dz = point.z - p.z;
    const distance = Math.hypot(dx, dz);
    move(Math.ceil(distance / config.station.walkSpeed / frame), { steer: dx / distance, push: -dz / distance, lookYaw: 0 });
    assert.equal(nearSnowGear(sim.world, rider(), config), gear);
    assert(sim.select(id, gear));
    return rider();
  }

  return { sim, id, rider, move, mount };
}

test('players must approach the selected rack before mounting, and a reset may return them on foot', () => {
  const f = practice();
  assert.equal(nearSnowGear(f.sim.world, f.rider(), snowSpec), null);
  assert.equal(f.sim.select(f.id, 'ski'), false);
  const equipped = f.mount('ski');
  assert.equal(equipped.equipment, 'ski');
  assert.equal(equipped.phase, 'ride');
  assert.equal(f.sim.select(f.id, '__proto__'), false);
  f.move(480, { push: 1 });
  assert(f.rider().distance > 65);
  assert(f.sim.reset(f.id));
  assert.equal(f.rider().equipment, 'ski');
  assert.equal(f.rider().distance, 0);
  assert(f.sim.reset(f.id, { walk: true }));
  assert.equal(f.rider().equipment, null);
  assert.equal(f.rider().phase, 'walk');
  assert.equal(f.rider().z, 0);
});

test('ski and board feel different, tucking increases speed, and braking arrests the glide', () => {
  const standard = practice(), tucked = practice(), board = practice();
  standard.mount('ski'); tucked.mount('ski'); board.mount('board');
  standard.move(740, { push: 1 });
  tucked.move(740, { push: 1, tuck: true });
  board.move(740, { push: 1, tuck: true });
  assert(tucked.rider().speed > standard.rider().speed + 1);
  const start = tucked.rider();
  const turnWithSkis = tucked.move(46, { steer: 0.85 });
  const turnWithBoard = board.move(46, { steer: 0.85 });
  assert(turnWithSkis.x > start.x + 1);
  assert(turnWithSkis.yaw < -0.3);
  assert(turnWithBoard.yaw < turnWithSkis.yaw - 0.1);
  const stopped = tucked.move(144, { brake: 1 });
  assert(stopped.speed < turnWithSkis.speed * 0.5);
  assert(stopped.speed < snowSpec.motion.maxSpeed);
});

test('a jump is edge-triggered, rotates through the air and has a scored landing', () => {
  const f = practice();
  f.mount('board');
  const start = f.move(340, { push: 1, tuck: true });
  assert.equal(start.phase, 'ride');
  const rising = f.move(7, { jump: true, jumpSerial: 1, spin: 0.92 });
  assert.equal(rising.phase, 'air');
  assert(rising.y > f.sim.world.height(rising.x, rising.z) + 0.2);
  assert(rising.spin < 0);
  let accumulated = [rising];
  for (let i = 0; i < 95 && f.rider().phase === 'air'; i++) {
    const spin = f.rider().spin < -5.85 ? 0 : 0.92;
    accumulated.push(f.move(1, { jump: true, jumpSerial: 1, spin }));
  }
  const landed = f.rider(), events = f.sim.snapshot().events;
  assert.equal(landed.phase, 'ride', JSON.stringify(events));
  assert(landed.score >= snowSpec.motion.spinScore, JSON.stringify(events));
  assert(accumulated.some(player => player.airTime > 0.5 && player.spin < -3));
  f.move(25, { jump: true, jumpSerial: 1 });
  assert.equal(f.sim.snapshot().events.filter(event => event.type === 'jump').length, 1,
    'holding jump across landing does not trigger a second takeoff');
});

test('an under-rotated flip crashes, then restores a safe rider on the same run', () => {
  const f = practice();
  f.mount('ski');
  f.move(340, { push: 1 });
  f.move(25, { jumpSerial: 1, flip: 1 });
  assert.equal(f.rider().phase, 'air');
  for (let i = 0; i < 80 && f.rider().phase === 'air'; i++) f.move(1);
  assert.equal(f.rider().phase, 'crashed');
  assert(f.sim.snapshot().events.some(event => event.type === 'crash' && event.reason === 'landing'));
  const before = f.rider().distance;
  f.move(120, { push: 1 });
  assert.equal(f.rider().phase, 'ride');
  assert(f.rider().distance > before);
  assert(f.sim.snapshot().events.some(event => event.type === 'recover'));
});

test('frame partition, stale controls and prediction use the same fixed-step movement', () => {
  const left = practice(), right = practice();
  left.mount('ski'); right.mount('ski');
  const input = { seq: 900, push: 1, steer: 0.6, tuck: true };
  assert(left.sim.input(left.id, input));
  assert(right.sim.input(right.id, input));
  assert(!left.sim.input(left.id, { seq: 899, steer: -1 }));
  const start = left.rider();
  const replayed = stepSnowRider(left.sim.world, start, input, frame * 6, snowSpec);
  left.sim.tick(frame * 2); left.sim.tick(frame * 4);
  right.sim.tick(frame * 6);
  assert.deepEqual(left.sim.snapshot(), right.sim.snapshot());
  for (const key of ['x', 'y', 'z', 'yaw', 'speed']) {
    assert(Math.abs(replayed[key] - left.rider()[key]) < 0.001, key);
  }
  for (let i = 0; i < 105; i++) left.sim.tick(frame);
  const after = left.rider();
  assert(Math.abs(after.lean) < 0.001);
  assert(left.sim.input(left.id, null));
  assert.deepEqual(normalizeSnowInput({ seq: 0, steer: 400, push: -7, brake: true, flip: 18, x: 990000 }), {
    seq: 0, steer: 1, push: -1, brake: 1, tuck: false, jump: false, jumpSerial: 0, spin: 0, flip: 1, lookYaw: null,
  });
});

test('one room admits ten independent riders, streams finite snapshots after kilometres and expires events', () => {
  const f = practice({ seed: 197 });
  for (let i = 1; i < snowSpec.simulation.maxPlayers; i++) assert(f.sim.join('peer' + i));
  assert(!f.sim.join('extra'));
  const roster = f.sim.snapshot().players;
  assert.equal(new Set(roster.map(player => player.x + ':' + player.z)).size, roster.length);
  f.mount('board');
  f.move(5600, { push: 1, tuck: true });
  const { players, events } = f.sim.snapshot();
  assert(f.rider().distance > 1300);
  assert.equal(players.find(player => player.id === 'peer1').distance, 0);
  assert(players.every(player => [player.x, player.y, player.z, player.speed, player.distance].every(Number.isFinite)));
  assert(events.length <= snowSpec.simulation.maxEvents);
  assert(!events.some(event => event.type === 'equip'));
  assert(f.sim.leave('peer1'));
  assert.equal(f.sim.snapshot().players.length, 9);
});
