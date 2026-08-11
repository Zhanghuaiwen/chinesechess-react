let ctx = null;
let muted = false;

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function knock(vol = 0.4, delay = 0) {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  try {
    const t = ac.currentTime + delay;
    const len = Math.max(1, Math.floor(ac.sampleRate * 0.06));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700;
    bp.Q.value = 1.1;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(ac.destination);
    src.start(t);
  } catch {
    // 忽略音频不可用场景
  }
}

function tone(freq, dur, type = "sine", vol = 0.18, delay = 0) {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const t = ac.currentTime + delay;
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch {
    // 忽略音频不可用场景
  }
}

export const sound = {
  setMuted(v) {
    muted = v;
  },
  move() {
    tone(230, 0.12, "triangle", 0.22);
  },
  capture() {
    tone(150, 0.2, "square", 0.14);
    tone(100, 0.24, "sine", 0.22, 0.02);
  },
  select() {
    knock(0.42);
    tone(170, 0.05, "sine", 0.16, 0.002);
  },
  ready() {
    tone(523, 0.1, "square", 0.12);
    tone(659, 0.12, "square", 0.12, 0.14);
  },
  go() {
    tone(784, 0.12, "square", 0.14);
    tone(1046, 0.3, "square", 0.16, 0.12);
  },
  check() {
    tone(660, 0.1, "square", 0.1);
    tone(880, 0.12, "square", 0.08, 0.09);
  },
  win() {
    tone(523, 0.16, "triangle", 0.18);
    tone(659, 0.16, "triangle", 0.18, 0.12);
    tone(784, 0.28, "triangle", 0.18, 0.24);
  },
  lose() {
    tone(330, 0.2, "sawtooth", 0.1);
    tone(247, 0.26, "sawtooth", 0.1, 0.16);
    tone(165, 0.4, "sawtooth", 0.1, 0.32);
  },
  draw() {
    tone(440, 0.14, "sine", 0.15);
    tone(392, 0.2, "sine", 0.15, 0.12);
  },
};
