/**
 * Playback: the original recording, the arrangement on a sampled piano, or both, on one clock.
 *
 * With the recording audible its media clock leads (so the falling notes stay glued to what you
 * hear, even while it buffers); otherwise the AudioContext clock does. Piano notes are scheduled
 * a little ahead of time. "Wait for me" freezes the clock at a note until the right keys are down.
 */
import type { Hand, PNote } from "../types";
import { PianoSampler, type Voice } from "./sampler";

export interface PlayerState {
  playing: boolean;
  frozen: boolean;
}

type Listener = (s: PlayerState) => void;

export class Player {
  readonly ctx: AudioContext;
  readonly sampler: PianoSampler;
  readonly audio: HTMLAudioElement;
  private master: GainNode;

  duration = 0;
  rate = 1;
  playing = false;
  frozen = false;

  originalOn = true;
  pianoOn = false;
  handAudible: Record<Hand, boolean> = { L: true, R: true };
  loop: { a: number; b: number } | null = null;
  metronome = false;
  /** Returns the time of the first note that still waits for the player, or null. */
  waitCheck: ((t: number) => number | null) | null = null;
  /** Called each time a loop wraps around (for "speed up a little every pass"). */
  onLoopWrap: (() => void) | null = null;

  private notes: PNote[] = [];
  private pedal: [number, number][] = [];
  private beats: number[] = [];
  private downbeats = new Set<number>();
  private nextNote = 0;
  private nextBeat = 0;
  private scheduledFrom = 0;
  private voices: Voice[] = [];

