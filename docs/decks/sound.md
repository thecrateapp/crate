---
title: Sound hardware
summary: Choose the sound API and devices, route the main mix, headphones and inputs, tune latency and fix sound problems.
section: decks
audience: [user]
status: canonical
order: 50
verified: 2026-11-10
sources:
  - crate-decks:src/preferences/dialog/dlgprefsound.cpp
  - crate-decks:src/preferences/dialog/dlgprefsounddlg.ui
  - crate-decks:src/soundio/soundmanagerutil.cpp
  - crate-decks:src/mixxxmainwindow.cpp
  - crate-decks:src/crate/ui/cratefirstrun.cpp
  - crate-decks:src/widget/wmainmenubar.cpp
  - crate-decks:res/keyboard/en_US.kbd.cfg
---

# Sound hardware

**Preferences › Sound Hardware** sets which sound devices Crate Decks uses and
how. The first-start dialog only chooses the main output; everything else is
here. Choose **Apply** to open the devices with the new settings.

## Sound API

The sound API is the system layer Crate Decks uses to reach your sound
cards. The list shows the APIs available on your system. Pick the one with
the lowest latency that works with your device:

- **Linux:** ALSA talks to the sound card directly and gives the lowest
  latency, but takes the card for Crate Decks alone. JACK and PipeWire share
  the card with other applications. When PipeWire is available, Crate Decks
  offers **Use PipeWire API** (restart Crate Decks after changing it) and,
  with it, **Sync with external patchbay** and options to force PipeWire's
  buffer size and sample rate.
- **Windows:** if the list offers ASIO and your sound card has an ASIO
  driver, use it; otherwise WASAPI. MME and DirectSound have high latency.
- **macOS:** CoreAudio.

The same page sets the **Sample Rate**, the **Audio Buffer** (see
[Latency](#latency)), **Multi-Soundcard Synchronization** when you use more
than one sound card, the **Engine Clock** (sound card or network clock), and
the **Keylock/Pitch-Bending Engine** used when keylock is on.
**Query Devices** searches the sound devices again, for example after you
connect one.

## Output and input devices

The **Output** and **Input** tabs connect the parts of Crate Decks to the
channels of your sound cards. Choose a device and channels for each one you
use; leave the others empty.

| Output                                      | What it carries                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| **Main**                                    | The main mix, for the speakers                                               |
| **Headphones**                              | The headphone cue mix (the decks with their headphone button on)             |
| **Booth**                                   | A separate mix for booth monitors, with its own volume                       |
| **Left Bus**, **Center Bus**, **Right Bus** | The decks assigned to each side of the crossfader, for an external mixer     |
| **Deck 1**, **Deck 2**, …                   | Each deck on its own, for an external mixer                                  |
| **Record/Broadcast**                        | The signal that is recorded and broadcast, when it differs from the main mix |

| Input                  | What it receives                                                            |
| ---------------------- | --------------------------------------------------------------------------- |
| **Microphone 1**, …    | Microphones; see [Microphones](#microphones)                                |
| **Auxiliary 1**, …     | Other sources mixed into the main mix, such as a phone or a second computer |
| **Vinyl Control 1**, … | Timecode turntables or CD players; see [Vinyl control](vinyl-control.md)    |
| **Record/Broadcast**   | An external mixer's output, to record or broadcast it                       |

Common setups:

- **Speakers and headphones:** Main on channels 1-2 and Headphones on
  channels 3-4 of the same four-output sound card or controller.
- **External mixer:** one Deck output per deck, each on its own stereo pair.
  Deck and bus outputs are post-fader and include effects and the crossfader
  (for Auto DJ), so set all faders and EQ knobs in Crate Decks to their
  default position (right-click or double-click them), and mix on the
  external mixer.

More options on this page:

- **Main Mix:** turn it off when you only use deck outputs to an external
  mixer.
- **Main Output Mode:** stereo or mono.
- **Main Output Delay**, **Headphone Output Delay** and
  **Booth Output Delay:** delay one output to line it up with another, for
  example speakers that are far away.

## Latency

Latency is the time between an action, such as pressing play, and hearing
it. It depends on the **Audio Buffer** size: a smaller buffer responds
faster but needs more from your computer; if the computer cannot keep up,
you hear pops and dropouts.

- **System Reported Latency** shows the latency of the current settings.
- **Buffer Underflow Count** counts the times the sound card ran out of
  audio. **Reset** sets it back to 0.
- If the counter goes up or you hear pops during playback, choose a larger
  buffer.
- If the app feels slow to respond, choose a smaller buffer.

On Linux, the hints on this page also tell you whether realtime scheduling is
enabled, which helps small buffers work.

## Microphones

Add a microphone in the **Input** tab as **Microphone 1** (and more if you
need them). Its controls appear in the microphone section of the skin,
which **View › Show Microphone Section** (Ctrl+2) shows. The talkover
button, or the `` ` `` key, turns the microphone on.

**Microphone Monitor Mode** sets where the microphone is heard:

| Mode                                                 | What you hear                                                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Main output only**                                 | The microphone goes into the main mix                                                                                                           |
| **Main and booth outputs**                           | The microphone goes into the main and booth mixes                                                                                               |
| **Direct monitor (recording and broadcasting only)** | The microphone goes only into the recording and the broadcast; you hear it directly through your sound card or mixer, without the app's latency |

## Microphone latency compensation

In **Direct monitor** mode, you hear your microphone directly while the
music reaches you through Crate Decks with its latency. In the recording and
the broadcast, your voice would then be out of time with the music.

**Microphone Latency Compensation** fixes this. Measure the round trip
latency of your sound card (the time from the app's output back to its
input, for example with a loopback cable and a latency measuring tool) and
enter it, in milliseconds. The field is active only in Direct monitor mode.
Preferences warns you while the value is 0, and again when you change the
audio buffer: measure again and enter the new value.

## Troubleshooting

- **No sound at all:** check that **Main** (or **Headphones**) has a device
  and channels in the **Output** tab, and choose **Apply**.
- **A device is missing:** connect it, then choose **Query Devices**. A
  device taken by another application may not show up with an API that needs
  it alone, such as ALSA; close the other application or use another API.
- **Sound Device Busy** or **Sound Device Error** at start-up: another
  application is using the device, or it was disconnected. Choose
  **Retry** after closing the other application or fixing the problem,
  **Reconfigure** to change the settings, or **Exit**.
- **No output devices:** if Crate Decks finds no output when it starts, it
  asks whether to continue without sound or change the settings. The decks
  play nothing until there is an output.
- **Pops, crackles or dropouts:** choose a larger **Audio Buffer**, and
  watch the **Buffer Underflow Count**. Close other heavy applications.
- **Everything sounds delayed:** choose a smaller **Audio Buffer**, or an API
  with lower latency (see [Sound API](#sound-api)).
- **Headphones play the main mix:** headphones need their own output
  channels; see [Output and input devices](#output-and-input-devices).

If it still does not work, ask for help or report the problem; see
[Help and community](community.md#getting-help).
