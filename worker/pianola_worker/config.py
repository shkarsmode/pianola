"""Worker settings: paths, model caches and secrets from worker/.env."""
import os
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = WORKER_DIR / "models"
WORK_DIR = WORKER_DIR / "work"

# Model caches live on D: next to the worker, never in the user profile on C:.
os.environ.setdefault("TORCH_HOME", str(MODELS_DIR / "torch"))
os.environ.setdefault("HF_HOME", str(MODELS_DIR / "hf"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

# ffmpeg.exe is copied into the venv's Scripts folder.
_scripts = Path(os.sys.executable).parent
if str(_scripts) not in os.environ.get("PATH", ""):
    os.environ["PATH"] = str(_scripts) + os.pathsep + os.environ.get("PATH", "")

PIANO_CKPT = MODELS_DIR / "piano_transcription.pth"
PIANO_CKPT_URL = (
    "https://zenodo.org/record/4034264/files/"
    "CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
)


def load_env() -> dict:
    """Reads worker/.env (KEY=VALUE lines) into os.environ without overriding real env."""
    env_file = WORKER_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"'))
    return {
        "app_url": os.environ.get("PIANOLA_APP_URL", "").rstrip("/"),
        "worker_secret": os.environ.get("PIANOLA_WORKER_SECRET", ""),
        "blob_token": os.environ.get("BLOB_READ_WRITE_TOKEN", ""),
        "port": int(os.environ.get("PIANOLA_PORT", "8765")),
    }


def device() -> str:
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"
