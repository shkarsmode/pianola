"""The tune: sung melody from the vocal stem, or the top voice of a transcription.

Vocal path (what a transcriber does by ear):
  1. RMVPE frame pitch of the vocal stem, corrected by the singer's own tuning.
  2. Syllables: voiced stretches split at voicing gaps and consonant dips in loudness.
  3. Notes: one per syllable at the syllable onset; a second note inside a syllable only
     where a new pitch is held (melisma). Scoops into a note, falls out of it and short
     neighbour ornaments belong to the note they lead to or trail from.
  4. Pitch: the float pitch decides, the key and the chord sounding there break ties
     and pull short, unstable or out-of-key notes; long, steady notes keep what was sung.
  5. Rhythm: rhythm.place_notes() puts onsets on the song's grid (straight or triplet).
"""
import numpy as np
from scipy.ndimage import maximum_filter1d, median_filter, minimum_filter1d, uniform_filter1d

from .audio import to_mono

HOP_S = 0.01  # pitch frame hop, seconds
_SR = 16000

VOICED_CONF = 0.5     # RMVPE peak salience above which a frame is sung
PLATEAU_RANGE = 0.5   # semitones: pitch range over 70 ms that still counts as "held"
SAME_NOTE = 0.6       # semitones: plateaus closer than this are one note (drift, vibrato)
MIN_PLATEAU = 5       # frames (50 ms): shorter holds are glide inflections
LEAD_MIN_BEATS = 0.25  # a held pitch before the main one is a scoop unless this long


# --------------------------------------------------------------------------- frames

