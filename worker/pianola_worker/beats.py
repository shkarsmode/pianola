"""Beats and bars: beat_this activations, a tempo-consistent beat path, and a regular bar grid.

beat_this's own peak picking skips beats where the network is unsure (a quiet solo-piano
intro easily comes out at half tempo). Here its frame activations feed a dynamic-programming
tracker (Ellis 2007) that must keep a steady period but may follow rubato, and the downbeat
activation then places bar lines with a Viterbi over position-in-bar.
"""
import numpy as np

FPS = 50
_frames = None


def _get(device: str):
    global _frames
    if _frames is None:
        from beat_this.inference import Audio2Frames

        _frames = Audio2Frames(checkpoint_path="final0", device=device)
    return _frames


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _peaks(act: np.ndarray, thr: float = 0.5) -> np.ndarray:
    """Local maxima above threshold, at least 70 ms apart (beat_this's minimal post-processing)."""
    idx = np.flatnonzero((act[1:-1] >= act[:-2]) & (act[1:-1] > act[2:]) & (act[1:-1] > thr)) + 1
    out: list[int] = []
    for i in idx:
        if out and i - out[-1] < 4:
            if act[i] > act[out[-1]]:
                out[-1] = i
            continue
        out.append(int(i))
    return np.asarray(out)


def _period(act: np.ndarray) -> float:
    """Beat period in frames: the median gap between confident peaks, checked by autocorrelation."""
    pk = _peaks(act)
    if len(pk) >= 8:
        gaps = np.diff(pk)
        med = float(np.median(gaps))
        # half-tempo peak picking leaves gaps of ~2x; keep the shortest common gap
        short = gaps[gaps < med * 1.4]
        if len(short) >= len(gaps) * 0.3:
            med = float(np.median(short))
        return med
    a = act - act.mean()
    ac = np.correlate(a, a, mode="full")[len(a) - 1:]
    lo, hi = int(FPS * 60 / 200), int(FPS * 60 / 50)
    return float(lo + np.argmax(ac[lo:hi]))


def _track(act: np.ndarray, period: float, tightness: float = 40.0) -> np.ndarray:
    n = len(act)
    score = act.astype(np.float64).copy()
    back = np.full(n, -1, dtype=np.int64)
    lo_k, hi_k = 0.6 * period, 1.6 * period
    for t in range(n):
        lo = int(t - round(hi_k))
        hi = int(t - round(lo_k))
        if hi <= 0:
            continue
        lo = max(0, lo)
        taus = np.arange(lo, hi)
        cand = score[taus] - tightness * np.log((t - taus) / period) ** 2
        k = int(np.argmax(cand))
        if cand[k] > 0:
            score[t] = act[t] + cand[k]
            back[t] = taus[k]
    # best end within the last period
    tail = max(0, n - int(round(period * 1.2)))
    t = tail + int(np.argmax(score[tail:]))
    path = [t]
    while back[t] >= 0:
        t = int(back[t])
        path.append(t)
    beats = np.array(path[::-1], dtype=np.float64)
    # sub-frame refinement: parabolic peak of the activation
    out = []
    for b in beats.astype(int):
        if 0 < b < n - 1:
            y0, y1, y2 = act[b - 1], act[b], act[b + 1]
            den = y0 - 2 * y1 + y2
            out.append(b + (0.5 * (y0 - y2) / den if den < 0 else 0.0))
        else:
            out.append(float(b))
    return np.array(out) / FPS


def _bar_positions(down: np.ndarray, meter: int) -> tuple[np.ndarray, float]:
    """Viterbi over position-in-bar from per-beat downbeat probabilities. Returns (positions, score)."""
    n = len(down)
    if n == 0:
        return np.zeros(0, dtype=int), 0.0
    eps = 1e-3
    e_down = np.log(down + eps)
    e_up = np.log(1 - down + eps)
    trans = np.full((meter, meter), -1e9)
    for p in range(meter):
        trans[p, (p + 1) % meter] = np.log(0.97)
        if (p + 1) % meter != 0:
            trans[p, 0] = np.log(0.025)  # a bar cut short (pickup, odd bar)
    emit = lambda i: np.where(np.arange(meter) == 0, e_down[i], e_up[i])  # noqa: E731
    score = emit(0) + np.log(1.0 / meter)
    back = np.zeros((n, meter), dtype=int)
    for i in range(1, n):
        cand = score[:, None] + trans
        back[i] = np.argmax(cand, axis=0)
        score = cand[back[i], np.arange(meter)] + emit(i)
    pos = np.zeros(n, dtype=int)
    pos[-1] = int(np.argmax(score))
    best = float(np.max(score))
    for i in range(n - 1, 0, -1):
        pos[i - 1] = back[i, pos[i]]
    return pos, best


def track(y: np.ndarray, sr: int, duration: float, device: str) -> dict:
    mono = y.mean(axis=1) if y.ndim == 2 else y
    beat_logits, down_logits = _get(device)(mono, sr)
    act = _sigmoid(beat_logits.cpu().numpy())
    dact = _sigmoid(down_logits.cpu().numpy())

    if act.max() < 0.2 or len(act) < FPS * 4:
        # no rhythm to speak of (ambient, rubato speech): a neutral 100 bpm grid
        beats = np.arange(0.0, duration + 0.6, 0.6)
        down = np.zeros(len(beats))
        down[::4] = 1
    else:
        period = _period(act)
        beats = _track(act, period)
        beats = beats[(beats >= 0) & (beats <= duration)]
        idx = np.clip(np.round(beats * FPS).astype(int), 0, len(dact) - 1)
        down = np.array([dact[max(0, i - 2):i + 3].max() for i in idx])

    # 4/4 unless 3/4 explains the downbeats clearly better
    pos4, s4 = _bar_positions(down, 4)
    pos3, s3 = _bar_positions(down, 3)
    meter, pos = (3, pos3) if s3 > s4 + 0.05 * len(beats) else (4, pos4)

    # extend the grid over the whole file so every note maps onto a beat
    ib = np.diff(beats)
    step_start = float(np.median(ib[:8])) if len(ib) else 0.5
    step_end = float(np.median(ib[-8:])) if len(ib) else 0.5
    pre, pre_pos = [], []
    t, p = beats[0], int(pos[0])
    while t > 0:
        t -= step_start
        p = (p - 1) % meter
        pre.append(t)
        pre_pos.append(p)
    post, post_pos = [], []
    t, p = beats[-1], int(pos[-1])
    while t < duration:
        t += step_end
        p = (p + 1) % meter
        post.append(t)
        post_pos.append(p)
    all_beats = np.concatenate([np.array(pre[::-1]), beats, np.array(post)])
    all_pos = np.concatenate([np.array(pre_pos[::-1], dtype=int), pos, np.array(post_pos, dtype=int)])

    tempo = 60.0 / float(np.median(ib)) if len(ib) else 100.0
    return {
        "beats": [round(float(b), 4) for b in all_beats],
        "barPos": [int(p) for p in all_pos],
        "downbeats": [round(float(b), 4) for b, p in zip(all_beats, all_pos) if p == 0],
        "timeSig": int(meter),
        "tempo": round(tempo, 2),
    }