  private pausedAt = 0;
  private anchorCtx = 0;
  private anchorSong = 0;
  private lastMedia = -1;
  private lastMediaPerf = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sampler = new PianoSampler(this.ctx, this.master);
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.preservesPitch = true;
    this.audio.addEventListener("ended", () => this.onEnded());
    this.timer = setInterval(() => this.schedule(), 25);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.audio.pause();
    this.audio.src = "";
    this.sampler.stopAll();
    void this.ctx.close();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = { playing: this.playing, frozen: this.frozen };
    for (const l of this.listeners) l(s);
  }

  setSource(url: string | null, duration: number) {
    this.duration = duration;
    if (url && this.audio.src !== url) {
      this.audio.src = url;
      this.audio.load();
    }
  }

  setNotes(notes: PNote[], pedal: [number, number][]) {
    this.notes = [...notes].sort((a, b) => a.start - b.start);
    this.pedal = pedal;
    this.resync(this.time());
  }

  setBeats(beats: number[], downbeats: number[]) {
    this.beats = beats;
    this.downbeats = new Set(downbeats.map((d) => Math.round(d * 1000)));
    this.resync(this.time());
  }

  private get useMedia(): boolean {
    return this.originalOn && !!this.audio.src && !this.waitCheck;
  }

  time(): number {
    if (!this.playing || this.frozen) return this.pausedAt;
    if (this.useMedia) {
      const m = this.audio.currentTime;
      const now = performance.now();
      if (m !== this.lastMedia) {
        this.lastMedia = m;
        this.lastMediaPerf = now;
      }
      const predicted = this.lastMedia + ((now - this.lastMediaPerf) / 1000) * this.rate;
      return Math.min(predicted, this.lastMedia + 0.25 * this.rate);
    }
    return this.anchorSong + (this.ctx.currentTime - this.anchorCtx) * this.rate;
  }

  async play() {
    if (this.playing) return;
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (this.pianoOn) void this.sampler.load();
    if (this.pausedAt >= this.duration - 0.05) this.pausedAt = this.loop?.a ?? 0;
    this.playing = true;
    this.frozen = false;
    this.startClock(this.pausedAt);
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.time();
    this.playing = false;
    this.frozen = false;
    this.audio.pause();
    this.stopVoices();
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    const clamped = Math.max(0, Math.min(this.duration, t));
    this.pausedAt = clamped;
    this.stopVoices();
    if (this.playing && !this.frozen) this.startClock(clamped);
    else this.resync(clamped);
  }

  setRate(rate: number) {
    const t = this.time();
    this.rate = rate;
    this.audio.playbackRate = rate;
    if (this.playing) {
      this.stopVoices();
      this.startClock(t);
    }
  }

  setOutputs(originalOn: boolean, pianoOn: boolean) {
    const t = this.time();
    this.originalOn = originalOn;
    this.pianoOn = pianoOn;
    if (pianoOn) void this.sampler.load();
    if (this.playing) {
      this.stopVoices();
      this.startClock(t);
    }
  }

  setVolumes(original: number, piano: number) {
    this.audio.volume = Math.max(0, Math.min(1, original));
    this.sampler.output.gain.value = piano * 0.9;
  }

  setWait(check: ((t: number) => number | null) | null) {
    const t = this.time();
    this.waitCheck = check;
    if (this.playing) {
      this.stopVoices();
      this.startClock(t);
    }
  }

  /** Called every animation frame: applies waiting, looping and the end of the song. */
  tick(): number {
    let t = this.time();
    if (!this.playing) return t;
    if (this.waitCheck) {
      const target = this.waitCheck(this.frozen ? this.pausedAt : t);
      if (target != null && (this.frozen || t >= target)) {
        if (!this.frozen) {
          this.frozen = true;
          this.pausedAt = target;
          this.emit();
        }
        return this.pausedAt;
      }
      if (this.frozen) {
        this.frozen = false;
        this.startClock(this.pausedAt);
        this.emit();
        t = this.pausedAt;
      }
    }
    if (this.loop && t >= this.loop.b) {
      this.seek(this.loop.a);
      this.onLoopWrap?.();
      return this.loop.a;
    }
    if (t >= this.duration) {
      this.onEnded();
      return this.duration;
    }
    return t;
  }

  /** Plays one note right now (a tapped key, a chord preview). */
  preview(pitches: number[], vel = 90, dur = 1.2, spreadSec = 0) {
    if (this.ctx.state !== "running") void this.ctx.resume();
    void this.sampler.load().then(() => {
      const t = this.ctx.currentTime + 0.01;
      pitches.forEach((p, i) => this.sampler.play(p, vel, t + i * spreadSec, dur));
    });
  }

  private onEnded() {
    if (this.loop) {
      this.seek(this.loop.a);
      return;
    }
    this.pausedAt = this.duration;
    this.playing = false;
    this.audio.pause();
    this.stopVoices();
    this.emit();
  }

  private startClock(t: number) {
    this.pausedAt = t;
    this.anchorSong = t;
    this.anchorCtx = this.ctx.currentTime;
    this.lastMedia = -1;
    if (this.useMedia) {
      this.audio.currentTime = t;
      this.audio.playbackRate = this.rate;
      void this.audio.play().catch(() => undefined);
    } else {
      this.audio.pause();
    }
    this.resync(t);
  }

  private resync(t: number) {
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].start < t - 0.001) lo = mid + 1;
      else hi = mid;
    }
    this.nextNote = lo;
    let b = 0;
    while (b < this.beats.length && this.beats[b] < t - 0.001) b++;
    this.nextBeat = b;
    this.scheduledFrom = t;
  }

  private stopVoices() {
    for (const v of this.voices) v.stop();
    this.voices = [];
  }

  private pedalEnd(t: number): number | null {
    for (const [s, e] of this.pedal) {
      if (s <= t && t <= e) return e;
      if (s > t) break;
    }
    return null;
  }

  private schedule() {
    if (!this.playing || this.frozen) return;
    const now = this.time();
    const horizon = now + 0.12 * this.rate;
    const ctxNow = this.ctx.currentTime;
    if (this.pianoOn && this.sampler.ready) {
      while (this.nextNote < this.notes.length && this.notes[this.nextNote].start < horizon) {
        const n = this.notes[this.nextNote++];
        if (n.start < this.scheduledFrom - 0.02 || !this.handAudible[n.hand]) continue;
        let end = n.end;
        const pe = this.pedalEnd(n.end);
        if (pe) end = Math.min(Math.max(end, pe), n.start + 6);
        const when = ctxNow + Math.max(0, (n.start - now) / this.rate);
        this.voices.push(this.sampler.play(n.pitch, n.vel, when, (end - n.start) / this.rate));
      }
      if (this.voices.length > 256) this.voices = this.voices.slice(-128);
    } else {
      // keep the cursor moving so enabling the piano later does not replay the past
      while (this.nextNote < this.notes.length && this.notes[this.nextNote].start < horizon) this.nextNote++;
    }
    while (this.nextBeat < this.beats.length && this.beats[this.nextBeat] < horizon) {
      const b = this.beats[this.nextBeat++];
      if (!this.metronome || b < this.scheduledFrom - 0.02) continue;
      this.click(ctxNow + Math.max(0, (b - now) / this.rate), this.downbeats.has(Math.round(b * 1000)));
    }
  }

  private click(when: number, accent: boolean) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1180;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.32 : 0.2, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(g).connect(this.master);
    osc.start(when);
    osc.stop(when + 0.06);
  }
}
