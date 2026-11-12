---
title: Vinyl control
summary: Play the decks with timecode vinyl or CDs on your turntables or CD players, and fix a bad timecode signal.
section: decks
audience: [user]
status: canonical
order: 90
verified: 2026-11-10
sources:
  - crate-decks:src/preferences/dialog/dlgprefvinyl.cpp
  - crate-decks:src/preferences/dialog/dlgprefvinyldlg.ui
  - crate-decks:src/vinylcontrol/defs_vinylcontrol.h
  - crate-decks:src/skin/legacy/tooltips.cpp
  - crate-decks:src/widget/wmainmenubar.cpp
  - crate-decks:src/soundio/soundmanagerutil.cpp
  - crate-decks:res/keyboard/en_US.kbd.cfg
---

# Vinyl control

With vinyl control, a turntable or CD player plays a timecode record or CD,
and Crate Decks follows it: the needle moves the track of a deck, so you can
scratch, nudge and back-cue a digital track as if it were on the record.
Vinyl control uses the xwax timecode decoder.

You need, per deck:

- A timecode record or CD of a supported type.
- A stereo input on your sound card. Turntables need a phono input, or a
  sound card or mixer with a phono preamp; CD players use a line input.

## Configuring vinyl control

1. **Connect the inputs.** In **Preferences › Sound Hardware › Input**,
   choose the sound card channels of each turntable for **Vinyl Control 1**,
   **Vinyl Control 2**, and so on. See
   [Output and input devices](sound.md#output-and-input-devices).
2. **Set up each deck** in **Preferences › Vinyl Control**:
   - **Vinyl Type:** the timecode you use. Supported: Algoriddim djay PRO AI
     12" (side A, and side B without stem support), MixVibes 7" and DVS V2,
     Pioneer Rekordbox DVS Control Vinyl (sides A and B), Serato CD and CV02
     Vinyl (sides A and B), Traktor Scratch MK1 Vinyl (sides A and B), and
     Traktor Scratch MK2 CD and Vinyl (sides A and B, beta).
   - **Speed:** 33.3 RPM or 45 RPM, as your turntable plays.
   - **Lead-In:** the part of the record, in seconds, to skip at its start.
   - **Pitch estimator:** Kalman filter (accurate) or Alpha-Beta filter
     (fast).
3. **Adjust the signal.** **Turntable Input Signal Boost** amplifies a weak
   signal, from 0 to 44 dB. Play the record and watch the **Signal Quality**
   display of each deck while you adjust it. **Show Signal Quality in Skin**
   shows it on the decks too.
4. **Turn vinyl control on** for each deck with **Options › Vinyl Control ›
   Enable Vinyl Control 1** (Ctrl+T), **2** (Ctrl+Y), **3** (Ctrl+U) or
   **4** (Ctrl+I), or with the vinyl button of the deck. **View › Show Vinyl
   Control Section** (Ctrl+3) shows the vinyl controls in the skin.

Each deck has a vinyl control mode:

| Mode         | Behavior                                                                     |
| ------------ | ---------------------------------------------------------------------------- |
| **Absolute** | The track position follows the needle position and speed, like a real record |
| **Relative** | The track speed follows the needle speed, wherever the needle is             |
| **Constant** | The track plays at the last steady speed, whatever the needle does           |

In relative mode, the **cueing mode** decides what happens when you drop the
needle: **Off** ignores cue points, **One Cue** jumps to the cue point when
the needle drops after it, and **Hot Cue** jumps to the nearest previous
hotcue.

**Passthrough** makes a deck play the audio of its input as it is, so that
you can play a normal record on the same turntable.

## Troubleshooting

- **Nothing happens when the record plays:** check that vinyl control is on
  for that deck (Options › Vinyl Control), that its input is set in
  **Preferences › Sound Hardware › Input**, and that the **Vinyl Type**
  matches your record or CD.
- **The signal is weak:** raise **Turntable Input Signal Boost**, or the
  gain of your sound card or preamp. A turntable on a line input without a
  phono preamp gives a very weak signal.
- **The signal is distorted:** lower the boost or the input gain.
- **The track drifts or jumps:** check that both channels of the turntable
  reach the input, clean the record and the needle, and try the Kalman pitch
  estimator. If the start of the record is worn, raise the **Lead-In**.
- **The track plays at the wrong speed:** check the **Speed** setting
  (33.3 or 45 RPM) against your turntable.
- **It works in absolute mode but you want to skip around:** use relative
  mode, so that the needle position no longer sets the track position.

For more help, see [Help and community](community.md#getting-help).
