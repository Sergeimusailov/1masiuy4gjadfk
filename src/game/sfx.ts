// Маленький синтезатор звуков на WebAudio — вместо аудиофайлов.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as AudioContext;
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', delay = 0, vol = 1, slideTo?: number) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(dur: number, vol = 0.4, delay = 0, freq = 2000) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  unlock: () => audio(),
  click: () => tone(660, 0.08, 'triangle', 0, 0.5, 880),
  pop: () => tone(420, 0.14, 'sine', 0, 0.8, 900),
  plant: () => {
    noise(0.18, 0.5, 0, 900);
    tone(300, 0.12, 'sine', 0.05, 0.5, 520);
  },
  harvest: () => {
    noise(0.12, 0.4, 0, 3500);
    tone(520, 0.1, 'triangle', 0, 0.5, 780);
    tone(780, 0.14, 'triangle', 0.07, 0.45, 1040);
  },
  coin: (i = 0) => {
    tone(1318, 0.09, 'square', i * 0.0, 0.12);
    tone(1976, 0.18, 'square', 0.06, 0.1);
  },
  build: () => {
    noise(0.3, 0.6, 0, 400);
    tone(140, 0.25, 'sine', 0, 0.8, 70);
  },
  error: () => {
    tone(220, 0.12, 'square', 0, 0.15);
    tone(180, 0.18, 'square', 0.1, 0.15);
  },
  cluck: () => {
    tone(700, 0.07, 'square', 0, 0.12, 500);
    tone(820, 0.09, 'square', 0.1, 0.12, 560);
  },
  whoosh: () => noise(0.35, 0.35, 0, 1200),
  levelUp: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', i * 0.1, 0.5));
    tone(1318, 0.6, 'triangle', 0.42, 0.45);
  },
};
