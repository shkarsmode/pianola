"""python -m pianola_worker — the background service: processing queue + messages from the web app."""
import logging
import logging.handlers
import sys

from . import config
from .blob import Blob
from .jobs import JobRunner
from .notify import Ntfy


def setup_logging() -> None:
    logs = config.WORKER_DIR / "logs"
    logs.mkdir(exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(logs / "worker.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    handler.setFormatter(fmt)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    if sys.stderr and sys.stderr.isatty():
        console = logging.StreamHandler()
        console.setFormatter(fmt)
        root.addHandler(console)


def single_instance(port: int):
    """Holds a local port for the process lifetime so a second copy exits right away."""
    import socket

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
    except OSError:
        return None
    s.listen(1)
    return s


def main() -> None:
    setup_logging()
    log = logging.getLogger("pianola")
    env = config.load_env()
    if not env["blob_token"] or not env["worker_secret"]:
        log.error("worker/.env must define BLOB_READ_WRITE_TOKEN and PIANOLA_WORKER_SECRET")
        sys.exit(1)
    lock = single_instance(env["port"])
    if lock is None:
        log.info("another worker is already running")
        sys.exit(0)
    notify = Ntfy(env["worker_secret"])
    runner = JobRunner(Blob(env["blob_token"]), notify)
    notify.listen(runner.on_message)
    runner.announce("hello")
    log.info("worker started")
    runner.run_forever()


if __name__ == "__main__":
    main()
