// Each towel is a distinct woven souvenir. The room assigns the atlas index.
export const SAUNA_TOWELS = Object.freeze([
  { name: 'Не парься', ground: '#16596a', stripe: '#9bd4c5', art: '#ffd358', ink: '#153b47', icon: 'duck' },
  { name: 'Пицца после', ground: '#b44730', stripe: '#f1d7a2', art: '#f4b753', ink: '#713025', icon: 'pizza' },
  { name: 'Снова 90°', ground: '#ebc785', stripe: '#7c352c', art: '#b44335', ink: '#fff0c2', icon: 'heat' },
  { name: 'Лось в спа', ground: '#435841', stripe: '#d8daa4', art: '#ddac73', ink: '#333c38', icon: 'moose' },
  { name: 'Кот на полке', ground: '#693f69', stripe: '#e9bed2', art: '#f2c0ad', ink: '#513446', icon: 'cat' },
  { name: 'Где носки?', ground: '#2b3d75', stripe: '#8bafe3', art: '#d6e9d0', ink: '#3b556d', icon: 'sock' },
  { name: 'Рыба отдыхает', ground: '#367977', stripe: '#c1dbc6', art: '#f5c895', ink: '#236069', icon: 'fish' },
  { name: 'Тихий час', ground: '#302a47', stripe: '#b09bc1', art: '#e6d7ad', ink: '#362c49', icon: 'moon' },
  { name: 'Чай после пара', ground: '#94503d', stripe: '#e0b4a3', art: '#e5dac1', ink: '#66382f', icon: 'tea' },
  { name: 'Выше облаков', ground: '#666f9e', stripe: '#edbf8e', art: '#f6e4c5', ink: '#635850', icon: 'peaks' },
].map(Object.freeze));

const EMBLEMS = {
  duck: ['M4 29 Q8 36 6 40 Q5 51 26 51 Q51 51 53 38 Q58 34 53 28 L45 27 Q44 16 36 15 Q25 14 23 25 Q20 37 4 29Z', 'M34 23v4 M45 29l12 3-11 4 M15 41q10 6 18-1'],
  pizza: ['M12 49 Q23 11 50 12 L47 51Z M12 49 Q28 58 47 51', 'M18 47q16 5 26 0 M36 22v2 M31 34v2 M41 41v2 M23 42v2'],
  heat: ['M25 34 V11 Q25 4 32 4 Q39 4 39 11 V34 A16 16 0 1 1 25 34 Z', 'M32 13v28 M32 46v1 M44 12h9 M44 22h7 M44 32h9'],
  moose: ['M22 26 Q31 19 42 28 L39 42 Q41 55 32 57 Q23 57 24 43Z M25 39 Q10 33 7 22 Q2 8 9 8 Q13 8 16 17 Q20 7 25 14 L27 29 Z M38 29 Q44 5 50 12 Q54 14 51 23 Q60 12 62 19 Q63 30 41 39Z', 'M28 35h1 M36 35h1 M30 48h4'],
  cat: ['M12 40 L12 19 L24 24 Q32 21 42 24 L53 18 L53 41 Q49 54 32 54 Q16 54 12 40Z', 'M20 38q5 5 10 0 M36 38q5 5 9 0 M31 44h4 M6 41l9 4 M51 43l8-3'],
  sock: ['M15 9 L40 9 L41 34 Q61 34 61 46 Q61 56 40 56 L22 50 Q15 48 15 38Z', 'M17 15h20 M18 23h20 M20 43q7-2 10 9 M50 39q-6 5-4 14'],
  fish: ['M9 34 Q26 12 45 29 L58 21 L57 47 L45 40 Q22 56 9 34Z', 'M20 31v2 M31 28q5 5 0 11 M7 39v2'],
  moon: ['M39 8 Q24 17 31 32 Q36 46 53 40 Q46 59 27 55 Q6 51 7 30 Q8 12 23 9Z M47 12l3 5 6 1-4 5 1 6-6-3-5 3 1-6-4-5 6-1Z', 'M17 34q3 6 9 6'],
  tea: ['M12 24 Q20 17 32 19 Q46 19 49 29 Q53 41 43 48 Q30 57 17 47 Q10 42 12 24Z M48 28l10-9 3 4-9 16 M15 29L7 24 5 29 12 36', 'M20 22Q20 6 32 6 Q43 6 45 20 M28 33h9'],
  peaks: ['M5 49 L21 23 L31 35 L43 12 L61 49Z M14 52h39', 'M18 29l4 4 5-3 M36 25l8 7 5-5 M50 12l4-3 M48 18h10'],
};

const TILE_PIXELS = 256;
const TILES_PER_SIDE = 4;
const GUTTER = 4;
const YARN_HIGHLIGHTS = 'rgba(255,255,255,0.043)';
const YARN_SHADOWS = 'rgba(0,0,0,0.055)';

function motif(ctx, paths, x, y, size, fill, line) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 64, size / 64);
  ctx.fillStyle = fill;
  ctx.fill(paths[0]);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = line;
  ctx.stroke(paths[1]);
  ctx.restore();
}

