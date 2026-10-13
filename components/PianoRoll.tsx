"use client";

import { useEffect, useRef } from "react";
import type { Player } from "@/lib/audio/player";
import { type RollChord, type RollOptions, RollRenderer } from "@/lib/render/roll";
import type { Hand, PNote } from "@/lib/types";

interface Props {
  player: Player | null;
  notes: PNote[];
  chords: RollChord[];
  bars: number[];
  beats: number[];
  range: [number, number];
  opts: RollOptions;
  pressed: React.RefObject<Map<number, Hand | "wrong">>;
  onChordClick: (index: number, rect: DOMRect) => void;
  onKey: (pitch: number) => void;
  onFrame?: (t: number) => void;
}

export function PianoRoll({ player, notes, chords, bars, beats, range, opts, pressed, onChordClick, onKey, onFrame }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<RollRenderer | null>(null);
  const cb = useRef({ onChordClick, onKey, onFrame, player });
  cb.current = { onChordClick, onKey, onFrame, player };

  useEffect(() => {
    if (!canvas.current || !wrap.current) return;
    const r = new RollRenderer(canvas.current);
    renderer.current = r;
    const el = wrap.current;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      r.resize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), Math.min(2.5, window.devicePixelRatio || 1));
    });
    ro.observe(el);
    let raf = 0;
    const loop = () => {
      const p = cb.current.player;
      const t = p ? p.tick() : 0;
      r.pressed = pressed.current ?? r.pressed;
      r.draw(t);
      cb.current.onFrame?.(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.current = null;
    };
  }, [pressed]);

  useEffect(() => {
    renderer.current?.setData(notes, chords, bars, beats);
  }, [notes, chords, bars, beats]);

  useEffect(() => {
    renderer.current?.setRange(range[0], range[1]);
  }, [range]);

  useEffect(() => {
    if (renderer.current) renderer.current.opts = opts;
  }, [opts]);

  // Pointer: tap toggles play, drag scrubs through time, chord labels and keys are buttons.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let drag: { y: number; t0: number; moved: boolean; id: number } | null = null;
    const pos = (e: PointerEvent | WheelEvent) => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const down = (e: PointerEvent) => {
      const r = renderer.current;
      const p = cb.current.player;
      if (!r) return;
      const { x, y } = pos(e);
      const hit = r.hit(x, y, p ? p.time() : 0);
      if (hit.type === "chord") {
        cb.current.onChordClick(hit.index, hit.rect);
        return;
      }
      if (hit.type === "key") {
        cb.current.onKey(hit.pitch);
        return;
      }
      drag = { y, t0: p ? p.time() : 0, moved: false, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const r = renderer.current;
      const p = cb.current.player;
      if (!drag || !r || !p) return;
      const { y } = pos(e);
      const dy = y - drag.y;
      if (Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) p.seek(drag.t0 + dy / r.opts.pxPerSec);
    };
    const up = () => {
      const p = cb.current.player;
      if (drag && !drag.moved && p) p.toggle();
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      const r = renderer.current;
      const p = cb.current.player;
      if (!r || !p) return;
      e.preventDefault();
      p.seek(p.time() - (e.deltaY / r.opts.pxPerSec) * 0.6);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  return (
    <div ref={wrap} className="relative min-h-0 flex-1 overflow-hidden bg-roll">
      <canvas ref={canvas} className="absolute inset-0 block touch-none select-none" />
    </div>
  );
}
