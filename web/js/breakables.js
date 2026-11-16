// Что бьётся от выстрела в прогулке: посуда, банки, вазы, фрукты (обстановка), стёкла окон и дверей, душевое стекло.
// Зовёт impacts.js на каждое попадание. Разбитое — только в сеансе (в код варианта не входит): «Убрать следы и осколки»
// во вкладке «Прогулка» → «Оружие» или перезагрузка возвращают всё целым.
//
// Что бьётся — данные, а не имена в коде:
//   - web/spec/break.json → models["<путь GLB обстановки>"].break: "glass" | "ceramic" | "fruit" — вся модель, или
//     { "*": тип, "<начало имени узла>": тип | null } — по узлам модели (яблоко — фрукт, ваза под ним — стекло,
//     null — не бьётся). Тип — свойство самой вещи, поэтому ключ — модель: где бы она ни стояла, бьётся одинаково.
//     Там же models[…].mirror — зеркала обстановки (их ведёт mirrors.js). Файл грузится после первого вида.
//   - userData.breakable = тип на любом объекте сцены (свои модули): бьётся этот объект целиком.
//   - userData.glass (стекло окон, балконной двери, душа): разлетается на куски, рама остаётся; часть кусков держится
//     в раме, следующая пуля выбивает и их. userData.shatter = false — стекло не бьётся (пуля проходит, как раньше).
// Кусок попадания — узел модели (прямой ребёнок корня GLB): одно яблоко из вазы, одна кружка из пары.
//
// createBreakables({ THREE, scene, camera, pipe, requestRender, getSound, burst })
//   getSound() -> bool — звук включён (тумблер «Звук выстрела»); burst(point, normal, dir, surf) — брызги impacts.js
//   -> { breakAt(hit, dir, surf) -> bool   разбить вещь под попаданием (true — разбилась, след не нужен; surf.albedo — цвет сока),
//        shatterPane(hit, dir) -> bool  стекло на пути пули (пуля летит дальше),
//        update(dt) -> bool  true, пока летят осколки (в покое — false, ноль работы); куски ложатся на пол и полки, от стен отскакивают,
//        restore()  всё целое, осколки убраны (и зеркала: onRestore), broken — сколько разбито, dispose() }
// Для зеркал (mirrors.js) и чужих модулей:
//   shotHandlers — WeakMap меш -> (hit, dir, api) => bool: свой обработчик попадания (true — пуля остановлена, без следа);
//     api = { slabShards, sound, burst } экземпляра; onRestore(fn) — позвать fn при «вернуть всё»; breakSpec() — Promise spec.
//   voronoiCells(w, h, seeds, clip?) — выпуклые ячейки Вороного прямоугольника [-w/2, w/2] × [-h/2, h/2] (clip — свой
//     выпуклый контур, например круг зеркала).
//
// Осколки: куски самой геометрии (треугольники делятся по ближайшей из K точек — «ячейки» без внутренних граней),
// у стёкол — пластинки Вороного толщиной со стекло; материал — исходный (почти прозрачное стекло — «битое стекло»,
// новых шейдеров нет). Физика простая: тяжесть, отскок от пола, столешницы, полки (луч вниз по ближним мешам, только
// пологие и видимые; заново — когда кусок сдвинулся), от стен — отскок (отрезок пути тем же лучом); лежат до «вернуть
// всё»; больше LIMIT[качество] — старые убираются. Тень не отбрасывают (карта теней не перерисовывается).
// slabShards({ …, exclude }) — exclude: своя рама (зеркала), кускам не опора.
// Звук синтезируется (WebAudio): стекло — звон, керамика — хруст, фрукт — шлепок; звяк при падении кусков.
import { afterRoom, retry } from './loading.js';
import { decorPart } from './decor.js';
import { loosePropMaterial, stableObjectId, indexNetworkObjects, seededRandom } from './network-objects.js';

const BR = {
  cells: { glass: 14, ceramic: 10, fruit: 7, paper: 12, cloth: 8, wood: 11, plastic: 10, foliage: 14, metal: 7 },
  pane: { seeds: 22, hole: 0.22, extra: 0.25 },  // стекло: точек Вороного, радиус выбитого вокруг пули (м), доля выпавших дальше
  maxTris: 40000,       // вещь тяжелее — просто исчезает с брызгами
  gravity: 9.8,
  bounce: 0.28,
  rest: 0.22,           // м/с: медленнее — кусок лёг
  probe: 0.08,          // м: сдвинулся дальше — заново искать опору под ним
  near: 3,              // м: опоры ищутся среди мешей ближе этого к месту поломки
};
const LIMIT = { eco: 120, fast: 180, high: 300, ultra: 400 };

