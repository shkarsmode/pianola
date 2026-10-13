"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player } from "@/lib/audio/player";
import { arrange, easiestTranspose, LEVELS, type LevelId } from "@/lib/music/arrange";
import { type Chord, chordName, flatsForKey, transposeChord } from "@/lib/music/theory";
import { useMidi } from "@/lib/midi";
import { fitRange } from "@/lib/render/keyboard";
import { DEFAULT_COLORS, type RollChord, type RollOptions } from "@/lib/render/roll";
import { useSettings, useSongPrefs } from "@/lib/settings";
import type { Analysis, Hand, PNote, SongMeta } from "@/lib/types";
import { ChordDetail } from "./ChordDetail";
import { IconGear, IconKeys, IconRetry, IconX } from "./Icons";
import { LevelPicker } from "./LevelPicker";
import { PianoRoll } from "./PianoRoll";
import { SettingsPanel } from "./SettingsPanel";
import { SidebarButton } from "./Shell";
import { STAGE_LABEL, useLibrary } from "./SongsProvider";
import { fmtTime, Transport, type TransportRefs } from "./Transport";

type Loaded = { song: SongMeta & { audioUrl?: string; analysisUrl?: string }; analysis: Analysis | null };

function useSongData(id: string) {
  const { songs } = useLibrary();
  const listed = songs.find((s) => s.id === id);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");

  const status = listed?.status;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/songs/${id}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Пісню не знайдено");
        const song = body.song as Loaded["song"];
        let analysis: Analysis | null = null;
        if (song.status === "ready" && song.analysisUrl) {
          const a = await fetch(song.analysisUrl);
          if (!a.ok) throw new Error("Не вдалося завантажити розбір пісні");
          analysis = (await a.json()) as Analysis;
        }
        if (!cancelled) setData({ song, analysis });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, status]);

  return { data, error, listed };
}

