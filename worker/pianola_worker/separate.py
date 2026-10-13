"""Source separation (Demucs htdemucs) and the piano-solo / full-mix decision."""
import numpy as np
import torch

from .audio import SR

_model = None


def _get_model():
    global _model
    if _model is None:
        from demucs.pretrained import get_model

        _model = get_model("htdemucs")
        _model.eval()
    return _model


def separate(y: np.ndarray, device: str) -> dict[str, np.ndarray]:
    """y: (n, 2) float32 at 44.1 kHz -> {"drums"|"bass"|"other"|"vocals": (n, 2)}."""
    from demucs.apply import apply_model

    model = _get_model()
    wav = torch.from_numpy(np.ascontiguousarray(y.T))
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        out = apply_model(
            model, ((wav - mean) / std)[None], device=device,
            split=True, overlap=0.25, progress=False,
        )[0]
    out = out * std + mean
    stems = {name: out[i].cpu().numpy().T.astype(np.float32) for i, name in enumerate(model.sources)}
    if device == "cuda":
        torch.cuda.empty_cache()
    return stems


def shares(stems: dict[str, np.ndarray]) -> dict[str, float]:
    energy = {k: float(np.mean(v.astype(np.float64) ** 2)) for k, v in stems.items()}
    total = sum(energy.values()) or 1.0
    return {k: round(v / total, 4) for k, v in energy.items()}


def probe_shares(y: np.ndarray, device: str, excerpt_s: float = 10.0) -> dict[str, float]:
    """Separates three short excerpts to decide cheaply whether the input is a solo instrument."""
    n = y.shape[0]
    win = int(excerpt_s * SR)
    if n <= 3 * win:
        return shares(separate(y, device))
    acc: dict[str, float] = {}
    for frac in (0.25, 0.5, 0.75):
        start = int(n * frac) - win // 2
        part = separate(y[start:start + win], device)
        for k, v in part.items():
            acc[k] = acc.get(k, 0.0) + float(np.mean(v.astype(np.float64) ** 2))
    total = sum(acc.values()) or 1.0
    return {k: round(v / total, 4) for k, v in acc.items()}


def is_solo_instrument(stem_shares: dict[str, float]) -> bool:
    """No singing and no drums: a piano (or other solo instrument) recording."""
    return stem_shares.get("vocals", 0) < 0.06 and stem_shares.get("drums", 0) < 0.06
