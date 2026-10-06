# Crate Cast receiver — app/cast-receiver

Scope: the Google Cast Web Receiver (CAF v3) shown on TVs. Sender-side Cast code lives in
`app/listen`; the shared contract is `@crate/cast-protocol` (`app/shared/cast`).
Design: `docs/plans/2026-09-14-crate-cast-receiver-design.md`.

## Layout

- `src/caf-adapter.ts`, `src/caf-types.ts` — the only code touching the CAF global
  (`cast_receiver_framework.js` loaded from gstatic in `index.html`).
- `src/receiver-client.ts`, `receiver-session-runtime.ts`, `receiver-store.ts` — session
  state machine and store.
- `src/components/` — NowPlaying, Artwork, ProgressBar, QueuePreview, SpectrumCanvas.
- `src/spectrum/` — spectrum client, format and canvas renderer.
- `src/sentry*.ts` — receiver Sentry with its own release name.
- `scripts/check-bundle-budget.mjs` — gzip budget gate.

## Commands

```bash
npm run --workspace=app/shared/cast typecheck && npm run --workspace=app/shared/cast test
npm run --workspace=app/cast-receiver lint        # eslint --max-warnings=0
npm run --workspace=app/cast-receiver typecheck
npm run --workspace=app/cast-receiver test        # vitest
npm run --workspace=app/cast-receiver build && npm run --workspace=app/cast-receiver check:bundle
```

## Hard rules

- Protocol changes go in `app/shared/cast` first (types + runtime validation + fixtures),
  then sender and receiver. Never duplicate message shapes locally.
- App bundle must stay under 150 KiB gzip excluding CAF (`check:bundle`, also run in the
  Dockerfile and CI).
- No `@crate/ui`, Tailwind or Listen components here; only TV-safe tokens. Appearance
  follows the sender's skin/mode from a known token subset, never arbitrary CSS.
- The receiver never receives user bearer/refresh tokens; it plays ticketed URLs only.
  Tickets and URLs must be redacted from logs, metrics and Sentry breadcrumbs.
- The receiver never starts playback on its own after reconnect or restore.
- Progress updates must not reload the current item or reset position.

## Pitfalls

- CI runs lint, typecheck, test, build and `check:bundle`; lint is not in pre-commit, so
  run it before pushing.
- Docker build context is `app/` and installs with `--package-lock=false`, so the image
  can resolve different versions than the workspace lockfile. Verify the image build when
  bumping deps.
- Real Cast hardware behaves differently from the dev preview (`src/dev-preview.ts`);
  artwork transitions and canvas work must stay bounded for older devices.
- Host is `CRATE_CAST_RECEIVER_HOST`; the receiver app ID registered with Google points
  at that URL, so changing the host needs a console update.
