import { createSaunaLayout } from './sauna-layout.js';
import { saunaFinishes, saunaWater } from './sauna-surfaces.js';

const MOUNTAINS = new URL('../textures/sauna/dolomites.webp', import.meta.url);
const FAR = 125;
const HORIZONTAL = -Math.PI / 2;
const isInside = (x, z, [a, b, c, d]) => x > a && x < c && z > b && z < d;

function center([x0, z0, x1, z1]) {
  return [(x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0];
}

function batchScene(T, scene, own) {
  const boxGeometry = own(new T.BoxGeometry());
  const cylinderGeometry = own(new T.CylinderGeometry(.5, .5, 1, 16));
  const coneGeometry = own(new T.CylinderGeometry(.39, .5, 1, 16));
  const rockGeometry = own(new T.IcosahedronGeometry(.5, 1));
  const leafGeometry = own(new T.SphereGeometry(.5, 8, 6));
  const groups = new Map(), temp = new T.Object3D();
  function collect(geo, mat, x, y, z, w, height, d, yaw = 0, pitch = 0, roll = 0) {
    const name = geo.id + ':' + mat.id;
    let group = groups.get(name);
    if (!group) { group = { geo, mat, transforms: [] }; groups.set(name, group); }
    temp.position.set(x, y, z); temp.rotation.set(pitch, yaw, roll, 'YXZ');
    temp.scale.set(w, height, d); temp.updateMatrix();
    group.transforms.push(temp.matrix.clone());
  }
  return {
    box: (...args) => collect(boxGeometry, ...args),
    cylinder: (...args) => collect(cylinderGeometry, ...args),
    taper: (...args) => collect(coneGeometry, ...args),
    rock: (...args) => collect(rockGeometry, ...args),
    leaf: (...args) => collect(leafGeometry, ...args),
    flush() {
      for (const { geo, mat, transforms } of groups.values()) {
        const batch = own(new T.InstancedMesh(geo, mat, transforms.length));
        transforms.forEach((matrix, i) => batch.setMatrixAt(i, matrix));
        batch.instanceMatrix.needsUpdate = true;
        batch.computeBoundingSphere();
        scene.add(batch);
      }
      groups.clear();
    },
  };
}

function floorDeck(T, scene, own, bounds, pools, material) {
  const [x0, z0, x1, z1] = bounds;
  const ax = [x0, x1], az = [z0, z1];
  for (const { rect: [px0, pz0, px1, pz1] } of pools) {
    ax.push(px0, px1); az.push(pz0, pz1);
  }
  ax.sort((a, b) => a - b); az.sort((a, b) => a - b);
  const vertices = [], uv = [];
  for (let xi = 1; xi < ax.length; xi++) for (let zi = 1; zi < az.length; zi++) {
    const xa = ax[xi - 1], xb = ax[xi], za = az[zi - 1], zb = az[zi];
    if (pools.some(pool => isInside((xa + xb) * .5, (za + zb) * .5, pool.rect))) continue;
    for (const [x, z] of [[xa, za], [xa, zb], [xb, za], [xb, za], [xa, zb], [xb, zb]]) {
      vertices.push(x, 0, z); uv.push(x / 1.34, z / 1.34);
    }
  }
  const geo = own(new T.BufferGeometry());
  geo.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  scene.add(new T.Mesh(geo, material));
}

function buildWall(wall, batch, m) {
  const [x, z, w, d] = center(wall.rect);
  const { height, style } = wall;
  const alongX = w >= d, length = Math.max(w, d);
  if (style.startsWith('glass-')) {
    const cedar = style === 'glass-cedar';
    batch.box(cedar ? m.hotGlass : m.glass, x, height / 2, z, w, height, d);
    const postCount = Math.ceil(length / 2.02);
    for (let i = 0; i <= postCount; i++) {
      const offset = (i / postCount - .5) * (length - .065);
      batch.box(m.trim, x + (alongX ? offset : 0), height / 2, z + (alongX ? 0 : offset), .072, height, .072);
    }
    batch.box(m.trim, x, .069, z, w + .036, .138, d + .036);
    batch.box(m.trim, x, height - .068, z, w + .036, .136, d + .036);
    const tint = cedar ? m.warm : m.cool;
    batch.box(tint, x, height - .17, z, w + .029, .025, d + .027);
    return;
  }
  batch.box(m[style], x, height / 2, z, w, height, d);
  batch.box(m.trim, x, .056, z, w + .012, .112, d + .012);
  if (style === 'cedar') {
    const count = Math.round(length / .26);
    for (let i = 1; i < count; i++) {
      const offset = (i / count - .5) * length;
      batch.box(m.ash, x + (alongX ? offset : 0), height / 2, z + (alongX ? 0 : offset),
        alongX ? .024 : w + .028, height, alongX ? d + .028 : .024);
    }
  }
}

function shell(layout, batch, m) {
  const { bounds: [x0, z0, x1, z1], architecture, spawn } = layout;
  const roof = x => architecture.ceiling - Math.abs(x) * architecture.pitch;
  const d = z1 - z0;
  for (const x of [x0, x1]) {
    const h = roof(x);
    batch.box(m.burnt, x - Math.sign(x) * .08, h / 2, (z0 + z1) / 2, .16, h, d);
    batch.box(m.trim, x - Math.sign(x) * .11, .11, (z0 + z1) / 2, .13, .21, d);
    for (let z = z0 + .30; z < z1; z += .46) {
      batch.box(m.ash, x - Math.sign(x) * .145, h / 2, z, .16, h, .042);
    }
  }
  // The elevation above the glass is part of the shallow pitched timber roof.
  for (const side of [-1, 1]) {
    const half = side < 0 ? -x0 : x1;
    const rx = side * half / 2;
    batch.box(m.burnt, rx, roof(rx) + .055, (z0 + z1) / 2, half * Math.hypot(1, architecture.pitch) + .025,
      .15, d + .20, 0, 0, -Math.atan(architecture.pitch) * side);
  }
  // Timber ceiling fins and recessed light channels establish the vanishing point.
  const ribs = Math.round((x1 - x0) / architecture.roofBay);
  for (let i = 0; i < ribs; i++) {
    const x = x0 + (i + .5) * (x1 - x0) / ribs, h = roof(x);
    batch.box(i % 4 === 1 ? m.ash : m.cedar, x, h - .12, (z0 + z1) / 2, .10, .26, d);
    if (i % 3 === 1) {
      batch.box(m.brass, x + .15, roof(x + .15) - .027, (z0 + z1) / 2, .105, .057, d - 1);
      batch.box(m.warm, x + .15, roof(x + .15) - .058, (z0 + z1) / 2, .046, .018, d - 1.4);
    }
  }
  const glazingWidth = (x1 - x0) / architecture.glazing;
  for (let i = 0; i < architecture.glazing; i++) {
    const a = x0 + i * glazingWidth, b = a + glazingWidth;
    const h = Math.min(roof(a), roof(b)) - .22, x = (a + b) / 2;
    batch.box(m.glass, x, h / 2, z0, glazingWidth, h, .026);
    batch.box(m.brass, a, h / 2 + .11, z0, .085, h + .22, .125);
    batch.box(m.trim, x, h + .105, z0, glazingWidth, .21, .185);
    batch.box(m.trim, x, .073, z0, glazingWidth, .146, .22);
  }
  batch.box(m.brass, x1, roof(x1) / 2, z0, .085, roof(x1), .125);
  const entryWidth = 2.48, doorHeight = 2.41, doorX = spawn[0], entryZ = z1 - .11;
  for (const [xa, xb] of [[x0, doorX - entryWidth / 2], [doorX + entryWidth / 2, x1]]) {
    const x = (xa + xb) / 2, h = Math.min(roof(xa), roof(xb));
    batch.box(m.darkStone, x, h / 2, entryZ, xb - xa, h, .24);
  }
  batch.box(m.darkStone, doorX, (architecture.ceiling + doorHeight) / 2, entryZ, entryWidth * 2.31, architecture.ceiling - doorHeight, .24);
  batch.box(m.burnt, doorX, doorHeight / 2, entryZ, entryWidth - .1, doorHeight, .16);
  for (const side of [-1, 1]) {
    const x = doorX + side * entryWidth / 2;
    batch.box(m.brass, x, doorHeight / 2, entryZ - .095, .075, doorHeight, .165);
    batch.box(m.warm, x, doorHeight / 2, entryZ - .18, .018, doorHeight - .1, .013);
  }
  batch.box(m.brass, doorX, doorHeight + .004, entryZ - .112, entryWidth, .088, .15);
  batch.box(m.brass, doorX - .9, 1.01, entryZ - .15, .23, .038, .08);
}

function basin(pool, batch, m) {
  const [x, z, w, d] = center(pool.rect), [x0, z0, x1, z1] = pool.rect;
  const rim = pool.rim, bottom = pool.surface - pool.depth;
  batch.box(m.liner, x, bottom - .08, z - pool.steps / 2, w, .16, d - pool.steps);
  // The gently sloping entry remains physically contiguous with the dry deck.
  const rise = -bottom, run = pool.steps;
  batch.box(m.liner, x, bottom / 2 - .073, z1 - run / 2, w, .143, Math.hypot(rise, run), 0,
    -Math.atan2(rise, run));
  for (const edgeX of [x0 - rim / 2, x1 + rim / 2]) {
    batch.box(m.liner, edgeX, bottom / 2, z, rim, rise, d);
    batch.box(m.coping, edgeX, .056, z, rim, .115, d + rim);
    batch.box(m.cool, edgeX + Math.sign(edgeX - x) * rim * .45, .038, z, .023, .023, d - .16);
  }
  batch.box(m.liner, x, bottom / 2, z0 - rim / 2, w, rise, rim);
  batch.box(m.coping, x, .056, z0 - rim / 2, w + rim * 2, .115, rim);
  // Linear drains make the opening obvious without adding a deck step.
  batch.box(m.trim, x, .008, z1 + .215, w + rim * 2, .016, .075);
  for (let i = 0; i < Math.floor(w / .15); i++) {
    batch.box(m.brass, x0 + .075 + i * .15, .019, z1 + .215, .015, .012, .067);
  }
  if (!pool.rails) return;
  for (const xx of [x0 + .2, x1 - .2]) {
    const rr = .046, length = Math.min(1.65, run);
    for (const zz of [z1 + .22, z1 + .22 - length]) batch.cylinder(m.brass, xx, .32, zz, rr, .74, rr);
    batch.cylinder(m.brass, xx, .681, z1 + .22 - length / 2, rr, length, rr, 0, HORIZONTAL);
  }
}

function zoneFinishes(T, scene, own, layout, batch, m) {
  for (const zone of layout.zones) {
    const [x, z, w, d] = center(zone.rect);
    if (zone.roof) {
      const cedar = zone.style === 'cedar';
      batch.box(cedar ? m.cedar : m.basalt, x, zone.roof + .07, z, w, .14, d);
      batch.box(cedar ? m.cedar : m.darkStone, x, .012, z, w, .022, d);
      for (let cursor = x - w / 2 + .18; cursor < x + w / 2; cursor += .33) {
        batch.box(cedar ? m.ash : m.trim, cursor, zone.roof - .033, z, .045, .085, d);
      }
      batch.box(cedar ? m.warm : m.cool, x, zone.roof - .11, z - d / 2 + .25, w - .31, .025, .054);
      batch.box(cedar ? m.warm : m.cool, x, .035, z - d / 2 + .16, w - .36, .026, .048);
      // Continuous embossed timber/stone lining at the west exterior wall.
      batch.box(cedar ? m.cedar : m.basalt, x - w / 2 + .055, zone.roof / 2, z, .17, zone.roof, d);
    } else if (zone.style === 'quiet' || zone.style === 'lounge') {
      const wool = zone.style === 'quiet' ? m.darkStone : m.burnt;
      batch.box(wool, x, .008, z, w - .27, .017, d - .25);
      for (const side of [-1, 1]) batch.box(m.brass, x + side * (w / 2 - .24), .014, z, .02, .018, d - .32);
      batch.box(m.warm, x + w / 2 - .28, .08, z, .024, .06, d - .28);
    }
    if (!zone.sign) continue;
    const [sx, sy, sz, yaw] = zone.sign;
    const map = plaque(T, zone, own);
    const sign = new T.Mesh(own(new T.PlaneGeometry(2.10, .46)),
      own(new T.MeshBasicMaterial({ map })));
    sign.name = 'sauna-sign-' + zone.id;
    sign.position.set(sx, sy, sz); sign.rotation.y = yaw;
    scene.add(sign);
  }
}

function plaque(T, zone, own) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 108;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#292b29'; ctx.fillRect(0, 0, 512, 108);
  ctx.strokeStyle = '#917551'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, 508, 104);
  ctx.fillStyle = '#ddad7d'; ctx.fillRect(22, 18, 3, 69);
  ctx.font = '600 19px ui-monospace, monospace'; ctx.fillText(zone.subtitle, 42, 38, 440);
  ctx.fillStyle = '#f4e1c4'; ctx.font = '500 33px system-ui, sans-serif'; ctx.fillText(zone.label, 42, 79, 440);
  const tex = own(new T.CanvasTexture(canvas));
  tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

