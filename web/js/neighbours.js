// Соседи за стенами и звонок в дверь («Живой дом», ядро — life.js). Только звук, синтез WebAudio (файлов нет).
//   create(core) -> { update(dt) -> false (кадров не просит), ring(kind?), play(kind?), dispose() }
// Соседи: квартира слева штробит, сверлит перфоратором, пилит и стучит молотком; сверху двигают мебель, роняют
// и стучат; справа ругаются (два приглушённых голоса). Каждый звук — из точки за стеной (панорама по направлению)
// через фильтр «сквозь бетон», с паузами 45–150 с, громкость умеренная.
// Звонок — раз в три минуты (±45 с): «дзынь-дон», советский дребезжащий звонок или нетерпеливая серия. Звонит у входной двери.
// Пока входная дверь открыта, не звонят (гости уже здесь — landing.js). Первый звонок в прогулке — подсказка внизу.
// Правило звука держит ядро: после жеста пользователя, в прогулке или «всегда» (настройка «Соседи и звонки»).

const rand = (a, b) => a + Math.random() * (b - a);
const pickW = list => { let s = 0; for (const x of list) s += x[1]; let r = Math.random() * s; for (const x of list) if ((r -= x[1]) <= 0) return x[0]; return list[0][0]; };

const GAP = [45, 150];      // пауза между звуками соседей, с
const FIRST = [24, 60];     // первый звук после старта
const BELL = [135, 225];    // звонок: раз в три минуты ± 45 с
const LEVEL = 0.5;          // общий уровень соседей (до панорамы)

