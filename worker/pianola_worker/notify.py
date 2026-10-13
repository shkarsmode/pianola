"""Messages between the web app and this PC over ntfy.sh (free pub-sub over HTTPS).

The browser posts "kick" (a song was queued) and "ping"; the worker answers on a status topic
with "pong", stage changes and "done". Nothing secret travels here: song ids and stage names.
Topic names derive from the shared worker secret, so only the app and the worker know them.
"""
import hashlib
import hmac
import json
import logging
import threading
import time
from datetime import date
from typing import Callable

import requests

log = logging.getLogger("pianola.notify")

BASE = "https://ntfy.sh"
DAILY_BUDGET = 200  # ntfy.sh allows 250 messages a day per IP; keep room for the essentials


def topic_for(secret: str) -> str:
    return "pianola-" + hmac.new(secret.encode(), b"ntfy-topic", hashlib.sha256).hexdigest()[:24]


class Ntfy:
    def __init__(self, secret: str):
        self.topic = topic_for(secret)
        self.status_topic = self.topic + "-s"
        self.http = requests.Session()
        self._day = date.today()
        self._sent = 0
        self._last_status = 0.0
        self._lock = threading.Lock()

    def publish(self, payload: dict, essential: bool = False) -> None:
        with self._lock:
            if date.today() != self._day:
                self._day, self._sent = date.today(), 0
            if self._sent >= DAILY_BUDGET and not essential:
                return
            if not essential and payload.get("t") == "status" and time.time() - self._last_status < 4:
                return
            self._sent += 1
            if payload.get("t") == "status":
                self._last_status = time.time()
        try:
            self.http.post(f"{BASE}/{self.status_topic}", data=json.dumps(payload).encode("utf-8"), timeout=10)
        except requests.RequestException as e:
            log.warning("publish failed: %s", e)

    def listen(self, on_message: Callable[[dict], None]) -> None:
        """Follows the command topic forever (reconnecting) in a background thread."""

        def run() -> None:
            backoff = 2
            since: str | None = None  # first connection: only new messages; then resume after the last id
            while True:
                try:
                    params = {"since": since} if since else {}
                    with self.http.get(f"{BASE}/{self.topic}/json", params=params, stream=True,
                                       timeout=(10, 90)) as r:
                        r.raise_for_status()
                        backoff = 2
                        for line in r.iter_lines():
                            if not line:
                                continue
                            msg = json.loads(line)
                            if msg.get("event") != "message":
                                continue
                            since = msg.get("id") or since
                            try:
                                on_message(json.loads(msg.get("message") or "{}"))
                            except ValueError:
                                pass
                            except Exception:
                                log.exception("message handler failed")
                except requests.RequestException as e:
                    log.info("listen reconnect: %s", e)
                time.sleep(backoff)
                backoff = min(60, backoff * 2)

        threading.Thread(target=run, name="ntfy", daemon=True).start()
