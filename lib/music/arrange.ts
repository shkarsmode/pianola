/**
 * Builds a playable two-hand part for a difficulty level from the song analysis.
 *
 * Generated levels work in beats (on the tracked beat grid) from the melody and the chord
 * chart, so every note lands in rhythm even when the recording speeds up or slows down;
 * "advanced"/"adaptive" on a piano recording keep the real performance, split into hands.
 */
import type { Analysis, Hand, PNote } from "../types";
import { BeatMap, quant } from "./beatmap";
import { assignFingering } from "./fingering";
import { splitHands } from "./handsplit";
import { type Chord, chordPcs, closeVoicing, pc, pitchAtOrAbove } from "./theory";

export type LevelId =
  | "adaptive"
  | "beginner"
  | "beginner_plus"
  | "intermediate"
  | "intermediate_plus"
  | "advanced"
  | "pretty";

export interface LevelInfo {
  id: LevelId;
  title: string;
  hint: string;
  stars: number;
}

export const LEVELS: LevelInfo[] = [
  { id: "adaptive", title: "Адаптивний", hint: "Найближче до оригіналу, але так, щоб реально зіграти", stars: 0 },
  { id: "beginner", title: "Новачок", hint: "Мелодія по одній ноті, ліва рука — один бас на акорд", stars: 1 },
  { id: "beginner_plus", title: "Новачок+", hint: "Мелодія і бас із квінтою", stars: 2 },
  { id: "intermediate", title: "Середній", hint: "Мелодія, бас на сильні долі, акорди на слабкі", stars: 3 },
  { id: "intermediate_plus", title: "Середній+", hint: "Мелодія з підголосками, ліва рука — арпеджіо з педаллю", stars: 4 },
  { id: "advanced", title: "Просунутий", hint: "Повна партія обома руками", stars: 5 },
  { id: "pretty", title: "Гарно і просто", hint: "Звучить красиво, а грати легко: повільні арпеджіо з педаллю", stars: 0 },
];

export interface Arrangement {
  level: LevelId;
  notes: PNote[];
  pedal: [number, number][];
}

type Role = "mel" | "harm" | "bass" | "chord" | "arp" | "fill";

interface BNote {
  p: number;
  b: number; // start, beats
  d: number; // duration, beats
  v: number;
  hand: Hand;
  role: Role;
}

interface BChord extends Chord {
  b0: number;
  b1: number;
  pcs: number[];
}

interface LevelSpec {
  minNoteSec: number; // shorter melody notes are merged away
  minChordBeats: number;
  simpleChords: boolean;
}

const SPECS: Record<LevelId, LevelSpec> = {
  // The tune is the song: only notes quicker than a grid step (ornaments, slides) are merged.
  beginner: { minNoteSec: 0.15, minChordBeats: 2, simpleChords: true },
  beginner_plus: { minNoteSec: 0.13, minChordBeats: 1, simpleChords: true },
  intermediate: { minNoteSec: 0.11, minChordBeats: 1, simpleChords: false },
  intermediate_plus: { minNoteSec: 0.09, minChordBeats: 1, simpleChords: false },
  advanced: { minNoteSec: 0.07, minChordBeats: 1, simpleChords: false },
  adaptive: { minNoteSec: 0.08, minChordBeats: 1, simpleChords: false },
  pretty: { minNoteSec: 0.13, minChordBeats: 1, simpleChords: false },
};

const EPS = 1e-6;

// ---------------------------------------------------------------- melody

