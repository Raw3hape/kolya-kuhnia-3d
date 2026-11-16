import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHuntRegions } from '../../web/js/hunt-regions.js';
import { createHuntSimulation } from '../../web/js/multiplayer/hunt-simulation.js';
import { seededRandom } from '../../web/js/network-objects.js';

const json = file => JSON.parse(fs.readFileSync(new URL(`../../web/spec/${file}.json`, import.meta.url)));
const spec = json('hunt'), site = json('site'), plan = json('plan.generated');
const home = [(plan.balcony.x0 + plan.balcony.x1) / 2, (plan.balcony.z0 + plan.balcony.z1) / 2];

test('foreground herd spawns on reachable real meadow close to balcony and stays there while roaming', () => {
  const expected = Math.round(spec.boars.count * spec.region.balcony.share);
  for (const seed of ['morning', 'evening', 'party']) {
    const regions = buildHuntRegions(site, spec.region, home, seededRandom(seed));
    const near = regions.find(r => r.kind === 'balcony');
    assert.ok(near?.ok, 'foreground habitat must exist on this site');
    const sim = createHuntSimulation({ spec, site, plan, seed });
    const before = sim.snapshot().animals.filter(a => a.kind === 'boar' && a.i < expected);
    assert.equal(before.length, expected);
    for (let step = 0; step < 180; step++) {
      sim.step(0.25);
      for (const a of sim.snapshot().animals.filter(a => a.kind === 'boar' && a.i < expected)) {
        assert.ok(near.inside(a.x, a.z), `${seed}: ${a.id} crossed meadow or house boundary`);
        const d = Math.hypot(a.x - home[0], a.z - home[1]);
        assert.ok(d >= spec.region.balcony.distance[0] - 0.01 && d <= spec.region.balcony.distance[1] + 0.01);
      }
    }
    const after = sim.snapshot().animals.filter(a => a.kind === 'boar' && a.i < expected);
    assert.ok(after.filter((a, i) => Math.hypot(a.x - before[i].x, a.z - before[i].z) > 2).length >= expected * 0.75,
      'the foreground must visibly move instead of remaining an idle herd');
    assert.ok(new Set(after.map(a => Math.floor((a.yaw + Math.PI) / (Math.PI / 2)))).size >= 3,
      'herd must roam in visibly different directions');
  }
});
