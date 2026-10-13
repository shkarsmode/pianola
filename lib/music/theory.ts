/** Pitch names, chord qualities and the voicings shown when a chord is clicked. */

export const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const UK_NATURAL: Record<string, string> = { C: "до", D: "ре", E: "мі", F: "фа", G: "соль", A: "ля", B: "сі" };

export const pc = (p: number) => ((p % 12) + 12) % 12;
export const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(pc(p));
export const octaveOf = (p: number) => Math.floor(p / 12) - 1;

const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]);
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);

export function keyUsesFlats(tonic: number, mode: "major" | "minor"): boolean {
  return (mode === "major" ? FLAT_MAJOR : FLAT_MINOR).has(pc(tonic));
}

export function pcName(p: number, flats = false): string {
  return (flats ? FLAT : SHARP)[pc(p)];
}

export function noteName(p: number, flats = false): string {
  return pcName(p, flats) + octaveOf(p);
}

/** Ukrainian solfège: "до", "фа-дієз", "сі-бемоль". */
export function ukName(p: number, flats = false): string {
  const name = pcName(p, flats);
  const base = UK_NATURAL[name[0]];
  if (name.length === 1) return base;
  return base + (name[1] === "#" ? "-дієз" : "-бемоль");
}

export interface Quality {
  iv: number[];
  suffix: string;
  uk: string;
}

export const QUALITIES: Record<string, Quality> = {
  maj: { iv: [0, 4, 7], suffix: "", uk: "мажор" },
  min: { iv: [0, 3, 7], suffix: "m", uk: "мінор" },
  "7": { iv: [0, 4, 7, 10], suffix: "7", uk: "домінантсептакорд" },
  m7: { iv: [0, 3, 7, 10], suffix: "m7", uk: "мінорний септакорд" },
  maj7: { iv: [0, 4, 7, 11], suffix: "maj7", uk: "великий мажорний септакорд" },
  dim: { iv: [0, 3, 6], suffix: "dim", uk: "зменшений" },
  sus4: { iv: [0, 5, 7], suffix: "sus4", uk: "з квартою (без терції)" },
  sus2: { iv: [0, 2, 7], suffix: "sus2", uk: "з секундою (без терції)" },
  aug: { iv: [0, 4, 8], suffix: "aug", uk: "збільшений" },
};

export interface Chord {
  root: number;
  q: string;
  bass: number;
}

export function chordPcs(c: Chord): number[] {
  const q = QUALITIES[c.q] ?? QUALITIES.maj;
  return q.iv.map((i) => pc(c.root + i));
}

export function chordName(c: Chord, flats = false): string {
  const q = QUALITIES[c.q] ?? QUALITIES.maj;
  let n = pcName(c.root, flats) + q.suffix;
  if (pc(c.bass) !== pc(c.root)) n += "/" + pcName(c.bass, flats);
  return n;
}

export function chordUkTitle(c: Chord, flats = false): string {
  const q = QUALITIES[c.q] ?? QUALITIES.maj;
  let t = `${ukName(c.root, flats)} ${q.uk}`;
  if (pc(c.bass) !== pc(c.root)) t += `, бас ${ukName(c.bass, flats)}`;
  return t;
}

export function transposeChord(c: Chord, semis: number): Chord {
  return { root: pc(c.root + semis), q: c.q, bass: pc(c.bass + semis) };
}

/** Sharps or flats for a key after transposition (the key keeps its mode). */
export function flatsForKey(tonic: number, mode: "major" | "minor", semis = 0): boolean {
  return keyUsesFlats(pc(tonic + semis), mode);
}

/** The lowest pitch >= lo with the given pitch class. */
export function pitchAtOrAbove(pclass: number, lo: number): number {
  return lo + ((pc(pclass) - pc(lo) + 12) % 12);
}

/** Close-position voicing: inversion 0 = root position, 1 = third in the bass, 2 = fifth... */
export function closeVoicing(c: Chord, inversion: number, lowest: number): number[] {
  const pcs = chordPcs(c);
  const n = pcs.length;
  const inv = ((inversion % n) + n) % n;
  const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
  const out: number[] = [];
  let cur = pitchAtOrAbove(order[0], lowest);
  out.push(cur);
  for (let i = 1; i < n; i++) {
    cur = pitchAtOrAbove(order[i], cur + 1);
    out.push(cur);
  }
  return out;
}

/** Standard fingerings for a close triad / seventh chord. */
export function chordFingers(hand: "L" | "R", size: number, inversion: number): number[] {
  if (size === 4) return hand === "R" ? [1, 2, 3, 5] : [5, 3, 2, 1];
  if (hand === "R") return inversion === 1 ? [1, 2, 5] : [1, 3, 5];
  return inversion === 2 ? [5, 2, 1] : [5, 3, 1];
}

/** What the chord popover shows: a right-hand shape near middle C and a left-hand bass. */
export function teachingVoicing(c: Chord, inversion: number) {
  const pcs = chordPcs(c);
  const inv = ((inversion % pcs.length) + pcs.length) % pcs.length;
  // Root position starts at the root between G3 and F#4; inversions stay near it.
  const rootPitch = pitchAtOrAbove(c.root, 55);
  const lowest = inv === 0 ? rootPitch : pitchAtOrAbove(pcs[inv], rootPitch - 5);
  const rh = closeVoicing(c, inv, lowest);
  const bass = pitchAtOrAbove(c.bass, 43); // G2..F#3
  const lhFifth = pc(c.bass) === pc(c.root) ? bass + 7 : null;
  return {
    rh,
    rhFingers: chordFingers("R", rh.length, inv),
    lh: lhFifth ? [bass, lhFifth] : [bass],
    lhFingers: lhFifth ? [5, 1] : [5],
  };
}
