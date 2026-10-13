"""Audio file -> analysis.json: beats, bars, key, chords, melody, full transcription."""
import time
from pathlib import Path
from typing import Callable

from . import config  # noqa: F401  (sets model cache env before torch loads)
from .audio import SR, decode, encode_playback, load
from .beats import track
from .chords import detect_key, key_from_chords, recognize
from .config import device
from .melody import fill_gaps, top_voice, vocal_melody, vocal_pitch
from .rhythm import detect_feel, feel_of_mix
from .separate import is_solo_instrument, probe_shares, separate, shares
from .transcribe import transcribe, transcribe_any

Progress = Callable[[str, float], None]

ANALYSIS_VERSION = 1


def analyze(src: Path, workdir: Path, progress: Progress = lambda stage, frac: None) -> dict:
    workdir.mkdir(parents=True, exist_ok=True)
    dev = device()
    timing: dict[str, float] = {}
    t0 = time.time()

    def mark(stage: str, frac: float) -> None:
        nonlocal t0
        timing[stage] = round(time.time() - t0, 2)
        t0 = time.time()
        progress(stage, frac)

    progress("decode", 0.02)
    wav = decode(src, workdir / "audio.wav")
    y = load(wav)
    duration = y.shape[0] / SR
    encode_playback(wav, workdir / "audio.m4a")
    mark("decode", 0.08)

    probe = probe_shares(y, dev)
    solo = is_solo_instrument(probe)
    mark("probe", 0.16)

    grid = track(y, SR, duration, dev)
    mark("beats", 0.26)

    if solo:
        feel = feel_of_mix(y, SR, grid["beats"])
        notes, pedals = transcribe(y, dev)
        mark("transcribe", 0.8)
        melody = top_voice(notes)
        melody_source = "piano-top"
        stem_shares = probe
    else:
        stems = separate(y, dev)
        stem_shares = shares(stems)
        mark("separate", 0.5)
        notes = transcribe_any(stems["other"] + stems["bass"])
        pedals = []
        mark("transcribe", 0.72)
        feel = detect_feel(stems, SR, grid["beats"])  # straight or triplet, from the band
        band_top = top_voice(notes)
        vp = vocal_pitch(stems["vocals"], dev) if stem_shares.get("vocals", 0) >= 0.04 else None
        if vp is not None:
            sung, _ = vocal_melody(vp, grid["beats"], grid["barPos"], feel, notes)
            melody = fill_gaps(sung, band_top, grid["beats"], grid["timeSig"])
            melody_source = "vocals"
        else:
            melody = band_top
            melody_source = "band-top"
        mark("melody", 0.84)

    key = detect_key(notes, melody)
    chords = recognize(notes, pedals, grid["beats"], grid["barPos"], grid["timeSig"],
                       melody=melody, key=key)
    # the chord chart settles relative-key doubts (Em / G / Bm); redo chords if the key moved
    chart_key = key_from_chords(chords, notes, melody)
    if (chart_key["tonic"], chart_key["mode"]) != (key["tonic"], key["mode"]):
        key = chart_key
        chords = recognize(notes, pedals, grid["beats"], grid["barPos"], grid["timeSig"],
                           melody=melody, key=key)
    mark("chords", 0.95)

    return {
        "v": ANALYSIS_VERSION,
        "duration": round(duration, 3),
        "sourceType": "piano" if solo else "mix",
        "melodySource": melody_source,
        "stemShares": stem_shares,
        "tempo": grid["tempo"],
        "timeSig": grid["timeSig"],
        "subdiv": feel["subdiv"],
        "feel": {"swing": feel["swing"], "conf": feel["conf"]},
        "beats": grid["beats"],
        "barPos": grid["barPos"],
        "key": key,
        "chords": chords,
        "melody": [list(n) for n in melody],
        "notes": [list(n) for n in notes],
        "pedal": [list(p) for p in pedals],
        "timing": timing,
    }
