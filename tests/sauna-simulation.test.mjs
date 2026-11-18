import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SAUNA_RULES, createSaunaSimulation, moveSaunaPlayer, normalizeSaunaInput, targetSaunaSeat,
} from '../web/js/sauna-simulation.js';
import { isFree } from '../web/js/multiplayer/collision.js';
import { NETWORK_RULES } from '../web/js/multiplayer/rules.js';

const config = JSON.parse(readFileSync(new URL('../web/spec/sauna.json', import.meta.url)));
const make = () => createSaunaSimulation({ config, seed: 219 });
const frame = 1 / 60;
const lookAtSeat = (player, seat) => ({
  yaw: Math.atan2(player.x - seat.x, player.z - seat.z),
  pitch: Math.atan2(seat.y + SAUNA_RULES.seatAimLift - player.eyeY, Math.hypot(player.x - seat.x, player.z - seat.z)),
});

function driver(sim, id) {
  let seq = 0;
  const state = () => sim.snapshot().players.find(player => player.id === id);
  const step = (look = {}) => {
    assert(sim.input(id, { seq: ++seq, ...look }));
    sim.tick(frame);
    return state();
  };
  function walkTo(x, z) {
    for (let i = 0; i < 1800; i++) {
      const p = state(), dx = x - p.x, dz = z - p.z;
      if (Math.hypot(dx, dz) < 0.055) {
        step({ yaw: p.yaw });
        return;
      }
      step({ moveZ: 1, yaw: Math.atan2(-dx, -dz) });
    }
    assert.fail('Could not reach (' + x + ', ' + z + ') from ' + JSON.stringify(state()));
  }
  return { state, step, walkTo };
}

test('all ten guests get distinct towels and safe entry positions', () => {
  const sim = make();
  const maxPlayers = NETWORK_RULES.maxPlayers, { rules, bounds, collision } = sim.layout;
  for (let i = 0; i < maxPlayers; i++) {
    assert(sim.join('guest-' + i, { avatar: i, towelSlot: 3 }), 'room must accommodate ' + i);
  }
  assert(!sim.join('extra'));
  assert(!sim.join('guest-0'));
  const { players } = sim.snapshot();
  assert.equal(new Set(players.map(p => p.towelSlot)).size, maxPlayers);
  assert.deepEqual(players.map(p => p.avatar), Array.from({ length: maxPlayers }, (_, index) => index));
  for (const [i, p] of players.entries()) {
    assert(p.x >= bounds[0] && p.x <= bounds[2] && p.z >= bounds[1] && p.z <= bounds[3]);
    assert(isFree(p, collision, [], rules.radius));
    assert(players.slice(i + 1).every(q => Math.hypot(p.x - q.x, p.z - q.z) >= rules.radius * 2 - 0.002));
  }
  assert(sim.leave('guest-0'));
  assert(sim.join('rejoin', { towelSlot: 3 }));
  assert.equal(sim.snapshot().players.at(-1).towelSlot, 3);
});

test('every authored rest seat can be reached from the foyer and selected from its aisle', () => {
  const { layout } = make();
  const { bounds, collision, rules, pools, seats, spawn } = layout;
  const spacing = 0.29;
  const walkable = (x, z) => x >= bounds[0] && x <= bounds[2] && z >= bounds[1] && z <= bounds[3]
    && !pools.some(({ rect }) => x >= rect[0] && x <= rect[2] && z >= rect[1] && z <= rect[3])
    && isFree({ x, z }, collision, [], rules.radius);
  const queue = [[0, 0]], visited = new Set(['0,0']);
  for (let n = 0; n < queue.length; n++) {
    const [i, j] = queue[n];
    for (const [u, v] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
      const key = `${u},${v}`;
      if (visited.has(key) || !walkable(spawn[0] + u * spacing, spawn[1] + v * spacing)) continue;
      visited.add(key);
      queue.push([u, v]);
    }
  }
  assert(seats.length >= NETWORK_RULES.maxPlayers);
  for (const seat of seats) {
    const [x, z] = seat.stand;
    assert(walkable(x, z), seat.id + ' needs an unoccupied standing point');
    assert(queue.some(([i, j]) => Math.hypot(x - spawn[0] - i * spacing, z - spawn[1] - j * spacing) < spacing * 1.2),
      seat.id + ' needs a walking path from the entrance');
    const p = { x, z, y: 0, eyeY: rules.eyeHeight, pose: 'walk' };
    assert.equal(targetSaunaSeat(layout, { ...p, ...lookAtSeat(p, seat) })?.id, seat.id);
  }
});

