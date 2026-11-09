import { useEffect, useRef } from "react";
import type { Connection, Seat } from "./types";
import {
  NO_ATTENTION,
  nextAttention,
  type AttentionState,
} from "./seat-attention";

/** Pitch of the tone, in hertz: one plain sine wave. */
export const TONE_HZ = 880;
/** Loudest the tone gets, as a gain from 0 to 1: a small fraction of full volume, so it is never startling. */
export const TONE_GAIN = 0.1;
/** Length of the whole tone in seconds, fades included; always under one second. */
export const TONE_SECONDS = 0.15;
/** Seconds the tone takes to fade in and to fade out, so it starts and ends without a click. */
export const TONE_FADE_SECONDS = 0.02;
/** A tone that had to wait for the audio output to start is dropped when it would begin later than this, in milliseconds after it was asked for, so a late tone never surprises. */
export const TONE_LATE_MS = 1000;

type AudioScope = {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};
let context: AudioContext | null = null;
let sounding = 0;

/** Starts the tone on a running context: a sine at TONE_HZ that fades in, holds and fades out within TONE_SECONDS, at most TONE_GAIN loud. */
function startTone(audio: AudioContext) {
  const start = audio.currentTime;
  const end = start + TONE_SECONDS;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = TONE_HZ;
  volume.gain.setValueAtTime(0, start);
  volume.gain.linearRampToValueAtTime(TONE_GAIN, start + TONE_FADE_SECONDS);
  volume.gain.setValueAtTime(TONE_GAIN, end - TONE_FADE_SECONDS);
  volume.gain.linearRampToValueAtTime(0, end);
  oscillator.connect(volume);
  volume.connect(audio.destination);
  oscillator.onended = () => {
    sounding--;
    try {
      oscillator.disconnect();
      volume.disconnect();
      // Nothing keeps the audio output open between two tones.
      if (sounding <= 0) void audio.suspend().catch(() => {});
    } catch {
      // Nothing left to release.
    }
  };
  oscillator.start(start);
  oscillator.stop(end);
  sounding++;
}

/**
 * Plays the attention tone once: a single short sine tone, quiet, with no
 * audio file. The audio context is created on the first call and reused. A
 * browser that keeps audio waiting until the page has been used leaves the
 * context suspended: the tone then waits for it to run and is dropped when
 * that takes longer than TONE_LATE_MS, so it never plays late and never
 * throws. Returns false when no audio is available (no AudioContext, or it
 * cannot be created); a failure after that is silent.
 */
export function playAttentionTone(): boolean {
  try {
    if (!context) {
      const scope = globalThis as unknown as AudioScope;
      const Context = scope.AudioContext ?? scope.webkitAudioContext;
      if (!Context) return false;
      context = new Context();
    }
    const audio = context;
    const asked = Date.now();
    void audio
      .resume()
      .then(() => {
        if (Date.now() - asked <= TONE_LATE_MS) startTone(audio);
      })
      .catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Opt-in short sound when a seat newly needs input. Reads the seat list the
 * app already refreshes; no polling of its own, no rig command, nothing sent
 * to a seat or shell, no text shown. The first list of a connection only
 * seeds what is waiting, a list that is stale (the one shown while the
 * connection just changed, or while the refresh is failing) is ignored, and
 * turning it off forgets everything, so turning it on later starts silently.
 * It sounds whether or not HRig is in front, like the desktop notification.
 */
export function useSeatNeedsInputSound(options: {
  enabled: boolean;
  connection: Connection;
  seats: readonly Seat[] | null;
  inventoryError: string;
  log: (text: string) => void;
}) {
  const { enabled, connection, seats, inventoryError, log } = options;
  const state = useRef<AttentionState>(NO_ATTENTION);
  const watched = useRef<{ key: string; stale: unknown }>({
    key: "",
    stale: null,
  });
  const reported = useRef(false);
  const logRef = useRef(log);
  logRef.current = log;
  const key = JSON.stringify([
    connection.id,
    connection.kind,
    connection.host,
    connection.port,
    connection.distro,
    connection.rigBinary,
  ]);
  useEffect(() => {
    // When the connection changes, the list still handed in belongs to the
    // previous one: remember it and wait for the next.
    if (watched.current.key !== key) watched.current = { key, stale: seats };
    if (!enabled) {
      state.current = NO_ATTENTION;
      return;
    }
    if (!seats || inventoryError || seats === watched.current.stale) return;
    const step = nextAttention(state.current, key, seats, Date.now());
    state.current = step.state;
    if (step.play && !playAttentionTone() && !reported.current) {
      reported.current = true;
      logRef.current("The attention sound is not available on this system.");
    }
  }, [enabled, key, seats, inventoryError]);
}
