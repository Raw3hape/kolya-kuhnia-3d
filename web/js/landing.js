// За входной дверью («Живой дом», ядро — life.js): площадка подъезда с мигающей лампочкой и монстры, которые
// стоят там толпой и дальше не пускают. Смешно-жутко, без крови.
//   create(core) -> { update(dt) -> bool, colliders() -> [толстые точки монстров], setLive(on), open(), dispose(), debug }
// Ничего не строится, пока дверь закрыта: модели (web/models/life/*.glb, Quaternius, CC0 — SOURCE.md там же) грузятся,
// когда игрок подходит к входной двери или целится в неё, а сцена появляется при первом открытии (doors.onToggle).
// Лампа — «светильник шейдера» (lighting.js, слой SHADER_LAMP_LAYER): число источников three не меняется, мигание —
// только интенсивность. Пока площадку не видно (дверь закрыта или не в кадре), кадров не просим и миксеры стоят.
// Толкаются: шаг на площадку — монстры мягко выталкивают обратно (walk.nudge), рычат и машут лапами. Стрелять можно:
// им нипочём (попадание — вздрагивают и рычат, очков нет; мишень через hunt.js addTargets).
// Площадка — зона прогулки 'landing' (outdoorAreas в walk.js), её стены и пол строит model.js.
import { outdoorAreas } from './walk.js';
import { SHADER_LAMP_LAYER } from './lighting.js';
import { NIGHT_SCALE } from './lamps.js';
import { addTargets } from './hunt.js';

const rand = (a, b) => a + Math.random() * (b - a);
// Кто стоит: файл, рост (м), место (доли площадки: u — от левого края к правому, v — от двери вглубь), радиус тела
const CAST = [
  { id: 'demon', file: 'models/life/demon.glb', h: 1.95, u: 0.72, v: 0.76, r: 0.3, voice: 62 },
  { id: 'yeti', file: 'models/life/yeti.glb', h: 1.45, u: 0.34, v: 0.72, r: 0.34, voice: 75 },
  { id: 'mushnub', file: 'models/life/mushnub.glb', h: 0.72, u: 0.56, v: 0.32, r: 0.2, voice: 140 },
];
const BULB_LM = 420;            // лампочка накаливания ~40 Вт
const FPS = 30;                 // мигание и анимация, кадров в секунду (пока площадку видно)
// толчок: с порога (zone м до площадки) теснят со скоростью speed + perDepth·глубина, раз в cool с — пинок на shove м
const PUSH = { zone: 0.2, speed: 0.9, perDepth: 2.5, cool: 1.4, shove: 0.45, shoveSpeed: 1.8 };