test('same-seat race, seated look and departure cleanup are authoritative', () => {
  const sim = make();
  const chair = sim.layout.seats.find(s => s.zone === 'arrival');
  sim.join('a');
  sim.join('b');
  const a = driver(sim, 'a'), b = driver(sim, 'b');
  assert(!sim.sit('a', chair.id, lookAtSeat(a.state(), chair)), 'reach is checked at the real player position');
  a.walkTo(...chair.stand);
  const lookA = lookAtSeat(a.state(), chair);
  assert.equal(targetSaunaSeat(sim.layout, { ...a.state(), ...lookA }).id, chair.id);
  assert(!sim.sit('a', chair.id, { ...lookA, yaw: lookA.yaw + Math.PI }), 'must point toward the seat');
  assert(sim.sit('a', chair.id, lookA));
  assert(sim.sit('a', chair.id, lookA), 'duplicate command is idempotent');
  assert.equal(a.state().seat, chair.id);
  assert.equal(a.state().seatY, chair.y);
  assert(Math.abs(a.state().eyeY - (chair.y + sim.layout.rules.seatedEye)) < 0.002);
  const seated = a.step({ yaw: chair.yaw + 2.8, pitch: -0.3, moveZ: 1, moveX: 1 });
  assert.equal(seated.x, Math.round(chair.x * 1000) / 1000);
  assert.equal(seated.speed, 0);
  assert(Math.abs(seated.yaw - seated.bodyYaw) <= sim.layout.rules.seatTurn + 0.002);
  b.walkTo(...chair.stand);
  assert(!sim.sit('b', chair.id, lookAtSeat(b.state(), chair)));
  assert.equal(sim.snapshot().seats[chair.id], 'a');
  assert(sim.leave('a'));
  assert.equal(sim.snapshot().seats[chair.id], undefined);
  assert(sim.sit('b', chair.id, lookAtSeat(b.state(), chair)));
  assert(sim.stand('b'));
  assert(sim.stand('b'), 'duplicate stand is idempotent');
  assert.equal(b.state().seat, null);
  assert.equal(b.state().y, 0);
  assert(isFree(b.state(), sim.layout.collision, [], sim.layout.rules.radius));
  assert.deepEqual(sim.snapshot().seats, {});
});

test('seat targeting honors intervening walls and ignores forged input coordinates', () => {
  const sim = make();
  assert(sim.join('a'));
  const { layout } = sim;
  const seat = layout.seats.find(s => s.zone === 'arrival');
  const [x, z] = seat.stand;
  const player = { x, z, eyeY: layout.rules.eyeHeight, pose: 'walk' };
  const aim = { ...player, ...lookAtSeat(player, seat) };
  assert.equal(targetSaunaSeat(layout, aim)?.id, seat.id);
  const wallZ = (seat.z + z) / 2;
  const blocked = { ...layout, collision: { boxes: [...layout.collision.boxes,
    { x0: x - 1, x1: x + 1, z0: wallZ - 0.04, z1: wallZ + 0.04 }] } };
  assert.equal(targetSaunaSeat(blocked, aim), null);
  assert(sim.input('a', { seq: 1, x, z, ...lookAtSeat(player, seat) }));
  sim.tick(frame);
  assert(!sim.sit('a', seat.id));
  assert(!sim.input('a', { seq: 1, moveZ: 1 }));
  assert.equal(normalizeSaunaInput({ seq: 2, moveX: Infinity, moveZ: -100 }).moveZ, -1);
  assert.equal(normalizeSaunaInput({ seq: -1 }), null);
});

test('pool stairs enter and exit water, retain swimmers at the basin wall and allow dry deck again', () => {
  const sim = make();
  sim.join('a');
  const walk = driver(sim, 'a');
  const pool = sim.layout.pools.find(pool => pool.depth > sim.layout.rules.swimDepth);
  const [left, north, right, entry] = pool.rect, x = (left + right) / 2;
  walk.walkTo(x, entry - pool.steps * 0.65);
  assert.equal(walk.state().pose, 'wade');
  assert(walk.state().y < 0);
  walk.walkTo(x, entry - pool.steps - 1);
  const wet = walk.state();
  assert.equal(wet.pose, 'swim');
  assert(wet.swimming);
  assert(wet.eyeY > pool.surface);
  assert(Math.abs(wet.y - (pool.surface - pool.depth)) < 0.002);
  for (let i = 0; i < 510; i++) walk.step({ moveX: 1 });
  const edge = walk.state();
  assert(edge.x <= right - sim.layout.rules.radius + 0.002);
  assert(edge.z > north);
  assert(edge.swimming, 'cannot leave across a retaining pool wall');
  walk.walkTo(x, edge.z);
  walk.walkTo(x, entry + 0.75);
  assert.equal(walk.state().y, 0);
  assert.equal(walk.state().pose, 'walk');
  assert(!walk.state().swimming);
});

test('stationary timeout and client prediction use fixed room movement', () => {
  const a = make(), b = make();
  for (const sim of [a, b]) {
    sim.join('a');
    assert(sim.input('a', { seq: 1, moveX: 1, moveZ: 1, yaw: 0.25 }));
  }
  const initial = a.snapshot().players[0];
  const estimate = moveSaunaPlayer(a.layout, initial, { moveX: 1, moveZ: 1, yaw: 0.25 }, frame);
  a.tick(frame);
  const p = a.snapshot().players[0];
  assert(Math.hypot(p.x - estimate.x, p.z - estimate.z) < 0.002);
  for (let i = 1; i < 36; i++) a.tick(frame);
  for (let i = 0; i < 6; i++) b.tick(frame * 6);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(a.snapshot().players[0].speed, 0);
  assert(Math.hypot(...['x', 'z'].map(k => a.snapshot().players[0][k])) < 0.92, 'expired input cannot continue walking');
});
