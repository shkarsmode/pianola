# Pianola

Any song → falling piano notes you can actually play. Paste a YouTube / Instagram / TikTok link,
upload a file or record from the microphone; Pianola finds the beats, bars, key, chords and
melody, and writes a two-hand part for the level you pick (Adaptive, Beginner … Advanced, and
"Pretty & easy"). Click any chord to see how to press it.

Single-user personal app. UI in Ukrainian.

## How it fits together

```
browser (Vercel, Next.js) ──ntfy.sh──▶ worker on the home PC (Python, GPU)
        ▲                                   │ yt-dlp → Demucs → piano transcription /
        │ presigned URLs                    │ Basic Pitch → vocal pitch → beats, chords
        └──────── private Vercel Blob ◀─────┘ audio.m4a + analysis.json + index.json
```

- `app/`, `components/`, `lib/` — the web app. Arrangements, hand split and fingering are computed
  in the browser from `analysis.json` (`lib/music/`), so switching levels is instant.
- `worker/` — the analysis service. Runs on a PC with a residential connection (YouTube and
  Instagram block datacenter IPs) and a CUDA GPU if available.

## Web app

```bash
npm install
npm run dev        # http://127.0.0.1:4600
npm test
```

Environment (Vercel project settings, `.env.local` for development):
`BLOB_READ_WRITE_TOKEN` (private Blob store), `APP_PASSWORD`, `AUTH_SECRET`, `WORKER_SECRET`.

## Worker

Python 3.11, PyTorch (CUDA 12.6 build), Demucs, beat_this, piano_transcription_inference,
Basic Pitch (ONNX), RMVPE/torchcrepe, yt-dlp. See `worker/README.md` for setup and autostart.

Piano samples: Salamander Grand Piano by Alexander Holm (CC BY 3.0), via Tone.js.
