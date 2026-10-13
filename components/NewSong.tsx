"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconLink, IconMic, IconUpload } from "./Icons";
import { SidebarButton } from "./Shell";
import { useLibrary } from "./SongsProvider";

const ACCEPT = "audio/*,video/*,.mp3,.m4a,.wav,.flac,.ogg,.opus,.aac,.mp4,.mov,.webm,.mkv";

function fmt(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

export function NewSong() {
  const { addUrl, addFile, worker } = useLibrary();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [rec, setRec] = useState<{ started: number; elapsed: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setRec((r) => (r ? { ...r, elapsed: (Date.now() - r.started) / 1000 } : r)), 250);
    return () => clearInterval(t);
  }, [rec]);

  async function submitUrl(e?: React.FormEvent) {
    e?.preventDefault();
    if (!url.trim() || busy) return;
    setBusy("Додаю…");
    setError("");
    try {
      const song = await addUrl(url.trim());
      router.push(`/song/${song.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  async function sendFile(file: File | Blob, name: string, kind: "upload" | "record") {
    setError("");
    setBusy("Завантажую 0%");
    try {
      const song = await addFile(file, name, kind, (p) => setBusy(`Завантажую ${Math.round(p * 100)}%`));
      router.push(`/song/${song.id}`);
    } catch (err) {
      setError((err as Error).message || "Не вдалося завантажити файл");
      setBusy(null);
    }
  }

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const mr = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = mr.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const d = new Date();
        const name = `Запис ${d.toLocaleDateString("uk-UA")} ${d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}.${ext}`;
        void sendFile(new Blob(chunks, { type }), name, "record");
      };
      recorder.current = mr;
      mr.start(1000);
      setRec({ started: Date.now(), elapsed: 0 });
    } catch {
      setError("Немає доступу до мікрофона");
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    recorder.current = null;
    setRec(null);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex h-14 shrink-0 items-center px-3">
        <SidebarButton />
      </div>
      <div className="mx-auto w-full max-w-[640px] px-4 pt-[6vh] pb-16">
        <h1 className="text-[30px] leading-[1.15] font-semibold tracking-tight text-balance sm:text-[38px]">Будь-яка пісня — у падаючі ноти</h1>
        <p className="mt-3 text-[15px] leading-6 text-mute text-pretty">
          Посилання з YouTube, Instagram чи TikTok, аудіофайл або запис з мікрофона. Розберу мелодію, акорди й такти і покажу, як зіграти
          на твоєму рівні.
        </p>

        <div className="mt-8 rounded-2xl border border-line bg-card p-3 shadow-[0_1px_0_rgb(0_0_0/0.02)] sm:p-4">
          <form onSubmit={submitUrl} className="flex gap-2">
            <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line-2 bg-paper/50 px-3 focus-within:border-ink">
              <IconLink size={18} className="shrink-0 text-mute" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Встав посилання на пісню"
                inputMode="url"
                className="h-full w-full min-w-0 bg-transparent text-[15px] outline-none placeholder:text-faint"
              />
            </label>
            <button
              type="submit"
              disabled={!url.trim() || !!busy}
              className="h-12 shrink-0 rounded-xl bg-ink px-4 text-[14.5px] font-medium text-white transition-opacity disabled:opacity-40 sm:px-5"
            >
              Розібрати
            </button>
          </form>

          <div className="my-3 flex items-center gap-3 text-[12px] text-faint">
            <div className="h-px flex-1 bg-line" />
            або
            <div className="h-px flex-1 bg-line" />
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void sendFile(f, f.name, "upload");
            }}
            className={`flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-7 text-center transition-colors ${
              drag ? "border-accent bg-accent-soft" : "border-line-2"
            }`}
          >
            <IconUpload size={22} className="text-mute" />
            <p className="mt-2 text-[14px] text-ink-2">Перетягни сюди аудіо чи відео</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => fileInput.current?.click()}
                className="h-9 rounded-lg border border-line-2 bg-card px-3.5 text-[13.5px] font-medium hover:bg-hover disabled:opacity-50"
              >
                Обрати файл
              </button>
              {rec ? (
                <button type="button" onClick={stopRecording} className="flex h-9 items-center gap-2 rounded-lg bg-danger px-3.5 text-[13.5px] font-medium text-white">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  Зупинити · {fmt(rec.elapsed)}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={startRecording}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-line-2 bg-card px-3.5 text-[13.5px] font-medium hover:bg-hover disabled:opacity-50"
                >
                  <IconMic size={16} />
                  Записати
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void sendFile(f, f.name, "upload");
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="mt-4 min-h-6 text-[13.5px] leading-5">
          {busy ? (
            <span className="text-ink-2">{busy}</span>
          ) : error ? (
            <span className="text-danger">{error}</span>
          ) : worker.known ? (
            worker.online ? (
              <span className="text-mute">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-lh align-middle" />
                Обробник на ПК онлайн: пісня буде готова приблизно за хвилину.
              </span>
            ) : (
              <span className="text-mute">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-line-2 align-middle" />
                ПК зараз вимкнений. Пісня стане в чергу й обробиться, щойно він увімкнеться.
              </span>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