function prepareMelody(an: Analysis, map: BeatMap, spec: LevelSpec): BNote[] {
  const grid = 1 / (an.subdiv || 4);
  const raw: BNote[] = [];
  for (const [p, s, e, v] of an.melody) {
    const b = quant(map.beatAt(s), grid);
    let end = quant(map.beatAt(e), grid);
    if (end <= b + EPS) end = b + grid;
    raw.push({ p, b, d: end - b, v, hand: "R", role: "mel" });
  }
  raw.sort((x, y) => x.b - y.b || y.d - x.d);

  // One note at a time: same slot keeps the longer note, overlaps are cut.
  const mono: BNote[] = [];
  for (const n of raw) {
    const last = mono[mono.length - 1];
    if (last && Math.abs(last.b - n.b) < EPS) {
      if (n.d > last.d) mono[mono.length - 1] = n;
      continue;
    }
    if (last && last.b + last.d > n.b) last.d = n.b - last.b;
    mono.push(n);
  }

  // Merge notes that are too quick for the level into their neighbours.
  const out: BNote[] = [];
  for (let i = 0; i < mono.length; i++) {
    const n = mono[i];
    const sec = map.timeAt(n.b + n.d) - map.timeAt(n.b);
    if (sec >= spec.minNoteSec - EPS) {
      out.push(n);
      continue;
    }
    const prev = out[out.length - 1];
    const next = mono[i + 1];
    if (prev && Math.abs(prev.b + prev.d - n.b) < EPS && Math.abs(prev.p - n.p) <= 4) {
      prev.d += n.d;
      continue;
    }
    const room = (next ? next.b : Infinity) - n.b;
    const need = map.beatAt(map.timeAt(n.b) + spec.minNoteSec) - n.b;
    if (room >= need - EPS) {
      out.push({ ...n, d: Math.max(n.d, Math.ceil(need / grid - EPS) * grid) });
    } else if (prev && Math.abs(prev.b + prev.d - n.b) < EPS) {
      prev.d += n.d;
    }
  }

  // Put the tune where the right hand lives: as many notes as possible between G3 and A5,
  // centred near G4 (a sung male line comes out an octave or two too low).
  if (out.length) {
    const ps = out.map((n) => n.p).sort((a, b) => a - b);
    const median = ps[Math.floor(ps.length / 2)];
    let shift = 0;
    let bestScore = Infinity;
    for (let k = -3; k <= 3; k++) {
      const sh = 12 * k;
      const outside = ps.filter((p) => p + sh < 55 || p + sh > 81).length / ps.length;
      const score = outside * 4 + Math.abs(median + sh - 67) / 12;
      if (score < bestScore) {
        bestScore = score;
        shift = sh;
      }
    }
    for (const n of out) n.p += shift;
  }
  for (const n of out) n.v = Math.round(Math.min(110, 74 + n.v * 0.22));
  return out;
}

// ---------------------------------------------------------------- chords

function prepareChords(an: Analysis, map: BeatMap, spec: LevelSpec): BChord[] {
  const list: BChord[] = [];
  for (const c of an.chords) {
    if (c.root == null || c.q === "N") continue;
    const b0 = Math.round(map.beatAt(c.s));
    const b1 = Math.round(map.beatAt(c.e));
    if (b1 <= b0) continue;
    let q = c.q;
    if (spec.simpleChords) {
      q = q === "m7" ? "min" : q === "7" || q === "maj7" || q === "sus4" || q === "sus2" ? "maj" : q;
    }
    const ch: Chord = { root: c.root, q, bass: c.bass ?? c.root };
    list.push({ ...ch, b0, b1, pcs: chordPcs(ch) });
  }
  // Chords too short for the level fold into the previous one.
  const out: BChord[] = [];
  for (const c of list) {
    const last = out[out.length - 1];
    if (last && c.b1 - c.b0 < spec.minChordBeats && last.b1 >= c.b0) {
      last.b1 = c.b1;
      continue;
    }
    if (last && last.root === c.root && last.q === c.q && last.bass === c.bass && last.b1 >= c.b0) {
      last.b1 = c.b1;
      continue;
    }
    out.push({ ...c });
  }
  return out;
}

function chordAt(chords: BChord[], b: number): BChord | null {
  let lo = 0;
  let hi = chords.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chords[mid].b1 <= b + EPS) lo = mid + 1;
    else if (chords[mid].b0 > b + EPS) hi = mid - 1;
    else return chords[mid];
  }
  return null;
}

// ---------------------------------------------------------------- voicing helpers

class Voicer {
  private bass: number | null = null;
  private triad: number[] | null = null;

  constructor(
    private bassLo: number,
    private bassHi: number,
    private triadLo: number,
    private triadHi: number,
  ) {}

