"""python -m pianola_worker.cli analyze <audio> [-o analysis.json]"""
import argparse
import json
import sys
from pathlib import Path

from . import config  # noqa: F401


def main() -> None:
    ap = argparse.ArgumentParser(prog="pianola_worker")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("audio", type=Path)
    a.add_argument("-o", "--out", type=Path)
    args = ap.parse_args()

    if args.cmd == "analyze":
        from .analyze import analyze

        workdir = config.WORK_DIR / args.audio.stem
        result = analyze(args.audio, workdir, lambda s, f: print(f"[{f:4.0%}] {s}", file=sys.stderr))
        out = args.out or workdir / "analysis.json"
        out.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {out} ({out.stat().st_size // 1024} KB)", file=sys.stderr)
        print(json.dumps({k: result[k] for k in ("duration", "sourceType", "melodySource", "stemShares",
                                                  "tempo", "timeSig", "key", "timing")}, ensure_ascii=False))
        print("chords:", " ".join(f"{c['name']}@{c['s']:.1f}" for c in result["chords"][:40]))
        print("melody notes:", len(result["melody"]), "notes:", len(result["notes"]))


if __name__ == "__main__":
    main()
