"""Key and chord recognition from transcribed notes, one decision per beat, smoothed with Viterbi."""
import numpy as np

SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# interval -> weight; suffix used in the chord name
QUALITIES: dict[str, tuple[dict[int, float], str]] = {
    "maj": ({0: 1.0, 4: 1.0, 7: 0.8}, ""),
    "min": ({0: 1.0, 3: 1.0, 7: 0.8}, "m"),
    "7": ({0: 1.0, 4: 0.95, 7: 0.6, 10: 0.9}, "7"),
    "m7": ({0: 1.0, 3: 0.95, 7: 0.6, 10: 0.9}, "m7"),
    "maj7": ({0: 1.0, 4: 0.95, 7: 0.6, 11: 0.9}, "maj7"),
    "dim": ({0: 1.0, 3: 1.0, 6: 1.0}, "dim"),
    "dim7": ({0: 1.0, 3: 1.0, 6: 1.0, 9: 1.0}, "dim7"),
    "m7b5": ({0: 1.0, 3: 1.0, 6: 0.9, 10: 0.9}, "m7b5"),
    "sus4": ({0: 1.0, 5: 1.0, 7: 0.8}, "sus4"),
    "sus2": ({0: 1.0, 2: 1.0, 7: 0.8}, "sus2"),
    "aug": ({0: 1.0, 4: 1.0, 8: 1.0}, "aug"),
}
# Simple triads unless the extra note is really there.
PRIOR = {"maj": 0.0, "min": 0.0, "7": -0.025, "m7": -0.045, "maj7": -0.05,
         "dim": -0.09, "dim7": -0.06, "m7b5": -0.08, "sus4": -0.1, "sus2": -0.11, "aug": -0.12}

KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

DECAY = 0.8  # seconds: how fast a held note fades from the chord evidence
ONSET_BONUS = 1.8

FLAT_MAJOR_KEYS = {5, 10, 3, 8, 1, 6}  # F Bb Eb Ab Db Gb
FLAT_MINOR_KEYS = {2, 7, 0, 5, 10, 3}  # Dm Gm Cm Fm Bbm Ebm


def uses_flats(tonic: int, mode: str) -> bool:
    return tonic in (FLAT_MAJOR_KEYS if mode == "major" else FLAT_MINOR_KEYS)


def pc_name(pc: int, flats: bool) -> str:
    return (FLAT if flats else SHARP)[pc % 12]


def key_profile_scores(notes: list[tuple], extra: list[tuple] | None = None) -> dict[tuple[int, str], float]:
    """Krumhansl-Kessler correlation of a duration-weighted pitch-class histogram, per key."""
    hist = np.zeros(12)
    for group, w in ((notes, 1.0), (extra or [], 1.5)):
        for p, s, e, v in group:
            hist[p % 12] += w * min(max(e - s, 0.05), 2.0) * (0.5 + v / 254)
    out: dict[tuple[int, str], float] = {}
    for tonic in range(12):
        for mode, prof in (("major", KK_MAJOR), ("minor", KK_MINOR)):
            out[(tonic, mode)] = float(np.corrcoef(hist, np.roll(prof, tonic))[0, 1]) if hist.sum() else 0.0
    return out


def _key_dict(tonic: int, mode: str, confidence: float) -> dict:
    return {
        "tonic": tonic,
        "mode": mode,
        "name": pc_name(tonic, uses_flats(tonic, mode)) + ("m" if mode == "minor" else ""),
        "confidence": round(float(confidence), 3),
    }


def detect_key(notes: list[tuple], extra: list[tuple] | None = None) -> dict:
    scores = sorted(((v, k) for k, v in key_profile_scores(notes, extra).items()), reverse=True)
    (r, (tonic, mode)), (r2, _) = scores[0], scores[1]
    return _key_dict(tonic, mode, r - r2)