  bassOf(c: BChord): number {
    const cands: number[] = [];
    for (let p = pitchAtOrAbove(c.bass, this.bassLo); p <= this.bassHi; p += 12) cands.push(p);
    if (!cands.length) cands.push(pitchAtOrAbove(c.bass, this.bassLo));
    const centre = (this.bassLo + this.bassHi) / 2;
    const ref = this.bass ?? centre;
    cands.sort((a, b) => Math.abs(a - ref) + Math.abs(a - centre) * 0.3 - (Math.abs(b - ref) + Math.abs(b - centre) * 0.3));
    this.bass = cands[0];
    return cands[0];
  }

  /** Three-note shape (root, third, fifth — or seventh instead of the fifth), voice-led. */
  triadOf(c: BChord): number[] {
    const has7 = c.pcs.length >= 4;
    const shape: Chord & { pcs?: number[] } = { root: c.root, q: c.q, bass: c.root };
    const pcs = has7 ? [c.pcs[0], c.pcs[1], c.pcs[3]] : c.pcs.slice(0, 3);
    const cands: number[][] = [];
    for (let inv = 0; inv < 3; inv++) {
      const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
      for (let start = this.triadLo; start <= this.triadHi; start++) {
        if (pc(start) !== order[0]) continue;
        const v = [start];
        for (let k = 1; k < 3; k++) v.push(pitchAtOrAbove(order[k], v[k - 1] + 1));
        cands.push(v);
      }
    }
    if (!cands.length) cands.push(closeVoicing(shape, 0, this.triadLo));
    const centre = (this.triadLo + this.triadHi) / 2 + 3;
    const prev = this.triad;
    let best = cands[0];
    let bestCost = Infinity;
    for (const v of cands) {
      const mean = (v[0] + v[1] + v[2]) / 3;
      let cost = Math.abs(mean - centre) * 0.5;
      if (prev) cost += Math.abs(v[0] - prev[0]) + Math.abs(v[1] - prev[1]) + Math.abs(v[2] - prev[2]);
      if (cost < bestCost) {
        bestCost = cost;
        best = v;
      }
    }
    this.triad = best;
    return best;
  }
}

function thirdOf(c: BChord): number {
  const iv = (c.pcs[1] - c.pcs[0] + 12) % 12;
  return iv;
}

// ---------------------------------------------------------------- left hand

type Kind = "root" | "fifth" | "alt" | "octave" | "tenth" | "triad" | "dyad" | "octdyad";

function emit(out: BNote[], pitches: number[], b: number, d: number, v: number, role: Role) {
  for (const p of pitches) out.push({ p, b, d, v, hand: "L", role });
}

function kindPitches(kind: Kind, c: BChord, voicer: Voicer, bassNow: number): number[] {
  switch (kind) {
    case "root":
      return [bassNow];
    case "fifth":
      return [bassNow + 7];
    case "alt":
      // alternating bass: the fifth below when the root already sits high
      return [bassNow >= 47 ? bassNow - 5 : bassNow + 7];
    case "octave":
      return [bassNow + 12];
    case "tenth":
      return [bassNow + 12 + thirdOf(c)];
    case "dyad":
      return [bassNow, bassNow + 7];
    case "octdyad":
      return [bassNow, bassNow + 12];
    case "triad":
      return voicer.triadOf(c);
  }
}

/** Steps through the song a slot at a time; at each slot the active chord decides the notes. */
function slotPattern(
  out: BNote[],
  chords: BChord[],
  map: BeatMap,
  voicer: Voicer,
  slotsPerBar: (len: number) => { off: number; dur: number; kind: Kind; v: number; role: Role }[],
) {
  let lastChord: BChord | null = null;
  let bassNow = 0;
  for (const bar of map.bars) {
    for (const slot of slotsPerBar(bar.len)) {
      const b = bar.start + slot.off;
      const c = chordAt(chords, b);
      if (!c) {
        lastChord = null;
        continue;
      }
      const isNew = c !== lastChord;
      if (isNew) bassNow = voicer.bassOf(c);
      lastChord = c;
      const kind: Kind = isNew && slot.kind === "alt" ? "root" : slot.kind;
      const dur = Math.min(slot.dur, c.b1 - b);
      if (dur <= EPS) continue;
      emit(out, kindPitches(kind, c, voicer, bassNow), b, dur, slot.v, slot.role);
    }
  }
}

