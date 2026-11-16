import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { packFilteredSHGrid, createFilteredSHGrid } from '../../web/js/filtered-sh-grid.js';

// Independent CPU references for the retired four-texel shader and WebGL's
// normalized, clamp-to-edge bilinear texture sampling. Coordinates are in cells.
function oldGather(source, width, height, mask, zone, x, y) {
  const gx = x - 0.5, gy = y - 0.5, fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
  const result = new Float64Array(27);
  let weight = 0;
  for (let corner = 0; corner < 4; corner++) {
    const ox = corner & 1, oy = corner >> 1;
    const cx = Math.max(0, Math.min(width - 1, Math.floor(gx) + ox));
    const cy = Math.max(0, Math.min(height - 1, Math.floor(gy) + oy));
    const base = (cy * width + cx) * 40;
    const w = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy);
    if (!((mask >> source[base]) & 1) || w <= 0) continue;
    weight += w;
    for (let coefficient = 0; coefficient < 9; coefficient++) for (let channel = 0; channel < 3; channel++)
      result[coefficient * 3 + channel] += w * source[base + (coefficient + 1) * 4 + channel];
  }
  if (weight > 1e-4) for (let i = 0; i < 27; i++) result[i] /= weight;
  else for (let coefficient = 0; coefficient < 9; coefficient++) for (let channel = 0; channel < 3; channel++)
    result[coefficient * 3 + channel] = source[(height + zone) * width * 40 + (coefficient + 1) * 4 + channel];
  return result;
}

function sampleArray(data, width, height, layer, u, v) {
  const sx = Math.max(0.5, Math.min(width - 0.5, u * width));
  const sy = Math.max(0.5, Math.min(height - 0.5, v * height));
  const left = Math.floor(sx - 0.5), top = Math.floor(sy - 0.5), fx = sx - 0.5 - left, fy = sy - 0.5 - top;
  const read = (x, y, channel) => data[((layer * height + Math.min(y, height - 1)) * width + Math.min(x, width - 1)) * 4 + channel];
  return Array.from({ length: 4 }, (_, c) => {
    const a = read(left, top, c) * (1 - fx) + read(left + 1, top, c) * fx;
    const b = read(left, top + 1, c) * (1 - fx) + read(left + 1, top + 1, c) * fx;
    return a * (1 - fy) + b * fy;
  });
}

function packedGather(source, data, width, height, zone, x, y) {
  const textureHeight = height + 1, v = Math.max(0.5, Math.min(height - 0.5, y)) / textureHeight;
  const first = sampleArray(data, width, textureHeight, zone * 9, x / width, v);
  const result = new Float64Array(27);
  for (let coefficient = 0; coefficient < 9; coefficient++) {
    const value = coefficient === 0 ? first : sampleArray(data, width, textureHeight, zone * 9 + coefficient, x / width, v);
    for (let channel = 0; channel < 3; channel++) result[coefficient * 3 + channel] = first[3] > 1e-4
      ? value[channel] / first[3]
      : data[((zone * 9 + coefficient) * textureHeight + height) * width * 4 + channel];
  }
  return result;
}

function fixture(width, height, accepts, zoneAt) {
  const source = new Float32Array(width * 40 * (height + accepts.length));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const base = (y * width + x) * 40; source[base] = zoneAt(x, y);
    for (let j = 0; j < 9; j++) for (let c = 0; c < 3; c++) source[base + (j + 1) * 4 + c] = Math.sin(x * 3 + y * 7 + j * 5 + c) * 17;
  }
  for (let zone = 0; zone < accepts.length; zone++) for (let j = 0; j < 9; j++) for (let c = 0; c < 3; c++)
    source[(height + zone) * width * 40 + (j + 1) * 4 + c] = 40 + zone * 10 + j + c / 10;
  const data = new Float32Array(width * (height + 1) * accepts.length * 9 * 4);
  packFilteredSHGrid(source, data, width, height, accepts);
  return { source, data };
}

function compare(source, data, width, height, accepts, points) {
  for (let zone = 0; zone < accepts.length; zone++) for (const [x, y] of points) {
    const before = oldGather(source, width, height, accepts[zone], zone, x, y);
    const after = packedGather(source, data, width, height, zone, x, y);
    for (let i = 0; i < 27; i++) assert.ok(Math.abs(before[i] - after[i]) < 1e-7,
      `zone=${zone}, cell=(${x},${y}), coefficient=${i}: ${before[i]} != ${after[i]}`);
  }
}