function drawTowel(ctx, design) {
  const size = TILE_PIXELS;
  const paths = EMBLEMS[design.icon].map(path => new Path2D(path));
  ctx.fillStyle = design.ground; ctx.fillRect(0, 0, size, size);
  // Repeated weft, little woven emblems and a larger face woven into the front.
  ctx.globalAlpha = 0.29;
  for (let y = 44; y < size - 22; y += 39) {
    for (let x = (y % 2 ? 4 : 25); x < size; x += 48) {
      motif(ctx, paths, x, y, 19, design.stripe, design.ground);
    }
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = design.stripe;
  for (const [y, h] of [[5, 6], [15, 3], [227, 3], [234, 10], [248, 4]]) ctx.fillRect(0, y, size, h);
  motif(ctx, paths, size / 2, 105, 53, design.art, design.ink);

  const label = design.name.toUpperCase();
  const titleY = 156, labelWidth = Math.min(114, Math.max(74, label.length * 6.9));
  const labelX = (size - labelWidth) / 2;
  ctx.fillStyle = design.stripe;
  ctx.fillRect(labelX, titleY - 12, labelWidth, 22);
  ctx.fillStyle = design.ink;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(label, size / 2, titleY, labelWidth - 7);

  ctx.fillStyle = YARN_HIGHLIGHTS;
  for (let x = 0; x < size; x += 3) ctx.fillRect(x, 0, 1, size);
  ctx.fillStyle = YARN_SHADOWS;
  for (let y = 0; y < size; y += 3) ctx.fillRect(0, y, size, 1);
}

export function createSaunaTowelSurface(T) {
  const canvas = document.createElement('canvas'), size = TILE_PIXELS * TILES_PER_SIDE;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  for (const [i, design] of SAUNA_TOWELS.entries()) {
    ctx.save();
    ctx.translate((i % TILES_PER_SIDE) * TILE_PIXELS, Math.floor(i / TILES_PER_SIDE) * TILE_PIXELS);
    ctx.beginPath(); ctx.rect(0, 0, TILE_PIXELS, TILE_PIXELS); ctx.clip();
    drawTowel(ctx, design);
    ctx.restore();
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  const material = new T.MeshStandardMaterial({ map, roughness: 0.96 });
  return { material, dispose() { material.dispose(); map.dispose(); } };
}

// y, centre z, width radius, depth radius, pitch of the collar of cloth.
// The seated shape bends around the knees and keeps the overlap closed.
const STANDING_WRAP = [
  [0.165, 0, 0.163, 0.119, 0], [0.148, 0, 0.177, 0.132, 0], [0.08, 0.005, 0.19, 0.144, 0],
  [-0.052, -0.007, 0.208, 0.154, 0], [-0.19, -0.018, 0.218, 0.183, 0], [-0.29, -0.035, 0.224, 0.192, 0],
  [-0.312, -0.038, 0.217, 0.181, 0],
];
const SEATED_WRAP = [
  [0.165, 0, 0.163, 0.119, 0], [0.148, 0, 0.18, 0.135, 0], [0.087, -0.025, 0.194, 0.146, 0.34],
  [0.029, -0.094, 0.211, 0.127, 0.88], [0.003, -0.234, 0.217, 0.103, 1.42], [-0.014, -0.341, 0.218, 0.094, 1.66],
  [-0.034, -0.37, 0.203, 0.078, 1.76],
];
const UPPER_WRAP = [
  [0.473, -0.009, 0.171, 0.107, 0], [0.459, -0.009, 0.185, 0.122, 0],
  [0.365, -0.009, 0.188, 0.127, 0], [0.287, -0.007, 0.177, 0.121, 0],
  [0.274, -0.007, 0.164, 0.114, 0],
];
const PANELS = 24, TURN = Math.PI * 2;

function wrapGeometry(T, shape, slot) {
  const positions = [], uvs = [], indices = [];
  const rowSize = PANELS + 1, textureSize = TILE_PIXELS * TILES_PER_SIDE;
  const tx = (slot % TILES_PER_SIDE) * TILE_PIXELS + GUTTER;
  const ty = Math.floor(slot / TILES_PER_SIDE) * TILE_PIXELS + GUTTER;
  const width = TILE_PIXELS - GUTTER * 2;
  const uv = (u, v) => uvs.push((tx + u * width) / textureSize, 1 - (ty + v * width) / textureSize);
  for (const [i, [y, z, wide, deep, pitch]] of shape.entries()) {
    for (let k = 0; k <= PANELS; k++) {
      const u = k / PANELS, a = TURN * (u - 0.5);
      const fold = 1 + Math.sin(7 * a + i * 0.6) * 0.022 + Math.cos(4 * a) * 0.023;
      const depth = -Math.cos(a) * deep * fold;
      const hem = (i === shape.length - 1 ? 0.008 : 0.002) * Math.cos(a * 3);
      positions.push(-Math.sin(a) * wide * fold, y - depth * Math.sin(pitch) + hem, z + depth * Math.cos(pitch));
      uv(u, i / (shape.length - 1));
      if (i < shape.length - 1 && k < PANELS) {
        const top = i * rowSize + k, bottom = top + rowSize;
        indices.push(top, bottom, top + 1, top + 1, bottom, bottom + 1);
      }
    }
  }
  // Both ends are sealed, including when viewed from below on stairs.
  const lastRow = (shape.length - 1) * rowSize, cap = positions.length / 3;
  positions.push(0, shape[0][0], shape[0][1], 0, shape.at(-1)[0], shape.at(-1)[1]);
  uv(0.5, 0); uv(0.5, 1);
  for (let k = 0; k < PANELS; k++) indices.push(cap, k, k + 1, cap + 1, lastRow + k + 1, lastRow + k);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createSaunaTowelGeometry(T, slot, upper = false) {
  const geometry = wrapGeometry(T, upper ? UPPER_WRAP : STANDING_WRAP, slot);
  if (upper) return geometry;
  const seated = wrapGeometry(T, SEATED_WRAP, slot);
  geometry.morphAttributes.position = [seated.getAttribute('position')];
  geometry.morphAttributes.normal = [seated.getAttribute('normal')];
  seated.dispose();
  return geometry;
}
