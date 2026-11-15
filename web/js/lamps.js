// Светильники: варианты для панели, геометрия и настоящий свет с тенями.
// three r169: свет в физических единицах (точечный и прожектор — кандела, RectAreaLight — нит,
// Hemisphere — люкс). Паспорта ламп ниже в реальных люменах; NIGHT_SCALE переводит их в масштаб сцены.
// Оси как в model.js: X вдоль оконной стены, Z вглубь квартиры, Y вверх, метры.
//
//   const lamps = buildLamps(plan, kit, state, M, island)  — { group, fixtures, lights, above, update(state, mode), dispose() }
//
// Состав источников, которые видит three, постоянный при любом выборе в панели: three собирает шейдер каждого
// материала под число источников, и смена этого числа — пересборка всей сцены (на этой квартире 10–30 с).
// Поэтому светильники без тени живут на слое SHADER_LAMP_LAYER и считаются циклом lighting.js, а с тенью — это
// постоянный набор из SHADOW_BUDGET прожекторов (POOL), которым новая раскладка только меняет место и конус.
// Выключенный светит с интенсивностью 0, а не прячется (visible тоже меняет счёт).
import * as THREE from 'three';
import { SHADER_LAMP_LAYER } from './lighting.js';

// ---------- варианты (id идут в код варианта по номеру: новые только в конец) ----------

const CEILING = [
  { id: 'plafond', name: 'Плафон' },
  { id: 'spots',   name: 'Точечные' },
  { id: 'track',   name: 'Трек' },
  { id: 'linear',  name: 'Линии' },
  { id: 'none',    name: 'Нет' },
];
export const LAMP_OPTIONS = {
  ceilingKitchen: CEILING,
  ceilingLiving:  CEILING,
  ceilingHall:    CEILING,
  ceilingRoom2:   CEILING,
  ceilingRoom3:   CEILING,
  // первые три совпадают с прежним OPTIONS.pendants (код v2 читается без изменений)
  pendants: [
    { id: 'off',    name: 'Нет' },
    { id: 'dome',   name: 'Купола' },
    { id: 'globe',  name: 'Шары' },
    { id: 'linear', name: 'Линейный' },
    { id: 'cone',   name: 'Конусы' },
  ],
  plinthLed:  [ { id: 'off', name: 'Нет' }, { id: 'on', name: 'Есть' } ],
  lampTemp:   [ { id: 'k2700', name: '2700 K' }, { id: 'k3000', name: '3000 K' }, { id: 'k4000', name: '4000 K' } ],
  lampsOn:    [ { id: 'auto', name: 'Вечером' }, { id: 'on', name: 'Включены' }, { id: 'off', name: 'Выключены' } ],
  lampFinish: [ { id: 'white', name: 'Белые' }, { id: 'black', name: 'Чёрные' } ],
};
export const LAMP_DEFAULTS = {
  ceilingKitchen: 'spots', ceilingLiving: 'spots', ceilingHall: 'spots',
  plinthLed: 'off', lampTemp: 'k3000', lampsOn: 'auto', lampFinish: 'white', lampDim: 0.8,
};
// Новые поля для кода варианта, в этом порядке (pendants уже есть в v2). lampDim — проценты.
const ids = list => list.map(o => o.id);
export const LAMP_SCHEMA = [
  ...['ceilingKitchen', 'ceilingLiving', 'ceilingHall', 'plinthLed', 'lampTemp', 'lampsOn', 'lampFinish']
    .map(k => [k, ids(LAMP_OPTIONS[k])]),
  ['lampDim', 'pct'],
];
// Комнаты 2 и 3 (добавлены позже): отдельный хвост кода варианта, порядок LAMP_SCHEMA не трогается.
export const LAMP_SCHEMA_ROOMS = ['ceilingRoom2', 'ceilingRoom3'].map(k => [k, ids(LAMP_OPTIONS[k])]);
export const LAMP_ROOM_DEFAULTS = { ceilingRoom2: 'plafond', ceilingRoom3: 'plafond' };
export const DIM = { min: 0.1, max: 1 };

// ---------- фотометрия ----------

