"use client";

import { useEffect, useRef, useState } from "react";
import { LEVELS, type LevelId } from "@/lib/music/arrange";
import { IconCheck, IconChevron, IconSparkle, IconWand } from "./Icons";

function LevelIcon({ id, stars }: { id: LevelId; stars: number }) {
  if (id === "adaptive") return <IconWand size={16} />;
  if (id === "pretty") return <IconSparkle size={16} />;
  return (
    <span className="flex w-4 flex-wrap justify-center gap-[1.5px]">
      {Array.from({ length: stars }, (_, i) => (
        <span key={i} className="h-[4px] w-[4px] rounded-full bg-current" />
      ))}
    </span>
  );
}

export function LevelPicker({ value, onChange }: { value: LevelId; onChange: (l: LevelId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cur = LEVELS.find((l) => l.id === value) ?? LEVELS[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-xl border border-line-2 bg-card pr-2 pl-2.5 text-[13.5px] hover:bg-hover"
      >
        <span className="text-faint max-sm:hidden">Рівень</span>
        <span className="text-ink-2">
          <LevelIcon id={cur.id} stars={cur.stars} />
        </span>
        <span className="max-w-[112px] truncate font-medium sm:max-w-none">{cur.title}</span>
        <IconChevron size={16} className="text-mute" />
      </button>
      {open && (
        <div className="pop-in absolute right-0 z-40 mt-1.5 w-[300px] max-w-[calc(100vw-24px)] rounded-2xl border border-line bg-card p-1.5 shadow-[var(--shadow-pop)]">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Складність аранжування</div>
          {LEVELS.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                onChange(l.id);
                setOpen(false);
              }}
              className={`flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-hover ${l.id === "pretty" ? "mt-1 border-t border-line pt-2.5" : ""}`}
            >
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-ink-2">
                <LevelIcon id={l.id} stars={l.stars} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink">{l.title}</span>
                <span className="block text-[12.5px] leading-[1.35] text-mute">{l.hint}</span>
              </span>
              {l.id === value && <IconCheck size={16} className="mt-0.5 shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
