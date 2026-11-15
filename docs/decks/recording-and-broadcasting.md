---
title: Recording and broadcasting
summary: Record your mix to a file and stream it live to an Icecast or Shoutcast server.
section: decks
audience: [user]
status: canonical
order: 80
verified: 2026-11-10
sources:
  - crate-decks:src/preferences/dialog/dlgprefrecord.cpp
  - crate-decks:src/preferences/dialog/dlgprefrecorddlg.ui
  - crate-decks:src/encoder/encoder.cpp
  - crate-decks:src/library/recording/dlgrecording.cpp
  - crate-decks:src/preferences/dialog/dlgprefbroadcast.cpp
  - crate-decks:src/preferences/dialog/dlgprefbroadcastdlg.ui
  - crate-decks:src/preferences/broadcastprofile.cpp
  - crate-decks:src/widget/wmainmenubar.cpp
  - crate-decks:src/soundio/soundmanagerutil.cpp
---

# Recording and broadcasting

Crate Decks can record what you play to a file and stream it live at the same
time. Both use the main mix, or the **Record/Broadcast** input when you mix
on an external mixer (see
[Output and input devices](sound.md#output-and-input-devices)).

## Recording

Start and stop a recording with **Options › Record Mix** (Ctrl+R), with the
recording button of the skin, or with **Start Recording** in **Recordings**,
in the Local section of the sidebar. **Recordings** also lists your
recordings, and you can load them into a deck like any other track.

**Preferences › Recording** sets:

- **Directory:** where recordings are saved. The default is the
  `Crate Decks/Recordings` folder inside your Music folder.
- **Output File Format:** lossless WAV, AIFF or FLAC, or lossy MP3, OGG
  Vorbis, and, depending on the build, Opus and AAC. Lossy formats have a
  quality setting, and FLAC a compression level.
- **Channels:** stereo or mono.
- **Tags:** the title, author and album written into the file, and
  **Store the tracklist as comment**.
- **Split recordings at:** start a new file at a size (650 MB, 700 MB, 1 GB,
  2 GB, 4 GB) or a duration (60, 74, 80 or 120 minutes), or never.
- **Create a CUE file:** writes a CUE sheet next to the recording with the
  time each track started, so that a player can show the tracklist.
  **Enable File Annotation in CUE file** also writes the path of each track.

If you use [Direct monitor](sound.md#microphones) for your microphone, set
[Microphone latency compensation](sound.md#microphone-latency-compensation),
or your voice will be out of time with the music in the recording.

## Broadcasting

Crate Decks streams your mix to an Icecast or Shoutcast server, which your
listeners connect to. You need an account on such a server, or your own.

1. Open **Preferences › Live Broadcasting**.
2. Create a source connection with **Create new connection**, or select an
   existing one. You can keep several, for example one per server, and use
   them at the same time.
3. In **Server connection**, choose the **Type** (Icecast 2, Shoutcast 1 or
   Icecast 1) and enter the **Host**, **Port**, **Mount** point, **Login**
   and **Password** your server gave you.
4. In **Encoding**, choose the **Format** (MP3, Ogg Vorbis, and depending on
   the build Opus, AAC, HE-AAC or HE-AACv2), the **Bitrate** and the
   **Channels**.
5. Optionally fill in **Stream info** (stream name, website, description,
   genre, and whether the stream is public) and **Metadata** (the track
   information sent to listeners, `$artist - $title` by default).
6. Check **Turn on Live Broadcasting when applying these settings**, or use
   **Options › Enable Live Broadcasting** (Ctrl+L), to start.

More options:

- **Password storage:** keep the password in plain text in the settings, or
  in the system keychain (**Secure storage (OS keychain)**).
- **Automatic reconnect:** reconnect after the connection drops, with a wait
  before the first attempt, a period between attempts, and an optional
  maximum number of retries.
- **Disconnect all** stops every connection.

The same advice about [microphone latency](sound.md#microphone-latency-compensation)
applies to broadcasts.
