// One audio context, one music source and one water loop. No polling or remote streams.
import { assetUrl } from './loading.js';
export function createSocialAudio({ camera, spec, locations, isAudible }) {
  let context = null, master = null, musicGain = null, waterGain = null, music = null, water = null;
  let generation = 0, station = -1, enabled = false, disposed = false, current = null, status = 'Нажмите любую клавишу для звука';
  const buffers = new Map(), effects = new Set();
  function unlock() {
    if (disposed) return;
    if (!context) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      context = new AC(); master = context.createGain();
      const limiter = context.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.ratio.value = 8;
      master.connect(limiter).connect(context.destination);
      musicGain = context.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
      waterGain = context.createGain(); waterGain.gain.value = 0; waterGain.connect(master);
      const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate), data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2800;
      water = context.createBufferSource(); water.buffer = noise; water.loop = true; water.connect(filter).connect(waterGain); water.start();
    }
    context.resume().then(() => { status = ''; if (current) sync(current); }).catch(() => { status = 'Нажмите для звука'; });
  }
  for (const event of ['pointerdown', 'keydown']) addEventListener(event, unlock, { capture: true });
  function stopMusic() { generation++; try { music?.stop(); } catch { /* ended */ } music?.disconnect(); music = null; }
  function sync(value) {
    current = value;
    if (!context || context.state !== 'running') return;
    const radio = value.radio;
    if (!radio.playing) { if (music || enabled) stopMusic(); enabled = false; return; }
    if (enabled && station === radio.station) return;
    stopMusic(); station = radio.station; enabled = true; status = 'Настраиваем волну…';
    const version = generation, entry = spec.radio.stations[station];
    if (!buffers.has(station)) buffers.set(station, fetch(assetUrl(entry.url)).then(r => { if (!r.ok) throw Error('audio'); return r.arrayBuffer(); }).then(data => context.decodeAudioData(data)));
    buffers.get(station).then(buffer => {
      if (disposed || version !== generation || !enabled) return;
      music = context.createBufferSource(); music.buffer = buffer; music.loop = true; music.connect(musicGain);
      music.start(0, Math.max(0, current.time - current.radio.since) % buffer.duration); status = '';
    }).catch(() => { if (version === generation) { buffers.delete(station); status = 'Музыка не загрузилась · включите ещё раз'; } });
  }
  const attenuation = point => 1 / (1 + (Math.hypot(camera.position.x - point[0], camera.position.y - point[1], camera.position.z - point[2]) / spec.radio.distance) ** 2);
  function update(value, showerPoint) {
    if (!context) return;
    const now = context.currentTime, audible = isAudible();
    master.gain.setTargetAtTime(audible ? 1 : 0, now, 0.06);
    musicGain.gain.setTargetAtTime(value.radio.playing && value.radio.position ? value.radio.volume * 0.75 * attenuation(value.radio.position) : 0, now, 0.08);
    waterGain.gain.setTargetAtTime(value.shower.owner && showerPoint ? 0.09 * attenuation(showerPoint) : 0, now, 0.1);
  }
  function bell() {
    if (!context || context.state !== 'running' || !isAudible()) return;
    // Three insistent ding-dongs, capped by the shared bell cadence.
    for (let i = 0; i < 6; i++) {
      const source = context.createOscillator(), gain = context.createGain(); effects.add(source);
      source.type = 'sine'; source.frequency.value = i % 2 ? 660 : 880;
      const at = context.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.001, at); gain.gain.exponentialRampToValueAtTime(0.48 * attenuation(locations.delivery), at + 0.008); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.8);
      source.connect(gain).connect(master); source.start(at); source.stop(at + 0.81);
      source.onended = () => { effects.delete(source); source.disconnect(); gain.disconnect(); };
    }
  }
  function visibility() {
    if (!context) return;
    if (document.hidden) master.gain.setTargetAtTime(0, context.currentTime, 0.03);
    else if (context.state === 'suspended') unlock();
  }
  document.addEventListener('visibilitychange', visibility);
  return { sync, update, bell, unlock, get status() { return status; },
    get debug() { return { context: context?.state, music: !!music, station, loaded: buffers.size }; },
    dispose() { disposed = true; document.removeEventListener('visibilitychange', visibility); for (const event of ['pointerdown', 'keydown']) removeEventListener(event, unlock, { capture: true }); stopMusic(); water?.stop(); for (const source of effects) try { source.stop(); } catch { /* ended */ } effects.clear(); context?.close(); buffers.clear(); } };
}