function leftHand(level: LevelId, chords: BChord[], map: BeatMap, an: Analysis): BNote[] {
  const out: BNote[] = [];
  const tempo = an.tempo || 100;
  const triplet = an.subdiv === 3;
  const eighth = triplet ? 2 / 3 : 0.5; // second eighth of a beat (swung in a shuffle)

  if (level === "beginner" || level === "beginner_plus") {
    const voicer = level === "beginner" ? new Voicer(48, 59, 50, 60) : new Voicer(45, 56, 50, 60);
    for (const bar of map.bars) {
      const half = bar.len === 4 && level === "beginner_plus" ? 2 : bar.len;
      for (let off = 0; off < bar.len; off += half) {
        const b0 = bar.start + off;
        const b1 = Math.min(bar.start + bar.len, b0 + half);
        for (const c of chords) {
          if (c.b1 <= b0 || c.b0 >= b1) continue;
          const s = Math.max(b0, c.b0);
          const e = Math.min(b1, c.b1);
          if (e - s < 1 - EPS) continue;
          const bass = voicer.bassOf(c);
          emit(out, level === "beginner" ? [bass] : [bass, bass + 7], s, e - s, 64, "bass");
        }
      }
    }
    return out;
  }

  const slots = (pattern: Kind[], step: number, v: number[], role: Role[]) => (len: number) => {
    const res = [];
    const per = Math.round(1 / step);
    const count = Math.round(len / step);
    for (let k = 0; k < count; k++) {
      const beat = Math.floor(k / per);
      const sub = k % per;
      const off = beat + (step === 1 ? 0 : sub === 0 ? 0 : eighth);
      const next = sub === per - 1 ? beat + 1 : beat + eighth;
      res.push({ off, dur: next - off, kind: pattern[k % pattern.length], v: v[k % v.length], role: role[k % role.length] });
    }
    return res;
  };

  const arpeggio = (voicer: Voicer, pattern: Kind[]) =>
    slotPattern(out, chords, map, voicer, slots(pattern, 0.5, [60, 52, 54, 52], ["arp"]));

  if (level === "intermediate" || level === "adaptive") {
    if (tempo < 76) {
      arpeggio(new Voicer(40, 51, 50, 57), ["root", "fifth", "octave", "fifth"]);
    } else {
      slotPattern(out, chords, map, new Voicer(40, 51, 50, 57), (len) => {
        const kinds: Kind[] = (len === 3 ? ["root", "triad", "triad"] : ["root", "triad", "alt", "triad"]).slice(0, len) as Kind[];
        return kinds.map((kind, i) => ({
          off: i,
          dur: kind === "triad" ? 0.9 : 1,
          kind,
          v: kind === "triad" ? 50 : 64,
          role: (kind === "triad" ? "chord" : "bass") as Role,
        }));
      });
    }
    return out;
  }

  if (level === "intermediate_plus") {
    if (tempo > 140) {
      slotPattern(out, chords, map, new Voicer(40, 50, 50, 57), slots(["root", "fifth", "octave", "fifth"], 1, [60, 52], ["arp"]));
    } else {
      arpeggio(new Voicer(40, 50, 50, 57), ["root", "fifth", "octave", "fifth"]);
    }
    return out;
  }

  if (level === "advanced") {
    const pattern: Kind[] = ["octdyad", "fifth", "tenth", "fifth", "octave", "fifth", "tenth", "fifth"];
    slotPattern(out, chords, map, new Voicer(36, 47, 50, 57), slots(pattern, tempo > 140 ? 1 : 0.5, [66, 52, 56, 52], ["arp"]));
    return out;
  }

  // pretty: unhurried broken chord in quarter notes, carried by the pedal
  const pattern: Kind[] = ["root", "fifth", "octave", "fifth"];
  slotPattern(out, chords, map, new Voicer(36, 47, 50, 57), (len) =>
    Array.from({ length: len }, (_, i) => ({
      off: i,
      dur: 1,
      kind: len === 3 ? (["root", "fifth", "octave"] as Kind[])[i] : pattern[i % 4],
      // (a pickup bar of one or two beats just takes the start of the pattern)
      v: i === 0 ? 58 : 48,
      role: "arp" as Role,
    })),
  );
  return out;
}

