"use client";

import { useEffect, useRef, useState } from "react";
import type { Settings } from "@/lib/settings";
import { IconBack, IconDots, IconHourglass, IconLoop, IconMetronome, IconMinus, IconPause, IconPlay, IconPlus, IconTranspose, IconX } from "./Icons";

export interface TransportRefs {
  head: HTMLDivElement | null;
  fill: HTMLDivElement | null;
  time: HTMLSpanElement | null;
}

export const fmtTime = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

interface Props {
  refs: React.RefObject<TransportRefs>;
  duration: number;
  playing: boolean;
  frozen: boolean;
  bars: number[];
  chordStrip: { s: number; e: number; name: string }[];
  rate: number;
  onRate: (r: number) => void;
  transpose: number;
  onTranspose: (t: number) => void;
  outputs: Settings["outputs"];
  onOutputs: (o: Settings["outputs"]) => void;
  originalLocked: boolean;
  loop: { a: number; b: number } | null;
  onLoop: (l: { a: number; b: number } | null) => void;
  onLoopToggle: () => void;
  metronome: boolean;
  onMetronome: () => void;
  waitOn: boolean;
  onWait: () => void;
  myHand: Settings["myHand"];
  onMyHand: (h: Settings["myHand"]) => void;
  onToggle: () => void;
  onRestart: () => void;
  onSeek: (t: number) => void;
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex h-9 items-center rounded-xl bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
          className={`h-8 rounded-[10px] px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors disabled:opacity-35 ${
            value === o.id ? "bg-card text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]" : "text-mute hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ label, value, onMinus, onPlus, onReset, title, icon }: { label: string; value: string; onMinus: () => void; onPlus: () => void; onReset: () => void; title: string; icon?: React.ReactNode }) {
  return (
    <div className="flex h-9 items-center rounded-xl bg-hover" title={title}>
      <button onClick={onMinus} className="grid h-9 w-8 place-items-center rounded-l-xl text-ink-2 hover:bg-line" aria-label={`${label} менше`}>
        <IconMinus size={15} />
      </button>
      <button onClick={onReset} className="flex h-9 min-w-[52px] items-center justify-center gap-1 text-[12.5px] font-semibold tabular-nums">
        {icon}
        {value}
      </button>
      <button onClick={onPlus} className="grid h-9 w-8 place-items-center rounded-r-xl text-ink-2 hover:bg-line" aria-label={`${label} більше`}>
        <IconPlus size={15} />
      </button>
    </div>
  );
}

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[12.5px] font-medium ${on ? "bg-ink text-white" : "bg-hover text-ink-2 hover:bg-line"}`}
    >
      {children}
    </button>
  );
}

