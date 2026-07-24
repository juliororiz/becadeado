let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  if (!ctx) ctx = new AudioCtor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, duration: number, peak = 0.2, type: OscillatorType = "sine") {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + start;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export function playCorrectSound() {
  tone(660, 0, 0.12, 0.18);
  tone(880, 0.09, 0.18, 0.18);
}

export function playWinSound() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.24, 0.22));
}

export function playOpponentCorrectSound() {
  tone(494, 0, 0.16, 0.12, "triangle");
}

function noiseBurst(start: number, duration: number, lowpassFreq: number, peak = 0.35) {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + start;
  const bufferSize = Math.max(1, Math.floor(c.sampleRate * duration));
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const noise = c.createBufferSource();
  noise.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(lowpassFreq, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, lowpassFreq * 0.15), t0 + duration);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

  noise.connect(filter).connect(gain).connect(c.destination);
  noise.start(t0);
  noise.stop(t0 + duration + 0.05);
}

/** A wet, heavy "splat" — thud of impact + squelchy noise, like a tomato smashing on glass. */
export function playTomatoSplatSound() {
  tone(120, 0, 0.16, 0.5, "sine");
  tone(70, 0.03, 0.22, 0.4, "sine");
  noiseBurst(0, 0.35, 2200, 0.4);
  noiseBurst(0.08, 0.5, 900, 0.3);
  noiseBurst(0.32, 0.3, 500, 0.18);
}
