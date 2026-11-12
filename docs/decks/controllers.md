---
title: Controllers
summary: Connect a MIDI or HID controller, load one of the shipped mappings, or write your own mapping and script.
section: decks
audience: [user]
status: canonical
order: 60
verified: 2026-11-10
sources:
  - crate-decks:src/controllers/dlgprefcontrollers.cpp
  - crate-decks:src/controllers/dlgprefcontrollersdlg.ui
  - crate-decks:src/controllers/dlgprefcontroller.cpp
  - crate-decks:src/controllers/dlgprefcontrollerdlg.ui
  - crate-decks:src/controllers/defs_controllers.h
  - crate-decks:src/controllers/legacycontrollermappingfilehandler.cpp
  - crate-decks:src/controllers/midi/legacymidicontrollermappingfilehandler.cpp
  - crate-decks:src/controllers/midi/midicontroller.cpp
  - crate-decks:src/controllers/scripting/legacy/controllerscriptenginelegacy.cpp
  - crate-decks:src/engine/enginemixer.cpp
  - crate-decks:src/library/librarycontrol.cpp
  - crate-decks:src/util/cmdlineargs.cpp
  - crate-decks:res/controllers/engine-api.d.ts
  - crate-decks:res/controllers/Numark-Mixtrack-3.midi.xml
  - crate-decks:res/keyboard/en_US.kbd.cfg
  - crate-decks:CMakeLists.txt
---

# Controllers

Controllers are physical devices that send MIDI or HID messages to your
computer, usually over USB. A **mapping** tells Crate Decks what each button,
knob and fader does, and which lights to turn on.

## Using a controller

1. Connect the controller before you start Crate Decks. If you connect it
   while Crate Decks is running, restart Crate Decks.
2. Open **Preferences › Controllers**. Each controller Crate Decks
   recognizes is listed under **Controllers** in the Preferences sidebar.
3. Select your controller, choose a mapping in **Load Mapping**, make sure
   **Enabled** is checked, and choose **Apply**.

The controller's page shows the mapping's name, author, description and
support links, and the settings the mapping offers, if any. The
**Input Mappings** and **Output Mappings** tabs list what the mapping does
and let you change it.

