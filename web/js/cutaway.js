// Вырез перед камерой: что прячется, чтобы видеть цель, не ломая остальную квартиру.
//
//   const cut = createCutaway({ camera, controls, shell, cutMeshes, aboveMeshes, H });
//   cut.setEnabled(!walk.active); cut.update();   // каждый кадр перед рендером
//
// Правила:
// - Камера снаружи квартиры (улица, балкон, над потолком): все стены на месте, фасад виден целиком.
//   Режем стены, только когда камера внутри габарита квартиры ниже потолка.
// - Стена прячется целиком (все её куски: простенки, перемычки, подоконная часть, окна и двери в ней),
//   если хоть один кусок лежит на отрезке камера → цель или камера внутри него. Раньше прятался только
//   кусок под лучом — в фасаде оставались дыры шириной в простенок и висящие рамы.
// - Взгляд сквозь проём (окно, дверь) стену не прячет: луч проходит в дыре и не задевает её кусков.
// - Потолок и всё, что над ним (cut: 'above': светильники на потолке, верхний балкон, этажи дома), прячется
//   только когда камера выше потолка.
// - Спрятанное уходит на слой 1: камера его не видит, но тени (солнце, лампы) и зонды света его видят,
//   поэтому вырез на освещение не влияет.
// Стена = куски одной линии: одинаковая толщина (тот же отрезок поперёк) и касание вдоль. Маленькие куски
// (короче 30 см в обе стороны) примыкают к соседней стене, совпадающей по толщине, — без цепочек через углы.

