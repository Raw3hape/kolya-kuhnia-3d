// Procedural ambience, initiated only by a user interaction.
export function createSaunaAudio() {
  let context, source, filter, volume, lastMix, muted = false, disposed = false;
  function unlock() {
    if (disposed || muted) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!context && Audio) {
      context = new Audio();
      const buffer = context.createBuffer(1, 3 * context.sampleRate, context.sampleRate);
      const samples = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < samples.length; i++) {
        previous = 0.976 * previous + 0.024 * (2 * Math.random() - 1);
        samples[i] = previous;
      }
      const fade = Math.floor(context.sampleRate * 0.025);
      for (let i = 0; i < fade; i++) {
        samples[i] *= i / fade;
        samples[samples.length - 1 - i] *= i / fade;
      }
      source = context.createBufferSource();
      source.buffer = buffer; source.loop = true;
      filter = context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 680; filter.Q.value = .5;
      volume = context.createGain();
      volume.gain.value = 0;
      source.connect(filter).connect(volume).connect(context.destination);
      source.start();
    }
    if (context?.state === 'suspended') context.resume().catch(() => {});
  }

  function update(zone, inPool, silent) {
    if (!context) return;
    const close = zone === 'pool' || zone === 'plunge';
    const frequency = inPool ? 160 : close ? 950 : zone === 'steam' ? 570 : 350;
    const gain = silent || muted ? 0 : inPool ? .13 : close ? .095 : .049;
    const key = frequency + ',' + gain;
    if (lastMix === key) return;
    lastMix = key;
    const time = context.currentTime;
    filter.frequency.setTargetAtTime(frequency, time, .25);
    volume.gain.setTargetAtTime(gain, time, .25);
  }

  return { unlock, update, get muted() { return muted; },
    toggle() { muted = !muted; unlock(); },
    dispose() { disposed = true; source?.stop(); context?.close().catch(() => {}); },
  };
}