// Сцена не откалибрована абсолютно (солнце 3.2 лк) и не считает переотражения, поэтому реальные
// величины умножаются на один общий коэффициент. Подбирать яркость вечера здесь, а не по лампам.
export const NIGHT_SCALE = 0.025;
// Адаптация глаза: днём при окнах те же лампы заметны слабее.
const MODE_GAIN = { day: 0.45, overcast: 0.6, evening: 1 };
// Баланс белого «камеры»: 2700 K выглядит тёплым, но не оранжевым (как ночной интерьерный кадр).
const WHITE_BALANCE_K = 4800;
const TEMP_K = { k2700: 2700, k3000: 3000, k4000: 4000 };
// Переотражения: формула интегрирующей сферы E = ρΦ / (A(1−ρ)), ρ — средний коэффициент отражения.
const RHO = 0.45;
// Тени: только самые заметные источники. Бюджет — по текстурным блокам шейдера (WebGL2 гарантирует 16):
// 5 карт материала (GLB мебели: цвет, нормали, шероховатость, металл, AO) + окружение + 2 текстуры зон
// (lighting.js) + 2 таблицы RectAreaLight + тень солнца = 11, на светильники остаётся 5. Больше — шейдер
// тяжёлых материалов не собирается. Точечный свет с тенью — 6 проходов и блок, поэтому тени только у прожекторов.
const SHADOW_BUDGET = 5, SHADOW_MAP = 1024;

// Прожекторы с тенью — постоянный набор, общий для всех сборок: места под тени раскладки; свободный
// светит с интенсивностью 0 и не перерисовывает тень.
const POOL = { group: null, spots: [] };
function shadowPool() {
  if (POOL.group) return POOL;
  POOL.group = new THREE.Group(); POOL.group.name = 'lamp_shadow_pool';
  for (let i = 0; i < SHADOW_BUDGET; i++) {
    const l = new THREE.SpotLight(0xffffff, 0, 0, Math.PI / 4, 0, 2);
    l.castShadow = true;
    l.shadow.autoUpdate = false;
    l.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.shadow.camera.near = 0.05;
    l.shadow.camera.far = 8;
    l.shadow.camera.layers.enableAll();   // скрытые вырезом стены тоже дают тень
    POOL.spots.push(l);
    POOL.group.add(l, l.target);
  }
  return POOL;
}

// Паспорта светильников (реальные изделия этого класса).
const SPEC = {
  downlight: { lm: 550, beam: 50, eff: 0.9 },        // 7 Вт, рамка Ø8.5 см
  track:     { lm: 900, beam: 36, eff: 0.9 },        // 10 Вт трековый прожектор
  plafond:   { lm: 1800 },                           // 22 Вт накладной Ø32 см, ламбертовский
  line:      { lmPerM: 1000, w: 0.04 },              // встроенный профиль 4 см
  dome:      { lm: 800, beam: 100, eff: 0.75 },      // лампа 800 лм, абажур отдаёт вниз ~75 %
  cone:      { lm: 600, beam: 70, eff: 0.85 },
  globe:     { lm: 800, eff: 0.8 },                  // опаловое стекло пропускает ~80 %
  bar:       { lmPerM: 2000, w: 0.035 },             // линейный подвес, свет вниз
  strip:     { lmPerM: 300, w: 0.01 },               // лента 4.8 Вт/м
};
// Яркость светящихся деталей при 100 % (без засветки до бесконечности, если позже добавят bloom).
const GLOW = { diffuser: 6, bulb: 14, opal: 2.2, reflector: 0.6, led: 5 };
const FINISH = {
  white: { color: '#f3f2ef', rough: 0.45, metal: 0 },
  black: { color: '#1b1b1c', rough: 0.5, metal: 0.15 },
};

// Цвет излучения по температуре: локус Планка (Kim et al. 2002) → XYZ → линейный sRGB,
// деление на белую точку WHITE_BALANCE_K (фон Крис), нормировка по яркости Y = 1.
function planckXY(T) {
  const x = T <= 4000
    ? -0.2661239e9 / T ** 3 - 0.2343589e6 / T ** 2 + 0.8776956e3 / T + 0.179910
    : -3.0258469e9 / T ** 3 + 2.1070379e6 / T ** 2 + 0.2226347e3 / T + 0.240390;
  const y = T <= 2222 ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    : T <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
    : 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}
function kelvinLinear(T) {
  const [x, y] = planckXY(T), X = x / y, Z = (1 - x - y) / y;
  return [
    3.2404542 * X - 1.5371385 - 0.4985314 * Z,
    -0.9692660 * X + 1.8760108 + 0.0415560 * Z,
    0.0556434 * X - 0.2040259 + 1.0572252 * Z,
  ];
}
export function kelvinColor(T, target = new THREE.Color()) {
  const c = kelvinLinear(T), w = kelvinLinear(WHITE_BALANCE_K);
  const r = Math.max(0, c[0] / w[0]), g = Math.max(0, c[1] / w[1]), b = Math.max(0, c[2] / w[2]);
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return target.setRGB(r / Y, g / Y, b / Y, THREE.LinearSRGBColorSpace);
}

