// Procedural, faceted miniatures in the same world scale as the wildlife.
// All motion/effects derive from shared encounter ages, including late joiners.
import { seededRandom } from './network-objects.js';

export function createFieldEventView({ THREE: T, parent, camera, ground, rules }) {
  const root = new T.Group(); root.name = 'field-events';
  Object.assign(root.userData, { networkEntity: true, rasterOnly: true, noPick: true }); parent.add(root);
  const owned = [], models = new Map();
  const own = o => { owned.push(o); return o; };
  const box = own(new T.BoxGeometry(1, 1, 1)), ball = own(new T.IcosahedronGeometry(1, 1));
  const cylinder = own(new T.CylinderGeometry(1, 1, 1, 12));
  const ring = own(new T.TorusGeometry(1, 0.16, 5, 14));
  const disc = own(new T.CircleGeometry(1, 24));
  const material = (color, extra = {}) => own(new T.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra }));
  const M = { white: material('#e8e9dc'), blue: material('#185c9d'), black: material('#20292c'), rubber: material('#252829'),
    metal: material('#8c9795', { metalness: 0.6 }), glass: material('#254653', { metalness: 0.3, roughness: 0.2 }),
    red: material('#b53b2b'), green: material('#63864c'), yellow: material('#e4b848'), dough: material('#dfb570'),
    cardboard: material('#ad8152'), lamp: material('#fff0ba', { emissive: '#ffd567', emissiveIntensity: 1.3 }),
    beacon: material('#2ba1ff', { emissive: '#087eff', emissiveIntensity: 3 }),
    tail: material('#d52b22', { emissive: '#ad1d15', emissiveIntensity: 0.4 }),
    fire: material('#ff9630', { emissive: '#ff4d08', emissiveIntensity: 3, transparent: true, opacity: 0.8, depthWrite: false }),
    shadow: own(new T.MeshBasicMaterial({ color: '#423e30', transparent: true, opacity: 0.17, depthWrite: false })) };
  const mesh = (group, geo, mat, p, size) => {
    const o = new T.Mesh(geo, mat); o.position.set(...p); if (size) o.scale.set(...size);
    o.raycast = () => {}; o.castShadow = false; o.receiveShadow = true; group.add(o); return o;
  };
  const cube = (g, m, p, s) => mesh(g, box, m, p, s);
  const group = (g, p = [0, 0, 0]) => { const o = new T.Group(); o.position.set(...p); g.add(o); return o; };
  const sections = new Map();
  function carSection(g, key, points, width, mat) {
    let geometry = sections.get(key);
    if (!geometry) {
      const shape = new T.Shape(); points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
      geometry = own(new T.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1, steps: 1 }));
      geometry.rotateY(Math.PI / 2); geometry.translate(-width / 2, 0, 0); sections.set(key, geometry);
    }
    return mesh(g, geometry, mat, [0, 0, 0]);
  }
  const labels = new Map();
  function label(g, text, color, bg, p, w, h, side = 1) {
    const key = [text, color, bg, w, h].join('|');
    let cached = labels.get(key);
    if (!cached) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const ctx = c.getContext('2d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = color; ctx.font = 'bold 67px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 68, 490);
    const map = own(new T.CanvasTexture(c)); map.colorSpace = T.SRGBColorSpace;
    const mat = own(new T.MeshStandardMaterial({ map, roughness: 0.85, side: T.DoubleSide }));
      cached = { geometry: own(new T.PlaneGeometry(w, h, text === 'POLSKA GUROM!' ? 20 : 1, 1)), mat }; labels.set(key, cached);
    }
    const o = mesh(g, cached.geometry, cached.mat, p);
    o.rotation.y = side * Math.PI / 2; return o;
  }
  function wheel(g, x, z, radius, width = 0.3) {
    const pivot = group(g, [x, radius, z]);
    const tire = mesh(pivot, cylinder, M.rubber, [0, 0, 0], [radius, width, radius]); tire.rotation.z = Math.PI / 2;
    const hub = mesh(pivot, cylinder, M.metal, [Math.sign(x) * 0.17, 0, 0], [radius * 0.48, width + 0.025, radius * 0.48]); hub.rotation.z = Math.PI / 2;
    for (const turn of [0, Math.PI / 2]) cube(pivot, M.black, [Math.sign(x) * (width / 2 + 0.025), 0, 0], [0.025, radius * 0.7, radius * 0.1]).rotation.x = turn;
    return pivot;
  }
  function build(e) {
    const base = group(root), body = group(base), wheels = [], rotors = [], lights = [], cargo = [];
    base.name = e.id; const random = seededRandom(e.id);
    let banner = null, trailer = null;
    if (e.kind === 'police') {
      carSection(body, 'patrol-body', [[-2.27,0.52],[-2.3,0.84],[-1.8,1.03],[-0.9,1.08],[1.55,1.08],[2.22,0.94],[2.26,0.55]], 1.88, M.white);
      carSection(body, 'patrol-glazing', [[-1.18,1.04],[-0.56,1.65],[0.75,1.65],[1.43,1.06]], 1.65, M.glass);
      carSection(body, 'patrol-roof', [[-0.62,1.63],[-0.53,1.74],[0.78,1.74],[0.9,1.63]], 1.7, M.white);
      cube(body, M.blue, [0, 0.9, 0], [1.94, 0.23, 3.9]);
      cube(body, M.black, [0, 0.65, 2.28], [1.4, 0.2, 0.06]);
      cube(body, M.black, [0, 0.94, 2.22], [0.8, 0.14, 0.07]);
      for (let i = -3; i <= 3; i++) cube(body, M.metal, [i * 0.1, 0.94, 2.26], [0.035, 0.11, 0.025]);
      cube(body, M.black, [0, 1.78, -0.13], [1.2, 0.07, 0.23]);
      cube(body, M.black, [-0.65, 1.9, -0.85], [0.025, 0.48, 0.025]);
      for (const x of [-1, 1]) {
        label(body, 'POLICJA', '#f0f4ed', '#185c9d', [x * 0.981, 0.91, 0], 1.7, 0.26, x);
        for (const z of [-0.7, 0.22]) cube(body, M.white, [x * 0.84, 1.34, z], [0.05, 0.57, 0.055]);
        for (const z of [-0.8, 0.45]) {
          cube(body, M.black, [x * 0.97, 1.09, z], [0.025, 0.035, 0.19]);
          cube(body, M.black, [x * 0.957, 0.69, z - 0.1], [0.012, 0.15, 0.015]);
        }
        for (let i = 0; i < 8; i++) cube(body, i % 2 ? M.blue : M.white, [x * 0.98, 0.62, -0.8 + i * 0.2], [0.018, 0.1, 0.2]);
        for (const z of [-1.4, 1.4]) cube(body, M.black, [x * 0.88, 0.54, z], [0.25, 0.12, 0.9]);
        for (const z of [-1.4, 1.4]) wheels.push(wheel(body, x * 0.98, z, 0.39));
        cube(body, M.black, [x * 0.99, 1.28, 0.75], [0.22, 0.15, 0.23]);
        cube(body, M.lamp, [x * 0.67, 0.91, 2.24], [0.42, 0.22, 0.04]);
        cube(body, M.yellow, [x * 0.91, 0.9, 2.2], [0.09, 0.15, 0.06]);
        cube(body, M.tail, [x * 0.68, 0.92, -2.24], [0.35, 0.2, 0.04]);
        lights.push(cube(body, M.beacon, [x * 0.47, 1.87, -0.13], [0.55, 0.15, 0.25]));
      }
      cube(body, M.black, [0, 0.56, 2.26], [1.82, 0.17, 0.1]);
      label(body, 'WPR 997', '#15202a', '#eff0df', [0, 0.72, 2.31], 0.65, 0.16, 0).rotation.y = 0;
      label(body, 'WPR 997', '#15202a', '#eff0df', [0, 0.72, -2.31], 0.65, 0.16, 0).rotation.y = Math.PI;
    } else if (e.kind === 'tractor') {
      cube(body, M.red, [0, 1.06, 0.6], [1.3, 0.85, 2.6]);
      cube(body, M.black, [0, 1, 1.94], [1.1, 0.5, 0.05]);
      for (let i = -3; i <= 3; i++) cube(body, M.metal, [i * 0.12, 1, 1.98], [0.04, 0.42, 0.04]);
      cube(body, M.glass, [0, 1.9, -0.45], [1.35, 1.35, 1.4]);
      cube(body, M.red, [0, 2.63, -0.45], [1.7, 0.18, 1.7]);
      for (const x of [-1, 1]) {
        wheels.push(wheel(body, x * 1.06, -0.65, 0.85, 0.48), wheel(body, x * 0.85, 1.35, 0.48));
        cube(body, M.lamp, [x * 0.48, 1.35, 1.96], [0.25, 0.25, 0.08]);
      }
      cube(body, M.black, [0.5, 2.08, 1], [0.15, 1.5, 0.15]);
      trailer = group(body, [0, 0, -3.6]);
      cube(body, M.black, [0, 0.43, -2], [0.15, 0.15, 2]);
      cube(trailer, M.green, [0, 0.7, 0], [2.4, 0.4, 2.4]);
      for (const x of [-1, 1]) {
        wheels.push(wheel(trailer, x * 1.24, 0, 0.5));
        label(trailer, 'PIEROGI', '#fff2c7', '#416b3d', [x * 1.21, 0.83, 0], 2, 0.38, x);
      }
      const pierog = group(trailer, [0, 1.15, 0]); cargo.push(pierog);
      mesh(pierog, ball, M.dough, [0, 0.4, 0], [1.15, 0.7, 0.8]);
      for (let i = 0; i < 12; i++) {
        const a = i / 11 * Math.PI;
        mesh(pierog, ball, M.dough, [Math.cos(a), 0.38 + Math.sin(a) * 0.63, 0.55], [0.16, 0.16, 0.19]);
      }
    } else if (e.kind === 'drone') {
      mesh(body, ball, M.white, [0, 0, 0], [0.6, 0.3, 0.7]);
      cube(body, M.yellow, [0, 0.15, 0], [0.7, 0.16, 0.7]);
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        const arm = cube(body, M.black, [x * 0.67, 0, z * 0.67], [0.16, 0.16, 1.75]); arm.rotation.y = x * z * Math.PI / 4;
        const rotor = group(body, [x * 1.25, 0.14, z * 1.25]); rotors.push(rotor);
        cube(rotor, M.black, [0, 0, 0], [1.2, 0.025, 0.1]);
        mesh(body, ring, M.metal, [x * 1.25, 0.1, z * 1.25], [0.65, 0.65, 0.65]).rotation.x = Math.PI / 2;
      }
      const parcel = group(body, [0, -0.95, 0]); cargo.push(parcel);
      cube(parcel, M.cardboard, [0, 0, 0], [1.05, 0.8, 0.9]);
      cube(parcel, M.yellow, [0, 0.405, 0], [0.16, 0.012, 0.91]);
      for (const x of [-1, 1]) {
        cube(body, M.black, [x * 0.4, -0.5, 0], [0.025, 0.8, 0.025]);
        label(parcel, 'PACZKA!', '#443e27', '#e7bb4c', [x * 0.53, 0, 0], 0.8, 0.32, x);
      }
      lights.push(cube(body, M.beacon, [0, 0, 0.67], [0.12, 0.1, 0.04]));
    } else {
      mesh(body, ball, M.white, [0, 0, 0], [0.65, 0.65, 3.3]);
      cube(body, M.red, [0, 0.12, 0], [10.2, 0.14, 1.65]);
      cube(body, M.white, [0, 0.17, -2.8], [3.7, 0.12, 0.95]);
      cube(body, M.red, [0, 0.65, -2.8], [0.12, 1.2, 0.9]);
      mesh(body, ball, M.glass, [0, 0.58, 0.7], [0.53, 0.4, 0.85]);
      const prop = group(body, [0, 0, 3.3]); rotors.push(prop);
      cube(prop, M.black, [0, 0, 0], [0.14, 2.7, 0.08]);
      for (const x of [-1, 1]) {
        cube(body, M.white, [x * 3.7, 0.2, 0.1], [0.8, 0.025, 0.8]);
        cube(body, M.red, [x * 3.7, 0.22, 0.1], [0.4, 0.025, 0.4]);
      }
      cube(body, M.black, [0, 0, -5.6], [0.035, 0.035, 5.7]);
      banner = group(body, [0, 0, -8.4]);
      for (const x of [-1, 1]) label(banner, 'POLSKA GUROM!', '#a63229', '#eee8d7', [x * 0.02, 0, -3], 6, 1.5, x);
    }
    const smokeMat = material('#4c4b46', { transparent: true, opacity: 0.38, depthWrite: false });
    const smoke = Array.from({ length: 9 }, () => mesh(base, ball, smokeMat, [0, 0, 0], [1, 1, 1]));
    const burst = group(base), bits = [];
    for (let i = 0; i < 22; i++) {
      const o = mesh(burst, i < 12 ? box : ball, i < 12 ? [M.black, M.metal, M.yellow][i % 3] : M.fire, [0, 0, 0]);
      bits.push({ o, v: new T.Vector3((random() - 0.5) * 11, 3 + random() * 7, (random() - 0.5) * 11), size: 0.12 + random() * 0.3 });
    }
    const flash = mesh(base, ball, M.fire, [0, 1, 0]);
    const ricochets = Array.from({ length: 7 }, () => mesh(base, box, M.lamp, [0, 0, 0], [0.035, 0.035, 0.7]));
    const shadow = mesh(root, disc, M.shadow, [e.x, ground + 0.03, e.z]); shadow.rotation.x = -Math.PI / 2;
    const plate = document.createElement('div'); plate.className = 'kfe-health'; plate.hidden = true;
    const name = document.createElement('b'), amount = document.createElement('span'), bar = document.createElement('progress');
    bar.setAttribute('aria-label', 'Прочность ' + rules.types[e.kind].name.split(' · ')[0]);
    const cargoAmount = document.createElement('span'), cargoBar = document.createElement('progress');
    cargoBar.setAttribute('aria-label', 'Прочность груза');
    plate.append(name, amount, bar, cargoAmount, cargoBar); document.body.append(plate);
    const model = { base, body, wheels, rotors, lights, cargo, banner, trailer, smoke, smokeMat, bits, burst, flash, shadow,
      plate, name, amount, bar, cargoAmount, cargoBar, ricochets };
    models.set(e.id, model); return model;
  }

  const cue = document.createElement('div'); cue.className = 'kfe-cue'; cue.hidden = true;
  cue.setAttribute('role', 'status'); cue.setAttribute('aria-live', 'polite');
  const title = document.createElement('b'), subtitle = document.createElement('span'), health = document.createElement('progress');
  health.setAttribute('aria-label', 'Прочность цели'); cue.append(title, subtitle, health); document.body.append(cue);
  if (!document.getElementById('kfe-style')) {
    const style = document.createElement('style'); style.id = 'kfe-style';
    style.textContent = '.kfe-cue{position:fixed;z-index:23;left:50%;bottom:115px;transform:translateX(-50%);max-width:min(340px,80vw);padding:10px 16px;border:1px solid #d5c9a84d;border-radius:8px;background:#202c2ce8;color:#fff7df;text-align:center;pointer-events:none;font:12px/1.45 system-ui;box-shadow:0 4px 20px #0002}.kfe-cue b{display:block;font-size:14px;letter-spacing:.02em}.kfe-cue span{display:block;color:#e0dac7}.kfe-cue progress{display:block;width:100%;height:5px;margin:7px 0 1px;accent-color:#e3bd64}.kfe-health{position:fixed;z-index:4;transform:translate(-50%,-100%);padding:5px 8px;border-radius:5px;background:#1b292bd9;color:#fff7df;pointer-events:none;text-align:center;font:10px/1.25 system-ui;min-width:78px;box-shadow:0 2px 8px #0002}.kfe-health b,.kfe-health span{display:block}.kfe-health b{font-size:10px;letter-spacing:.04em}.kfe-health progress{width:100%;height:4px;display:block;margin-top:3px;accent-color:#8dc5b6}.kfe-health span{margin-top:2px}.kfe-cue[hidden],.kfe-cue progress[hidden],.kfe-health[hidden],.kfe-health [hidden]{display:none!important}@media(max-width:600px){.kfe-cue{bottom:152px;font-size:11px;padding:8px 12px}.kfe-cue b{font-size:13px}.kfe-health{font-size:9px;min-width:65px}}';
    document.head.append(style);
  }
  const projected = new T.Vector3();
  function update(state, { visible = true, walking = false, dt = 1 / 60, network = false, canSee = () => true } = {}) {
    root.visible = visible; const live = new Set(), announcements = [];
    let aimed = null, best = 0.17;
    for (const pose of state?.events ?? []) {
      const prior = models.get(pose.id);
      const k = 1 - Math.exp(-20 * Math.min(0.1, dt));
      const e = network && prior?.pose ? { ...pose } : pose;
      if (e !== pose) for (const key of ['x', 'y', 'z', 'age', 'roll', 'pitch', 'deadAge']) e[key] = prior.pose[key] + (pose[key] - prior.pose[key]) * k;
      if (e !== pose) e.yaw = prior.pose.yaw + Math.atan2(Math.sin(pose.yaw - prior.pose.yaw), Math.cos(pose.yaw - prior.pose.yaw)) * k;
      live.add(e.id); const m = models.get(e.id) || build(e), r = rules.types[e.kind];
      m.pose = e;
      m.base.position.set(e.x, e.y, e.z); m.base.rotation.set(0, e.yaw, 0);
      m.body.visible = !e.dead || e.impactAge === null;
      const wobble = e.flash * Math.sin(e.age * 47) * 0.07;
      m.body.rotation.set(e.pitch, 0, e.roll + wobble); m.body.position.y = e.flash * 0.045;
      for (const w of m.wheels) w.rotation.x = e.age * (e.speed ?? r.speed) / 0.5;
      for (const rotor of m.rotors) { if (e.kind === 'plane') rotor.rotation.z = e.age * 85; else rotor.rotation.y = e.age * 95; }
      for (let i = 0; i < m.lights.length; i++) m.lights[i].visible = !e.dead && Math.sin(e.age * 13 + i * Math.PI) > -0.2;
      for (const cargo of m.cargo) {
        cargo.rotation.z = Math.sin(e.age * 3) * (e.kind === 'drone' ? 0.18 : 0.09); cargo.rotation.x = Math.sin(e.age * 4) * 0.06;
        if (e.kind === 'tractor') {
          const t = e.cargoAge || 0; cargo.visible = !e.cargoDead || t < 2.5;
          cargo.position.y = 1.15 + (e.cargoDead ? Math.max(-0.7, t * 3 - 5 * t * t) : 0);
          cargo.position.x = e.cargoDead ? t * 1.6 : 0; cargo.rotation.z += e.cargoDead ? t * 4 : e.cargoFlash * 0.3;
          cargo.scale.setScalar(e.cargoDead ? Math.max(0, 1 - Math.max(0, t - 1.5)) : 1);
        }
      }
      if (m.trailer) m.trailer.rotation.y = Math.sin(e.age * 1.7) * 0.06;
      if (m.banner) {
        m.banner.rotation.y = Math.sin(e.age * 4) * 0.07; m.banner.rotation.x = Math.sin(e.age * 5) * 0.06;
        const geometry = m.banner.children[0].geometry, p = geometry.attributes.position;
        for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 2.7 - e.age * 7) * 0.09);
        p.needsUpdate = true; geometry.computeVertexNormals();
      }
      const blastAge = e.impactAge === null ? -1 : e.deadAge - e.impactAge;
      const damaged = 1 - e.hp / e.maxHp;
      m.smokeMat.opacity = e.dead ? Math.max(0, 0.45 * (1 - Math.max(0, blastAge - 4) / 5)) : 0.24;
      for (let i = 0; i < m.smoke.length; i++) {
        const s = m.smoke[i], t = ((e.age * 0.7 + i / 9) % 1);
        s.visible = e.dead || damaged > 0.35 && i < damaged * 9;
        s.position.set(Math.sin(i * 2.4 + e.age) * t * 1.4, 0.8 + t * (e.dead ? 7 : 3), -0.6 + t);
        const size = (0.2 + t * (e.dead ? 2 : 0.9)) * (e.dead ? Math.min(1, e.deadAge * 2) : 1); s.scale.setScalar(size);
      }
      m.flash.visible = e.flash > 0.65 || blastAge >= 0 && blastAge < 0.5;
      m.flash.position.set(0, 0.9, 0.3); m.flash.scale.setScalar(blastAge >= 0 && blastAge < 0.5 ? Math.sin(blastAge * Math.PI * 2) * 3.4 + 0.5 : 0.25 + e.flash * 0.2);
      for (let i = 0; i < m.ricochets.length; i++) {
        const spark = m.ricochets[i], t = 1 - e.flash;
        spark.visible = e.kind === 'tractor' && !e.dead && e.flash > 0.08;
        const angle = e.hits * 2.3 + i * 1.1, radius = 0.4 + t * (3 + i * 0.35);
        spark.position.set(Math.sin(angle) * radius, 1 + t * (1.5 + i * 0.2), Math.cos(angle) * radius);
        spark.rotation.set(-0.4, angle, 0); spark.scale.set(0.025, 0.025, 0.35 + t * 0.5);
      }
      m.burst.visible = blastAge >= 0 && blastAge < 6;
      if (m.burst.visible) for (const { o, v, size } of m.bits) {
        const t = blastAge; o.position.set(v.x * t * 0.5, Math.max(ground - e.y + 0.05, 0.8 + v.y * t - 4.9 * t * t), v.z * t * 0.5);
        o.rotation.set(t * v.z, t * v.x, t * 2); o.scale.setScalar(size * Math.max(0, 1 - t / 6));
      }
      // Entry/exit uses a scale ease instead of a sudden roadside spawn.
      const fade = e.dead ? Math.min(1, Math.max(0, (9 - blastAge) / 1.5)) : Math.min(1, e.age / 1.5, e.route ? (1 - e.progress) * 40 : (e.duration - e.age) / 1.5);
      m.base.scale.setScalar(Math.max(0, fade));
      m.shadow.position.set(e.x, ground + 0.025, e.z); m.shadow.scale.set(3.4, e.kind === 'plane' ? 5 : 2, 1); m.shadow.visible = fade > 0.05;
      // Braking dust and skid yaw make the patrol's sharp changes readable.
      if (e.kind === 'police' && !e.dead && Math.abs(e.drift) > 0.14) for (let i = 0; i < 3; i++) {
        const t = (e.age * 2 + i / 3) % 1, s = m.smoke[i]; s.visible = true;
        s.position.set(Math.sin(i * 5) * 0.7, 0.15 + t * 0.7, -1.5 - t * 2.5); s.scale.setScalar(0.25 + t * 0.7);
      }
      projected.set(e.x, e.y + (e.kind === 'tractor' ? 3.8 : e.kind === 'police' ? 2.2 : 1.5), e.z);
      const unobscured = canSee(projected, e.id); projected.project(camera);
      m.plate.hidden = !visible || e.dead || !unobscured || projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 0.95 || Math.abs(projected.y) > 0.95 || fade < 0.5;
      if (!m.plate.hidden) {
        m.plate.style.left = `${(projected.x + 1) * innerWidth / 2}px`; m.plate.style.top = `${(1 - projected.y) * innerHeight / 2 - 8}px`;
        m.name.textContent = r.name.split(' · ')[0]; m.amount.textContent = `${Math.ceil(e.hp)} / ${e.maxHp}`; m.bar.max = e.maxHp; m.bar.value = e.hp;
        m.cargoAmount.hidden = m.cargoBar.hidden = e.kind !== 'tractor' || e.cargoDead;
        if (!m.cargoBar.hidden) { m.cargoAmount.textContent = `Пирог · ${Math.ceil(e.cargoHp)} / ${e.cargoMaxHp}`; m.cargoBar.max = e.cargoMaxHp; m.cargoBar.value = e.cargoHp; }
      }
      if (!e.dead && visible && unobscured) {
        projected.set(e.x, e.y + (e.kind === 'police' ? 1 : 0), e.z).project(camera);
        const center = Math.hypot(projected.x, projected.y);
        if (projected.z > -1 && projected.z < 1 && center < best) { aimed = e; best = center; }
        if (e.age < 6 && projected.z < 1 && Math.abs(projected.x) < 1.2 && Math.abs(projected.y) < 1.2) announcements.push(e);
      }
    }
    for (const [id, m] of models) if (!live.has(id)) { root.remove(m.base, m.shadow); m.plate.remove(); m.smokeMat.dispose(); owned.splice(owned.indexOf(m.smokeMat), 1); models.delete(id); }
    const target = aimed || announcements[0]; cue.hidden = !visible || !walking || !target;
    if (target && !cue.hidden) {
      const r = rules.types[target.kind]; title.textContent = r.name;
      subtitle.textContent = target.kind === 'tractor' && target.cargoDead ? 'Груз сбит. Осталась броня!' : target.hp < target.maxHp ? r.damaged : r.line;
      health.hidden = !aimed; health.max = target.maxHp; health.value = target.hp;
    }
    return visible && live.size > 0;
  }
  function dispose() {
    cue.remove(); for (const m of models.values()) m.plate.remove(); root.removeFromParent(); for (const o of owned) o.dispose(); models.clear();
  }
  return { update, dispose, root };
}
