"use client";
/** Short feedback tones generated with the Web Audio API (no asset files). */

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, duration: number, type: OscillatorType, gain = 0.08) {
  const c = audioCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = c.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export function playFeedback(correct: boolean) {
  try {
    if (correct) {
      tone(660, 0, 0.12, "sine");
      tone(990, 0.09, 0.18, "sine");
    } else {
      tone(220, 0, 0.22, "triangle", 0.1);
      tone(180, 0.12, 0.25, "triangle", 0.08);
    }
  } catch {
    // Audio is optional.
  }
}

export function playCelebration() {
  try {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.1, 0.25, "sine", 0.07));
  } catch {
    // ignore
  }
}
