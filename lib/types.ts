/** Shared shapes between the worker output, the API and the player. */

export type NoteTuple = [pitch: number, start: number, end: number, vel: number];

export interface ChordSeg {
  s: number;
  e: number;
  root: number | null;
  q: string;
  name: string;
  bass: number | null;
  conf?: number;
}

export interface Analysis {
  v: number;
  duration: number;
  sourceType: "piano" | "mix";
  melodySource: string;
  stemShares: Record<string, number>;
  tempo: number;
  timeSig: number;
  subdiv: number;
  beats: number[];
  barPos: number[];
  key: { tonic: number; mode: "major" | "minor"; name: string; confidence: number };
  chords: ChordSeg[];
  melody: NoteTuple[];
  notes: NoteTuple[];
  pedal: [number, number][];
}

export type SongStatus = "queued" | "processing" | "ready" | "error";

export interface SongMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: SongStatus;
  error?: string;
  source: { kind: "url" | "upload" | "record"; url?: string; uploadUrl?: string; filename?: string };
  duration?: number;
  key?: string;
  tempo?: number;
  audioUrl?: string;
  analysisUrl?: string;
  thumb?: string;
  pinned?: boolean;
}

export type Hand = "L" | "R";

/** A note as the player draws and plays it. Times are seconds on the original audio. */
export interface PNote {
  pitch: number;
  start: number;
  end: number;
  vel: number;
  hand: Hand;
  finger?: number;
}

export interface WorkerStatus {
  online: boolean;
  current?: { id: string; stage: string; progress: number } | null;
  queue?: string[];
}
