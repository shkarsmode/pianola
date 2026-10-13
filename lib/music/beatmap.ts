/** Seconds <-> beats on the tracked (possibly rubato) beat grid, and the bar layout on top of it. */

export interface Bar {
  index: number;
  start: number; // beat index of the downbeat
  len: number; // beats in this bar
}

export class BeatMap {
  readonly beats: number[];
  readonly barPos: number[];
  readonly timeSig: number;
  readonly bars: Bar[];

  constructor(beats: number[], barPos: number[], timeSig: number) {
    this.beats = beats.length >= 2 ? beats : [0, 0.5];
    this.barPos = barPos.length === this.beats.length ? barPos : this.beats.map((_, i) => i % timeSig);
    this.timeSig = timeSig || 4;
    const downs: number[] = [];
    this.barPos.forEach((p, i) => p === 0 && downs.push(i));
    if (!downs.length || downs[0] !== 0) downs.unshift(0);
    this.bars = downs.map((start, k) => ({
      index: k,
      start,
      len: (downs[k + 1] ?? this.beats.length - 1) - start || this.timeSig,
    }));
  }

  get count(): number {
    return this.beats.length;
  }

  /** Fractional beat index at time t (extrapolates beyond the ends). */
  beatAt(t: number): number {
    const b = this.beats;
    const n = b.length;
    if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]);
    if (t >= b[n - 1]) return n - 1 + (t - b[n - 1]) / (b[n - 1] - b[n - 2]);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
  }

  /** Time in seconds of a fractional beat index. */
  timeAt(beat: number): number {
    const b = this.beats;
    const n = b.length;
    if (beat <= 0) return b[0] + beat * (b[1] - b[0]);
    if (beat >= n - 1) return b[n - 1] + (beat - (n - 1)) * (b[n - 1] - b[n - 2]);
    const i = Math.floor(beat);
    return b[i] + (beat - i) * (b[i + 1] - b[i]);
  }

  /** Seconds per beat around a beat position. */
  beatLen(beat: number): number {
    return this.timeAt(beat + 0.5) - this.timeAt(beat - 0.5);
  }

  /** Position inside its bar (0 = downbeat) of an integer beat. */
  posInBar(beatIndex: number): number {
    const i = Math.max(0, Math.min(this.barPos.length - 1, Math.round(beatIndex)));
    return this.barPos[i];
  }

  barAtBeat(beat: number): Bar {
    let lo = 0;
    let hi = this.bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.bars[mid].start <= beat) lo = mid;
      else hi = mid - 1;
    }
    return this.bars[lo];
  }
}

export const quant = (x: number, grid: number) => Math.round(x / grid) * grid;