export function Transport(p: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [compact, setCompact] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1180px), (max-height: 520px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!more) return;
    const close = (e: PointerEvent) => !moreRef.current?.contains(e.target as Node) && setMore(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [more]);

  // timeline: click seeks, drag selects a loop (snapped to bar lines)
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let start: { x: number; t: number } | null = null;
    const tAt = (clientX: number) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * p.duration;
    };
    const snap = (t: number) => {
      if (!p.bars.length) return t;
      let best = p.bars[0];
      for (const b of p.bars) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
      return best;
    };
    const down = (e: PointerEvent) => {
      start = { x: e.clientX, t: tAt(e.clientX) };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!start || Math.abs(e.clientX - start.x) < 6) return;
      const t = tAt(e.clientX);
      setSel({ a: Math.min(start.t, t), b: Math.max(start.t, t) });
    };
    const up = (e: PointerEvent) => {
      if (!start) return;
      if (Math.abs(e.clientX - start.x) < 6) p.onSeek(start.t);
      else {
        const t = tAt(e.clientX);
        let a = snap(Math.min(start.t, t));
        let b = snap(Math.max(start.t, t));
        if (b - a < 0.5) b = a + Math.max(1, (p.bars[1] ?? 2) - (p.bars[0] ?? 0));
        if (a < 0) a = 0;
        p.onLoop({ a, b: Math.min(b, p.duration) });
        p.onSeek(a);
      }
      setSel(null);
      start = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
  }, [p]);

  const pct = (t: number) => `${(t / Math.max(1, p.duration)) * 100}%`;
  const region = sel ?? p.loop;
  const ratePct = Math.round(p.rate * 100);

  return (
    <div className="shrink-0 border-t border-line bg-card px-3 pt-2 pb-[max(10px,env(safe-area-inset-bottom))]">
      <div ref={bar} className="relative h-6 cursor-pointer touch-none" title="Клік — перейти, протягни — зациклити шматок">
        <div className="absolute inset-x-0 top-[9px] h-[6px] overflow-hidden rounded-full bg-hover">
          {p.chordStrip.map((c, i) => (
            <div key={i} className="absolute top-0 h-full border-r border-card/70 bg-line/70" style={{ left: pct(c.s), width: pct(c.e - c.s) }} />
          ))}
          <div ref={(el) => void (p.refs.current.fill = el)} className="absolute inset-y-0 left-0 bg-ink/80" style={{ width: 0 }} />
        </div>
        {region && (
          <div className="absolute top-[4px] h-4 rounded-md border border-accent/60 bg-accent/15" style={{ left: pct(region.a), width: pct(region.b - region.a) }} />
        )}
        <div
          ref={(el) => void (p.refs.current.head = el)}
          className="absolute top-[5px] h-[14px] w-[3px] -translate-x-1/2 rounded-full bg-ink shadow-[0_0_0_2px_white]"
          style={{ left: 0 }}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <button onClick={p.onRestart} className="grid h-9 w-9 place-items-center rounded-xl text-ink-2 hover:bg-hover" aria-label="На початок">
            <IconBack size={17} />
          </button>
          <button
            onClick={p.onToggle}
            className="grid h-10 w-10 place-items-center rounded-full bg-ink text-white shadow-sm"
            aria-label={p.playing ? "Пауза" : "Грати"}
          >
            {p.playing ? <IconPause size={17} /> : <IconPlay size={17} className="translate-x-[1px]" />}
          </button>
          <span className="ml-1 text-[12.5px] text-mute tabular-nums">
            <span ref={(el) => void (p.refs.current.time = el)}>0:00</span> / {fmtTime(p.duration)}
          </span>
          {p.frozen && <span className="ml-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11.5px] font-medium text-accent">чекаю на тебе</span>}
          {p.loop && (
            <button
              onClick={() => p.onLoop(null)}
              title="Прибрати цикл (Esc)"
              className="ml-1 flex h-7 items-center gap-1 rounded-lg bg-accent-soft pr-1.5 pl-2 text-[12px] font-medium text-accent hover:bg-accent/15"
            >
              <IconLoop size={13} />
              {fmtTime(p.loop.a)}–{fmtTime(p.loop.b)}
              <IconX size={13} className="ml-0.5" />
            </button>
          )}
        </div>

        {(() => {
          const outputs = (
            <Seg
              value={p.originalLocked ? "piano" : p.outputs}
              onChange={p.onOutputs}
              options={[
                { id: "original", label: "Оригінал", disabled: p.originalLocked },
                { id: "piano", label: "Піаніно" },
                { id: "both", label: "Разом", disabled: p.originalLocked },
              ]}
            />
          );
          const speed = (
            <Stepper
              label="Швидкість"
              title="Швидкість (клік — 100%)"
              value={`${ratePct}%`}
              onMinus={() => p.onRate(Math.max(0.25, Math.round((p.rate - 0.05) * 100) / 100))}
              onPlus={() => p.onRate(Math.min(1.5, Math.round((p.rate + 0.05) * 100) / 100))}
              onReset={() => p.onRate(1)}
            />
          );
          const transpose = (
            <Stepper
              label="Тональність"
              title="Транспонування в півтонах (клік — 0)"
              icon={<IconTranspose size={13} className="text-mute" />}
              value={p.transpose > 0 ? `+${p.transpose}` : String(p.transpose)}
              onMinus={() => p.onTranspose(Math.max(-12, p.transpose - 1))}
              onPlus={() => p.onTranspose(Math.min(12, p.transpose + 1))}
              onReset={() => p.onTranspose(0)}
            />
          );
          const hands = (
            <Seg
              value={p.myHand}
              onChange={p.onMyHand}
              options={[
                { id: "L", label: "Ліва" },
                { id: "both", label: "Обидві" },
                { id: "R", label: "Права" },
              ]}
            />
          );
          const toggles = (
            <>
              <Toggle on={!!p.loop} onClick={p.onLoopToggle} title="Зациклити 4 такти (або протягни по шкалі)">
                <IconLoop size={16} />
                <span className={compact ? "" : "max-lg:hidden"}>Цикл</span>
              </Toggle>
              <Toggle on={p.metronome} onClick={p.onMetronome} title="Метроном">
                <IconMetronome size={16} />
                {compact && <span>Метроном</span>}
              </Toggle>
              <Toggle on={p.waitOn} onClick={p.onWait} title="Чекати, поки зіграєш правильні ноти (потрібне MIDI-піаніно)">
                <IconHourglass size={16} />
                <span className={compact ? "" : "max-lg:hidden"}>Чекати мене</span>
              </Toggle>
            </>
          );
          if (!compact) {
            return (
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                {outputs}
                {speed}
                {transpose}
                {hands}
                {toggles}
              </div>
            );
          }
          return (
            <div className="ml-auto flex items-center gap-1.5">
              {speed}
              <div ref={moreRef} className="relative">
                <button
                  onClick={() => setMore((m) => !m)}
                  aria-label="Ще"
                  className={`grid h-9 w-9 place-items-center rounded-xl ${more ? "bg-ink text-white" : "bg-hover text-ink-2"}`}
                >
                  <IconDots size={18} />
                </button>
                {more && (
                  <div className="pop-in absolute right-0 bottom-full z-40 mb-2 flex w-[300px] max-w-[calc(100vw-24px)] flex-col gap-2 rounded-2xl border border-line bg-card p-3 shadow-[var(--shadow-pop)]">
                    <div className="text-[11px] font-medium tracking-wide text-faint uppercase">Звук</div>
                    {outputs}
                    <div className="text-[11px] font-medium tracking-wide text-faint uppercase">Я граю</div>
                    {hands}
                    <div className="text-[11px] font-medium tracking-wide text-faint uppercase">Тональність</div>
                    <div className="flex">{transpose}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">{toggles}</div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