def key_from_chords(chords: list[dict], notes: list[tuple], extra: list[tuple] | None = None) -> dict:
    """Pitch statistics alone confuse relative keys (Em vs G vs Bm share notes); the chord chart
    decides: chords that belong to the key, time spent on its tonic chord, and how the song
    starts and ends (pop songs nearly always open or close on the tonic)."""
    prof = key_profile_scores(notes, extra)
    segs = [c for c in chords if c.get("root") is not None]
    if not segs:
        return detect_key(notes, extra)
    total = sum(c["e"] - c["s"] for c in segs) or 1.0
    # opening and closing chords, skipping passing blips under a beat and a half
    long_segs = [c for c in segs if c["e"] - c["s"] >= 0.9] or segs
    first, last = long_segs[0], long_segs[-1]
    same_ends = first["root"] == last["root"] and (first["q"] in ("min", "m7")) == (last["q"] in ("min", "m7"))
    best: tuple[float, int, str] | None = None
    ranking = []
    for (tonic, mode), r in prof.items():
        dia = diatonic_roots(tonic, mode)
        tonic_q = {"min", "m7"} if mode == "minor" else {"maj", "maj7"}
        fit = 0.0
        for c in segs:
            d = c["e"] - c["s"]
            root, q = c["root"], c["q"]
            family = "min" if q in ("min", "m7") else "dim" if q in ("dim", "dim7", "m7b5") else "maj"
            allowed = {("min" if x in ("min", "m7") else "dim" if x in ("dim", "dim7", "m7b5") else "maj") for x in dia.get(root, set())}
            if family in allowed:
                fit += d * (1.25 if root == tonic and q in tonic_q else 1.0)
            elif family == "maj" and any((root - r2) % 12 == 7 for r2 in dia):
                fit += d * 0.5  # secondary dominant
        score = 0.4 * r + fit / total
        opens = first["root"] == tonic and first["q"] in tonic_q
        closes = last["root"] == tonic and last["q"] in tonic_q
        if opens and closes and same_ends:
            score += 0.5  # starts and ends on it: that is home
        else:
            score += 0.2 * opens + 0.2 * closes
        ranking.append((score, tonic, mode))
    ranking.sort(reverse=True)
    s1, tonic, mode = ranking[0]
    return _key_dict(tonic, mode, s1 - ranking[1][0])


def diatonic_roots(tonic: int, mode: str) -> dict[int, set[str]]:
    """Chords that belong to the key (natural + harmonic minor dominant)."""
    if mode == "major":
        steps = [(0, {"maj", "maj7"}), (2, {"min", "m7"}), (4, {"min", "m7"}), (5, {"maj", "maj7"}),
                 (7, {"maj", "7"}), (9, {"min", "m7"}), (11, {"dim", "m7b5"})]
    else:
        steps = [(0, {"min", "m7"}), (2, {"dim", "m7b5"}), (3, {"maj", "maj7"}), (5, {"min", "m7"}),
                 (7, {"min", "maj", "7"}), (8, {"maj", "maj7"}), (10, {"maj", "7"}), (11, {"dim", "dim7"})]
    return {(tonic + i) % 12: q for i, q in steps}


def _pedal_end(t: float, pedals: list[tuple]) -> float:
    for ps, pe in pedals:
        if ps <= t <= pe:
            return pe
    return t