export const shotHandlers = new WeakMap();
export const networkDamageResetters = new WeakMap();
const restoreHooks = new Set();
export const onRestore = fn => { restoreHooks.add(fn); return () => restoreHooks.delete(fn); };

let specP = null, SPEC = null;
export function breakSpec() {
  specP ??= afterRoom(() => retry(() => fetch('spec/break.json').then(r => (r.ok ? r.json() : {}))))
    .catch(() => ({})).then(s => (SPEC = s?.models ? s : { models: {} }));
  return specP;
}

// Часть обстановки, в которой лежит меш: { holder, root (корень GLB), model } или null
export function decorHolderOf(o) {
  for (let x = o; x; x = x.parent) {
    const info = decorPart(x);
    if (info) return { holder: x, info, model: info.option?.parts?.[info.index]?.model ?? null };
  }
  return null;
}

// ---------- Вороной: выпуклая ячейка = прямоугольник, обрезанный серединными перпендикулярами ----------
function clipPoly(poly, nx, ny, d) {   // оставить точки с nx*x + ny*y <= d
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nx * a[0] + ny * a[1] - d, db = nx * b[0] + ny * b[1] - d;
    if (da <= 0) out.push(a);
    if ((da < 0) !== (db < 0) && da !== db) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
export function voronoiCells(w, h, seeds, clip = null) {
  const rect = clip ?? [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return seeds.map((s, i) => {
    let poly = rect;
    for (let j = 0; j < seeds.length && poly.length > 2; j++) {
      if (j === i) continue;
      const o = seeds[j], nx = o[0] - s[0], ny = o[1] - s[1];
      poly = clipPoly(poly, nx, ny, (nx * (o[0] + s[0]) + ny * (o[1] + s[1])) / 2);
    }
    return poly.length > 2 ? poly : null;
  });
}
// Точки гуще у попадания (u, v): трещины от пули мельче, к краям крупнее
export function impactSeeds(w, h, u, v, n, random = Math.random) {
  const out = [], R = Math.hypot(w, h) * 0.5;
  for (let i = 0; i < n; i++) {
    let x, y;
    if (i < n * 0.6) { const a = random() * Math.PI * 2, r = R * random() ** 1.8; x = u + Math.cos(a) * r; y = v + Math.sin(a) * r; }
    else { x = (random() - 0.5) * w; y = (random() - 0.5) * h; }
    out.push([Math.min(w / 2, Math.max(-w / 2, x)), Math.min(h / 2, Math.max(-h / 2, y))]);
  }
  return out;
}

export function createBreakables({ THREE, scene, camera, pipe, requestRender, getSound = () => true, burst = null }) {
  let random = Math.random, networkSeed = '', silent = false, damageEventId = null;
  const rand = (a, b) => a + random() * (b - a);
  const pendingBroken = new Set();
  const appliedBroken = new Map();
  let missingLookupAt = 0;
  function withSeed(seed, fn, { replay = false, eventId = null } = {}) {
    const previous = random, previousSeed = networkSeed, previousSilent = silent, previousEvent = damageEventId;
    random = seededRandom(seed); networkSeed = String(seed); silent = replay; damageEventId = eventId;
    try { return fn(); } finally { random = previous; networkSeed = previousSeed; silent = previousSilent; damageEventId = previousEvent; }
  }
  breakSpec();
  const V3 = () => new THREE.Vector3();
  const noRaycast = () => {};
  const audio = createBreakSound();
  // битое стекло окна видно лучше целого (сколы, грани): у кусков в раме и падающих — свой материал, один на всех
  const crackedGlass = new THREE.MeshStandardMaterial({ color: 0xe4f0f0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.42,
    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 });
  const sound = (kind, at) => { if (!silent && getSound()) audio.play(kind, at ? at.distanceTo(camera.position) : 0); };

  // ---------- что бьётся ----------
  const typeByName = (map, name) => {
    const n = String(name).toLowerCase();
    let best = null, len = -1;
    for (const k in map) if (k !== '*' && n.startsWith(k.toLowerCase().replace(/[\s.:/[\]]/g, '')) && k.length > len) { best = k; len = k.length; }
    return best != null ? map[best] : map['*'] ?? null;
  };
  // { unit, type } для меша или null
  function breakableOf(o) {
    for (let x = o; x && x !== scene; x = x.parent) if (typeof x.userData.breakable === 'string') return { unit: x, type: x.userData.breakable };
    for (let x = o; x && x !== scene; x = x.parent) if (x.name === 'bath_papers_stack') return { unit: x, type: 'paper' };
    const d = decorHolderOf(o);
    if (!d) return null;
    const rule = d?.model && SPEC?.models?.[d.model]?.break;
    // узел модели: прямой ребёнок корня GLB (корень — ребёнок держателя части)
    let unit = o;
    while (unit.parent && unit.parent.parent && unit.parent.parent !== d.holder) unit = unit.parent;
    if (unit.parent === d.holder) return null;   // заглушка-габарит, модели нет
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    const fallback = loosePropMaterial(d.model, { slot: d.info.slot.id, nodeName: unit.name, materialName: material?.name,
      ...(SPEC?.loosePolicy ? { policy: SPEC.loosePolicy } : {}) });
    const type = (typeof rule === 'string' ? rule : rule ? typeByName(rule, unit.name) : null) ?? fallback;
    return type ? { unit, type } : null;
  }

  // ---------- осколки ----------
  const shards = [];   // { mesh, v, axis, spin, r, ground, probeX, probeZ, from, rest, bounced, near }
  const broken = [];   // { obj, kind: 'unit' | 'pane', extra: [меши в раме] }
  let moving = 0;
  const limit = () => LIMIT[pipe?.quality] ?? LIMIT.eco;
  const downRay = new THREE.Raycaster(); downRay.layers.set(0);
  const DOWN = new THREE.Vector3(0, -1, 0), tmp = V3(), sph = new THREE.Sphere();

  // ближние меши — опоры для кусков (пол, столешница, полка); одна выборка на поломку
  function nearMeshes(point) {
    const list = [];
    scene.traverseVisible(o => {
      if (!o.isMesh || o.userData.impact || o.userData.shadowOnly || o.userData.glass || o.userData.shard || !o.layers.test(downRay.layers)) return;
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
      if (sph.center.distanceTo(point) - sph.radius < BR.near) list.push(o);
    });
    return list;
  }
  // стена на пути: отрезок от прошлой проверки до сейчас (раз в BR.probe пути) — кусок не пролетает сквозь стену
  const segRay = new THREE.Raycaster(); segRay.layers.set(0);
  // луч не смотрит на visible: разбитая вещь (и то, что спрятано) опорой не считается
  const hitsTmp = [];
  const firstShown = (hits, ok = null) => {
    let out = null;
    for (const h of hits) { let o = h.object; while (o && o.visible) o = o.parent; if (!o && (!ok || ok(h))) { out = h; break; } }
    hits.length = 0;
    return out;
  };
  const segD = V3(), wn = V3();
  function wallAt(s) {
    const p = s.mesh.position;
    segD.copy(p).sub(s.from);
    const len = segD.length();
    if (len < 1e-4) return;
    segRay.set(s.from, segD.divideScalar(len)); segRay.far = len + s.r * 0.5;
    const h = firstShown(segRay.intersectObjects(s.near, false, hitsTmp));
    if (!h?.face) return;
    wn.copy(h.face.normal).transformDirection(h.object.matrixWorld);
    if (wn.dot(segD) > 0) wn.negate();
    if (Math.abs(wn.y) > 0.6) return;   // пол и полки — дело groundAt
    p.copy(h.point).addScaledVector(wn, s.r * 0.5 + 0.004);
    s.v.addScaledVector(wn, -2 * s.v.dot(wn)).multiplyScalar(0.35);
  }
  // опора — пологая: на скате (край круглой рамы, спинка) кусок не лежит, соскальзывает ниже
  const flat = h => !h.face || wn.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.5 || wn.y < -0.5;
  function groundAt(s) {
    const p = s.mesh.position;
    if (s.from) { wallAt(s); s.from.copy(p); }
    s.probeX = p.x; s.probeZ = p.z;
    downRay.set(tmp.set(p.x, p.y + Math.max(0.03, s.r), p.z), DOWN);
    downRay.far = 6;
    const h = firstShown(downRay.intersectObjects(s.near, false, hitsTmp), flat);
    s.ground = h ? h.point.y : (p.y > -0.2 ? 0 : -Infinity);   // внутри квартиры пол — y = 0
  }

  function addShard(geo, mat, center, v, near, extra = {}) {
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.raycast = noRaycast;
    mesh.renderOrder = extra.renderOrder ?? 0;
    Object.assign(mesh.userData, { impact: true, shard: true, noPick: true });
    if (extra.quaternion) mesh.quaternion.copy(extra.quaternion);
    if (extra.scale) mesh.scale.copy(extra.scale);
    scene.add(mesh);
    const r = geo.boundingSphere.radius * Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z);
    const s = { mesh, v, axis: V3().set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), spin: rand(4, 14) / Math.max(0.3, r * 20),
      r, ground: 0, probeX: 0, probeZ: 0, from: center.clone(), rest: false, bounced: 0, near, clink: extra.clink };
    groundAt(s);
    shards.push(s); moving++;
    while (shards.length > limit()) dropShard(shards[0]);
    return s;
  }
  function dropShard(s) {
    const i = shards.indexOf(s);
    if (i >= 0) shards.splice(i, 1);
    if (!s.rest) moving--;
    s.mesh.removeFromParent();
    s.mesh.geometry.dispose();
  }

  // Меш вещи -> куски: треугольники по ближайшей из K точек, по одному мешу на (точка, меш, материал)
  const pa = V3(), pb = V3(), pc = V3(), na = V3(), nm = new THREE.Matrix3();
  function fracture(unit, type, point, dir) {
    const meshes = [];
    unit.updateWorldMatrix(true, true);
    unit.traverseVisible(m => { if (m.isMesh && !m.isInstancedMesh && m.geometry?.attributes.position) meshes.push(m); });
    let tris = 0;
    for (const m of meshes) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    if (!tris || tris > BR.maxTris) return [];
    const eco = !networkSeed && pipe?.quality === 'eco' ? 2 / 3 : 1;
    const K = Math.max(3, Math.round((BR.cells[type] ?? 10) * eco));
    // точки — центры случайных треугольников (у пустой коробки габарита были бы ячейки в воздухе)
    const seeds = [];
    for (let k = 0; k < K; k++) {
      const m = meshes[(random() * meshes.length) | 0], g = m.geometry, pos = g.attributes.position;
      const n = (g.index ? g.index.count : pos.count) / 3, t = (random() * n) | 0;
      const ix = i => (g.index ? g.index.getX(t * 3 + i) : t * 3 + i);
      seeds.push(V3().fromBufferAttribute(pos, ix(0)).add(pa.fromBufferAttribute(pos, ix(1))).add(pb.fromBufferAttribute(pos, ix(2))).divideScalar(3).applyMatrix4(m.matrixWorld));
    }
    const groups = new Map();   // ключ -> { mat, pos: [], nor: [], uv: [], col: [] }
    for (const m of meshes) {
      const g = m.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, col = g.attributes.color;
      const mats = Array.isArray(m.material) ? m.material : null;
      nm.getNormalMatrix(m.matrixWorld);
      const n = (g.index ? g.index.count : pos.count) / 3;
      const matOf = t => {
        if (!mats) return m.material;
        const gr = g.groups.find(q => t * 3 >= q.start && t * 3 < q.start + q.count);
        return mats[gr?.materialIndex ?? 0];
      };
      for (let t = 0; t < n; t++) {
        const i0 = g.index ? g.index.getX(t * 3) : t * 3, i1 = g.index ? g.index.getX(t * 3 + 1) : t * 3 + 1, i2 = g.index ? g.index.getX(t * 3 + 2) : t * 3 + 2;
        pa.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
        pb.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
        pc.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
        tmp.copy(pa).add(pb).add(pc).divideScalar(3);
        let best = 0, bd = Infinity;
        for (let k = 0; k < K; k++) { const d = tmp.distanceToSquared(seeds[k]); if (d < bd) { bd = d; best = k; } }
        const mat = matOf(t);
        if (!mat) continue;
        const key = best + '|' + mat.uuid + '|' + (col ? 'c' : '') + (uv ? 'u' : '');
        let G = groups.get(key);
        if (!G) groups.set(key, G = { mat, pos: [], nor: [], uv: uv ? [] : null, col: col ? [] : null });
        for (const [i, p] of [[i0, pa], [i1, pb], [i2, pc]]) {
          G.pos.push(p.x, p.y, p.z);
          if (nor) { na.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); G.nor.push(na.x, na.y, na.z); }
          if (uv) G.uv.push(uv.getX(i), uv.getY(i));
          if (col) G.col.push(col.getX(i), col.getY(i), col.getZ(i));
        }
      }
    }
    const out = [];
    for (const G of groups.values()) {
      const c = V3();
      for (let i = 0; i < G.pos.length; i += 3) { c.x += G.pos[i]; c.y += G.pos[i + 1]; c.z += G.pos[i + 2]; }
      c.divideScalar(G.pos.length / 3);
      const p = new Float32Array(G.pos);
      for (let i = 0; i < p.length; i += 3) { p[i] -= c.x; p[i + 1] -= c.y; p[i + 2] -= c.z; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      if (G.nor.length) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(G.nor), 3)); else geo.computeVertexNormals();
      if (G.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(G.uv), 2));
      if (G.col) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(G.col), 3));
      out.push({ geo, mat: G.mat, center: c });
    }
    return out;
  }

  function launch(center, point, dir, type) {
    const away = V3().subVectors(center, point);
    if (away.lengthSq() < 1e-8) away.set(rand(-1, 1), rand(0, 1), rand(-1, 1));
    away.normalize();
    const k = type === 'fruit' ? 0.6 : ['paper', 'cloth', 'foliage'].includes(type) ? 0.45 : type === 'metal' ? 0.75 : 1;
    return away.multiplyScalar(rand(0.6, 2.0) * k).addScaledVector(dir, rand(0.4, 1.4) * k).add(tmp.set(rand(-0.3, 0.3), rand(0.6, 1.8) * k, rand(-0.3, 0.3)));
  }

  // Содержимое: соседние узлы той же модели, чьё основание внутри габарита разбитого (паста в банке, яблоки в вазе,
  // свеча в фонаре) — падают и бьются вместе с ним (своим типом, если он задан, иначе типом вместилища)
  const ub = new THREE.Box3(), sb = new THREE.Box3();
  function contentsOf(unit) {
    if (!unit.parent) return [];
    ub.setFromObject(unit).expandByScalar(0.01);
    const out = [];
    for (const s of unit.parent.children) {
      if (s === unit || !s.visible) continue;
      sb.setFromObject(s);
      if (sb.isEmpty()) continue;
      tmp.set((sb.min.x + sb.max.x) / 2, sb.min.y + 0.002, (sb.min.z + sb.max.z) / 2);
      if (ub.containsPoint(tmp)) out.push(s);
    }
    return out;
  }
  const dependencyCache = new WeakMap();
  function dependentIdsOf(object) {
    const unit = breakableOf(object)?.unit;
    if (!unit) return [];
    if (!dependencyCache.has(unit)) dependencyCache.set(unit, [...new Set(contentsOf(unit).map(s => stableObjectId(breakableOf(s)?.unit ?? s)).filter(id => id && id !== stableObjectId(unit)))].slice(0, 32));
    return dependencyCache.get(unit);
  }

  // surf — { albedo } поверхности попадания (impacts.js: цвет материала × средний цвет карты) — для сока фрукта
  function breakAt(hit, dir, surf = null) {
    const b = breakableOf(hit.object);
    if (!b || !b.unit.visible) return false;
    const near = nearMeshes(hit.point);
    const smash = (unit, type) => {
      const pieces = silent ? [] : fracture(unit, type, hit.point, dir);
      unit.visible = false;
      broken.push({ obj: unit, kind: 'unit', extra: [] });
      // почти прозрачное стекло (банка, ваза) куском не видно — осколки «битым стеклом»
      for (const p of pieces) addShard(p.geo, type === 'glass' && p.mat.transparent && p.mat.opacity < 0.35 ? crackedGlass : p.mat,
        p.center, launch(p.center, hit.point, dir, type), near, { clink: type });
    };
    const inside = contentsOf(b.unit);
    smash(b.unit, b.type);
    for (const s of inside) smash(s, breakableOf(s)?.type ?? b.type);
    // сок: брызги цвета мякоти (крошку и пыль остального делает impacts.js)
    if (burst && b.type === 'fruit') {
      const albedo = (surf?.albedo ?? new THREE.Color(0.7, 0.3, 0.2)).clone().multiplyScalar(0.85);
      const n = tmp.copy(dir).negate();
      for (let i = 0; i < 2; i++) burst(hit.point, n, dir, { albedo, metal: false, solid: true, flesh: true });
    }
    sound(b.type, hit.point);
    requestRender?.();
    return true;
  }

  // ---------- пластинки (стекло окна, зеркало) ----------
  // object — плоский меш (его +Z — нормаль), rect — { cx, cy, w, h } в его координатах, z0..z1 — толщина;
  // cells — многоугольники в координатах прямоугольника (вокруг cx, cy); fall[i] — падает, иначе остаётся в раме
  // (если keep: тогда меш в раме, ребёнок родителя object, с обработчиком попадания — следующая пуля выбьет)
  const mtx = new THREE.Matrix4(), mtx2 = new THREE.Matrix4(), qq = new THREE.Quaternion(), ss = V3(), pp = V3();
  function slabGeometry(poly, z0, z1) {
    let cx = 0, cy = 0;
    for (const [x, y] of poly) { cx += x; cy += y; }
    cx /= poly.length; cy /= poly.length;
    const pos = [], nor = [], uv = [], zc = (z0 + z1) / 2, hz = (z1 - z0) / 2;
    const tri = (a, b, c, n) => { for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); uv.push(p[0] + cx, p[1] + cy); } };
    const P = poly.map(([x, y]) => [x - cx, y - cy]);
    for (let i = 1; i < P.length - 1; i++) {
      tri([P[0][0], P[0][1], hz], [P[i][0], P[i][1], hz], [P[i + 1][0], P[i + 1][1], hz], [0, 0, 1]);
      tri([P[0][0], P[0][1], -hz], [P[i + 1][0], P[i + 1][1], -hz], [P[i][0], P[i][1], -hz], [0, 0, -1]);
    }
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1, n = [ey / l, -ex / l, 0];
      tri([a[0], a[1], -hz], [b[0], b[1], -hz], [b[0], b[1], hz], n);
      tri([a[0], a[1], -hz], [b[0], b[1], hz], [a[0], a[1], hz], n);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return { geo, cx, cy, zc };
  }
  function slabShards({ object, rect, z0, z1, cells, fall, material, point, dir, keep = false, renderOrder = 0, kind = 'glass', exclude = null }) {
    object.updateWorldMatrix(true, false);
    let near = nearMeshes(point);
    const kept = [];
    // exclude — своя рама (зеркало на стене): на её кромке кусок не повиснет
    if (exclude) near = near.filter(o => { for (let x = o; x; x = x.parent) if (x === exclude) return false; return true; });
    cells.forEach((poly, i) => {
      if (!poly) return;
      const { geo, cx, cy, zc } = slabGeometry(poly, z0, z1);
      if (silent && fall[i]) { geo.dispose(); return; }
      mtx.makeTranslation(rect.cx + cx, rect.cy + cy, zc);
      if (fall[i]) {
        mtx2.multiplyMatrices(object.matrixWorld, mtx).decompose(pp, qq, ss);
        const s = addShard(geo, material, pp.clone(), launch(pp, point, dir, kind).multiplyScalar(0.7), near, { quaternion: qq, scale: ss.clone(), renderOrder, clink: kind });
        s.mesh.userData.glass = !!object.userData.glass;
      } else if (keep) {
        const m = new THREE.Mesh(geo, material);
        mtx2.multiplyMatrices(object.matrix, mtx).decompose(m.position, m.quaternion, m.scale);
        m.castShadow = false; m.receiveShadow = false; m.renderOrder = renderOrder;
        Object.assign(m.userData, { glass: !!object.userData.glass, breakPiece: true, noPick: true,
          networkId: `${stableObjectId(object)}/fragment:${networkSeed}:${i}`, damageEventId });
        object.parent.add(m);
        kept.push(m);
        // следующая пуля выбивает кусок из рамы
        shotHandlers.set(m, (h, d) => {
          if (!m.parent) return false;
          m.updateWorldMatrix(true, false);
          m.matrixWorld.decompose(pp, qq, ss);
          m.removeFromParent();
          const s = addShard(m.geometry, material, pp.clone(), launch(pp, h.point, d, kind).multiplyScalar(0.6), nearMeshes(h.point), { quaternion: qq, scale: ss.clone(), renderOrder, clink: kind });
          s.mesh.userData.glass = m.userData.glass;
          sound('tinkle', h.point);
          requestRender?.();
          return false;   // стекло пулю не держит
        });
      } else geo.dispose();
    });
    return kept;
  }

  const lp = V3(), box = new THREE.Box3();
  function shatterPane(hit, dir) {
    const pane = hit.object;
    if (!pane.visible || pane.userData.shatter === false || pane.userData.breakPiece || pane.userData.shard) return false;
    const g = pane.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    box.copy(g.boundingBox);
    const sz = box.getSize(V3()), c = box.getCenter(V3());
    // плоскость стекла — две самые длинные оси; меш стекла в проекте всегда тонкий по своей Z, иначе не трогаем
    if (sz.z > Math.min(sz.x, sz.y) * 0.25) return false;
    pane.updateWorldMatrix(true, false);
    lp.copy(hit.point).applyMatrix4(mtx.copy(pane.matrixWorld).invert());
    const sc = pane.getWorldScale(V3()), w = sz.x, h = sz.y;
    const eco = !networkSeed && pipe?.quality === 'eco' ? 0.7 : 1;
    const seeds = impactSeeds(w, h, lp.x - c.x, lp.y - c.y, Math.round(BR.pane.seeds * eco * Math.min(1.6, Math.max(0.6, w * h * sc.x * sc.y * 1.2))), random);
    const cells = voronoiCells(w, h, seeds);
    const rHole = BR.pane.hole / Math.max(1e-3, (sc.x + sc.y) / 2);
    const fall = seeds.map(s => Math.hypot(s[0] - (lp.x - c.x), s[1] - (lp.y - c.y)) < rHole || random() < BR.pane.extra);
    const kept = slabShards({ object: pane, rect: { cx: c.x, cy: c.y, w, h }, z0: box.min.z, z1: box.max.z, cells, fall,
      material: crackedGlass, point: hit.point, dir, keep: true, renderOrder: pane.renderOrder, kind: 'glass' });
    pane.visible = false;
    broken.push({ obj: pane, kind: 'pane', extra: kept });
    sound('glass', hit.point);
    requestRender?.();
    return true;
  }

  // ---------- кадр ----------
  const dq = new THREE.Quaternion();
  function update(dt = 1 / 60) {
    if (!moving) return false;
    dt = Math.min(Math.max(dt, 1e-4), 0.05);
    for (const s of shards) {
      if (s.rest) continue;
      const p = s.mesh.position;
      const soft = ['paper', 'cloth', 'foliage'].includes(s.clink);
      if (soft) s.v.multiplyScalar(Math.exp(-1.8 * dt));
      s.v.y -= BR.gravity * (soft ? 0.24 : 1) * dt;
      p.addScaledVector(s.v, dt);
      if (Math.hypot(p.x - s.probeX, p.z - s.probeZ) > BR.probe) groundAt(s);
      dq.setFromAxisAngle(s.axis, s.spin * dt);
      s.mesh.quaternion.premultiply(dq);
      const lift = s.r * 0.35;
      if (p.y - lift < s.ground) {
        p.y = s.ground + lift;
        const hard = -s.v.y;
        if (hard > 1.2 && s.bounced < 2 && s.clink !== 'fruit') audio.clink(s.clink, p.distanceTo(camera.position), getSound());
        s.v.y = hard * BR.bounce; s.v.x *= 0.55; s.v.z *= 0.55; s.spin *= 0.5; s.bounced++;
        if (s.v.length() < BR.rest || s.bounced > 5) { s.rest = true; moving--; s.v.set(0, 0, 0); }
      }
      if (p.y < -5) { s.rest = true; moving--; }   // упало с балкона вниз
    }
    // упавшие за балкон — убрать
    for (let i = shards.length - 1; i >= 0; i--) if (shards[i].mesh.position.y < -5) dropShard(shards[i]);
    return true;
  }

  function restore() {
    pendingBroken.clear(); appliedBroken.clear(); missingLookupAt = 0;
    for (const s of shards.slice()) dropShard(s);
    for (const b of broken) {
      b.obj.visible = true;
      for (const m of b.extra) { m.removeFromParent(); m.geometry.dispose(); }
    }
    broken.length = 0;
    moving = 0;
    restoreHooks.forEach(fn => fn());
    requestRender?.();
  }

  function applyBroken(ids = []) {
    const newIds = new Set();
    for (const id of ids) { if (!pendingBroken.has(id)) newIds.add(id); pendingBroken.add(id); }
    const now = performance.now(), retryMissing = now - missingLookupAt >= 500;
    if (retryMissing) missingLookupAt = now;
    let index = null, changed = false;
    for (const id of pendingBroken) {
      const applied = appliedBroken.get(id);
      if (applied) {
        let root = applied;
        while (root.parent) root = root.parent;
        if (root === scene) continue;
      }
      if (!newIds.has(id) && !retryMissing) continue;
      index ??= indexNetworkObjects(scene);
      const object = index.get(id);
      if (!object) continue;
      const d = decorHolderOf(object), mirror = d?.model && SPEC?.models?.[d.model]?.mirror;
      if (d && !SPEC) continue;
      if (mirror?.material && (Array.isArray(object.material) ? object.material : [object.material]).some(m => m?.name === mirror.material)) object.userData.networkMirror = true;
      if (object.userData.networkMirror || object.userData.mirror || object.userData.mirrorGlass) {
        const handler = shotHandlers.get(object);
        if (!handler) continue;
        if (object.userData.networkDamaged) { appliedBroken.set(id, object); continue; }
        const center = new THREE.Box3().setFromObject(object).getCenter(V3());
        withSeed(`restore:${id}`, () => handler({ object, point: center }, V3().set(0, 0, -1), api), { replay: true });
        appliedBroken.set(id, object); changed = true;
        continue;
      }
      if (!broken.some(b => b.obj === object)) broken.push({ obj: object, kind: 'unit', extra: [] });
      object.visible = false; appliedBroken.set(id, object); changed = true;
    }
    if (changed) requestRender?.();
  }
  const api = { slabShards, sound, burst: burst ?? (() => {}), random: () => random() };
  function forgetNetworkEvent(id) {
    for (const b of broken) b.extra = b.extra.filter(mesh => {
      if (mesh.userData.damageEventId !== id) return true;
      mesh.removeFromParent(); mesh.geometry.dispose(); return false;
    });
  }
  function resetNetworkDamage(ids, index) {
    missingLookupAt = -Infinity;
    for (const id of ids) {
      const object = index.get(id);
      if (object) networkDamageResetters.get(object)?.();
      appliedBroken.delete(id);
    }
  }
  return {
    breakAt, shatterPane, update, restore, api, breakableOf, dependentIdsOf, withSeed, applyBroken,
    forgetNetworkEvent, resetNetworkDamage,
    get brokenIds() { return broken.map(b => stableObjectId(b.obj)).filter(Boolean); },
    handle(hit, dir) { const f = shotHandlers.get(hit.object); return f ? f(hit, dir, api) : null; },
    get broken() { return broken.length; },
    get shards() { return shards.length; },
    dispose() { restore(); audio.dispose(); crackedGlass.dispose(); },
  };
}

