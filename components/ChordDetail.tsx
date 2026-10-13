"use client";

import { useState } from "react";
import { type Chord, chordName, chordPcs, chordUkTitle, pcName, teachingVoicing, ukName } from "@/lib/music/theory";
import { IconPlay } from "./Icons";
import { type KeyMark, MiniKeyboard } from "./MiniKeyboard";

const RH = "#4b8bff";
const LH = "#25c48d";
const INVERSIONS = ["Основний", "1-ше обернення", "2-ге обернення", "3-тє обернення"];

/** How to press a chord: the right-hand shape with fingers, the left-hand bass, and a listen button. */
export function ChordDetail({
  chord,
  flats,
  onPlay,
  compact = false,
}: {
  chord: Chord;
  flats: boolean;
  onPlay: (pitches: number[], spread?: number) => void;
  compact?: boolean;
}) {
  const [inv, setInv] = useState(0);
  const pcs = chordPcs(chord);
  const v = teachingVoicing(chord, inv);
  const marks = new Map<number, KeyMark>();
  v.lh.forEach((p, i) => marks.set(p, { color: LH, label: String(v.lhFingers[i]) }));
  v.rh.forEach((p, i) => marks.set(p, { color: RH, label: String(v.rhFingers[i]) }));
  const all = [...v.lh, ...v.rh];

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[26px] leading-none font-semibold tracking-tight">{chordName(chord, flats)}</div>
          <div className="mt-1.5 text-[13.5px] text-mute">{chordUkTitle(chord, flats)}</div>
        </div>
        <button
          onClick={() => onPlay(all, 0)}
          onDoubleClick={() => onPlay(all, 0.09)}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 text-[13px] font-medium text-white"
          title="Послухати (подвійний клік — арпеджіо)"
        >
          <IconPlay size={14} />
          Послухати
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[13px]">
        {pcs.map((p) => (
          <span key={p} className="rounded-md bg-hover px-2 py-1">
            <b className="font-semibold">{pcName(p, flats)}</b>
            <span className="text-mute"> · {ukName(p, flats)}</span>
          </span>
        ))}
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-line">
        <MiniKeyboard marks={marks} height={compact ? 80 : 96} onKey={(p) => onPlay([p])} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-[12px] text-mute">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: LH }} />
          ліва рука
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: RH }} />
          права рука
        </span>
        <span className="ml-auto">цифри — пальці</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {pcs.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              setInv(i);
              const nv = teachingVoicing(chord, i);
              onPlay([...nv.lh, ...nv.rh]);
            }}
            className={`h-8 rounded-lg px-2.5 text-[12.5px] ${inv === i ? "bg-ink text-white" : "bg-hover text-ink-2 hover:bg-line"}`}
          >
            {INVERSIONS[i]}
          </button>
        ))}
      </div>
      {!compact && (
        <p className="mt-3 text-[12.5px] leading-5 text-mute">
          {inv === 0
            ? "Основний вигляд: знизу корінь акорду. Обернення — ті самі ноти в іншому порядку, щоб рука менше стрибала між акордами."
            : "Обернення звучить як той самий акорд, але ближче до сусідніх — так зручніше переходити."}
        </p>
      )}
    </div>
  );
}
