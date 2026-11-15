---
title: Crate Decks user manual
summary: Start Crate Decks, connect it to your Crate server and find your way around the desktop DJ app.
section: decks
audience: [user]
status: canonical
order: 10
verified: 2026-11-10
sources:
  - crate-decks:src/crate/appidentity.h
  - crate-decks:src/crate/ui/cratefirstrun.cpp
  - crate-decks:src/crate/ui/cratefirstrun.h
  - crate-decks:src/crate/crateaddserverflow.h
  - crate-decks:src/crate/crateaddserverflow.cpp
  - crate-decks:src/crate/client/crateserveraddress.h
  - crate-decks:src/crate/ui/crateaddserverwidget.cpp
  - crate-decks:src/crate/ui/dlgprefcrate.cpp
  - crate-decks:src/util/cmdlineargs.cpp
  - crate-decks:src/widget/wmainmenubar.cpp
  - crate-decks:src/preferences/dialog/dlgpreferences.cpp
  - crate-decks:src/preferences/dialog/dlgpreflibrarydlg.ui
  - crate-decks:src/controllers/dlgprefcontrollersdlg.ui
  - crate-decks:CMakeLists.txt
  - docs/technical/crate-decks.md
---

# Crate Decks user manual

Crate Decks is a desktop DJ app that uses your Crate server as its library.
It gives you decks, a mixer with equalizers and effects, Auto DJ, controller
and keyboard control, vinyl control, recording and live broadcasting, and a
Crate section in the library sidebar with your server's tracks and
containers.

