# Install captures

The recording on cratemusic.app/install, and the source text of its terminal
screens, come from this tape. It runs `crate install` inside a throwaway Debian
container as a dry run, so nothing is written.

## 1. Build the Linux installer

From a checkout of the Crate v3 branch (the installer lives in `app/installer`):

```bash
cd app/installer
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
  go build -ldflags "-s -w -X main.version=v3.0.0" \
  -o /path/to/tools/install-captures/bin/crate ./cmd/crate
```

Use `GOARCH=amd64` on an Intel machine. Without `-X main.version` the banner
reads `installer dev`; `encode.sh` masks that label in the video either way.

## 2. Record

Needs Docker and [VHS](https://github.com/charmbracelet/vhs). Run from this
folder:

```bash
vhs install.tape
```

The tape mounts `bin/crate` and `wrap.sh` into the container. `wrap.sh` turns
`crate install` into `crate install --dry-run`, so the flag never appears on
screen. Output lands in `out/`: `install.mp4`, `install.webm`,
`install.ascii` (the text of every frame) and one PNG per step.

## 3. Encode for the site

```bash
./encode.sh
```

It writes `install.mp4`, `install.webm` and the `install.webp` poster to
`app/web/public/install`: trimmed, cropped to the text, scaled to 960 px and
with the version label masked. Four times depend on the recording; check them
after a new take and override as needed:

| Variable     | Default | What it is                                         |
| ------------ | ------- | -------------------------------------------------- |
| `START`      | `1.5`   | First second after the hidden container setup      |
| `END`        | `27.5`  | Last second before Ctrl+C ends the session         |
| `MASK_UNTIL` | `12.3`  | When the banner with the version label scrolls off |
| `POSTER_AT`  | `11`    | Poster frame, in seconds of the trimmed video      |

## 4. Update the terminal screens

The screens on the page are HTML, not images. Their text lives in
`app/web/src/content/install/screens.ts`, copied verbatim from
`out/install.ascii`. `install.ascii` cuts off once the scrollback is longer than
the window; read the last steps from the PNGs in `out/`. Step 7 shows a real
run, so it is rebuilt from `internal/wizard/finish.go` in the installer source
rather than the dry run.

`bin/` and `out/` are not committed.
