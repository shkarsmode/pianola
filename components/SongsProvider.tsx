"use client";

import { upload } from "@vercel/blob/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SongMeta } from "@/lib/types";

export interface WorkerView {
  online: boolean;
  known: boolean;
  current: { id: string; stage: string; progress: number } | null;
  queue: string[];
}

interface LibraryCtx {
  songs: SongMeta[];
  loaded: boolean;
  worker: WorkerView;
  refresh: () => Promise<void>;
  addUrl: (url: string) => Promise<SongMeta>;
  addFile: (file: File | Blob, filename: string, kind: "upload" | "record", onProgress?: (p: number) => void) => Promise<SongMeta>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  pin: (id: string, pinned: boolean) => Promise<void>;
}

const Ctx = createContext<LibraryCtx | null>(null);

export const STAGE_LABEL: Record<string, string> = {
  queued: "У черзі",
  download: "Завантажую",
  decode: "Готую аудіо",
  probe: "Слухаю, що звучить",
  beats: "Шукаю такти",
  separate: "Розділяю на доріжки",
  transcribe: "Розпізнаю ноти",
  melody: "Виділяю мелодію",
  chords: "Визначаю акорди",
  upload: "Зберігаю",
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Помилка ${res.status}`);
  return data as T;
}

export function SongsProvider({ children }: { children: React.ReactNode }) {
  const [songs, setSongs] = useState<SongMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [worker, setWorker] = useState<WorkerView>({ online: false, known: false, current: null, queue: [] });
  const topic = useRef<string | null>(null);
  const lastSeen = useRef(0);
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await json<{ songs: SongMeta[] }>(await fetch("/api/songs", { cache: "no-store" }));
      setSongs(data.songs);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, []);

  // Messages to the PC worker go through ntfy.sh: the PC needs no open ports or tunnels.
  const publish = useCallback(async (msg: object) => {
    if (!topic.current) return;
    await fetch(`https://ntfy.sh/${topic.current}`, { method: "POST", body: JSON.stringify(msg) }).catch(() => undefined);
  }, []);

  const ping = useCallback(() => {
    if (!topic.current || pending.current) return;
    const id = Math.random().toString(36).slice(2, 10);
    pending.current = {
      id,
      timer: setTimeout(() => {
        pending.current = null;
        if (Date.now() - lastSeen.current > 8000) setWorker((w) => ({ ...w, online: false, known: true, current: null }));
      }, 7000),
    };
    void publish({ t: "ping", id });
  }, [publish]);

  const kick = useCallback(() => void publish({ t: "kick" }), [publish]);

  useEffect(() => {
    void refresh();
    let es: EventSource | null = null;
    let closed = false;
    (async () => {
      try {
        const data = await json<{ topic: string }>(await fetch("/api/worker", { cache: "no-store" }));
        if (closed) return;
        topic.current = data.topic;
        es = new EventSource(`https://ntfy.sh/${data.topic}-s/sse?since=60s`);
        es.onmessage = (e) => {
          let msg: { t?: string; current?: WorkerView["current"]; queue?: string[]; id?: string; song?: string };
          let at = Date.now();
          try {
            const env = JSON.parse(e.data) as { message?: string; time?: number };
            msg = JSON.parse(env.message ?? "{}");
            if (env.time) at = env.time * 1000;
          } catch {
            return;
          }
          // replayed history (since=60s) may be from a worker that has stopped since
          if (Date.now() - at > 5 * 60e3) return;
          lastSeen.current = Math.max(lastSeen.current, at);
          if (pending.current && (msg.t !== "pong" || msg.id === pending.current.id)) {
            clearTimeout(pending.current.timer);
            pending.current = null;
          }
          setWorker({ online: true, known: true, current: msg.current ?? null, queue: msg.queue ?? [] });
          if (msg.t === "done") void refresh();
        };
        ping();
      } catch {
        setWorker((w) => ({ ...w, known: true }));
      }
    })();
    return () => {
      closed = true;
      es?.close();
    };
  }, [refresh, ping]);

  const busy = songs.some((s) => s.status === "queued" || s.status === "processing");
  useEffect(() => {
    // while something is in the queue: refresh the list, and look for the PC now and then
    const t1 = setInterval(() => void refresh(), busy ? 8000 : 90000);
    const t2 = busy ? setInterval(() => Date.now() - lastSeen.current > 60000 && ping(), 60000) : null;
    return () => {
      clearInterval(t1);
      if (t2) clearInterval(t2);
    };
  }, [busy, refresh, ping]);

  const addUrl = useCallback(
    async (url: string) => {
      const { song } = await json<{ song: SongMeta }>(
        await fetch("/api/songs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }),
      );
      setSongs((s) => [song, ...s]);
      void kick();
      return song;
    },
    [kick],
  );

  const addFile = useCallback(
    async (file: File | Blob, filename: string, kind: "upload" | "record", onProgress?: (p: number) => void) => {
      const safe = filename.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-80) || "audio";
      const blob = await upload(`pianola/uploads/${safe}`, file, {
        access: "private",
        handleUploadUrl: "/api/upload",
        multipart: file.size > 30 * 1024 * 1024,
        onUploadProgress: (e) => onProgress?.(e.percentage / 100),
      });
      const { song } = await json<{ song: SongMeta }>(
        await fetch("/api/songs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uploadPath: blob.pathname, filename, kind }),
        }),
      );
      setSongs((s) => [song, ...s]);
      void kick();
      return song;
    },
    [kick],
  );

  const patch = useCallback(async (id: string, body: object) => {
    const { song } = await json<{ song: SongMeta }>(
      await fetch(`/api/songs/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
    setSongs((list) => list.map((s) => (s.id === id ? song : s)));
  }, []);

  const value = useMemo<LibraryCtx>(
    () => ({
      songs,
      loaded,
      worker,
      refresh,
      addUrl,
      addFile,
      rename: (id, title) => patch(id, { title }),
      pin: (id, pinned) => patch(id, { pinned }),
      retry: async (id) => {
        await patch(id, { retry: true });
        void kick();
      },
      remove: async (id) => {
        setSongs((list) => list.filter((s) => s.id !== id));
        await fetch(`/api/songs/${id}`, { method: "DELETE" });
      },
    }),
    [songs, loaded, worker, refresh, addUrl, addFile, patch, kick],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary(): LibraryCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLibrary outside SongsProvider");
  return v;
}
