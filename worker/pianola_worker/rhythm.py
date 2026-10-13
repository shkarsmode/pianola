"""Rhythmic feel (straight 16ths or triplet/shuffle) and placing notes on the beat grid."""
import numpy as np

BINS = 48  # beat-profile resolution (bins per beat)


def _beat_profile(env: np.ndarray, rate: float, beats: np.ndarray) -> np.ndarray:
    """Onset strength folded onto one beat: where inside the beat the attacks fall."""
    t_env = np.arange(len(env)) / rate
    i = np.arange(len(beats) - 1)
    tt = beats[i, None] + (beats[i + 1, None] - beats[i, None]) * (np.arange(BINS)[None, :] / BINS)
    vals = np.interp(tt.ravel(), t_env, env).reshape(tt.shape)
    ok = (tt[:, 0] >= 0) & (tt[:, -1] <= t_env[-1])
    return vals[ok].sum(axis=0) if ok.any() else np.zeros(BINS)


_mel_cache: dict = {}


def _onset_env(mono: np.ndarray) -> np.ndarray:
    """Spectral-flux onset strength of 22.05 kHz audio, hop 256 (librosa's onset_strength:
    log-power mel bands, positive first difference, mean over bands), on the GPU if there."""
    import torch

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    if dev not in _mel_cache:
        import librosa

        _mel_cache[dev] = torch.from_numpy(librosa.filters.mel(sr=22050, n_fft=2048, n_mels=128)).to(dev)
    with torch.no_grad():
        x = torch.from_numpy(np.ascontiguousarray(mono, dtype=np.float32)).to(dev)
        win = torch.hann_window(2048, device=dev)
        spec = torch.stft(x, 2048, 256, window=win, center=True, return_complex=True).abs() ** 2
        db = 10 * torch.log10(torch.clamp(_mel_cache[dev] @ spec, min=1e-10))
        db = torch.maximum(db, db.max() - 80.0)
        flux = torch.clamp(db[:, 1:] - db[:, :-1], min=0).mean(dim=0)
        env = torch.cat([flux[:1] * 0, flux]).cpu().numpy()
        del x, spec, db, flux
    return env


def _profile_of(y: np.ndarray, sr: int, beats: np.ndarray) -> np.ndarray:
    import soxr

    mono = y.mean(axis=1) if y.ndim == 2 else y
    if sr != 22050:
        mono = soxr.resample(mono, sr, 22050)
    return _beat_profile(_onset_env(mono), 22050 / 256, beats)


def _feel_from_profile(prof: np.ndarray) -> dict:
    """Latency-corrected profile -> subdivision, swung-offbeat position, confidence."""
    if prof.max() <= 0:
        return {"subdiv": 4, "swing": 0.5, "offset": 0.0, "conf": 0.0}
    # Attacks are detected a little late: the strongest bin near the beat is "0".
    near = np.r_[np.arange(BINS - 4, BINS), np.arange(0, 6)]
    k0 = int(near[np.argmax(prof[near])])
    p = np.roll(prof, -k0)
    p = (p - np.median(p)) / max(p.max() - np.median(p), 1e-9)

    def at(frac: float) -> float:
        c = frac * BINS
        idx = np.arange(int(np.floor(c - 1)), int(np.ceil(c + 1)) + 1) % BINS
        return float(p[idx].max())

    lo, hi = int(0.42 * BINS), int(0.8 * BINS)
    k = lo + int(np.argmax(p[lo:hi]))
    if 0 < k < BINS - 1:  # parabolic refinement
        y0, y1, y2 = p[k - 1], p[k], p[k + 1]
        den = y0 - 2 * y1 + y2
        kf = k + (0.5 * (y0 - y2) / den if den < 0 else 0.0)
    else:
        kf = float(k)
    swing = kf / BINS
    straight = at(0.5) + 0.5 * (at(0.25) + at(0.75))
    triplet = at(2 / 3) + 0.5 * at(1 / 3)
    subdiv = 3 if (swing >= 0.585 and triplet > straight) else 4
    conf = min(1.0, abs(triplet - straight) / max(abs(triplet) + abs(straight), 1e-9))
    offset = (k0 if k0 < BINS / 2 else k0 - BINS) / BINS
    return {"subdiv": subdiv, "swing": round(float(swing), 3), "offset": round(float(offset), 3),
            "conf": round(float(conf), 3), "straight": round(float(straight), 3),
            "triplet": round(float(triplet), 3)}


def detect_feel(stems: dict[str, np.ndarray], sr: int, beats: list[float]) -> dict:
    """Straight or triplet feel from the band: drums, bass and the other instruments each
    vote with their attack profile inside the beat (vocals are too loose to trust)."""
    b = np.asarray(beats, dtype=float)
    if len(b) < 8:
        return {"subdiv": 4, "swing": 0.5, "offset": 0.0, "conf": 0.0}
    total = np.zeros(BINS)
    for name in ("drums", "other", "bass"):
        y = stems.get(name)
        if y is None or float(np.mean(np.square(y, dtype=np.float64))) < 1e-7:
            continue
        p = _profile_of(y, sr, b)
        if p.max() <= 0:
            continue
        p = p - np.median(p)
        total += np.clip(p, 0, None) / max(p.max(), 1e-9)
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass
    return _feel_from_profile(total)


def feel_of_mix(y: np.ndarray, sr: int, beats: list[float]) -> dict:
    """Feel of a whole recording (solo piano path, no stems): its own attack profile."""
    b = np.asarray(beats, dtype=float)
    if len(b) < 8:
        return {"subdiv": 4, "swing": 0.5, "offset": 0.0, "conf": 0.0}
    p = _profile_of(y, sr, b)
    return _feel_from_profile(np.clip(p - np.median(p), 0, None))