If your controller has a built-in audio interface, choose it for the main
and headphone outputs in [Sound hardware](sound.md#output-and-input-devices).

On Linux, **Enable MIDI Through Port** adds a virtual MIDI controller, for
example for a lighting mapping. Restart Crate Decks after turning it on.

## Supported controllers

Crate Decks comes with more than 150 mappings for MIDI and HID controllers.
The shipped mappings come with the app and are listed in
**Preferences › Controllers**: select your controller and open
**Load Mapping**. When a mapping has its own manual, its link on the
controller's page opens this page.

If there is no mapping for your controller:

- **Make one with the MIDI Learning Wizard** (MIDI controllers only): select
  your controller in **Preferences › Controllers** and start the
  **Learning Wizard**. You pick a control of Crate Decks, move the button or
  knob it should follow, and the wizard adds that to the controller's
  mapping.
- **Use a mapping someone else made:** put its XML (`.xml`) and JavaScript
  (`.js`) files in your user mapping folder (**Open User Mapping Folder** in
  **Preferences › Controllers**), and choose the reload button next to the
  mapping selector. If it came in a ZIP file, extract the files first. See
  [Sharing controller mappings](community.md#sharing-controller-mappings).
- **Write your own** with the file format and scripting below.

## Mapping file format

A mapping is an XML file, plus optional JavaScript files:

| File                | Kind                                  |
| ------------------- | ------------------------------------- |
| `<name>.midi.xml`   | MIDI controller                       |
| `<name>.hid.xml`    | HID controller                        |
| `<name>.bulk.xml`   | USB bulk controller                   |
| `<name>-scripts.js` | Script used by the mapping (any name) |

Crate Decks reads mappings from two places: the shipped `controllers`
folder of the installation, and the `controllers` folder of your
[settings directory](user-manual.md#settings-directory), which is your user
mapping folder. Put your own mappings in the user folder, so that updates do
not overwrite them.

A minimal MIDI mapping that maps one button to play on deck 1 and lights it
while the deck plays:

```xml
<?xml version="1.0" encoding="utf-8"?>
<MixxxControllerPreset mixxxVersion="2.7.0+" schemaVersion="1">
  <info>
    <name>My Controller</name>
    <author>Your name</author>
    <description>Play button for deck 1.</description>
  </info>
  <controller id="MyController">
    <scriptfiles>
      <file filename="My-Controller-scripts.js" functionprefix="MyController" />
    </scriptfiles>
    <controls>
      <control>
        <group>[Channel1]</group>
        <key>play</key>
        <status>0x90</status>
        <midino>0x0B</midino>
        <options>
          <normal />
        </options>
      </control>
    </controls>
    <outputs>
      <output>
        <group>[Channel1]</group>
        <key>play_indicator</key>
        <status>0x90</status>
        <midino>0x0B</midino>
        <on>0x7F</on>
        <off>0x00</off>
        <minimum>0.5</minimum>
      </output>
    </outputs>
  </controller>
</MixxxControllerPreset>
```

- **`<info>`** describes the mapping. It can also hold `<forums>`, `<wiki>`
  and `<manual>` links, and a `<settings>` block of options that the user
  can change on the controller's page.
- **`<control>`** maps one incoming MIDI message (`status` byte and
  `midino`) to a control (`group` and `key`); see [Controls](#controls).
- **`<options>`** changes how the value is read. Besides `normal`: `invert`,
  `rot64`, `rot64inv`, `rot64fast`, `diff`, `button`, `switch`, `hercjog`,
  `hercjogfast`, `spread64`, `selectknob`, `soft-takeover` (the control
  does not jump until the knob reaches its current value),
  `fourteen-bit-msb` and `fourteen-bit-lsb`, and `script-binding` (calls a
  script function instead; see [Scripting](#scripting)).
- **`<output>`** sends a MIDI message when a control changes: `on` when its
  value is between `minimum` and `maximum`, `off` otherwise.

HID and bulk controllers send raw data that a script must decode, so their
XML files mostly name the script files.

## Scripting

Scripts handle what a plain mapping cannot: shift buttons, jog wheels,
layers, LEDs with several colors, and every HID controller.

- **`<scriptfiles>`** lists the JavaScript files, each with a
  `functionprefix`: the name of the JavaScript object that holds the
  mapping's functions.
- **`init(id, debugging)`** of that object is called when the mapping is
  loaded, with the controller's name and whether debug logging is on.
  **`shutdown()`** is called when it is unloaded, for example to turn off the
  lights.
- A control with the `script-binding` option calls the function named in its
  `key`, for example `MyController.wheelTurn`, with the arguments
  `(channel, control, value, status, group)`.

```javascript
var MyController = {};

MyController.init = function (id, debugging) {
  // Light the play button while deck 1 plays
  engine.makeConnection("[Channel1]", "play_indicator", function (value) {
    midi.sendShortMsg(0x90, 0x0b, value ? 0x7f : 0x00);
  });
};

MyController.shutdown = function () {
  midi.sendShortMsg(0x90, 0x0b, 0x00);
};
```

The `engine` object reads and sets controls (`getValue`, `setValue`,
`getParameter`, `setParameter`), reacts to their changes (`makeConnection`),
runs timers (`beginTimer`, `stopTimer`), and offers jog wheel helpers
(`scratchEnable`, `scratchTick`, `scratchDisable`, `brake`, `spinback`,
`softStart`) and `softTakeover`. `midi.sendShortMsg` and `midi.sendSysexMsg`
send MIDI. The shipped `controllers` folder has helper libraries that
mappings may load, such as `common-controller-scripts.js` and
`midi-components-0.0.js`, and TypeScript declaration files (`.d.ts`) that
document the whole scripting API.

While you write a mapping, start Crate Decks with `--controller-debug` to
log every message the controller sends, and with
`--controller-abort-on-warning` to make scripts fail on API misuse. See
[Command line options](user-manual.md#command-line-options).

## Controls

Every part of Crate Decks you can control has a **group** and a **key**,
like `[Channel1]` and `play`. Mappings, scripts and the
[keyboard mapping](keyboard-shortcuts.md) use the same names. The control
picker of the **Input Mappings** tab lists all of them with a description.

| Group                                 | What it is                              |
| ------------------------------------- | --------------------------------------- |
| `[Channel1]`, `[Channel2]`, …         | The decks                               |
| `[Sampler1]`, …                       | The samplers                            |
| `[PreviewDeck1]`                      | The preview deck                        |
| `[Master]`                            | The main mix, headphones and crossfader |
| `[Microphone]`, `[Microphone2]`, …    | Microphones                             |
| `[Auxiliary1]`, …                     | Auxiliary inputs                        |
| `[EqualizerRack1_[Channel1]_Effect1]` | The equalizer of deck 1                 |
| `[QuickEffectRack1_[Channel1]]`       | The quick effect of deck 1              |
| `[EffectRack1_EffectUnit1]`, …        | The effect units                        |
| `[Library]`                           | Library navigation                      |
| `[AutoDJ]`                            | Auto DJ                                 |

Common controls:

| Control                                                            | What it does                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `[ChannelN]`, `play`                                               | Play or pause (`play_indicator` follows the cue mode for lights)        |
| `[ChannelN]`, `cue_default`                                        | The cue button, as set by the [cue mode](mixing.md#cue-modes)           |
| `[ChannelN]`, `sync_enabled`                                       | Sync: tap to match the tempo, hold for [sync lock](mixing.md#sync-lock) |
| `[ChannelN]`, `rate`                                               | The speed slider, from -1 to 1                                          |
| `[ChannelN]`, `volume`, `pregain`                                  | The volume fader and the gain knob                                      |
| `[ChannelN]`, `pfl`                                                | The headphone cue button                                                |
| `[ChannelN]`, `keylock`, `quantize`                                | Keylock and quantize                                                    |
| `[ChannelN]`, `hotcue_1_activate`, `hotcue_1_clear`, …             | Set or jump to a hotcue, and clear it                                   |
| `[ChannelN]`, `beatloop_activate`, `beatloop_size`                 | A loop of the given number of beats                                     |
| `[ChannelN]`, `loop_in`, `loop_out`, `reloop_toggle`               | Manual loops                                                            |
| `[ChannelN]`, `beatjump_forward`, `beatjump_backward`              | Jump by `beatjump_size` beats                                           |
| `[ChannelN]`, `LoadSelectedTrack`, `eject`                         | Load the selected track, and eject it                                   |
| `[ChannelN]`, `orientation`                                        | Crossfader side: 0 left, 1 center, 2 right                              |
| `[EqualizerRack1_[ChannelN]_Effect1]`, `parameter1` … `parameter3` | Low, mid and high EQ; `button_parameter1` … `3` kill each band          |
| `[QuickEffectRack1_[ChannelN]]`, `super1`, `enabled`               | The quick effect knob and its switch                                    |
| `[Master]`, `crossfader`                                           | The crossfader, from -1 (left) to 1 (right)                             |
| `[Master]`, `gain`, `headGain`, `headMix`, `booth_gain`            | Main volume, headphone volume, headphone cue/main mix, booth volume     |
| `[Library]`, `MoveVertical`, `GoToItem`, `MoveFocusForward`        | Scroll the library, open or load the selected item, move the focus      |
| `[AutoDJ]`, `enabled`, `fade_now`, `skip_next`                     | Turn Auto DJ on, fade to the next track now, skip the next track        |

## Controller engine versions

The root element of a mapping file carries two attributes:

- **`schemaVersion`** is the version of the XML format. It is `1`.
- **`mixxxVersion`** is the version of the controller engine the mapping was
  written for, with `+` for "this version or later", for example `2.1.0+`.
  The attribute keeps that name in Crate Decks so that existing mappings
  load unchanged.

Crate Decks' controller engine is version 2.7. It loads mappings written for
2.7 and earlier versions; it does not refuse a mapping because of its
`mixxxVersion`, so a mapping written for a later engine may load but use
functions that this one does not have.