Crate Decks is based on Mixxx and is free software under the GNU General
Public License, version 2 or later. Its source code is at
[github.com/thecrateapp/crate-decks](https://github.com/thecrateapp/crate-decks),
and **Help › About** links to the source of the build you are running.

This manual has one page per topic:

| Page                                                        | What it covers                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| [Library and search](library.md)                            | The Crate section, local music, search syntax, library settings |
| [Decks and mixing](mixing.md)                               | Cue modes, sync lock, equalizers, Auto DJ                       |
| [Track analysis](analysis.md)                               | Crate's analysis, beat and key detection                        |
| [Sound hardware](sound.md)                                  | Sound API, outputs and inputs, latency, microphones             |
| [Controllers](controllers.md)                               | Using, mapping and scripting MIDI and HID controllers           |
| [Keyboard shortcuts](keyboard-shortcuts.md)                 | The default keyboard mapping                                    |
| [Recording and broadcasting](recording-and-broadcasting.md) | Recording your mix and streaming it live                        |
| [Vinyl control](vinyl-control.md)                           | Timecode vinyl and CDs                                          |
| [Help and community](community.md)                          | Questions, bug reports, translations, sharing mappings          |

## Getting started

Start Crate Decks from your desktop's application menu. On Linux you can also
run `crate-decks` in a terminal (see [Command line options](#command-line-options)).

The first time it starts, Crate Decks opens a short setup dialog with three
steps:

1. **Connect your Crate.** Type the address of your Crate server and sign in
   (see [Connecting to Crate](#connecting-to-crate)). **Not now** skips this
   step; you can add a server later in **Preferences › Crate**.
2. **Sound.** Choose the output for the main mix. Crate Decks opens it right
   away. **More options** opens **Preferences › Sound Hardware**, where you
   also set up headphones, booth and inputs (see [Sound hardware](sound.md)).
   If no output device is found, connect a sound card and choose
   **Search again**, or continue without sound: the decks play nothing until
   there is an output.
3. **Music on this computer** (optional). Your Crate is the library, but you
   can also play files from this computer. Choose **Add folder** for each
   music folder; Crate Decks scans them in the background. Nothing is added
   until you choose a folder. You can change the folders later in
   **Preferences › Library**.

Once you are in:

- **Preferences** are in **Options › Preferences** (Ctrl+P; on macOS, the
  application menu and Cmd+,). The **Help** button of each Preferences page
  opens the matching page of this manual.
- **The menu bar** is hidden by default on Linux and Windows. Press Alt once
  to show it. **Preferences › Interface › Menu bar** turns the auto-hide off.
- **The library** fills the lower part of the window. The sidebar has a
  **Crate** section with your server's library and a **Local** section with
  the music on this computer, Auto DJ, playlists, crates, history and
  recordings (see [Library and search](library.md)).
- **Loading a track:** drag a track from the library onto a deck,
  double-click it (**Preferences › Library** sets what a double-click does),
  or select it and press Shift+Left (deck 1) or Shift+Right (deck 2). In this version you browse and search the Crate section, but you
  play tracks from **Local** music; loading Crate tracks into the decks
  comes in a later version.

## Connecting to Crate

Crate Decks talks to your Crate server over HTTPS and signs in with your
Crate account. You can connect more than one server.

To add a server, go to **Preferences › Crate** and choose
**Add a server…** (or use the first-start dialog):

1. **Server address.** Type the address as you would in a browser, for
   example `crate.example.com`, `https://crate.example.com` or
   `http://192.168.1.10:8585`. Without a scheme, HTTPS is assumed. Only the
   host and port are kept.
   - HTTPS works everywhere.
   - HTTP works without asking for this computer (`localhost`, `127.0.0.1`).
   - HTTP on your local network (for example `192.168.x.x`, `10.x.x.x`, a
     name without a dot, or a name ending in `.local`, `.lan`, `.home.arpa`
     or `.internal`) asks you to confirm first, because your password and
     your session would cross the network without encryption. Choose
     **Connect without encryption** only on a network you trust.
   - HTTP anywhere else is refused.
2. **Connect.** Crate Decks checks that the address is a Crate server and
   that the server accepts this version of Crate Decks. If it does not, the
   message says what to do:
   - _This does not look like a Crate server._ Check the address.
   - _This Crate server does not accept Crate Decks._ The server is too old
     or its administrator has not enabled Crate Decks.
   - _This Crate server needs a newer Crate Decks._ Update Crate Decks.
   - _This Crate server and this Crate Decks do not speak the same
     version._ Update whichever is older.
3. **Sign in** with your Crate email and password, or choose
   **Sign in with Google** or **Sign in with Apple**. Those two open your
   web browser: finish signing in there, then come back to Crate Decks.

Your session is kept in the system keychain (Keychain on macOS, Credential
Manager on Windows, Secret Service on Linux), never in the settings
directory. If the keychain is not available, Preferences says so and you
have to sign in again after Crate Decks restarts.

**Preferences › Crate** lists your servers and their state. To stop using a
server, choose **Sign out and remove** on its row.

## Hardware compatibility

Crate Decks works with the sound cards, DJ controllers and turntables that
your operating system supports. What you need depends on how you mix:

- **Headphone cueing** needs a second stereo output besides the main mix:
  a DJ controller with a built-in audio interface, or a sound card with at
  least four output channels. A laptop's built-in sound card alone gives you
  the main mix only. See
  [Output and input devices](sound.md#output-and-input-devices).
- **Controllers** send MIDI or HID messages over USB. Crate Decks ships
  mappings for many controllers; any other MIDI controller can be mapped with
  the MIDI Learning Wizard. See [Controllers](controllers.md).
- **Vinyl control** needs one stereo input per turntable or CD player and
  timecode media. See [Vinyl control](vinyl-control.md).
- **An external mixer** needs one stereo output per deck. See
  [Output and input devices](sound.md#output-and-input-devices).

## Settings directory

The settings directory holds the library database, the configuration files,
the log files, track analysis data and your own controller mappings and
keyboard mapping. Your Crate sessions are not there: they are in the system
keychain.

| System  | Default location                       |
| ------- | -------------------------------------- |
| Linux   | `~/.cratedecks/`                       |
| Windows | `%LOCALAPPDATA%\Crate\Crate Decks\`    |
| macOS   | Shown by **Help › Settings directory** |

To open it, choose **Help › Settings directory**, or
**Open Crate Decks Settings Folder** in **Preferences › Library**.
`crate-decks --help` also prints the default location.

- Edit files there only if you know what you are doing, and only while
  Crate Decks is not running.
- To back up your library, playlists and settings, quit Crate Decks and copy
  the whole folder.
- To use another settings directory, for example a separate profile for
  testing, start Crate Decks with `--settings-path <folder>`.

## Command line options

Crate Decks accepts these options when you start it from a terminal. Run
`crate-decks --help` for the list that your build supports.

| Option                          | What it does                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `<file> …`                      | Loads each music file into the next deck at start-up                                             |
| `-f`, `--full-screen`           | Starts in full-screen mode                                                                       |
| `--locale <locale>`             | Uses another language for the interface, for example `fr`                                        |
| `--start-autodj`                | Starts Auto DJ when Crate Decks opens                                                            |
| `--rescan-library`              | Rescans the local music folders at start-up                                                      |
| `--settings-path <path>`        | Uses another [settings directory](#settings-directory)                                           |
| `--resource-path <path>`        | Uses another folder for resource files such as controller mappings                               |
| `--safe-mode`                   | Turns off OpenGL waveforms and spinning vinyl widgets; try it if Crate Decks crashes on start-up |
| `--controller-debug`            | Logs all controller data received and the script functions loaded                                |
| `--controller-abort-on-warning` | Makes controller scripts fail on API misuse; use it while writing a mapping                      |
| `--controller-preview-screens`  | Previews rendered controller screens in Preferences                                              |
| `--developer`                   | Developer mode: extra log information, performance statistics and a Developer menu               |
| `--stats`                       | Collects performance statistics                                                                  |
| `--timeline-path <path>`        | Writes the debug statistics timeline to this file                                                |
| `--log-level <level>`           | Terminal log verbosity: `critical`, `warning`, `info`, `debug` or `trace`                        |
| `--log-flush-level <level>`     | Level at which the log buffer is written to the log file                                         |
| `--log-max-file-size <bytes>`   | Maximum size of the log file; `-1` for unlimited; the default is 100 MB                          |
| `--color <auto\|always\|never>` | Colors in the terminal output                                                                    |
| `--style <style>`               | Overrides the application's widget style                                                         |
| `--enable-legacy-vumeter`       | Uses the legacy VU meter                                                                         |
| `--enable-legacy-spinny`        | Uses the legacy spinning vinyl widget                                                            |
| `--debug-assert-break`          | Stops Crate Decks (SIGINT) when an internal check fails, for debugging                           |
| `-h`, `--help`                  | Shows the options and the default settings directory                                             |
| `-v`, `--version`               | Shows the version                                                                                |

## Getting help

- **Help › User Manual** opens this manual, and **Help › Keyboard Shortcuts**
  opens [Keyboard shortcuts](keyboard-shortcuts.md).
- **Help › Community Support** opens [Help and community](community.md),
  which explains where to ask questions and how to
  [report a bug](community.md#reporting-bugs).
- **Help › About** shows the version of Crate Decks; include it when you ask
  for help.