test('packed room SH matches manual bilinear gather at centers, edges, clamped exterior and openings', () => {
  // Opening zone 3 accepts both adjacent rooms and itself; neither room accepts
  // the other room, outside, or the opening. Zone 4 has no nearby cells.
  const accepts = [1, 2, 4, 2 | 4 | 8, 16], width = 4, height = 3;
  const zones = [1, 1, 3, 2, 1, 0, 3, 2, 0, 0, 3, 2];
  const { source, data } = fixture(width, height, accepts, (x, y) => zones[y * width + x]);
  const points = [[0.5, 0.5], [1.5, 1.5], [3.5, 2.5], [1, 1], [2.8, 1.9], [0, 0], [4, 3], [-100, 1.1], [2, -4], [100, 100]];
  compare(source, data, width, height, accepts, points);
  // Old GPU storage was RGBA16F, and packed accepted coefficients undergo the
  // same conversion. Explicitly compare both after that conversion too.
  const half = value => THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(value));
  compare(source.map(half), data.map(half), width, height, accepts, points);
});

test('rejected room values never bleed through a fractional boundary and tiny weights retain the same fallback', () => {
  const accepts = [1, 2, 4], width = 2, height = 1;
  const { source, data } = fixture(width, height, accepts, x => x === 0 ? 1 : 2);
  compare(source, data, width, height, accepts, [[0.5, 0.5], [1, 0.5], [1.49, 0.5], [1.4998, 0.5], [1.49995, 0.5], [1.5, 0.5], [2, 0.5]]);
  const left = packedGather(source, data, width, height, 1, 1.49, 0.5);
  assert.equal(left[0], source[4], 'normalization removes the rejected bright room instead of darkening the valid room');
});

test('packed atlas matches independent manual interpolation for random mixed rooms, negative SH and all 16 zone bits', () => {
  let seed = 0x213478ab;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let run = 0; run < 8; run++) {
    const width = 1 + Math.floor(random() * 8), height = 1 + Math.floor(random() * 7);
    const accepts = Array.from({ length: 16 }, (_, zone) => (1 << zone) | Math.floor(random() * 65536));
    const { source, data } = fixture(width, height, accepts, () => Math.floor(random() * 16));
    const points = Array.from({ length: 100 }, () => [random() * (width + 4) - 2, random() * (height + 4) - 2]);
    compare(source, data, width, height, accepts, points);
  }
});

test('bake and display grids own separate filterable textures and updates reuse their CPU storage', () => {
  const options = { THREE, width: 3, height: 2, accepts: [1, 2, 4] };
  const display = createFilteredSHGrid(options), bake = createFilteredSHGrid(options);
  const { source } = fixture(3, 2, options.accepts, (x, y) => (x + y) % 3);
  try {
    assert.notEqual(display.texture, bake.texture);
    assert.notEqual(display.texture.image.data, bake.texture.image.data);
    assert.equal(display.texture.isDataArrayTexture, true);
    assert.equal(display.texture.image.depth, 27);
    assert.equal(display.texture.image.height, 3, 'the last row stores the per-zone fallback SH');
    assert.equal(display.texture.image.data.length, 3 * 3 * 27 * 4);
    assert.equal(display.texture.internalFormat, 'RGBA16F');
    assert.equal(display.texture.minFilter, THREE.LinearFilter);
    assert.equal(display.texture.magFilter, THREE.LinearFilter);
    assert.equal(display.texture.wrapS, THREE.ClampToEdgeWrapping);
    assert.equal(display.texture.wrapT, THREE.ClampToEdgeWrapping);
    assert.equal(display.texture.generateMipmaps, false);
    const storage = display.texture.image.data, version = display.texture.version;
    display.update(source);
    assert.equal(display.texture.version, version + 1);
    assert.equal(display.texture.image.data, storage, 'context restoration can re-upload the retained CPU array');
    assert.ok(display.texture.image.data.some(v => v !== 0));
    assert.ok(bake.texture.image.data.every(v => v === 0), 'baking cannot overwrite the shown result');
    const shown = display.texture.image.data.slice();
    source.fill(0); bake.update(source);
    assert.deepEqual(display.texture.image.data, shown);
    display.update(source);
    assert.ok(display.texture.image.data.every((v, i) => i % 4 === 3 || v === 0), 'a reset discards previous SH RGB coefficients');
  } finally { display.texture.dispose(); bake.texture.dispose(); }
});