export function create(L) {
  const { plan } = L;
  // Соседи: где (точка за стеной, м), что делают (вес), насколько глушит стена (Гц)
  const b = bounds(plan);
  const FLATS = [
    { id: 'left', at: () => [b.x0 - 0.6, 1.3, rand(b.z0 + 0.5, b.z1 - 1.2)], lp: 900, w: 4,
      acts: [['chase', 3], ['perforator', 2], ['hammer', 2], ['saw', 2]] },
    { id: 'up', at: () => [rand(b.x0 + 1, b.x1 - 1), (plan.ceiling ?? 2.64) + 1.1, rand(b.z0 + 1, b.z1 - 1)], lp: 480, w: 3,
      acts: [['drag', 3], ['drop', 2], ['hammer', 2], ['perforator', 1]] },
    { id: 'right', at: () => [b.x1 + 0.7, 1.5, rand(b.z0 + 0.8, b.z1 - 0.8)], lp: 750, w: 3,
      acts: [['argue', 5], ['drop', 1]] },
    { id: 'down', at: () => [rand(b.x0 + 1, b.x1 - 1), -1.1, rand(b.z0 + 1, b.z1 - 1)], lp: 420, w: 1,
      acts: [['perforator', 2], ['argue', 1]] },
  ];
  const entry = plan.openings.find(o => o.type === 'entry');
  const BELL_AT = entry ? [(entry.x0 + entry.x1) / 2, 2.25, entry.z0 - 0.25] : [b.x0 + 0.5, 2.2, b.z1 - 0.5];

  let t = 0, nextNeigh = rand(...FIRST), nextBell = rand(...BELL), busyUntil = 0;
  let network = null, eventSeq = 0;
  const events = [], seenEvents = new Set();
  const record = event => {
    if (!network?.authority) return;
    events.push({ ...event, id: ++eventSeq, at: t });
    while (events.length > 16) events.shift();
  };
  const live = new Set();   // узлы текущих звуков: снять при dispose

  function update(dt) {
    t += dt;
    if (network && !network.authority) return false;
    if (t >= nextNeigh) {
      if ((L.audio.neighOk || network?.authority) && t >= busyUntil) { play(); nextNeigh = t + rand(...GAP); } else nextNeigh = t + 5;
    }
    if (t >= nextBell) {
      nextBell = t + rand(...BELL);
      const open = L.doors?.list?.find(d => d.id === entry?.id)?.open;
      if ((L.audio.neighOk || network?.authority) && !open) ring();
    }
    return false;
  }

  // ---------- соседи ----------
  function play(kind, remote = null) {
    if (network && !network.authority && !remote) return 0;
    const ctx = L.audio.ctx;
    const flat = remote ? FLATS.find(f => f.id === remote.flat) ?? FLATS[0] : kind ? FLATS.find(f => f.acts.some(a => a[0] === kind)) ?? FLATS[0] : pickW(FLATS.map(f => [f, f.w]));
    const act = kind || pickW(flat.acts);
    const [x, y, z] = remote?.position ?? flat.at();
    record({ type: 'neighbour', kind: act, flat: flat.id, position: [x, y, z] });
    if (!ctx || !L.audio.neighOk) return 0;
    const pan = L.audio.panner(x, y, z, { bus: 'neigh', ref: 2.2, rolloff: 1, max: 30 });
    const wall = ctx.createBiquadFilter(); wall.type = 'lowpass'; wall.frequency.value = flat.lp * rand(0.85, 1.15); wall.Q.value = 0.5;
    const out = ctx.createGain(); out.gain.value = LEVEL;
    out.connect(wall).connect(pan);
    const t0 = ctx.currentTime + 0.05;
    const end = SYNTH[act](ctx, out, t0, L.audio.noise);
    busyUntil = t + (end - t0) + 1;
    track([out, wall, pan], end);
    return end - t0;
  }
  function track(nodes, end) {
    const rec = { nodes };
    live.add(rec);
    rec.timer = setTimeout(() => { for (const n of nodes) try { n.disconnect(); } catch { /* уже снят */ } live.delete(rec); },
      (end - L.audio.ctx.currentTime + 0.6) * 1000);
  }

  // ---------- звонок ----------
  function ring(kind, remote = null) {
    if (network && !network.authority && !remote) return;
    const ctx = L.audio.ctx;
    kind ||= pickW([['dingdong', 5], ['buzzer', 3], ['impatient', 2], ['tune', 1]]);
    record({ type: 'bell', kind });
    if (!ctx || !L.audio.neighOk) return;
    const pan = L.audio.panner(...BELL_AT, { bus: 'neigh', ref: 1.2, rolloff: 1, max: 30 });
    const out = ctx.createGain(); out.gain.value = 0.55; out.connect(pan);
    const end = BELLS[kind](ctx, out, ctx.currentTime + 0.05);
    track([out, pan], end);
    if (L.walk?.active && !L.prefs.bellSeen) {
      L.setPref('bellSeen', true);
      L.notice('Звонят в дверь. Открой, если не боишься');
    }
  }

  function dispose() {
    for (const r of live) { clearTimeout(r.timer); for (const n of r.nodes) try { n.disconnect(); } catch { /* уже снят */ } }
    live.clear();
  }

  function applyNetworkSnapshot(value) {
    if (!value || !network || network.authority) return;
    t = Number(value.time) || 0;
    for (const event of value.events ?? []) {
      if (seenEvents.has(event.id)) continue;
      seenEvents.add(event.id);
      if (t - event.at > 2) continue;
      if (event.type === 'bell') ring(event.kind, event);
      else if (event.type === 'neighbour') play(event.kind, event);
    }
    while (seenEvents.size > 64) seenEvents.delete(seenEvents.values().next().value);
  }
  return { update, ring, play, dispose, snapshot: () => ({ time: t, events: events.slice() }), applyNetworkSnapshot,
    setNetwork(value) { network = value || null; events.length = 0; seenEvents.clear(); } };
}

function bounds(plan) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [id, r] of Object.entries(plan.rooms)) {
    if (id === 'shaft') continue;
    for (const q of r.rects) { x0 = Math.min(x0, q.x0); x1 = Math.max(x1, q.x1); z0 = Math.min(z0, q.z0); z1 = Math.max(z1, q.z1); }
  }
  return { x0, x1, z0, z1 };
}

// ---------- синтез ----------
// Каждая функция: (ctx, out, t0, noise) -> время конца; узлы останавливаются сами (stop), граф снимает track().

