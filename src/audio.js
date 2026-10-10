export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function context() {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
    return ctx;
  }

  function tone(freq, duration, type, gainValue, slideTo) {
    if (muted) return;
    const audio = context();
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), now + duration);
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function noise(duration, gainValue) {
    if (muted) return;
    const audio = context();
    const frames = Math.floor(audio.sampleRate * duration);
    const buffer = audio.createBuffer(1, frames, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = audio.createGain();
    gain.gain.value = gainValue;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
  }

  return {
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = value;
    },
    resume() {
      if (muted) return;
      try {
        context().resume();
      } catch {
        /* Autoplay can reject before a gesture. */
      }
    },
    start() {
      try {
        tone(392, 0.09, 'triangle', 0.12);
        tone(523.25, 0.14, 'sine', 0.08);
      } catch {
        /* Ignore audio graph failures. */
      }
    },
    eat(score) {
      const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      const freq = scale[Math.floor(score / 10) % scale.length];
      try {
        tone(freq, 0.13, 'triangle', 0.15);
        tone(freq * 2, 0.1, 'sine', 0.045);
      } catch {
        /* Ignore audio graph failures. */
      }
    },
    die() {
      try {
        tone(196, 0.38, 'sawtooth', 0.06, 55);
        noise(0.28, 0.08);
      } catch {
        /* Ignore audio graph failures. */
      }
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
        window.setTimeout(() => {
          try {
            tone(freq, 0.18, 'triangle', 0.12);
          } catch {
            /* Ignore audio graph failures. */
          }
        }, index * 90);
      });
    },
  };
}