// ---------- звук: синтез, без файлов ----------
// play(kind, dist): glass — звон (шум выше 3 кГц + россыпь коротких синусов 2,5–7 кГц), ceramic — хруст (полоса ~1,8 кГц,
// синусы пониже и глухой удар), fruit — шлепок (шум с падающим фильтром), tinkle — один кусок стекла.
// clink(kind, dist, on) — кусок ударился о пол. Громкость падает с расстоянием.
function createBreakSound() {
  let ctx = null, noise = null, lastClink = 0;
  const ensure = () => {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  };
  const VOL = 0.5;
  function noiseHit(c, out, t, { type, f0, f1 = f0, q = 1, dur, gain }) {
    const src = c.createBufferSource(); src.buffer = noise;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.02);
  }
  function ping(c, out, t, f, dur, gain) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  function bus(c, dist, k = 1) {
    const out = c.createGain(); out.gain.value = VOL * k / (1 + Math.max(0, dist) * 0.25); out.connect(c.destination);
    setTimeout(() => out.disconnect(), 1500);
    return out;
  }
  return {
    play(kind, dist = 0) {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime, out = bus(c, dist);
      if (kind === 'glass' || kind === 'tinkle') {
        const big = kind === 'glass';
        if (big) noiseHit(c, out, t, { type: 'highpass', f0: 3000, dur: 0.25, gain: 0.9 });
        for (let i = 0, n = big ? 10 : 3; i < n; i++) ping(c, out, t + Math.random() * (big ? 0.3 : 0.08), 2500 + Math.random() * 4500, 0.05 + Math.random() * 0.12, big ? 0.12 : 0.08);
      } else if (kind === 'ceramic') {
        noiseHit(c, out, t, { type: 'bandpass', f0: 1800, q: 1, dur: 0.14, gain: 1.2 });
        noiseHit(c, out, t + 0.01, { type: 'lowpass', f0: 700, dur: 0.08, gain: 0.8 });
        for (let i = 0; i < 5; i++) ping(c, out, t + Math.random() * 0.12, 900 + Math.random() * 1500, 0.04 + Math.random() * 0.06, 0.1);
        ping(c, out, t, 170, 0.09, 0.4);
      } else if (kind === 'fruit') {
        noiseHit(c, out, t, { type: 'lowpass', f0: 1400, f1: 180, dur: 0.2, gain: 1.4 });
        noiseHit(c, out, t + 0.015, { type: 'bandpass', f0: 950, f1: 260, q: 6, dur: 0.16, gain: 1.6 });
      } else if (kind === 'paper' || kind === 'cloth' || kind === 'foliage') {
        noiseHit(c, out, t, { type: 'highpass', f0: kind === 'paper' ? 1900 : 700, dur: 0.22, gain: 0.45 });
      } else if (kind === 'wood') {
        noiseHit(c, out, t, { type: 'bandpass', f0: 650, q: 1.5, dur: 0.12, gain: 0.9 });
        ping(c, out, t, 140, 0.09, 0.35);
      } else if (kind === 'metal') {
        for (const f of [370, 820, 1710]) ping(c, out, t, f, 0.26, 0.12);
      } else {
        noiseHit(c, out, t, { type: 'bandpass', f0: 1350, q: 2, dur: 0.09, gain: 0.65 });
      }
    },
    clink(kind, dist, on) {
      if (!on) return;
      if (['paper', 'cloth', 'foliage'].includes(kind)) return;
      const now = performance.now();
      if (now - lastClink < 35) return;
      lastClink = now;
      const c = ensure();
      if (!c) return;
      const t = c.currentTime, out = bus(c, dist, 0.6);
      if (kind === 'glass') ping(c, out, t, 3000 + Math.random() * 4000, 0.06, 0.1);
      else { noiseHit(c, out, t, { type: 'bandpass', f0: 2200, q: 2, dur: 0.03, gain: 0.5 }); ping(c, out, t, 1200 + Math.random() * 1200, 0.03, 0.06); }
    },
    dispose() { ctx?.close().catch(() => {}); ctx = null; },
  };
}
