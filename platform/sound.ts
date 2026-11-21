"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared sound plumbing for every game: the on/off setting, the audio context, and dice.
 * Sounds are synthesized with the Web Audio API (no audio files to load).
 *
 * Browsers only allow sound after the page has been tapped or clicked, so the audio
 * context is created lazily and resumed on the first interaction.
 */

let ctx: AudioContext | null = null;

const SOUND_OFF_KEY = "board-games:sound-off";
/** Where the setting lived before the site hosted more than one game. */
const LEGACY_SOUND_OFF_KEY = "stock-market:sound-off";
let soundOn = readSoundOn();
const listeners = new Set<() => void>();

function readSoundOn(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return (localStorage.getItem(SOUND_OFF_KEY) ?? localStorage.getItem(LEGACY_SOUND_OFF_KEY)) !== "1";
  } catch {
    return true;
  }
}

/** Turn game sounds on or off on this device (remembered). */
export function setSoundOn(on: boolean) {
  soundOn = on;
  try {
    localStorage.setItem(SOUND_OFF_KEY, on ? "0" : "1");
  } catch {
    // Private mode etc.: the setting just won't be remembered.
  }
  listeners.forEach((l) => l());
}

/** Whether game sounds are on, kept in sync across components. */
export function useSoundOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => soundOn,
    () => true,
  );
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** The audio context to play a sound on, or null when sound is off or unavailable. */
export function soundContext(): AudioContext | null {
  return soundOn ? audio() : null;
}

// Unlock audio on the first tap/click/key so later sounds (e.g. another player's roll) can play.
if (typeof window !== "undefined") {
  const unlock = () => {
    audio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

let noise: AudioBuffer | null = null;
function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== ac.sampleRate) {
    noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.1), ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** One die hitting the table: a short filtered noise burst plus a little wooden "tock". */
export function clack(ac: AudioContext, out: AudioNode, at: number, level: number) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2200 + Math.random() * 1800;
  band.Q.value = 3 + Math.random() * 3;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.03 + Math.random() * 0.02);
  src.connect(band).connect(g).connect(out);
  src.start(at, Math.random() * 0.05, 0.06);

  const tone = ac.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(700 + Math.random() * 500, at);
  const tg = ac.createGain();
  tg.gain.setValueAtTime(level * 0.35, at);
  tg.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
  tone.connect(tg).connect(out);
  tone.start(at);
  tone.stop(at + 0.05);
}

/** Two dice rattling and settling: impacts that get quieter and closer together. */
export function playDice() {
  const ac = soundContext();
  if (!ac) return;
  const out = ac.createGain();
  out.gain.value = 0.55;
  out.connect(ac.destination);
  const start = ac.currentTime + 0.01;
  for (let die = 0; die < 2; die++) {
    let t = start + die * 0.025 + Math.random() * 0.02;
    let gap = 0.09 + Math.random() * 0.03;
    let level = 0.9;
    const hits = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < hits; i++) {
      clack(ac, out, t, level * (0.75 + Math.random() * 0.25));
      t += gap;
      gap *= 0.78;
      level *= 0.78;
    }
  }
}
