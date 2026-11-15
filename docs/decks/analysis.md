---
title: Track analysis
summary: What Crate's analysis gives Crate Decks, and how the beat and key detectors analyze your local tracks.
section: decks
audience: [user]
status: canonical
order: 40
verified: 2026-11-10
sources:
  - crate-decks:src/library/crateserver/crateservertrackmodel.cpp
  - crate-decks:src/crate/ui/delegates/statedelegates.cpp
  - crate-decks:src/preferences/dialog/dlgprefbeatsdlg.ui
  - crate-decks:src/preferences/dialog/dlgprefkeydlg.ui
  - crate-decks:src/preferences/dialog/dlgprefkey.cpp
  - crate-decks:src/analyzer/analyzerbeats.cpp
  - crate-decks:src/analyzer/analyzerkey.cpp
  - crate-decks:src/analyzer/plugins/analyzerkeyfinder.cpp
  - crate-decks:src/library/searchqueryparser.cpp
  - docs/technical/crate-decks.md
---

# Track analysis

A DJ app needs to know each track's tempo, beat positions and key. Crate
analyzes your whole library on the server; Crate Decks shows that analysis in
the Crate section and analyzes local tracks on this computer.

## Analysis from Crate

Your Crate server analyzes every track once, for all your devices. The Crate
section of the library shows the result in these columns:

| Column      | What it shows                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------ |
| **BPM**     | The tempo found by Crate                                                                         |
| **Key**     | The key in Camelot notation, for example `8A`                                                    |
| **Nrg**     | The energy level, from 1 (calm) to 10 (intense)                                                  |
| **Profile** | Whether Crate has a complete mix profile for the track: complete, partial, or **No profile** yet |

Nothing is analyzed on this computer to fill these columns. A track without a
profile has not been analyzed on the server yet, or its analysis failed.

In this version, Crate's analysis is shown in the library only. The tracks
you play come from your local music and are analyzed by the detectors below.

## Beat detection

When a local track is loaded into a deck, or when you run **Analyze** in the
Local section of the sidebar, Crate Decks detects its tempo (BPM) and beat
positions, and builds a beatgrid. Sync, quantize, beat loops and beat jumps
rely on it. **Preferences › Beat Detection** sets how:

- **Enable BPM and Beat Detection:** turns the detector on or off.
- **Choose Analyzer:** the algorithm. The default is the Queen Mary
  University of London tempo and beat tracker; the SoundTouch BPM detector
  is the alternative.
- **Assume constant tempo (Recommended):** turns the detected beats into a
  fixed-tempo beatgrid. Turn it off for tracks whose tempo drifts, such as
  live recordings.
- **Enable Fast Analysis:** faster on a slow computer, but may be less
  accurate.
- **Re-analyze beats when settings change or beat detection data is
  outdated**, and **Re-analyze beatgrids imported from other DJ software.**
- **Use rhythmic channel when analysing stem file:** for stem files, analyze
  the rhythmic channel only.

## Key detection

Crate Decks also detects the musical key of local tracks, so that you can mix
harmonically. **Preferences › Key Detection** sets how:

- **Enable Key Detection:** turns the detector on or off.
- **Choose Analyzer:** the algorithm. The default is the Queen Mary key
  detector; builds that include KeyFinder offer it too.
- **Enable Fast Analysis** and
  **Re-analyze keys when settings change or 3rd-party keys are present.**
- **Exclude rhythmic channel when analysing stem file:** ignore the rhythmic
  channel of stem files.
- **Key Notation:** how keys are shown: Lancelot, Lancelot/Traditional,
  OpenKey, OpenKey/Traditional, Traditional (for example `Am`) or Custom,
  where you type your own name for each key. Lancelot uses the same numbers
  and letters as the Camelot notation of the Crate section (`8A` is A
  minor).

To find local tracks in a compatible key, search for `~key:` and a key, for
example `~key:8A`; see [Searching](library.md#searching).