function addFurniture(item, batch, m, seeded, architecture) {
  const [x, z] = item.at, [w, d] = item.size, y = item.seatY;
  const yaw = item.yaw, cos = Math.cos(yaw), sin = Math.sin(yaw);
  function form(f, material, u, v, height, width, hh, dd, pitch = 0, roll = 0, turn = 0) {
    batch[f](material, x + u * cos + v * sin, height, z - u * sin + v * cos, width, hh, dd, yaw + turn, pitch, roll);
  }
  const box = (...args) => form('box', ...args);
  if (item.kind === 'bench' || item.kind === 'window' || item.kind === 'stool') {
    const cedar = item.style === 'cedar', carved = item.style === 'basalt';
    const finish = m[item.style], legs = cedar ? m.ash : m.basalt;
    const pads = Math.ceil(d / .136);
    for (let i = 0; i < pads; i++) {
      const v = (i + .5) * d / pads - d / 2;
      box(finish, 0, v, y - .039, w, .078, d / pads - .012);
    }
    box(legs, 0, .05, y * .51, w - .105, y - .11, d - .17);
    box(cedar ? m.warm : m.glow, 0, -d / 2 + .055, y - .126, w - .09, .025, .048);
    if (item.kind === 'window') {
      for (const side of [-1, 1]) {
        form('leaf', m.sand, side * w * .36, .06, y + .079, .30, .15, .41, 0, 0, side * .06);
        form('leaf', m.linen, side * w * .39, .10, y + .106, .27, .16, .41, 0, 0, side * .28);
      }
    }
    if (item.kind === 'bench' && item.zone !== 'arrival') {
      const ridgeY = y + (carved ? .21 : .31);
      for (let i = 0; i < 3; i++) box(finish, 0, d / 2 - .065, ridgeY + i * .106, w, .09, .068);
    }
    return;
  }
  if (item.kind === 'lounger') {
    const cloth = m[item.style];
    for (const side of [-1, 1]) {
      box(m.brass, side * (w / 2 - .063), 0, .141, .053, .084, d - .12);
      for (const leg of [-1, 1]) box(m.brass, side * (w / 2 - .063), leg * (d / 2 - .219), .247, .043, .28, .049);
    }
    box(m.ash, 0, -.37, y - .083, w - .06, .14, d * .57, .06);
    box(cloth, 0, -.37, y - .045, w - .125, .121, d * .57, .06);
    box(m.ash, 0, .842, y + .139, w - .07, .155, d * .43, -.47);
    box(cloth, 0, .829, y + .195, w - .133, .13, d * .47, -.47);
    form('leaf', m.linen, 0, 1.173, y + .443, w * .57, .18, .24, -.47);
    return;
  }
  if (item.kind === 'sofa') {
    const cloth = m[item.style], section = w / item.places;
    box(m.ash, 0, .04, .15, w - .14, .21, d - .08);
    for (let i = 0; i < item.places; i++) {
      const u = (i + .5) * section - w / 2;
      box(cloth, u, -.07, y - .102, section - .022, .202, d - .2);
      box(cloth, u, d / 2 - .16, y + .19, section - .02, .47, .275, -.10);
      const tilt = seeded() - .5;
      form('leaf', i % 2 ? m.linen : m.sand, u + section * .20, d * .30, y + .22, section * .52, .39, .203, -.21, tilt);
    }
    for (const side of [-1, 1]) box(cloth, side * (w / 2 - .128), .037, y + .046, .215, .234, d);
    return;
  }
  if (item.kind === 'plant') {
    const mm = Math.min(w, d);
    form('taper', m.basalt, 0, 0, .265, mm * .93, .53, mm * .93);
    form('cylinder', m.burnt, 0, 0, .53, mm * .74, .027, mm * .74);
    const leaves = 16;
    for (let i = 0; i < leaves; i++) {
      const angle = i * Math.PI * 2 / leaves + seeded() * .22, rr = mm * (.11 + seeded() * .27);
      form('leaf', i % 3 ? m.leaf : m.leafPale, Math.sin(angle) * rr, Math.cos(angle) * rr,
        .58 + (.16 + seeded() * .54) * mm, .20 * mm, (.45 + seeded() * .42) * mm, .08 * mm,
        .38 + seeded() * .66, .05 + seeded() * .2, angle);
    }
    return;
  }
  if (item.kind === 'table') {
    box(m.basalt, 0, 0, .189, w - .17, .362, d - .16);
    box(m[item.style], 0, 0, .385, w, .098, d);
    form('cylinder', m.brass, 0, -.05, .44, Math.min(w, .42), .024, Math.min(d, .42));
    for (let i = 0; i < 3; i++) form('cylinder', m.linen, (i - 1) * .125, -.04, .502, .077, .102, .074);
    for (let i = 0; i < item.lamps; i++) {
      const u = (i + .5) * w / item.lamps - w / 2;
      const ceiling = architecture.ceiling - Math.abs(x + u * cos) * architecture.pitch;
      const bottom = 2.38 + Math.abs(i - (item.lamps - 1) / 2) * .15;
      form('cylinder', m.trim, u, 0, (ceiling + bottom) / 2, .012, ceiling - bottom, .012);
      form('leaf', m.brass, u, 0, bottom, .59, .33, .59);
      form('cylinder', m.warm, u, 0, bottom - .125, .38, .052, .38);
    }
    return;
  }
  if (item.kind === 'hearth') {
    box(m.basalt, 0, 0, .27, w, .54, d);
    box(m.ink, 0, d * .31, .559, w - .35, .35, d * .38);
    box(m.brass, 0, 0, .48, w - .18, .042, d + .012);
    for (let i = 0; i < 11; i++) {
      const u = (i / 11 - .5) * (w - .61);
      form('rock', m.amber, u, d * .12 + (seeded() - .5) * d * .22, .55 + seeded() * .115,
        .163 + seeded() * .081, .06 + seeded() * .04, .102, .21, seeded() * .75);
    }
    return;
  }
  if (item.kind === 'heater') {
    const mm = Math.min(w, d);
    form('cylinder', m.ink, 0, 0, .49, mm * .86, .98, mm * .86);
    form('cylinder', m.brass, 0, 0, .79, mm, .055, mm);
    form('cylinder', m.ink, 0, 0, 1.01, mm, .082, mm);
    const stones = 14;
    for (let i = 0; i < stones; i++) {
      const angle = i * 2.4, radius = Math.sqrt(i / stones) * mm * .37;
      form('rock', i % 4 === 2 ? m.darkStone : m.basalt, Math.sin(angle) * radius, Math.cos(angle) * radius,
        1.08 + seeded() * mm * .09, mm * (.16 + seeded() * .09), mm * (.106 + seeded() * .09), mm * .2,
        .39, seeded(), angle);
    }
  }
}

