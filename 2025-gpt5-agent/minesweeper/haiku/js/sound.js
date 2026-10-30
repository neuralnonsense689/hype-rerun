/*
 * Sound effects synthesized with the Web Audio API. No audio files are needed.
 * The AudioContext is created lazily, because browsers only allow audio after a user gesture.
 */
(function (global) {
  'use strict';

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let enabled = true;

  function ensure() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 1.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  // Oscillator note with a short attack and exponential decay.
  function tone(freq, dur, o = {}) {
    const t = ctx.currentTime + (o.at || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    const vol = o.vol ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Filtered noise burst, used for clicks and explosions.
  function noise(dur, o = {}) {
    const t = ctx.currentTime + (o.at || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter || 'lowpass';
    filter.frequency.setValueAtTime(o.freq || 1200, t);
    if (o.sweep) filter.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(o.vol ?? 0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, Math.random() * 0.5, dur);
  }

  const SFX = {
    open() {
      noise(0.05, { vol: 0.35, filter: 'highpass', freq: 1800 });
      tone(260, 0.06, { type: 'triangle', vol: 0.12, slide: 180 });
    },
    flag() {
      tone(740, 0.07, { type: 'triangle', vol: 0.25 });
      tone(1100, 0.09, { type: 'triangle', vol: 0.2, at: 0.06 });
    },
    unflag() {
      tone(520, 0.1, { type: 'triangle', vol: 0.2, slide: 380 });
    },
    question() {
      tone(600, 0.08, { type: 'sine', vol: 0.2 });
    },
    explode() {
      noise(1.4, { vol: 0.9, freq: 1400, sweep: 40 });
      tone(90, 1.0, { type: 'sawtooth', vol: 0.35, slide: 25 });
    },
    defuse() {
      tone(1300, 0.12, { type: 'sine', vol: 0.25 });
      tone(1950, 0.25, { type: 'sine', vol: 0.2, at: 0.09 });
      noise(0.1, { vol: 0.2, filter: 'highpass', freq: 3000 });
    },
    lucky() {
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.14, { type: 'triangle', vol: 0.22, at: i * 0.07 }));
    },
    sonar() {
      tone(1400, 0.6, { type: 'sine', vol: 0.25, slide: 700 });
      tone(1400, 0.6, { type: 'sine', vol: 0.12, slide: 700, at: 0.4 });
    },
    magnet() {
      tone(180, 0.3, { type: 'square', vol: 0.12, slide: 620 });
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { vol: 0.18, at: i * 0.12 }));
      tone(1047, 0.6, { vol: 0.16, at: 0.5 });
      tone(784, 0.6, { vol: 0.12, at: 0.5 });
    },
    record() {
      [659, 784, 988, 1319, 988, 1319].forEach((f, i) => tone(f, 0.14, { vol: 0.18, at: i * 0.1 }));
    },
  };

  global.Sound = {
    unlock: ensure,
    setEnabled(on) {
      enabled = on;
    },
    play(name) {
      if (!enabled || !SFX[name] || !ensure()) return;
      SFX[name]();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
