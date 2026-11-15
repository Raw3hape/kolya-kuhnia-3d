// Мыши («Живой дом», ядро — life.js): иногда в комнате, где игрок (в облёте — в той, что в кадре), из-под мебели или
// из норки у плинтуса выбегает мышь, бежит вдоль стены, останавливается понюхать и прячется под мебель или в норку.
// Игрок рядом — убегает быстрее. В неё можно стрелять: попадание — переворот, облачко пыли, мышь исчезает, очки охоты
// (hunt.js addTargets + award; без крови).
//   create(core) -> { update(dt) -> bool, spawn(force?), setLive(on), dispose(), debug }
// Модель — «Rat» Quaternius (CC0), уменьшенная до мыши: web/models/life/rat.glb (клипы Rat_Run, Rat_Idle, Rat_Death),
// грузится при первой мыши. Пути — вдоль стен прямоугольников комнат из plan.generated.json, мимо дверных проёмов;
// мебель — препятствия прогулки (core.obstacles). Кадры — только пока мышь видно (core.seen).
import { roomOf } from './walk.js';
import { addTargets } from './hunt.js';

const rand = (a, b) => a + Math.random() * (b - a);
const GAP = { walk: [30, 90], orbit: [60, 150] };   // пауза между мышами, с
const FIRST = [20, 45];
const LENGTH = 0.17;       // мышь с хвостом, м
const SPEED = 0.85, PANIC = 1.9, FPS = 30;
const INSET = 0.045;       // от стены до оси пути, м
const POINTS = 300;

