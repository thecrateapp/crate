> **SUSTITUIDO — 2026-09-09. Documento histórico, no usar para continuar el desarrollo.**
> Las únicas guías vigentes de Smart Mix, crossfade Android nativo y VirtualDJ
> son el [diseño unificado](../../../../docs/technical/smart-mix-design.md) y el
> [plan de implementación](../../../../docs/technical/smart-mix-implementation-plan.md). Sus contratos, tareas y gates sustituyen
> los de este documento, incluso cuando el texto histórico diga aprobado o completo.
> El contenido inferior se conserva como evidencia del spike; no es una guía operativa vigente.

# VirtualDJ control spike contract

This document is the manual gate for the Task 2 SDK proof. It must be updated
with the VirtualDJ version, host architecture and observed result before the
spike is treated as production-safe.

## Local build gate

- [x] CMake can discover vdjPlugin8.h and vdjOnlineSource.h through
      VIRTUALDJ_SDK_ROOT.
- [x] The macOS bundle target compiles with the private SDK.
- [x] The headless target configures and builds without the SDK.
- [x] A local dlopen/mock-callback harness loads both exported plugin
      interfaces and exercises command, state, search, cancellation and unload
      paths.
- [x] The bundle has been loaded by a supported VirtualDJ installation.

## Runtime gate

Record the values below after testing on a machine with VirtualDJ installed.

```text
VirtualDJ version: 8.5.9307 (build 18.0.9583)
VirtualDJ license: Pro (reported by tester; Online Source gate still pending)
Host OS: macOS
Host architecture: arm64
Plugin bundle paths:
  ~/Library/Application Support/VirtualDJ/PluginsMacArm/AutoStart/crate_vdj_control.bundle
  ~/Library/Application Support/VirtualDJ/PluginsMacArm/OnlineSources/Crate.bundle
Control-spike log path: /private/var/folders/x1/c489k23j6331sw6dvm6qnwf40000gn/T/crate-vdj-control-spike.log
Tester: Diego / Codex
Date: 2026-08-16
```

- [x] General plugin loads in VirtualDJ without a crash.
- [ ] General plugin unloads cleanly without a crash.
- [x] Online Source bundle is discovered and its OnLoad callback is reached.
- [ ] get_deck, get_bpm, get_beatpos and get_time_ms return values.
- [ ] deck 1 play returns a successful command result.
- [ ] deck 1 sync returns a successful command result.
- [ ] deck 1 auto_bpm_transition returns a successful command result.
- [ ] deck 1 auto_crossfade returns a successful command result.
- [ ] Online Source appears under Online Music.
- [x] Online Source search returns one result and calls finish() exactly once.
- [ ] Cancelling a slow search does not call finish() after cancellation.
- [x] Stream URL resolution returns a URL and empty error message.
- [x] Online Source exposes Crate catalog folders and returns real tracks.
- [x] Track context menu registration and callback work in the headless factory contract.
- [x] Compatible tracks have a stable folder and use the current Crate deck
      track when no explicit context-menu seed was selected.
- [ ] Track context menu navigation and localized label verified in the running VirtualDJ host.
- [ ] Manual deck intervention leaves the plugin in a safe state.
- [ ] An unsupported/rejected command is recorded and does not crash VDJ.
- [ ] VirtualDJ restart does not leave a worker thread or stale callback alive.

The current development machine has the SDK, compiler toolchain and a
user-local VirtualDJ application extraction. VirtualDJ loaded the General
bundle and wrote `control spike loaded` to the log after restart. After
separating the General and Online Source factories, the host also wrote
`online source loaded` and remained running. The remaining Online Source
checks require selecting the source from the Online Music UI and executing a
real search/load flow.
