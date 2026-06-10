/**
 * All audio is synthesized — no assets. Context unlocks on first gesture
 * (iOS requirement); everything routes through a master gain for mute.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let crowdGain: GainNode | null = null;
let crowdSrc: AudioBufferSourceNode | null = null;
let enabled = true;

export function setSound(on: boolean) {
  enabled = on;
  if (master) master.gain.value = on ? 1 : 0;
}

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = enabled ? 1 : 0;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

function noiseBuffer(seconds: number, lp = 1): AudioBuffer {
  const sr = ctx!.sampleRate;
  const buf = ctx!.createBuffer(1, sr * seconds, sr);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * lp + white * (1 - lp);
    d[i] = last * 3;
  }
  return buf;
}

export function startCrowd() {
  if (!ctx || crowdSrc) return;
  crowdSrc = ctx.createBufferSource();
  crowdSrc.buffer = noiseBuffer(3, 0.97);
  crowdSrc.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 900;
  crowdGain = ctx.createGain();
  crowdGain.gain.value = 0.045;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.012;
  lfo.connect(lfoG).connect(crowdGain.gain);
  crowdSrc.connect(filt).connect(crowdGain).connect(master!);
  crowdSrc.start();
  lfo.start();
}

export function stopCrowd() {
  try { crowdSrc?.stop(); } catch { /* already stopped */ }
  crowdSrc = null;
  crowdGain = null;
}

/** crowd surge: 0.3 ooh, 1 full roar */
export function cheer(intensity: number) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(1.6, 0.96);
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 600 + intensity * 500;
  filt.Q.value = 0.6;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12 + intensity * 0.22, t + 0.18);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3 + intensity * 0.5);
  src.connect(filt).connect(g).connect(master!);
  src.start();
}

export function whistle(blasts = 1) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (let b = 0; b < blasts; b++) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    const vib = ctx.createOscillator();
    vib.frequency.value = 38;
    const vibG = ctx.createGain();
    vibG.gain.value = 90;
    vib.connect(vibG).connect(osc.frequency);
    osc.frequency.value = 2350;
    const g = ctx.createGain();
    const t = t0 + b * 0.34;
    const dur = b === blasts - 1 ? 0.5 : 0.18;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    vib.start(t);
    vib.stop(t + dur + 0.05);
  }
}

/** kick contact; power 0..1 */
export function thock(power: number) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(170 + power * 70, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.18 + power * 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(g).connect(master!);
  osc.start(t);
  osc.stop(t + 0.14);
  const click = ctx.createBufferSource();
  click.buffer = noiseBuffer(0.05, 0.3);
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.06 + power * 0.07, t);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  click.connect(cg).connect(master!);
  click.start(t);
}

export function ping() {
  // woodwork
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const f of [1180, 1192]) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(g).connect(master!);
    osc.start(t);
    osc.stop(t + 0.55);
  }
}

export function tick() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.03, 0.1);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.07, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  src.connect(hp).connect(g).connect(master!);
  src.start(t);
}

export function thud() {
  // a save / body block
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(110, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(g).connect(master!);
  osc.start(t);
  osc.stop(t + 0.2);
}
