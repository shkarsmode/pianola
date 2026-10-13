"""RMVPE vocal pitch estimator (Wei et al., 2023): robust f0 of a singing voice, even with
accompaniment bleeding through a separated stem.

Model definition adapted from RVC-Project/Retrieval-based-Voice-Conversion-WebUI,
infer/lib/rmvpe.py (MIT License, Copyright (c) 2023 liujing04 and RVC-Project contributors).
Weights: rmvpe.pt from huggingface.co/lj1995/VoiceConversionWebUI, stored in
worker/models/rmvpe/rmvpe.pt (downloaded on first use).
"""
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .config import MODELS_DIR

CKPT = MODELS_DIR / "rmvpe" / "rmvpe.pt"
SR = 16000
HOP = 160  # 10 ms
N_MELS = 128


class _ConvBlockRes(nn.Module):
    def __init__(self, cin: int, cout: int, momentum: float = 0.01):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(cin, cout, 3, 1, 1, bias=False), nn.BatchNorm2d(cout, momentum=momentum), nn.ReLU(),
            nn.Conv2d(cout, cout, 3, 1, 1, bias=False), nn.BatchNorm2d(cout, momentum=momentum), nn.ReLU(),
        )
        self.is_shortcut = cin != cout
        if self.is_shortcut:
            self.shortcut = nn.Conv2d(cin, cout, 1)

    def forward(self, x):
        return self.conv(x) + (self.shortcut(x) if self.is_shortcut else x)


class _ResEncoderBlock(nn.Module):
    def __init__(self, cin, cout, kernel_size, n_blocks=1, momentum=0.01):
        super().__init__()
        self.conv = nn.ModuleList([_ConvBlockRes(cin, cout, momentum)]
                                  + [_ConvBlockRes(cout, cout, momentum) for _ in range(n_blocks - 1)])
        self.kernel_size = kernel_size
        if kernel_size is not None:
            self.pool = nn.AvgPool2d(kernel_size=kernel_size)

    def forward(self, x):
        for c in self.conv:
            x = c(x)
        if self.kernel_size is not None:
            return x, self.pool(x)
        return x


class _Encoder(nn.Module):
    def __init__(self, cin, in_size, n_encoders, kernel_size, n_blocks, cout=16, momentum=0.01):
        super().__init__()
        self.bn = nn.BatchNorm2d(cin, momentum=momentum)
        self.layers = nn.ModuleList()
        for _ in range(n_encoders):
            self.layers.append(_ResEncoderBlock(cin, cout, kernel_size, n_blocks, momentum))
            cin, cout, in_size = cout, cout * 2, in_size // 2
        self.out_channel = cout

    def forward(self, x):
        skips = []
        x = self.bn(x)
        for layer in self.layers:
            s, x = layer(x)
            skips.append(s)
        return x, skips


class _Intermediate(nn.Module):
    def __init__(self, cin, cout, n_inters, n_blocks, momentum=0.01):
        super().__init__()
        self.layers = nn.ModuleList([_ResEncoderBlock(cin, cout, None, n_blocks, momentum)]
                                    + [_ResEncoderBlock(cout, cout, None, n_blocks, momentum)
                                       for _ in range(n_inters - 1)])

    def forward(self, x):
        for layer in self.layers:
            x = layer(x)
        return x


class _ResDecoderBlock(nn.Module):
    def __init__(self, cin, cout, stride, n_blocks=1, momentum=0.01):
        super().__init__()
        out_padding = (0, 1) if stride == (1, 2) else (1, 1)
        self.conv1 = nn.Sequential(
            nn.ConvTranspose2d(cin, cout, 3, stride, 1, output_padding=out_padding, bias=False),
            nn.BatchNorm2d(cout, momentum=momentum), nn.ReLU(),
        )
        self.conv2 = nn.ModuleList([_ConvBlockRes(cout * 2, cout, momentum)]
                                   + [_ConvBlockRes(cout, cout, momentum) for _ in range(n_blocks - 1)])

    def forward(self, x, skip):
        x = torch.cat((self.conv1(x), skip), dim=1)
        for c in self.conv2:
            x = c(x)
        return x


