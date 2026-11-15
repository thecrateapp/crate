---
title: Library and search
summary: Browse your Crate server and the music on this computer, search with filters and set the library preferences.
section: decks
audience: [user]
status: canonical
order: 20
verified: 2026-11-10
sources:
  - crate-decks:src/library/crateserver/crateserverfeature.h
  - crate-decks:src/library/crateserver/crateserverfeature.cpp
  - crate-decks:src/library/crateserver/crateservertrackmodel.h
  - crate-decks:src/library/crateserver/crateservertrackmodel.cpp
  - crate-decks:src/crate/ui/skin/librarystyle.cpp
  - crate-decks:src/crate/ui/delegates/sidebardelegate.h
  - crate-decks:src/library/library.cpp
  - crate-decks:src/library/searchqueryparser.cpp
  - crate-decks:src/library/searchquery.cpp
  - crate-decks:src/library/librarycontrol.cpp
  - crate-decks:src/widget/wmainmenubar.cpp
  - crate-decks:src/preferences/dialog/dlgpreflibrarydlg.ui
  - crate-decks:src/preferences/dialog/dlgpreflibrary.cpp
  - docs/technical/crate-decks.md
---

# Library and search

The library fills the lower part of the Crate Decks window: a sidebar on the
left and a track table on the right. The sidebar has two sections:

- **Crate**, with the library of each Crate server you are signed in to.
- **Local**, with the music on this computer and everything that works on
  it: Tracks, Auto DJ, Playlists, Crates, Computer, Recordings, History and
  Analyze.

## The Crate section

With one server, the section is titled **Crate · `<server>`** and lists that
server's library directly. With several servers, each one is an item of its
own with the same entries inside. **Genres**, **Moods**, **Recent** and
**Likes** appear only when the server serves them.

| Entry         | What it shows                                                            |
| ------------- | ------------------------------------------------------------------------ |
| **Library**   | The server's whole library, with its track count                         |
| **Playlists** | Your Crate playlists, with the number of playlists and of tracks in each |
| **Crates**    | The crates on your Crate server                                          |
| **Genres**    | The library by genre                                                     |
| **Moods**     | The library by mood                                                      |
| **Recent**    | The tracks you played most recently in Crate, newest first               |
| **Likes**     | The tracks you liked in Crate, newest first                              |

Crate Decks keeps a copy of the server's library tree and track list on this
computer, so the sidebar and the tables open at once. The first time you open
a server in a session, Crate Decks checks it and fetches what changed, and
from then on it follows the server's changes by itself. To fetch again by
hand, right-click the server and choose **Refresh**.

