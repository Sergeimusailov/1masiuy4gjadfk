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

/**
 * «Голос» животного: пилообразная волна через фильтр низких частот,
 * с вибрато (дрожание высоты) и тремоло (дрожание громкости).
 */
function voice(o: {
  from: number;
  to: number;
  dur: number;
  lowpass: number;
  vibRate?: number;
  vibDepth?: number;
  tremRate?: number;
  tremDepth?: number;
  vol?: number;
  delay?: number;
}) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + (o.delay ?? 0);
  const osc = a.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(o.from, t);
  osc.frequency.linearRampToValueAtTime(o.to, t + o.dur);
  const vib = a.createOscillator();
  const vibGain = a.createGain();
  vib.frequency.value = o.vibRate ?? 5;
  vibGain.gain.value = o.vibDepth ?? 0;
  vib.connect(vibGain).connect(osc.frequency);
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = o.lowpass;
  lp.Q.value = 4;
  const env = a.createGain();
  const vol = o.vol ?? 0.5;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vol, t + 0.08);
  env.gain.setValueAtTime(vol, t + o.dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  let out: AudioNode = env;
  if (o.tremRate) {
    const trem = a.createGain();
    const lfo = a.createOscillator();
    const depth = a.createGain();
    trem.gain.value = 1 - (o.tremDepth ?? 0.5);
    lfo.frequency.value = o.tremRate;
    depth.gain.value = o.tremDepth ?? 0.5;
    lfo.connect(depth).connect(trem.gain);
    env.connect(trem);
    out = trem;
    lfo.start(t);
    lfo.stop(t + o.dur + 0.05);
  }
  osc.connect(lp).connect(env);
  out.connect(master);
  osc.start(t);
  vib.start(t);
  osc.stop(t + o.dur + 0.05);
  vib.stop(t + o.dur + 0.05);
}

// ---------------------------------------------------------------- записанные звуки

/**
 * Настоящие записи лежат в public/sounds. Если файла нет или он не загрузился,
 * играет синтезированный вариант, так что игра звучит в любом случае.
 */
const SAMPLE_FILES = { moo: 'sounds/moo.mp3', baa: 'sounds/baa.mp3', cluck: 'sounds/cluck.mp3' } as const;
type SampleId = keyof typeof SAMPLE_FILES;
const samples = new Map<SampleId, AudioBuffer | null>();

async function loadSample(id: SampleId) {
  const a = audio();
  if (!a || samples.has(id)) return;
  samples.set(id, null);
  try {
    const res = await fetch(SAMPLE_FILES[id]);
    if (!res.ok) return;
    samples.set(id, await a.decodeAudioData(await res.arrayBuffer()));
  } catch {
    // файла нет — остаётся синтез
  }
}

/** Играет запись, если она загружена; возвращает false, если записи нет. */
function playSample(id: SampleId, vol = 0.9) {
  const a = audio();
  const buf = samples.get(id);
  if (!a || !master || !buf) return false;
  const src = a.createBufferSource();
  src.buffer = buf;
  // лёгкий разброс высоты, чтобы повторы не звучали одинаково
  src.playbackRate.value = 0.94 + Math.random() * 0.12;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start();
  return true;
}

export const sfx = {
  unlock: () => {
    audio();
    for (const id of Object.keys(SAMPLE_FILES) as SampleId[]) void loadSample(id);
  },
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
    if (playSample('cluck', 0.8)) return;
    tone(700, 0.07, 'square', 0, 0.12, 500);
    tone(820, 0.09, 'square', 0.1, 0.12, 560);
  },
  whoosh: () => noise(0.35, 0.35, 0, 1200),
  /** Сбор гриба: «поп» и двухнотный чиптюн-звон, как монетка в играх Nintendo. */
  mushroom: (rare = false) => {
    tone(260, 0.09, 'sine', 0, 0.7, 620);
    if (rare) {
      // редкий белый гриб — короткая фанфара в духе «1-UP»
      [659, 784, 1319, 1047, 1175, 1568].forEach((f, i) => tone(f, 0.11, 'square', 0.05 + i * 0.075, 0.1));
      return;
    }
    tone(988, 0.08, 'square', 0.05, 0.12);
    tone(1319, 0.42, 'square', 0.12, 0.1);
  },
  /** Гриб долетел до амбара. */
  stash: () => {
    tone(180, 0.12, 'sine', 0, 0.6, 90);
    tone(1568, 0.12, 'triangle', 0.03, 0.18);
  },
  /** «Му-у-у»: низкий тон, который плавно опускается. */
  moo: () => {
    if (playSample('moo')) return;
    voice({ from: 150, to: 185, dur: 0.35, lowpass: 650, vibRate: 5, vibDepth: 3, vol: 0.55 });
    voice({ from: 185, to: 120, dur: 0.95, lowpass: 600, vibRate: 5, vibDepth: 5, vol: 0.55, delay: 0.3 });
  },
  /** «Бе-е-е»: высокий дрожащий голос. */
  baa: () => {
    if (playSample('baa')) return;
    voice({ from: 470, to: 430, dur: 0.75, lowpass: 1900, vibRate: 7, vibDepth: 10, tremRate: 24, tremDepth: 0.6, vol: 0.42 });
  },
  /** Фонтан кита: шипящий выдох и низкий китовый голос. */
  spout: () => {
    noise(1.1, 0.8, 0, 1400);
    noise(0.7, 0.4, 0.15, 3200);
    tone(260, 1.2, 'sine', 0.2, 0.35, 140);
    tone(330, 0.9, 'sine', 0.35, 0.2, 420);
  },
  /** Молоко или шерсть долетели до амбара. */
  collect: () => {
    tone(784, 0.08, 'triangle', 0, 0.4);
    tone(1175, 0.2, 'triangle', 0.07, 0.35);
  },
  levelUp: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', i * 0.1, 0.5));
    tone(1318, 0.6, 'triangle', 0.42, 0.45);
  },
};
