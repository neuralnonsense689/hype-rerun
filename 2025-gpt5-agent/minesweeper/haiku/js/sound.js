/*
 * Sound effects, synthesized with the Web Audio API so there are no audio files to download.
 * The AudioContext is created lazily on the first sound, which always follows a user gesture,
 * so browsers' autoplay rules are respected.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ms.sound';
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
  const lastPlayed = {};

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.3;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function getNoise() {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 1.0, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  /** A single pitched tone with an exponential envelope and optional pitch glide. */
  function tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.1, vol = 0.5, when = 0 }) {
    const c = ensure();
    if (!c || !enabled) return;
    const t = c.currentTime + when;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Filtered noise burst, used for clicks and explosions. */
  function noise({ dur = 0.2, vol = 0.5, when = 0, cutoff = 1200, type = 'lowpass' }) {
    const c = ensure();
    if (!c || !enabled) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = getNoise();
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
    src.stop(t + dur + 0.05);
  }

  /** Skips a sound if the same one just played, so bursts of reveals don't pile up. */
  function throttled(name, ms, fn) {
    const now = performance.now();
    if (lastPlayed[name] && now - lastPlayed[name] < ms) return;
    lastPlayed[name] = now;
    fn();
  }

  const sfx = {
    reveal(count = 1) {
      throttled('reveal', 35, () => {
        const pitch = count > 6 ? 380 : 520;
        tone({ type: 'sine', freq: pitch, freqEnd: pitch * 0.5, dur: 0.08, vol: 0.35 });
        if (count > 6) noise({ dur: 0.12, vol: 0.12, cutoff: 2500, type: 'bandpass' });
      });
    },
    chord() {
      throttled('chord', 60, () => {
        tone({ type: 'triangle', freq: 660, freqEnd: 330, dur: 0.07, vol: 0.3 });
        tone({ type: 'triangle', freq: 520, freqEnd: 260, dur: 0.07, vol: 0.25, when: 0.05 });
      });
    },
    flag() {
      throttled('flag', 30, () => tone({ type: 'square', freq: 1400, freqEnd: 900, dur: 0.04, vol: 0.08 }));
    },
    unflag() {
      throttled('unflag', 30, () => tone({ type: 'square', freq: 700, freqEnd: 480, dur: 0.04, vol: 0.08 }));
    },
    click() {
      throttled('click', 30, () => tone({ type: 'square', freq: 1000, dur: 0.02, vol: 0.05 }));
    },
    explode() {
      noise({ dur: 1.0, vol: 0.9, cutoff: 900 });
      tone({ type: 'sawtooth', freq: 140, freqEnd: 30, dur: 0.7, vol: 0.45 });
    },
    win() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, k) => tone({ type: 'triangle', freq: f, dur: 0.22, vol: 0.35, when: k * 0.12 }));
      tone({ type: 'triangle', freq: 1046.5, dur: 0.6, vol: 0.3, when: 0.5 });
    },
    lose() {
      tone({ type: 'sawtooth', freq: 420, freqEnd: 90, dur: 0.9, vol: 0.3 });
    },
    token() {
      // Surprise sparkle: a fast rising arpeggio.
      [1046.5, 1318.5, 1568, 2093].forEach((f, k) => tone({ type: 'sine', freq: f, dur: 0.12, vol: 0.25, when: k * 0.05 }));
    },
    shield() {
      tone({ type: 'sine', freq: 880, dur: 0.5, vol: 0.35 });
      tone({ type: 'sine', freq: 1320, dur: 0.4, vol: 0.2, when: 0.03 });
      noise({ dur: 0.15, vol: 0.2, cutoff: 6000, type: 'highpass' });
    },
    scan() {
      tone({ type: 'sine', freq: 300, freqEnd: 1200, dur: 0.35, vol: 0.25 });
    },
    armed() {
      tone({ type: 'triangle', freq: 660, dur: 0.08, vol: 0.2 });
      tone({ type: 'triangle', freq: 990, dur: 0.12, vol: 0.2, when: 0.08 });
    },
    lucky() {
      tone({ type: 'triangle', freq: 660, freqEnd: 990, dur: 0.2, vol: 0.3 });
      tone({ type: 'sine', freq: 1320, dur: 0.25, vol: 0.15, when: 0.12 });
    },
    isEnabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
      if (on) sfx.click();
    },
  };

  window.Sound = sfx;
})();