function env(g, t, a, peak, hold, rel) {
  g.setValueAtTime(0, t); g.linearRampToValueAtTime(peak, t + a); g.setValueAtTime(peak, t + a + hold); g.linearRampToValueAtTime(0, t + a + hold + rel);
}
function osc(ctx, type, f, t0, t1, dest) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(dest); o.start(t0); o.stop(t1); return o;
}
function filt(ctx, type, f, q, dest) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(dest); return b; }
function gainN(ctx, v, dest) { const g = ctx.createGain(); g.gain.value = v; g.connect(dest); return g; }
function noiseSrc(noise, t0, t1, dest) { const n = noise(true); n.connect(dest); n.start(t0); n.stop(t1); return n; }

const SYNTH = {
  // Штроборез по бетону: визг мотора и шорох диска, 1–3 реза с передышками, разгон и выбег
  chase(ctx, out, t0, noise) {
    const cuts = 1 + Math.floor(Math.random() * 3);
    let t = t0;
    const g = gainN(ctx, 0, out);
    const motor = ctx.createOscillator(); motor.type = 'sawtooth'; motor.frequency.value = 60;
    const mg = gainN(ctx, 0.35, g); motor.connect(filt(ctx, 'bandpass', 900, 0.7, mg));
    const wob = ctx.createOscillator(); wob.frequency.value = rand(5, 9); const wg = gainN(ctx, 4, motor.frequency); wob.connect(wg);
    const nb = filt(ctx, 'bandpass', 1600, 0.6, gainN(ctx, 0.9, g));
    const ng = gainN(ctx, 0, nb);
    const ns = noise(true); ns.connect(ng);
    for (let i = 0; i < cuts; i++) {
      const spin = 0.6, len = rand(2, 5.5);
      motor.frequency.setValueAtTime(60, t); motor.frequency.linearRampToValueAtTime(rand(175, 200), t + spin);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7, t + spin);
      // рез: обороты проседают, шорох громче, рука дрожит
      const tc = t + spin + rand(0.2, 0.6);
      ng.gain.setValueAtTime(0, tc); ng.gain.linearRampToValueAtTime(0.9, tc + 0.25);
      for (let k = 0.3; k < len; k += rand(0.25, 0.6)) motor.frequency.linearRampToValueAtTime(rand(140, 165), tc + k);
      ng.gain.linearRampToValueAtTime(0, tc + len);
      const free = rand(180, 195);
      motor.frequency.linearRampToValueAtTime(free, tc + len + 0.2);
      // выбег
      const te = tc + len + rand(0.3, 1);
      motor.frequency.setValueAtTime(free, te); motor.frequency.exponentialRampToValueAtTime(30, te + 1.4);
      g.gain.setValueAtTime(0.7, te); g.gain.linearRampToValueAtTime(0, te + 1.4);
      t = te + 1.4 + rand(0.6, 2.5);
    }
    for (const n of [motor, wob, ns]) { n.start(t0); n.stop(t); }
    return t;
  },
  // Перфоратор: удары ~35 Гц по бетону, 2–4 захода по 1,5–4 с
  perforator(ctx, out, t0, noise) {
    let t = t0;
    const g = gainN(ctx, 0, out);
    const am = gainN(ctx, 0.5, g);
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = rand(30, 40);
    lfo.connect(gainN(ctx, 0.5, am.gain));
    const ns = noise(true); ns.connect(filt(ctx, 'bandpass', rand(350, 500), 1.2, am));
    const thump = ctx.createOscillator(); thump.type = 'triangle'; thump.frequency.value = 70; thump.connect(gainN(ctx, 0.6, am));
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const len = rand(1.5, 4);
      env(g.gain, t, 0.08, rand(0.6, 0.9), len, 0.15);
      t += len + 0.25 + rand(0.5, 2.2);
    }
    for (const x of [lfo, ns, thump]) { x.start(t0); x.stop(t); }
    return t;
  },
  // Молоток: серии ударов с человеческим ритмом
  hammer(ctx, out, t0, noise) {
    let t = t0;
    const series = 2 + Math.floor(Math.random() * 2);
    for (let s = 0; s < series; s++) {
      const hits = 4 + Math.floor(Math.random() * 7), gap = rand(0.4, 0.75);
      for (let i = 0; i < hits; i++) {
        const big = i === hits - 1 && Math.random() < 0.5;
        hit(ctx, out, t, big ? 1 : rand(0.55, 0.85), noise);
        t += gap * rand(0.85, 1.2) * (big ? 1.4 : 1);
      }
      t += rand(1.2, 3);
    }
    return t;
  },
  // Ножовка: вжик-вжик, «туда» громче, чем «обратно»
  saw(ctx, out, t0, noise) {
    const len = rand(4, 9), rate = rand(1.4, 2);
    const g = gainN(ctx, 0, out);
    const bp = filt(ctx, 'bandpass', 2000, 2.5, g);
    const ns = noiseSrc(noise, t0, t0 + len + 0.3, bp);
    g.gain.setValueAtTime(0, t0);
    let t = t0;
    for (let k = 0; t < t0 + len; k++) {
      const half = 0.5 / rate * rand(0.9, 1.1), push = k % 2 === 0;
      g.gain.linearRampToValueAtTime(push ? 0.9 : 0.55, t + half * 0.45);
      g.gain.linearRampToValueAtTime(0.05, t + half);
      bp.frequency.linearRampToValueAtTime(push ? 2600 : 1800, t + half);
      t += half;
    }
    ns.stop(t + 0.1);
    return t + 0.1;
  },
  // Сверху тащат шкаф: скрежет с рывками, в конце бух
  drag(ctx, out, t0, noise) {
    let t = t0;
    const g = gainN(ctx, 0, out);
    const lp = filt(ctx, 'lowpass', 260, 1, g);
    const ns = noise(true); ns.connect(filt(ctx, 'bandpass', 140, 2, lp));
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const len = rand(0.6, 2);
      g.gain.setValueAtTime(0, t);
      for (let k = 0; k < len; k += 0.08) g.gain.linearRampToValueAtTime(rand(0.8, 1.6), t + k);
      g.gain.linearRampToValueAtTime(0, t + len);
      t += len + rand(0.4, 1.5);
    }
    ns.start(t0); ns.stop(t);
    hit(ctx, out, t, 1, noise, 55);
    return t + 0.6;
  },
  // Уронили что-то тяжёлое: бух и пара отскоков
  drop(ctx, out, t0, noise) {
    let t = t0, k = 1;
    for (let i = 0; i < 3 + Math.floor(Math.random() * 2); i++) { hit(ctx, out, t, k, noise, 60); t += 0.18 * k + 0.05; k *= 0.55; }
    return t + 0.5;
  },
  // Ругаются: два голоса (низкий и высокий) через стену — «бу-бу-бу» с интонацией, перебивают друг друга
  argue(ctx, out, t0) {
    const len = rand(6, 14);
    const voices = [voice(ctx, out, rand(100, 135), t0, t0 + len + 1), voice(ctx, out, rand(195, 250), t0, t0 + len + 1)];
    let t = t0, who = Math.random() < 0.5 ? 0 : 1, heat = rand(0.2, 0.5);
    while (t < t0 + len) {
      const v = voices[who], words = 2 + Math.floor(Math.random() * 6);
      for (let w = 0; w < words; w++) {
        const syl = 1 + Math.floor(Math.random() * 3);
        for (let s = 0; s < syl; s++) {
          const d = rand(0.09, 0.2) * (1 - heat * 0.25);
          v.say(t, d, heat, s === syl - 1 && w === words - 1);
          t += d + rand(0.01, 0.04);
        }
        t += rand(0.04, 0.14);
      }
      heat = Math.min(1, heat + rand(0.05, 0.2));
      t += Math.random() < 0.25 ? -rand(0.1, 0.3) : rand(0.15, 0.6);   // иногда перебивают
      who = 1 - who;
    }
    return t + 0.5;
  },
};

