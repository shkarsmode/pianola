# Pianola worker

The analysis service that runs on the home PC. It watches the song index in the private Vercel
Blob store, downloads each queued song, analyses it and uploads `audio.m4a` + `analysis.json`.
The web app pings and kicks it over ntfy.sh, so the PC needs no open ports.

## Pipeline (`pianola_worker/analyze.py`)

1. **Decode** to 44.1 kHz WAV (the reference timeline) and encode the playback AAC file.
2. **Probe**: Demucs on three short excerpts — no vocals and no drums means a solo instrument.
3. **Beats and bars**: beat_this frame activations → dynamic-programming beat path (steady period,
   follows rubato) → Viterbi over position-in-bar from the downbeat activation; 4/4 or 3/4.
4. **Solo piano**: high-resolution piano transcription (Kong et al.) with pedal; melody = top voice.
   **Band / song**: full Demucs separation; accompaniment (other + bass) → Basic Pitch;
   vocal stem → pitch tracking → melody snapped to the song's grid (straight or triplet feel).
5. **Chords** per beat: templates (triads, 7ths, sus, dim, aug) on onset-weighted chroma plus a
   bass term, Viterbi with cheaper changes on bar lines; dominant 7ths where they resolve.
   **Key** from the chord chart (tonic at the start and the end beats pitch statistics alone).

## Setup (Windows)

```powershell
py -3.14 -m pip install --user uv
uv python install 3.11
uv venv --python 3.11 .venv
uv pip install --python .venv\Scripts\python.exe torch torchaudio --index-url https://download.pytorch.org/whl/cu126
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
copy .venv\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-*.exe .venv\Scripts\ffmpeg.exe
```

`worker\.env` (never committed):

```
BLOB_READ_WRITE_TOKEN=...        # same private store as the Vercel project
PIANOLA_WORKER_SECRET=...        # same value as WORKER_SECRET on Vercel
PIANOLA_PORT=8765                # local port used only as a single-instance lock
```

Model weights download on first use into `worker\models\` (Demucs, beat_this, piano CRNN, RMVPE).
YouTube needs a JavaScript runtime for yt-dlp; Node.js on PATH is used.

## Run

```powershell
.venv\Scripts\python.exe -m pianola_worker                 # the service (logs in logs\worker.log)
.venv\Scripts\python.exe -m pianola_worker.cli analyze x.mp3   # one file, writes work\x\analysis.json
powershell -ExecutionPolicy Bypass -File install-autostart.ps1  # start at logon, restart on crash
```
