/** Piano keyboard geometry: where each key (and its falling-note lane) sits horizontally. */
import { isBlack } from "../music/theory";

export interface KeyRect {
  pitch: number;
  x: number;
  w: number;
  black: boolean;
}

// Black key centres inside an octave, in white-key widths from the left edge of C.
const BLACK_CENTRE: Record<number, number> = { 1: 0.92, 3: 2.08, 6: 3.9, 8: 5.0, 10: 6.1 };
const WHITE_INDEX: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
export const BLACK_RATIO = 0.6;

/** Extends a pitch range to white keys at both ends with at least `minWhite` white keys. */
export function fitRange(lo: number, hi: number, minWhite = 15): [number, number] {
  let a = Math.max(21, Math.min(lo, hi));
  let b = Math.min(108, Math.max(lo, hi));
  if (isBlack(a)) a -= 1;
  if (isBlack(b)) b += 1;
  const whites = () => {
    let n = 0;
    for (let p = a; p <= b; p++) if (!isBlack(p)) n++;
    return n;
  };
  let grow = true;
  while (whites() < minWhite && (a > 21 || b < 108)) {
    if (grow && b < 108) b += isBlack(b + 1) ? 2 : 1;
    else if (a > 21) a -= isBlack(a - 1) ? 2 : 1;
    grow = !grow;
  }
  return [a, b];
}

export class KeyboardLayout {
  readonly lo: number;
  readonly hi: number;
  readonly whiteW: number;
  readonly keys: KeyRect[];
  private byPitch = new Map<number, KeyRect>();

  constructor(lo: number, hi: number, width: number, x0 = 0) {
    this.lo = lo;
    this.hi = hi;
    let whites = 0;
    for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites++;
    this.whiteW = width / Math.max(1, whites);
    const keys: KeyRect[] = [];
    // left edge of the C at or below `lo`, in white-key units relative to the first white key
    const firstWhite = isBlack(lo) ? lo + 1 : lo;
    const octStart = (p: number) => Math.floor(p / 12) * 12;
    const whiteUnits = (p: number) => {
      // white keys between firstWhite and p (exclusive)
      const oct = (octStart(p) - octStart(firstWhite)) / 12;
      return oct * 7 + WHITE_INDEX[((p % 12) + 12) % 12] - WHITE_INDEX[firstWhite % 12];
    };
    for (let p = lo; p <= hi; p++) {
      const black = isBlack(p);
      if (!black) {
        keys.push({ pitch: p, x: x0 + whiteUnits(p) * this.whiteW, w: this.whiteW, black });
      } else {
        const cUnits = whiteUnits(octStart(p)) + BLACK_CENTRE[p % 12];
        const w = this.whiteW * BLACK_RATIO;
        keys.push({ pitch: p, x: x0 + cUnits * this.whiteW - w / 2, w, black });
      }
    }
    this.keys = keys;
    for (const k of keys) this.byPitch.set(k.pitch, k);
  }

  key(pitch: number): KeyRect | undefined {
    return this.byPitch.get(pitch);
  }

  /** Key under an x coordinate on the keyboard (black keys win in their upper part). */
  pitchAt(x: number, inBlackZone: boolean): number | null {
    if (inBlackZone) {
      for (const k of this.keys) if (k.black && x >= k.x && x < k.x + k.w) return k.pitch;
    }
    for (const k of this.keys) if (!k.black && x >= k.x && x < k.x + k.w) return k.pitch;
    return null;
  }
}
