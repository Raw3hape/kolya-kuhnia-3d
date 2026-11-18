import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSnowWorld, SNOW_TILE } from '../web/js/snow-world.js';

const source = new URL('../web/js/snow-environment.js', import.meta.url);
const three = new URL('../web/vendor/three-0.169/build/three.module.js', import.meta.url).href;
const worldSource = new URL('./snow-world.js', source).href;
const js = readFileSync(source, 'utf8').replace("'three'", JSON.stringify(three)).replace("'./snow-world.js'", JSON.stringify(worldSource));
const { createSnowEnvironment } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('snow sampling is seed-stable in any order and the portal platform is level', () => {
  const a = createSnowWorld(30615), b = createSnowWorld(30615), other = createSnowWorld(821);
  for (const x of [-7, -1.8, 0, 1.8, 7]) for (const z of [-5, -2.5, 0, 4]) {
    assert.deepEqual(a.sample(x, z), { height: 0, dx: 0, dz: 0, snow: 'groomed' });
  }
  const poses = [[0, -31], [-45, -330], [2, -1200], [260, -4], [0, -250000], [-22, -2000]];
  const first = poses.map(([x,z]) => a.sample(x, z));
  const reverse = [...poses].reverse().map(([x,z]) => b.sample(x, z)).reverse();
  assert.deepEqual(first, reverse);
  assert.notDeepEqual(first, poses.map(([x,z]) => other.sample(x, z)));
  assert(first.every(value => [value.height, value.dx, value.dz].every(Number.isFinite)));
});

test('long descent keeps a clear variable route with packed, icy, and powder snow', () => {
  const world = createSnowWorld(87);
  const types = new Set();
  let min = Infinity, max = -Infinity, previous;
  for (let z = -120; z >= -18000; z -= 32) {
    const line = world.course(z), sample = world.sample(line.x, z);
    if (previous) assert(sample.height < previous + 1.5, 'no wall-like uphill step in the race corridor');
    previous = sample.height;
    min = Math.min(min, line.grade);
    max = Math.max(max, line.grade);
    types.add(sample.snow);
    types.add(world.snow(line.x + line.width * 0.89, z));
    assert.equal(world.obstacle(line.x, z), null);
  }
  assert(max - min > 0.21 && min > 0.08 && max < 0.61);
  assert.deepEqual([...types].sort(), ['groomed','ice','powder']);
  assert(previous < -4000, 'course continues to descend thousands of metres');
});

test('open slopes keep several clear lines downhill and produce cross-slope relief', () => {
  for (const seed of [0, 89, 197, 30615, 81624]) {
    const world = createSnowWorld(seed);
    const lanes = [-0.72, -0.42, 0, 0.42, 0.72];
    let changingRelief = 0, first = world.course(-92), previous;
    for (let z = -92; z >= -5000; z -= 96) {
      const lane = world.course(z);
      assert(lane.width * 2 >= 128);
      const heights = lanes.map(offset => {
        const x = lane.x + offset * lane.width;
        const sample = world.sample(x, z);
        assert(!world.obstacle(x, z));
        assert(Math.hypot(sample.dx, sample.dz) < 0.9);
        return sample.height;
      });
      if (previous) {
        assert(heights.every((height, i) => height < previous[i] - 5));
        const delta = heights.map((height, i) => height - previous[i]);
        changingRelief = Math.max(changingRelief, Math.max(...delta) - Math.min(...delta));
      }
      previous = heights;
    }
    assert(changingRelief > 4, 'left and right lines change grade independently');
    assert(previous[2] < first.y - 1400);
  }
});

test('seeded rollers blend without a height or grade seam at region boundaries', () => {
  const world = createSnowWorld(197);
  for (let distance = 56; distance < 2500; distance += 112) {
    const z = -distance, c = world.course(z);
    for (const fraction of [-0.85, -0.3, 0.3, 0.85]) {
      const x = c.x + fraction * c.width;
      const before = world.sample(x, z - 0.001), after = world.sample(x, z + 0.001);
      assert(Math.abs(before.height - after.height) < 0.003);
      assert(Math.abs(before.dz - after.dz) < 0.003);
    }
  }
});

