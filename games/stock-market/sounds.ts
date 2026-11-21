"use client";

import { clack, soundContext } from "@/platform/sound";

/** Stock Market sound effects (dice and the on/off setting are shared, in platform/sound.ts). */

/** A single bright bell "ding" (a few inharmonic partials, like a desk bell). */
export function playBell() {
  const ac = soundContext();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  const base = 1320;
  const partials: [ratio: number, level: number, decay: number][] = [
    [1, 0.5, 1.6],
    [2.0, 0.18, 1.1],
    [2.76, 0.12, 0.8],
    [5.4, 0.05, 0.4],
  ];
  const out = ac.createGain();
  out.gain.value = 0.35;
  out.connect(ac.destination);
  for (const [ratio, level, decay] of partials) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = base * ratio;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, at + decay);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

/** A cash register: a mechanical "ca" (drawer clack) then a bright "ching". */
export function playCash() {
  const ac = soundContext();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  const out = ac.createGain();
  out.gain.value = 0.4;
  out.connect(ac.destination);

  // "Ca": two quick low clacks.
  clack(ac, out, at, 0.8);
  clack(ac, out, at + 0.045, 0.6);

  // "Ching": a cluster of high, slightly detuned partials that ring out.
  const ching = at + 0.08;
  const partials: [freq: number, level: number, decay: number][] = [
    [2637, 0.35, 0.9],
    [2660, 0.25, 0.9],
    [3951, 0.22, 0.7],
    [5274, 0.14, 0.5],
    [6650, 0.08, 0.35],
  ];
  for (const [freq, level, decay] of partials) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, ching);
    g.gain.linearRampToValueAtTime(level, ching + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0005, ching + decay);
    osc.connect(g).connect(out);
    osc.start(ching);
    osc.stop(ching + decay + 0.05);
  }
}

/** A short "womp womp": two falling, slightly sagging horn notes. */
export function playLoss() {
  const ac = soundContext();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  const out = ac.createGain();
  out.gain.value = 0.22;
  const tone = ac.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 1400;
  tone.connect(out).connect(ac.destination);

  const notes: [start: number, from: number, to: number, length: number][] = [
    [0, 311, 294, 0.24],
    [0.28, 262, 220, 0.5],
  ];
  for (const [offset, from, to, length] of notes) {
    const t0 = at + offset;
    const osc = ac.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.linearRampToValueAtTime(to, t0 + length);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + 0.03);
    g.gain.setValueAtTime(1, t0 + length * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + length);
    osc.connect(g).connect(tone);
    osc.start(t0);
    osc.stop(t0 + length + 0.02);
  }
}
