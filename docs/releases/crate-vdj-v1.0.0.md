# Crate for VirtualDJ 1.0.0

Crate for VirtualDJ 1.0.0 is the first release of the Crate Online Source for VirtualDJ
Pro. It brings your Crate library into the VirtualDJ browser and, if you allow it, keeps
VirtualDJ's automix queue filled with compatible tracks from Crate.

Crate is published under the GNU Affero General Public License v3.0 (AGPL-3.0).

## In the VirtualDJ browser

- **Search and folders.** Search your library and browse Crate folders, then load any
  track to a deck. Tracks stream from your server with a ticket that lasts a whole
  VirtualDJ session.
- **Compatible tracks.** A Compatibles folder ranks tracks for the one on the deck by
  tempo, harmony, energy and sound, with Camelot keys, BPM and energy shown in the
  browser.
- **Open in Crate.** The track menu opens the track or its album in Listen.
- **Plays.** Tracks heard for at least 30 seconds, or to the end, count in your Crate
  stats. Plays made offline wait on disk and are sent when the server answers.

## Crate Automix

While VirtualDJ's automix is on and a Crate track is playing, the plugin keeps two
compatible tracks queued, never repeating the artist of the last four tracks or an album
in that window. It needs the automation permission on the access token.

## Requirements

- VirtualDJ Pro.
- A Crate server with `CRATE_VDJ_ENABLED=true`, and `CRATE_VDJ_AUTOMATION_ENABLED=true`
  for Crate Automix.
- An access token created in Listen, under Settings, Access tokens.

## Packages

| Package                                  | Tested in VirtualDJ            |
| ---------------------------------------- | ------------------------------ |
| `Crate-VirtualDJ-macos-arm64-1.0.0.zip`  | Yes, 8.5.9307 on Apple silicon |
| `Crate-VirtualDJ-macos-x86_64-1.0.0.zip` | Not yet                        |
| `Crate-VirtualDJ-windows-x64-1.0.0.zip`  | Not yet                        |

Each archive has a `.sha256` and a `manifest-<platform>.json` with the Crate contracts it
supports and its install folder. The macOS packages are signed ad hoc and not notarized:
after unzipping `Crate.bundle` into VirtualDJ's `OnlineSources` folder, run
`xattr -dr com.apple.quarantine Crate.bundle` once. The Windows package is not signed.