test('tree intersections and visible decorations share deterministic positions', () => {
  const world = createSnowWorld(9723);
  for (let z = -4; z > -27; --z) {
    const forests = [-2,-1,0,1,2].map(x=>world.decoration(x,z));
    for (const list of forests) for (const tree of list) {
      assert.equal(world.obstacle(tree.x,tree.z), tree);
      assert.equal(tree.y, world.height(tree.x,tree.z));
      assert(Math.abs(tree.x - world.course(tree.z).x) > 20);
    }
  }
});

function tileAt(group, x, z) {
  const tile = group.children.findLast(mesh => mesh.material.map && mesh.position.x === x && mesh.position.z === z);
  assert(tile);
  return tile;
}

function side(mesh, axis, value) {
  const position = mesh.geometry.attributes.position;
  const depth = axis === 'x' ? 'z' : 'x';
  const getAxis = axis === 'x' ? position.getX.bind(position) : position.getZ.bind(position);
  const getDepth = depth === 'x' ? position.getX.bind(position) : position.getZ.bind(position);
  return Array.from({ length: position.count }, (_, i) => i)
    .filter(i => Math.abs(mesh.position[axis] + getAxis(i) - value) < 1e-6)
    .map(i => ({ d: mesh.position[depth] + getDepth(i), h: mesh.position.y + position.getY(i) }))
    .sort((a,b) => a.d - b.d);
}

function match(a,b) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].d, b[i].d);
    assert(Math.abs(a[i].h-b[i].h) < 1e-4);
  }
}

test('all stream stages share exact ground edges and bounded storage', () => {
  const world = createSnowWorld(8719), environment = createSnowEnvironment(world);
  try {
    environment.update(0, 0);
    assert(environment.stats().pending > 0);
    const axis = 'z', edge = -SNOW_TILE;
    const fine = tileAt(environment.group, 0, edge);
    const coarse = tileAt(environment.group, 0, edge - SNOW_TILE);
    match(side(fine, axis, edge), side(coarse, axis, edge));

    for (let i = 0; i <= 60; i++) environment.update(0, 0);
    assert.equal(environment.stats().pending, 0);
    match(side(tileAt(environment.group, 0, edge), axis, edge),
      side(tileAt(environment.group, 0, edge - SNOW_TILE), axis, edge));
    // Far surround grids use the same fine vertices on the shared perimeter.
    const boundary = -4 * SNOW_TILE;
    const rim = tileAt(environment.group, 0, boundary);
    const far = environment.group.children.find(mesh => mesh.material.map &&
      mesh.position.x < -4 * SNOW_TILE && mesh.position.z < boundary);
    assert(far);
    match(side(rim, axis, boundary), side(far, axis, boundary).filter(v => v.d >= 0 && v.d <= SNOW_TILE));
    // The coarsest skyline also meets the denser visible ridge band.
    const farEdge = far.position.z;
    const skyline = environment.group.children.find(mesh => mesh.material.map && mesh.position.z < farEdge);
    assert(skyline);
    const ridgeSide = side(far, axis, farEdge);
    const skySide = side(skyline, axis, farEdge).filter(v => v.d >= ridgeSide[0].d && v.d <= ridgeSide.at(-1).d);
    match(ridgeSide, skySide);

    for (const [x,z] of [[0, -64], [25, -513], [-54, -1910], [19, -99999]]) {
      environment.update(x, z);
      const stats = environment.stats();
      assert.equal(stats.tiles, 81);
      assert(stats.vertices < 85000 && stats.triangles < 90000);
    }
  } finally {
    environment.dispose();
  }
  assert.equal(environment.group.children.length, 0);
});
