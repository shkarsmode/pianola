"""The song index shared with the web app (pianola/index.json), updated with ETag checks."""
import json
import random
import time
from typing import Callable

from .blob import Blob, PreconditionFailed

INDEX_PATH = "pianola/index.json"
WORKER_PATH = "pianola/worker.json"


def read_index(blob: Blob) -> tuple[dict, str | None]:
    got = blob.get(INDEX_PATH)
    if got is None:
        return {"v": 1, "songs": []}, None
    data, etag = got
    return json.loads(data.decode("utf-8")), etag


def mutate_index(blob: Blob, fn: Callable[[dict], None]) -> dict:
    for _ in range(8):
        index, etag = read_index(blob)
        fn(index)
        try:
            blob.put(INDEX_PATH, json.dumps(index, ensure_ascii=False).encode("utf-8"), "application/json",
                     if_match=etag, cache_max_age=60)
            return index
        except PreconditionFailed:
            time.sleep(0.15 + random.random() * 0.3)
    raise RuntimeError("index is busy")


def update_song(blob: Blob, song_id: str, **fields) -> dict | None:
    found: dict = {}

    def fn(index: dict) -> None:
        for s in index["songs"]:
            if s["id"] == song_id:
                s.update({k: v for k, v in fields.items() if v is not None})
                for k, v in fields.items():
                    if v is None:
                        s.pop(k, None)
                s["updatedAt"] = int(time.time() * 1000)
                found.update(s)

    mutate_index(blob, fn)
    return found or None


def queued_songs(blob: Blob) -> list[dict]:
    index, _ = read_index(blob)
    songs = [s for s in index["songs"] if s.get("status") in ("queued", "processing")]
    return sorted(songs, key=lambda s: s.get("createdAt", 0))


def publish_worker(blob: Blob, url: str, started_at: int) -> None:
    body = {"url": url, "startedAt": started_at, "seenAt": int(time.time() * 1000)}
    blob.put(WORKER_PATH, json.dumps(body).encode("utf-8"), "application/json", cache_max_age=60)
