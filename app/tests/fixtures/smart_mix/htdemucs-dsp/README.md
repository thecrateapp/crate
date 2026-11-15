# htdemucs DSP fixtures

The DSP around the `htdemucs-onnx-1` graph (STFT, iSTFT, overlap-add and the
normalisation) must be identical in both producers of `stem-analysis/1`: the server
(`crate/smart_mix/separation.py`) and Crate Decks (C++). These files are the reference
both check against.

- **Source:** Crate Decks, `src/test/crate/data/htdemucs-dsp/` at commit
  `277287b337a687c8cfd78656599962cb6f5665e3` (branch `feat/decks-htdemucs-export`),
  copied unchanged.
- **Generator:** `tools/crate-stems/make_fixtures.py --dsp` in Crate Decks, from the
  numpy reference `tools/crate-stems/stems_dsp.py`. That reference was checked against
  PyTorch's `HTDemucs._spec` and `_ispec` (`torch_check` in `index.json`: STFT 3.1e-7,
  iSTFT 7.8e-8) and against `demucs.apply.apply_model`.
- **Content:** synthetic signals only (tones, noise and clicks), raw little-endian
  float32 in C order. `index.json` gives each file's shape, layout and SHA-256.
- **Used by:** `tests/test_smart_mix_separation_dsp.py`.

Regenerate them in Crate Decks, never here, and copy them again with the new commit.
