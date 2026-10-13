"use client";

import { useCallback, useEffect, useState } from "react";

export interface Settings {
  fingers: boolean;
  names: "none" | "letters" | "solfege";
  chords: boolean;
  effects: boolean;
  zoom: number; // falling speed, px per second of music
  fullKeyboard: boolean;
  outputs: "original" | "piano" | "both";
  originalVol: number;
  pianoVol: number;
  myHand: "both" | "R" | "L";
  metronome: boolean;
  loopRamp: boolean; // a loop speeds up by 5% each pass, up to 100%
  latencyMs: number; // sound reaches the ears this much after the notes reach the keys (Bluetooth)
}

export const DEFAULT_SETTINGS: Settings = {
  fingers: true,
  names: "none",
  chords: true,
  effects: true,
  zoom: 150,
  fullKeyboard: false,
  outputs: "original",
  originalVol: 0.9,
  pianoVol: 0.85,
  myHand: "both",
  metronome: false,
  loopRamp: false,
  latencyMs: 0,
};

const KEY = "pianola:settings";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

/** Device-wide view and sound preferences. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => setS(read(KEY, DEFAULT_SETTINGS)), []);
  const update = useCallback((patch: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      write(KEY, next);
      return next;
    });
  }, []);
  return [s, update];
}

export interface SongPrefs {
  level: string;
  transpose: number;
  rate: number;
}

/** Per-song choices: level, transposition, speed. */
export function useSongPrefs(id: string): [SongPrefs, (patch: Partial<SongPrefs>) => void, boolean] {
  const key = `pianola:song:${id}`;
  const fallback: SongPrefs = { level: "adaptive", transpose: 0, rate: 1 };
  const [p, setP] = useState<SongPrefs>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setP(read(key, fallback));
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = useCallback(
    (patch: Partial<SongPrefs>) => {
      setP((prev) => {
        const next = { ...prev, ...patch };
        write(key, next);
        return next;
      });
    },
    [key],
  );
  return [p, update, ready];
}
