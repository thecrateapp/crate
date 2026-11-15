---
title: Decks and mixing
summary: How the cue button, sync lock, the deck equalizers and Auto DJ behave, and where to change them.
section: decks
audience: [user]
status: canonical
order: 30
verified: 2026-11-10
sources:
  - crate-decks:src/preferences/dialog/dlgprefdeck.cpp
  - crate-decks:src/preferences/dialog/dlgprefdeckdlg.ui
  - crate-decks:src/preferences/dialog/dlgprefmixerdlg.ui
  - crate-decks:src/preferences/dialog/dlgprefautodjdlg.ui
  - crate-decks:src/skin/legacy/tooltips.cpp
  - crate-decks:src/effects/presets/effectchainpresetmanager.cpp
  - crate-decks:src/library/autodj/dlgautodj.cpp
  - crate-decks:src/crate/ui/dlgprefcrate.cpp
  - crate-decks:res/crate-brand/mixxx-strings.json
  - crate-decks:res/keyboard/en_US.kbd.cfg
---

# Decks and mixing

Each deck plays one track with its own speed slider, cue and hotcue
buttons, loops and sync. The mixer section has a gain knob, a three-band
equalizer, a quick effect knob and a volume fader per deck, and a
crossfader. **Preferences › Decks** and **Preferences › Mixer** change how
they behave.

## Cue modes

The cue button of each deck stores and returns to the main cue point. How it
reacts depends on the cue mode in **Preferences › Decks › Cue mode**:

| Cue mode                           | Behavior                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Crate Decks mode**               | Paused at the cue point: plays while you hold it (preview). Paused elsewhere: sets the cue point. Playing: stops and returns to the cue point.                         |
| **Crate Decks mode (no blinking)** | The same, without blinking indicators.                                                                                                                                 |
| **Pioneer mode**                   | Like Crate Decks mode, with a flashing play button.                                                                                                                    |
| **Denon mode**                     | At the cue point: preview. Elsewhere: stops at the cue point. Pressing play sets the cue point.                                                                        |
| **Numark mode**                    | Like Denon mode, without a flashing play button.                                                                                                                       |
| **CUP mode** (cue and play)        | Paused at the cue point: plays when you release it. Paused elsewhere: sets the cue point and plays on release. Playing: returns to the cue point and plays on release. |

Related options on the same page:

- **Track load point:** where a newly loaded track starts: intro start,
  main cue, first hotcue, first sound (skipping silence) or the beginning.
- **Loading a track, when deck is playing:** reject the load, allow it and
  stop the deck, or allow it and play from the load point.
- **Set intro start to main cue when analyzing tracks:** when the analyzer
  places the intro start, it uses an existing main cue instead of the first
  sound.
- **Double-press Load button to clone playing track:** double-tapping a
  deck's Load button on a controller or keyboard loads a playing copy of the
  first playing deck.

With **Quantize** on, cues and loops snap to the nearest beat.

## Sync lock

The **Sync** button of each deck matches its tempo to another deck:

- **Tap** it to match the tempo once, to the other playing tracks or to the
  sync leader.
- **Hold** it for at least a second to turn on sync lock. All decks with
  sync lock play at the same tempo, and decks that also have **Quantize** on
  keep their beats lined up. Tap it again to turn sync lock off.

One deck leads the tempo and the others follow it. Crate Decks picks the
leader by itself; with **Sync Leader** on a deck, that deck leads. This
matters when the leader plays a track with a changing tempo: the followers
adopt its tempo as it changes.

**Preferences › Decks › Sync mode (Dynamic tempo tracks)** sets what happens
when the tempo comes from a track with a changing tempo that Crate Decks
picked as leader (a soft leader), usually the outgoing track of a
transition:

- **Follow soft leader's tempo:** the followers follow its tempo changes.
  After the transition the next track keeps the last tempo of the previous
  leader.
- **Use steady tempo:** the tempo at the start of the transition is kept
  steady, which avoids slowing down with a rubato outro.

Changes from a leader you picked yourself are always followed.

