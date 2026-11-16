// Behavior probes independent of render/input adapters and private rigid bodies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRCSimulation, controllerPositions } from '../../web/js/rc-state.js';
const read = name => JSON.parse(readFileSync(new URL(`../../web/spec/${name}.json`, import.meta.url)));

test('lost RC input is neutralized; refreshed input accelerates, braking slows and steering changes heading', () => {
  const spec = read('rc'), site = read('site'), sims = [createRCSimulation({ spec, site }), createRCSimulation({ spec, site })];
  const controller = controllerPositions(spec)[0], player = { id: 'independent-driver', x: controller.position[0], z: controller.position[2] };
  const car = sim => sim.snapshot().cars[0]; let seq = 0;
  try {
    for (const sim of sims) {
      assert(sim.command(player, 'take', 'rc-0').ok);
      assert(sim.command(player, 'input', 'rc-0', { throttle: 1, steer: .5, brake: false, seq: 1 }).ok);
    }
    for (let i = 0; i < 72; i++) {
      if (i % 3 === 0) assert(sims[0].command(player, 'input', 'rc-0', { throttle: 1, steer: 0, brake: false, seq: ++seq + 1 }).ok);
      for (const sim of sims) sim.step(1 / 60);
    }
    const driven = car(sims[0]), stale = car(sims[1]);
    assert(Math.abs(driven.speed) > 5, 'refreshed throttle accelerates a physical vehicle');
    assert(Math.abs(stale.speed) < Math.abs(driven.speed) * .75, 'stale throttle stops accelerating');
    assert(Math.abs(stale.steering) < .02, 'stale steering returns to neutral');
    for (let i = 0; i < 60; i++) {
      if (i % 3 === 0) sims[0].command(player, 'input', 'rc-0', { throttle: 0, steer: 0, brake: true, seq: ++seq + 1 });
      sims[0].step(1 / 60);
    }
    assert(Math.abs(car(sims[0]).speed) < Math.abs(driven.speed) * .5, 'brake materially reduces speed');
    assert(sims[0].command(player, 'respawn', 'rc-0').ok, 'manual reset recovers a physically pitched car');
    const beforeTurn = car(sims[0]).quaternion;
    for (let i = 0; i < 120; i++) {
      if (i % 3 === 0) sims[0].command(player, 'input', 'rc-0', { throttle: 1, steer: .8, brake: false, seq: ++seq + 1 });
      sims[0].step(1 / 60);
    }
    const after = car(sims[0]);
    assert(Math.abs(after.quaternion[1] - beforeTurn[1]) > .05, 'physical steering turns the chassis');
    assert(sims[0].arena.safe(after.position[0], after.position[2]), 'vehicle stays inside the authored arena');
    assert(after.position.every(Number.isFinite));
  } finally { for (const sim of sims) sim.dispose(); }
});
