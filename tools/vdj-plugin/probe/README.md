# VH01 host probe

Development-only Online Source that answers the ten questions of plan task VH01
(`docs/technical/smart-mix-implementation-plan.md` §6). It is never packaged and
only talks to a local server on `127.0.0.1:8765`: no Crate server, no tokens.

Requirements: VirtualDJ 8 with a **Pro** license (Online Sources are Pro-only),
macOS arm64, the private SDK headers and the repository virtualenv for the
Python scripts.

## Build

```sh
cmake -S tools/vdj-plugin -B /tmp/vdj-probe \
  -DCRATE_VDJ_BUILD_PROBE=ON \
  -DCRATE_VDJ_BUILD_REAL_PLUGIN=OFF \
  -DCRATE_VDJ_BUILD_TESTS=OFF \
  -DVirtualDJSDK_ROOT=/Users/diego/SDKs/virtualdj/virtualdj-plugins-examples/online-source-plugin
cmake --build /tmp/vdj-probe --target crate_vdj_probe
```

The bundle is `/tmp/vdj-probe/probe/CrateProbe.bundle`.

## Install

Quit VirtualDJ, then:

```sh
cp -R /tmp/vdj-probe/probe/CrateProbe.bundle \
  "$HOME/Library/Application Support/VirtualDJ/PluginsMacArm/OnlineSources/"
```

The bundle file is `CrateProbe` and the plugin name is `Crate Probe` on purpose:
the deck path in check 10 shows which of the two VirtualDJ uses for
`netsearch://plugin-<name>/<id>` (this decides plan finding R26).

## Start the local server

In a terminal that stays open during the session:

```sh
/Volumes/MacData/Projects/Ninja/musicdock/.venv/bin/python \
  tools/vdj-plugin/probe/probe_server.py --ticket-ttl 20 --throttle-kbps 1500
```

The first start generates the test WAV files (30 s, 6 min) under
`~/Library/Application Support/VirtualDJ/CrateProbe/media/`. Stream URLs carry a
ticket that expires 20 s after `GetStreamUrl`; the 6 min file is throttled to
1.5 MB/s so its download outlives the ticket.

Logs, one JSON line per event, go to the same folder:
`probe.jsonl` (plugin) and `server.jsonl` (HTTP requests).

## Session script (about 15 minutes)

Start VirtualDJ and open **Online Music → Crate Probe**. Note anything visible
in the right-hand column of the summary table.

1. **Threads, async folders (check 1).** Open `1 Sync folder`, then
   `2 Async folder`. Look for: do the two async tracks appear after about 1 s?
2. **Hierarchical folders (check 4).** Look at the folder list: do `3 Tree/a/b`
   and `4 Tree > child` show as nested folders or as flat names?
3. **Search (checks 1 and 9).** Search `probe` (sync), then `async probe`
   (results after 1 s?). Search `slow probe` and, while it waits, type a new
   search: VirtualDJ should call `OnSearchCancel`.
4. **Streams (check 2).** Load `HTTP short 30s` on deck 1 and play it. Seek to
   the end and back. Then load `HTTP long throttled 6min` on deck 2, wait until
   the waveform/download completes (more than 20 s), and seek around: with an
   expired ticket, does VirtualDJ request again (401 in `server.jsonl`)?
   Stop the server for 10 s while deck 2 plays, seek, start it again.
   Reload the same track on deck 2.
5. **Local files (check 3).** Load `Local absolute path` and `Local file:// URL`.
   Which of them loads and plays?
6. **Deck path (check 10).** Right-click a loaded probe track →
   `Probe: log deck state (callback thread)`.
7. **Automix (check 7).** Right-click `HTTP short 30s` →
   `Probe: automix_add_next this track`, then `Probe: playlist_add this track`.
   Does the track appear in the automix / sidelist queue? Start automix: does
   it load and mix it?
8. **Login (check 5).** Use the source's login button if VirtualDJ shows one.
   Does the "Crate Probe login" window open? Press `Simulate connect`: does the
   source switch to logged in? Log out again.
9. **VDJScript from a plugin thread (check 6).** Right-click a track →
   `Probe: start background queries` (deck state is then logged every 30 s from
   the plugin's own thread), `Probe: SendCommand pitch_reset (callback thread)`
   and `Probe: SendCommand pitch_reset (background thread)`. Note any freeze or
   crash: that is the result.
10. **Long session (check 8).** Browse other sources (local folders, another
    online catalog) for 5 minutes; heartbeats should keep coming every 30 s.
11. **Release and restart (check 9).** Start `slow probe` again and quit
    VirtualDJ while it waits. Start VirtualDJ again and open the source once.

## Summarize

```sh
/Volumes/MacData/Projects/Ninja/musicdock/.venv/bin/python \
  tools/vdj-plugin/probe/summarize_probe.py
```

It prints a Markdown table with the log evidence per check and an empty
"Observed in VDJ" column. Fill that column with what you saw, add the VirtualDJ
version (`get_version` appears in the deck-state evidence) and paste the table
into §8 of the plan.

## Uninstall

```sh
rm -rf "$HOME/Library/Application Support/VirtualDJ/PluginsMacArm/OnlineSources/CrateProbe.bundle"
rm -rf "$HOME/Library/Application Support/VirtualDJ/CrateProbe"
```

## Tests

```sh
/Volumes/MacData/Projects/Ninja/musicdock/.venv/bin/python -m pytest -q tools/vdj-plugin/probe/tests
```
