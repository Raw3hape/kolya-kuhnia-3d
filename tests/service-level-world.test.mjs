import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createServiceLevelWorld,
  SERVICE_LEVEL_CELL_SIZE as CELL,
  SERVICE_LEVEL_REGION_SIZE as REGION,
  SERVICE_LEVEL_WALL_THICKNESS as THICKNESS,
} from '../web/js/service-level-world.js';

const id = ({ x, z }) => x + ',' + z;
const regionAt = (x) => Math.floor(x / REGION);
const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];

test('each seeded region is internally traversable and has reciprocal connections on all four borders', () => {
  const world = createServiceLevelWorld('level:102039');
  for (let rz = -4; rz <= 4; rz += 1) {
    for (let rx = -4; rx <= 4; rx += 1) {
      const pending = [{ x: rx * REGION, z: rz * REGION }];
      const seen = new Set(), borders = new Set();
      while (pending.length) {
        const cell = pending.pop();
        if (seen.has(id(cell))) continue;
        seen.add(id(cell));
        for (const next of world.neighbours(cell.x, cell.z)) {
          assert(world.neighbours(next.x, next.z).some(previous => id(previous) === id(cell)));
          const nextRx = regionAt(next.x), nextRz = regionAt(next.z);
          if (nextRx === rx && nextRz === rz) pending.push(next);
          else borders.add(id({ x: nextRx - rx, z: nextRz - rz }));
        }
      }
      assert.equal(seen.size, REGION ** 2);
      assert.equal(borders.size, 4);
    }
  }
});

test('layout is recreated exactly after streaming distant positive and negative regions', () => {
  const world = createServiceLevelWorld(102039);
  const first = Array.from({ length: 16 }, (_, i) => world.room(i - 8, i - 8));
  const replica = createServiceLevelWorld(102039);
  for (let i = -75; i <= 75; i += 1) world.room(i * REGION, i * REGION);
  assert.deepEqual(first, Array.from({ length: 16 }, (_, i) => world.room(i - 8, i - 8)));
  assert.deepEqual(first, Array.from({ length: 16 }, (_, i) => replica.room(i - 8, i - 8)));
  const otherSeed = createServiceLevelWorld(998660);
  assert.notDeepEqual(first, Array.from({ length: 16 }, (_, i) => otherSeed.room(i - 8, i - 8)));
});

test('spawn corridor is open from the apartment camera through the first passages', () => {
  for (const seed of [0, 102039, 998660, 'level:12']) {
    const world = createServiceLevelWorld(seed);
    assert.equal(world.rayDistance(0, 4, 0, -1, 15), 15);
    assert.deepEqual(world.cellAt(0, -CELL / 2 - 0.01), { x: 0, z: -1 });
    const passed = world.move(0.2, 4, 0, -8);
    assert(Math.hypot(passed.x - 0.2, passed.z + 4) < 1e-6);
  }
});

test('rays and moving players agree on solid walls even when a movement step is large', () => {
  const world = createServiceLevelWorld(102039);
  const cx = -2, cz = -3;
  const center = world.cellCenter(cx, cz);
  const widths = world.room(cx, cz).widths;
  const wall = widths.findIndex(width => width === 0);
  assert(wall >= 0, 'fixture cell should include a closed edge');
  const [dx, dz] = directions[wall];
  const boundary = CELL / 2 - THICKNESS / 2;
  assert(Math.abs(world.rayDistance(center.x, center.z, dx, dz, CELL) - boundary) < 1e-6);
  assert.equal(world.hasLineOfSight(center.x, center.z, center.x + dx * CELL, center.z + dz * CELL), false);
  const radius = 0.27;
  const next = world.move(center.x, center.z, dx * CELL, dz * CELL, radius);
  const attempted = Math.hypot(next.x - center.x, next.z - center.z);
  assert(attempted <= boundary - radius + 1e-6);
  assert(attempted > boundary - radius - 0.4);
});

test('navigation follows doorway centers to destinations from an off-center spawn', () => {
  const start = { x: 0.43, z: -0.19 };
  for (const seed of [0, 102039, 'level:12']) {
    const world = createServiceLevelWorld(seed);
    for (let z = -4; z <= 4; z += 2) {
      for (let x = -4; x <= 4; x += 2) {
        const goal = world.cellCenter(x, z);
        const route = world.path(start.x, start.z, goal.x, goal.z, true);
        assert.deepEqual(route[0], { x: 0, z: 0 });
        let actor = start;
        for (const next of route) actor = world.move(actor.x, actor.z, next.x - actor.x, next.z - actor.z);
        assert(Math.hypot(actor.x - goal.x, actor.z - goal.z) < 1e-6);
      }
    }
  }
});