function softTexture(T, size, alpha) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (x + y * size) * 4;
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(255 * alpha(u, v));
  }
  const tex = new T.DataTexture(pixels, size, size);
  tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function contactShadows(T, scene, own, layout) {
  const map = own(softTexture(T, 32, (u, v) => Math.max(0, 1 - u * u - v * v) ** 2));
  const contact = own(new T.MeshBasicMaterial({ color: '#201514', map, transparent: true, opacity: .23, depthWrite: false }));
  const geo = own(new T.PlaneGeometry(1, 1).rotateX(HORIZONTAL));
  const shade = own(new T.InstancedMesh(geo, contact, layout.furniture.length));
  const t = new T.Object3D();
  layout.furniture.forEach((f, i) => {
    t.position.set(f.at[0], .027, f.at[1]); t.scale.set(f.size[0] + .76, 1, f.size[1] + .58);
    t.rotation.y = f.yaw; t.updateMatrix(); shade.setMatrixAt(i, t.matrix);
  });
  shade.instanceMatrix.needsUpdate = true;
  scene.add(shade);
}

function makeSteam(T, scene, own, layout, eco) {
  const map = own(softTexture(T, 64, (u, v) => {
    const edge = Math.max(0, 1 - u * u - v * v);
    return edge ** 2.8 * (.73 + .14 * Math.sin(u * 7.7 + v * 5.4) + .13 * Math.cos(v * 8.6 - u * 5.7));
  }));
  const all = [], limit = eco ? 3 : 5;
  for (const item of layout.furniture.filter(f => f.kind === 'heater')) {
    for (let n = 0; n < limit; n++) {
      const mat = own(new T.SpriteMaterial({
        color: item.style === 'brass' ? '#ffe1bb' : '#bedbdc',
        map, opacity: .25, transparent: true, depthWrite: false, fog: false,
      }));
      const sprite = new T.Sprite(mat);
      sprite.position.set(item.at[0], 1.22, item.at[1]); sprite.renderOrder = 2;
      scene.add(sprite);
      all.push({ sprite, mat, x: item.at[0], z: item.at[1], shift: n / limit });
    }
  }
  return (time, camera) => {
    for (const { sprite, mat, x, z, shift } of all) {
      sprite.visible = !camera || Math.hypot(camera.position.x - x, camera.position.z - z) < 16;
      const phase = (time * .113 + shift) % 1;
      sprite.position.set(x + Math.sin(phase * 5 + shift) * (.13 + .62 * phase),
        1.08 + phase * 1.69, z + phase * .56 + Math.cos(phase * 8 + shift * 2) * .18);
      sprite.scale.set(.42 + phase * 2.12, .57 + phase * 1.07, 1);
      mat.rotation = .06 * Math.cos(phase * 5);
      mat.opacity = Math.sin(Math.PI * phase) ** 1.55 * (eco ? .17 : .214);
    }
  };
}