const rad = THREE.MathUtils.degToRad;
// Прожектор: angle — край поля (полуугол), полутень мягко гасит край; кандела по фактическому телесному углу.
function spotOptics({ beam, lm, eff }) {
  const angle = Math.min(rad(beam / 2) * 1.3, Math.PI / 2 * 0.98), penumbra = 0.45;
  const th = angle * (1 - penumbra / 2);
  return { angle, penumbra, cd: lm * eff / (2 * Math.PI * (1 - Math.cos(th))) };
}

// ---------- материалы (общие на все пересборки, имена идут в GLB) ----------

let MAT = null;
function mats() {
  if (MAT) return MAT;
  const std = (name, o) => Object.assign(new THREE.MeshStandardMaterial(o), { name });
  MAT = {
    housing:   std('lamp_housing', { color: FINISH.white.color, roughness: FINISH.white.rough }),
    diffuser:  std('lamp_diffuser', { color: '#fbfaf6', roughness: 0.3, emissive: '#ffffff', emissiveIntensity: 0 }),
    bulb:      std('lamp_bulb', { color: '#fff8ec', roughness: 0.2, emissive: '#ffffff', emissiveIntensity: 0 }),
    reflector: std('lamp_reflector', { color: '#f4f1ea', roughness: 0.4, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0 }),
    led:       std('lamp_led', { color: '#fdfcf8', roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0 }),
    opal: Object.assign(new THREE.MeshPhysicalMaterial({ color: '#f7f4ee', roughness: 0.35, sheen: 0.2, emissive: '#ffffff', emissiveIntensity: 0 }), { name: 'lamp_opal' }),
  };
  return MAT;
}

// ---------- сборка ----------

// Геометрия деталей общая на все пересборки (одинаковые размеры — один буфер на GPU) и не освобождается:
// смена светильников не грузит заново то, что уже было на видеокарте.
const GEO = new Map();
function geo(Kind, ...args) {
  const k = Kind.name + JSON.stringify(args);
  let g = GEO.get(k);
  if (!g) { g = new Kind(...args); GEO.set(k, g); }
  return g;
}

// Прямоугольники зон. Кухня — до острова плюс 40 см, гостиная — дальше; холл — две самые большие части.
function zonesOf(plan, island) {
  const kl = plan.rooms.kitchen_living;
  const main = kl.rects.reduce((a, b) => (area(b) > area(a) ? b : a));
  const kx = island.x1 + 0.4;
  const hall = [...plan.rooms.hall.rects].sort((a, b) => area(b) - area(a)).filter(r => area(r) > 1);
  return {
    kitchen: [{ x0: main.x0, x1: kx, z0: main.z0, z1: main.z1 }],
    living:  [{ x0: kx, x1: kl.x1, z0: kl.z0 ?? main.z0, z1: kl.z1 ?? main.z1 }],
    hall,
    room2: roomRects(plan, 'room2'),
    room3: roomRects(plan, 'room3'),
  };
}
const roomRects = (plan, id) => [...(plan.rooms[id]?.rects ?? [])].sort((a, b) => area(b) - area(a));
const area = r => (r.x1 - r.x0) * (r.z1 - r.z0);
const centre = r => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
const inside = (r, p) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;
// Равномерная сетка: число рядов по шагу, крайние на отступе margin от стен.
function axisSteps(a0, a1, margin, step) {
  const L = a1 - a0, n = Math.max(1, Math.round((L - 2 * margin) / step) + 1);
  return n === 1 ? [(a0 + a1) / 2] : Array.from({ length: n }, (_, i) => a0 + margin + i * (L - 2 * margin) / (n - 1));
}
const grid = (r, margin, step) => axisSteps(r.x0, r.x1, margin, step).flatMap(x => axisSteps(r.z0, r.z1, margin, step).map(z => ({ x, z })));

/**
 * Светильники квартиры.
 * @param plan   plan.generated.json
 * @param kit    kitchen.json
 * @param state  состояние (поля LAMP_OPTIONS, pendants, lampDim, fridge)
 * @param M      материалы сцены: берутся M.lampShade (цвет по металлу) и M.cord
 * @param island { x0, x1, z0, z1 } из model.islandBox
 * @returns { group, fixtures, lights, above, update(state, mode), dispose() }
 */