// ---------------------------------------------------------------- right-hand additions

const HARM_PREF: Record<number, number> = { 3: 0, 4: 0, 8: 0.2, 9: 0.2, 5: 0.6, 7: 1.2 };

function harmonise(mel: BNote[], chords: BChord[], minBeats: number, onBeatOnly: boolean, voices: number): BNote[] {
  const out: BNote[] = [];
  for (const n of mel) {
    if (n.d < minBeats - EPS || n.p < 62) continue;
    if (onBeatOnly && Math.abs(n.b - Math.round(n.b)) > EPS) continue;
    const c = chordAt(chords, n.b);
    if (!c) continue;
    const used = new Set([pc(n.p)]);
    let top = n.p;
    for (let k = 0; k < voices; k++) {
      let best: number | null = null;
      let bestCost = Infinity;
      for (let iv = 3; iv <= 9; iv++) {
        const cand = top - iv;
        if (!c.pcs.includes(pc(cand)) || used.has(pc(cand))) continue;
        if (n.p - cand > 12) continue;
        const cost = HARM_PREF[iv] ?? 1;
        if (cost < bestCost) {
          bestCost = cost;
          best = cand;
        }
      }
      if (best == null) break;
      out.push({ p: best, b: n.b, d: n.d, v: Math.round(n.v * 0.7), hand: "R", role: "harm" });
      used.add(pc(best));
      top = best;
      if (k === 0 && Math.abs(n.b % 1) > EPS) break; // a second voice only on the beat
    }
  }
  return out;
}