# --------------------------------------------------------------------------- placing notes

def _to_beats(b: np.ndarray, t: float) -> float:
    i = int(np.clip(np.searchsorted(b, t) - 1, 0, len(b) - 2))
    return i + (t - b[i]) / (b[i + 1] - b[i])


def _to_time(b: np.ndarray, x: float) -> float:
    i = int(np.clip(np.floor(x), 0, len(b) - 2))
    return float(b[i] + (x - i) * (b[i + 1] - b[i]))


# -log prior of each position inside the beat before the song's own statistics are known.
# Triplet feel: the middle triplet is rare in shuffle melodies, and a run of three notes in
# a beat still gets it because notes keep their order one per slot.
SLOT_PRIOR = {
    3: [0.0, 2.0, 0.1],
    4: [0.0, 0.8, 0.15, 0.8],
}


def _viterbi_slots(xw: np.ndarray, S: int, prior: list[float], sigma: float,
                   drop_cost: float) -> list[int | None]:
    """One slot (in 1/S beats) per note, strictly increasing; None = dropped."""
    step = 1.0 / S
    states: dict[int, float] = {-10**9: 0.0}  # slot of the last kept note -> cost
    back: list[dict[int, tuple[int, int | None]]] = []
    for xi in xw:
        c0 = int(np.floor((xi - 0.6) * S))
        cands = []
        for q in range(c0, c0 + int(1.2 * S) + 2):
            d = (xi - q * step) / sigma
            if abs(d) <= 5:
                cands.append((q, 0.5 * d * d + prior[q % S]))
        new: dict[int, float] = {}
        bp: dict[int, tuple[int, int | None]] = {}
        for last, cost in states.items():
            c = cost + drop_cost
            if c < new.get(last, 1e18):
                new[last], bp[last] = c, (last, None)
            for q, cq in cands:
                if q > last and cost + cq < new.get(q, 1e18):
                    new[q], bp[q] = cost + cq, (last, q)
        if len(new) > 40:
            keep = sorted(new, key=new.get)[:40]
            new = {k: new[k] for k in keep}
        states = new
        back.append(bp)
    last = min(states, key=states.get)
    slots: list[int | None] = [None] * len(xw)
    for i in range(len(xw) - 1, -1, -1):
        prev, q = back[i][last]
        slots[i] = q
        last = prev
    return slots


def place_notes(spans: list[tuple[float, float]], beats: list[float], feel: dict,
                sigma: float = 0.14, drop_cost: float = 3.0,
                info: dict | None = None) -> list[tuple[float | None, float | None]]:
    """Snap note (start, end) times to the song's grid: 1/3 beat (triplet feel) or 1/4.

    The singer's own timing is learned first: a constant lead or lag against the beat and,
    in triplet feel, where their swung offbeat really sits (often between 1/2 and 2/3), so
    it lands on 2/3 rather than on the middle triplet. A Viterbi pass then keeps notes in
    order, one per slot, preferring the positions this song actually uses (a first pass
    counts them): a shuffle melody rarely sits on the middle triplet, a 12/8 one often
    does. A note that cannot get a slot of its own is dropped (returned as (None, None)).
    """
    b = np.asarray(beats, dtype=float)
    if len(spans) == 0 or len(b) < 2:
        return list(spans)
    S = int(feel.get("subdiv", 4))
    x = np.array([_to_beats(b, s) for s, _ in spans])
    xe = np.array([_to_beats(b, e) for _, e in spans])

    frac = x - np.floor(x)
    lead = np.where(frac > 0.5, frac - 1.0, frac)
    close = np.abs(lead) < 0.15
    off = float(np.clip(np.median(lead[close]), -0.08, 0.08)) if close.sum() >= 8 else 0.0
    x, xe = x - off, xe - off

    def warp(v: np.ndarray, sw: float) -> np.ndarray:
        f = v - np.floor(v)
        g = np.where(f < sw, f * (2 / 3) / sw, 2 / 3 + (f - sw) * (1 / 3) / (1 - sw))
        return np.floor(v) + g

    if S == 3:
        f = x - np.floor(x)
        mid = f[(f > 0.4) & (f < 0.85)]
        sw = float(np.clip(np.median(mid), 0.55, 0.72)) if len(mid) >= 8 else float(
            np.clip(feel.get("swing", 2 / 3), 0.55, 0.72))
        xw, xew = warp(x, sw), warp(xe, sw)
    else:
        sw = 0.5
        xw, xew = x, xe

    prior = list(SLOT_PRIOR.get(S, [0.0] * S))
    slots = _viterbi_slots(xw, S, prior, sigma, drop_cost)
    used = [q % S for q in slots if q is not None]
    if len(used) >= 24:  # second pass with this song's own slot statistics
        cnt = np.bincount(used, minlength=S) + 1.0
        prior = [float(np.clip(np.log(cnt[0] / c), 0.0, 2.5)) for c in cnt]
        slots = _viterbi_slots(xw, S, prior, sigma, drop_cost)
    if info is not None:
        info.update({"offset": round(off, 3), "swing": round(sw, 3), "prior": [round(v, 2) for v in prior]})

    step = 1.0 / S
    out: list[tuple[float | None, float | None]] = []
    kept = [i for i in range(len(spans)) if slots[i] is not None]
    nxt = {a: b_ for a, b_ in zip(kept, kept[1:])}
    for i in range(len(spans)):
        q = slots[i]
        if q is None:
            out.append((None, None))
            continue
        qe = max(q + 1, int(np.round(xew[i] * S)))
        if i in nxt:
            qe = min(qe, slots[nxt[i]])
        out.append((_to_time(b, q * step), _to_time(b, qe * step)))
    return out
