"""Three short, soft chimes for the Nokta mod, synthesised (no samples, no licences).

usage: python make_sounds.py <mod dir>      -> <mod>/assets/sounds/{approve,done,error}.wav
"""
import os
import sys
import wave

import numpy as np

RATE = 22050


def note(freq, dur, gain=0.5, attack=0.006, decay=7.0, bright=0.28):
    t = np.arange(int(RATE * dur)) / RATE
    env = np.minimum(1.0, t / attack) * np.exp(-decay * t)
    wave_ = np.sin(2 * np.pi * freq * t) + bright * np.sin(2 * np.pi * 2 * freq * t) + 0.08 * np.sin(2 * np.pi * 3 * freq * t)
    return gain * env * wave_ / (1 + bright + 0.08)


def seq(parts, gap=0.0, tail=0.12):
    out = np.zeros(int(RATE * (sum(d for _, d in parts) + gap * len(parts) + tail)))
    at = 0
    for freq, dur in parts:
        n = note(freq, dur + tail)
        out[at:at + len(n)] += n[: len(out) - at]
        at += int(RATE * (dur + gap))
    return out


def save(path, data):
    peak = float(np.max(np.abs(data))) or 1.0
    pcm = (np.clip(data / peak * 0.85, -1, 1) * 32767).astype('<i2')
    fade = int(RATE * 0.01)
    pcm[-fade:] = (pcm[-fade:] * np.linspace(1, 0, fade)).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def main():
    out = os.path.join(sys.argv[1], 'assets', 'sounds')
    os.makedirs(out, exist_ok=True)
    # approve: a question mark in sound, two rising notes
    save(os.path.join(out, 'approve.wav'), seq([(659.25, 0.09), (880.0, 0.16)], gap=0.0))
    # done: a small arpeggio up, C major
    save(os.path.join(out, 'done.wav'), seq([(523.25, 0.07), (659.25, 0.07), (783.99, 0.07), (1046.5, 0.22)]))
    # error: two falling notes, rounder and lower
    save(os.path.join(out, 'error.wav'), seq([(392.0, 0.12), (293.66, 0.26)]))
    for n in ('approve', 'done', 'error'):
        print(n, os.path.getsize(os.path.join(out, n + '.wav')) // 1024, 'KB')


if __name__ == '__main__':
    main()
