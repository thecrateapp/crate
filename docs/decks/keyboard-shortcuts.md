---
title: Keyboard shortcuts
summary: The default keyboard mapping of Crate Decks for the decks, the mixer, Auto DJ, the library and the menus.
section: decks
audience: [user]
status: canonical
order: 70
verified: 2026-11-10
sources:
  - crate-decks:res/keyboard/en_US.kbd.cfg
  - crate-decks:src/widget/wmainmenubar.cpp
  - crate-decks:src/controllers/keyboard/keyboardeventfilter.cpp
  - crate-decks:src/coreservices.cpp
  - crate-decks:src/library/librarycontrol.cpp
  - crate-decks:src/library/autodj/dlgautodj.cpp
---

# Keyboard shortcuts

Crate Decks can be played from the keyboard. The tables below are the
default mapping for a US English keyboard layout:

- The left half of the keyboard controls deck 1 and the right half deck 2.
  Decks 3 and 4 have no default keys.
- Shifted keys are listed by the key you press: Shift+2 is the key that
  types `@` on a US keyboard.
- On macOS, Ctrl in the menu shortcuts is the Command key.
- **Options › Enable Keyboard Shortcuts** (Ctrl+`` ` ``) turns the keyboard
  mapping on and off.

Crate Decks picks the mapping for your keyboard layout when one ships with
it: Czech, Danish, English (US), Finnish, French, German, Greek, Italian,
Russian, Spanish, Swiss French and Swiss German. On other layouts it uses the
US English mapping.

To change the keys, copy the mapping file of your layout from the
`keyboard` folder of the installation to your
[settings directory](user-manual.md#settings-directory) as
`Custom.kbd.cfg`, and edit it while Crate Decks is not running. Each line is
a [control](controllers.md#controls) and a key, under the control's group:

```text
[Channel1]
play d
```

## Decks

| Action                                              | Deck 1         | Deck 2          |
| --------------------------------------------------- | -------------- | --------------- |
| Play or pause                                       | D              | L               |
| Cue (as set by the [cue mode](mixing.md#cue-modes)) | F              | ;               |
| Set the cue point                                   | Shift+D        | Shift+L         |
| Go to the cue point and stop                        | Shift+F        | Shift+;         |
| Sync (hold for [sync lock](mixing.md#sync-lock))    | 1              | 6               |
| Tap the tempo                                       | Shift+1        | Shift+6         |
| Headphone cue                                       | T              | Y               |
| Load the selected track                             | Shift+Left     | Shift+Right     |
| Eject the track                                     | Alt+Shift+Left | Alt+Shift+Right |

## Hotcues

| Action         | Deck 1  | Deck 2  |
| -------------- | ------- | ------- |
| Hotcue 1       | Z       | M       |
| Hotcue 2       | X       | ,       |
| Hotcue 3       | C       | .       |
| Hotcue 4       | V       | /       |
| Clear hotcue 1 | Shift+Z | Shift+M |
| Clear hotcue 2 | Shift+X | Shift+, |
| Clear hotcue 3 | Shift+C | Shift+. |
| Clear hotcue 4 | Shift+V | Shift+/ |

A hotcue key sets the hotcue at the current position when it is empty, and
jumps to it when it is set.

## Loops and beat jumps

| Action                                    | Deck 1  | Deck 2  |
| ----------------------------------------- | ------- | ------- |
| Beat loop (of the selected size)          | Q       | U       |
| Beat loop roll (while held)               | Shift+Q | Shift+U |
| Halve the loop                            | W       | I       |
| Double the loop                           | E       | O       |
| Loop in                                   | 2       | 7       |
| Go to the loop in point                   | Shift+2 | Shift+7 |
| Loop out                                  | 3       | 8       |
| Go to the loop out point                  | Shift+3 | Shift+8 |
| Turn the loop on or off (reloop)          | 4       | 9       |
| Go to the loop start and stop             | Shift+4 | Shift+9 |
| Beat jump backward (by the selected size) | A       | J       |
| Beat jump backward by 1 beat              | Shift+A | Shift+J |
| Beat jump forward (by the selected size)  | S       | K       |
| Beat jump forward by 1 beat               | Shift+S | Shift+K |

## Speed

| Action                                  | Deck 1   | Deck 2   |
| --------------------------------------- | -------- | -------- |
| Lower the speed                         | F1       | F5       |
| Raise the speed                         | F2       | F6       |
| Lower the speed while held (pitch bend) | F3       | F7       |
| Raise the speed while held (pitch bend) | F4       | F8       |
| Lower the speed, small step             | Shift+F1 | Shift+F5 |
| Raise the speed, small step             | Shift+F2 | Shift+F6 |
| Pitch bend down, small step             | Shift+F3 | Shift+F7 |
| Pitch bend up, small step               | Shift+F4 | Shift+F8 |

## Mixer and effects

| Action                              | Key     |
| ----------------------------------- | ------- |
| Crossfader to the left              | G       |
| Crossfader to the right             | H       |
| Crossfader to the left, small step  | Shift+G |
| Crossfader to the right, small step | Shift+H |
| Kill the low EQ of deck 1           | B       |
| Kill the low EQ of deck 2           | N       |
| Quick effect of deck 1 on or off    | 5       |
| Quick effect of deck 2 on or off    | 0       |
| Microphone talkover                 | `` ` `` |

## Vinyl control

| Action                                                 | Deck 1       | Deck 2       |
| ------------------------------------------------------ | ------------ | ------------ |
| Passthrough: play the turntable's own audio            | Ctrl+J       | Ctrl+K       |
| Next vinyl control mode (absolute, relative, constant) | Ctrl+Shift+Y | Ctrl+Shift+U |
| Next vinyl cueing mode                                 | Ctrl+Alt+Y   | Ctrl+Alt+U   |

**Options › Vinyl Control** turns vinyl control on for decks 1 to 4 with
Ctrl+T, Ctrl+Y, Ctrl+U and Ctrl+I. See [Vinyl control](vinyl-control.md).

## Auto DJ

| Action                           | Key       |
| -------------------------------- | --------- |
| Auto DJ on or off                | Shift+F12 |
| Fade to the next track now       | Shift+F11 |
| Skip the next track in the queue | Shift+F10 |
| Shuffle the queue                | Shift+F9  |

## Preview deck

| Action                              | Key       |
| ----------------------------------- | --------- |
| Load the selected track and play it | P         |
| Stop and go back to the start       | Shift+P   |
| Rewind while held                   | Alt+Left  |
| Fast forward while held             | Alt+Right |

## Library

| Action                                                      | Key          |
| ----------------------------------------------------------- | ------------ |
| Search in the current view                                  | Ctrl+F       |
| Search in the whole local library                           | Ctrl+Shift+F |
| Rename the selected sidebar item, or edit the selected cell | R            |
| Maximize the library                                        | Space        |
| New playlist                                                | Ctrl+N       |
| New crate                                                   | Ctrl+Shift+N |
| Rescan the local library                                    | Ctrl+Shift+L |

## Menus and windows

| Action                         | Key                   |
| ------------------------------ | --------------------- |
| Preferences                    | Ctrl+P (macOS: Cmd+,) |
| Load a file into deck 1        | Ctrl+O                |
| Load a file into deck 2        | Ctrl+Shift+O          |
| Full screen                    | F11                   |
| Show the skin settings         | Ctrl+1                |
| Show the microphone section    | Ctrl+2                |
| Show the vinyl control section | Ctrl+3                |
| Show the preview deck          | Ctrl+4                |
| Show cover art                 | Ctrl+6                |
| Show Auto DJ                   | Ctrl+9                |
| Show the keywheel              | F12                   |
| Record the mix                 | Ctrl+R                |
| Live broadcasting on or off    | Ctrl+L                |
| Keyboard shortcuts on or off   | Ctrl+`` ` ``          |
| Quit                           | Ctrl+Q                |

With `--developer`, the **Developer** menu adds Ctrl+Shift+R (reload the
skin), Ctrl+Shift+T (developer tools), Ctrl+Shift+E and Ctrl+Shift+B
(statistics) and Ctrl+Shift+D (debugger).
