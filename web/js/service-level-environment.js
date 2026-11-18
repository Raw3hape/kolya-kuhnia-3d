// Original office surfaces and light fields. Each live region is a small set of mesh batches.
import * as THREE from 'three';
import {
  SERVICE_LEVEL_CELL_SIZE as CELL,
  SERVICE_LEVEL_HEIGHT as HEIGHT,
  SERVICE_LEVEL_REGION_SIZE as REGION,
  serviceLevelHash,
} from './service-level-world.js';

const VISIBLE_RADIUS = 2;
const REGION_METRES = CELL * REGION;
const FLOOR_GRID = 4;
const CEILING_TILE = 0.6;
const SKIRT_HEIGHT = 0.066;
const SIGN_NAMES = [
  'SEKTOR −1', 'ARCHIWUM', 'OBIEG DOKUMENTÓW', 'KONDYGNACJA −1',
  'MAGAZYN', 'DZIAŁ ZWROTÓW', 'TYLKO DLA PERSONELU', 'PRZEJŚCIE',
];
const GRAY = [1, 1, 1];
const WALL_SCALE = 1.65;
const TEXTURE_SIZE = 256;

function surfaceTexture(surface) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const seed = { wall: 261, carpet: 77, ceiling: 491 }[surface];
  function hash(x, y, channel) {
    return serviceLevelHash(seed, x, y, channel) / 0x100000000;
  }
  function noise(x, y, lattice) {
    const scale = lattice / TEXTURE_SIZE;
    const i = Math.floor(x * scale), j = Math.floor(y * scale);
    const u = x * scale - i, v = y * scale - j;
    const a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
    const i1 = (i + 1) % lattice, j1 = (j + 1) % lattice;
    const lo = hash(i, j, lattice) * (1 - a) + hash(i1, j, lattice) * a;
    const hi = hash(i, j1, lattice) * (1 - a) + hash(i1, j1, lattice) * a;
    return lo * (1 - b) + hi * b;
  }

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const speck = hash(x, y, 5) - 0.5;
      const soft = noise(x, y, 5) - 0.5;
      const mottle = noise(x, y, 31) - 0.5;
      const offset = (y * TEXTURE_SIZE + x) * 4;
      let r, g, b;
      if (surface === 'wall') {
        const repeat = x % 32;
        const stripe = Math.cos((repeat - 14) * Math.PI / 16);
        const weave = Math.sin(x * Math.PI / 2) * 1.6 + Math.cos(y * Math.PI / 2) * 0.9;
        const stem = 17 + Math.sin(y * Math.PI / 16) * 2.7;
        const motif = Math.abs(repeat - stem) < 0.7 || (
          Math.abs(repeat - stem - Math.sin(y * Math.PI / 8) * 2.6) < 0.8 && y % 32 < 10);
        const tone = 5.6 * stripe + 11 * soft + 8 * mottle + 8 * speck + weave - (motif ? 5 : 0);
        r = 174 + tone;
        g = 153 + tone;
        b = 104 + tone * 0.85;
      } else if (surface === 'carpet') {
        const knots = (x + (y >> 1)) % 3 === 0 ? (hash(x, y >> 1, 4) - 0.5) * 10 : 0;
        const tone = 22 * soft + 20 * mottle + 25 * speck + knots;
        r = 124 + tone;
        g = 106 + tone * 0.86;
        b = 86 + tone * 0.69;
      } else {
        const edge = Math.min(x, y, TEXTURE_SIZE - 1 - x, TEXTURE_SIZE - 1 - y);
        const pore = speck < -0.39 ? (speck + 0.39) * 190 : 0;
        const tone = 13 * soft + 10 * mottle + 16 * speck + pore;
        r = edge < 3 ? 151 + tone * 0.26 : 191 + tone;
        g = edge < 3 ? 146 + tone * 0.26 : 185 + tone;
        b = edge < 3 ? 132 + tone * 0.26 : 171 + tone;
      }
      data.data[offset] = r;
      data.data[offset + 1] = g;
      data.data[offset + 2] = b;
      data.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function officeSigns() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  for (const [index, name] of SIGN_NAMES.entries()) {
    const x = (index % 2) * 256;
    const y = Math.floor(index / 2) * 128;
    const entrance = index === 0;
    ctx.fillStyle = entrance ? '#3c3726' : '#52463b';
    ctx.fillRect(x, y, 256, 128);
    ctx.fillStyle = entrance ? '#d4ab4e' : '#beb19a';
    ctx.fillRect(x + 6, y + 6, 244, 116);
    ctx.fillStyle = entrance ? '#3b3321' : '#544333';
    ctx.fillRect(x + 12, y + 16, 232, 18);
    ctx.fillStyle = entrance ? '#eedba0' : '#dfcfaf';
    ctx.font = '800 10px Arial, sans-serif';
    ctx.fillText('ADM. AA−0304          BUDYNEK B', x + 23, y + 29);
    ctx.fillStyle = entrance ? '#342818' : '#403323';
    ctx.font = '800 32px Arial, sans-serif';
    ctx.fillText(name, x + 22, y + 76, 209);
    ctx.font = '700 13px monospace';
    ctx.fillText(entrance ? '→  DROGA TECHNICZNA' : 'B / ' + String(index).padStart(2, '0'), x + 22, y + 104);
    ctx.beginPath();
    for (const hole of [14, 242]) ctx.rect(x + hole - 1, y + 113, 2, 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

class QuadBatch {
  constructor(originX, originZ, material) {
    this.originX = originX;
    this.originZ = originZ;
    this.material = material;
    this.positions = [];
    this.colors = [];
    this.uvs = [];
    this.indices = [];
  }

  push(vertices, shades, uv = [0, 0, 1, 1], flipped = false) {
    const first = this.positions.length / 3;
    const [u0, v0, u1, v1] = uv;
    this.uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);
    for (let i = 0; i < 4; i += 1) {
      const [x, y, z] = vertices[i];
      this.positions.push(x - this.originX, y, z - this.originZ);
      this.colors.push(...(shades?.[i] ?? GRAY));
    }
    if (flipped) this.indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
    else this.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  horizontal(x0, z0, x1, z1, y, shades, uv, flipped) {
    this.push([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], shades, uv, flipped);
  }

  xFace(x, z0, z1, y0, y1, shades, uv, flipped) {
    this.push([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], shades, uv, flipped);
  }

  zFace(z, x0, x1, y0, y1, shades, uv, flipped) {
    this.push([[x0, y0, z], [x0, y1, z], [x1, y1, z], [x1, y0, z]], shades, uv, flipped);
  }

  assemble() {
    if (!this.indices.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(this.originX, 0, this.originZ);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }
}

function fixture(seed, cx, cz) {
  const variation = serviceLevelHash(seed, cx, cz, 16);
  const alongX = (variation & 1) === 1;
  const mid = (shift) => (((variation >>> shift) % 3) - 1) * CEILING_TILE;
  const x = cx * CELL + mid(4) + (alongX ? 0 : CEILING_TILE / 2);
  const z = cz * CELL + mid(7) + (alongX ? CEILING_TILE / 2 : 0);
  const type = (variation >>> 12) % 20;
  const power = cx === 0 && Math.abs(cz) <= 2 ? 1 : type === 0 ? 0 : type === 1 ? 0.36 : 0.87 + (type % 5) * 0.03;
  return { x, z, alongX, power, grille: (variation >>> 21) % 6 === 0 };
}

function litSurfaces(seed) {
  const lamps = new Map();
  function lightAt(cx, cz) {
    const key = cx + ',' + cz;
    let lamp = lamps.get(key);
    if (!lamp) {
      lamp = fixture(seed, cx, cz);
      lamps.set(key, lamp);
    }
    return lamp;
  }
  function shade(x, y, z, material, wallFactor = 1) {
    const cx = Math.floor(x / CELL + 0.5), cz = Math.floor(z / CELL + 0.5);
    let energy = 0.28;
    for (let zz = cz - 1; zz <= cz + 1; zz += 1) {
      for (let xx = cx - 1; xx <= cx + 1; xx += 1) {
        const lamp = lightAt(xx, zz);
        const dx = x - lamp.x, dz = z - lamp.z;
        const height = HEIGHT - y;
        energy += lamp.power * 0.53 / (1 + (dx * dx + dz * dz) * 0.37 + height * height * 0.21);
      }
    }
    if (material === 'wall') {
      const bottomAO = 0.67 + 0.33 * Math.min(y / 0.53, 1);
      const topAO = 0.78 + 0.22 * Math.min((HEIGHT - y) / 0.42, 1);
      energy *= bottomAO * topAO;
    } else if (material === 'carpet') {
      energy *= wallFactor;
    }
    energy = Math.min(1.26, energy);
    return [energy * 1.025, energy, energy * 0.92];
  }
  return { lightAt, shade };
}

function floorAndCeiling(batches, world, cx, cz, lights) {
  const minX = (cx - 0.5) * CELL, minZ = (cz - 0.5) * CELL;
  const { widths, offsets } = world.room(cx, cz);
  const increment = CELL / FLOOR_GRID;
  function floorShade(x, z) {
    const occlusion = (distance, fromCenter, side) =>
      distance < 0.1 && (widths[side] <= 0 || Math.abs(fromCenter - CELL / 2 - offsets[side]) > widths[side] / 2 + 0.02) ? 0.77 : 1;
    const u = x - minX, v = z - minZ;
    const factor = occlusion(CELL - u, v, 0) * occlusion(CELL - v, u, 1)
      * occlusion(u, v, 2) * occlusion(v, u, 3);
    return lights.shade(x, 0, z, 'carpet', factor);
  }
  for (let j = 0; j < FLOOR_GRID; j += 1) {
    for (let i = 0; i < FLOOR_GRID; i += 1) {
      const x0 = minX + i * increment, z0 = minZ + j * increment;
      const x1 = x0 + increment, z1 = z0 + increment;
      const samples = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
      const u = i / FLOOR_GRID, v = j / FLOOR_GRID, next = 1 / FLOOR_GRID;
      batches.carpet.horizontal(x0, z0, x1, z1, 0, samples.map(([x, z]) => floorShade(x, z)),
        [4 * u, 4 * v, 4 * (u + next), 4 * (v + next)]);
      batches.ceiling.horizontal(x0, z0, x1, z1, HEIGHT,
        samples.map(([x, z]) => lights.shade(x, HEIGHT, z, 'ceiling')),
        [(x0 - minX) / CEILING_TILE, (z0 - minZ) / CEILING_TILE,
          (x1 - minX) / CEILING_TILE, (z1 - minZ) / CEILING_TILE], true);
    }
  }
}

function wallPanel(batches, rect, cx, cz, axis, lights) {
  const isX = axis === 0;
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = rect;
  const face = (batch, alongX, positive, fixed, low, high, y0, y1, skirting = false) => {
    const samples = [[low, y0], [low, y1], [high, y1], [high, y0]];
    const shades = samples.map(([a, y]) => {
      const light = alongX ? lights.shade(a, y, fixed, 'wall') : lights.shade(fixed, y, a, 'wall');
      return skirting ? light.map((power, i) => power * [0.54, 0.49, 0.37][i]) : light;
    });
    const lowU = (low - (alongX ? cx : cz) * CELL) / WALL_SCALE;
    const highU = (high - (alongX ? cx : cz) * CELL) / WALL_SCALE;
    const uv = [lowU, y0 / WALL_SCALE, highU, y1 / WALL_SCALE];
    if (alongX) batch.zFace(fixed, low, high, y0, y1, shades, uv, positive);
    else batch.xFace(fixed, low, high, y0, y1, shades, uv, !positive);
  };
  function longSide(fixed, low, high, positive) {
    const count = Math.max(1, Math.ceil((high - low) / 1.4));
    for (let segment = 0; segment < count; segment += 1) {
      const from = low + (high - low) * segment / count;
      const to = low + (high - low) * (segment + 1) / count;
      const heights = [SKIRT_HEIGHT, 0.48, 1.34, 2.12, HEIGHT];
      face(batches.metal, !isX, positive, fixed, from, to, 0, SKIRT_HEIGHT, true);
      for (let row = 1; row < heights.length; row += 1) {
        face(batches.wall, !isX, positive, fixed, from, to, heights[row - 1], heights[row]);
      }
    }
  }
  if (isX) {
    longSide(x0, z0, z1, false);
    longSide(x1, z0, z1, true);
    face(batches.wall, true, false, z0, x0, x1, 0, HEIGHT);
    face(batches.wall, true, true, z1, x0, x1, 0, HEIGHT);
  } else {
    longSide(z0, x0, x1, false);
    longSide(z1, x0, x1, true);
    face(batches.wall, false, false, x0, z0, z1, 0, HEIGHT);
    face(batches.wall, false, true, x1, z0, z1, 0, HEIGHT);
  }
}

function lightFixture(batch, lamp) {
  const { x, z, alongX, power } = lamp;
  function panel(width, depth, y, color, offset = 0) {
    const xx = x + (alongX ? 0 : offset), zz = z + (alongX ? offset : 0);
    const sx = (alongX ? width : depth) / 2, sz = (alongX ? depth : width) / 2;
    batch.horizontal(xx - sx, zz - sz, xx + sx, zz + sz, y, Array(4).fill(color), undefined, true);
  }
  panel(1.22, 0.62, HEIGHT - 0.004, [0.20, 0.19, 0.145]);
  panel(1.18, 0.58, HEIGHT - 0.009, [0.46, 0.43, 0.35]);
  panel(1.09, 0.49, HEIGHT - 0.013, power > 0.6 ? [0.8, 0.76, 0.61] : [0.26, 0.25, 0.20]);
  for (const offset of [-0.13, 0, 0.13]) {
    const intensity = 0.34 + power * 0.79 * (lamp.power < 0.6 && offset !== 0 ? 0 : 1);
    panel(1.02, 0.104, HEIGHT - 0.016, [intensity, intensity * 0.98, intensity * 0.85], offset);
  }
  if (lamp.grille) {
    const gx = x + (alongX ? 1.20 : 0.90), gz = z + (alongX ? 0.90 : 1.20);
    batch.horizontal(gx - 0.28, gz - 0.28, gx + 0.28, gz + 0.28, HEIGHT - 0.006,
      Array(4).fill([0.31, 0.28, 0.22]), undefined, true);
    for (let slat = -4; slat <= 4; slat += 1) {
      batch.horizontal(gx - 0.226, gz + slat * 0.052 - 0.012, gx + 0.226,
        gz + slat * 0.052 + 0.012, HEIGHT - 0.01, Array(4).fill([0.078, 0.074, 0.063]), undefined, true);
    }
  }
}

function signOnWall(batch, rect, axis, positive, cx, cz, sign, lights) {
  const isX = axis === 0;
  const anchor = isX ? (rect.minZ + rect.maxZ) / 2 : (rect.minX + rect.maxX) / 2;
  if ((isX ? rect.maxZ - rect.minZ : rect.maxX - rect.minX) < 0.62) return;
  const u0 = (sign % 2) / 2 + 0.002, v1 = 1 - Math.floor(sign / 2) / 4 - 0.002;
  const uv = [u0, v1 - 0.246, u0 + 0.496, v1];
  const halfWidth = sign === 0 ? 0.295 : 0.231;
  const centerY = sign === 0 ? 1.68 : 1.57;
  const y0 = centerY - halfWidth / 2, y1 = centerY + halfWidth / 2;
  const shades = Array(4).fill(lights.shade(cx * CELL, centerY, cz * CELL, 'wall'));
  if (isX) {
    const x = positive ? rect.maxX + 0.003 : rect.minX - 0.003;
    const signU = positive ? -1 : 1;
    batch.xFace(x, anchor - halfWidth * signU, anchor + halfWidth * signU, y0, y1, shades, uv, true);
  } else {
    const z = positive ? rect.maxZ + 0.003 : rect.minZ - 0.003;
    const signU = positive ? 1 : -1;
    batch.zFace(z, anchor - halfWidth * signU, anchor + halfWidth * signU, y0, y1, shades, uv, true);
  }
}

function buildRegionBatches(world, rx, rz, materials) {
  const originX = rx * REGION_METRES, originZ = rz * REGION_METRES;
  const batches = Object.fromEntries(Object.entries(materials)
    .map(([type, material]) => [type, new QuadBatch(originX, originZ, material)]));
  const lights = litSurfaces(world.seed);
  for (let z = rz * REGION; z < (rz + 1) * REGION; z += 1) {
    for (let x = rx * REGION; x < (rx + 1) * REGION; x += 1) {
      floorAndCeiling(batches, world, x, z, lights);
      const room = world.room(x, z);
      for (let side = 0; side < 2; side += 1) {
        for (const wall of room.wallSegments[side]) wallPanel(batches, wall, x, z, side, lights);
      }
      lightFixture(batches.metal, lights.lightAt(x, z));
      const hash = serviceLevelHash(world.seed, x, z, 23);
      if (x === 0 && z === -1) {
        const marker = room.wallSegments[1].at(-1);
        if (marker) signOnWall(batches.sign, marker, 1, true, x, z, 0, lights);
      } else if (hash % 8 === 1) {
        const side = (hash >>> 3) % 2;
        const wall = room.wallSegments[side][0];
        if (wall) {
          const sign = 1 + ((hash >>> 5) % (SIGN_NAMES.length - 1));
          signOnWall(batches.sign, wall, side, (hash >>> 11) % 2 === 0, x, z, sign, lights);
        }
      }
    }
  }
  const region = new THREE.Group();
  for (const batch of Object.values(batches)) {
    const mesh = batch.assemble();
    if (mesh) region.add(mesh);
  }
  return region;
}

export function createServiceLevelEnvironment(world) {
  const group = new THREE.Group();
  group.name = 'Service level region stream';
  const textures = {
    wall: surfaceTexture('wall'),
    carpet: surfaceTexture('carpet'),
    ceiling: surfaceTexture('ceiling'),
    sign: officeSigns(),
  };
  const materials = Object.fromEntries(['wall', 'carpet', 'ceiling', 'metal', 'sign'].map(type => [
    type, new THREE.MeshBasicMaterial({ map: textures[type] ?? null, vertexColors: true }),
  ]));
  const regions = new Map();
  let activeX = NaN, activeZ = NaN, pending = [];
  function remove(region) {
    group.remove(region);
    for (const mesh of region.children) mesh.geometry.dispose();
  }
  function update(x, z) {
    const cell = world.cellAt(x, z);
    const rx = Math.floor(cell.x / REGION), rz = Math.floor(cell.z / REGION);
    let changed = false;
    if (rx !== activeX || rz !== activeZ) {
      activeX = rx;
      activeZ = rz;
      for (const [key, entry] of regions) {
        if (Math.max(Math.abs(entry.x - rx), Math.abs(entry.z - rz)) <= VISIBLE_RADIUS) continue;
        regions.delete(key);
        remove(entry.region);
        changed = true;
      }
      pending = [];
      for (let dz = -VISIBLE_RADIUS; dz <= VISIBLE_RADIUS; dz += 1) {
        for (let dx = -VISIBLE_RADIUS; dx <= VISIBLE_RADIUS; dx += 1) {
          const next = { x: rx + dx, z: rz + dz };
          const xMin = (next.x * REGION - 0.5) * CELL, zMin = (next.z * REGION - 0.5) * CELL;
          next.distance = Math.hypot(Math.max(0, xMin - x, x - xMin - REGION_METRES),
            Math.max(0, zMin - z, z - zMin - REGION_METRES));
          next.key = next.x + ',' + next.z;
          if (!regions.has(next.key)) pending.push(next);
        }
      }
      pending.sort((a, b) => a.distance - b.distance);
    }
    let outerBudget = 1;
    while (pending.length && (pending[0].distance <= CELL * 1.5 || outerBudget-- > 0)) {
      const { x, z, key } = pending.shift();
      const region = buildRegionBatches(world, x, z, materials);
      group.add(region);
      regions.set(key, { x, z, region });
      changed = true;
    }
    return changed;
  }
  function dispose() {
    group.removeFromParent();
    for (const { region } of regions.values()) remove(region);
    regions.clear();
    pending = [];
    activeX = activeZ = NaN;
    for (const material of Object.values(materials)) material.dispose();
    for (const texture of Object.values(textures)) texture.dispose();
  }
  return { group, update, dispose };
}