export function create(L) {
  const { THREE, scene, camera, plan } = L;
  let t = 0, next = rand(...FIRST), live = true, model = null, loading = null;
  let mouse = null;          // текущая: { obj, mixer, acts, path, ... }
  let acc = 0, wasSeen = false;
  const holes = [];          // норки: [{ mesh, until }]
  const puffs = [];          // облачко после попадания

  function load() {
    loading ??= L.loadGLB('models/life/rat.glb').then(g => { model = g; }).catch(e => console.warn('mice:', e));
    return loading;
  }

  // ---------- путь вдоль стены ----------
  const openings = plan.openings.filter(o => o.type !== 'window');
  const inRoom = (x, z) => roomOf(plan, x, z);
  function wallAt(x, z, nx, nz) {
    // за этой точкой стена (а не та же комната и не проём)?
    const bx = x - nx * (INSET + 0.12), bz = z - nz * (INSET + 0.12);
    if (inRoom(bx, bz) != null) return false;
    for (const o of openings) if (bx > o.x0 - 0.15 && bx < o.x1 + 0.15 && bz > o.z0 - 0.15 && bz < o.z1 + 0.15) return false;
    return true;
  }
  function plan1(room) {
    const rects = plan.rooms[room]?.rects?.filter(r => r.x1 - r.x0 > 0.8 && r.z1 - r.z0 > 0.8);
    if (!rects?.length) return null;
    const boxes = L.obstacles().filter(b => b.x1 !== undefined);
    for (let tries = 0; tries < 12; tries++) {
      const r = rects[Math.floor(Math.random() * rects.length)];
      const side = Math.floor(Math.random() * 4);
      // ось вдоль стены: точка a -> b, нормаль в комнату (nx, nz)
      let a, b, n;
      if (side === 0) { a = [r.x0 + 0.1, r.z0 + INSET]; b = [r.x1 - 0.1, r.z0 + INSET]; n = [0, 1]; }
      else if (side === 1) { a = [r.x0 + 0.1, r.z1 - INSET]; b = [r.x1 - 0.1, r.z1 - INSET]; n = [0, -1]; }
      else if (side === 2) { a = [r.x0 + INSET, r.z0 + 0.1]; b = [r.x0 + INSET, r.z1 - 0.1]; n = [1, 0]; }
      else { a = [r.x1 - INSET, r.z0 + 0.1]; b = [r.x1 - INSET, r.z1 - 0.1]; n = [-1, 0]; }
      if (Math.random() < 0.5) [a, b] = [b, a];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      // самый длинный кусок вдоль стены (шаг 5 см), где за спиной стена
      let best = null, s0 = null;
      for (let s = 0; s <= len + 1e-6; s += 0.05) {
        const ok = s < len && wallAt(a[0] + dx * s, a[1] + dz * s, n[0], n[1]);
        if (ok && s0 == null) s0 = s;
        if (!ok && s0 != null) { if (!best || s - s0 > best[1] - best[0]) best = [s0, s]; s0 = null; }
      }
      if (!best || best[1] - best[0] < 1.0) continue;
      const run = Math.min(best[1] - best[0], rand(1.4, 3.6)), from = best[0] + Math.random() * (best[1] - best[0] - run);
      const P = s => ({ x: a[0] + dx * s, z: a[1] + dz * s });
      // мебель на пути: из-под первой выбегаем, под следующую прячемся
      const inBox = p => boxes.find(q => p.x > q.x0 - 0.02 && p.x < q.x1 + 0.02 && p.z > q.z0 - 0.02 && p.z < q.z1 + 0.02);
      let s1 = from, s2 = from + run, startBox = inBox(P(s1));
      if (startBox) { while (s1 < s2 - 0.6 && inBox(P(s1))) s1 += 0.05; s1 -= 0.12; }
      let endBox = null;
      for (let s = s1 + 0.5; s <= s2; s += 0.05) { const q = inBox(P(s)); if (q && q !== startBox) { s2 = s + 0.1; endBox = q; break; } }
      if (s2 - s1 < 0.8) continue;
      const stops = [];
      for (let k = 0, m = Math.random() < 0.7 ? 1 : 2; k < m; k++) stops.push(s1 + (s2 - s1) * rand(0.3, 0.75));
      stops.sort((u, v) => u - v);
      return { a: P(s1), dir: { x: dx, z: dz }, n: { x: n[0], z: n[1] }, len: s2 - s1, stops: stops.map(s => s - s1),
        holeStart: !startBox, holeEnd: !endBox, room };
    }
    return null;
  }

  // Комната для мыши: где игрок; в облёте — та, чей центр в кадре
  function pickRoom() {
    const p = camera.position, here = inRoom(p.x, p.z);
    if (L.walk?.active) return here && !here.startsWith('door:') && here !== 'balcony' && here !== 'landing' ? here : null;
    const seen = Object.entries(plan.rooms).filter(([id, r]) => id !== 'shaft' && r.rects.some(q => L.seen((q.x0 + q.x1) / 2, 0.3, (q.z0 + q.z1) / 2, 1.2, 14)));
    return seen.length ? seen[Math.floor(Math.random() * seen.length)][0] : null;
  }

  // ---------- норка у плинтуса ----------
  let holeGeo = null, holeMat = null;
  function hole(p, n, until) {
    if (!holeGeo) {
      const s = new THREE.Shape(), w = 0.035, h = 0.03;
      s.moveTo(-w, 0); s.lineTo(-w, h); s.absarc(0, h, w, Math.PI, 0, true); s.lineTo(w, 0); s.lineTo(-w, 0);
      holeGeo = new THREE.ShapeGeometry(s, 8);
      holeMat = new THREE.MeshStandardMaterial({ color: 0x080605, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    const m = new THREE.Mesh(holeGeo, holeMat);
    m.position.set(p.x - n.x * (INSET - 0.003), 0.004, p.z - n.z * (INSET - 0.003));
    m.rotation.y = Math.atan2(n.x, n.z);
    m.userData.rasterOnly = true;
    scene.add(m);
    holes.push({ mesh: m, until });
  }

  // ---------- мышь ----------
  function spawn(force = false) {
    if (mouse || !live) return false;
    if (!model) { load().then(() => { if (force) spawn(true); }); if (!force) next = t + 3; return false; }
    const room = pickRoom();
    const path = room && plan1(room);
    if (!path) return false;
    const obj = model.clone(model.scene);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
    const s = LENGTH / Math.max(size.x, size.z, 1e-6);
    obj.scale.multiplyScalar(s);
    obj.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
    const holder = new THREE.Group(); holder.name = 'life_mouse'; holder.userData.rasterOnly = true;
    holder.add(obj);
    obj.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; o.userData.rasterOnly = true; } });
    const mixer = new THREE.AnimationMixer(obj), acts = {};
    for (const c of model.animations) acts[c.name] = mixer.clipAction(c);
    mouse = { obj: holder, mixer, acts, path, s: 0, stop: 0, state: path.holeStart ? 'emerge' : 'run', timer: 0, cur: null, dead: false,
      speed: SPEED * rand(0.85, 1.15), squeakT: rand(1, 3) };
    if (path.holeStart) hole(path.a, path.n, Infinity);
    const end = { x: path.a.x + path.dir.x * path.len, z: path.a.z + path.dir.z * path.len };
    if (path.holeEnd) hole(end, path.n, Infinity);
    mouse.end = end;
    place();
    clip('Rat_Run');
    scene.add(holder);
    L.requestRender?.();
    return true;
  }
  function clip(name, once = false) {
    const a = mouse.acts[name];
    if (!a || mouse.cur === a) return;
    mouse.cur?.fadeOut(0.12);
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once; a.fadeIn(0.12).play();
    mouse.cur = a;
  }
  function place() {
    const m = mouse, p = m.path;
    let x = p.a.x + p.dir.x * m.s, z = p.a.z + p.dir.z * m.s;
    // из норки и в норку — ныряет в стену
    if (m.state === 'emerge') { const k = 1 - Math.min(1, m.timer / 0.35); x -= p.n.x * 0.07 * k; z -= p.n.z * 0.07 * k; }
    if (m.state === 'hide' && p.holeEnd) { const k = Math.min(1, m.timer / 0.3); x -= p.n.x * 0.08 * k; z -= p.n.z * 0.08 * k; }
    m.obj.position.set(x, 0, z);
    if (!m.dead) m.obj.rotation.set(0, Math.atan2(p.dir.x, p.dir.z) + (m.state === 'sniff' ? Math.sin(m.timer * 9) * 0.25 : 0), 0);
  }
  function remove() {
    if (!mouse) return;
    scene.remove(mouse.obj);
    mouse.mixer.stopAllAction();
    for (const h of holes) if (h.until === Infinity) h.until = t + 1.5;   // норка закроется, когда мышь уже внутри
    mouse = null;
  }

  function step(dt) {
    const m = mouse, p = m.path;
    m.timer += dt;
    const me = camera.position, near = L.walk?.walking && Math.hypot(me.x - m.obj.position.x, me.z - m.obj.position.z) < 1.1;
    if (m.dead) {
      // переворот и подскок, затем облачко
      const k = Math.min(1, m.timer / 0.3);
      m.obj.rotation.z = Math.PI * k;
      m.obj.position.y = Math.sin(Math.PI * k) * 0.12 + (k >= 1 ? 0.02 : 0);
      if (m.timer > 0.55) { puff(m.obj.position); remove(); }
      return;
    }
    if (m.state === 'emerge') { if (m.timer > 0.35) { m.state = 'run'; m.timer = 0; } }
    else if (m.state === 'run') {
      const v = near ? PANIC : m.speed;
      m.s += v * dt;
      if (m.cur) m.cur.timeScale = v / SPEED;
      const stopAt = p.stops[m.stop];
      if (!near && stopAt != null && m.s >= stopAt) { m.state = 'sniff'; m.timer = 0; m.stop++; m.sniffLen = rand(0.7, 1.8); clip('Rat_Idle'); }
      else if (stopAt != null && near && m.s >= stopAt) m.stop++;
      if (m.s >= p.len) { m.s = p.len; m.state = 'hide'; m.timer = 0; }
      if ((m.squeakT -= dt) <= 0) { m.squeakT = rand(2, 5); squeak(0.5); }
    } else if (m.state === 'sniff') {
      if (near || m.timer > m.sniffLen) { m.state = 'run'; m.timer = 0; clip('Rat_Run'); if (near) squeak(0.8); }
    } else if (m.state === 'hide') {
      // под мебелью — просто скрылась; в норку — ныряет
      if (m.timer > (p.holeEnd ? 0.3 : 0.05)) { remove(); return; }
    }
    place();
  }

  // ---------- звук ----------
  function squeak(k = 1) {
    const A = L.audio, ctx = A.ctx;
    if (!A.ok || !mouse) return;
    const q = mouse.obj.position, pan = A.panner(q.x, 0.05, q.z, { ref: 0.8, rolloff: 1.5 });
    let tt = ctx.currentTime + 0.01;
    for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = rand(3200, 4800), d = rand(0.04, 0.08);
      o.frequency.setValueAtTime(f, tt); o.frequency.linearRampToValueAtTime(f * rand(1.1, 1.35), tt + d * 0.6); o.frequency.linearRampToValueAtTime(f * 0.9, tt + d);
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.18 * k, tt + 0.008); g.gain.linearRampToValueAtTime(0, tt + d);
      o.connect(g).connect(pan); o.start(tt); o.stop(tt + d + 0.01);
      tt += d + rand(0.03, 0.09);
    }
    setTimeout(() => { try { pan.disconnect(); } catch { /* снят */ } }, 1200);
  }

  // ---------- облачко пыли ----------
  let puffGeo = null, puffMat = null;
  function puff(at) {
    puffGeo ??= new THREE.IcosahedronGeometry(0.018, 0);
    puffMat ??= new THREE.MeshStandardMaterial({ color: 0xcfc8bd, roughness: 1, transparent: true, opacity: 0.8, depthWrite: false });
    const g = new THREE.Group(); g.userData.rasterOnly = true; g.position.copy(at);
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(puffGeo, puffMat); m.userData.rasterOnly = true;
      const v = new THREE.Vector3(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(0.25, 0.6));
      m.position.set(rand(-0.02, 0.02), 0.03, rand(-0.02, 0.02)); g.add(m); parts.push({ m, v });
    }
    scene.add(g);
    puffs.push({ g, parts, t: 0 });
  }
  function stepPuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]; p.t += dt;
      const k = p.t / 0.7;
      for (const { m, v } of p.parts) { m.position.addScaledVector(v, dt * (1 - k)); m.scale.setScalar(1 + k * 2.5); }
      puffMat.opacity = 0.8 * Math.max(0, 1 - k);
      if (k >= 1) { scene.remove(p.g); puffs.splice(i, 1); }
    }
  }

  // ---------- мишень ----------
  const sph = new THREE.Sphere(), hp = new THREE.Vector3();
  const offTargets = addTargets({
    raycast(rc) {
      const m = mouse;
      if (!m || m.dead || !live || m.state === 'hide' && m.timer > 0.15) return null;
      const q = m.obj.position, d = rc.ray.origin.distanceTo(q);
      sph.center.set(q.x, 0.035, q.z); sph.radius = 0.07 + d * 0.004;   // дальняя мышь — чуть щедрее
      if (!rc.ray.intersectSphere(sph, hp)) return null;
      const dist = hp.distanceTo(rc.ray.origin);
      if (dist < (rc.near ?? 0) || dist > (rc.far ?? Infinity)) return null;
      let used = false;
      return {
        distance: dist, point: hp.clone(), normal: rc.ray.direction.clone().negate(), object: m.obj, animal: 'mouse',
        surface: { albedo: new THREE.Color(0.55, 0.52, 0.5), solid: true },
        hit() {
          if (used || m.dead) return null; used = true;
          const running = m.state === 'run';
          m.dead = true; m.timer = 0; clip('Rat_Death', true);
          squeak(1.2);
          const pts = Math.round(POINTS * (running ? 1.25 : 1) / 5) * 5;
          L.hunt?.award?.(pts, q.clone().setY(0.1), 'мышь', running ? 'на бегу' : '');
          L.requestRender?.();
          return { killed: true, points: pts };
        },
      };
    },
  });

  // ---------- кадр ----------
  function update(dt) {
    t += dt;
    for (let i = holes.length - 1; i >= 0; i--) if (t > holes[i].until) { scene.remove(holes[i].mesh); holes.splice(i, 1); }
    if (!mouse) {
      if (t >= next && live) {
        next = t + rand(...(L.walk?.active ? GAP.walk : GAP.orbit));
        if (!model) load(); else spawn();
      }
      if (!puffs.length) return false;
    }
    acc += dt;
    const seen = mouse ? L.seen(mouse.obj.position.x, 0.05, mouse.obj.position.z, 0.2, 14) : true;
    if (mouse) { step(dt); }
    if (!seen && !puffs.length) { wasSeen = false; return false; }
    if (acc < 1 / FPS) return false;
    const s = acc; acc = 0;
    mouse?.mixer.update(s);
    stepPuffs(s);
    wasSeen = true;
    return true;
  }

  function setLive(on) {
    live = on;
    if (!on) { remove(); for (const h of holes) scene.remove(h.mesh); holes.length = 0; }
  }
  function dispose() { setLive(false); offTargets?.(); holeGeo?.dispose(); holeMat?.dispose(); puffGeo?.dispose(); puffMat?.dispose(); }

  return { update, spawn, setLive, dispose, get debug() { return { mouse, holes, plan1, pickRoom }; } };
}