class _Decoder(nn.Module):
    def __init__(self, cin, n_decoders, stride, n_blocks, momentum=0.01):
        super().__init__()
        self.layers = nn.ModuleList()
        for _ in range(n_decoders):
            self.layers.append(_ResDecoderBlock(cin, cin // 2, stride, n_blocks, momentum))
            cin //= 2

    def forward(self, x, skips):
        for i, layer in enumerate(self.layers):
            x = layer(x, skips[-1 - i])
        return x


class _DeepUnet(nn.Module):
    def __init__(self, kernel_size, n_blocks, en_de_layers=5, inter_layers=4, cin=1, en_out=16):
        super().__init__()
        self.encoder = _Encoder(cin, N_MELS, en_de_layers, kernel_size, n_blocks, en_out)
        self.intermediate = _Intermediate(self.encoder.out_channel // 2, self.encoder.out_channel,
                                          inter_layers, n_blocks)
        self.decoder = _Decoder(self.encoder.out_channel, en_de_layers, kernel_size, n_blocks)

    def forward(self, x):
        x, skips = self.encoder(x)
        return self.decoder(self.intermediate(x), skips)


class _BiGRU(nn.Module):
    def __init__(self, nin, hidden, layers):
        super().__init__()
        self.gru = nn.GRU(nin, hidden, num_layers=layers, batch_first=True, bidirectional=True)

    def forward(self, x):
        return self.gru(x)[0]


class _E2E(nn.Module):
    def __init__(self, n_blocks=4, n_gru=1, kernel_size=(2, 2)):
        super().__init__()
        self.unet = _DeepUnet(kernel_size, n_blocks)
        self.cnn = nn.Conv2d(16, 3, 3, padding=1)
        self.fc = nn.Sequential(_BiGRU(3 * N_MELS, 256, n_gru), nn.Linear(512, 360), nn.Dropout(0.25), nn.Sigmoid())

    def forward(self, mel):  # mel: (B, 128, T)
        x = mel.transpose(-1, -2).unsqueeze(1)
        x = self.cnn(self.unet(x)).transpose(1, 2).flatten(-2)
        return self.fc(x)


_model = None
_mel_basis = None


def _ensure_ckpt() -> Path:
    if not CKPT.exists():
        from huggingface_hub import hf_hub_download

        CKPT.parent.mkdir(parents=True, exist_ok=True)
        hf_hub_download("lj1995/VoiceConversionWebUI", "rmvpe.pt", local_dir=str(CKPT.parent))
    return CKPT


def _get(device: str):
    global _model, _mel_basis
    if _model is None:
        import librosa

        m = _E2E()
        m.load_state_dict(torch.load(_ensure_ckpt(), map_location="cpu", weights_only=True))
        m.eval()
        _model = m.to(device)
        basis = librosa.filters.mel(sr=SR, n_fft=1024, n_mels=N_MELS, fmin=30, fmax=8000, htk=True)
        _mel_basis = torch.from_numpy(basis).float().to(device)
    return _model


def _log_mel(audio: torch.Tensor) -> torch.Tensor:
    win = torch.hann_window(1024, device=audio.device)
    spec = torch.stft(audio, n_fft=1024, hop_length=HOP, win_length=1024, window=win,
                      center=True, return_complex=True).abs()
    return torch.log(torch.clamp(_mel_basis @ spec, min=1e-5))


CENTS = 20 * np.arange(360) + 1997.3794084376191  # bin -> cents above 10 Hz


def salience(audio16k: np.ndarray, device: str, chunk_s: float = 32.0, pad_s: float = 1.28) -> np.ndarray:
    """(T, 360) pitch salience at 10 ms hops (bin k = 20 cents * k above ~31.7 Hz)."""
    model = _get(device)
    with torch.no_grad():
        x = torch.from_numpy(np.ascontiguousarray(audio16k, dtype=np.float32)).to(device)
        mel = _log_mel(x[None])  # (1, 128, T)
        del x
        n = mel.shape[-1]
        chunk, pad = int(chunk_s * 100) // 32 * 32, int(pad_s * 100)
        out = np.zeros((n, 360), dtype=np.float32)
        for s in range(0, n, chunk):
            a, b = max(0, s - pad), min(n, s + chunk + pad)
            seg = mel[..., a:b]
            w = seg.shape[-1]
            target = 32 * ((w - 1) // 32 + 1)
            if target > w:
                seg = F.pad(seg, (0, target - w), mode="reflect" if target - w < w else "constant")
            e = min(n, s + chunk)
            out[s:e] = model(seg)[0, s - a:e - a].float().cpu().numpy()
            del seg
        del mel
    if device == "cuda":
        torch.cuda.empty_cache()
    return out


def decode(sal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Local weighted average around the peak -> (midi float, confidence = peak salience)."""
    center = np.argmax(sal, axis=1)
    conf = sal[np.arange(len(sal)), center]
    idx = np.clip(center[:, None] + np.arange(-4, 5)[None, :], 0, 359)
    w = np.take_along_axis(sal, idx, axis=1)
    cents = np.sum(w * CENTS[idx], axis=1) / np.maximum(np.sum(w, axis=1), 1e-9)
    f0 = 10.0 * 2 ** (cents / 1200.0)
    midi = 69 + 12 * np.log2(f0 / 440.0)
    return midi.astype(np.float64), conf.astype(np.float64)
