/**
 * Piano fingering by dynamic programming over a hand's note events.
 *
 * The cost model follows Parncutt et al. (1997): each finger pair has a relaxed, comfortable
 * and practical span; stretching past them, crossing, weak fingers and thumbs on black keys
 * cost extra. Chords are scored on their inner spans; moves between chords on how far the
 * whole hand has to shift. The left hand is mirrored so one model serves both hands.
 */
import type { PNote } from "../types";
import { isBlack } from "./theory";

// [minPrac, minComf, minRel, maxRel, maxComf, maxPrac] in semitones, lower finger -> higher finger.
const SPAN: Record<string, number[]> = {
  "12": [-5, -3, 1, 5, 8, 10],
  "13": [-4, -2, 3, 7, 10, 12],
  "14": [-3, -1, 5, 9, 12, 14],
  "15": [-1, 1, 7, 10, 13, 15],
  "23": [1, 1, 1, 2, 3, 5],
  "24": [1, 1, 3, 4, 5, 7],
  "25": [2, 2, 5, 6, 8, 10],
  "34": [1, 1, 1, 2, 2, 4],
  "35": [1, 1, 3, 4, 5, 7],
  "45": [1, 1, 1, 2, 3, 5],
};

// Where each finger sits relative to the thumb in a relaxed five-finger position.
const OFFSET = [0, 0, 2, 4, 5, 7];

/** Cost of playing note p1 with finger f1 next to note p2 with finger f2 (mirrored pitches). */
function pairCost(f1: number, p1: number, f2: number, p2: number): number {
  if (f1 === f2) return p1 === p2 ? 0 : 6 + Math.abs(p2 - p1) * 0.5;
  let lo = f1;
  let hi = f2;
  let iv = p2 - p1;
  if (f1 > f2) {
    lo = f2;
    hi = f1;
    iv = p1 - p2;
  }
  const [minPrac, minComf, minRel, maxRel, maxComf, maxPrac] = SPAN[`${lo}${hi}`];
  const thumb = lo === 1;
  let c = 0;
  if (iv > maxRel) c += (iv - maxRel) * (thumb ? 1 : 2);
  if (iv < minRel) c += (minRel - iv) * (thumb ? 1 : 2);
  if (iv > maxComf) c += (iv - maxComf) * 2;
  if (iv < minComf) c += (minComf - iv) * 2;
  if (iv > maxPrac) c += (iv - maxPrac) * 10;
  if (iv < minPrac) c += (minPrac - iv) * 10;
  if (iv < 0) c += 1; // thumb passing under / finger crossing over
  return c;
}

interface Ev {
  idx: number[]; // note indices, sorted so mirrored pitch ascends
  mp: number[]; // mirrored pitches (ascending)
  real: number[]; // real pitches
  start: number;
  end: number;
}

interface State {
  fingers: number[];
  thumb: number;
  local: number;
}

function combos(n: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === n) {
      out.push([...acc]);
      return;
    }
    for (let f = start; f <= 5; f++) {
      acc.push(f);
      rec(f + 1, acc);
      acc.pop();
    }
  };
  rec(1, []);
  return out;
}
const COMBOS = [[], combos(1), combos(2), combos(3), combos(4), combos(5)];

function noteCost(f: number, real: number): number {
  let c = 0;
  if (f >= 4) c += 0.6;
  if (isBlack(real)) {
    if (f === 1) c += 2;
    else if (f === 5) c += 1;
  }
  return c;
}

function states(ev: Ev): State[] {
  const n = Math.min(5, ev.mp.length);
  const res: State[] = [];
  for (const fingers of COMBOS[n]) {
    let local = 0;
    for (let i = 0; i < n; i++) local += noteCost(fingers[i], ev.real[i]);
    for (let i = 0; i + 1 < n; i++) local += pairCost(fingers[i], ev.mp[i], fingers[i + 1], ev.mp[i + 1]);
    if (n >= 3) {
      local += pairCost(fingers[0], ev.mp[0], fingers[n - 1], ev.mp[n - 1]) * 0.5;
      const span = ev.mp[n - 1] - ev.mp[0];
      // Wide chords: prefer the whole hand (1-3-5) over cramped 1-2-4 shapes.
      if (span >= 7) local += fingers.filter((f) => f === 2 || f === 4).length * 0.3;
    }
    let thumb = 0;
    for (let i = 0; i < n; i++) thumb += ev.mp[i] - OFFSET[fingers[i]];
    res.push({ fingers, thumb: thumb / n, local });
  }
  return res;
}

