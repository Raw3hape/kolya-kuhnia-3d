const MECH = {
  empty: [[0, 3800, 0.012, 0.5]],
  magOut: [[0, 1400, 0.02, 0.6], [0.05, 900, 0.03, 0.4]],
  magIn: [[0, 1100, 0.025, 0.8], [0.03, 2600, 0.015, 0.6]],
  rack: [[0, 2200, 0.05, 0.5], [0.09, 1800, 0.03, 0.8]],
  boltUp: [[0, 2000, 0.02, 0.5]],
  boltBack: [[0, 1500, 0.06, 0.6]],
  boltFwd: [[0, 1600, 0.05, 0.6], [0.05, 2400, 0.015, 0.7]],
  boltDown: [[0, 2600, 0.015, 0.6]],
  clip: [[0, 3000, 0.04, 0.4], [0.06, 2500, 0.04, 0.4], [0.12, 2800, 0.03, 0.4]],
  shell: [[0, 900, 0.03, 0.6]],
  open: [[0, 1300, 0.03, 0.7], [0.04, 700, 0.05, 0.5]],
  close: [[0, 1000, 0.03, 0.9], [0.02, 2400, 0.012, 0.6]],
};
export function createShotSound(volume = 0.22) {
  let ctx = null, noise = null;
  const ensure = () => {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  };
  const ready = () => { const c = ensure(); if (c?.state === 'suspended') c.resume().catch(() => {}); return c; };
  return {
    unlock: ready,
    play({ gain, cutoff, decay, thump }) {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      const out = c.createGain(); out.gain.value = volume * gain; out.connect(c.destination);
      const src = c.createBufferSource(); src.buffer = noise;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(cutoff, t); lp.frequency.exponentialRampToValueAtTime(250, t + decay);
      const ng = c.createGain(); ng.gain.setValueAtTime(1, t); ng.gain.exponentialRampToValueAtTime(0.001, t + decay);
      src.connect(lp).connect(ng).connect(out);
      src.start(t, Math.random() * 0.3); src.stop(t + decay + 0.02);
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(thump, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const og = c.createGain(); og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(og).connect(out); o.start(t); o.stop(t + 0.15);
      src.onended = () => out.disconnect();
    },
    mech(name) {
      const c = ready(), ticks = MECH[name];
      if (!c || !ticks) return;
      const t0 = c.currentTime;
      const out = c.createGain(); out.gain.value = volume * 0.9; out.connect(c.destination);
      let end = 0;
      for (const [at, f, dur, g] of ticks) {
        const t = t0 + at, src = c.createBufferSource(); src.buffer = noise;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3;
        const env = c.createGain(); env.gain.setValueAtTime(g, t); env.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(bp).connect(env).connect(out);
        src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.01);
        end = Math.max(end, at + dur);
      }
      setTimeout(() => out.disconnect(), (end + 0.1) * 1000);
    },
    dispose() { ctx?.close().catch(() => {}); ctx = null; },
  };
}

// Текстура вспышки: мягкое ядро и шесть лучей, рисуется на холсте один раз
export function makeFlashTexture(THREE) {
  const n = 128, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'), c = n / 2;
  const core = g.createRadialGradient(c, c, 0, c, c, c * 0.55);
  core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.35, 'rgba(255,220,150,0.9)'); core.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = core; g.fillRect(0, 0, n, n);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, L = c * (i % 2 ? 0.7 : 0.95);
    g.save(); g.translate(c, c); g.rotate(a);
    const ray = g.createLinearGradient(0, 0, L, 0);
    ray.addColorStop(0, 'rgba(255,230,170,0.9)'); ray.addColorStop(1, 'rgba(255,150,50,0)');
    g.fillStyle = ray; g.beginPath(); g.moveTo(0, -c * 0.07); g.lineTo(L, 0); g.lineTo(0, c * 0.07); g.closePath(); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