export function create(L) {
  const { THREE, plan, scene, camera } = L;
  const area = outdoorAreas(plan).find(a => a.id === 'landing');
  const entry = plan.openings.find(o => o.type === 'entry');
  if (!area || !entry) return { update: () => false };
  const H = plan.ceiling ?? 2.64, cx = (area.x0 + area.x1) / 2, cz = (area.z0 + area.z1) / 2;
  const at = (u, v) => [area.x0 + (area.x1 - area.x0) * u, area.z0 + (area.z1 - area.z0) * v];

  let root = null, lamp = null, bulbMat = null, models = null, loading = null, built = false, live = true;
  let open = !!L.doors?.list?.find(d => d.id === entry.id)?.open;
  const cast = [];   // { def, obj, mixer, acts, x, z, busy }
  let network = null, networkSnapshot = null;
  let acc = 0, flick = { mode: 'on', t: 0, until: rand(2, 6), k: 1 }, pushCool = 0, pushedOnce = false, wasSeen = false, shove = 0;

  // ---------- загрузка и сборка ----------
  function preload() {
    loading ??= Promise.all(CAST.map(c => L.loadGLB(c.file))).then(g => { models = g; if (built) addCast(); if (networkSnapshot) applyNetworkSnapshot(networkSnapshot); }).catch(e => console.warn('landing:', e));
    return loading;
  }
  function build() {
    if (built) return;
    built = true;
    root = new THREE.Group(); root.name = 'life_landing'; root.userData.rasterOnly = true;
    // лампочка на шнуре под потолком
    const bx = cx, by = H - 0.32, bz = cz + 0.05;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, H - by - 0.03, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }));
    cord.position.set(bx, (H + by) / 2 + 0.015, bz);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.04, 10), cord.material);
    sock.position.set(bx, by + 0.045, bz);
    bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xffd9a0, emissiveIntensity: 1, roughness: 0.3 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), bulbMat);
    bulb.position.set(bx, by, bz); bulb.scale.y = 1.25;
    for (const m of [cord, sock, bulb]) { m.userData.rasterOnly = true; root.add(m); }
    // свет: широкий прожектор вниз, светильник шейдера (three его не считает)
    lamp = new THREE.SpotLight(0xffd6a0, 0, 0, 1.35, 1, 2);
    lamp.layers.set(SHADER_LAMP_LAYER); lamp.userData.rasterOnly = true;
    lamp.position.set(bx, by - 0.02, bz); lamp.target.position.set(bx, 0, bz);
    root.add(lamp, lamp.target);
    scene.add(root);
    if (models) addCast(); else preload();
  }
  function addCast() {
    if (cast.length || !models) return;
    const group = new THREE.Group(); group.name = 'life_monsters'; group.userData.networkEntity = true;
    CAST.forEach((def, i) => {
      const g = models[i];
      const obj = g.clone(g.scene);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj), h = box.max.y - box.min.y || 1, s = def.h / h;
      const holder = new THREE.Group();
      obj.scale.multiplyScalar(s);
      obj.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
      holder.add(obj);
      const [x, z] = at(def.u, def.v);
      holder.position.set(x, 0, z);
      holder.rotation.y = Math.PI + rand(-0.25, 0.25);   // лицом к двери (модели смотрят в +Z)
      obj.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; o.userData.rasterOnly = true; } });
      group.add(holder);
      const mixer = new THREE.AnimationMixer(obj), acts = {};
      for (const clip of g.animations) acts[clip.name] = mixer.clipAction(clip);
      const m = { id: `monster:${i}:1`, def, obj: holder, mixer, acts, x, z, busy: 0, cur: null, yaw0: holder.rotation.y };
      play(m, 'Idle', { offset: Math.random() });
      cast.push(m);
    });
    L.warm(group).then(() => { root?.add(group); L.walk?.refreshObstacles?.(); L.requestRender?.(); });
  }

  // ---------- анимации ----------
  const pickClip = (m, ...names) => names.find(n => m.acts[n]);
  function play(m, name, { once = false, offset = 0 } = {}) {
    const a = m.acts[name];
    if (!a) return 0;
    if (m.cur && m.cur !== a) m.cur.fadeOut(0.25);
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once;
    a.fadeIn(0.25).play();
    if (offset) a.time = offset * a.getClip().duration;
    m.cur = a;
    return a.getClip().duration;
  }
  function act(m, ...names) {
    const n = pickClip(m, ...names);
    if (!n) return;
    m.busy = play(m, n, { once: true }) * 0.92;
  }

  // ---------- звук: рык ----------
  function growl(m, k = 1) {
    const A = L.audio, ctx = A.ctx;
    if (!A.ok || !m) return;
    const t = ctx.currentTime + 0.02, len = rand(0.7, 1.4) * (m.def.h < 1 ? 0.6 : 1);
    const pan = A.panner(m.x, m.def.h * 0.85, m.z, { ref: 1.2 });
    const g = ctx.createGain(); g.gain.value = 0; g.connect(pan);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = m.def.h < 1 ? 900 : 380; bp.Q.value = 1.4; bp.connect(g);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = m.def.voice * rand(0.9, 1.1); o.connect(bp);
    o.frequency.setValueAtTime(o.frequency.value * 0.8, t); o.frequency.linearRampToValueAtTime(o.frequency.value * 1.15, t + len * 0.4);
    o.frequency.linearRampToValueAtTime(o.frequency.value * 0.7, t + len);
    const roll = ctx.createOscillator(); roll.frequency.value = rand(18, 28); const rg = ctx.createGain(); rg.gain.value = 0.35 * k; roll.connect(rg).connect(g.gain);
    const n = A.noise(true), ng = ctx.createGain(); ng.gain.value = 0.25; n.connect(ng).connect(bp);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.6 * k, t + 0.12); g.gain.setValueAtTime(0.6 * k, t + len - 0.25); g.gain.linearRampToValueAtTime(0, t + len);
    for (const x of [o, roll, n]) { x.start(t); x.stop(t + len + 0.05); }
    setTimeout(() => { try { pan.disconnect(); g.disconnect(); } catch { /* снят */ } }, (len + 0.4) * 1000);
  }

  // ---------- дверь ----------
  const offToggle = L.doors?.onToggle?.((id, isOpen) => {
    if (id !== entry.id) return;
    open = isOpen;
    if (!live) return;
    if (open) {
      build();
      sync();
      if (network && !network.authority) return;
      // встречают: кто-то машет, кто-то мотает головой, кто-то рычит
      setTimeout(() => {
        if (!open || !cast.length || network && !network.authority) return;
        for (const m of cast) act(m, ...(Math.random() < 0.5 ? ['Wave', 'Dance', 'No'] : ['No', 'Wave']));
        growl(cast[Math.floor(Math.random() * cast.length)], 0.8);
        L.requestRender?.();
      }, 450);
    }
  });
  function sync() {
    const vis = live && open && built;
    if (root) root.visible = vis;
    L.walk?.refreshObstacles?.();
  }

  // ---------- мигание ----------
  function stepFlicker(dt) {
    const f = flick;
    f.t += dt;
    if (f.mode === 'on') {
      f.k = 0.92 + 0.08 * Math.sin(f.t * 47) * Math.sin(f.t * 13.3);
      if (f.t > f.until) {
        const r = Math.random();
        f.mode = r < 0.6 ? 'stutter' : r < 0.85 ? 'dim' : 'dark'; f.t = 0;
        f.until = f.mode === 'stutter' ? rand(0.3, 1.1) : f.mode === 'dim' ? rand(0.4, 1.2) : rand(0.6, 2.2);
      }
    } else {
      if (f.mode === 'stutter') f.k = Math.random() < 0.45 ? rand(0, 0.15) : rand(0.7, 1);
      else if (f.mode === 'dim') f.k = 0.25 + 0.15 * Math.random();
      else f.k = f.t > f.until - 0.25 ? (Math.random() < 0.5 ? 1 : 0) : 0;
      if (f.t > f.until) { f.mode = 'on'; f.t = 0; f.until = rand(1.5, 6); }
    }
    const I = BULB_LM / (2 * Math.PI * (1 - Math.cos(1.35))) * NIGHT_SCALE * f.k;
    lamp.intensity = I;
    bulbMat.emissiveIntensity = 0.15 + 2.5 * f.k;
  }

  // ---------- толчок ----------
  function push(dt) {
    const walk = L.walk;
    if (!walk?.walking || !cast.length) { shove = 0; return false; }
    if (shove > 0) { const d = Math.min(shove, PUSH.shoveSpeed * dt); shove -= d; walk.nudge(0, -d); }
    const p = camera.position, edge = area.z0 - PUSH.zone;
    if (p.z <= edge || p.x < area.x0 - 0.1 || p.x > area.x1 + 0.1) { pushCool = Math.min(pushCool, 0.3); return shove > 0; }
    const depth = p.z - edge;
    walk.nudge(0, -Math.min(depth + 0.02, (PUSH.speed + PUSH.perDepth * depth) * dt));
    pushCool -= dt;
    if (pushCool <= 0) {
      pushCool = PUSH.cool; shove = PUSH.shove;
      let near = cast[0], d0 = Infinity;
      for (const m of cast) { const d = Math.hypot(m.x - p.x, m.z - p.z); if (d < d0) { d0 = d; near = m; } }
      act(near, 'Punch', 'Bite_Front', 'No');
      growl(near, 1);
      walk.kick?.(0.012, rand(-0.02, 0.02), 0);
      if (!pushedOnce) { pushedOnce = true; L.notice('Не пускают. Похоже, у них там своё собрание'); }
    }
    return true;
  }

  // ---------- мишень для оружия ----------
  const sphere = new THREE.Sphere(), hitP = new THREE.Vector3();
  const offTargets = addTargets({
    raycast(rc) {
      if (!live || !open || !cast.length || !root?.visible) return null;
      let best = null, bt = rc.far ?? Infinity;
      for (const m of cast) {
        const r = m.def.r * 0.9;
        for (let y = r; y < m.def.h - r * 0.5; y += r) {
          sphere.center.set(m.x, y, m.z); sphere.radius = r;
          if (!rc.ray.intersectSphere(sphere, hitP)) continue;
          const t = hitP.distanceTo(rc.ray.origin);
          if (t < (rc.near ?? 0) || t >= bt) continue;
          bt = t; best = { m, point: hitP.clone() };
        }
      }
      if (!best) return null;
      const { m, point } = best;
      let used = false;
      return {
        distance: bt, point, normal: rc.ray.direction.clone().negate(), object: m.obj, animal: 'monster', animalId: m.id,
        surface: { albedo: new THREE.Color(0.5, 0.5, 0.55), solid: true },
        hit() {
          if (used) return null; used = true;
          act(m, 'HitReact', 'HitRecieve');
          growl(m, 1.1);
          L.hunt?.award?.(0, point, 'Ему нипочём', m.def.h < 1 ? 'грибу не страшно' : 'монстр с площадки');
          L.requestRender?.();
          return { killed: false };
        },
      };
    },
  });

  // ---------- кадр ----------
  let nearT = 0;
  function update(dt) {
    if (network && !network.authority) {
      if (!built || !root?.visible) return false;
      for (const m of cast) m.mixer.update(Math.min(dt, 0.1));
      return true;
    }
    // заранее загрузить, когда игрок рядом с дверью или целится в неё
    if (!loading && live && L.walk?.walking && (nearT += dt) > 0.5) {
      nearT = 0;
      const p = camera.position, mx = (entry.x0 + entry.x1) / 2, mz = (entry.z0 + entry.z1) / 2;
      if (L.doors?.target?.id === entry.id || Math.hypot(p.x - mx, p.z - mz) < 2.6) preload();
    }
    if (!built || !root.visible) { wasSeen = false; return false; }
    let need = push(dt);
    const vis = L.seen(cx, 1.2, cz, 1.3, 16);
    if (!vis && !need) { if (wasSeen) { wasSeen = false; lamp.intensity = 0; } return false; }
    wasSeen = true;
    acc += dt;
    if (acc < 1 / FPS && !need) return false;
    const step = Math.min(acc, 0.1); acc = 0;
    stepFlicker(step);
    for (const m of cast) {
      m.mixer.update(step);
      if (m.busy > 0 && (m.busy -= step) <= 0) play(m, 'Idle');
      else if (m.busy <= 0 && Math.random() < step * 0.04) act(m, 'No', 'Wave', 'Dance');   // иногда сами по себе
    }
    return true;
  }

  function colliders() {
    if (!live || !open || !cast.length) return null;
    return cast.map(m => ({ ax: m.x, az: m.z, bx: m.x + 1e-3, bz: m.z, h: m.def.r }));
  }

  function setLive(on) {
    const changed = live !== on;
    live = on;
    if (on && open) build();
    if (!on && root) root.visible = false;
    else sync();
    if (changed && !on) L.walk?.refreshObstacles?.();
  }

  function dispose() {
    offToggle?.(); offTargets?.();
    if (root) { scene.remove(root); root.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) o.geometry?.dispose(); }); }
  }

  function snapshot() {
    return { built, open, visible: !!root?.visible, flicker: { ...flick },
      cast: cast.map(m => ({ id: m.id, x: m.x, z: m.z, yaw: m.obj.rotation.y, busy: m.busy,
        clip: m.cur?.getClip()?.name ?? 'Idle', clipTime: m.cur?.time ?? 0 })) };
  }
  function applyNetworkSnapshot(value) {
    if (!value) return;
    networkSnapshot = value;
    if (!network || network.authority) return;
    let obstaclesChanged = open !== !!value.open;
    open = !!value.open;
    if (value.built && !built) build();
    if (!root) return;
    root.visible = !!value.visible && live;
    if (value.flicker) {
      Object.assign(flick, value.flicker);
      lamp.intensity = BULB_LM / (2 * Math.PI * (1 - Math.cos(1.35))) * NIGHT_SCALE * flick.k;
      bulbMat.emissiveIntensity = 0.15 + 2.5 * flick.k;
    }
    for (const pose of value.cast ?? []) {
      const m = cast.find(c => c.id === pose.id);
      if (!m) continue;
      if (open && (m.x !== pose.x || m.z !== pose.z)) obstaclesChanged = true;
      m.x = pose.x; m.z = pose.z; m.busy = pose.busy; m.obj.position.set(pose.x, 0, pose.z); m.obj.rotation.y = pose.yaw;
      if (m.cur?.getClip()?.name !== pose.clip) play(m, pose.clip, { once: pose.clip !== 'Idle' });
      if (m.cur && Number.isFinite(pose.clipTime)) m.cur.time = pose.clipTime;
      m.mixer.update(0);
    }
    // Flicker, clip time, yaw and gestures do not change these circular blockers.
    // Refresh only on an actual collision change; addCast/setLive handle loading.
    if (obstaclesChanged) L.walk?.refreshObstacles?.();
    L.requestRender?.();
  }
  return { update, colliders, setLive, dispose, preload, snapshot, applyNetworkSnapshot,
    setNetwork(value) { network = value || null; }, open: () => L.doors?.setOpen?.(entry.id, true),
    get debug() { return { root, cast, flick, area }; } };
}