export function buildLamps(plan, kit, state, M, island) {
  const H = plan.ceiling, mat = mats();
  const shade = M.lampShade ?? mat.housing, cord = M.cord ?? mat.housing;
  const group = new THREE.Group(); group.name = 'lamps';
  const fixtures = new THREE.Group(); fixtures.name = 'lamp_fixtures';
  const lightsGroup = new THREE.Group(); lightsGroup.name = 'lamp_lights';
  group.add(fixtures, lightsGroup);
  const entries = [];   // { light, base } — base в реальных единицах (кд, нит, лк)
  const above = [];
  let totalLm = 0;

  // --- меши
  const mesh = (geo, material, name, parent, { cast = false, ceil = false } = {}) => {
    const m = new THREE.Mesh(geo, material);
    m.name = name; m.castShadow = cast; m.receiveShadow = cast;
    m.userData.slot = 'lamps';
    if (ceil) { m.userData.cut = 'above'; above.push(m); }
    parent.add(m);
    return m;
  };
  const disc = (r, h, material, name, parent, y, opts) => {
    const m = mesh(geo(THREE.CylinderGeometry, r, r, h, 40), material, name, parent, opts);
    m.position.y = y; return m;
  };
  const fixture = (name, x, z) => { const f = new THREE.Group(); f.name = name; f.position.set(x, 0, z); fixtures.add(f); return f; };

  // --- свет
  const reg = (light, base, lm, pri, name) => {
    light.name = name;
    if (!light.isHemisphereLight) light.layers.set(SHADER_LAMP_LAYER);
    light.userData = { lm, base, pri };
    lightsGroup.add(light);
    if (light.target) lightsGroup.add(light.target);
    entries.push({ light, base });
    totalLm += lm;
    return light;
  };
  const spot = (spec, pos, target, pri, name) => {
    const o = spotOptics(spec);
    const l = new THREE.SpotLight(0xffffff, 0, 0, o.angle, o.penumbra, 2);
    l.position.copy(pos); l.target.position.copy(target);
    return reg(l, o.cd, spec.lm, pri, name);
  };
  // Ламбертовский излучатель вниз (плафон): полутень 1 до горизонта даёт спад ≈ cos, поток = π·I0.
  const lambertDown = (lm, pos, pri, name) => {
    const l = new THREE.SpotLight(0xffffff, 0, 0, Math.PI / 2 * 0.98, 1, 2);
    l.position.copy(pos); l.target.position.set(pos.x, 0, pos.z);
    return reg(l, lm / Math.PI, lm, pri, name);
  };
  const point = (lm, pos, pri, name) => {
    const l = new THREE.PointLight(0xffffff, 0, 0, 2);
    l.position.copy(pos);
    return reg(l, lm / (4 * Math.PI), lm, pri, name);
  };
  // Светящаяся полоса: RectAreaLight светит вдоль своей −Z; axis — длинная сторона, dir — куда светит.
  const rect = (lm, len, w, pos, dir, axis, name) => {
    const l = new THREE.RectAreaLight(0xffffff, 0, len, w);
    const z = dir.clone().normalize().negate(), x = axis.clone().normalize(), y = new THREE.Vector3().crossVectors(z, x);
    l.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    l.position.copy(pos);
    return reg(l, lm / (Math.PI * len * w), lm, 0, name);
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const DOWN = V(0, -1, 0), AX = V(1, 0, 0), AZ = V(0, 0, 1);

  // --- потолочные типы
  function downlight(name, p, pri) {
    const f = fixture(name, p.x, p.z);
    disc(0.0425, 0.004, mat.housing, `${name}_trim`, f, H - 0.002, { ceil: true });
    disc(0.028, 0.002, mat.diffuser, `${name}_lens`, f, H - 0.0045, { ceil: true });
    spot(SPEC.downlight, V(p.x, H - 0.012, p.z), V(p.x, 0, p.z), pri, name);
  }
  function plafond(name, p, pri) {
    const f = fixture(name, p.x, p.z);
    disc(0.16, 0.045, mat.housing, `${name}_body`, f, H - 0.0225, { ceil: true });
    disc(0.15, 0.006, mat.diffuser, `${name}_diffuser`, f, H - 0.047, { ceil: true });
    lambertDown(SPEC.plafond.lm, V(p.x, H - 0.055, p.z), pri, name);
  }
  // Встроенная линия: светит вниз, вдоль axis ('x' или 'z'), центр c, длина len.
  function line(name, c, axis, len) {
    const f = fixture(name, c.x, c.z), w = SPEC.line.w, alongX = axis === 'x';
    const box = (a, b, h) => geo(THREE.BoxGeometry, alongX ? a : b, h, alongX ? b : a);
    mesh(box(len + 0.02, w + 0.02, 0.003), mat.housing, `${name}_frame`, f, { ceil: true }).position.y = H - 0.0015;
    mesh(box(len, w, 0.002), mat.diffuser, `${name}_diffuser`, f, { ceil: true }).position.y = H - 0.004;
    rect(SPEC.line.lmPerM * len, len, w, V(c.x, H - 0.006, c.z), DOWN, alongX ? AX : AZ, name);
  }
  // Накладной трек с поворотными прожекторами: a → b по оси, aims — точки, куда смотрит каждый.
  function track(name, a, b, aims, pri) {
    const f = fixture(name, 0, 0), alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
    const len = Math.hypot(b.x - a.x, b.z - a.z), rail = 0.035;
    const r = mesh(geo(THREE.BoxGeometry, alongX ? len : rail, rail, alongX ? rail : len), mat.housing, `${name}_rail`, f, { ceil: true });
    r.position.set((a.x + b.x) / 2, H - rail / 2, (a.z + b.z) / 2);
    aims.forEach((aim, i) => {
      const t = aims.length === 1 ? 0.5 : (i + 0.5) / aims.length;
      const pivot = V(a.x + (b.x - a.x) * t, H - rail - 0.05, a.z + (b.z - a.z) * t);
      const dir = aim.clone().sub(pivot).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
      const stem = mesh(geo(THREE.CylinderGeometry, 0.006, 0.006, 0.05, 10), mat.housing, `${name}_stem${i + 1}`, f, { ceil: true });
      stem.position.set(pivot.x, pivot.y + 0.025, pivot.z);
      const head = mesh(geo(THREE.CylinderGeometry, 0.032, 0.032, 0.12, 28), mat.housing, `${name}_head${i + 1}`, f, { ceil: true });
      head.quaternion.copy(q); head.position.copy(pivot).addScaledVector(dir, 0.03);
      const lens = mesh(geo(THREE.CylinderGeometry, 0.026, 0.026, 0.002, 24), mat.diffuser, `${name}_lens${i + 1}`, f, { ceil: true });
      lens.quaternion.copy(q); lens.position.copy(pivot).addScaledVector(dir, 0.09);
      spot(SPEC.track, pivot.clone().addScaledVector(dir, 0.095), aim, pri(i), `${name}_${i + 1}`);
    });
  }

  const Z = zonesOf(plan, island);
  const top = kit.worktop.height, D = kit.run.depth, runZ = kit.run.startZ;
  const icx = (island.x0 + island.x1) / 2, icz = (island.z0 + island.z1) / 2, iL = island.z1 - island.z0;
  const aisleX = (D + island.x0) / 2;
  const outletsIn = rects => plan.ceiling_lights.filter(o => rects.some(r => inside(r, o)));

  function ceiling(zone, kind) {
    const rects = Z[zone], main = rects[0];
    if (!main || kind === 'none') return;
    if (kind === 'plafond') {
      const pts = outletsIn(rects);
      (pts.length ? pts : [centre(main)]).forEach((p, i) => plafond(`plafond_${zone}_${i + 1}`, p, zone === 'kitchen' ? 5 : (zone.startsWith('room') ? 2 : 3)));
      return;
    }
    if (zone === 'kitchen') {
      if (kind === 'spots') {
        // ряд над рабочей зоной (свет перед лицом, а не за спиной) и ряд над островом или проходом
        axisSteps(0, runZ, runZ / 8, 0.7).forEach((z, i) => downlight(`spot_kitchen_run_${i + 1}`, { x: D * 0.7, z }, 4));
        const x2 = state.pendants === 'off' ? icx : aisleX;
        [-1, 0, 1].forEach((k, i) => downlight(`spot_kitchen_${state.pendants === 'off' ? 'island' : 'aisle'}_${i + 1}`, { x: x2, z: icz + k * iL / 3 }, 8));
      } else if (kind === 'track') {
        // трек над проходом: прожекторы через один на остров и на столешницу
        const za = 0.35, zb = runZ - 0.3, n = 4;
        const aims = Array.from({ length: n }, (_, i) => {
          const z = za + (zb - za) * (i + 0.5) / n;
          return i % 2 === 0 ? V(icx, top, THREE.MathUtils.clamp(z, island.z0 + 0.2, island.z1 - 0.2)) : V(D * 0.5, top, z);
        });
        track('track_kitchen', { x: aisleX, z: za }, { x: aisleX, z: zb }, aims, i => (i % 2 === 0 ? 9 : 7));
      } else if (kind === 'linear') {
        line('line_kitchen', { x: aisleX, z: (0.3 + runZ - 0.3) / 2 }, 'z', runZ - 0.6);
      }
      return;
    }
    if (zone === 'living') {
      if (kind === 'spots') grid(main, 0.7, 1.4).forEach((p, i) => downlight(`spot_living_${i + 1}`, p, 3));
      else if (kind === 'track') {
        const zc = outletsIn(rects)[0]?.z ?? centre(main).z;
        const xa = main.x0 + 0.5, xb = main.x1 - 0.6, n = 4;
        const aims = Array.from({ length: n }, (_, i) => V(xa + (xb - xa) * (i + 0.5) / n, 0, zc + (i % 2 ? 1 : -1)));
        track('track_living', { x: xa, z: zc }, { x: xb, z: zc }, aims, () => 5);
      } else if (kind === 'linear') {
        const W = main.x1 - main.x0, zc = centre(main).z, len = main.z1 - main.z0 - 1.2;
        [1, 2].forEach(k => line(`line_living_${k}`, { x: main.x0 + W * k / 3, z: zc }, 'z', len));
      }
      return;
    }
    if (zone === 'room2' || zone === 'room3') {
      // спальня/кабинет: свет по длинной оси комнаты, от стен не ближе 0.6 м
      const W = main.x1 - main.x0, Dz = main.z1 - main.z0, alongX = W >= Dz, c = centre(main);
      const len = (alongX ? W : Dz) - 1.2;
      if (kind === 'spots') grid(main, 0.6, 1.3).forEach((p, i) => downlight(`spot_${zone}_${i + 1}`, p, 1));
      else if (kind === 'track') {
        // трек по центру, прожекторы через один моют длинные стены на высоте 1.3 м (мягкий отражённый свет)
        const a = alongX ? { x: main.x0 + 0.6, z: c.z } : { x: c.x, z: main.z0 + 0.6 };
        const b2 = alongX ? { x: main.x1 - 0.6, z: c.z } : { x: c.x, z: main.z1 - 0.6 };
        const n = THREE.MathUtils.clamp(Math.round(len / 1.0), 3, 4);
        const aims = Array.from({ length: n }, (_, i) => {
          const t = (i + 0.5) / n, side = i % 2 ? 1 : -1;
          return alongX ? V(a.x + (b2.x - a.x) * t, 1.3, side > 0 ? main.z1 - 0.02 : main.z0 + 0.02)
            : V(side > 0 ? main.x1 - 0.02 : main.x0 + 0.02, 1.3, a.z + (b2.z - a.z) * t);
        });
        track(`track_${zone}`, a, b2, aims, () => 2);
      } else if (kind === 'linear') line(`line_${zone}`, c, alongX ? 'x' : 'z', len);
      return;
    }
    // холл: основная часть и коридор к входу
    if (kind === 'spots') rects.flatMap(r => grid(r, 0.6, 1.4)).forEach((p, i) => downlight(`spot_hall_${i + 1}`, p, 1));
    else if (kind === 'track') {
      const zc = centre(main).z, xa = main.x0 + 0.5, xb = main.x1 - 0.5;
      const n = THREE.MathUtils.clamp(Math.round((xb - xa) / 1.2), 3, 4);
      // мягкая заливка стен холла
      const aims = Array.from({ length: n }, (_, i) => V(xa + (xb - xa) * (i + 0.5) / n, 1.3, i % 2 ? main.z1 - 0.02 : main.z0 + 0.02));
      track('track_hall', { x: xa, z: zc }, { x: xb, z: zc }, aims, () => 2);
    } else if (kind === 'linear') {
      line('line_hall', centre(main), 'x', main.x1 - main.x0 - 0.8);
    }
  }
  ceiling('kitchen', state.ceilingKitchen ?? LAMP_DEFAULTS.ceilingKitchen);
  ceiling('living', state.ceilingLiving ?? LAMP_DEFAULTS.ceilingLiving);
  ceiling('hall', state.ceilingHall ?? LAMP_DEFAULTS.ceilingHall);
  ceiling('room2', state.ceilingRoom2 ?? LAMP_ROOM_DEFAULTS.ceilingRoom2);
  ceiling('room3', state.ceilingRoom3 ?? LAMP_ROOM_DEFAULTS.ceilingRoom3);

  // --- подвесы над островом
  const rose = (f, name) => disc(0.05, 0.02, shade, `${name}_rose`, f, H - 0.01, { ceil: true });
  const wire = (f, name, y0, x = 0, z = 0) => {
    const c = mesh(geo(THREE.CylinderGeometry, 0.003, 0.003, H - y0, 6), cord, `${name}_cord`, f);
    c.position.set(x, (H + y0) / 2, z);
  };
  const lathe = (pts, material, name, f, y, cast) => {
    const m = mesh(geo(THREE.LatheGeometry, pts, 48), material, name, f, { cast });
    m.position.y = y; return m;
  };
  const kind = state.pendants;
  if (kind === 'dome') {
    const bottom = 1.62;
    [-0.45, 0.45].forEach((dz, i) => {
      const name = `pendant_dome_${i + 1}`, f = fixture(name, icx, icz + dz);
      const outer = [], inner = [];
      for (let k = 0; k <= 16; k++) {
        const a = (k / 16) * Math.PI / 2;
        outer.push(new THREE.Vector2(Math.sin(a) * 0.19 + 0.004, Math.cos(a) * 0.16));
        inner.push(new THREE.Vector2((Math.sin(a) * 0.19 + 0.004) * 0.96, Math.cos(a) * 0.155));
      }
      lathe(outer, shade, `${name}_shade`, f, bottom, true);
      lathe(inner, mat.reflector, `${name}_reflector`, f, bottom, false);
      mesh(geo(THREE.SphereGeometry, 0.045, 24, 16), mat.bulb, `${name}_bulb`, f).position.y = bottom + 0.04;
      wire(f, name, bottom + 0.16); rose(f, name);
      spot(SPEC.dome, V(icx, bottom + 0.03, icz + dz), V(icx, 0, icz + dz), 10, name);
    });
  } else if (kind === 'globe' || kind === 'cone') {
    [-1, 0, 1].forEach((k, i) => {
      const dz = k * Math.min(0.6, iL / 3), name = `pendant_${kind}_${i + 1}`, f = fixture(name, icx, icz + dz);
      if (kind === 'globe') {
        const bottom = 1.62, r = 0.13;
        const g = mesh(geo(THREE.SphereGeometry, r, 48, 32), mat.opal, `${name}_globe`, f); g.position.y = bottom + r;
        disc(0.03, 0.04, shade, `${name}_cap`, f, bottom + 2 * r + 0.01);
        wire(f, name, bottom + 2 * r + 0.03); rose(f, name);
        point(SPEC.globe.lm * SPEC.globe.eff, V(icx, bottom + r, icz + dz), k === 0 ? 6 : 0, name);
      } else {
        const bottom = 1.65, h = 0.24;
        lathe([new THREE.Vector2(0.012, h), new THREE.Vector2(0.03, h - 0.005), new THREE.Vector2(0.11, 0)], shade, `${name}_shade`, f, bottom, true);
        lathe([new THREE.Vector2(0.028, h - 0.012), new THREE.Vector2(0.105, 0.002)], mat.reflector, `${name}_reflector`, f, bottom, false);
        wire(f, name, bottom + h); rose(f, name);
        spot(SPEC.cone, V(icx, bottom + 0.02, icz + dz), V(icx, 0, icz + dz), 10, name);
      }
    });
  } else if (kind === 'linear') {
    const name = 'pendant_linear', f = fixture(name, icx, icz), bottom = 1.65;
    const len = Math.min(1.2, iL - 0.4), w = SPEC.bar.w;
    const body = mesh(geo(THREE.BoxGeometry, 0.05, 0.04, len), shade, `${name}_body`, f, { cast: true }); body.position.y = bottom + 0.02;
    const dif = mesh(geo(THREE.BoxGeometry, w, 0.003, len - 0.02), mat.diffuser, `${name}_diffuser`, f); dif.position.y = bottom - 0.0015;
    for (const s of [-1, 1]) { wire(f, `${name}_${s > 0 ? 'b' : 'a'}`, bottom + 0.04, 0, s * (len / 2 - 0.1)); }
    for (const s of [-1, 1]) { const rr = disc(0.025, 0.015, shade, `${name}_rose_${s > 0 ? 'b' : 'a'}`, f, H - 0.0075, { ceil: true }); rr.position.z = s * (len / 2 - 0.1); }
    rect(SPEC.bar.lmPerM * len, len, w, V(icx, bottom - 0.004, icz), DOWN, AZ, name);
  }

  // --- подсветка цоколя: под корпусом ряда и острова, светит вниз и наружу на пол
  if (state.plinthLed === 'on') {
    const ph = kit.plinth.height, pr = kit.plinth.recess, y = ph - 0.003;
    const strip = (name, a, b, fixed, along, out) => {
      const len = b - a; if (len < 0.1) return;
      const c = along === 'z' ? { x: fixed, z: (a + b) / 2 } : { x: (a + b) / 2, z: fixed };
      const f = fixture(name, c.x, c.z);
      const g = mesh(geo(THREE.BoxGeometry, along === 'z' ? 0.012 : len, 0.004, along === 'z' ? len : 0.012), mat.led, `${name}_led`, f);
      g.position.y = y;
      rect(SPEC.strip.lmPerM * len, len, SPEC.strip.w, V(c.x, y - 0.003, c.z), V(out.x * 0.6, -1, out.z * 0.6), along === 'z' ? AZ : AX, name);
    };
    // ряд вдоль стены; в нише отдельностоящего холодильника цоколя нет
    let z = runZ, gaps = [];
    for (const m of kit.run.modules) { if (m.fridge && state.fridge === 'under-free') gaps.push([z - m.w, z]); z -= m.w; }
    let spans = [[0, runZ]];
    for (const [g0, g1] of gaps) spans = spans.flatMap(([a, b]) => [[a, Math.min(b, g0)], [Math.max(a, g1), b]]).filter(([a, b]) => b - a > 0.1);
    spans.forEach(([a, b], i) => strip(`plinth_led_run_${i + 1}`, a, b, D - pr + 0.012, 'z', { x: 1, z: 0 }));
    // остров: со стороны кухни и с торцов (со стороны гостиной панель до пола)
    const { x0, x1, z0, z1 } = island;
    strip('plinth_led_island', z0 + pr, z1 - pr, x0 + pr - 0.012, 'z', { x: -1, z: 0 });
    strip('plinth_led_island_end_a', x0 + pr, x1 - 0.02, z0 + pr - 0.012, 'x', { x: 0, z: -1 });
    strip('plinth_led_island_end_b', x0 + pr, x1 - 0.02, z1 - pr + 0.012, 'x', { x: 0, z: 1 });
  }

  // --- переотражения: заливка от стен и потолка по формуле интегрирующей сферы
  const rooms = [plan.rooms.kitchen_living, plan.rooms.hall, plan.rooms.room2, plan.rooms.room3].filter(Boolean).flatMap(r => r.rects);
  const F = rooms.reduce((s, r) => s + area(r), 0), A = 2 * F + 4 * Math.sqrt(F) * H;
  const bounce = new THREE.HemisphereLight(0xffffff, 0xffffff, 0);
  reg(bounce, RHO * totalLm / (A * (1 - RHO)), 0, 0, 'lamp_bounce');   // и без светильников: состав постоянный
  // заливка-обманка: lighting.js гасит её, когда считает настоящие переотражения; в фото не идёт
  Object.assign(bounce.userData, { giFill: true, rasterOnly: true });

  // --- тени: самые важные источники в пределах бюджета. Группа одного приоритета (ряд спотов,
  // пара подвесов) получает тени целиком или не получает: иначе один спот из ряда выглядел бы иначе.
  // Выбранный прожектор передаёт место, конус и паспорт прожектору из POOL и уходит из сцены.
  const pool = shadowPool();
  group.add(pool.group);
  let used = 0;
  const byPri = new Map();
  for (const e of entries) {
    const pri = e.light.userData.pri;
    if (pri > 0 && (e.light.isSpotLight || e.light.isPointLight)) byPri.set(pri, [...(byPri.get(pri) || []), e]);
  }
  for (const [, es] of [...byPri].sort((a, b) => b[0] - a[0])) {
    if (used + es.length > SHADOW_BUDGET || es.some(e => e.light.isPointLight)) continue;
    for (const e of es) {
      const l = e.light, p = pool.spots[used++];
      p.name = l.name; p.userData = l.userData;
      p.position.copy(l.position); p.target.position.copy(l.target.position);
      p.angle = l.angle; p.penumbra = l.penumbra; p.distance = l.distance; p.decay = l.decay;
      p.shadow.focus = l.angle > 1 ? 0.8 : 1;
      lightsGroup.remove(l, l.target);
      e.light = p;
    }
  }
  for (const p of pool.spots.slice(used)) {
    p.name = 'lamp_spare'; p.userData = { lm: 0, base: 0, pri: 0 };
    entries.push({ light: p, base: 0 });
  }

  const color = new THREE.Color();
  function update(s, mode = s.light) {
    const on = s.lampsOn === 'on' || (s.lampsOn !== 'off' && mode === 'evening');
    const dim = THREE.MathUtils.clamp(s.lampDim ?? LAMP_DEFAULTS.lampDim, DIM.min, DIM.max);
    const gain = on ? dim * (MODE_GAIN[mode] ?? 1) : 0;
    kelvinColor(TEMP_K[s.lampTemp] ?? 3000, color);
    for (const { light, base } of entries) {
      light.intensity = base * NIGHT_SCALE * gain;
      if (light.castShadow) light.shadow.autoUpdate = light.intensity > 0;   // погасший не перерисовывает тень
      light.color.copy(color);
      if (light.isHemisphereLight) light.groundColor.copy(color).multiplyScalar(0.55);
    }
    for (const [k, g] of Object.entries(GLOW)) { mat[k].emissive.copy(color); mat[k].emissiveIntensity = g * gain; }
    const fin = FINISH[s.lampFinish] || FINISH.white;
    mat.housing.color.set(fin.color); mat.housing.roughness = fin.rough; mat.housing.metalness = fin.metal;
  }
  // геометрия общая (GEO), прожекторы с тенью — общие (POOL): отцепить их от этой сборки, карт теней своих нет
  function dispose() {
    if (pool.group.parent === group) group.remove(pool.group);
  }
  update(state);
  return { group, fixtures, lights: entries.filter(e => e.base > 0).map(e => e.light), above, update, dispose };
}