def _loudness(audio: np.ndarray, n: int, hop: int = 160, win: int = 480) -> np.ndarray:
    """Loudness in dB per 10 ms frame (30 ms window centred like the pitch frames)."""
    import librosa

    pad = np.pad(audio, (win // 2, win // 2))
    fr = librosa.util.frame(pad, frame_length=win, hop_length=hop)
    db = 10 * np.log10(np.mean(fr.astype(np.float64) ** 2, axis=0) + 1e-10)
    if len(db) < n:
        db = np.pad(db, (0, n - len(db)), constant_values=-100.0)
    return db[:n]


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Half-open index ranges where mask is True."""
    m = np.concatenate([[False], mask.astype(bool), [False]])
    d = np.diff(m.astype(np.int8))
    return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))


def _tuning(midi: np.ndarray, voiced: np.ndarray, conf: np.ndarray) -> float:
    """The singer's own reference pitch: circular mean deviation over steady frames."""
    sm = median_filter(midi, 5)
    steady = voiced & (np.abs(np.gradient(sm)) < 0.04)
    if steady.sum() < 50:
        steady = voiced
    if steady.sum() < 20:
        return 0.0
    dev = midi[steady] - np.round(midi[steady])
    return float(np.angle(np.sum(conf[steady] * np.exp(2j * np.pi * dev))) / (2 * np.pi))


def _local_ref(loud: np.ndarray, good: np.ndarray, fallback: float, block: int = 100, half: int = 6) -> np.ndarray:
    """Per frame: how loud the singing nearby is (loudest 1-s block level within +-6 s), so a
    soft verse is judged against itself, not against a belted chorus."""
    n = len(loud)
    nb = (n + block - 1) // block
    lvl = np.full(nb, np.nan)
    for k in range(nb):
        seg, g = loud[k * block:(k + 1) * block], good[k * block:(k + 1) * block]
        if g.sum() >= 10:
            lvl[k] = np.percentile(seg[g], 90)
    out = np.full(nb, fallback)
    for k in range(nb):
        w = lvl[max(0, k - half):k + half + 1]
        if np.isfinite(w).any():
            out[k] = np.nanmax(w)
    return np.repeat(np.minimum(out, fallback), block)[:n]


def vocal_pitch(vocals: np.ndarray, device: str) -> dict | None:
    """Frame-level description of the vocal stem: pitch (tuning-corrected midi), confidence,
    loudness, voicing, and the syllables found in it."""
    from . import rmvpe

    audio = to_mono(vocals, _SR)
    if np.max(np.abs(audio)) < 1e-4:
        return None
    midi, conf = rmvpe.decode(rmvpe.salience(audio, device))
    n = len(midi)
    loud = _loudness(audio, n)
    good = conf > VOICED_CONF
    loud_ref = float(np.percentile(loud[good], 90)) if good.sum() > 50 else float(np.percentile(loud, 95))
    voiced = good & (loud > loud_ref - 30) & (midi > 30) & (midi < 90)
    voiced[1:-1] |= voiced[:-2] & voiced[2:]  # a single dropped frame inside a vowel
    tuning = _tuning(midi, voiced, conf)
    vp = {"midi": midi - tuning, "conf": conf, "loud": loud, "loud_ref": loud_ref,
          "loud_local": _local_ref(loud, voiced, loud_ref), "voiced": voiced, "tuning": tuning}
    vp["syllables"] = syllables(vp)
    vp["onsets"] = np.array([o * HOP_S for _, o, _ in vp["syllables"]])
    return vp


# --------------------------------------------------------------------------- syllables

def syllables(vp: dict) -> list[tuple[int, int, int]]:
    """(start, onset, end) frames of each sung syllable.

    A syllable ends where the voice stops (pause, unvoiced consonant) or where loudness
    dips for a voiced consonant between two vowels. `onset` is the perceived attack: the
    point where the vowel's loudness has risen, which is what a singer puts on the beat.
    """
    midi, conf, voiced = vp["midi"], vp["conf"], vp["voiced"]
    L = uniform_filter1d(vp["loud"], 3)
    # quieter than this (against the singing nearby) is breath, bleed or a fading tail
    floor = np.maximum(vp["loud_local"] - 15.0, vp["loud_ref"] - 28.0)
    out = []
    for a, b in _runs(voiced):
        if b - a < 4:
            continue
        cuts = _dips(L, conf, midi, a, b)
        bounds = [a] + cuts + [b]
        for k, (s, e) in enumerate(zip(bounds[:-1], bounds[1:])):
            if e - s < 4 or L[s:e].max() < floor[s]:
                continue
            seg = L[s:min(e, s + 15)]
            peak = seg.max()
            thr = max(peak - 6.0, (L[s] + peak) / 2) if k > 0 else peak - 6.0
            o = s + int(np.argmax(seg >= thr))
            if k == 0:
                # an unvoiced consonant before the vowel (s, t, k...) is part of the attack:
                # the beat falls between where it starts and where the vowel sounds
                c = s
                while c > max(0, s - 12) and L[c - 1] >= peak - 15.0 and not voiced[c - 1]:
                    c -= 1
                o = (c + o) // 2 if c < s else o
            out.append((s, o, e))
    return out


def _dips(L: np.ndarray, conf: np.ndarray, midi: np.ndarray, a: int, b: int, win: int = 12) -> list[int]:
    """Consonant dips inside one voiced stretch: loudness minima deep enough on both sides,
    or shallower ones where the voice also roughens or the pitch moves on."""
    cands = []
    for t in range(a + 3, b - 3):
        if not (L[t] <= L[t - 1] and L[t] < L[t + 1]):
            continue
        left = L[max(a, t - win):t].max()
        right = L[t + 1:min(b, t + win + 1)].max()
        depth = min(left, right) - L[t]
        if depth < 2.0:
            continue
        roughness = conf[max(a, t - 2):t + 3].min()
        pre = midi[max(a, t - 9):t - 2]
        post = midi[t + 3:min(b, t + 10)]
        jump = abs(float(np.median(post)) - float(np.median(pre))) if len(pre) >= 3 and len(post) >= 3 else 0.0
        if right < left - 6.0 and jump < 0.8:
            continue  # the same note fading out unevenly, not a new syllable
        if depth >= 3.5 or roughness < 0.7 or jump >= 0.8:
            cands.append((depth + 2.0 * (jump >= 0.8) + 2.0 * (roughness < 0.7), t))
    cuts: list[int] = []
    for score, t in sorted(cands, reverse=True):  # strongest first, 70 ms apart
        if all(abs(t - c) >= 7 for c in cuts):
            cuts.append(t)
    return sorted(cuts)


# --------------------------------------------------------------------------- notes

def _plateaus(x: np.ndarray, ok: np.ndarray, smooth: int) -> list[list]:
    """[start, end, level] runs where the (smoothed) pitch is held within PLATEAU_RANGE."""
    ps = median_filter(x, smooth, mode="nearest")
    span = 7 if smooth <= 5 else smooth
    rng = maximum_filter1d(ps, span, mode="nearest") - minimum_filter1d(ps, span, mode="nearest")
    stable = (rng < PLATEAU_RANGE) & ok
    plats = [[s, e, float(np.median(x[s:e]))] for s, e in _runs(stable) if e - s >= MIN_PLATEAU]
    merged: list[list] = []
    for p in plats:  # drift and vibrato: neighbours at the same pitch are one hold
        if merged and abs(p[2] - merged[-1][2]) < SAME_NOTE and p[0] - merged[-1][1] <= 15:
            q = merged[-1]
            q[1] = p[1]
            sel = ok[q[0]:q[1]]
            q[2] = float(np.median(x[q[0]:q[1]][sel])) if sel.any() else q[2]
        else:
            merged.append(p)
    return merged


def _dwell_pitch(x: np.ndarray, w: np.ndarray, bw: float = 0.25) -> float:
    """Where the voice spends its time: the loudness-weighted mode of the pitch values.
    A scoop rushes through the pitches below its target, an overshoot returns to it."""
    if len(x) == 0:
        return float("nan")
    if len(x) < 3:
        return float(np.median(x))
    grid = np.arange(x.min() - 0.3, x.max() + 0.3, 0.05)
    dens = (w[None, :] * np.exp(-0.5 * ((grid[:, None] - x[None, :]) / bw) ** 2)).sum(axis=1)
    m = float(grid[int(np.argmax(dens))])
    near = np.abs(x - m) < 0.35
    return float(np.average(x[near], weights=w[near])) if near.any() else m


def syllable_notes(vp: dict, syl: tuple[int, int, int], beat_frames: float) -> list[dict]:
    """Notes of one syllable: {"s", "e" (frames), "pitch" (float), "held" (frames held)}."""
    s, o, e = syl
    a = max(s, o - 1)
    x = vp["midi"][a:e]
    ok = vp["conf"][a:e] > 0.4
    if ok.sum() < 3:
        return []
    loud = vp["loud"][a:e]
    peak = float(loud[ok].max())
    w = vp["conf"][a:e] * 10 ** ((loud - peak) / 20)
    # the release: trailing frames far below the syllable's peak do not carry its pitch
    body = np.flatnonzero(ok & (loud >= peak - 8))
    vend = int(body[-1]) + 1 if len(body) else len(x)
    xv, okv = x[:vend], ok[:vend]

    plats = _plateaus(xv, okv, 5)
    if not plats and vend >= 30:
        plats = _plateaus(xv, okv, 15)  # wide vibrato hides the hold at fine scale

    notes: list[dict] = []
    first_start = o
    if plats:
        # A loud stretch well above the first hold, before it, is a syllable of its own whose
        # consonant left no dip (a pickup gliding down into the next downbeat).
        p0 = plats[0]
        above = okv[:p0[0]] & (xv[:p0[0]] >= p0[2] + 1.5)
        if above.sum() >= 6 and loud[:p0[0]][above].max() >= np.median(loud[p0[0]:p0[1]]) - 3:
            top = _dwell_pitch(xv[:p0[0]][above], w[:p0[0]][above])
            mid = (top + p0[2]) / 2
            j = p0[0]
            while j > 0 and not (xv[j - 1] >= mid and okv[j - 1]):
                j -= 1
            notes.append({"s": o, "e": a + j, "pitch": top, "held": 0})
            first_start = a + j

    lead_min = max(10.0, LEAD_MIN_BEATS * beat_frames)
    # A short hold on the way up to the main pitch is part of the scoop; falling into a
    # note from above is rarer, so only a very short hold above counts as a scoop. In a
    # run of three or more holds, a short one is a note unless the next is clearly longer.
    while len(plats) > 1:
        p, q = plats[0], plats[1]
        dur, main = p[1] - p[0], q[1] - q[0]
        rising = q[2] - p[2] >= SAME_NOTE and dur < lead_min and (len(plats) == 2 or dur < 0.6 * main)
        falling = p[2] - q[2] >= SAME_NOTE and dur < 8
        if rising or falling:
            plats.pop(0)
        else:
            break
    # a short excursion that returns to the same pitch is an ornament
    i = 1
    while i < len(plats) - 1:
        p, q, r = plats[i - 1], plats[i], plats[i + 1]
        if q[1] - q[0] < 12 and abs(p[2] - r[2]) < SAME_NOTE:
            sel = np.r_[np.arange(p[0], p[1]), np.arange(r[0], r[1])]
            plats[i - 1:i + 2] = [[p[0], r[1], float(np.median(x[sel]))]]
        else:
            i += 1
    # a short, much quieter hold at the end is the release
    if len(plats) > 1:
        p, q = plats[-2], plats[-1]
        if q[1] - q[0] < 8 and np.median(loud[q[0]:q[1]]) < np.median(loud[p[0]:p[1]]) - 6:
            plats.pop()
    # a lone short hold followed by a longer rise is where the scoop paused
    since = 0
    if len(plats) == 1 and not notes:
        p = plats[0]
        hi = okv[p[1]:] & (xv[p[1]:] >= p[2] + 1.0)
        if hi.sum() >= max(p[1] - p[0], 8):
            plats, since = [], p[1]

    if not plats:
        sel = okv.copy()
        sel[:since] = False
        if notes:
            sel[:first_start - a] = False
        if sel.sum() < 3:
            return notes
        notes.append({"s": first_start, "e": e, "pitch": _dwell_pitch(xv[sel], w[:vend][sel]), "held": 0})
        return notes

    for k, (ps, pe, lvl) in enumerate(plats):
        if k == 0:
            start = first_start
        else:
            # the new note starts where the voice finally leaves the previous pitch
            prev = plats[k - 1][2]
            j = ps
            while j > plats[k - 1][1] and abs(x[j - 1] - lvl) < abs(x[j - 1] - prev):
                j -= 1
            start = a + j
        if notes:
            notes[-1]["e"] = start
        notes.append({"s": start, "e": e, "pitch": lvl, "held": pe - ps})
    return notes


def sung_notes(vp: dict, beats: list[float]) -> list[dict]:
    """All notes of the vocal line, unquantized, with float pitch and times in seconds."""
    beat_frames = float(np.median(np.diff(beats))) / HOP_S if len(beats) > 1 else 50.0
    conf, loud = vp["conf"], vp["loud"]
    out: list[dict] = []
    for syl in vp["syllables"]:
        for nt in syllable_notes(vp, syl, beat_frames):
            if nt["e"] - nt["s"] < 4 or not np.isfinite(nt["pitch"]):
                continue
            seg = loud[nt["s"]:nt["e"]]
            nt["loud"] = float(np.median(seg))
            nt["peak"] = float(seg.max())
            nt["conf"] = float(np.median(conf[nt["s"]:nt["e"]]))
            nt["t0"], nt["t1"] = nt["s"] * HOP_S, nt["e"] * HOP_S
            # a short, soft, unsure sound is breath or bleed, not a note
            if nt["t1"] - nt["t0"] < 0.15 and nt["conf"] < 0.62 and nt["peak"] < vp["loud_local"][nt["s"]] - 6:
                continue
            prev = out[-1] if out else None
            # a short, quieter re-start at the same pitch right after a note is its tail
            if (prev is not None and nt["t1"] - nt["t0"] < 0.12 and nt["t0"] - prev["t1"] < 0.07
                    and abs(nt["pitch"] - prev["pitch"]) < 1.0 and nt["peak"] < prev["peak"] - 3):
                prev["e"], prev["t1"] = nt["e"], nt["t1"]
                continue
            out.append(nt)
    _fix_octaves(out)
    return out


def _fix_octaves(notes: list[dict]) -> None:
    """Octave slips of the pitch tracker: a short note an octave off both neighbours."""
    for k in range(1, len(notes) - 1):
        a, b, c = notes[k - 1]["pitch"], notes[k]["pitch"], notes[k + 1]["pitch"]
        for shift in (12, -12):
            if abs(b + shift - a) <= 2.5 and abs(b + shift - c) <= 2.5 and abs(b - a) >= 9.5:
                notes[k]["pitch"] = b + shift


# --------------------------------------------------------------------------- pitch

MAJOR = (0, 2, 4, 5, 7, 9, 11)
MINOR = (0, 2, 3, 5, 7, 8, 10)


def _chord_at(chords: list[dict], t: float) -> set[int]:
    from .chords import QUALITIES

    for c in chords or []:
        if c["s"] - 1e-3 <= t < c["e"] and c.get("root") is not None:
            return {(c["root"] + i) % 12 for i in QUALITIES[c["q"]][0]}
    return set()


def key_track(acc: list[tuple], draft: list[tuple], global_key: dict | None, t_end: float,
              win: float = 24.0, hop: float = 6.0) -> list[tuple[float, dict]]:
    """[(time, key)] every `hop` seconds: the song's key, unless a long stretch of it clearly
    sits in another one (a key change for the last chorus). Krumhansl-Kessler correlation on
    windows of band and tune, then a Viterbi pass where changing key is expensive."""
    from .chords import KK_MAJOR, KK_MINOR, pc_name, uses_flats

    if global_key is None:
        return []
    keys = [(t, m) for t in range(12) for m in ("major", "minor")]
    profs = np.array([np.roll(KK_MAJOR if m == "major" else KK_MINOR, t) for t, m in keys])
    profs = (profs - profs.mean(1, keepdims=True)) / profs.std(1, keepdims=True)
    centers = np.arange(0.0, max(t_end, hop) + hop, hop)
    rows = []
    for group, w in ((acc, 1.0), (draft, 1.5)):
        if group:
            g = np.asarray(group, dtype=float)
            rows.append((g[:, 0].astype(int) % 12, g[:, 1], g[:, 2], w * (0.5 + g[:, 3] / 254)))
    emit = np.zeros((len(centers), len(keys)))
    for i, c in enumerate(centers):
        h = np.zeros(12)
        for pc, s0, s1, w in rows:
            ov = np.clip(np.minimum(s1, c + win / 2) - np.maximum(s0, c - win / 2), 0, 2.0)
            np.add.at(h, pc, w * ov)
        if h.sum() > 0 and h.std() > 0:
            emit[i] = profs @ ((h - h.mean()) / h.std()) / 12.0  # correlation per key
    g_idx = keys.index((global_key["tonic"], global_key["mode"]))
    emit = 6.0 * emit
    emit[:, g_idx] += 0.4  # the song's own key needs no extra evidence
    rel = {}
    for k, (t, m) in enumerate(keys):  # relative major/minor share their notes
        other = ((t + 9) % 12, "minor") if m == "major" else ((t + 3) % 12, "major")
        rel[k] = keys.index(other)
    n, K = emit.shape
    score = emit[0].copy()
    back = np.zeros((n, K), dtype=int)
    for i in range(1, n):
        best = int(np.argmax(score))
        new = np.empty(K)
        for k in range(K):
            cands = [(score[k], k), (score[best] - 4.0, best), (score[rel[k]] - 0.3, rel[k])]
            v, j = max(cands)
            new[k], back[i, k] = v + emit[i, k], j
        score = new
    path = [int(np.argmax(score))]
    for i in range(n - 1, 0, -1):
        path.append(int(back[i, path[-1]]))
    path.reverse()
    out = []
    for c, k in zip(centers, path):
        t, m = keys[k]
        out.append((float(c), {"tonic": t, "mode": m,
                               "name": pc_name(t, uses_flats(t, m)) + ("m" if m == "minor" else "")}))
    return out


def _key_at(track: list[tuple[float, dict]], t: float, default: dict | None) -> dict | None:
    if not track:
        return default
    i = int(np.clip(round((t - track[0][0]) / max(track[1][0] - track[0][0], 1e-9) if len(track) > 1 else 0),
                    0, len(track) - 1))
    return track[i][1]


def choose_pitches(notes: list[dict], key: dict | None, chords: list[dict] | None,
                   beats: list[float], bar_pos: list[int],
                   keys: list[tuple[float, dict]] | None = None) -> list[int]:
    """Integer pitch per note from its float pitch, weighed against key and harmony.

    A long note held steady near a semitone keeps it, chromatic or not. Short, gliding or
    in-between notes lean towards the scale of the key and, on strong beats, towards the
    tones of the chord sounding there (a flat E over A7 is an E, a G/G# blur over E7 is G#).
    In minor, the raised 7th is at home over the dominant chord and suspect elsewhere.
    `keys` (from key_track) overrides `key` locally after a key change.
    """
    if not notes:
        return []
    b = np.asarray(beats)
    out = []
    for nt in notes:
        k = _key_at(keys, nt["t0"], key) if keys else key
        if k is not None:
            minor = k.get("mode") == "minor"
            scale = {(k["tonic"] + i) % 12 for i in (MINOR if minor else MAJOR)}
            leading = {(k["tonic"] + 11) % 12} if minor else set()
        else:
            scale, leading = set(range(12)), set()
        x = nt["pitch"]
        held_s = nt["held"] * HOP_S
        sigma = 0.25 if held_s >= 0.15 else (0.36 if held_s >= 0.07 else 0.45)
        tones = _chord_at(chords, nt["t0"] + 0.02)
        i = int(np.clip(np.searchsorted(b, nt["t0"] + 0.05) - 1, 0, max(0, len(b) - 2)))
        frac = (nt["t0"] - b[i]) / (b[i + 1] - b[i]) if len(b) > 1 else 0.0
        on_beat = min(frac, 1 - frac) < 0.2
        strong = on_beat and (bar_pos[i] in (0, 2) if i < len(bar_pos) else False)
        weight = 1.0 if strong else (0.6 if on_beat else 0.35)
        best, best_score = int(round(x)), -1e9
        for cand in range(int(np.floor(x - 1.2)), int(np.ceil(x + 1.2)) + 1):
            pc = cand % 12
            score = -0.5 * ((x - cand) / sigma) ** 2
            if pc in tones:
                score += 0.5 * weight
            elif pc not in scale:
                score -= 1.2 if pc in leading else 2.0
            if score > best_score:
                best, best_score = cand, score
        out.append(best)
    return out


# --------------------------------------------------------------------------- melody

def vocal_melody(vp: dict, beats: list[float], bar_pos: list[int], feel: dict,
                 acc_notes: list[tuple] | None = None) -> tuple[list[tuple], dict]:
    """Sung melody as [(midi, start_s, end_s, vel)], on the beat grid; plus debug info."""
    from .chords import detect_key, recognize
    from .rhythm import place_notes

    raw = sung_notes(vp, beats)
    if not raw:
        return [], {"key": None}
    meter = max(bar_pos) + 1 if bar_pos else 4
    vel = [int(np.clip(64 + (nt["loud"] - vp["loud_ref"]) * 2.0, 40, 112)) for nt in raw]
    draft = [(int(round(nt["pitch"])), nt["t0"], nt["t1"], v) for nt, v in zip(raw, vel)]
    acc = acc_notes or []
    key = detect_key(acc, draft) if (acc or draft) else None
    chords = recognize(acc, [], beats, bar_pos, meter, melody=draft, key=key) if acc else []
    keys = key_track(acc, draft, key, raw[-1]["t1"])
    pitches = choose_pitches(raw, key, chords, beats, bar_pos, keys)
    grid_info: dict = {}
    placed = place_notes([(nt["t0"], nt["t1"]) for nt in raw], beats, feel, info=grid_info)
    out = []
    for (s, e), p, v in zip(placed, pitches, vel):
        if s is None or not (36 <= p <= 96):
            continue
        out.append((p, round(s, 3), round(e, 3), v))
    changes = [(round(t, 1), k["name"]) for i, (t, k) in enumerate(keys) if i == 0 or k["name"] != keys[i - 1][1]["name"]]
    return out, {"key": key, "chords": chords, "raw": raw, "pitches": pitches, "grid": grid_info,
                 "keys": changes}


def top_voice(notes: list[tuple], min_pitch: int = 57) -> list[tuple]:
    """Skyline melody of a transcription: highest note of each onset group."""
    if not notes:
        return []
    ordered = sorted(notes, key=lambda n: (n[1], -n[0]))
    groups: list[list[tuple]] = []
    for n in ordered:
        if groups and n[1] - groups[-1][0][1] < 0.04:
            groups[-1].append(n)
        else:
            groups.append([n])
    mel: list[list] = []
    for g in groups:
        p, s, e, v = max(g, key=lambda n: n[0])
        if p < min_pitch:
            continue
        if mel:
            pp, ps, pe, _ = mel[-1]
            # a lower note under a melody note that is still ringing is accompaniment
            if p < pp and pe > s + 0.06 and s - ps < 1.2:
                continue
        mel.append([p, s, e, v])
    for k in range(len(mel) - 1):
        mel[k][2] = min(mel[k][2], mel[k + 1][1])
    return [(p, round(s, 3), round(e, 3), v) for p, s, e, v in mel if e - s >= 0.04]


def _is_tune(notes: list[tuple]) -> bool:
    """A hook or instrumental tune moves around; the top of strummed or stabbed chords repeats
    two or three notes. Only the former should stand in for the singer."""
    if len(notes) < 4:
        return False
    pitches = [n[0] for n in notes]
    repeats = sum(1 for a, b in zip(pitches, pitches[1:]) if a == b) / (len(pitches) - 1)
    steps = [abs(b - a) for a, b in zip(pitches, pitches[1:])]
    return len(set(pitches)) >= 4 and repeats < 0.45 and float(np.mean(steps)) >= 1.0


def fill_gaps(melody: list[tuple], backup: list[tuple], beats: list[float], meter: int) -> list[tuple]:
    """Where the singer is silent for two bars or more, borrow the band's top voice if it is a tune."""
    if not backup:
        return melody
    bar = float(np.median(np.diff(beats))) * meter if len(beats) > 1 else 2.0
    out = list(melody)
    bounds = [0.0]
    for n in melody:
        bounds += [n[1], n[2]]
    bounds.append(1e9)
    for k in range(0, len(bounds) - 1, 2):
        a, b = bounds[k], bounds[k + 1]
        if b - a >= 2 * bar:
            borrowed = [n for n in backup if a + 0.1 <= n[1] and n[2] <= b - 0.05]
            if _is_tune(borrowed):
                out.extend(borrowed)
    out.sort(key=lambda n: n[1])
    return out
