/** Canvas renderer for the falling-notes view and the keyboard under it. */
import type { Hand, PNote } from "../types";
import { isBlack, noteName, ukName } from "../music/theory";
import { KeyboardLayout } from "./keyboard";

export interface RollChord {
  start: number;
  end: number;
  name: string;
  index: number;
}

export interface RollOptions {
  fingers: boolean;
  names: "none" | "letters" | "solfege";
  chords: boolean;
  showL: boolean;
  showR: boolean;
  pxPerSec: number;
  flats: boolean;
  effects: boolean;
  colors: Record<Hand, string>;
}

export type RollHit =
  | { type: "chord"; index: number; rect: DOMRect }
  | { type: "key"; pitch: number }
  | { type: "note"; note: PNote }
  | { type: "roll" };

export const DEFAULT_COLORS: Record<Hand, string> = { L: "#25c48d", R: "#4b8bff" };

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const rgba = (rgb: [number, number, number], a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
const shade = (rgb: [number, number, number], f: number): [number, number, number] =>
  f >= 0
    ? [rgb[0] + (255 - rgb[0]) * f, rgb[1] + (255 - rgb[1]) * f, rgb[2] + (255 - rgb[2]) * f]
    : [rgb[0] * (1 + f), rgb[1] * (1 + f), rgb[2] * (1 + f)];

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class RollRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private layout: KeyboardLayout | null = null;
  private range: [number, number] = [36, 96];
  private notes: PNote[] = [];
  private maxDur = 1;
  private chords: RollChord[] = [];
  private bars: number[] = [];
  private beats: number[] = [];
  private chordRects: { index: number; x: number; y: number; w: number; h: number }[] = [];
  private font = "system-ui, sans-serif";
  pressed = new Map<number, Hand | "wrong">();
  opts: RollOptions = {
    fingers: true,
    names: "none",
    chords: true,
    showL: true,
    showR: true,
    pxPerSec: 150,
    flats: false,
    effects: true,
    colors: DEFAULT_COLORS,
  };

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas 2d unavailable");
    this.ctx = ctx;
    if (typeof window !== "undefined") {
      const ff = getComputedStyle(document.body).fontFamily;
      if (ff) this.font = ff;
    }
  }

  get keyboardHeight(): number {
    if (!this.layout) return 100;
    return Math.max(56, Math.min(132, this.layout.whiteW * 3.7, this.h * 0.24));
  }

  get hitY(): number {
    return this.h - this.keyboardHeight;
  }

  get size() {
    return { w: this.w, h: this.h };
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.relayout();
  }

  setRange(lo: number, hi: number) {
    this.range = [lo, hi];
    this.relayout();
  }

  private relayout() {
    if (this.w > 0) this.layout = new KeyboardLayout(this.range[0], this.range[1], this.w);
  }

  setData(notes: PNote[], chords: RollChord[], bars: number[], beats: number[]) {
    this.notes = [...notes].sort((a, b) => a.start - b.start);
    this.maxDur = Math.max(0.5, ...this.notes.map((n) => n.end - n.start));
    this.chords = chords;
    this.bars = bars;
    this.beats = beats;
  }

  private lowerBound(t: number): number {
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].start < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  timeAtY(y: number, t: number): number {
    return t + (this.hitY - y) / this.opts.pxPerSec;
  }

  hit(x: number, y: number, t: number): RollHit {
    for (const r of this.chordRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        const rect = this.canvas.getBoundingClientRect();
        return { type: "chord", index: r.index, rect: new DOMRect(rect.left + r.x, rect.top + r.y, r.w, r.h) };
      }
    }
    if (!this.layout) return { type: "roll" };
    if (y >= this.hitY) {
      const pitch = this.layout.pitchAt(x, y < this.hitY + this.keyboardHeight * 0.62);
      return pitch == null ? { type: "roll" } : { type: "key", pitch };
    }
    const tt = this.timeAtY(y, t);
    for (let i = this.lowerBound(tt - this.maxDur); i < this.notes.length && this.notes[i].start <= tt; i++) {
      const n = this.notes[i];
      if (n.end < tt) continue;
      const k = this.layout.key(n.pitch);
      if (k && x >= k.x && x <= k.x + k.w) return { type: "note", note: n };
    }
    return { type: "roll" };
  }

  draw(t: number) {
    const { ctx, w, h } = this;
    const layout = this.layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const hitY = this.hitY;
    const pps = this.opts.pxPerSec;
    const view = hitY / pps;

    // background
    const bg = ctx.createLinearGradient(0, 0, 0, hitY);
    bg.addColorStop(0, "#0a0c11");
    bg.addColorStop(1, "#141824");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (!layout) return;

    // lanes: darker columns under black keys, a line at every C and between E and F
    for (const k of layout.keys) {
      if (k.black) {
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fillRect(k.x, 0, k.w, hitY);
      } else if (k.pitch % 12 === 0 || k.pitch % 12 === 5) {
        ctx.fillStyle = k.pitch % 12 === 0 ? "rgba(255,255,255,0.075)" : "rgba(255,255,255,0.035)";
        ctx.fillRect(Math.round(k.x), 0, 1, hitY);
      }
    }

    // beat and bar lines
    ctx.font = `500 10px ${this.font}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    for (const b of this.beats) {
      if (b < t - 0.1 || b > t + view) continue;
      const y = Math.round(hitY - (b - t) * pps) + 0.5;
      ctx.fillStyle = "rgba(255,255,255,0.028)";
      ctx.fillRect(0, y, w, 1);
    }
    this.bars.forEach((b, i) => {
      if (b < t - 0.1 || b > t + view) return;
      const y = Math.round(hitY - (b - t) * pps) + 0.5;
      ctx.fillStyle = "rgba(255,255,255,0.075)";
      ctx.fillRect(0, y, w, 1);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fillText(String(i + 1), w - 6, y - 2);
    });

    // notes
    const active = new Map<number, Hand>();
    const from = this.lowerBound(t - this.maxDur);
    const colors = { L: hexToRgb(this.opts.colors.L), R: hexToRgb(this.opts.colors.R) };
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = from; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.start > t + view) break;
      if (n.end < t) continue;
      if ((n.hand === "L" && !this.opts.showL) || (n.hand === "R" && !this.opts.showR)) continue;
      const k = layout.key(n.pitch);
      if (!k) continue;
      const playing = n.start <= t && n.end > t;
      if (playing) active.set(n.pitch, n.hand);
      const inset = k.black ? 1 : Math.max(1.5, k.w * 0.07);
      const x = k.x + inset;
      const nw = k.w - inset * 2;
      const yBottom = hitY - (n.start - t) * pps;
      const yTop = hitY - (n.end - t) * pps;
      const top = Math.max(-4, yTop);
      const bottom = Math.min(hitY, yBottom);
      const nh = bottom - top;
      if (nh <= 0.5) continue;
      let base = colors[n.hand];
      if (k.black) base = shade(base, -0.22);
      if (playing) base = shade(base, 0.28);
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, rgba(shade(base, 0.12), 1));
      grad.addColorStop(1, rgba(shade(base, -0.08), 1));
      ctx.fillStyle = grad;
      roundRect(ctx, x, top, nw, nh, Math.min(6, nw / 3));
      ctx.fill();
      ctx.strokeStyle = rgba(shade(base, 0.45), playing ? 0.9 : 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();

      // labels sit at the bottom of the note, where the eye meets the keyboard
      let labelBottom = bottom - 3;
      const badge = Math.min(nw - 2, 18);
      if (this.opts.fingers && n.finger && nh >= 12 && badge >= 9) {
        const by = labelBottom - badge;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        roundRect(ctx, x + (nw - badge) / 2, by, badge, badge, 4);
        ctx.fill();
        ctx.fillStyle = rgba(shade(base, -0.45), 1);
        ctx.font = `700 ${Math.round(badge * 0.66)}px ${this.font}`;
        ctx.fillText(String(n.finger), x + nw / 2, by + badge / 2 + 0.5);
        labelBottom = by - 2;
      }
      if (this.opts.names !== "none" && nh >= (this.opts.fingers ? 32 : 14) && nw >= 10) {
        const label =
          this.opts.names === "letters" ? noteName(n.pitch, this.opts.flats).replace(/-?\d+$/, "") : ukName(n.pitch, this.opts.flats).replace("-дієз", "♯").replace("-бемоль", "♭");
        ctx.font = `600 ${Math.max(8, Math.min(11, nw * 0.42))}px ${this.font}`;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillText(label, x + nw / 2, labelBottom - 6);
      }
    }

    // chord lane
    this.chordRects = [];
    if (this.opts.chords && this.chords.length) {
      ctx.font = `700 13px ${this.font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      // The chord that sounds now sticks above the keyboard; upcoming ones sit on their line.
      let current: RollChord | null = null;
      let ceiling = hitY - 30; // nothing may overlap the sticky pill
      for (const c of this.chords) {
        if (c.start <= t && c.end > t) current = c;
        if (c.start <= t || c.start > t + view) continue;
        const y = hitY - (c.start - t) * pps;
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(0, Math.round(y) + 0.5, w, 1);
        const top = y - 11;
        if (top + 22 > ceiling - 4) continue;
        this.chordPill(c, 8, top, false);
        ceiling = top;
      }
      if (current) this.chordPill(current, 8, hitY - 30, true);
    }

    // hit line
    const line = ctx.createLinearGradient(0, hitY - 10, 0, hitY);
    line.addColorStop(0, "rgba(120,170,255,0)");
    line.addColorStop(1, "rgba(160,200,255,0.28)");
    ctx.fillStyle = line;
    ctx.fillRect(0, hitY - 10, w, 10);

    if (this.opts.effects) {
      for (const [pitch, hand] of active) {
        const k = layout.key(pitch);
        if (!k) continue;
        const cx = k.x + k.w / 2;
        const r = Math.max(18, k.w * 1.8);
        const g = ctx.createRadialGradient(cx, hitY, 0, cx, hitY, r);
        g.addColorStop(0, rgba(shade(colors[hand], 0.3), 0.55));
        g.addColorStop(1, rgba(colors[hand], 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, hitY - r, r * 2, r);
      }
    }

    this.drawKeyboard(active, colors);
  }

  private chordPill(c: RollChord, x: number, y: number, current: boolean) {
    const { ctx } = this;
    const tw = ctx.measureText(c.name).width;
    const pw = tw + 18;
    const ph = 22;
    ctx.fillStyle = current ? "rgba(255,255,255,0.95)" : "rgba(22,26,36,0.88)";
    roundRect(ctx, x, y, pw, ph, 6);
    ctx.fill();
    if (!current) {
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = current ? "#10131a" : "rgba(255,255,255,0.92)";
    ctx.fillText(c.name, x + 9, y + ph / 2 + 0.5);
    this.chordRects.push({ index: c.index, x, y, w: pw, h: ph });
  }

  private drawKeyboard(active: Map<number, Hand>, colors: Record<Hand, [number, number, number]>) {
    const { ctx } = this;
    const layout = this.layout!;
    const y0 = this.hitY;
    const kh = this.keyboardHeight;
    const bh = kh * 0.62;

    ctx.fillStyle = "#07080b";
    ctx.fillRect(0, y0, this.w, kh);

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const k of layout.keys) {
      if (k.black) continue;
      const hand = active.get(k.pitch);
      const press = this.pressed.get(k.pitch);
      const g = ctx.createLinearGradient(0, y0, 0, y0 + kh);
      if (hand) {
        const c = colors[hand];
        g.addColorStop(0, rgba(shade(c, 0.1), 1));
        g.addColorStop(1, rgba(shade(c, 0.45), 1));
      } else {
        g.addColorStop(0, "#dcdcd8");
        g.addColorStop(0.12, "#f2f2ef");
        g.addColorStop(1, "#fbfbf9");
      }
      ctx.fillStyle = g;
      roundRect(ctx, k.x + 0.5, y0 - 2, k.w - 1, kh + 1, Math.min(4, k.w / 5));
      ctx.fill();
      if (press) this.pressMark(k.x + k.w / 2, y0 + kh - 12, press, colors);
      const label =
        this.opts.names !== "none"
          ? this.opts.names === "letters"
            ? noteName(k.pitch, this.opts.flats).replace(/-?\d+$/, "")
            : ukName(k.pitch, this.opts.flats)
          : k.pitch % 12 === 0
            ? noteName(k.pitch)
            : "";
      if (label && k.w >= 14) {
        ctx.font = `${k.pitch % 12 === 0 ? 600 : 500} ${Math.min(11, k.w * 0.42)}px ${this.font}`;
        ctx.fillStyle = hand ? "rgba(255,255,255,0.95)" : k.pitch === 60 ? "#3a6fe0" : "#8d8d88";
        ctx.fillText(label, k.x + k.w / 2, y0 + kh - (press ? 22 : 7));
      }
    }
    for (const k of layout.keys) {
      if (!k.black) continue;
      const hand = active.get(k.pitch);
      const press = this.pressed.get(k.pitch);
      const g = ctx.createLinearGradient(0, y0, 0, y0 + bh);
      if (hand) {
        const c = colors[hand];
        g.addColorStop(0, rgba(shade(c, -0.25), 1));
        g.addColorStop(1, rgba(shade(c, 0.05), 1));
      } else {
        g.addColorStop(0, "#1b1d22");
        g.addColorStop(0.85, "#2c2f36");
        g.addColorStop(1, "#3a3d45");
      }
      ctx.fillStyle = g;
      roundRect(ctx, k.x, y0 - 2, k.w, bh + 2, Math.min(3, k.w / 4));
      ctx.fill();
      if (press) this.pressMark(k.x + k.w / 2, y0 + bh - 10, press, colors);
    }
    // a thin felt strip on top
    ctx.fillStyle = "#5b1f1f";
    ctx.fillRect(0, y0 - 3, this.w, 2);
  }

  private pressMark(cx: number, cy: number, press: Hand | "wrong", colors: Record<Hand, [number, number, number]>) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = press === "wrong" ? "#ef4444" : rgba(shade(colors[press], -0.2), 1);
    ctx.fill();
  }
}

export function isBlackKey(p: number) {
  return isBlack(p);
}