// Удар: короткий низкий «бух» с падением тона и щелчок
function hit(ctx, out, t, k, noise, f = 130) {
  const g = gainN(ctx, 0, out);
  const o = osc(ctx, 'sine', f, t, t + 0.3, g);
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.4, t + 0.1);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.2 * k, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  const cg = gainN(ctx, 0, out);
  noiseSrc(noise, t, t + 0.06, filt(ctx, 'bandpass', 900, 1, cg));
  cg.gain.setValueAtTime(0.7 * k, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
}

// Голос через стену: пила с тоном f0 -> три форманты гласной -> огибающая слога. say(t, длит., накал 0–1, конец фразы)
const VOWELS = [[800, 1200], [500, 900], [350, 700], [550, 1700], [300, 2200], [650, 1100]];
function voice(ctx, out, f0, t0, t1) {
  const src = ctx.createOscillator(); src.type = 'sawtooth'; src.frequency.value = f0;
  const g = gainN(ctx, 0, out);
  const f1 = filt(ctx, 'bandpass', 600, 6, g), f2 = filt(ctx, 'bandpass', 1200, 8, gainN(ctx, 0.5, g)), f3 = filt(ctx, 'bandpass', 2600, 8, gainN(ctx, 0.2, g));
  for (const f of [f1, f2, f3]) src.connect(f);
  const vib = ctx.createOscillator(); vib.frequency.value = rand(4.5, 6); vib.connect(gainN(ctx, f0 * 0.02, src.frequency));
  src.start(t0); src.stop(t1); vib.start(t0); vib.stop(t1);
  return {
    say(t, d, heat, last) {
      const [a, b2] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
      f1.frequency.setTargetAtTime(a, t, 0.015); f2.frequency.setTargetAtTime(b2, t, 0.015);
      const p = f0 * (1 + heat * 0.45) * rand(0.92, 1.12);
      src.frequency.setTargetAtTime(p, t, 0.02);
      src.frequency.setTargetAtTime(last ? p * (Math.random() < 0.5 ? 1.25 : 0.8) : p * rand(0.95, 1.05), t + d * 0.5, 0.05);
      const peak = 0.35 + heat * 0.5;
      g.gain.setTargetAtTime(peak, t, 0.012);
      g.gain.setTargetAtTime(0, t + d, 0.025);
    },
  };
}