export function SongView({ id }: { id: string }) {
  const { data, error, listed } = useSongData(id);
  const { worker, retry } = useLibrary();
  const song = data?.song;
  const analysis = data?.analysis ?? null;

  if (error) return <Centered title="Не вдалося відкрити пісню" text={error} />;
  if (!song || (song.status === "ready" && !analysis)) return <Centered title="" text="Відкриваю…" />;
  if (song.status !== "ready" || !analysis) {
    const cur = worker.current?.id === id ? worker.current : null;
    const status = listed?.status ?? song.status;
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 px-3">
          <SidebarButton />
          <h1 className="truncate text-[15px] font-semibold">{listed?.title ?? song.title}</h1>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-20">
          <div className="pop-in w-full max-w-[380px] text-center">
            {status === "error" ? (
              <>
                <p className="text-[17px] font-semibold">Не вдалося розібрати пісню</p>
                <p className="mt-2 text-[14px] leading-5 text-mute">{listed?.error ?? song.error ?? "Невідома помилка"}</p>
                <button onClick={() => retry(id)} className="mx-auto mt-5 flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-[14px] font-medium text-white">
                  <IconRetry size={16} />
                  Спробувати ще раз
                </button>
              </>
            ) : (
              <>
                <p className="text-[17px] font-semibold">{cur ? (STAGE_LABEL[cur.stage] ?? "Обробка") : worker.online ? "У черзі" : "Чекає на ПК"}</p>
                <div className="mx-auto mt-4 h-1.5 w-full overflow-hidden rounded-full bg-hover">
                  <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${Math.round((cur?.progress ?? 0.02) * 100)}%` }} />
                </div>
                <p className="mt-3 text-[13.5px] leading-5 text-mute">
                  {worker.online
                    ? "Розбираю мелодію, акорди й такти — зазвичай це хвилина-дві. Можна закрити сторінку."
                    : "Обробник на ПК зараз не на зв’язку. Пісня в черзі й обробиться, щойно ПК увімкнеться."}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
  return <Player2 key={id} song={song} analysis={analysis} />;
}

function Centered({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-3">
        <SidebarButton />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-20 text-center">
        <div>
          {title && <p className="text-[17px] font-semibold">{title}</p>}
          <p className="mt-1 text-[14px] text-mute">{text}</p>
        </div>
      </div>
    </div>
  );
}

function Player2({ song, analysis }: { song: SongMeta & { audioUrl?: string }; analysis: Analysis }) {
  const [settings, setSettings] = useSettings();
  const [prefs, setPrefs, prefsReady] = useSongPrefs(song.id);
  const level = (LEVELS.some((l) => l.id === prefs.level) ? prefs.level : "adaptive") as LevelId;
  const transpose = prefs.transpose;

  const [player, setPlayer] = useState<Player | null>(null);
  const [playing, setPlaying] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [loop, setLoopState] = useState<{ a: number; b: number } | null>(null);
  const [wait, setWait] = useState(false);
  const [chordOpen, setChordOpen] = useState<{ chord: Chord; rect: DOMRect | null } | null>(null);
  const [panel, setPanel] = useState<"settings" | "chords" | null>(null);
  const [toast, setToast] = useState("");
  const pressed = useRef(new Map<number, Hand | "wrong">());
  const tRefs = useRef<TransportRefs>({ head: null, fill: null, time: null });

  // ---- music
  const arrangement = useMemo(() => arrange(analysis, level), [analysis, level]);
  const notes = useMemo<PNote[]>(
    () => (transpose ? arrangement.notes.map((n) => ({ ...n, pitch: n.pitch + transpose })) : arrangement.notes),
    [arrangement, transpose],
  );
  const flats = flatsForKey(analysis.key.tonic, analysis.key.mode, transpose);
  const chordList = useMemo(
    () =>
      analysis.chords
        .filter((c) => c.root != null && c.q !== "N")
        .map((c) => transposeChord({ root: c.root!, q: c.q, bass: c.bass ?? c.root! }, transpose)),
    [analysis, transpose],
  );
  const rollChords = useMemo<RollChord[]>(() => {
    const segs = analysis.chords.filter((c) => c.root != null && c.q !== "N");
    return segs.map((c, i) => ({ start: c.s, end: c.e, name: chordName(chordList[i], flats), index: i }));
  }, [analysis, chordList, flats]);
  const bars = useMemo(() => analysis.beats.filter((_, i) => analysis.barPos[i] === 0 && analysis.beats[i] >= 0), [analysis]);
  const beats = useMemo(() => analysis.beats.filter((b) => b >= 0), [analysis]);
  const range = useMemo<[number, number]>(() => {
    if (settings.fullKeyboard || !notes.length) return [21, 108];
    let lo = 127;
    let hi = 0;
    for (const n of notes) {
      lo = Math.min(lo, n.pitch);
      hi = Math.max(hi, n.pitch);
    }
    return fitRange(lo - 2, hi + 2, 22);
  }, [notes, settings.fullKeyboard]);

  const myHands = settings.myHand === "both" ? ["L", "R"] : [settings.myHand];
  const rollOpts = useMemo<RollOptions>(
    () => ({
      fingers: settings.fingers,
      names: settings.names,
      chords: settings.chords,
      showL: true,
      showR: true,
      pxPerSec: settings.zoom,
      flats,
      effects: settings.effects,
      colors: DEFAULT_COLORS,
    }),
    [settings.fingers, settings.names, settings.chords, settings.zoom, settings.effects, flats],
  );

  // ---- player lifecycle
  useEffect(() => {
    const p = new Player();
    setPlayer(p);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __player: Player }).__player = p;
    const off = p.subscribe((s) => {
      setPlaying(s.playing);
      setFrozen(s.frozen);
    });
    return () => {
      off();
      p.dispose();
    };
  }, []);

  useEffect(() => {
    player?.setSource(song.audioUrl ?? null, analysis.duration);
  }, [player, song.audioUrl, analysis.duration]);

  useEffect(() => {
    player?.setNotes(notes, arrangement.pedal);
  }, [player, notes, arrangement.pedal]);

  useEffect(() => {
    player?.setBeats(beats, bars);
  }, [player, beats, bars]);

  useEffect(() => {
    if (prefsReady) player?.setRate(prefs.rate);
  }, [player, prefs.rate, prefsReady]);

  const originalLocked = transpose !== 0 || !song.audioUrl || wait;
  const outputs = originalLocked ? "piano" : settings.outputs;
  useEffect(() => {
    player?.setOutputs(outputs !== "piano", outputs !== "original");
  }, [player, outputs]);

  useEffect(() => {
    player?.setVolumes(settings.originalVol, settings.pianoVol);
  }, [player, settings.originalVol, settings.pianoVol]);

  useEffect(() => {
    if (!player) return;
    // when you practise one hand, the piano plays the other one for you
    player.handAudible = settings.myHand === "both" ? { L: true, R: true } : { L: settings.myHand !== "L", R: settings.myHand !== "R" };
  }, [player, settings.myHand]);

  useEffect(() => {
    if (player) player.metronome = settings.metronome;
  }, [player, settings.metronome]);

  useEffect(() => {
    if (player) player.loop = loop;
  }, [player, loop]);

  // practising a loop slowly: each pass a little faster, until full speed
  const rateRef = useRef(prefs.rate);
  rateRef.current = prefs.rate;
  useEffect(() => {
    if (!player) return;
    player.onLoopWrap = settings.loopRamp
      ? () => {
          if (rateRef.current < 1) setPrefs({ rate: Math.min(1, Math.round((rateRef.current + 0.05) * 100) / 100) });
        }
      : null;
  }, [player, settings.loopRamp, setPrefs]);

  // keep the screen awake while playing (a tablet on the piano stand)
  useEffect(() => {
    if (!playing || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    navigator.wakeLock
      .request("screen")
      .then((l) => {
        if (released) void l.release();
        else lock = l;
      })
      .catch(() => undefined);
    return () => {
      released = true;
      void lock?.release();
    };
  }, [playing]);

  // ---- MIDI and "wait for me"
  const groups = useMemo(() => {
    const mine = notes.filter((n) => myHands.includes(n.hand)).sort((a, b) => a.start - b.start);
    const out: { time: number; pitches: number[] }[] = [];
    for (const n of mine) {
      const g = out[out.length - 1];
      if (g && n.start - g.time < 0.045) {
        if (!g.pitches.includes(n.pitch)) g.pitches.push(n.pitch);
      } else out.push({ time: n.start, pitches: [n.pitch] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, settings.myHand]);
  const waitState = useRef({ gi: 0, hit: new Set<number>(), held: new Set<number>() });

  const activeAt = useCallback(
    (pitch: number, t: number): Hand | null => {
      for (const n of notes) {
        if (n.start > t + 0.25) break;
        if (n.pitch === pitch && n.start - 0.25 <= t && n.end + 0.05 >= t) return n.hand;
      }
      return null;
    },
    [notes],
  );

  const onMidi = useCallback(
    (pitch: number, on: boolean) => {
      const ws = waitState.current;
      if (on) {
        ws.held.add(pitch);
        ws.hit.add(pitch);
        const t = player?.time() ?? 0;
        const hand = activeAt(pitch, t);
        pressed.current.set(pitch, hand ?? (wait || playing ? "wrong" : "R"));
        if (!playing && !wait) player?.preview([pitch], 90, 0.8);
      } else {
        ws.held.delete(pitch);
        pressed.current.delete(pitch);
      }
    },
    [player, activeAt, wait, playing],
  );
  const { midi, connectMidi } = useMidi(onMidi);

  useEffect(() => {
    if (!player) return;
    if (!wait) {
      player.setWait(null);
      return;
    }
    const ws = waitState.current;
    const reset = (t: number) => {
      let gi = 0;
      while (gi < groups.length && groups[gi].time < t - 0.05) gi++;
      ws.gi = gi;
      ws.hit = new Set(ws.held);
    };
    reset(player.time());
    let lastT = player.time();
    player.setWait((t) => {
      if (Math.abs(t - lastT) > 1) reset(t); // seek
      lastT = t;
      while (ws.gi < groups.length) {
        const g = groups[ws.gi];
        if (t + 0.02 < g.time) return null;
        if (g.pitches.every((p) => ws.hit.has(p) || ws.held.has(p))) {
          ws.gi++;
          ws.hit = new Set();
          continue;
        }
        return g.time;
      }
      return null;
    });
  }, [player, wait, groups]);

  // ---- actions
  const setLoop = useCallback((l: { a: number; b: number } | null) => setLoopState(l), []);
  const toggleLoop = useCallback(() => {
    if (loop) return setLoopState(null);
    const t = player?.time() ?? 0;
    let a = bars[0] ?? 0;
    for (const b of bars) if (b <= t + 0.05) a = b;
    const i = bars.indexOf(a);
    const b = bars[i + 4] ?? analysis.duration;
    setLoopState({ a, b });
  }, [loop, player, bars, analysis.duration]);

  const showToast = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 2600);
  };

  const toggleWait = async () => {
    if (wait) return setWait(false);
    const ok = midi.connected || (await connectMidi());
    if (!ok) {
      showToast(midi.error ?? "Підключи цифрове піаніно по USB — тоді я чекатиму на правильні ноти");
      return;
    }
    setWait(true);
    player?.pause();
  };

  const onFrame = useCallback((t: number) => {
    const r = tRefs.current;
    const pct = `${(t / Math.max(1, analysis.duration)) * 100}%`;
    if (r.head) r.head.style.left = pct;
    if (r.fill) r.fill.style.width = pct;
    if (r.time) {
      const s = fmtTime(t);
      if (r.time.textContent !== s) r.time.textContent = s;
    }
  }, [analysis.duration]);

  // keyboard shortcuts (nothing animates on keys)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!player) return;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowLeft") player.seek(player.time() - 3);
      else if (e.key === "ArrowRight") player.seek(player.time() + 3);
      else if (e.key === "ArrowUp") {
        e.preventDefault();
        setPrefs({ rate: Math.min(1.5, Math.round((prefs.rate + 0.05) * 100) / 100) });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setPrefs({ rate: Math.max(0.25, Math.round((prefs.rate - 0.05) * 100) / 100) });
      } else if (e.key === "Home") player.seek(loop?.a ?? 0);
      else if (e.key.toLowerCase() === "l") toggleLoop();
      else if (e.key === "Escape") {
        setChordOpen(null);
        setPanel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, prefs.rate, setPrefs, loop, toggleLoop]);

  const levelInfo = LEVELS.find((l) => l.id === level)!;
  const keyName = chordName({ root: (analysis.key.tonic + transpose + 1200) % 12, q: analysis.key.mode === "minor" ? "min" : "maj", bass: (analysis.key.tonic + transpose + 1200) % 12 }, flats);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-card px-3">
        <SidebarButton />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] leading-5 font-semibold" title={song.title}>
            {song.title}
          </h1>
          <div className="truncate text-[12px] leading-4 text-mute">
            {keyName} · {Math.round(analysis.tempo)} BPM · {analysis.timeSig}/4
            {analysis.subdiv === 3 ? " · тріолі" : ""}
          </div>
        </div>
        <LevelPicker value={level} onChange={(l) => setPrefs({ level: l })} />
        <button
          onClick={() => setPanel(panel === "chords" ? null : "chords")}
          className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium ${panel === "chords" ? "bg-ink text-white" : "bg-hover text-ink-2 hover:bg-line"}`}
        >
          <IconKeys size={16} />
          <span className="max-sm:hidden">Акорди</span>
        </button>
        <div className="relative">
          <button
            onClick={() => setPanel(panel === "settings" ? null : "settings")}
            aria-label="Налаштування"
            className={`grid h-9 w-9 place-items-center rounded-xl ${panel === "settings" ? "bg-ink text-white" : "bg-hover text-ink-2 hover:bg-line"}`}
          >
            <IconGear size={17} />
          </button>
          {panel === "settings" && (
            <SettingsPanel
              settings={settings}
              onChange={setSettings}
              onClose={() => setPanel(null)}
              midi={midi}
              onConnectMidi={connectMidi}
              onEasyKey={() => {
                const t = easiestTranspose(arrangement.notes);
                setPrefs({ transpose: t });
                showToast(t === 0 ? "Ця тональність уже найзручніша" : `Транспоновано на ${t > 0 ? "+" : ""}${t}: менше чорних клавіш`);
              }}
            />
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <PianoRoll
          player={player}
          notes={notes}
          chords={settings.chords ? rollChords : []}
          bars={bars}
          beats={beats}
          range={range}
          opts={rollOpts}
          pressed={pressed}
          onChordClick={(i, rect) => setChordOpen({ chord: chordList[i], rect })}
          onKey={(p) => player?.preview([p], 90, 1)}
          onFrame={onFrame}
        />

        <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-1.5 rounded-lg bg-black/45 px-2 py-1 text-[11.5px] font-medium text-white/85 backdrop-blur-sm max-sm:hidden">
          <span className="h-2 w-2 rounded-sm bg-lh" /> ліва
          <span className="ml-1.5 h-2 w-2 rounded-sm bg-rh" /> права
          <span className="ml-2 text-white/60">{levelInfo.title}</span>
        </div>

        {chordOpen && (
          <ChordPopover rect={chordOpen.rect} onClose={() => setChordOpen(null)}>
            <ChordDetail chord={chordOpen.chord} flats={flats} onPlay={(ps, spread) => player?.preview(ps, 88, 1.6, spread ?? 0)} />
          </ChordPopover>
        )}

        {panel === "chords" && (
          <ChordsPanel
            chords={chordList}
            flats={flats}
            onClose={() => setPanel(null)}
            onPlay={(ps, spread) => player?.preview(ps, 88, 1.6, spread ?? 0)}
          />
        )}

        <PortraitHint />

        {toast && (
          <div className="pop-in absolute bottom-4 left-1/2 z-30 max-w-[90%] -translate-x-1/2 rounded-xl bg-ink px-3.5 py-2 text-[13px] text-white shadow-lg">{toast}</div>
        )}
      </div>

      <Transport
        refs={tRefs}
        duration={analysis.duration}
        playing={playing}
        frozen={frozen}
        bars={bars}
        chordStrip={rollChords.map((c) => ({ s: c.start, e: c.end, name: c.name }))}
        rate={prefs.rate}
        onRate={(r) => setPrefs({ rate: r })}
        transpose={transpose}
        onTranspose={(t) => setPrefs({ transpose: t })}
        outputs={outputs}
        onOutputs={(o) => setSettings({ outputs: o })}
        originalLocked={originalLocked}
        loop={loop}
        onLoop={setLoop}
        onLoopToggle={toggleLoop}
        metronome={settings.metronome}
        onMetronome={() => setSettings({ metronome: !settings.metronome })}
        waitOn={wait}
        onWait={toggleWait}
        myHand={settings.myHand}
        onMyHand={(h) => setSettings({ myHand: h })}
        onToggle={() => player?.toggle()}
        onRestart={() => player?.seek(loop?.a ?? 0)}
        onSeek={(t) => player?.seek(t)}
      />
    </div>
  );
}

/** On a phone held upright the keyboard is tiny; suggest turning it (once per session). */
function PortraitHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const check = () => {
      let dismissed = false;
      try {
        dismissed = sessionStorage.getItem("pianola:portrait-hint") === "1";
      } catch {
        /* storage unavailable */
      }
      setShow(!dismissed && window.innerWidth < 560 && window.innerHeight > window.innerWidth);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  if (!show) return null;
  return (
    <button
      onClick={() => {
        setShow(false);
        try {
          sessionStorage.setItem("pianola:portrait-hint", "1");
        } catch {
          /* storage unavailable */
        }
      }}
      className="pop-in absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/92 px-3.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap text-ink shadow-md"
    >
      ↻ Поверни телефон — клавіші стануть більшими
    </button>
  );
}

function ChordPopover({ rect, onClose, children }: { rect: DOMRect | null; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  useEffect(() => {
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const t = setTimeout(() => document.addEventListener("pointerdown", close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", close);
    };
  }, [onClose]);
  // Next to the clicked chord label on wide screens, a bottom sheet on phones.
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement?.getBoundingClientRect();
    if (!el || !parent || !rect || window.innerWidth < 640) {
      setStyle({});
      return;
    }
    const h = el.offsetHeight;
    const top = Math.max(8, Math.min(rect.top - parent.top - 40, parent.height - h - 8));
    const left = Math.min(rect.right - parent.left + 10, parent.width - el.offsetWidth - 8);
    setStyle({ top, left });
  }, [rect]);
  return (
    <div
      ref={ref}
      style={style}
      className="pop-in absolute z-30 w-[360px] max-w-[calc(100%-16px)] rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-pop)] max-sm:inset-x-2 max-sm:bottom-2 max-sm:w-auto sm:top-3 sm:left-16"
    >
      <button onClick={onClose} aria-label="Закрити" className="absolute top-2.5 right-2.5 grid h-7 w-7 place-items-center rounded-lg text-mute hover:bg-hover">
        <IconX size={15} />
      </button>
      {children}
    </div>
  );
}

function ChordsPanel({ chords, flats, onClose, onPlay }: { chords: Chord[]; flats: boolean; onClose: () => void; onPlay: (ps: number[], spread?: number) => void }) {
  const unique = useMemo(() => {
    const seen = new Map<string, { chord: Chord; count: number }>();
    for (const c of chords) {
      const k = chordName(c, flats);
      const e = seen.get(k);
      if (e) e.count++;
      else seen.set(k, { chord: c, count: 1 });
    }
    return [...seen.values()];
  }, [chords, flats]);
  const [sel, setSel] = useState(0);
  const cur = unique[sel];
  return (
    <div className="pop-in absolute inset-y-0 right-0 z-30 flex w-[380px] max-w-full flex-col border-l border-line bg-card shadow-[var(--shadow-pop)]">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="text-[14px] font-semibold">Акорди пісні · {unique.length}</span>
        <button onClick={onClose} aria-label="Закрити" className="grid h-8 w-8 place-items-center rounded-lg text-mute hover:bg-hover">
          <IconX size={16} />
        </button>
      </div>
      <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-3 py-2.5">
        {unique.map((u, i) => (
          <button
            key={i}
            onClick={() => {
              setSel(i);
            }}
            className={`h-9 shrink-0 rounded-lg px-3 text-[14px] font-semibold ${i === sel ? "bg-ink text-white" : "bg-hover text-ink hover:bg-line"}`}
          >
            {chordName(u.chord, flats)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {cur ? <ChordDetail key={sel} chord={cur.chord} flats={flats} onPlay={onPlay} /> : <p className="text-mute">Акордів не знайдено</p>}
        {cur && <p className="mt-4 text-[12.5px] text-faint">У пісні звучить {cur.count} раз(и). Натисни на назву акорду над нотами, щоб відкрити його будь-коли.</p>}
      </div>
    </div>
  );
}
