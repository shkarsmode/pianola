/**
 * Splits a raw two-hand transcription into left and right hand.
 *
 * Each onset group is cut at one point (lowest k notes to the left hand). A beam search keeps
 * the cheapest histories, where cost grows with spans no hand can stretch, a hand jumping far
 * in little time, a left hand far up or a right hand far down, and hands crossing.
 */
import type { Hand } from "../types";

export interface RawNote {
  pitch: number;
  start: number;
  end: number;
  vel: number;
}

interface Hyp {
  cost: number;
  lc: number; // left hand centre
  rc: number;
  lt: number; // last time the hand played
  rt: number;
  held: { pitch: number; end: number; hand: Hand }[];
  choice: number[]; // split index per group
  parent: Hyp | null;
}

const BEAM = 16;

function handCost(pitches: number[], held: number[], centre: number, last: number, t: number, hand: Hand): number {
  if (!pitches.length) return 0;
  const all = held.length ? pitches.concat(held) : pitches;
  const span = Math.max(...all) - Math.min(...all);
  let c = 0;
  if (span > 12) c += (span - 12) * 2.5;
  if (span > 15) c += (span - 15) * 12;
  if (pitches.length > 5) c += 30 * (pitches.length - 5);
  const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
  const dt = t - last;
  const w = dt < 0.3 ? 0.18 : dt < 1 ? 0.09 : 0.03;
  c += Math.abs(mean - centre) * w;
  for (const p of pitches) {
    if (hand === "L") c += Math.max(0, p - 64) * 0.3;
    else c += Math.max(0, 55 - p) * 0.3;
  }
  return c;
}

export function splitHands(notes: RawNote[]): Hand[] {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].start - notes[b].start || notes[a].pitch - notes[b].pitch);
  const groups: number[][] = [];
  for (const i of order) {
    const g = groups[groups.length - 1];
    if (g && notes[i].start - notes[g[0]].start < 0.035) g.push(i);
    else groups.push([i]);
  }
  for (const g of groups) g.sort((a, b) => notes[a].pitch - notes[b].pitch);

  let beam: Hyp[] = [{ cost: 0, lc: 48, rc: 72, lt: -10, rt: -10, held: [], choice: [], parent: null }];
  for (const g of groups) {
    const t = notes[g[0]].start;
    const pitches = g.map((i) => notes[i].pitch);
    const next: Hyp[] = [];
    for (const h of beam) {
      const held = h.held.filter((x) => x.end > t + 0.05);
      const heldL = held.filter((x) => x.hand === "L").map((x) => x.pitch);
      const heldR = held.filter((x) => x.hand === "R").map((x) => x.pitch);
      for (let k = 0; k <= pitches.length; k++) {
        const L = pitches.slice(0, k);
        const R = pitches.slice(k);
        let c = handCost(L, heldL, h.lc, h.lt, t, "L") + handCost(R, heldR, h.rc, h.rt, t, "R");
        const lTop = Math.max(...L, ...heldL, -Infinity);
        const rBottom = Math.min(...R, ...heldR, Infinity);
        if (lTop >= rBottom) c += 8;
        const lc = L.length ? L.reduce((a, b) => a + b, 0) / L.length : h.lc;
        const rc = R.length ? R.reduce((a, b) => a + b, 0) / R.length : h.rc;
        if (lc > rc - 2) c += 6;
        next.push({
          cost: h.cost + c,
          lc: L.length ? lc * 0.7 + h.lc * 0.3 : h.lc,
          rc: R.length ? rc * 0.7 + h.rc * 0.3 : h.rc,
          lt: L.length ? t : h.lt,
          rt: R.length ? t : h.rt,
          held: held.concat(g.map((i, j) => ({ pitch: notes[i].pitch, end: notes[i].end, hand: (j < k ? "L" : "R") as Hand }))),
          choice: [k],
          parent: h,
        });
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, BEAM);
  }

  const hands: Hand[] = new Array(notes.length).fill("R");
  let h: Hyp | null = beam[0];
  for (let gi = groups.length - 1; gi >= 0 && h; gi--) {
    const k = h.choice[0];
    groups[gi].forEach((ni, j) => (hands[ni] = j < k ? "L" : "R"));
    h = h.parent;
  }
  return hands;
}
