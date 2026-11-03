# Analyzer reference tools

Tools used to measure `smart-mix-audio-v6` (Crate Decks S8, Smart Mix 3 SM0.PR0) against
Mixxx's own analyzers and against the kick in the waveform. They are the starting point for
the SM0.PR1 evaluation harness, not a finished harness.

Run them only against local audio (a dev library or `test-music/`), never against production.
Store results by `entity_uid` or by index, never by title.

## `mixxxref.cpp`

An offline copy of what Mixxx stores after analysing a file: the Queen Mary beat grid (fixed
tempo, as `AnalyzerBeats` writes it), the Queen Mary key (Mixxx's default key detector) and
the KeyFinder key. It decodes with `ffmpeg` to stereo float and prints one JSON object.

It needs a configured Crate Decks build (`~/Code/Ninja/crate-decks/build`), which provides the
Queen Mary DSP library and KeyFinder:

```bash
D=~/Code/Ninja/crate-decks
g++ -O2 -std=c++17 -Dkiss_fft_scalar=double \
  -I$D/lib/qm-dsp -I$D/lib/qm-dsp/include -I$D/build/lib/keyfinder-install/include \
  mixxxref.cpp $D/build/libQueenMaryDsp.a $D/build/lib/keyfinder-install/lib/libkeyfinder.a \
  -lfftw3 -o mixxxref
./mixxxref <audio file> <sample rate>
```

Both libraries are GPL (Mixxx is GPL-2.0-or-later, KeyFinder GPL-3.0-or-later), which is
compatible with this repository's AGPL-3.0.

## `evaluate.py` and `kick_reference.py`

They score `crate-cli` outputs against the references. Both take a scratch directory and one
or more variant directories:

```text
<scratch>/ref/<entity_uid>.json             mixxxref output, spike set
<scratch>/tm/ref/<NNN>.json                 mixxxref output, wider set
<variant>/spike/<entity_uid>.json           crate-cli output ({"mixProfile": ...})
<variant>/tm/<NNN>.json
```

- `evaluate.py <scratch> <variant>...`: grid against Mixxx (the spike harness metric: the
  worst of five beats spread over the track), BPM matches, key matches against Queen Mary and
  KeyFinder, and the key distribution. Standard library only.
- `kick_reference.py <scratch> <variant>...`: where the grid sits against the kick attack (low
  pass under 150 Hz, Hilbert envelope folded over 16 beats at five positions; 0 ms means the
  grid is on the attack). Needs `librosa`, `numpy` and `scipy`.

The track lists inside the scripts are the ten `full` profiles from the Crate Decks spike.

## Known limits

- Mixxx's grid sits 20–30 ms before the kick on electronic tracks, so it is a reference for
  BPM and key, not for 5 ms grid accuracy. SM0.PR0's acceptance uses a hand-labelled set.
- The kick reference is ambiguous by about ±20 ms on dense rock mixes.
