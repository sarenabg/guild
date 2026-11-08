# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Place narration lines onto a film's timeline.

Reads <film>/audio/vo/cues.json:
  {"take": "take1.mp3", "lines": [{"src": [start, end], "at": target_seconds, "text": "..."}]}
Writes <film>/audio/vo.wav (48 kHz mono, each line faded in/out and placed at `at`)
and <film>/vo_cues.json (each line's placed start/end, plus every word's approximate time,
spread over the line by syllable weight) for the kinetic captions.

Run from video/:  uv run tools/vo_edit.py promo
"""
import json
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48_000


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def weight(word: str) -> float:
    w = re.sub(r"[^a-z]", "", word.lower())
    syll = max(1, len(re.findall(r"[aeiouy]+", w)))
    pause = 0.6 if re.search(r"[.?!]$", word) else 0.3 if re.search(r"[,:]$", word) else 0.0
    return syll + pause


def main(film: str) -> None:
    root = Path(film)
    cues = json.loads((root / "audio/vo/cues.json").read_text())
    take = decode(root / "audio/vo" / cues["take"])
    duration = json.loads((root / "film.json").read_text())["duration"]
    out = np.zeros(int(duration * SR), dtype=np.float32)
    placed = []
    fade = int(0.012 * SR)
    last_end = 0.0
    for line in cues["lines"]:
        a, b = line["src"]
        seg = take[int(a * SR): int(b * SR)].copy()
        seg[:fade] *= np.linspace(0, 1, fade)
        seg[-fade:] *= np.linspace(1, 0, fade)
        at = float(line["at"])
        if at < last_end:
            print(f"!! overlap: '{line['text'][:30]}' starts {at:.2f}s, previous ends {last_end:.2f}s")
        i = int(at * SR)
        out[i: i + len(seg)] += seg[: max(0, len(out) - i)]
        end = at + len(seg) / SR
        last_end = end
        words = line["text"].split()
        ws = [weight(w) for w in words]
        total = sum(ws)
        t, times = at + 0.05, []
        for w, wt in zip(words, ws):
            times.append({"w": w, "t": round(t, 3)})
            t += (end - at - 0.1) * wt / total
        placed.append({"start": round(at, 3), "end": round(end, 3), "text": line["text"], "words": times})
        print(f"  {at:6.2f}-{end:6.2f}  {line['text']}")
    peak = float(np.max(np.abs(out))) or 1.0
    out = out / peak * 0.89  # about -1 dBFS peak; mix.mjs sets the final loudness
    with wave.open(str(root / "audio/vo.wav"), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes((out * 32767).astype(np.int16).tobytes())
    (root / "vo_cues.json").write_text(json.dumps(placed, indent=1))
    print(f"-> {root}/audio/vo.wav, {root}/vo_cues.json  ({len(placed)} lines, last ends {last_end:.2f}s of {duration}s)")


if __name__ == "__main__":
    main(sys.argv[1])