export function createCutaway({ camera, controls, shell, cutMeshes, aboveMeshes, H }) {
  let enabled = true, units = null, wallsOf = null, all = null, lastState = new WeakMap();
  const EPS = 0.004, TOUCH = 0.02;

  function box(o) {
    o.updateWorldMatrix(true, true);
    const b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    o.traverse(m => {
      if (!m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const g = m.geometry.boundingBox, e = m.matrixWorld.elements;
      for (let i = 0; i < 8; i++) {
        const x = i & 1 ? g.max.x : g.min.x, y = i & 2 ? g.max.y : g.min.y, z = i & 4 ? g.max.z : g.min.z;
        const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
        b.x0 = Math.min(b.x0, wx); b.x1 = Math.max(b.x1, wx); b.y0 = Math.min(b.y0, wy); b.y1 = Math.max(b.y1, wy); b.z0 = Math.min(b.z0, wz); b.z1 = Math.max(b.z1, wz);
      }
    });
    return b;
  }
  const near = (a, b) => Math.abs(a - b) < EPS;
  const overlaps = (a, b, m = 0) => a.x0 < b.x1 - m && a.x1 > b.x0 + m && a.y0 < b.y1 - m && a.y1 > b.y0 + m && a.z0 < b.z1 - m && a.z1 > b.z0 + m;

  // Отрезок p→p+d·t (t∈[0,tMax]) пересекает коробку раньше tMax?
  function segmentHits(b, p, d, tMax) {
    let t0 = 0, t1 = tMax;
    for (const [o, dir, lo, hi] of [[p.x, d.x, b.x0, b.x1], [p.y, d.y, b.y0, b.y1], [p.z, d.z, b.z0, b.z1]]) {
      if (Math.abs(dir) < 1e-9) { if (o < lo || o > hi) return false; continue; }
      let a = (lo - o) / dir, c = (hi - o) / dir;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) return false;
    }
    return true;
  }
  const contains = (b, p) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && p.z >= b.z0 && p.z <= b.z1;

  function build() {
    const wallSet = new Set(shell.walls);
    // --- стены: группировка кусков
    const parts = shell.walls.map(m => ({ m, b: box(m) }));
    for (const p of parts) {
      const dx = p.b.x1 - p.b.x0, dz = p.b.z1 - p.b.z0;
      p.axis = Math.max(dx, dz) < 0.3 ? null : (dx >= dz ? 'x' : 'z');
    }
    const parent = parts.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const join = (i, j) => { parent[find(i)] = find(j); };
    // same(a, b, axis): одна толщина поперёк axis и касание вдоль axis
    const same = (a, b, axis) => {
      const t = axis === 'x' ? 'z' : 'x';
      return near(a[t + '0'], b[t + '0']) && near(a[t + '1'], b[t + '1']) && a[axis + '0'] <= b[axis + '1'] + TOUCH && b[axis + '0'] <= a[axis + '1'] + TOUCH;
    };
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], c = parts[j];
      if (a.axis && a.axis === c.axis && same(a.b, c.b, a.axis)) join(i, j);
    }
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].axis) continue;
      const cand = parts.map((c, j) => [c, j]).filter(([c, j]) => j !== i && c.axis && same(parts[i].b, c.b, c.axis));
      if (cand.length) join(i, cand.sort((a, c) => (c[0].b[c[0].axis + '1'] - c[0].b[c[0].axis + '0']) - (a[0].b[a[0].axis + '1'] - a[0].b[a[0].axis + '0']))[0][1]);
    }
    const groups = new Map();
    parts.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, { parts: [], members: [], hosts: null }); groups.get(r).parts.push(p); });
    wallsOf = [...groups.values()];
    for (const g of wallsOf) {
      g.members = g.parts.map(p => p.m);
      g.b = g.parts.reduce((u, { b }) => ({ x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), z0: Math.min(u.z0, b.z0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1), z1: Math.max(u.z1, b.z1) }),
        { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity });
    }
    // габарит квартиры по стенам: камера внутри него — режем, снаружи — нет
    all = wallsOf.reduce((u, { b }) => ({ x0: Math.min(u.x0, b.x0), z0: Math.min(u.z0, b.z0), x1: Math.max(u.x1, b.x1), z1: Math.max(u.z1, b.z1) }),
      { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity });

    // --- двери (куски из cutMeshes вне стен) объединяются по своей группе-проёму
    const rootOf = o => { let r = o; while (r.parent && r.parent.parent && !r.parent.parent.isScene) r = r.parent; return r; };
    const unitMap = new Map();
    for (const m of cutMeshes) {
      if (wallSet.has(m)) continue;
      const r = rootOf(m);
      if (!unitMap.has(r)) unitMap.set(r, { root: r, pieces: [] });
      unitMap.get(r).pieces.push({ m, b: box(m) });
    }
    // --- окна и наружные двери: группы в оболочке, не стены (рамы, стекло, подоконник)
    for (const c of shell.group.children) {
      if (wallSet.has(c) || c.isMesh || c.name === 'railing' || c.userData.shadowOnly) continue;
      if (!unitMap.has(c)) unitMap.set(c, { root: c, pieces: [{ m: c, b: box(c) }], opening: true });
    }
    units = [...unitMap.values()].map(u => {
      u.b = box(u.root);
      u.hosts = wallsOf.filter(g => overlaps(g.b, u.b, 0.01));
      return u;
    }).filter(u => u.opening ? u.hosts.length > 0 : true);
  }

  function setLayer(o, layer) {
    const prev = lastState.get(o);
    if (prev === layer) return;
    lastState.set(o, layer);
    // источники света не трогаем: светильник под срезанным потолком должен светить как обычно
    o.traverse(c => { if (!c.isLight) c.layers.set(layer); });
  }

  function update() {
    if (!units) build();
    const ceiling = shell.ceiling;
    if (!enabled) {
      for (const g of wallsOf) for (const m of g.members) setLayer(m, 0);
      for (const u of units) setLayer(u.root, 0);
      setLayer(ceiling, 0);
      for (const m of aboveMeshes) setLayer(m, 0);
      return;
    }
    const p = camera.position, t = controls.target;
    const d = { x: t.x - p.x, y: t.y - p.y, z: t.z - p.z };
    const dist = Math.hypot(d.x, d.y, d.z) || 1e-6;
    d.x /= dist; d.y /= dist; d.z /= dist;
    const tMax = dist - 0.05;
    const between = b => contains(b, p) || segmentHits(b, p, d, tMax);

    // снаружи квартиры (улица, балкон, над потолком) стены стоят все: фасад и комнаты видны как есть
    const inside = p.y < H && p.x > all.x0 && p.x < all.x1 && p.z > all.z0 && p.z < all.z1;
    for (const g of wallsOf) g.hidden = inside && g.parts.some(q => between(q.b));
    for (const g of wallsOf) for (const m of g.members) setLayer(m, g.hidden ? 1 : 0);
    for (const u of units) {
      // окно прячется только со своей стеной (взгляд сквозь окно его не убирает), дверь — ещё и сама
      const hide = u.hosts.some(g => g.hidden) || (inside && !u.opening && u.pieces.some(q => between(q.b)));
      setLayer(u.root, hide ? 1 : 0);
    }
    const above = p.y > H;
    setLayer(ceiling, above ? 1 : 0);
    for (const m of aboveMeshes) setLayer(m, above ? 1 : 0);
  }

  function setEnabled(v) { enabled = !!v; }
  // геометрия стен поменялась (пересобрали оболочку или двери) — пересчитать группы
  function rebuild() { units = null; lastState = new WeakMap(); }

  return { update, setEnabled, rebuild, get groups() { return wallsOf; } };
}
