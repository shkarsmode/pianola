import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Analysis, PNote } from "../types";
import { arrange, LEVELS } from "./arrange";
import { assignFingering } from "./fingering";
import { noteName } from "./theory";

const SAMPLES = ["tzRbxEm1JKU", "yMImFLVKzu0", "HGqwlSCoqPc"]
  .map((id) => `worker/work/${id}/analysis.json`)
  .filter((p) => existsSync(p));

function groups(notes: PNote[], hand: "L" | "R") {
  const hs = notes.filter((n) => n.hand === hand).sort((a, b) => a.start - b.start);
  const out: PNote[][] = [];
  for (const n of hs) {
    const g = out[out.length - 1];
    if (g && n.start - g[0].start < 0.03) g.push(n);
    else out.push([n]);
  }
  return out;
}

describe("fingering", () => {
  it("fingers a C major scale with the thumb passing under after E", () => {
    const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
    const notes: PNote[] = pitches.map((p, i) => ({ pitch: p, start: i * 0.25, end: i * 0.25 + 0.24, vel: 80, hand: "R" }));
    assignFingering(notes);
    expect(notes.map((n) => n.finger)).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });

  it("uses 1-3-5 / 5-3-1 for root position triads", () => {
    const rh: PNote[] = [60, 64, 67].map((p) => ({ pitch: p, start: 0, end: 1, vel: 80, hand: "R" }));
    const lh: PNote[] = [48, 52, 55].map((p) => ({ pitch: p, start: 0, end: 1, vel: 80, hand: "L" }));
    assignFingering([...rh, ...lh]);
    expect(rh.map((n) => n.finger)).toEqual([1, 3, 5]);
    expect(lh.map((n) => n.finger)).toEqual([5, 3, 1]);
  });
});

describe.each(SAMPLES)("arrangements of %s", (path) => {
  const an = JSON.parse(readFileSync(path, "utf8")) as Analysis;

  it.each(LEVELS.map((l) => l.id))("%s is playable", (level) => {
    const { notes } = arrange(an, level);
    expect(notes.length).toBeGreaterThan(20);
    const maxNotes = level === "beginner" ? 1 : level === "beginner_plus" ? 2 : 5;
    for (const hand of ["L", "R"] as const) {
      for (const g of groups(notes, hand)) {
        const ps = g.map((n) => n.pitch);
        const span = Math.max(...ps) - Math.min(...ps);
        expect(span, `${level} ${hand} span at ${g[0].start.toFixed(2)}`).toBeLessThanOrEqual(level === "advanced" ? 16 : 12);
        if (hand === "R" || level === "beginner") expect(g.length).toBeLessThanOrEqual(level === "beginner" ? 1 : maxNotes);
      }
    }
    // every note has a finger
    expect(notes.filter((n) => !n.finger).length).toBe(0);
    // hands never sit on top of each other at the same moment
    const R = notes.filter((n) => n.hand === "R");
    const L = notes.filter((n) => n.hand === "L");
    let clashes = 0;
    for (const l of L) for (const r of R) if (r.start < l.end - 0.02 && l.start < r.end - 0.02 && l.pitch >= r.pitch) clashes++;
    expect(clashes, `${level} hand clashes`).toBe(0);
  });

  it("prints the first bars of each level", () => {
    for (const level of ["beginner", "intermediate", "pretty"] as const) {
      const { notes } = arrange(an, level);
      const head = notes.filter((n) => n.start >= 9 && n.start < 14);
      console.log(
        level,
        head.map((n) => `${n.hand}${noteName(n.pitch)}(${n.finger})@${n.start.toFixed(2)}`).join(" "),
      );
    }
  });
});