// ---------- звонки ----------
function chime(ctx, out, f, t, dur = 1.8, k = 1) {
  for (const [m, a] of [[1, 1], [2.76, 0.22], [5.4, 0.08], [2, 0.12]]) {
    const g = gainN(ctx, 0, out);
    osc(ctx, 'sine', f * m, t, t + dur, g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * a * k, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t + dur / m ** 0.3);
  }
}
function buzz(ctx, out, t, len) {
  const g = gainN(ctx, 0, out);
  const bp = filt(ctx, 'bandpass', 1100, 1.2, g);
  osc(ctx, 'square', 230, t, t + len + 0.05, bp);
  osc(ctx, 'square', 461, t, t + len + 0.05, gainN(ctx, 0.4, bp));
  const trem = ctx.createOscillator(); trem.type = 'square'; trem.frequency.value = 50;
  const tg = gainN(ctx, 0.25, g.gain); trem.connect(tg); trem.start(t); trem.stop(t + len + 0.05);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.01); g.gain.setValueAtTime(0.3, t + len); g.gain.linearRampToValueAtTime(0, t + len + 0.04);
}
const BELLS = {
  dingdong(ctx, out, t) { chime(ctx, out, 659.3, t); chime(ctx, out, 523.3, t + 0.6, 2.2); return t + 2.9; },
  buzzer(ctx, out, t) { buzz(ctx, out, t, rand(0.7, 1.1)); return t + 1.3; },
  impatient(ctx, out, t) {
    let x = t;
    for (let i = 0; i < 3; i++) { buzz(ctx, out, x, 0.22); x += 0.38; }
    buzz(ctx, out, x + 0.3, 1.3);
    return x + 1.8;
  },
  tune(ctx, out, t) {
    const notes = [784, 659.3, 698.5, 523.3];
    notes.forEach((f, i) => chime(ctx, out, f, t + i * 0.42, 1.6, 0.8));
    return t + 3.2;
  },
};

// Для проверок (уровни через OfflineAudioContext)
export const _synth = { SYNTH, BELLS };
