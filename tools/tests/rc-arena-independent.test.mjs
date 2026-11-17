import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRCArena } from '../../web/js/rc-state.js';
import { PLAYABLE_FIELD } from '../../web/js/playable-field.generated.js';
const base = new URL('../../', import.meta.url), siteBytes = readFileSync(new URL('web/spec/site.json', base));
const site = JSON.parse(siteBytes), spec = JSON.parse(readFileSync(new URL('web/spec/rc.json', base)));

test('the full visible front field stays traversable beyond the obsolete invisible 150m cap', () => {
  const arena = createRCArena(spec, site);
  for (const [x, z] of [[0, -200], [-50, -160], [35, -170], [50, -210], [0, -150], [0, -29], [0, -56], [-50, -56], [50, -29]])
    assert(arena.safe(x, z), `authored open field ${x},${z} must not have an invisible radial/OSM boundary`);
  // The straight field centreline crosses the former radius boundary without
  // assuming the production polygon implementation or its source vertices.
  for (let z = -44; z >= -215; z -= 1) assert(arena.safe(0, z), `centreline unexpectedly blocked at ${z}`);
  // These previously blocked survey gaps are open grass, not building polygons.
  for (const point of [[-20, -20], [-15, -18], [-40, -15]]) assert(arena.safe(...point), `visible grass survey gap ${point} must not create an inner fence`);
});

test('published perimeter comes from the current site and keeps real obstacles instead of hidden inner seams', () => {
  assert.equal(PLAYABLE_FIELD.sourceSiteSha256, createHash('sha256').update(siteBytes).digest('hex'));
  assert.equal(PLAYABLE_FIELD.polygons.length, 1, 'one connected front-field perimeter is published');
  const field = PLAYABLE_FIELD.polygons[0]; assert(field.outer.length >= 8); assert(field.outer.every(p => p.length === 2 && p.every(Number.isFinite)));
  const arena = createRCArena(spec, site);
  for (const point of [[0, 0], [-20, 20], [500, -50]])
    assert.equal(arena.safe(...point), false, `solid/outside point ${point} is not part of the driving field`);
});