The speed options on the same page:

- **Slider range:** 4 %, 6 % (a semitone), 8 %, 10 %, 16 %, 24 %, 50 % or
  90 %.
- **Down increases speed:** makes the speed slider work like a turntable or
  CDJ.
- **Keylock mode:** keep the current key or the original key when keylock
  is turned on, and **Keyunlock mode:** reset or keep the key when it is
  turned off. Keylock keeps the pitch when the speed changes.
- **Pitch bend behavior** and the **Adjustment buttons:** how far the
  temporary and permanent speed buttons move the speed, and whether
  temporary changes jump or ramp smoothly.
- **Reset on track load:** whether speed and key reset when a track loads.

## Equalizers

Each deck has a three-band equalizer (high, mid and low) with a kill button
per band. **Preferences › Mixer** sets how it works:

- **Equalizer Plugin:** the effect behind the EQ knobs. The default is
  **Biquad Full Kill Equalizer**; the alternatives include the
  **Bessel4 LV-Mix Isolator**, **Bessel8 LV-Mix Isolator**,
  **LinkwitzRiley8 Isolator** and **Biquad Equalizer**.
- **Use the same EQ filter for all decks:** uncheck it to choose a different
  equalizer per deck.
- **Only allow EQ knobs to control EQ-specific effects:** uncheck it to load
  any effect into the EQ knobs.
- **Quick Effect:** the effect behind each deck's quick effect knob, usually
  a filter.
- **Equalizer frequency Shelves:** the crossover frequencies of the high and
  low bands.
- **Reset equalizers on track load** and **Reset gain on track load.**
- **Bypass EQ effect processing:** turns the equalizers off to save
  processing power on a slow computer.
- **Main EQ:** an equalizer on the main output.

The **Crossfader Curve** group on the same page sets the crossfader shape,
from a slow fade to a fast cut for scratching, and
**Reverse crossfader (Hamster Style)**.

To reset a knob, right-click or double-click it.

## AutoDJ

Auto DJ plays the tracks of its queue one after another and crossfades
between them on its own. Open it from **Auto DJ** in the Local section of
the sidebar, or with **View › Show Auto DJ** (Ctrl+9).

1. Add tracks to the queue: drag them onto **Auto DJ**, or use the track
   menu. **Preferences › Library** can also make a double-click add a track
   to the queue.
2. Choose a transition mode and a transition time in seconds.
3. Press **Enable** (Shift+F12). Auto DJ needs decks 1 and 2 on opposite
   sides of the crossfader, and at least one of them stopped.

| Transition mode                    | What it does                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Full Intro + Outro**             | Plays the full intro and outro, and crossfades over the shorter of the two. Without intro and outro markers, it uses the transition time. |
| **Fade At Outro Start**            | Starts crossfading at the outro start, cutting the end of a long outro. Without markers, it uses the transition time.                     |
| **Full Track**                     | Plays the whole track and starts crossfading the given number of seconds before the end. A negative time adds silence between tracks.     |
| **Skip Silence**                   | Plays the whole track except silence at the start and end, and starts crossfading the given number of seconds before the last sound.      |
| **Skip Silence Start Full Volume** | Like Skip Silence, but starts the transition with the crossfader centered, so the next track starts at full volume.                       |

The buttons next to the queue:

- **Fade** (Shift+F11) starts the transition to the next track now.
- **Skip** (Shift+F10) skips the next track in the queue.
- **Shuffle** (Shift+F9) shuffles the queue.
- **Random** adds a random track from the track sources (crates you choose)
  or, without track sources, from the whole local library.
- **Repeat** plays the queue again from the start when it ends.

**Preferences › Auto DJ** sets how random tracks are picked and re-queued
(minimum available tracks, how long a played track is held back, adding
random tracks when the queue runs low) and whether the crossfader goes back
to the center when you disable Auto DJ.

In this version, Auto DJ plays local tracks and uses these transition modes.
Smart Mix transitions planned by your Crate server are not available in the
decks yet.
