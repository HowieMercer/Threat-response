/* Audio, synthesised at runtime.
 *
 * No audio files. Not a purity exercise — a sample set is the single
 * biggest thing that would break the one-file constraint, and the Web
 * Audio API can produce everything this game needs from oscillators and
 * a noise buffer.
 *
 * The bed is adaptive: a low drone plus a pulse whose tempo tracks the
 * intrusion depth. That is the thing that makes a stage feel like it is
 * closing in, and it does it without anything on screen moving. Turn the
 * sound off at a stand and the game is noticeably less tense, which is
 * how you know it is doing work.
 */

const KEY = 'nable_tr_audio';

export function createAudio() {
  let ctx = null;
  let master = null;
  let bedGain = null;
  let drone = null;
  let pulseTimer = null;
  let depth = 0;
  let started = false;

  let settings = { muted: false, volume: 0.7 };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) settings = { ...settings, ...saved };
  } catch {
    /* Private browsing, or storage disabled. Defaults are fine. */
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {}
  }

  /* The context can only be created inside a user gesture on iOS, so
   * everything here is lazy and every entry point is safe to call before
   * the player has touched anything. */
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = settings.muted ? 0 : settings.volume;
    master.connect(ctx.destination);
    bedGain = ctx.createGain();
    bedGain.gain.value = 0;
    bedGain.connect(master);
    return ctx;
  }

  function noiseBuffer(seconds = 1) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function tone({ freq = 440, to = null, type = 'sine', dur = 0.14, gain = 0.16, delay = 0, curve = 'exp' }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    else g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise({ dur = 0.3, gain = 0.18, hp = 200, lp = 3000, delay = 0 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(Math.max(0.2, dur));
    const g = ctx.createGain();
    const f1 = ctx.createBiquadFilter();
    const f2 = ctx.createBiquadFilter();
    f1.type = 'highpass';
    f1.frequency.value = hp;
    f2.type = 'lowpass';
    f2.frequency.value = lp;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f1).connect(f2).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* ------------------------------------------------------------- the bed */

  function startBed() {
    if (!ensure() || started) return;
    started = true;
    if (ctx.state === 'suspended') ctx.resume();

    drone = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    drone.type = 'sawtooth';
    drone.frequency.value = 55;
    sub.type = 'sine';
    sub.frequency.value = 27.5;
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 4;
    drone.connect(lp);
    sub.connect(lp);
    lp.connect(bedGain);
    drone.start();
    sub.start();
    bedGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.2);
    schedulePulse();
  }

  /* Heartbeat. 84 BPM at rest, 168 at the point of impact. The tempo is
   * the readout; the player never has to be told the attacker is close. */
  function schedulePulse() {
    clearTimeout(pulseTimer);
    const bpm = 84 + depth * 0.84;
    const interval = 60000 / bpm;
    pulseTimer = setTimeout(() => {
      if (started && !settings.muted) {
        tone({ freq: 44 + depth * 0.2, to: 30, type: 'sine', dur: 0.16, gain: 0.05 + depth * 0.0009 });
      }
      schedulePulse();
    }, interval);
  }

  /* ------------------------------------------------------------- cues */

  const api = {
    get settings() {
      return { ...settings };
    },
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    startBed,
    stopBed() {
      clearTimeout(pulseTimer);
      if (bedGain && ctx) bedGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      started = false;
    },
    /* 0-100, straight from the engine's intrusion depth. */
    setDepth(v) {
      depth = Math.max(0, Math.min(100, v));
      if (bedGain && ctx) {
        bedGain.gain.setTargetAtTime(0.05 + (depth / 100) * 0.07, ctx.currentTime, 0.6);
      }
    },
    setMuted(m) {
      settings.muted = !!m;
      if (master && ctx) master.gain.setTargetAtTime(settings.muted ? 0 : settings.volume, ctx.currentTime, 0.05);
      persist();
    },
    setVolume(v) {
      settings.volume = Math.max(0, Math.min(1, v));
      if (master && ctx && !settings.muted) master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.05);
      persist();
    },

    hover() {
      tone({ freq: 900, type: 'sine', dur: 0.04, gain: 0.03 });
    },
    tap() {
      tone({ freq: 620, to: 880, type: 'triangle', dur: 0.07, gain: 0.1 });
    },
    /* Lead and backup get different confirmations so a player learns which
     * slot they just filled without reading the label. */
    lead() {
      tone({ freq: 330, to: 494, type: 'square', dur: 0.11, gain: 0.07 });
      noise({ dur: 0.1, gain: 0.05, hp: 1800, lp: 7000 });
    },
    backup() {
      tone({ freq: 494, to: 659, type: 'square', dur: 0.13, gain: 0.07 });
    },
    contained() {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.1, delay: i * 0.07 })
      );
    },
    perfect() {
      [523, 659, 784, 1047, 1319].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.42, gain: 0.11, delay: i * 0.06 })
      );
      noise({ dur: 0.5, gain: 0.05, hp: 2400, lp: 9000, delay: 0.1 });
    },
    mitigated() {
      tone({ freq: 392, type: 'triangle', dur: 0.2, gain: 0.09 });
      tone({ freq: 466, type: 'triangle', dur: 0.26, gain: 0.08, delay: 0.09 });
    },
    breach() {
      noise({ dur: 0.6, gain: 0.22, hp: 60, lp: 1400 });
      tone({ freq: 180, to: 44, type: 'sawtooth', dur: 0.7, gain: 0.16 });
      tone({ freq: 92, to: 30, type: 'square', dur: 0.5, gain: 0.1, delay: 0.05 });
    },
    alarm() {
      for (let i = 0; i < 2; i++) {
        tone({ freq: 880, to: 660, type: 'square', dur: 0.14, gain: 0.11, delay: i * 0.18 });
      }
    },
    injectHit() {
      tone({ freq: 1200, to: 1600, type: 'triangle', dur: 0.12, gain: 0.1 });
    },
    injectMiss() {
      tone({ freq: 220, to: 120, type: 'sawtooth', dur: 0.3, gain: 0.12 });
    },
    hold() {
      tone({ freq: 300, to: 180, type: 'sine', dur: 0.3, gain: 0.09 });
      noise({ dur: 0.28, gain: 0.06, hp: 300, lp: 1600 });
    },
    scan() {
      tone({ freq: 700, to: 1500, type: 'sine', dur: 0.26, gain: 0.06 });
    },
    countdown(n) {
      tone({ freq: n === 0 ? 180 : 520 + n * 60, type: 'square', dur: n === 0 ? 0.5 : 0.13, gain: 0.13 });
    },
    reveal() {
      [262, 392, 523].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.9, gain: 0.09, delay: i * 0.11 }));
    },
    closed() {
      tone({ freq: 140, to: 55, type: 'sine', dur: 1.8, gain: 0.14 });
      noise({ dur: 1.6, gain: 0.06, hp: 40, lp: 500 });
    },
  };

  return api;
}