function distantSilhouettes(T, scene, own, vista) {
  const material = own(new T.MeshBasicMaterial({ color: '#4d5e72', side: T.DoubleSide }));
  const verts = [];
  const peaks = [.16, .24, .19, .47, .62, .50, .36, .64, .78, .61, .52, .3, .61, .42, .52, .3, .1];
  for (let i = 0; i < peaks.length - 1; i++) {
    const x = vista.width * (i / (peaks.length - 1) - .5);
    const next = x + vista.width / (peaks.length - 1);
    const low = vista.y - vista.height / 2, a = low + vista.height * peaks[i], b = low + vista.height * peaks[i + 1];
    verts.push(x, low, 0, x, a, 0, next, low, 0, next, low, 0, x, a, 0, next, b, 0);
  }
  const geometry = own(new T.BufferGeometry());
  geometry.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
  const fallback = new T.Mesh(geometry, material);
  fallback.position.z = vista.z;
  scene.add(fallback);
  return fallback;
}

function pictureBackdrop(T, panorama, vista, sky, own) {
  const material = own(new T.ShaderMaterial({
    uniforms: {
      uPhoto: { value: panorama },
      uSize: { value: new T.Vector2(vista.width, vista.height) },
      uSky: { value: sky },
      uForest: { value: new T.Color('#182c37') },
      uTint: { value: new T.Color('#e8ebef') },
    },
    vertexShader: `
      varying vec2 vPosition;
      void main() {
        vPosition = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `
      varying vec2 vPosition;
      uniform sampler2D uPhoto;
      uniform vec2 uSize;
      uniform vec3 uSky, uForest, uTint;
      void main() {
        vec2 uv = vPosition / uSize + .5;
        float horizon = smoothstep(.07, .72, uv.y);
        vec3 haze = mix(uForest, uSky, horizon);
        vec2 at = clamp(min(abs(uv), vec2(2.) - abs(uv)), vec2(.001), vec2(.999));
        vec3 picture = texture2D(uPhoto, at).rgb * uTint;
        float xFade = smoothstep(-.28, .075, uv.x) * (1. - smoothstep(.925, 1.28, uv.x));
        float yFade = smoothstep(-.25, .08, uv.y) * (1. - smoothstep(.95, 1.28, uv.y));
        gl_FragColor = vec4(mix(haze, picture, xFade * yFade), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  const geometry = own(new T.PlaneGeometry(vista.width * 3.6, vista.height * 6));
  return new T.Mesh(geometry, material);
}

function seedFloat(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function createSaunaScene({ THREE: T, config, layout = createSaunaLayout(config),
  quality = 'eco', seed, onAssetReady }) {
  const owned = new Set(), own = thing => { owned.add(thing); return thing; };
  let disposed = false;
  const scene = new T.Scene();
  scene.name = 'Тихий перевал · badstue';
  scene.background = new T.Color('#8298b5');
  const m = saunaFinishes(T, Number(seed) || 0);
  for (const value of Object.values(m)) {
    for (const resource of Array.isArray(value) ? value : [value]) own(resource);
  }
  const eco = quality === 'eco' || quality === 'low';
  const batch = batchScene(T, scene, own), seeded = seedFloat(seed);
  const fill = new T.HemisphereLight('#e1eaff', '#a17b5e', 1.62);
  const skyLight = new T.DirectionalLight('#c2dfff', .93);
  skyLight.position.set(-3, 8, -19);
  const warmLight = new T.DirectionalLight('#ffcf9d', .57);
  warmLight.position.set(-12, 4.8, 8.8);
  scene.add(fill, skyLight, warmLight);
  addRoomLights(T, scene, layout);
  floorDeck(T, scene, own, layout.bounds, layout.pools, m.floor);
  shell(layout, batch, m);
  for (const wall of layout.walls) buildWall(wall, batch, m);
  zoneFinishes(T, scene, own, layout, batch, m);
  for (const furniture of layout.furniture) addFurniture(furniture, batch, m, seeded, layout.architecture);

  const authoredVista = layout.architecture.vista;
  const vista = { ...authoredVista, z: layout.bounds[1] - authoredVista.distance,
    height: authoredVista.width / authoredVista.aspect };
  const fallback = distantSilhouettes(T, scene, own, vista);
  const panorama = own(new T.TextureLoader().load(MOUNTAINS.href, () => {
    if (disposed) { panorama.dispose(); return; }
    picture.visible = true;
    fallback.visible = false;
    for (const water of waters) water.uniforms.uPhoto.value = 1;
    onAssetReady?.();
  }, undefined, () => { if (!disposed) onAssetReady?.(); }));
  panorama.colorSpace = T.SRGBColorSpace;
  panorama.anisotropy = 4;
  const picture = pictureBackdrop(T, panorama, vista, scene.background, own);
  picture.position.set(0, vista.y, vista.z);
  picture.visible = false;
  picture.name = 'Dolomites panorama';
  scene.add(picture);

  const waters = layout.pools.map(pool => {
    basin(pool, batch, m);
    const water = saunaWater(T, pool, layout.architecture, vista, panorama, eco);
    scene.add(water.mesh); own(water.material); own(water.geometry);
    return { ...water, pool };
  });
  batch.flush();
  contactShadows(T, scene, own, layout);
  const steam = makeSteam(T, scene, own, layout, eco);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let time = 0;
  function update(dt = 0, camera, players = []) {
    if (disposed) return;
    time += Math.max(0, Math.min(.08, dt)) * (reduced ? .48 : 1);
    steam(time, camera);
    for (const { uniforms, pool } of waters) {
      uniforms.uTime.value = time;
      const ripples = uniforms.uRipple.value;
      let count = 0;
      for (const player of players) {
        if (count >= ripples.length) break;
        if (!(player.swimming || player.pose === 'wade') || !isInside(player.x, player.z, pool.rect)) continue;
        ripples[count++].set(player.x, player.z, Math.min(.86, .22 + (Number(player.speed) || 0) * .26), 0);
      }
      for (; count < ripples.length; count++) ripples[count].set(0, 0, 0, 0);
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.clear();
    for (const resource of owned) resource.dispose();
    owned.clear();
  }
  return { scene, update, dispose, far: FAR };
}

function addRoomLights(T, scene, layout) {
  // Local lights are limited to signature pools of light. Emissive strips
  // supply the rest of the lighting cues without extra per-pixel lights.
  for (const zone of layout.zones) {
    const [x, z, w, d] = center(zone.rect);
    if (zone.style === 'cedar') {
      const tan = new T.PointLight('#ffb065', 35, 8.8, 2);
      tan.position.set(x + w * .18, 2.23, z - d * .22); scene.add(tan);
    } else if (zone.style === 'lounge') {
      const tan = new T.PointLight('#ffbd8e', 42, 10, 2);
      tan.position.set(x - w * .12, 2.7, z); scene.add(tan);
    } else if (zone.style === 'basalt') {
      const blue = new T.PointLight('#94bfca', 28, 7.8, 2);
      blue.position.set(x, 2.32, z + .6); scene.add(blue);
    }
  }
}
