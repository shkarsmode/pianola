"""Polyphonic piano transcription (Kong et al., high-resolution CRNN with pedal)."""
import tempfile
import urllib.request
from pathlib import Path

import numpy as np

from .audio import to_mono
from .config import PIANO_CKPT, PIANO_CKPT_URL

_model = None


def _get(device: str):
    global _model
    if _model is None:
        if not PIANO_CKPT.exists():
            PIANO_CKPT.parent.mkdir(parents=True, exist_ok=True)
            tmp = PIANO_CKPT.with_suffix(".part")
            urllib.request.urlretrieve(PIANO_CKPT_URL, tmp)
            tmp.replace(PIANO_CKPT)
        from piano_transcription_inference import PianoTranscription

        _model = PianoTranscription(device=device, checkpoint_path=str(PIANO_CKPT))
    return _model


def transcribe(y: np.ndarray, device: str) -> tuple[list[tuple], list[tuple]]:
    """y: (n, 2) or mono at 44.1 kHz -> notes (pitch, start, end, vel), pedals (start, end)."""
    audio = to_mono(y, 16000)
    model = _get(device)
    with tempfile.TemporaryDirectory() as tmp:
        res = model.transcribe(audio, str(Path(tmp) / "out.mid"))
    notes = []
    for n in res["est_note_events"]:
        p = int(n["midi_note"])
        s = float(n["onset_time"])
        e = max(float(n["offset_time"]), s + 0.05)
        notes.append((p, round(s, 3), round(e, 3), int(n["velocity"])))
    notes.sort(key=lambda n: (n[1], n[0]))
    pedals = [(round(float(p["onset_time"]), 3), round(float(p["offset_time"]), 3))
              for p in res["est_pedal_events"]]
    pedals.sort()
    if device == "cuda":
        import torch

        torch.cuda.empty_cache()
    return notes, pedals


_bp_model = None


def transcribe_any(y: np.ndarray) -> list[tuple]:
    """Instrument-agnostic polyphonic transcription (Basic Pitch) for guitars, pads, accordion..."""
    global _bp_model
    import soundfile as sf
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model, predict

    if _bp_model is None:
        _bp_model = Model(ICASSP_2022_MODEL_PATH)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "stem.wav"
        sf.write(str(path), to_mono(y, 22050), 22050)
        _, _, events = predict(
            str(path), _bp_model, onset_threshold=0.5, frame_threshold=0.3,
            minimum_note_length=80, melodia_trick=True, multiple_pitch_bends=False,
        )
    notes = [(int(p), round(float(s), 3), round(float(e), 3), int(min(127, max(1, a * 127))))
             for s, e, p, a, _ in events]
    notes.sort(key=lambda n: (n[1], n[0]))
    return notes
