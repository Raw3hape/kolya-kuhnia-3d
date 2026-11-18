// A bounded window of stitched elevation grids over one deterministic world.
// No textures, terrain, or tree meshes are fetched over the wire.
import * as THREE from 'three';
import { SNOW_TILE as TILE, snowHash } from './snow-world.js';

export const SNOW_LOOK = Object.freeze({
  sky: 0xb4cddd, fog: 0xb4cddd, fogNear: 145, fogFar: 1150, far: 3200,
});
const CHUNK_RADIUS = 4;
const EDGE_STEP = 2;
const HORIZON_BANDS = [
  { width: 384, spacing: 16 },
  { width: 640, spacing: 32 },
];
const LIMIT = Object.freeze({ eco: { near: 32, middle: 8, budget: 3 }, fast: { near: 32, middle: 8, budget: 3 }, high: { near: 32, middle: 16, budget: 4 }, ultra: { near: 32, middle: 16, budget: 4 } });
const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = x => { const k = clamp01(x); return k * k * (3 - 2 * k); };
const lerp = (a, b, u) => a * (1 - u) + b * u;
const keyOf = (x, z) => x + ',' + z;
const sun = new THREE.Vector3(-0.72, 0.42, -0.36).normalize();
const sunHorizontal = Math.hypot(sun.x, sun.z);
const shadeX = -sun.x / sunHorizontal, shadeZ = -sun.z / sunHorizontal;