def beat_features(notes, pedals, beats, melody=None):
    """Per beat: chroma (12), bass chroma (12) and total energy."""
    n = len(beats) - 1
    chroma = np.zeros((n, 12))
    bass = np.zeros((n, 12))
    energy = np.zeros(n)
    starts = np.array(beats[:-1])
    ends = np.array(beats[1:])

    def add(group, weight):
        for p, s, e, v in group:
            eff_end = max(e, s + 0.06)
            pe = _pedal_end(e, pedals)
            if pe > eff_end:
                eff_end = min(pe, s + 4.0)
            i0 = max(0, int(np.searchsorted(ends, s, side="right")))
            i1 = min(n, int(np.searchsorted(starts, eff_end, side="left")))
            reg = 0.5 if p < 36 else (0.6 if p > 96 else 1.0)
            vel = 0.35 + 0.65 * (v / 127.0)
            for i in range(i0, i1):
                a, b = starts[i], ends[i]
                ov = min(eff_end, b) - max(s, a)
                if ov <= 0:
                    continue
                age = max(s, a) - s
                w = weight * reg * vel * (ov / (b - a)) * np.exp(-age / DECAY)
                if a <= s < b:
                    w *= ONSET_BONUS
                chroma[i, p % 12] += w
                energy[i] += w

    add(notes, 1.0)
    if melody:
        add(melody, 0.35)

    # Bass: the lowest note that really sounds through the beat.
    for i in range(n):
        a, b = starts[i], ends[i]
        best = None
        for p, s, e, v in notes:
            if s >= b:
                continue
            eff_end = max(e, min(_pedal_end(e, pedals), s + 3.0))
            ov = min(eff_end, b) - max(s, a)
            if ov > 0.3 * (b - a) and p < 60 and (best is None or p < best):
                best = p
        if best is not None:
            bass[i, best % 12] = 1.0
    return chroma, bass, energy


