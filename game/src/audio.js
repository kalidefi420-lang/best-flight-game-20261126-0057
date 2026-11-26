// Sound with no audio files: a WebAudio engine hum that follows the throttle, wind
// that follows the airspeed, and short chimes for rings, landings and warnings.
// Everything is built on the first user gesture; muted stays muted.
export function createAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let windGain = null;
  let windSrc = null;
  let muted = false;
  let started = false;

  function ensure() {
    if (started) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      // Engine: two detuned saws through a lowpass, quiet at idle, loud at full chat.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 52;
      engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'sawtooth';
      engineOsc2.frequency.value = 78;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(lp);
      engineOsc2.connect(lp);
      lp.connect(engineGain);
      engineGain.connect(ctx.destination);
      engineOsc.start();
      engineOsc2.start();
      // Wind: looped filtered noise, louder the faster you fly.
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      windSrc = ctx.createBufferSource();
      windSrc.buffer = buf;
      windSrc.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.6;
      windGain = ctx.createGain();
      windGain.gain.value = 0;
      windSrc.connect(bp);
      bp.connect(windGain);
      windGain.connect(ctx.destination);
      windSrc.start();
      started = true;
      return true;
    } catch {
      return false;
    }
  }

  function blip(freq, when, dur, vol, type = 'sine') {
    if (!ctx || muted) return;
    try {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, ctx.currentTime + when);
      g.gain.linearRampToValueAtTime(vol, ctx.currentTime + when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(ctx.currentTime + when);
      o.stop(ctx.currentTime + when + dur + 0.05);
    } catch { /* sound is decoration; never break the game */ }
  }

  return {
    /** Call on the first gesture (start button / keypress) so audio may begin. */
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    /** Continuous levels, called every frame: throttle 0..1, speed knots. */
    update(throttle, speedKts, onGround) {
      if (!ctx || muted) return;
      try {
        const t = ctx.currentTime;
        engineGain.gain.setTargetAtTime(onGround ? throttle * 0.05 : 0.02 + throttle * 0.075, t, 0.1);
        engineOsc.frequency.setTargetAtTime(46 + throttle * 68, t, 0.1);
        engineOsc2.frequency.setTargetAtTime(69 + throttle * 102, t, 0.1);
        const wind = onGround ? 0 : Math.min(0.11, speedKts * 0.00045);
        windGain.gain.setTargetAtTime(wind, t, 0.2);
      } catch { /* ignore */ }
    },
    ring() { blip(880, 0, 0.18, 0.22); blip(1318, 0.07, 0.24, 0.2); },
    land() { blip(392, 0, 0.3, 0.25); blip(523, 0.1, 0.4, 0.22); },
    crash() { blip(110, 0, 0.5, 0.3, 'square'); blip(82, 0.12, 0.6, 0.25, 'square'); },
    warn() { blip(660, 0, 0.12, 0.18, 'square'); blip(660, 0.16, 0.12, 0.18, 'square'); },
    click() { blip(1200, 0, 0.06, 0.12); },
    toggleMute() {
      muted = !muted;
      if (ctx && engineGain) engineGain.gain.value = 0;
      if (ctx && windGain) windGain.gain.value = 0;
      return muted;
    },
    get isMuted() { return muted; },
  };
}
