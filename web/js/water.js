// Вода сама по себе («Живой дом», ядро — life.js): кран на кухне, смеситель раковины и верхний душ в ванной время от
// времени сами включаются на несколько секунд — струя, всплеск и шум воды из той точки — и сами выключаются (капли в конце).
//   create(core) -> { update(dt) -> bool, start(id?), stop(), setLive(on), dispose(), debug }   id: 'kitchen' | 'sink' | 'shower'
// Где краны: кухня — из kitchen.json (как buildFaucet в model.js: носик на 0.24 м от стены, мойка под ним);
// ванная — по мешам bath.js 'tap_spout', 'vanity_waste', 'shower_head' (их положение, геометрию bath.js не трогаем).
// Дёшево: струя — открытый цилиндр (душ — пучок, одна геометрия) с бегущей маской прозрачности, всплеск — «корона»;
// строится при первом включении. Кадры (30 в секунду) — только пока струю видно (core.seen), иначе только звук.
// Чаще включается то, что рядом с игроком. Фото-режим, снимок и выключенный «Живой дом» — воды нет.

const rand = (a, b) => a + Math.random() * (b - a);
const GAP = [50, 140];      // пауза между случаями, с
const FIRST = [25, 60];
const FPS = 30;
const LEN = { kitchen: [4, 9], sink: [3, 7], shower: [6, 12] };

