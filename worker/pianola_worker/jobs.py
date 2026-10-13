"""The processing queue: picks queued songs from the shared index, analyses them, publishes results."""
import json
import logging
import shutil
import threading
import time
import traceback
from pathlib import Path

from .blob import Blob
from .config import WORK_DIR
from .library import queued_songs, update_song

log = logging.getLogger("pianola.jobs")

MAX_SECONDS = 15 * 60
PLACEHOLDER_PREFIX = "Пісня з "


def friendly_error(e: Exception) -> str:
    msg = str(e)
    low = msg.lower()
    if "too long" in low or "задовг" in low:
        return "Задовгий запис: до 15 хвилин"
    if "private video" in low or "members-only" in low:
        return "Відео приватне — його не відкрити"
    if "sign in to confirm your age" in low or "age-restricted" in low:
        return "YouTube обмежив відео за віком — завантаж аудіо файлом"
    if "login required" in low or "rate-limit reached" in low or ("instagram" in low and "login" in low):
        return "Instagram не віддав відео без входу — завантаж його файлом"
    if "video unavailable" in low or "not available" in low or "has been removed" in low:
        return "Відео недоступне"
    if "unsupported url" in low or "is not a valid url" in low:
        return "Не вмію відкривати таке посилання"
    if "http error 403" in low or "sign in to confirm" in low:
        return "Сайт не віддав аудіо (403) — спробуй ще раз пізніше або завантаж файлом"
    if "no audio" in low or "does not contain any stream" in low or "output file is empty" in low:
        return "У файлі немає звуку"
    short = msg.strip().splitlines()[-1] if msg.strip() else type(e).__name__
    return f"Не вдалося обробити: {short[:180]}"


def download_url(url: str, workdir: Path, on_progress) -> tuple[Path, dict]:
    from yt_dlp import YoutubeDL

    node = shutil.which("node")
    base = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "noprogress": True,
        "js_runtimes": {"node": {"path": node}} if node else {"deno": {}},
        "socket_timeout": 30,
        "retries": 3,
    }
    with YoutubeDL(base) as ydl:
        info = ydl.extract_info(url, download=False)
    if info.get("_type") == "playlist" and info.get("entries"):
        info = next(e for e in info["entries"] if e)
    duration = info.get("duration") or 0
    if duration and duration > MAX_SECONDS:
        raise RuntimeError("too long")

    def hook(d):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                on_progress(min(1.0, d.get("downloaded_bytes", 0) / total))

    opts = dict(base, format="bestaudio/best", outtmpl=str(workdir / "source.%(ext)s"), progress_hooks=[hook])
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(info.get("webpage_url") or url, download=True)
        path = Path(ydl.prepare_filename(info))
    if not path.exists():
        candidates = sorted(workdir.glob("source.*"))
        if not candidates:
            raise RuntimeError("download produced no file")
        path = candidates[0]
    meta = {
        "title": info.get("track") and info.get("artist") and f"{info['artist']} — {info['track']}" or info.get("title"),
        "thumb": info.get("thumbnail"),
        "uploader": info.get("uploader") or info.get("channel"),
    }
    return path, meta


