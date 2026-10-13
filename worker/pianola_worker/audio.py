"""Audio decoding and encoding through ffmpeg."""
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr

SR = 44100


def _ffmpeg(*args: str) -> None:
    proc = subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.strip()[-500:]}")


def decode(src: Path, dst_wav: Path) -> Path:
    """Any audio/video file -> 44.1 kHz stereo float WAV (the reference timeline)."""
    _ffmpeg("-i", str(src), "-vn", "-ac", "2", "-ar", str(SR), "-c:a", "pcm_f32le", str(dst_wav))
    return dst_wav


def load(path: Path) -> np.ndarray:
    """Returns float32 samples shaped (n, 2)."""
    y, sr = sf.read(str(path), dtype="float32", always_2d=True)
    if sr != SR:
        y = soxr.resample(y, sr, SR).astype(np.float32)
    if y.shape[1] == 1:
        y = np.repeat(y, 2, axis=1)
    return y[:, :2]


def to_mono(y: np.ndarray, sr_out: int) -> np.ndarray:
    mono = y.mean(axis=1) if y.ndim == 2 else y
    if sr_out != SR:
        mono = soxr.resample(mono, SR, sr_out)
    return np.ascontiguousarray(mono, dtype=np.float32)


def encode_playback(src_wav: Path, dst: Path) -> Path:
    """The file the browser plays: AAC in MP4, start-aligned with the analysed WAV.

    Peak-normalised to -1 dBFS so quiet uploads and loud masters sit at a similar level.
    """
    y = load(src_wav)
    peak = float(np.max(np.abs(y))) or 1.0
    gain_db = min(12.0, -1.0 - 20 * np.log10(peak))
    _ffmpeg(
        "-i", str(src_wav),
        "-af", f"volume={gain_db:.2f}dB",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        str(dst),
    )
    return dst


def duration_of(path: Path) -> float:
    info = sf.info(str(path))
    return info.frames / info.samplerate