export function create(L) {
  const { THREE, scene, kit } = L;
  let t = 0, next = rand(...FIRST), live = true;
  let mat = null, alpha = null;
  const taps = {};          // id -> { top: Vector3, bottom: Vector3, group, stream, splash, built }
  let cur = null;           // { tap, t, len, stopAt, k, sound }
  let acc = 0;

  // ---------- где краны ----------
  function locate(id) {
    if (taps[id]?.top) return taps[id];
    const V = THREE.Vector3;
    if (id === 'kitchen') {
      const run = kit.run; let z = run.startZ, sinkZ = null;
      for (const m of run.modules) { if (m.sink) sinkZ = z - m.w / 2; z -= m.w; }
      if (sinkZ == null) return null;
      const top = kit.worktop.height;
      // как buildFaucet(0.07, top, sinkZ) в model.js: конец носика (x + 0.24, top + 0.27); дно мойки — top − th − depth
      taps.kitchen = { top: new V(run.wallX + 0.07 + 0.24, top + 0.26, sinkZ), bottom: new V(run.wallX + 0.31, top - kit.worktop.thickness - kit.sink.depth + 0.005, sinkZ), r: 0.006 };
      return taps.kitchen;
    }
    const box = name => { const o = scene.getObjectByName(name); return o ? new THREE.Box3().setFromObject(o) : null; };
    if (id === 'sink') {
      const s = box('tap_spout'), w = box('vanity_waste');
      if (!s) return null;
      const c = s.getCenter(new V());
      // носик торчит из смесителя в комнату: конец — дальний от стены край коробки (стена ванной напротив двери — +Z)
      taps.sink = { top: new V(c.x, s.min.y + 0.002, s.min.z + 0.012), bottom: new V(c.x, w ? w.max.y : s.min.y - 0.22, s.min.z + 0.012), r: 0.005 };
      return taps.sink;
    }
    if (id === 'shower') {
      const h = box('shower_head');
      if (!h) return null;
      const c = h.getCenter(new V());
      taps.shower = { top: new V(c.x, h.min.y - 0.002, c.z), bottom: new V(c.x, 0.004, c.z), r: 0.004, spread: (h.max.x - h.min.x) / 2 * 0.75 };
      return taps.shower;
    }
    return null;
  }

  // ---------- геометрия струи ----------
  function material() {
    if (mat) return mat;
    const c = document.createElement('canvas'); c.width = 16; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 16, 128);
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * 16, y = Math.random() * 128, l = 6 + Math.random() * 28, v = 120 + Math.random() * 135;
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1 + Math.random() * 2.5, l); g.fillRect(x, y - 128, 1 + Math.random() * 2.5, l);
    }
    alpha = new THREE.CanvasTexture(c); alpha.wrapS = alpha.wrapT = THREE.RepeatWrapping;
    mat = new THREE.MeshStandardMaterial({ color: 0xd8ecf5, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.85,
      alphaMap: alpha, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 });
    return mat;
  }
  function build(tap, id) {
    if (tap.group) return;
    const g = new THREE.Group(); g.name = 'life_water_' + id; g.userData.rasterOnly = true; g.visible = false;
    const len = tap.top.y - tap.bottom.y;
    let geo;
    if (id === 'shower') {
      // пучок тонких струй: из кружка лейки к полу, чуть расходятся
      const parts = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + rand(-0.2, 0.2), r = tap.spread * Math.sqrt(rand(0.15, 1));
        const c = new THREE.CylinderGeometry(tap.r, tap.r * 1.6, len, 5, 1, true);
        c.translate(0, -len / 2, 0);
        const lean = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), rand(0.04, 0.11));
        c.applyMatrix4(lean); c.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
        parts.push(c);
      }
      geo = merge(parts);
    } else {
      geo = new THREE.CylinderGeometry(tap.r, tap.r * 1.5, len, 8, 1, true);
      geo.translate(0, -len / 2, 0);
    }
    scaleUV(geo, len / 0.12);
    const stream = new THREE.Mesh(geo, material());
    stream.position.copy(tap.top);
    const crown = new THREE.CylinderGeometry(id === 'shower' ? tap.spread * 1.4 : 0.05, id === 'shower' ? tap.spread : 0.012, 0.03, 12, 1, true);
    crown.translate(0, 0.015, 0);
    scaleUV(crown, 0.4);
    const splash = new THREE.Mesh(crown, material());
    splash.position.copy(tap.bottom);
    for (const m of [stream, splash]) { m.userData.rasterOnly = true; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 2; g.add(m); }
    scene.add(g);
    Object.assign(tap, { group: g, stream, splash, len });
  }
  function scaleUV(geo, k) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * k); }
  function merge(list) {
    let n = 0, ni = 0;
    for (const g of list) { n += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = new Uint32Array(ni);
    let o = 0, oi = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
      for (let i = 0; i < g.index.count; i++) idx[oi + i] = g.index.array[i] + o;
      o += g.attributes.position.count; oi += g.index.count; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }

  // ---------- звук: шум воды и капли ----------
  function sound(tap, id) {
    const A = L.audio, ctx = A.ctx;
    if (!A.ok) return null;
    const t0 = ctx.currentTime + 0.02, p = tap.bottom;
    const pan = A.panner(p.x, p.y + 0.1, p.z, { ref: id === 'shower' ? 1.4 : 1, rolloff: 1.2 });
    const g = ctx.createGain(); g.gain.value = 0; g.connect(pan);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = id === 'shower' ? 500 : 900; hp.connect(g);
    const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = id === 'kitchen' ? 2600 : 1800; bp.gain.value = 6; bp.Q.value = 0.8; bp.connect(hp);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = id === 'shower' ? 7000 : 5500; lp.connect(bp);
    const n = A.noise(true); n.connect(lp);
    // бульканье: медленная случайная модуляция полосы
    const lfo = ctx.createOscillator(); lfo.frequency.value = rand(3, 7); const lg = ctx.createGain(); lg.gain.value = 500; lfo.connect(lg).connect(bp.frequency);
    const level = id === 'shower' ? 0.5 : 0.35;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(level, t0 + 0.25);
    n.start(t0); lfo.start(t0);
    return {
      stop() {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.4);
        n.stop(t + 0.5); lfo.stop(t + 0.5);
        // последние капли
        for (let i = 0; i < 3; i++) {
          const td = t + 0.6 + i * rand(0.35, 0.8), o = ctx.createOscillator(), dg = ctx.createGain();
          o.frequency.setValueAtTime(rand(1300, 2200), td); o.frequency.exponentialRampToValueAtTime(rand(500, 800), td + 0.06);
          dg.gain.setValueAtTime(0, td); dg.gain.linearRampToValueAtTime(0.25, td + 0.003); dg.gain.exponentialRampToValueAtTime(0.001, td + 0.08);
          o.connect(dg).connect(pan); o.start(td); o.stop(td + 0.1);
        }
        setTimeout(() => { try { pan.disconnect(); g.disconnect(); } catch { /* снят */ } }, 3500);
      },
    };
  }

  // ---------- включить / выключить ----------
  function start(id) {
    if (cur || !live) return false;
    const ids = ['kitchen', 'sink', 'shower'].filter(i => locate(i));
    if (!ids.length) return false;
    if (!id) {
      // ближе к игроку — вероятнее
      const p = L.camera.position, w = ids.map(i => 1 / (0.5 + taps[i].bottom.distanceTo(p)) ** 2);
      let r = Math.random() * w.reduce((a, b) => a + b, 0); id = ids[0];
      for (let i = 0; i < ids.length; i++) if ((r -= w[i]) <= 0) { id = ids[i]; break; }
    }
    const tap = locate(id);
    if (!tap) return false;
    build(tap, id);
    tap.group.visible = true;
    cur = { id, tap, t: 0, len: rand(...LEN[id]), k: 0, sound: sound(tap, id) };
    L.requestRender?.();
    return true;
  }
  function stop(now = false) {
    if (!cur) return;
    cur.sound?.stop(); cur.sound = null;
    if (now) { cur.tap.group.visible = false; cur = null; L.requestRender?.(); }
    else cur.stopAt = cur.t;
  }

  function update(dt) {
    t += dt;
    if (!cur) {
      if (t >= next && live) { next = t + rand(...GAP); start(); }
      return false;
    }
    cur.t += dt;
    if (cur.stopAt == null && cur.t >= cur.len) stop();
    // напор: нарастает за 0.2 с, спадает за 0.5 с
    const k = cur.stopAt == null ? Math.min(1, cur.t / 0.2) : Math.max(0, 1 - (cur.t - cur.stopAt) / 0.5);
    if (cur.stopAt != null && k <= 0) { cur.tap.group.visible = false; cur = null; L.requestRender?.(); return true; }
    const tap = cur.tap, mid = tap.top.clone().lerp(tap.bottom, 0.5);
    if (!L.seen(mid.x, mid.y, mid.z, tap.len / 2 + 0.1, 12)) return false;
    acc += dt;
    if (acc < 1 / FPS) return false;
    const step = acc; acc = 0;
    alpha.offset.y -= step * 2.6;
    // струя растёт сверху вниз при включении и истончается при выключении
    const grow = cur.stopAt == null ? Math.min(1, cur.t / 0.18) : 1;
    tap.stream.scale.set(0.4 + 0.6 * k, grow, 0.4 + 0.6 * k);
    const s = grow >= 1 ? k * (0.85 + 0.3 * Math.random()) : 0.01;
    tap.splash.scale.set(s, s * (0.7 + 0.6 * Math.random()), s);
    return true;
  }

  function setLive(on) { live = on; if (!on) stop(true); }
  function dispose() {
    stop(true);
    for (const tap of Object.values(taps)) if (tap.group) { scene.remove(tap.group); tap.stream.geometry.dispose(); tap.splash.geometry.dispose(); }
    mat?.dispose(); alpha?.dispose();
  }
  return { update, start, stop, setLive, dispose, get debug() { return { taps, cur }; } };
}