/** Bars without any melody get soft chord stabs on the weak beats. */
function fillEmptyBars(mel: BNote[], chords: BChord[], map: BeatMap): BNote[] {
  const out: BNote[] = [];
  const voicer = new Voicer(40, 51, 60, 67);
  let mi = 0;
  for (const bar of map.bars) {
    const b0 = bar.start;
    const b1 = bar.start + bar.len;
    while (mi < mel.length && mel[mi].b + mel[mi].d <= b0 + EPS) mi++;
    const busy = mi < mel.length && mel[mi].b < b1 - EPS;
    if (busy) continue;
    const offs = (bar.len === 3 ? [1, 2] : [1, 3]).filter((o) => o < bar.len);
    for (const off of offs) {
      const c = chordAt(chords, b0 + off);
      if (!c) continue;
      for (const p of voicer.triadOf(c)) out.push({ p, b: b0 + off, d: 0.9, v: 50, hand: "R", role: "fill" });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the song's own bass line

/**
 * The bass player's line, from the transcribed accompaniment: lowest note of each attack,
 * on the song's grid, held to chord tones where it lingers. Following its rhythm is what makes
 * a piano part groove like the record. Returns null when the song has no real bass line.
 */
function bassLine(an: Analysis, map: BeatMap, chords: BChord[]): BNote[] | null {
  const grid = 1 / (an.subdiv || 4);
  const low = an.notes.filter(([p, s, e]) => p < 55 && e - s >= 0.08).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const picked: [number, number, number, number][] = [];
  for (const n of low) {
    const last = picked[picked.length - 1];
    if (last && n[1] - last[1] < 0.04) {
      if (n[0] < last[0]) picked[picked.length - 1] = n;
      continue;
    }
    picked.push(n);
  }
  const out: BNote[] = [];
  let prevPitch = 43;
  for (let i = 0; i < picked.length; i++) {
    const [p, s, e, v] = picked[i];
    const b = quant(map.beatAt(s), grid);
    const nextStart = i + 1 < picked.length ? quant(map.beatAt(picked[i + 1][1]), grid) : Infinity;
    let end = Math.min(quant(map.beatAt(e), grid), nextStart);
    if (end <= b + EPS) end = b + grid;
    const last = out[out.length - 1];
    if (last && Math.abs(last.b - b) < EPS) continue; // one note per grid slot
    if (last && map.timeAt(b) - map.timeAt(last.b) < 0.12) continue; // quicker than a hand repeats
    let pc0 = ((p % 12) + 12) % 12;
    const c = chordAt(chords, b);
    if (c && end - b >= 1 - EPS && !c.pcs.includes(pc0)) pc0 = c.bass; // a held wrong note: take the chord's bass
    // nearest octave to the previous note, inside C2..E3
    let q = pitchAtOrAbove(pc0, 36);
    if (q + 12 <= 52 && Math.abs(q + 12 - prevPitch) < Math.abs(q - prevPitch)) q += 12;
    prevPitch = q;
    out.push({ p: q, b, d: end - b, v: Math.round(Math.min(78, 52 + v * 0.2)), hand: "L", role: "bass" });
  }
  if (!out.length) return null;
  const covered = map.bars.filter((bar) => out.some((n) => n.b >= bar.start - EPS && n.b < bar.start + bar.len - EPS)).length;
  return covered >= map.bars.length * 0.5 ? out : null;
}

// ---------------------------------------------------------------- raw performance (piano sources)

function rawPart(an: Analysis, map: BeatMap, level: LevelId): PNote[] {
  const src = an.notes.filter(([, s, e, v]) => e - s >= 0.04 && v >= 12);
  const raw = src.map(([pitch, start, end, vel]) => ({ pitch, start, end, vel }));
  const hands = splitHands(raw);
  const maxNotes = level === "adaptive" ? 4 : 5;
  const maxSpan = level === "adaptive" ? 12 : 15;
  const notes: PNote[] = raw.map((n, i) => ({ ...n, hand: hands[i] }));

  // Playability per hand and onset group: too many notes or too wide -> drop inner/outer notes.
  const keep = new Array(notes.length).fill(true);
  for (const hand of ["L", "R"] as Hand[]) {
    const idx = notes.map((_, i) => i).filter((i) => notes[i].hand === hand).sort((a, b) => notes[a].start - notes[b].start);
    let g: number[] = [];
    const flush = () => {
      if (!g.length) return;
      const byPitch = [...g].sort((a, b) => notes[a].pitch - notes[b].pitch);
      // the outer voice that carries the line: top for the right hand, bass for the left
      const anchor = hand === "R" ? byPitch[byPitch.length - 1] : byPitch[0];
      const ap = notes[anchor].pitch;
      const ok = byPitch.filter((i) => Math.abs(notes[i].pitch - ap) <= maxSpan);
      for (const i of byPitch) if (!ok.includes(i)) keep[i] = false;
      if (ok.length > maxNotes) {
        const sorted = [...ok].sort((a, b) => Math.abs(notes[b].pitch - ap) - Math.abs(notes[a].pitch - ap));
        // keep the anchor and the farthest notes (shape), drop inner doublings first
        const inner = sorted.filter((i) => i !== anchor);
        const dropCount = ok.length - maxNotes;
        const byInner = inner.slice(1).sort((a, b) => notes[a].vel - notes[b].vel);
        for (let k = 0; k < dropCount && k < byInner.length; k++) keep[byInner[k]] = false;
      }
      g = [];
    };
    for (const i of idx) {
      if (g.length && notes[i].start - notes[g[0]].start > 0.035) flush();
      g.push(i);
    }
    flush();
  }
  let out = notes.filter((_, i) => keep[i]);

  if (level === "adaptive") {
    // Very fast ornaments in the accompaniment are the first thing a learner can skip.
    out = out.filter((n) => n.hand === "R" || n.end - n.start >= Math.min(0.09, map.beatLen(map.beatAt(n.start)) / 5));
  }
  return out;
}

// ---------------------------------------------------------------- assembly

function toSeconds(notes: BNote[], map: BeatMap): PNote[] {
  return notes.map((n) => {
    const start = map.timeAt(n.b);
    const end = map.timeAt(n.b + n.d);
    const gap = Math.min(0.03, (end - start) * 0.12);
    return { pitch: n.p, start, end: end - gap, vel: n.v, hand: n.hand };
  });
}

/** Moves left-hand events below the right hand where they would collide. */
function separateHands(notes: PNote[]): PNote[] {
  const right = notes.filter((n) => n.hand === "R").sort((a, b) => a.start - b.start);
  const left = notes.filter((n) => n.hand === "L");
  const groups = new Map<number, PNote[]>();
  for (const n of left) {
    const key = Math.round(n.start * 1000);
    const g = groups.get(key) ?? [];
    g.push(n);
    groups.set(key, g);
  }
  const keepLeft: PNote[] = [];
  for (const g of groups.values()) {
    const s = g[0].start;
    const e = Math.max(...g.map((n) => n.end));
    let rMin = Infinity;
    for (const r of right) {
      if (r.start >= e) break;
      if (r.end > s + 0.02) rMin = Math.min(rMin, r.pitch);
    }
    const top = Math.max(...g.map((n) => n.pitch));
    let shift = 0;
    while (top + shift >= rMin - 1 && Math.min(...g.map((n) => n.pitch)) + shift - 12 >= 28) shift -= 12;
    if (top + shift >= rMin - 1) {
      // still colliding: keep only what fits under the right hand
      for (const n of g) if (n.pitch + shift < rMin - 1) keepLeft.push({ ...n, pitch: n.pitch + shift });
      continue;
    }
    for (const n of g) keepLeft.push({ ...n, pitch: n.pitch + shift });
  }
  return right.concat(keepLeft);
}

/** The same key struck twice at once by one hand (a doubling from two layers) is one note. */
function dedupe(notes: PNote[]): PNote[] {
  const seen = new Map<string, PNote>();
  for (const n of notes) {
    const key = `${n.hand}:${n.pitch}:${Math.round(n.start * 50)}`;
    const prev = seen.get(key);
    if (!prev || n.end - n.start > prev.end - prev.start) seen.set(key, n);
  }
  return [...seen.values()];
}

function chordPedal(chords: BChord[], map: BeatMap): [number, number][] {
  return chords.map((c) => [map.timeAt(c.b0) + 0.03, map.timeAt(c.b1) - 0.03] as [number, number]);
}

export function arrange(an: Analysis, level: LevelId): Arrangement {
  const map = new BeatMap(an.beats, an.barPos, an.timeSig);
  const spec = SPECS[level];

  if ((level === "advanced" || level === "adaptive") && an.sourceType === "piano") {
    const notes = rawPart(an, map, level);
    assignFingering(notes);
    return { level, notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch), pedal: an.pedal };
  }

  const mel = prepareMelody(an, map, spec);
  const chords = prepareChords(an, map, spec);
  // Adaptive on a band recording follows the record's own bass line (its groove), with a
  // chord tone under long melody notes; songs without a usable bass get the bass+chord pattern.
  const bass = level === "adaptive" && an.sourceType === "mix" ? bassLine(an, map, chords) : null;
  const parts: BNote[] = [...mel, ...(bass ?? leftHand(level, chords, map, an))];
  if (bass) parts.push(...harmonise(mel, chords, 1, true, 1));
  if (level === "intermediate_plus") parts.push(...harmonise(mel, chords, 1, true, 1));
  if (level === "advanced") parts.push(...harmonise(mel, chords, 0.5, false, 2));
  if (level === "pretty") parts.push(...harmonise(mel, chords, 2, true, 1));
  if (level === "intermediate" || level === "intermediate_plus" || level === "adaptive" || level === "advanced") {
    parts.push(...fillEmptyBars(mel, chords, map));
  }

  let notes = separateHands(toSeconds(parts, map));
  notes = dedupe(notes.filter((n) => n.end > n.start));
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  assignFingering(notes);
  const pedal = level === "intermediate_plus" || level === "advanced" || level === "pretty" ? chordPedal(chords, map) : [];
  return { level, notes, pedal };
}

/** Shift (in semitones, -6..5) that leaves the fewest black keys; ties go to the smaller shift. */
export function easiestTranspose(notes: PNote[]): number {
  let best = 0;
  let bestCount = Infinity;
  for (const t of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6]) {
    let count = 0;
    for (const n of notes) if ([1, 3, 6, 8, 10].includes(pc(n.pitch + t))) count++;
    if (count < bestCount - notes.length * 0.02) {
      bestCount = count;
      best = t;
    }
  }
  return best;
}