def recognize(notes, pedals, beats, bar_pos, meter, melody=None, key=None) -> list[dict]:
    if len(beats) < 2:
        return []
    chroma, bass, energy = beat_features(notes, pedals, beats, melody)
    n = len(chroma)
    key = key or detect_key(notes, melody)
    diatonic = diatonic_roots(key["tonic"], key["mode"])

    labels = [(r, q) for r in range(12) for q in QUALITIES]
    templates = np.zeros((len(labels), 12))
    bass_w = np.zeros((len(labels), 12))
    prior = np.zeros(len(labels))
    for k, (r, q) in enumerate(labels):
        iv, _ = QUALITIES[q]
        for i, w in iv.items():
            templates[k, (r + i) % 12] = w
        templates[k] /= np.linalg.norm(templates[k])
        bass_w[k, r] = 1.0
        for i in iv:
            if i in (3, 4):
                bass_w[k, (r + i) % 12] = max(bass_w[k, (r + i) % 12], 0.45)
            elif i == 7:
                bass_w[k, (r + i) % 12] = max(bass_w[k, (r + i) % 12], 0.5)
            elif i in (10, 11):
                bass_w[k, (r + i) % 12] = max(bass_w[k, (r + i) % 12], 0.3)
        prior[k] = PRIOR[q] + (0.035 if q in diatonic.get(r, set()) else 0.0)

    norm = np.linalg.norm(chroma, axis=1, keepdims=True)
    cn = np.divide(chroma, norm, out=np.zeros_like(chroma), where=norm > 0)
    cos = cn @ templates.T  # (n, labels)
    has_bass = bass.sum(axis=1) > 0
    bass_score = np.where(has_bass[:, None], bass @ bass_w.T * 0.22 - 0.06, 0.0)
    emit = (cos + bass_score + prior[None, :]) * 10.0

    # "No chord" state for silent beats.
    quiet = energy < max(1e-6, 0.04 * np.percentile(energy, 90))
    emit_n = np.where(quiet, 9.0, -5.0)
    emit = np.concatenate([emit, emit_n[:, None]], axis=1)
    L = emit.shape[1]

    def change_cost(i: int) -> float:
        pos = bar_pos[i] if i < len(bar_pos) else 0
        if pos == 0:
            return 1.1
        if meter == 4 and pos == 2:
            return 2.0
        return 3.4

    score = emit[0].copy()
    back = np.zeros((n, L), dtype=np.int32)
    for i in range(1, n):
        c = change_cost(i)
        best_prev = int(np.argmax(score))
        stay = score
        switch = score[best_prev] - c
        take_switch = switch > stay
        back[i] = np.where(take_switch, best_prev, np.arange(L))
        score = np.where(take_switch, switch, stay) + emit[i]
    path = np.zeros(n, dtype=np.int32)
    path[-1] = int(np.argmax(score))
    for i in range(n - 1, 0, -1):
        path[i - 1] = back[i, path[i]]

    raw: list[list[int]] = []  # [first beat, last beat, label]
    i = 0
    while i < n:
        j = i
        while j + 1 < n and path[j + 1] == path[i]:
            j += 1
        raw.append([i, j, int(path[i])])
        i = j + 1

    # Short colour chords (sus, aug, dim) and one-beat chords outside the key are mostly passing
    # notes over the real harmony: fold them into a neighbour that shares two notes with them.
    def pcs_of(lab: int) -> set[int]:
        r, q = labels[lab]
        return {(r + i) % 12 for i in QUALITIES[q][0]}

    k = 0
    while k < len(raw):
        i, j, lab = raw[k]
        if lab >= len(labels):
            k += 1
            continue
        r, q = labels[lab]
        beats_long = j - i + 1
        outside = q not in diatonic.get(r, set()) and not (q == "7" and any((r - x) % 12 == 7 for x in diatonic))
        passing = (q in ("sus4", "sus2", "aug") and beats_long <= 2) or (outside and beats_long <= 1)
        if passing:
            here = pcs_of(lab)
            prev = raw[k - 1] if k > 0 and raw[k - 1][2] < len(labels) else None
            nxt = raw[k + 1] if k + 1 < len(raw) and raw[k + 1][2] < len(labels) else None
            if beats_long <= 1 and (prev or nxt):
                # a single beat of an odd chord is a passing harmony: it belongs to its neighbour
                if prev:
                    prev[1] = j
                else:
                    nxt[0] = i
                raw.pop(k)
                continue
            if prev and len(here & pcs_of(prev[2])) >= 2:
                prev[1] = j
                raw.pop(k)
                continue
            if nxt and len(here & pcs_of(nxt[2])) >= 2:
                nxt[0] = i
                raw.pop(k)
                continue
        k += 1
    # neighbours that became the same chord join up
    merged: list[list[int]] = []
    for seg in raw:
        if merged and merged[-1][2] == seg[2]:
            merged[-1][1] = seg[1]
        else:
            merged.append(seg)
    raw = merged

    # A major chord that resolves down a fifth is a dominant: call it a 7th when the
    # seventh is audible at all (E -> Am becomes E7 -> Am, A -> Dm becomes A7 -> Dm).
    idx = {lab: k for k, lab in enumerate(labels)}
    for a, b in zip(raw, raw[1:]):
        if a[2] >= len(labels) or b[2] >= len(labels):
            continue
        r, q = labels[a[2]]
        r2, _ = labels[b[2]]
        if q == "maj" and (r - r2) % 12 == 7:
            seg_chroma = chroma[a[0]:a[1] + 1].sum(axis=0)
            if seg_chroma.max() > 0 and seg_chroma[(r + 10) % 12] >= 0.16 * seg_chroma.max():
                a[2] = idx[(r, "7")]

    flats = uses_flats(key["tonic"], key["mode"])
    out: list[dict] = []
    for i, j, k in raw:
        seg = {"s": round(float(beats[i]), 4), "e": round(float(beats[j + 1]), 4)}
        if k == len(labels):
            seg.update({"root": None, "q": "N", "name": "N", "bass": None})
        else:
            r, q = labels[k]
            # Slash chord when one non-root chord tone holds the bass through the segment.
            bsum = bass[i:j + 1].sum(axis=0)
            bass_pc = r
            if bsum.sum() >= 2:
                top = int(np.argmax(bsum))
                if top != r and bsum[top] >= 0.7 * bsum.sum() and (top - r) % 12 in QUALITIES[q][0]:
                    bass_pc = top
            name = pc_name(r, flats) + QUALITIES[q][1]
            if bass_pc != r:
                name += "/" + pc_name(bass_pc, flats)
            conf = float(np.mean(cos[i:j + 1, k]))
            seg.update({"root": r, "q": q, "name": name, "bass": bass_pc, "conf": round(conf, 3)})
        out.append(seg)
    return out
