"use client";

import { useEffect, useRef } from "react";
import type { MidiState } from "@/lib/midi";
import type { Settings } from "@/lib/settings";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-[13.5px] text-ink">{label}</div>
        {hint && <div className="text-[11.5px] leading-4 text-faint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-ink" : "bg-line-2"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  onClose,
  midi,
  onConnectMidi,
  onEasyKey,
}: {
  settings: Settings;
  onChange: (p: Partial<Settings>) => void;
  onClose: () => void;
  midi: MidiState;
  onConnectMidi: () => Promise<boolean>;
  onEasyKey: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest("[aria-label='Налаштування']")) onClose();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="pop-in absolute right-0 z-40 mt-1.5 max-h-[calc(100dvh-140px)] w-[320px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-2xl border border-line bg-card px-4 py-2 shadow-[var(--shadow-pop)]"
    >
      <div className="pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Показувати</div>
      <Row label="Аплікатура" hint="Номери пальців на нотах">
        <Switch on={settings.fingers} onChange={(v) => onChange({ fingers: v })} />
      </Row>
      <Row label="Акорди" hint="Назви акордів над нотами">
        <Switch on={settings.chords} onChange={(v) => onChange({ chords: v })} />
      </Row>
      <Row label="Назви нот">
        <select
          value={settings.names}
          onChange={(e) => onChange({ names: e.target.value as Settings["names"] })}
          className="h-8 rounded-lg border border-line-2 bg-card px-2 text-[13px] outline-none"
        >
          <option value="none">Не показувати</option>
          <option value="letters">C D E</option>
          <option value="solfege">до ре мі</option>
        </select>
      </Row>
      <Row label="Підсвітка" hint="Сяйво там, де нота торкається клавіші">
        <Switch on={settings.effects} onChange={(v) => onChange({ effects: v })} />
      </Row>
      <Row label="Уся клавіатура" hint="88 клавіш замість потрібних">
        <Switch on={settings.fullKeyboard} onChange={(v) => onChange({ fullKeyboard: v })} />
      </Row>
      <div className="py-2">
        <div className="mb-2 flex justify-between text-[13.5px]">
          <span>Швидкість падіння</span>
          <span className="text-faint tabular-nums">{settings.zoom}</span>
        </div>
        <input type="range" min={70} max={360} step={10} value={settings.zoom} onChange={(e) => onChange({ zoom: Number(e.target.value) })} className="slim w-full" />
      </div>

      <div className="mt-1 border-t border-line pt-3 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Звук</div>
      <div className="py-2">
        <div className="mb-2 text-[13.5px]">Оригінал</div>
        <input type="range" min={0} max={1} step={0.05} value={settings.originalVol} onChange={(e) => onChange({ originalVol: Number(e.target.value) })} className="slim w-full" />
      </div>
      <div className="py-2">
        <div className="mb-2 text-[13.5px]">Піаніно</div>
        <input type="range" min={0} max={1} step={0.05} value={settings.pianoVol} onChange={(e) => onChange({ pianoVol: Number(e.target.value) })} className="slim w-full" />
      </div>

      <div className="mt-1 border-t border-line pt-3 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Навчання</div>
      <Row label="Цикл прискорюється" hint="Кожне коло циклу на 5% швидше, поки не 100%">
        <Switch on={settings.loopRamp} onChange={(v) => onChange({ loopRamp: v })} />
      </Row>
      <Row label="Зручна тональність" hint="Транспонувати так, щоб було менше чорних клавіш">
        <button onClick={onEasyKey} className="h-8 shrink-0 rounded-lg bg-hover px-3 text-[13px] font-medium hover:bg-line">
          Підібрати
        </button>
      </Row>
      <Row
        label="MIDI-піаніно"
        hint={midi.connected ? midi.devices.join(", ") : midi.error ?? "Підключи цифрове піаніно по USB (Chrome)"}
      >
        {midi.connected ? (
          <span className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <span className="h-2 w-2 rounded-full bg-lh" />
            є
          </span>
        ) : (
          <button onClick={() => void onConnectMidi()} className="h-8 shrink-0 rounded-lg bg-hover px-3 text-[13px] font-medium hover:bg-line">
            Підключити
          </button>
        )}
      </Row>
      <p className="pt-1 pb-2 text-[11.5px] leading-4 text-faint">
        Клавіші: пробіл — пауза, ←/→ — 3 секунди, ↑/↓ — швидкість, L — цикл. Клік по полю нот — пауза, протягування — перемотка.
      </p>
    </div>
  );
}