function transition(a: Ev, sa: State, b: Ev, sb: State): number {
  const na = sa.fingers.length;
  const nb = sb.fingers.length;
  let c: number;
  if (na === 1 && nb === 1) {
    c = pairCost(sa.fingers[0], a.mp[0], sb.fingers[0], b.mp[0]);
    if (sa.fingers[0] === 3 && sb.fingers[0] === 4) c += 1;
    if (sa.fingers[0] === 3 && sb.fingers[0] === 4 && !isBlack(a.real[0]) && isBlack(b.real[0])) c += 1;
  } else {
    // Lead voice (top of the right hand, bass of the left) plus how far the hand shifts.
    c = 0.6 * pairCost(sa.fingers[na - 1], a.mp[na - 1], sb.fingers[nb - 1], b.mp[nb - 1]);
    c += 0.25 * Math.abs(sa.thumb - sb.thumb);
  }
  const rest = b.start - a.end;
  const gap = b.start - a.start;
  if (rest > 0.25 || gap > 0.8) c *= 0.25;
  return c;
}

/** Groups one hand's notes into onset events (chords) in time order. */
function events(notes: PNote[], indices: number[], mirror: boolean): Ev[] {
  const order = [...indices].sort((x, y) => notes[x].start - notes[y].start || notes[x].pitch - notes[y].pitch);
  const evs: Ev[] = [];
  for (const i of order) {
    const last = evs[evs.length - 1];
    if (last && notes[i].start - last.start < 0.03) {
      last.idx.push(i);
      last.end = Math.max(last.end, notes[i].end);
    } else {
      evs.push({ idx: [i], mp: [], real: [], start: notes[i].start, end: notes[i].end });
    }
  }
  for (const ev of evs) {
    ev.idx.sort((x, y) => (mirror ? notes[y].pitch - notes[x].pitch : notes[x].pitch - notes[y].pitch));
    ev.real = ev.idx.map((i) => notes[i].pitch);
    ev.mp = ev.real.map((p) => (mirror ? -p : p));
  }
  return evs;
}

function fingerHand(notes: PNote[], indices: number[], mirror: boolean): void {
  const evs = events(notes, indices, mirror);
  if (!evs.length) return;
  const st = evs.map(states);
  let cost = st[0].map((s) => s.local);
  const back: number[][] = [st[0].map(() => -1)];
  for (let k = 1; k < evs.length; k++) {
    const next: number[] = [];
    const bk: number[] = [];
    for (const sb of st[k]) {
      let best = Infinity;
      let arg = 0;
      for (let j = 0; j < st[k - 1].length; j++) {
        const c = cost[j] + transition(evs[k - 1], st[k - 1][j], evs[k], sb);
        if (c < best) {
          best = c;
          arg = j;
        }
      }
      next.push(best + sb.local);
      bk.push(arg);
    }
    cost = next;
    back.push(bk);
  }
  let s = cost.indexOf(Math.min(...cost));
  for (let k = evs.length - 1; k >= 0; k--) {
    const state = st[k][s];
    evs[k].idx.forEach((ni, i) => {
      notes[ni].finger = i < state.fingers.length ? state.fingers[i] : undefined;
    });
    s = back[k][s];
  }
}

/** Writes `finger` on every note (in place). */
export function assignFingering(notes: PNote[]): PNote[] {
  const left: number[] = [];
  const right: number[] = [];
  notes.forEach((n, i) => (n.hand === "L" ? left : right).push(i));
  fingerHand(notes, right, false);
  fingerHand(notes, left, true);
  return notes;
}