function tiledTexture(n, image) {
  const texture = new THREE.DataTexture(image, n, n, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function periodicNoise(u, v, cells, seed) {
  const x = u * cells, z = v * cells;
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = ix % cells, b = iz % cells, nextA = (a + 1) % cells, nextB = (b + 1) % cells;
  return lerp(lerp(snowHash(a, b, seed), snowHash(nextA, b, seed), fx),
    lerp(snowHash(a, nextB, seed), snowHash(nextA, nextB, seed), fx), fz);
}

function grain(seed) {
  const n = 128, tau = 2 * Math.PI;
  const image = new Uint8Array(n * n * 4);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const i = (z * n + x) * 4, u = x / n, v = z / n;
    const packed = periodicNoise(u, v, 7, seed ^ 0x163b);
    const warp = periodicNoise(u, v, 5, seed ^ 0x19ac);
    const curl = (5 * u + 4 * v + warp * .62) * tau;
    const gust = (.3 + .7 * warp) * Math.sin(curl);
    const light = Math.round(242 + 4 * gust + 6 * (packed - .5) +
      13 * (snowHash(x, z, seed) - .5));
    image[i] = light - 1;
    image[i + 1] = light;
    image[i + 2] = light + 2;
    image[i + 3] = 255;
  }
  const texture = tiledTexture(n, image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function cloudCover(seed) {
  const n = 128, image = new Uint8Array(n * n * 4);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const i = (z * n + x) * 4;
    const u = x / n, v = z / n;
    image[i] = Math.round(255 * (0.65 * periodicNoise(u, v, 5, seed ^ 5) +
      0.24 * periodicNoise(u, v, 11, seed ^ 11) + 0.11 * periodicNoise(u, v, 28, seed ^ 28)));
    image[i + 3] = 255;
  }
  return tiledTexture(n, image);
}

function atmosphere(cover) {
  const horizon = new THREE.Color(SNOW_LOOK.fog), high = new THREE.Color(0x477eae);
  const cloud = new THREE.Color(0xf5f4ee), sunColor = new THREE.Color(0xfff2cd);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SNOW_LOOK.far * 0.61, 28, 16), new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: horizon }, high: { value: high }, sunDir: { value: sun },
      cloud: { value: cloud }, sunColor: { value: sunColor }, cover: { value: cover },
    },
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `
      uniform vec3 horizon, high, sunDir, cloud, sunColor;
      uniform sampler2D cover;
      varying vec3 vDirection;
      void main() {
        vec3 direction = normalize(vDirection);
        float elevation = direction.y;
        float sunLight = max(0., dot(sunDir, direction));
        vec3 sky = mix(horizon, high, pow(clamp(elevation, 0., 1.), .65));
        vec2 drift = direction.xz / max(.09, elevation + .09);
        vec2 wisps = vec2(drift.x + .46 * drift.y, drift.y - .46 * drift.x);
        float cloudMap = .72 * texture2D(cover, wisps * vec2(.127, .29)).r
          + .28 * texture2D(cover, wisps * vec2(.251, .53) + .37).r;
        float veil = smoothstep(.50, .76, cloudMap) * smoothstep(.035, .21, elevation);
        sky = mix(sky, cloud, .63 * veil);
        float halo = .11 * pow(sunLight, 12.) + .28 * pow(sunLight, 156.);
        sky = mix(sky, sunColor, halo);
        gl_FragColor = vec4(sky, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

// Radial distance keeps the snow/sky transition continuous during free look,
// including the edges of a wide field of view.
function withRadialHaze(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', `
      #ifdef USE_FOG
        vFogDepth = length(mvPosition.xyz);
      #endif
    `);
  };
  return material;
}

function pineShadows(world, x, z) {
  const left = x * TILE, top = z * TILE, props = [];
  for (let j = z - 1; j <= z + 1; j++) for (let i = x - 1; i <= x + 1; i++) {
    for (const tree of world.decoration(i, j)) {
      const length = tree.h * sunHorizontal / sun.y;
      const x = tree.x + shadeX * length * 0.39, z = tree.z + shadeZ * length * 0.39;
      if (x + length < left || x - length > left + TILE || z + length < top || z - length > top + TILE) continue;
      props.push({ x, z, long: Math.max(2, length * 0.53), short: Math.max(0.8, 0.27 * tree.h) });
    }
  }
  return props;
}

function fillTerrain(world, left, top, dx, dz, nx, nz, borders, shadows = [], borderStep = EDGE_STEP) {
  const width = nx + 1;
  const extraX = Math.max(0, dx / borderStep - 1), extraZ = Math.max(0, dz / borderStep - 1);
  const spare = 2 * nx * extraX + 2 * nz * extraZ;
  const fan = spare ? 2 * (nx + nz) : 0;
  const count = (nx + 1) * (nz + 1) + spare + fan;
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  const length = (nx * nz * 2 + spare + fan * 2) * 3;
  const triangles = count > 65535 ? new Uint32Array(length) : new Uint16Array(length);
  const pivotY = world.height(left + dx * nx / 2, top + dz * nz / 2);
  const row = {}, north = {}, south = {};
  const height = world.heightOnCourse;
  const cold = new THREE.Color(0x8cabc4), lit = new THREE.Color(0xfffcf1);
  const windward = new THREE.Color(0xc8dce2), drift = new THREE.Color(0xf2f4ef);
  const rock = new THREE.Color(0x3f4b57), rockLit = new THREE.Color(0x737e86);
  const color = new THREE.Color(), exposedRock = new THREE.Color();
  const normalStep = 1.1;
  let rowZ = NaN, vertexCount = 0, indexCount = 0;

  function vertex(x, z) {
    if (z !== rowZ) {
      rowZ = z;
      world.course(z, row);
      world.course(z - normalStep, north);
      world.course(z + normalStep, south);
    }
    const n = vertexCount++;
    const foot = height(x, row);
    positions[n * 3] = x - left;
    positions[n * 3 + 1] = foot - pivotY;
    positions[n * 3 + 2] = z - top;
    uvs[n * 2] = x / 15;
    uvs[n * 2 + 1] = z / 15;
    const east = height(x + normalStep, row), west = height(x - normalStep, row);
    const foreground = height(x, south), background = height(x, north);
    const tiltX = (east - west) / (2 * normalStep);
    const tiltZ = (foreground - background) / (2 * normalStep);
    const facing = (sun.y - sun.x * tiltX - sun.z * tiltZ) / Math.hypot(1, tiltX, tiltZ);
    const grade = Math.hypot(tiltX, tiltZ);
    const angular = smooth((facing + 0.19) / 1.06);
    const wind = Math.sin(x * .076 + z * .042 + 1.1 * Math.sin(z * .039));
    // The prevailing wind lifts thin ridges on the exposed side while
    // broad dips scatter light toward blue. Terrain relief stays readable.
    const localRelief = foot - (east + west + foreground + background) * .25;
    const summit = smooth((foot - row.y - 18) / 46);
    color.copy(cold).lerp(lit, 0.26 + angular * 0.71 + wind * 0.024);
    const snow = world.snow(x, z, row);
    if (snow === 'ice') color.lerp(windward, 0.16);
    else if (snow === 'powder') color.lerp(drift, 0.06 + angular * 0.07);
    // Dark layered bedrock is visible in patches on wind-scoured faces.
    const strata = 0.55 * Math.sin(x * 0.091 - z * 0.041 + foot * 0.21) + 0.45 * wind;
    const exposure = smooth((grade - 0.65 + strata * 0.23 + summit * 0.10) / 0.70);
    const cornice = smooth((localRelief - .003) / .019) * (1 - exposure);
    exposedRock.copy(rock).lerp(rockLit, angular * 0.88);
    color.lerp(drift, cornice * 0.16).lerp(exposedRock, exposure * 0.91);
    let shaded = 0;
    for (const shadow of shadows) {
      const cx = x - shadow.x, cz = z - shadow.z;
      if (Math.abs(cx) > shadow.long + shadow.short || Math.abs(cz) > shadow.long + shadow.short) continue;
      const a = (cx * shadeX + cz * shadeZ) / shadow.long;
      const b = (cz * shadeX - cx * shadeZ) / shadow.short;
      shaded = Math.max(shaded, 1 - a * a - b * b);
    }
    color.multiplyScalar(1 - 0.34 * shaded);
    color.toArray(colors, n * 3);
    return n;
  }
  function triangle(a, b, c) {
    triangles[indexCount++] = a;
    triangles[indexCount++] = b;
    triangles[indexCount++] = c;
  }
  function strip(a, b, mid, x, z, vx, vz, extra) {
    let last = a;
    const scale = 1 / (extra + 1);
    for (let i = 1; i <= extra; i++) {
      const next = vertex(x + vx * i * scale, z + vz * i * scale);
      triangle(mid, last, next);
      last = next;
    }
    triangle(mid, last, b);
  }

  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) vertex(left + i * dx, top + j * dz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = left + i * dx, z = top + j * dz;
    const a = j * width + i, b = a + 1, c = a + width, d = c + 1;
    const splitN = extraX && j === 0 && borders(0, x + dx / 2) ? extraX : 0;
    const splitE = extraZ && i === nx - 1 && borders(1, z + dz / 2) ? extraZ : 0;
    const splitS = extraX && j === nz - 1 && borders(2, x + dx / 2) ? extraX : 0;
    const splitW = extraZ && i === 0 && borders(3, z + dz / 2) ? extraZ : 0;
    if (!(splitN || splitE || splitS || splitW)) {
      triangle(a, c, b); triangle(b, c, d);
      continue;
    }
    const mid = vertex(x + dx / 2, z + dz / 2);
    strip(a, c, mid, x, z, 0, dz, splitW);
    strip(c, d, mid, x, z + dz, dx, 0, splitS);
    strip(d, b, mid, x + dx, z + dz, 0, -dz, splitE);
    strip(b, a, mid, x + dx, z, -dx, 0, splitN);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vertexCount * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, vertexCount * 3), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs.subarray(0, vertexCount * 2), 2));
  geometry.setIndex(new THREE.BufferAttribute(triangles.subarray(0, indexCount), 1));
  geometry.computeBoundingSphere();
  return { geometry, pivotY };
}

const brush = Object.freeze({
  trunk: new THREE.Color(0x594a43),
  twig: new THREE.Color(0x344f54), needle: new THREE.Color(0x50716e), ice: new THREE.Color(0xbed2d7),
  snow: new THREE.Color(0xe3edf0),
});

function foliage(world, x, z, detail) {
  const originX = x * TILE, originZ = z * TILE;
  const originY = world.height(originX + TILE / 2, originZ + TILE / 2);
  const positions = [], colors = [];
  const j = world.decoration(x, z);
  function face(a, b, c, hue, shade = 1) {
    for (const point of [a, b, c]) {
      positions.push(point[0] - originX, point[1] - originY, point[2] - originZ);
      colors.push(hue.r * shade, hue.g * shade, hue.b * shade);
    }
  }
  function cone(x, y, z, radius, high, facets, rotate, lower, upper, dip = 0) {
    const tip = [x + dip, y + high, z + dip * 0.4];
    const edge = index => {
      const a = rotate + 2 * Math.PI * index / facets;
      const taper = radius * (index % 2 ? 0.81 : 1.07);
      return [x + Math.cos(a) * taper, y + ((index % 3) - 1) * dip, z + Math.sin(a) * taper];
    };
    for (let k = 0; k < facets; k++) {
      const a = edge(k), b = edge((k + 1) % facets);
      const az = rotate + 2 * Math.PI * (k + 0.5) / facets;
      const shade = 0.76 + 0.24 * Math.max(0, 0.48 - Math.cos(az + 0.8) * 0.47);
      if (upper) {
        const snowLine = k % 2 ? 0.39 : 0.23;
        const aa = a.map((v, n) => lerp(v, tip[n], snowLine));
        const bb = b.map((v, n) => lerp(v, tip[n], snowLine));
        face(a, aa, b, lower, shade);
        face(b, aa, bb, lower, shade);
        face(aa, tip, bb, upper, shade + 0.1);
      } else face(a, tip, b, lower, shade);
    }
  }
  for (const tree of j) {
    const { x, y, z, h, rotation } = tree;
    const facets = detail ? 7 : 5, layers = detail ? 4 : 3;
    cone(x, y - 0.42, z, tree.radius * 0.97, h * 0.4, 5, rotation, brush.trunk);
    const lean = h * 0.04 * Math.sin(rotation);
    for (let i = 0; i < layers; i++) {
      const at = i / layers;
      cone(x + at * lean, y + h * (0.12 + 0.66 * at), z, h * (0.25 - at * 0.18),
        h * Math.min(0.57, 0.9 - 0.66 * at), facets, rotation + i * 0.51,
        i % 2 ? brush.needle : brush.twig, tree.snowcap > 0.58 ? brush.snow : brush.ice, lean * 0.56);
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return { geometry, pivotY: originY };
}

export function createSnowEnvironment(world, { quality = 'eco' } = {}) {
  const settings = LIMIT[quality] ?? LIMIT.eco;
  const floorTexture = grain(world.seed), cover = cloudCover(world.seed);
  const sky = atmosphere(cover), group = new THREE.Group();
  const land = withRadialHaze(new THREE.MeshBasicMaterial({ vertexColors: true, map: floorTexture }));
  const plants = withRadialHaze(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  group.name = 'snow_world';
  group.add(sky);
  const active = new Map();
  const wanted = new Map();
  let originX = NaN, originZ = NaN, pending = [], horizon = [], loaded = false;

  function setGround(geometry, x, z, y) {
    const mesh = new THREE.Mesh(geometry, land);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  function treeMesh(x, z, detail) {
    const result = foliage(world, x, z, detail);
    if (!result) return null;
    const mesh = new THREE.Mesh(result.geometry, plants);
    mesh.position.set(x * TILE, result.pivotY, z * TILE);
    group.add(mesh);
    return mesh;
  }

  function drop(mesh) {
    if (!mesh) return;
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }

  function horizonAround(tx, tz) {
    for (const mesh of horizon) drop(mesh);
    horizon = [];
    let x0 = (tx - CHUNK_RADIUS) * TILE, x1 = (tx + CHUNK_RADIUS + 1) * TILE;
    let z0 = (tz - CHUNK_RADIUS) * TILE, z1 = (tz + CHUNK_RADIUS + 1) * TILE;
    let borderStep = EDGE_STEP;
    // The inner band resolves cliff silhouettes, the coarser outer band
    // carries only the skyline through the atmospheric falloff.
    for (const { width, spacing } of HORIZON_BANDS) {
      const left = x0 - width, right = x1 + width;
      const top = z0 - width, bottom = z1 + width;
      const patches = [
        [left, top, right, z0, 2], [left, z0, x0, z1, 1],
        [x1, z0, right, z1, 3], [left, z1, right, bottom, 0],
      ];
      for (const [a, b, c, d, boundary] of patches) {
        const stitches = (side, coordinate) => side === boundary && (side % 2 === 1 || (coordinate >= x0 && coordinate <= x1));
        const { geometry, pivotY } = fillTerrain(world, a, b, spacing, spacing,
          (c - a) / spacing, (d - b) / spacing, stitches, [], borderStep);
        horizon.push(setGround(geometry, a, b, pivotY));
      }
      x0 = left; x1 = right; z0 = top; z1 = bottom;
      borderStep = spacing;
    }
  }

  function rebuild(tileX, tileZ) {
    originX = tileX; originZ = tileZ;
    wanted.clear();
    for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
      const x = tileX + dx, z = tileZ + dz, d = Math.max(Math.abs(dx), Math.abs(dz));
      const div = d <= 1 ? settings.near : d === 2 ? settings.middle : d === 3 ? 8 : 4;
      wanted.set(keyOf(x, z), { x, z, d, div });
    }
    for (const [key, mesh] of active) {
      if (wanted.has(key)) continue;
      drop(mesh.ground); drop(mesh.tree);
      active.delete(key);
    }
    pending = [...wanted].filter(([key, value]) => active.get(key)?.div !== value.div || active.get(key)?.detail !== Math.min(2, 4 - value.d));
    pending.sort(([, a], [, b]) => a.d - b.d || Math.abs(a.x - tileX) + Math.abs(a.z - tileZ) -
      Math.abs(b.x - tileX) - Math.abs(b.z - tileZ));
    horizonAround(tileX, tileZ);
  }

  function createTile(key, tile, low = false) {
    const prev = active.get(key);
    const div = low ? 4 : tile.div, step = TILE / div;
    // Every tile uses the same exact border samples. A coarse tile
    // subdivides only the edge cells, even when a neighbouring tile is pending.
    const shadows = pineShadows(world, tile.x, tile.z);
    const { geometry, pivotY } = fillTerrain(world, tile.x * TILE, tile.z * TILE, step, step, div, div, () => true, shadows);
    const ground = setGround(geometry, tile.x * TILE, tile.z * TILE, pivotY);
    const detail = low && tile.d <= 3 ? -1 : Math.min(2, 4 - tile.d);
    let tree = prev?.tree;
    if (prev?.detail !== detail) {
      drop(tree);
      tree = detail > 0 ? treeMesh(tile.x, tile.z, detail === 2) : null;
    }
    drop(prev?.ground);
    active.set(key, { ground, tree, detail, div });
  }

  function update(x, z) {
    const tileX = Math.floor(x / TILE), tileZ = Math.floor(z / TILE);
    sky.position.set(x, world.height(x, z) + 8, z);
    const moved = tileX !== originX || tileZ !== originZ;
    if (moved) rebuild(tileX, tileZ);
    const updated = !!pending.length;
    if (!loaded || moved) {
      // Seed incoming peripheral slots with inexpensive geometry. This also
      // makes the first approved doorway render useful without a loading veil.
      for (const [key, tile] of pending) if (!active.has(key)) createTile(key, tile, tile.d > 1);
      pending = pending.filter(([key, tile]) => active.get(key)?.div !== tile.div ||
        active.get(key)?.detail !== Math.min(2, 4 - tile.d));
    }
    let budget = loaded ? settings.budget : 5;
    while (pending.length && (budget-- > 0 || pending[0][1].d < 1)) {
      const [key, tile] = pending.shift();
      createTile(key, tile);
    }
    loaded = true;
    return moved || updated;
  }

  function dispose() {
    for (const value of active.values()) { drop(value.ground); drop(value.tree); }
    active.clear(); wanted.clear(); pending = [];
    for (const mesh of horizon) drop(mesh);
    horizon = [];
    drop(sky); sky.material.dispose();
    cover.dispose(); floorTexture.dispose(); plants.dispose(); land.dispose();
    group.removeFromParent();
  }

  function stats() {
    let triangles = 0, vertices = 0;
    for (const object of group.children) {
      const geometry = object.geometry;
      const count = geometry.attributes.position.count;
      vertices += count;
      triangles += (geometry.index ? geometry.index.count : count) / 3;
    }
    return { tiles: active.size, pending: pending.length, meshes: group.children.length, triangles, vertices };
  }

  return { group, update, dispose, stats };
}