The Crate track table has the columns **Title**, **Artist**, **BPM**,
**Key**, **Duration**, **Nrg**, **Genre**, **Profile**, **Cache**, **Album**,
**Bitrate**, **Type** and **Samplerate**. **BPM**, **Key** (in Camelot
notation), **Nrg** and **Profile** come from Crate's analysis; see
[Analysis from Crate](analysis.md#analysis-from-crate). Click a column header
to sort by it.

The Crate section is read-only: you edit your Crate playlists and crates in
Crate itself. In this version you can browse and search the Crate section,
but you cannot load its tracks into a deck yet; that comes with the audio
cache in a later version. Play your [local music](#local-music) in the
meantime.

The server must be recent enough to support Crate Decks; see
[Connecting to Crate](user-manual.md#connecting-to-crate).

## Local music

The **Local** section is the library of music files on this computer:

- **Tracks** lists every track in your music folders. Add or remove folders
  in **Preferences › Library › Music Directories**, or in the first-start
  dialog. Crate Decks scans new folders in the background, and
  **Library › Rescan Library** (Ctrl+Shift+L) scans them again.
- **Auto DJ** is the queue that Auto DJ plays; see [AutoDJ](mixing.md#autodj).
- **Playlists** and **Crates** are your own collections on this computer.
  A track is in a playlist in a given order, possibly more than once; a
  crate is an unordered set. **Library › Create New Playlist** (Ctrl+N) and
  **Library › Create New Crate** (Ctrl+Shift+N) create them.
- **Computer** browses the folders of this computer directly, including
  folders that are not in your library.
- **Recordings** lists the mixes you recorded; see
  [Recording](recording-and-broadcasting.md#recording).
- **History** keeps a playlist of what you played in each session.
- **Analyze** runs beat, key and waveform analysis on many tracks at once;
  see [Track analysis](analysis.md).

You can also show the libraries of other music and DJ applications here
(Rhythmbox, Banshee, iTunes, Traktor, Rekordbox and Serato) in
**Preferences › Library › External Libraries**. They are read-only.

To load a local track, drag it onto a deck, double-click it, or select it
and press Shift+Left (deck 1) or Shift+Right (deck 2). Press R to rename the
selected sidebar item, or to edit the selected cell in the track table.

## Searching

The search box above the track table searches the view you are in.
**Library › Search in Current View...** (Ctrl+F) jumps to it, and
**Library › Search in Tracks Library...** (Ctrl+Shift+F) searches all your
local tracks.

### In the Crate section

Type one or more words. A track matches when every word appears in its
title, artist, album or genre. Case does not matter, and field filters are
not available here yet.

### In the Local section

Plain words search all the main track fields and the names of the crates a
track is in. A track must match every word. You can refine a search:

| Syntax               | Meaning                                  | Example              |
| -------------------- | ---------------------------------------- | -------------------- |
| `field:text`         | The field contains the text              | `artist:moderat`     |
| `field:"two words"`  | The field contains the exact phrase      | `album:"live at"`    |
| `field:="text"`      | The field is exactly the text            | `genre:="techno"`    |
| `field:""`           | The field is empty                       | `genre:""`           |
| `-term`              | Excludes tracks that match               | `-genre:ambient`     |
| `a \| b` or `a OR b` | Either term matches                      | `bpm:120 \| bpm:128` |
| `field:>n`           | Greater than (also `<`, `>=`, `<=`, `=`) | `rating:>=4`         |
| `field:n-m`          | A range, both ends included              | `bpm:120-128`        |
| `~bpm:n`             | Fuzzy BPM: within a percentage of _n_    | `~bpm:124`           |
| `key:k`              | The key, in any notation                 | `key:8A`, `key:Am`   |
| `~key:k`             | Keys that mix harmonically with _k_      | `~key:8A`            |

Fields you can filter on:

| Field          | Short form | Kind                                                  |
| -------------- | ---------- | ----------------------------------------------------- |
| `artist`       | `a`        | Text (artist or album artist)                         |
| `album_artist` | `aa`       | Text                                                  |
| `album`        | `al`       | Text                                                  |
| `title`        | `t`        | Text                                                  |
| `genre`        | `g`        | Text                                                  |
| `composer`     | `cp`       | Text                                                  |
| `grouping`     | `gr`       | Text                                                  |
| `comment`      | `cm`       | Text                                                  |
| `location`     | `lo`       | Text (file path)                                      |
| `directory`    | `dir`      | Text (folder)                                         |
| `crate`        | `c`        | Text (crate name)                                     |
| `type`         |            | Text (file type, for example `flac`)                  |
| `track`        | `tr`       | Number (track number)                                 |
| `played`       | `pl`       | Number (times played)                                 |
| `rating`       | `r`        | Number (0 to 5)                                       |
| `bitrate`      | `br`       | Number (kbit/s)                                       |
| `year`         | `y`        | Number                                                |
| `bpm`          | `b`        | Number                                                |
| `key`          | `k`        | Key                                                   |
| `duration`     | `du`       | Time: `3:30`, `3m`, `210s`; for example `du:<4:00`    |
| `added`        | `ad`       | Date (`YYYY-MM-DD`); for example `added:>=2026-01-01` |

The range of a fuzzy BPM search (`~bpm:`) is a percentage of the speed
slider range, set in **Preferences › Library › Track Search**.

## Library preferences

**Preferences › Library** has these groups:

- **Music Directories:** add, relink or remove the folders of your local
  library. **Rescan directories on start-up** and
  **Show scan summary dialog** control scanning.
- **Audio File Formats:** the formats this build can play.
- **Track Metadata Synchronization / Playlists:** whether Crate Decks reads
  and writes track metadata from and to the file tags (also for Serato
  metadata, experimental), and whether exported playlists use relative paths.
- **Track Table View:** what a double-click on a track does (load it into
  the next available deck, add it to the top or bottom of the Auto DJ queue,
  or nothing), editing metadata by clicking a selected track, row height,
  font, BPM decimals, the date format, and greying out tracks already played.
- **Track Search:** the search-as-you-type delay, search completions, search
  history shortcuts, and the percentage of the speed slider range used by
  fuzzy BPM searches.
- **Sidebar:** how long to hover over an item before it expands.
- **Session History:** how far apart a repeated track must be to be logged
  again, and the minimum number of tracks for a history playlist to be kept.
- **External Libraries:** which other applications' libraries the Local
  section shows. Restart Crate Decks after changing them.
- **Preferred Cover Art Fetcher Resolution:** the cover size fetched when you
  import metadata from MusicBrainz.
- **Settings Directory:** opens the
  [settings directory](user-manual.md#settings-directory).

The Crate section does not use these folders or the scanner: its tracks come
from your Crate server.
