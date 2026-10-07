# crate-docs — app/docs

Scope: the technical documentation site. Content is not here: it is the Markdown
under `docs/` listed in `docs/manifest.json`. This app is the renderer.

## Layout

- `src/content.ts` — imports `../../../docs/manifest.json`; sections are fixed:
  start, architecture, developer, operations, federation, reference.
- `src/App.tsx`, `src/components/` — router + react-markdown (remark-gfm) rendering.
- `src/smoke.test.tsx` — vitest smoke test.
- `Dockerfile` — build context is the repo root; copies `app/docs`, `app/shared`, `docs/`.

## Commands

```bash
npm ci --prefix app/docs
npm test --prefix app/docs
npm run build --prefix app/docs          # tsc -b && vite build
npm run check:docs --prefix app/docs     # runs scripts/check-docs.mjs
make dev-docs                            # vite on :5175
```

## Hard rules

- A doc is published only if it has a `docs/manifest.json` entry (`sourcePath`, `route`,
  `section`, `title`, `summary`, `order`). Adding a section means changing both
  `src/content.ts` and `scripts/check-docs.mjs`.
- Published Markdown needs frontmatter: title, summary, section, audience, status,
  order, verified, sources. `sources` must point at real files; run `check:docs`.
- Not an npm workspace: do not add `@crate/ui` or workspace-only imports.

## Pitfalls

- CI (`test-frontend.yml`) runs `check:docs`, test and build; run `check:docs` locally
  whenever you touch `docs/` to avoid a red pipeline.
- Any change under `docs/` changes the image; the build fails if the manifest points at a
  missing file.
