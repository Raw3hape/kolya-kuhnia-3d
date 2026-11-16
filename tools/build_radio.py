"""Reproducible original music for three fictional in-game stations. No downloaded samples.
Python stdlib + ffmpeg; bounded foreground job. WAV intermediates live in TemporaryDirectory.
"""
import array
import json
import math
from pathlib import Path
import random
import subprocess
import tempfile
import wave

ROOT = Path(__file__).resolve().parents[1]
RATE = 22050
RECIPES = [("kuchnia", 84, [45, 41, 48, 43], 13), ("zabka", 124, [45, 48, 43, 41], 31), ("noc", 96, [50, 43, 48, 45], 71)]

def render(station, bpm, roots, seed, directory):
    rng = random.Random(seed)
    beat = 60 / bpm
    duration = 32 * beat
    samples = [0.0] * int(RATE * duration)

    def note(at, length, midi, volume, timbre="keys"):
        freq = 440 * 2 ** ((midi - 69) / 12)
        start = int(at * RATE)
        for i in range(int(length * RATE)):
            t = i / RATE
            env = min(1, t / 0.012) * min(1, (length - t) / 0.09)
            phase = 2 * math.pi * freq * t
            if timbre == "bass":
                v = math.sin(phase) + 0.18 * math.sin(phase * 2)
            elif timbre == "lead":
                v = (math.sin(phase) + 0.25 * math.sin(phase * 3)) * math.exp(-t * 6)
            else:
                v = (math.sin(phase) + 0.30 * math.sin(phase * 2) * math.exp(-t * 8) + 0.08 * math.sin(phase * 4)) * math.exp(-t * 2.3)
            index = (start + i) % len(samples)
            samples[index] += volume * env * v

    def drum(at, kind, volume):
        start = int(at * RATE)
        length = 0.27 if kind == "kick" else 0.15
        previous = 0
        for i in range(int(length * RATE)):
            t = i / RATE
            noise = rng.uniform(-1, 1)
            if kind == "kick":
                v = math.sin(2 * math.pi * (48 * t + 1.5 * (1 - math.exp(-t * 35)))) * math.exp(-t * 19)
            elif kind == "snare":
                v = (noise * 0.75 + math.sin(2 * math.pi * 180 * t) * 0.25) * math.exp(-t * 35)
            else:
                v = (noise - previous) * math.exp(-t * 95)
            previous = noise
            samples[(start + i) % len(samples)] += volume * v

    for bar in range(8):
        root = roots[bar % 4]
        chord = [root + 12, root + 15, root + 19, root + (22 if station == "noc" else 24)]
        for b in range(4):
            at = (bar * 4 + b) * beat
            if station == "zabka" or b in [0, 2]:
                drum(at, "kick", 0.46)
            if b % 2:
                drum(at, "snare", 0.18 if station == "zabka" else 0.12)
            for half in [0, 0.5]:
                swing = 0.075 if half and station != "zabka" else 0
                drum(at + (half + swing) * beat, "hat", 0.055)
            note(at + (0.5 * beat if station == "zabka" else 0), beat * 0.68, root - (12 if station == "zabka" else 0), 0.19, "bass")
            if b in [0, 2] or station == "zabka":
                for midi in chord:
                    note(at + (0.5 if station == "zabka" else 0.08) * beat, beat * (0.35 if station == "zabka" else 1.6), midi, 0.048)
            if b != 1:
                melody = [0, 7, 10, 14, 7, 3, 12, 10]
                note(at + beat * 0.53, beat * 0.65, root + 24 + melody[(bar * 3 + b) % len(melody)], 0.055, "lead")
    # A small wrap-around room delay keeps the eight-bar loop continuous.
    dry = samples[:]
    delay = int(beat * 0.75 * RATE)
    for i, value in enumerate(dry):
        samples[(i + delay) % len(samples)] += value * 0.16
    peak = max(abs(n) for n in samples)
    pcm = array.array("h", (int(math.tanh(n / peak * 1.25) * 26000) for n in samples))
    wav = directory / f"{station}.wav"
    with wave.open(str(wav), "wb") as output:
        output.setparams((1, 2, RATE, len(pcm), "NONE", "not compressed"))
        output.writeframes(pcm.tobytes())
    target = ROOT / "web/audio/radio" / f"{station}.mp3"
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-codec:a", "libmp3lame", "-b:a", "96k", "-metadata", f"title={station}", str(target)], check=True, timeout=30)
    return {"id": station, "bpm": bpm, "seconds": round(duration, 3), "bytes": target.stat().st_size, "seed": seed}

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="kitchen-radio-") as folder:
        manifest = [render(*recipe, Path(folder)) for recipe in RECIPES]
    (ROOT / "web/audio/radio/manifest.json").write_text(json.dumps({"generator": "tools/build_radio.py", "rights": "Original procedural compositions and synthesis. No external samples.", "tracks": manifest}, indent=2) + "\n")
    print(json.dumps(manifest))
