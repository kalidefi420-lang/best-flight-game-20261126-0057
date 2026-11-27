// All sound is made, not loaded: a WebAudio engine hum whose pitch follows
// the throttle, and short blips for rings, landings, warnings and crashes.
// Nothing is fetched, nothing is stored; the first key press unlocks the
// AudioContext, as browsers require.
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;
  let muted = false;
  let unlocked = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 52;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      return true;
    } catch {
      return false;
    }
  }

  function unlock() {
    if (unlocked) return;
    if (!ensure()) return;
    unlocked = true;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, dur, type, vol, when = 0) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noiseBurst(dur, vol, cutoff) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  function update(throttle, speedKts, onGround) {
    if (!ctx || !engineOsc) return;
    const target = muted || onGround ? 0 : 0.045 + throttle * 0.075;
    engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
    engineOsc.frequency.setTargetAtTime(46 + throttle * 62 + speedKts * 0.12, ctx.currentTime, 0.15);
    engineFilter.frequency.setTargetAtTime(280 + throttle * 900, ctx.currentTime, 0.2);
  }

  function ring() {
    tone(880, 0.16, 'sine', 0.22);
    tone(1318, 0.24, 'sine', 0.18, 0.07);
  }
  function click() {
    tone(660, 0.06, 'square', 0.08);
  }
  function land() {
    noiseBurst(0.28, 0.3, 420);
    tone(96, 0.3, 'sine', 0.3);
  }
  function crash() {
    noiseBurst(0.7, 0.5, 900);
    tone(58, 0.6, 'sawtooth', 0.22);
  }
  function warn() {
    tone(520, 0.12, 'square', 0.1);
    tone(520, 0.12, 'square', 0.1, 0.16);
  }
  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  return { unlock, update, ring, click, land, crash, warn, toggleMute };
}