class JobRunner:
    def __init__(self, blob: Blob, notify=None):
        self.blob = blob
        self.notify = notify  # Ntfy or None
        self.current: dict | None = None
        self.queue: list[str] = []
        self._wake = threading.Event()
        self._lock = threading.Lock()
        self.last_error: str | None = None

    def status(self) -> dict:
        with self._lock:
            return {"current": dict(self.current) if self.current else None, "queue": list(self.queue)}

    def kick(self) -> None:
        self._wake.set()

    def _set(self, song_id: str, stage: str, progress: float) -> None:
        with self._lock:
            changed = not self.current or self.current.get("stage") != stage or self.current.get("id") != song_id
            self.current = {"id": song_id, "stage": stage, "progress": round(max(0.0, min(1.0, progress)), 3)}
        if changed:
            self.announce()

    def announce(self, kind: str = "status", **extra) -> None:
        """Tells the web app what is going on (stage changes, done, pong)."""
        if self.notify:
            st = self.status()
            self.notify.publish({"t": kind, **st, **extra}, essential=kind != "status")

    def on_message(self, msg: dict) -> None:
        kind = msg.get("t")
        if kind == "kick":
            self.kick()
        elif kind == "ping":
            self.announce("pong", id=msg.get("id"))
            # someone opened the app: a cheap moment to look for songs a lost kick left waiting
            if not self.current:
                self.kick()

    def run_forever(self, idle_seconds: float = 15 * 60) -> None:
        while True:
            try:
                self.process_queue()
            except Exception:  # keep the worker alive whatever happens
                log.exception("queue pass failed")
            self._wake.wait(idle_seconds)
            self._wake.clear()

    def process_queue(self) -> None:
        while True:
            songs = queued_songs(self.blob)
            with self._lock:
                self.queue = [s["id"] for s in songs]
            if not songs:
                return
            self.process(songs[0])

    def process(self, song: dict) -> None:
        from .analyze import analyze

        sid = song["id"]
        workdir = WORK_DIR / sid
        if workdir.exists():
            shutil.rmtree(workdir, ignore_errors=True)
        workdir.mkdir(parents=True, exist_ok=True)
        log.info("processing %s %s", sid, song.get("title"))
        self._set(sid, "download", 0.01)
        t0 = time.time()
        try:
            update_song(self.blob, sid, status="processing")
            src = song.get("source", {})
            meta: dict = {}
            if src.get("kind") == "url":
                path, meta = download_url(src["url"], workdir, lambda f: self._set(sid, "download", 0.01 + 0.05 * f))
            else:
                upload = song.get("uploadPath")
                if not upload:
                    raise RuntimeError("upload is missing")
                ext = Path(src.get("filename") or "audio.bin").suffix or ".bin"
                path = workdir / f"source{ext}"
                self.blob.download(upload, path)

            result = analyze(path, workdir, lambda stage, f: self._set(sid, stage, 0.06 + 0.86 * f))
            if result["duration"] > MAX_SECONDS + 5:
                raise RuntimeError("too long")

            self._set(sid, "upload", 0.94)
            audio = self.blob.put(f"pianola/songs/{sid}/audio.m4a", (workdir / "audio.m4a").read_bytes(),
                                  "audio/mp4", random_suffix=True)
            body = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            analysis = self.blob.put(f"pianola/songs/{sid}/analysis.json", body, "application/json", random_suffix=True)

            title = song.get("title") or ""
            if meta.get("title") and (not title or title.startswith(PLACEHOLDER_PREFIX)):
                title = meta["title"].strip()[:160]
            old = [song.get("audioPath"), song.get("analysisPath")]
            saved = update_song(
                self.blob, sid,
                status="ready", error=None, title=title,
                audioPath=audio["pathname"], analysisPath=analysis["pathname"], uploadPath=None,
                duration=result["duration"], key=result["key"]["name"], tempo=result["tempo"],
                thumb=meta.get("thumb"),
            )
            if not saved:  # the song was deleted while it was being processed
                old += [audio["pathname"], analysis["pathname"]]
            self.blob.delete([p for p in old if p] + ([song["uploadPath"]] if song.get("uploadPath") else []))
            log.info("done %s in %.1fs", sid, time.time() - t0)
            with self._lock:
                self.current = None
            self.announce("done", song=sid, ok=True)
        except Exception as e:
            log.error("failed %s: %s\n%s", sid, e, traceback.format_exc())
            self.last_error = str(e)
            try:
                update_song(self.blob, sid, status="error", error=friendly_error(e))
            except Exception:
                log.exception("could not record the error")
            with self._lock:
                self.current = None
            self.announce("done", song=sid, ok=False)
        finally:
            with self._lock:
                self.current = None
            shutil.rmtree(workdir, ignore_errors=True)
