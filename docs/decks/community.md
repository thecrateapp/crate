---
title: Help and community
summary: Where to ask questions about Crate Decks, how to report a bug, and how to help with translations and controller mappings.
section: decks
audience: [user]
status: canonical
order: 100
verified: 2026-11-10
sources:
  - crate-decks:src/widget/wmainmenubar.cpp
  - crate-decks:src/util/cmdlineargs.cpp
  - crate-decks:src/util/logging.cpp
  - crate-decks:src/crate/appidentity.h
  - crate-decks:src/crate/brand/brandtranslator.cpp
  - crate-decks:src/preferences/dialog/dlgprefinterfacedlg.ui
  - crate-decks:src/controllers/dlgprefcontrollers.cpp
  - crate-decks:src/controllers/defs_controllers.h
---

# Help and community

Crate Decks is part of Crate, a free and open source project. Questions, bug
reports and contributions all go to the Crate repository on GitHub.

## Getting help

1. Look for your topic in the [Crate Decks user manual](user-manual.md) and
   its pages: [sound problems](sound.md#troubleshooting),
   [controllers](controllers.md#using-a-controller) and
   [vinyl control](vinyl-control.md#troubleshooting) have their own
   troubleshooting sections.
2. Search the existing issues at
   [github.com/thecrateapp/crate/issues](https://github.com/thecrateapp/crate/issues):
   someone may have asked already.
3. If not, open a new issue there with your question. Start its title with
   `Decks:`, for example `Decks: headphones play the main mix`, and say which
   version of Crate Decks you use (**Help › About**) and on which operating
   system.

**Help › Community Support** opens this page.

## Reporting bugs

Crate Decks bugs are tracked in the Crate repository, at
[github.com/thecrateapp/crate/issues](https://github.com/thecrateapp/crate/issues).
Search first; if nobody reported it, open a new issue:

- **Title:** start it with `Decks:` and say what goes wrong, for example
  `Decks: the Crate section stays empty after signing in`.
- **Version:** the version shown in **Help › About**, or printed by
  `crate-decks --version`.
- **System:** the operating system and its version, and, for sound problems,
  the sound API and devices from **Preferences › Sound Hardware**.
- **Controller:** for controller problems, the controller model and the
  mapping you loaded.
- **Steps:** what you did, what you expected, and what happened instead.
- **Log:** attach the log file. It is in the
  [settings directory](user-manual.md#settings-directory)
  (**Help › Settings directory**): the current log is the file ending in
  `.log`, and older ones end in `.log.1`, `.log.2` and so on. For more
  detail, reproduce the problem after starting Crate Decks with
  `--log-level debug`.

Logs and screenshots can contain the address of your Crate server, track
names and file paths; remove what you do not want to share before you attach
them.

If Crate Decks crashes on start-up, try `--safe-mode` (see
[Command line options](user-manual.md#command-line-options)) and say in the
report whether it helps.

## Translations

The Crate Decks interface comes in 77 languages, from the translations of
the code base it is built on, with the Crate Decks name in place.
**Preferences › Interface › Locale** chooses the language; the
`--locale` option overrides it for one start. Texts that are new in Crate
Decks, such as the Crate section and the first-start dialog, may not be
translated into every language yet.

There is no Crate translation project yet. If a translation is wrong or
missing, open an issue at
[github.com/thecrateapp/crate/issues](https://github.com/thecrateapp/crate/issues)
with a title that starts with `Decks:`, the language, where the text appears
and, if you can, the correct translation.

**Help › Translate This Application** opens this section.

## Sharing controller mappings

Your own controller mappings, and the ones you add by hand, are in your user
mapping folder: the `controllers` folder of your
[settings directory](user-manual.md#settings-directory). **Open User Mapping
Folder** in **Preferences › Controllers** opens it.

- **To share a mapping,** send its `.xml` file and the `.js` files it uses,
  for example in a ZIP file.
- **To use a mapping you received,** put its files in your user mapping
  folder and choose the reload button next to the mapping selector in
  **Preferences › Controllers**. See [Controllers](controllers.md).

For now, mappings are shared through the same issue tracker: open an issue at
[github.com/thecrateapp/crate/issues](https://github.com/thecrateapp/crate/issues)
titled `Decks: mapping for <controller model>`, attach the files in a ZIP
file, and describe what works and what does not. A mapping that works well
can be proposed for inclusion in Crate Decks the same way.
